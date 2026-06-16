// Domínio: autenticação (senha local e Google) + tokens e middlewares.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const { DASH_CONFIG } = require("./config");
const { getMysqlConnection, fecharJdbc } = require("./db");
const { limparValorDash } = require("./utils");

async function garantirTabelaUsuarios() {
  const conn = await getMysqlConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.USUARIOS_TABLE}\` (
        \`ID_USUARIO\`         BIGINT NOT NULL AUTO_INCREMENT,
        \`LOGIN\`              VARCHAR(120) NOT NULL,
        \`SENHA_HASH\`         VARCHAR(255) NOT NULL,
        \`NOME\`               VARCHAR(255) NULL,
        \`EMAIL\`              VARCHAR(255) NULL,
        \`NIVEL_AUTORIZACAO\`  INT NOT NULL DEFAULT 0,
        \`ATIVO\`              TINYINT NOT NULL DEFAULT 1,
        \`CRIADO_EM\`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`ATUALIZADO_EM\`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`ID_USUARIO\`),
        UNIQUE KEY \`UQ_${DASH_CONFIG.USUARIOS_TABLE}_LOGIN\` (\`LOGIN\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const tabU = `\`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.USUARIOS_TABLE}\``;

    // Seed de um usuário administrador inicial somente quando a tabela está vazia.
    const [rows] = await conn.query(`SELECT COUNT(*) AS total FROM ${tabU}`);
    const total = rows && rows[0] ? Number(rows[0].total) : 0;

    if (total === 0) {
      const login = process.env.SEED_ADMIN_LOGIN || "admin";
      // Sem SEED_ADMIN_SENHA definida, gera uma senha forte aleatória em vez de
      // usar um valor fixo conhecido (evita admin com senha previsível).
      const senhaEnv = String(process.env.SEED_ADMIN_SENHA || "");
      const senha = senhaEnv || crypto.randomBytes(18).toString("base64");
      const nome = process.env.SEED_ADMIN_NOME || "Administrador";
      const email = process.env.SEED_ADMIN_EMAIL || "";
      const hash = await bcrypt.hash(senha, 10);

      // Bootstrap nasce como super administrador (nível 3): pode conceder
      // privilégios e excluir usuários, além de tudo que o admin comum faz.
      await conn.execute(
        `INSERT INTO ${tabU}
           (\`LOGIN\`, \`SENHA_HASH\`, \`NOME\`, \`EMAIL\`, \`NIVEL_AUTORIZACAO\`, \`ATIVO\`)
         VALUES (?, ?, ?, ?, ?, 1)`,
        [login, hash, nome, email || null, DASH_CONFIG.NIVEL_SUPERADMIN]
      );

      if (senhaEnv) {
        console.warn(
          `[ATENÇÃO] Usuário administrador inicial criado (login: "${login}"). ` +
          "Troque a senha assim que possível."
        );
      } else {
        console.warn(
          `[ATENÇÃO] Usuário administrador inicial criado (login: "${login}").\n` +
          `          Senha gerada automaticamente: ${senha}\n` +
          "          Anote-a agora, faça login, troque a senha e defina SEED_ADMIN_SENHA no .env."
        );
      }
    } else {
      // Migração (idempotente): ao introduzir o nível de super administrador,
      // garante que os administradores atuais não percam os poderes que já tinham.
      // Só promove se ainda não existe nenhum super admin — assim, depois de
      // criado o primeiro, é possível ter admins comuns (nível 2) normalmente.
      const [sup] = await conn.query(
        `SELECT COUNT(*) AS total FROM ${tabU} WHERE \`NIVEL_AUTORIZACAO\` >= ?`,
        [DASH_CONFIG.NIVEL_SUPERADMIN]
      );
      const temSuperAdmin = sup && sup[0] ? Number(sup[0].total) : 0;
      if (!temSuperAdmin) {
        const [res] = await conn.execute(
          `UPDATE ${tabU} SET \`NIVEL_AUTORIZACAO\` = ? WHERE \`NIVEL_AUTORIZACAO\` = ?`,
          [DASH_CONFIG.NIVEL_SUPERADMIN, DASH_CONFIG.NIVEL_ADMIN]
        );
        const promovidos = (res && res.affectedRows) || 0;
        if (promovidos) {
          console.warn(
            `[MIGRAÇÃO] ${promovidos} administrador(es) promovido(s) para super administrador ` +
            `(nível ${DASH_CONFIG.NIVEL_SUPERADMIN}) para preservar a permissão de gerenciar privilégios e excluir usuários.`
          );
        }
      }
    }
  } finally {
    await fecharJdbc(conn);
  }
}

async function autenticarUsuario(body) {
  return await autenticarUsuarioLocal(body);
}

async function autenticarUsuarioLocal(body) {
  const login = limparValorDash(body.login || body.usuario);
  const senha = String(body.senha || "");

  if (!login || !senha) throw new Error("Informe usuário e senha.");

  const conn = await getMysqlConnection();
  try {
    const [rows] = await conn.query(
      `SELECT \`ID_USUARIO\`, \`LOGIN\`, \`SENHA_HASH\`, \`NOME\`, \`EMAIL\`, \`NIVEL_AUTORIZACAO\`, \`ATIVO\`
         FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.USUARIOS_TABLE}\`
        WHERE \`LOGIN\` = ? LIMIT 1`,
      [login]
    );

    const registro = rows && rows[0] ? rows[0] : null;
    if (!registro || Number(registro.ATIVO) !== 1) {
      throw new Error("Usuário ou senha inválidos.");
    }

    const senhaConfere = await bcrypt.compare(senha, String(registro.SENHA_HASH || ""));
    if (!senhaConfere) {
      throw new Error("Usuário ou senha inválidos.");
    }

    const usuario = {
      id: Number(registro.ID_USUARIO),
      login: limparValorDash(registro.LOGIN),
      nome: limparValorDash(registro.NOME),
      email: limparValorDash(registro.EMAIL),
      nivelAutorizacao: Number(registro.NIVEL_AUTORIZACAO || 0),
      aprovado: true // login por senha exige ATIVO=1 (verificado acima)
    };

    const token = jwt.sign(usuario, DASH_CONFIG.JWT_SECRET, { expiresIn: DASH_CONFIG.JWT_EXPIRES });
    return { token, usuario, aprovado: true };
  } finally {
    await fecharJdbc(conn);
  }
}

let googleOAuthClient = null;

function getGoogleClient() {
  if (!DASH_CONFIG.GOOGLE_CLIENT_ID) return null;
  if (!googleOAuthClient) googleOAuthClient = new OAuth2Client(DASH_CONFIG.GOOGLE_CLIENT_ID);
  return googleOAuthClient;
}

async function autenticarUsuarioGoogle(body) {
  const credential = String((body && body.credential) || "");
  if (!credential) throw new Error("Token do Google ausente.");

  const client = getGoogleClient();
  if (!client) throw new Error("Login com Google não está configurado no servidor.");

  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: DASH_CONFIG.GOOGLE_CLIENT_ID
    });
    payload = ticket.getPayload();
  } catch (e) {
    throw new Error("Não foi possível validar o login do Google.");
  }

  const email = String((payload && payload.email) || "").trim().toLowerCase();
  const emailVerificado = !!(payload && payload.email_verified);
  const nome = String((payload && payload.name) || email);

  if (!email || !emailVerificado) {
    throw new Error("Conta Google sem e-mail verificado.");
  }

  // E-mails liberados individualmente (lista separada por vírgula). Útil para pessoas
  // externas pontuais (ex.: usuários de teste) sem precisar liberar o domínio inteiro.
  const emailsPermitidos = String(DASH_CONFIG.GOOGLE_ALLOWED_EMAILS || "")
    .toLowerCase()
    .split(",")
    .map(e => e.trim())
    .filter(Boolean);
  const emailLiberadoIndividualmente = emailsPermitidos.includes(email);

  // Domínios permitidos: lista separada por vírgula (ex.: "agenciasus.org.br, outro.com").
  // Vazio = qualquer domínio. Mantém o acesso restrito mesmo com a tela de consentimento "External".
  const dominiosPermitidos = String(DASH_CONFIG.GOOGLE_ALLOWED_DOMAIN || "")
    .toLowerCase()
    .split(",")
    .map(d => d.trim())
    .filter(Boolean);

  // Se o e-mail está na allowlist individual, libera direto (ignora a checagem de domínio).
  if (!emailLiberadoIndividualmente && dominiosPermitidos.length) {
    const dominioConta = String((payload && payload.hd) || email.split("@")[1] || "").toLowerCase();
    if (!dominiosPermitidos.includes(dominioConta)) {
      throw new Error(`Seu domínio (@${dominioConta}) não tem acesso a este painel.`);
    }
  }

  const tabela = `\`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.USUARIOS_TABLE}\``;
  const selectPorEmail =
    `SELECT \`ID_USUARIO\`, \`LOGIN\`, \`NOME\`, \`EMAIL\`, \`NIVEL_AUTORIZACAO\`, \`ATIVO\`
       FROM ${tabela} WHERE \`EMAIL\` = ? LIMIT 1`;

  const conn = await getMysqlConnection();
  try {
    let [rows] = await conn.query(selectPorEmail, [email]);
    let registro = rows && rows[0] ? rows[0] : null;

    // E-mails da allowlist individual são liberados na hora (não passam pela aprovação).
    // Os demais começam SEM acesso (ATIVO=0) e precisam de aprovação de um administrador.
    const ativoInicial = emailLiberadoIndividualmente ? 1 : 0;
    const nivelInicial = emailLiberadoIndividualmente ? DASH_CONFIG.GOOGLE_NIVEL_PADRAO : 0;

    if (!registro) {
      // Auto-cadastro: guarda só a parte do e-mail antes do "@" como LOGIN.
      const loginCurto = email.split("@")[0];
      await conn.execute(
        `INSERT INTO ${tabela}
           (\`LOGIN\`, \`SENHA_HASH\`, \`NOME\`, \`EMAIL\`, \`NIVEL_AUTORIZACAO\`, \`ATIVO\`)
         VALUES (?, '', ?, ?, ?, ?)`,
        [loginCurto, nome, email, nivelInicial, ativoInicial]
      );
      [rows] = await conn.query(selectPorEmail, [email]);
      registro = rows && rows[0] ? rows[0] : null;
    } else if (emailLiberadoIndividualmente && Number(registro.ATIVO) !== 1) {
      // Promove automaticamente um e-mail da allowlist que estava pendente.
      await conn.execute(`UPDATE ${tabela} SET \`ATIVO\` = 1 WHERE \`EMAIL\` = ?`, [email]);
      registro.ATIVO = 1;
    }

    if (!registro) throw new Error("Falha ao registrar o usuário do Google.");

    const aprovado = Number(registro.ATIVO) === 1;
    const usuario = {
      id: Number(registro.ID_USUARIO),
      login: limparValorDash(registro.LOGIN),
      nome: limparValorDash(registro.NOME),
      email: limparValorDash(registro.EMAIL),
      nivelAutorizacao: aprovado ? Number(registro.NIVEL_AUTORIZACAO || 0) : 0,
      aprovado
    };

    // Mesmo sem aprovação, emitimos um token (limitado) para o usuário poder
    // abrir a tela de acesso pendente e enviar/acompanhar a solicitação.
    const token = jwt.sign(usuario, DASH_CONFIG.JWT_SECRET, { expiresIn: DASH_CONFIG.JWT_EXPIRES });
    return { token, usuario, aprovado };
  } finally {
    await fecharJdbc(conn);
  }
}

function lerTokenDaRequisicao(req) {
  const header = String(req.headers.authorization || req.headers.Authorization || "");
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  return "";
}

function verificarToken(token) {
  try {
    const payload = jwt.verify(token, DASH_CONFIG.JWT_SECRET);
    return {
      id: payload.id,
      login: payload.login,
      nome: payload.nome,
      email: payload.email,
      nivelAutorizacao: Number(payload.nivelAutorizacao || 0),
      aprovado: !!payload.aprovado
    };
  } catch (err) {
    return null;
  }
}

function exigirAprovadoMiddleware(req, res, next) {
  if (!req.usuario || !req.usuario.aprovado) {
    res.status(403).json({ error: "Acesso ainda não aprovado." });
    return;
  }
  next();
}

async function obterUsuarioAtualComConn(conn, tokenUser) {
  const id = Number(tokenUser && tokenUser.id) || 0;
  if (!id) return null;
  const tabelaU = `\`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.USUARIOS_TABLE}\``;
  const [rows] = await conn.query(
    `SELECT \`ID_USUARIO\`, \`LOGIN\`, \`NOME\`, \`EMAIL\`, \`NIVEL_AUTORIZACAO\`, \`ATIVO\`
       FROM ${tabelaU} WHERE \`ID_USUARIO\` = ? LIMIT 1`,
    [id]
  );
  const r = rows && rows[0] ? rows[0] : null;
  if (!r) return null;
  const aprovado = Number(r.ATIVO) === 1;
  return {
    id: Number(r.ID_USUARIO),
    login: limparValorDash(r.LOGIN),
    nome: limparValorDash(r.NOME),
    email: limparValorDash(r.EMAIL),
    nivelAutorizacao: aprovado ? Number(r.NIVEL_AUTORIZACAO || 0) : 0,
    aprovado
  };
}

function autenticarMiddleware(req, res, next) {
  const usuario = verificarToken(lerTokenDaRequisicao(req));
  if (!usuario) {
    res.status(401).json({ error: "Sessão expirada ou inválida. Faça login novamente." });
    return;
  }
  req.usuario = usuario;
  next();
}

function autenticarFrescoMiddleware(req, res, next) {
  const tokenUser = verificarToken(lerTokenDaRequisicao(req));
  if (!tokenUser) {
    res.status(401).json({ error: "Sessão expirada ou inválida. Faça login novamente." });
    return;
  }
  getMysqlConnection()
    .then(async (conn) => {
      try {
        const usuario = await obterUsuarioAtualComConn(conn, tokenUser);
        if (!usuario) {
          res.status(401).json({ error: "Sessão encerrada. Faça login novamente." });
          return;
        }
        req.usuario = usuario;
        next();
      } finally {
        await fecharJdbc(conn);
      }
    })
    .catch(next);
}

function autenticarOpcionalMiddleware(req, res, next) {
  const usuario = verificarToken(lerTokenDaRequisicao(req));
  if (usuario) req.usuario = usuario;
  next();
}

function exigirNivelMiddleware(nivelMinimo) {
  return function (req, res, next) {
    const nivel = req.usuario ? Number(req.usuario.nivelAutorizacao || 0) : 0;
    if (nivel < nivelMinimo) {
      res.status(403).json({ error: "Você não tem permissão para esta ação." });
      return;
    }
    next();
  };
}

module.exports = { autenticarUsuario, autenticarUsuarioGoogle, obterUsuarioAtualComConn, autenticarMiddleware, autenticarFrescoMiddleware, autenticarOpcionalMiddleware, exigirNivelMiddleware, exigirAprovadoMiddleware, garantirTabelaUsuarios };
