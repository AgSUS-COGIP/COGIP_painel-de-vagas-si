// Domínio: autenticação (senha local e Google) + tokens e middlewares.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const { DASH_CONFIG } = require("./config");
const { getMysqlConnection, fecharJdbc } = require("./db");
const { limparValorDash } = require("./utils");
const { garantirTabelaPermissoesModulos, contarSuperAdminsComConn, garantirSuperAdminComConn, semearNivelTodosModulosComConn } = require("./permissoes");

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
        \`NIVEL_AUTORIZACAO\`  INT NOT NULL DEFAULT 0, -- OBSOLETO: o acesso é por módulo (tabela PERMISSOES_MODULOS). Mantida só por histórico/migração.
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

    // A tabela de permissões por módulo precisa existir antes de semear o super
    // admin (o acesso é definido lá, indexado por e-mail).
    await garantirTabelaPermissoesModulos();

    if (total === 0) {
      const login = process.env.SEED_ADMIN_LOGIN || "admin";
      // Sem SEED_ADMIN_SENHA definida, gera uma senha forte aleatória em vez de
      // usar um valor fixo conhecido (evita admin com senha previsível).
      const senhaEnv = String(process.env.SEED_ADMIN_SENHA || "");
      const senha = senhaEnv || crypto.randomBytes(18).toString("base64");
      const nome = process.env.SEED_ADMIN_NOME || "Administrador";
      // O acesso é indexado por e-mail; o admin precisa ter um. Sem SEED_ADMIN_EMAIL,
      // usa um sintético "<login>@local" (o login local é por LOGIN, não por e-mail).
      const email = String(process.env.SEED_ADMIN_EMAIL || "").trim().toLowerCase() || `${login}@local`;
      const hash = await bcrypt.hash(senha, 10);

      await conn.execute(
        `INSERT INTO ${tabU}
           (\`LOGIN\`, \`SENHA_HASH\`, \`NOME\`, \`EMAIL\`, \`NIVEL_AUTORIZACAO\`, \`ATIVO\`)
         VALUES (?, ?, ?, ?, 0, 1)`,
        [login, hash, nome, email]
      );
      // Bootstrap nasce como super administrador: nível 3 em todos os módulos.
      await garantirSuperAdminComConn(conn, email);

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
      // Rede de segurança contra lockout: se NÃO existe nenhum super admin no novo
      // modelo (ninguém com nível 3 no módulo "solicitacoes"), promove os admins
      // legados. Preferência: ex-super-admins (NIVEL_AUTORIZACAO >= 3); na ausência,
      // ex-admins (>= 2) — espelha a antiga rede de segurança. Idempotente: depois
      // que existe ao menos um super admin, este bloco não faz nada.
      const temSuperAdmin = await contarSuperAdminsComConn(conn);
      if (!temSuperAdmin) {
        let [cands] = await conn.query(
          `SELECT \`ID_USUARIO\`, \`LOGIN\`, \`EMAIL\` FROM ${tabU}
            WHERE \`ATIVO\` = 1 AND \`NIVEL_AUTORIZACAO\` >= ?`,
          [DASH_CONFIG.NIVEL_SUPERADMIN]
        );
        if (!cands || !cands.length) {
          [cands] = await conn.query(
            `SELECT \`ID_USUARIO\`, \`LOGIN\`, \`EMAIL\` FROM ${tabU}
              WHERE \`ATIVO\` = 1 AND \`NIVEL_AUTORIZACAO\` >= ?`,
            [DASH_CONFIG.NIVEL_ADMIN]
          );
        }
        let promovidos = 0;
        for (const c of cands || []) {
          // Sem e-mail não há como indexar a permissão: grava um sintético estável.
          let email = String(c.EMAIL || "").trim().toLowerCase();
          if (!email) {
            email = `${String(c.LOGIN || "admin").trim().toLowerCase()}@local`;
            await conn.execute(`UPDATE ${tabU} SET \`EMAIL\` = ? WHERE \`ID_USUARIO\` = ?`, [email, c.ID_USUARIO]);
          }
          await garantirSuperAdminComConn(conn, email);
          promovidos++;
        }
        if (promovidos) {
          console.warn(
            `[MIGRAÇÃO] ${promovidos} administrador(es) legado(s) promovido(s) a super administrador ` +
            `(nível 3 em todos os módulos) para não travar o acesso. Rode scripts/migrar-permissoes-globais.js ` +
            "para migrar os demais usuários."
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
    // Sem registro com SENHA_HASH preenchida não há como autenticar por senha
    // (ex.: contas criadas só pelo Google nascem com SENHA_HASH vazia).
    if (!registro || !String(registro.SENHA_HASH || "")) {
      throw new Error("Usuário ou senha inválidos.");
    }

    const senhaConfere = await bcrypt.compare(senha, String(registro.SENHA_HASH || ""));
    if (!senhaConfere) {
      throw new Error("Usuário ou senha inválidos.");
    }

    // Mesmo padrão do login Google: a senha confere, mas o acesso só está liberado
    // com ATIVO=1. Pendente/desativado (ATIVO=0) entra com token limitado e
    // aprovado=false -> cai na tela de solicitação/acompanhamento de acesso.
    const aprovado = Number(registro.ATIVO) === 1;
    const usuario = {
      id: Number(registro.ID_USUARIO),
      login: limparValorDash(registro.LOGIN),
      nome: limparValorDash(registro.NOME),
      email: limparValorDash(registro.EMAIL),
      nivelAutorizacao: aprovado ? Number(registro.NIVEL_AUTORIZACAO || 0) : 0,
      aprovado
    };

    const token = jwt.sign(usuario, DASH_CONFIG.JWT_SECRET, { expiresIn: DASH_CONFIG.JWT_EXPIRES, algorithm: "HS256" });
    return { token, usuario, aprovado };
  } finally {
    await fecharJdbc(conn);
  }
}

// Auto-cadastro por usuário/senha. Segue o mesmo padrão do primeiro login pelo
// Google: a conta nasce SEM acesso (ATIVO=0, nível 0) e precisa de aprovação de
// um administrador. Retorna um token limitado para o usuário já abrir a tela de
// solicitação de acesso.
async function registrarUsuarioLocal(body) {
  const login = limparValorDash((body && (body.login || body.usuario)) || "");
  const senha = String((body && body.senha) || "");
  const nome = limparValorDash((body && body.nome) || "");
  const email = limparValorDash((body && body.email) || "").toLowerCase();

  if (!login || !senha) throw new Error("Informe usuário e senha.");
  if (senha.length < 6) throw new Error("A senha deve ter pelo menos 6 caracteres.");

  const tabela = `\`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.USUARIOS_TABLE}\``;
  const conn = await getMysqlConnection();
  try {
    // LOGIN é UNIQUE; também evitamos e-mail repetido para não duplicar a pessoa.
    const [jaLogin] = await conn.query(`SELECT \`ID_USUARIO\` FROM ${tabela} WHERE \`LOGIN\` = ? LIMIT 1`, [login]);
    if (jaLogin && jaLogin[0]) throw new Error("Já existe um usuário com esse login.");
    if (email) {
      const [jaEmail] = await conn.query(`SELECT \`ID_USUARIO\` FROM ${tabela} WHERE \`EMAIL\` = ? LIMIT 1`, [email]);
      if (jaEmail && jaEmail[0]) throw new Error("Já existe um usuário com esse e-mail.");
    }

    const hash = await bcrypt.hash(senha, 10);
    try {
      await conn.execute(
        `INSERT INTO ${tabela}
           (\`LOGIN\`, \`SENHA_HASH\`, \`NOME\`, \`EMAIL\`, \`NIVEL_AUTORIZACAO\`, \`ATIVO\`)
         VALUES (?, ?, ?, ?, 0, 0)`,
        [login, hash, nome || null, email || null]
      );
    } catch (e) {
      // Corrida no índice UNIQUE de LOGIN entre a checagem e o INSERT.
      if (e && e.code === "ER_DUP_ENTRY") throw new Error("Já existe um usuário com esse login.");
      throw e;
    }

    const [rows] = await conn.query(
      `SELECT \`ID_USUARIO\`, \`LOGIN\`, \`NOME\`, \`EMAIL\` FROM ${tabela} WHERE \`LOGIN\` = ? LIMIT 1`,
      [login]
    );
    const registro = rows && rows[0] ? rows[0] : null;
    if (!registro) throw new Error("Falha ao registrar o usuário.");

    const usuario = {
      id: Number(registro.ID_USUARIO),
      login: limparValorDash(registro.LOGIN),
      nome: limparValorDash(registro.NOME),
      email: limparValorDash(registro.EMAIL),
      nivelAutorizacao: 0,
      aprovado: false
    };

    const token = jwt.sign(usuario, DASH_CONFIG.JWT_SECRET, { expiresIn: DASH_CONFIG.JWT_EXPIRES, algorithm: "HS256" });
    return { token, usuario, aprovado: false };
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

    if (!registro) {
      // Auto-cadastro: guarda só a parte do e-mail antes do "@" como LOGIN.
      const loginCurto = email.split("@")[0];
      await conn.execute(
        `INSERT INTO ${tabela}
           (\`LOGIN\`, \`SENHA_HASH\`, \`NOME\`, \`EMAIL\`, \`NIVEL_AUTORIZACAO\`, \`ATIVO\`)
         VALUES (?, '', ?, ?, 0, ?)`,
        [loginCurto, nome, email, ativoInicial]
      );
      // Allowlist individual entra direto com um nível inicial em todos os módulos
      // funcionais (o acesso é por módulo; não há mais nível global). Os demais
      // ficam sem acesso até um admin liberar na matriz.
      if (emailLiberadoIndividualmente && Number(DASH_CONFIG.GOOGLE_NIVEL_PADRAO) > 0) {
        await semearNivelTodosModulosComConn(conn, email, DASH_CONFIG.GOOGLE_NIVEL_PADRAO);
      }
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
    const token = jwt.sign(usuario, DASH_CONFIG.JWT_SECRET, { expiresIn: DASH_CONFIG.JWT_EXPIRES, algorithm: "HS256" });
    return { token, usuario, aprovado };
  } finally {
    await fecharJdbc(conn);
  }
}

function lerCookie(req, nome) {
  const raw = String(req.headers.cookie || "");
  if (!raw) return "";
  for (const parte of raw.split(";")) {
    const idx = parte.indexOf("=");
    if (idx === -1) continue;
    if (parte.slice(0, idx).trim() === nome) {
      return decodeURIComponent(parte.slice(idx + 1).trim());
    }
  }
  return "";
}

function lerTokenDaRequisicao(req) {
  // 1) Cookie HttpOnly (preferencial) — não é acessível por JavaScript/XSS.
  const cookieToken = lerCookie(req, DASH_CONFIG.COOKIE_SESSAO);
  if (cookieToken) return cookieToken;

  // 2) Fallback: cabeçalho Authorization: Bearer <token> (compatibilidade).
  const header = String(req.headers.authorization || req.headers.Authorization || "");
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  return "";
}

function verificarToken(token) {
  try {
    const payload = jwt.verify(token, DASH_CONFIG.JWT_SECRET, { algorithms: ["HS256"] });
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

module.exports = { autenticarUsuario, autenticarUsuarioGoogle, registrarUsuarioLocal, obterUsuarioAtualComConn, autenticarMiddleware, autenticarFrescoMiddleware, autenticarOpcionalMiddleware, exigirNivelMiddleware, exigirAprovadoMiddleware, garantirTabelaUsuarios };
