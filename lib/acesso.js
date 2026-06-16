// Domínio: solicitações e aprovação de acesso. Regras + persistência.
const { DASH_CONFIG } = require("./config");
const { getMysqlConnection, fecharJdbc } = require("./db");
const { limparValorDash } = require("./utils");

async function garantirTabelaSolicitacoesAcesso() {
  const conn = await getMysqlConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.SOLICITACOES_ACESSO_TABLE}\` (
        \`ID_SOLICITACAO\`      BIGINT NOT NULL AUTO_INCREMENT,
        \`EMAIL\`              VARCHAR(255) NOT NULL,
        \`NOME\`               VARCHAR(255) NULL,
        \`CARGO\`              VARCHAR(255) NULL,
        \`COORDENACAO\`        VARCHAR(255) NULL,
        \`DSEI\`               VARCHAR(255) NULL,
        \`CASAI\`              VARCHAR(255) NULL,
        \`JUSTIFICATIVA\`      TEXT NOT NULL,
        \`STATUS\`             VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
        \`CRIADO_EM\`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`DECIDIDO_POR\`       VARCHAR(255) NULL,
        \`DECIDIDO_EM\`        DATETIME NULL,
        \`OBSERVACAO_DECISAO\` TEXT NULL,
        PRIMARY KEY (\`ID_SOLICITACAO\`),
        UNIQUE KEY \`UQ_${DASH_CONFIG.SOLICITACOES_ACESSO_TABLE}_EMAIL\` (\`EMAIL\`),
        KEY \`IDX_${DASH_CONFIG.SOLICITACOES_ACESSO_TABLE}_STATUS\` (\`STATUS\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } finally {
    await fecharJdbc(conn);
  }
}

function tabelaSolicitacoes() {
  return `\`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.SOLICITACOES_ACESSO_TABLE}\``;
}

const COLS_SOLICITACAO =
  "`ID_SOLICITACAO`, `EMAIL`, `NOME`, `CARGO`, `COORDENACAO`, `DSEI`, `CASAI`, " +
  "`JUSTIFICATIVA`, `STATUS`, `CRIADO_EM`, `DECIDIDO_POR`, `DECIDIDO_EM`, `OBSERVACAO_DECISAO`";

async function salvarSolicitacaoAcessoComConn(conn, email, body) {
  const emailNorm = String(email || "").trim().toLowerCase();
  if (!emailNorm) throw new Error("Não foi possível identificar o usuário.");

  const justificativa = limparValorDash(body.justificativa);
  if (!justificativa) throw new Error("A justificativa é obrigatória.");

  const dados = {
    nome: limparValorDash(body.nome) || null,
    cargo: limparValorDash(body.cargo) || null,
    coordenacao: limparValorDash(body.coordenacao) || null,
    dsei: limparValorDash(body.dsei) || null,
    casai: limparValorDash(body.casai) || null,
    justificativa
  };

  const [rows] = await conn.query(
    `SELECT \`ID_SOLICITACAO\` FROM ${tabelaSolicitacoes()} WHERE \`EMAIL\` = ? LIMIT 1`,
    [emailNorm]
  );
  const existente = rows && rows[0] ? rows[0] : null;

  if (existente) {
    await conn.execute(
      `UPDATE ${tabelaSolicitacoes()} SET
         \`NOME\` = ?, \`CARGO\` = ?, \`COORDENACAO\` = ?, \`DSEI\` = ?, \`CASAI\` = ?, \`JUSTIFICATIVA\` = ?,
         \`STATUS\` = 'PENDENTE', \`DECIDIDO_POR\` = NULL, \`DECIDIDO_EM\` = NULL, \`OBSERVACAO_DECISAO\` = NULL
       WHERE \`ID_SOLICITACAO\` = ?`,
      [dados.nome, dados.cargo, dados.coordenacao, dados.dsei, dados.casai, dados.justificativa, existente.ID_SOLICITACAO]
    );
    return { id: Number(existente.ID_SOLICITACAO), atualizado: true };
  }

  const [res] = await conn.execute(
    `INSERT INTO ${tabelaSolicitacoes()}
       (\`EMAIL\`, \`NOME\`, \`CARGO\`, \`COORDENACAO\`, \`DSEI\`, \`CASAI\`, \`JUSTIFICATIVA\`, \`STATUS\`)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDENTE')`,
    [emailNorm, dados.nome, dados.cargo, dados.coordenacao, dados.dsei, dados.casai, dados.justificativa]
  );
  return { id: res.insertId, atualizado: false };
}

let _listasAcessoCache = { expira: 0, data: null };

async function obterListasAcesso() {
  if (_listasAcessoCache.data && Date.now() < _listasAcessoCache.expira) {
    return _listasAcessoCache.data;
  }
  const T = `\`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.TRABALHADOR_CONSOLIDADO_TABLE}\``;
  const conn = await getMysqlConnection();
  try {
    const distinta = async (sql) => {
      try { const [rows] = await conn.query(sql); return rows.map(r => r.v).filter(Boolean); }
      catch (e) { return []; }
    };
    const dsei = await distinta(`SELECT DISTINCT \`UNIDADE_ORCAMENTARIA_DESC\` v FROM ${T} WHERE \`UNIDADE_ORCAMENTARIA_DESC\` LIKE 'DSEI%' ORDER BY v`);
    const casai = await distinta(`SELECT DISTINCT \`UNIDADE_ORCAMENTARIA_DESC\` v FROM ${T} WHERE \`UNIDADE_ORCAMENTARIA_DESC\` LIKE 'CASAI%' ORDER BY v`);
    const coordenacoes = await distinta(`SELECT DISTINCT \`COORDENACAO_SIGLA\` v FROM ${T} WHERE \`COORDENACAO_SIGLA\` IS NOT NULL AND \`COORDENACAO_SIGLA\` <> '' ORDER BY v`);
    const cargos = await distinta(`SELECT DISTINCT \`CARGO_ATUAL_DESC\` v FROM ${T} WHERE \`CARGO_ATUAL_DESC\` IS NOT NULL AND \`CARGO_ATUAL_DESC\` <> '' ORDER BY v`);

    const data = { dsei, casai, coordenacoes, cargos };
    _listasAcessoCache = { expira: Date.now() + 30 * 60 * 1000, data };
    return data;
  } finally {
    await fecharJdbc(conn);
  }
}

async function obterSituacaoAcessoComConn(conn, email) {
  const emailNorm = String(email || "").trim().toLowerCase();
  const [rows] = await conn.query(
    `SELECT ${COLS_SOLICITACAO} FROM ${tabelaSolicitacoes()}
      WHERE \`EMAIL\` = ? ORDER BY \`CRIADO_EM\` DESC, \`ID_SOLICITACAO\` DESC`,
    [emailNorm]
  );
  const historico = rows || [];
  return { atual: historico[0] || null, historico };
}

async function listarSolicitacoesComConn(conn) {
  const tabU = `\`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.USUARIOS_TABLE}\``;
  const sel = `s.\`ID_SOLICITACAO\`, s.\`EMAIL\`, s.\`NOME\`, s.\`CARGO\`, s.\`COORDENACAO\`, s.\`DSEI\`,
    s.\`CASAI\`, s.\`JUSTIFICATIVA\`, s.\`STATUS\`, s.\`CRIADO_EM\`, s.\`DECIDIDO_POR\`, s.\`DECIDIDO_EM\`,
    s.\`OBSERVACAO_DECISAO\`, u.\`NIVEL_AUTORIZACAO\` AS USUARIO_NIVEL, u.\`ATIVO\` AS USUARIO_ATIVO`;
  const join = `FROM ${tabelaSolicitacoes()} s LEFT JOIN ${tabU} u ON u.\`EMAIL\` = s.\`EMAIL\``;

  const [pendentes] = await conn.query(
    `SELECT ${sel} ${join} WHERE s.\`STATUS\` = 'PENDENTE' ORDER BY s.\`CRIADO_EM\` ASC`
  );
  const [historico] = await conn.query(
    `SELECT ${sel} ${join} WHERE s.\`STATUS\` <> 'PENDENTE' ORDER BY s.\`DECIDIDO_EM\` DESC, s.\`ID_SOLICITACAO\` DESC LIMIT 200`
  );
  return { pendentes: pendentes || [], historico: historico || [] };
}

async function definirNivelUsuarioComConn(conn, email, nivel) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) throw new Error("E-mail inválido.");
  const n = Number(nivel);
  if (![0, 1, 2, 3].includes(n)) throw new Error("Nível inválido.");
  const tabU = `\`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.USUARIOS_TABLE}\``;
  await conn.execute(`UPDATE ${tabU} SET \`NIVEL_AUTORIZACAO\` = ? WHERE \`EMAIL\` = ?`, [n, e]);
  return { email: e, nivel: n };
}

async function aprovarSolicitacaoComConn(conn, idSolicitacao, adminEmail, opcoes = {}) {
  const id = Number(idSolicitacao);
  if (!id) throw new Error("Solicitação inválida.");

  const [rows] = await conn.query(
    `SELECT \`EMAIL\`, \`NOME\`, \`STATUS\` FROM ${tabelaSolicitacoes()} WHERE \`ID_SOLICITACAO\` = ? LIMIT 1`,
    [id]
  );
  const sol = rows && rows[0] ? rows[0] : null;
  if (!sol) throw new Error("Solicitação não encontrada.");
  if (String(sol.STATUS) !== "PENDENTE") throw new Error("Esta solicitação já foi decidida.");

  const nivel = Number(opcoes.nivel) > 0 ? Number(opcoes.nivel) : DASH_CONFIG.NIVEL_ACESSO_APROVADO;
  const observacao = limparValorDash(opcoes.observacao) || null;
  const email = String(sol.EMAIL).trim().toLowerCase();
  const tabelaU = `\`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.USUARIOS_TABLE}\``;

  await conn.beginTransaction();
  try {
    await conn.execute(
      `UPDATE ${tabelaSolicitacoes()} SET
         \`STATUS\` = 'APROVADO', \`DECIDIDO_POR\` = ?, \`DECIDIDO_EM\` = NOW(), \`OBSERVACAO_DECISAO\` = ?
       WHERE \`ID_SOLICITACAO\` = ?`,
      [adminEmail || null, observacao, id]
    );

    const [uRows] = await conn.query(`SELECT \`ID_USUARIO\` FROM ${tabelaU} WHERE \`EMAIL\` = ? LIMIT 1`, [email]);
    if (uRows && uRows[0]) {
      await conn.execute(`UPDATE ${tabelaU} SET \`ATIVO\` = 1, \`NIVEL_AUTORIZACAO\` = ? WHERE \`EMAIL\` = ?`, [nivel, email]);
    } else {
      await conn.execute(
        `INSERT INTO ${tabelaU} (\`LOGIN\`, \`SENHA_HASH\`, \`NOME\`, \`EMAIL\`, \`NIVEL_AUTORIZACAO\`, \`ATIVO\`)
         VALUES (?, '', ?, ?, ?, 1)`,
        [email.split("@")[0], limparValorDash(sol.NOME) || email, email, nivel]
      );
    }

    await conn.commit();
    return { id, email, nivel, status: "APROVADO" };
  } catch (err) {
    await conn.rollback();
    throw err;
  }
}

async function recusarSolicitacaoComConn(conn, idSolicitacao, adminEmail, observacao) {
  const id = Number(idSolicitacao);
  if (!id) throw new Error("Solicitação inválida.");
  const motivo = limparValorDash(observacao);
  if (!motivo) throw new Error("A justificativa da recusa é obrigatória.");

  const [rows] = await conn.query(
    `SELECT \`EMAIL\`, \`STATUS\` FROM ${tabelaSolicitacoes()} WHERE \`ID_SOLICITACAO\` = ? LIMIT 1`, [id]
  );
  const sol = rows && rows[0] ? rows[0] : null;
  if (!sol) throw new Error("Solicitação não encontrada.");
  if (String(sol.STATUS) !== "PENDENTE") throw new Error("Esta solicitação já foi decidida.");

  const email = String(sol.EMAIL || "").trim().toLowerCase();
  const tabelaU = `\`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.USUARIOS_TABLE}\``;

  await conn.beginTransaction();
  try {
    await conn.execute(
      `UPDATE ${tabelaSolicitacoes()} SET
         \`STATUS\` = 'RECUSADO', \`DECIDIDO_POR\` = ?, \`DECIDIDO_EM\` = NOW(), \`OBSERVACAO_DECISAO\` = ?
       WHERE \`ID_SOLICITACAO\` = ?`,
      [adminEmail || null, motivo, id]
    );
    if (email) {
      await conn.execute(`UPDATE ${tabelaU} SET \`ATIVO\` = 0 WHERE \`EMAIL\` = ?`, [email]);
    }
    await conn.commit();
    return { id, status: "RECUSADO" };
  } catch (err) {
    await conn.rollback();
    throw err;
  }
}

async function excluirUsuarioComConn(conn, email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) throw new Error("E-mail inválido.");
  const tabelaU = `\`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.USUARIOS_TABLE}\``;

  await conn.beginTransaction();
  let solRes, usrRes;
  try {
    [solRes] = await conn.execute(`DELETE FROM ${tabelaSolicitacoes()} WHERE \`EMAIL\` = ?`, [e]);
    [usrRes] = await conn.execute(`DELETE FROM ${tabelaU} WHERE \`EMAIL\` = ?`, [e]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  }

  // Reaproveita o "buraco" do AUTO_INCREMENT: deixa o próximo id = MAX(id)+1
  // (ALTER TABLE faz commit implícito, por isso vai depois da transação).
  // Best-effort: se o usuário do banco não tiver privilégio de ALTER, a exclusão
  // (que é o essencial) não deve falhar por causa disso.
  try {
    await resetarAutoIncrementComConn(conn, tabelaSolicitacoes(), "ID_SOLICITACAO");
    await resetarAutoIncrementComConn(conn, tabelaU, "ID_USUARIO");
  } catch (err) {
    console.warn("Não foi possível reajustar o AUTO_INCREMENT após a exclusão:", err && err.message ? err.message : err);
  }

  return {
    email: e,
    solicitacoesRemovidas: (solRes && solRes.affectedRows) || 0,
    usuariosRemovidos: (usrRes && usrRes.affectedRows) || 0
  };
}

async function resetarAutoIncrementComConn(conn, tabela, coluna) {
  const [rows] = await conn.query(`SELECT IFNULL(MAX(\`${coluna}\`), 0) + 1 AS n FROM ${tabela}`);
  const proximo = (rows && rows[0] && Number(rows[0].n)) || 1;
  // 'proximo' é um inteiro calculado pelo banco; seguro para interpolar.
  await conn.query(`ALTER TABLE ${tabela} AUTO_INCREMENT = ${proximo}`);
}

module.exports = { garantirTabelaSolicitacoesAcesso, salvarSolicitacaoAcessoComConn, obterListasAcesso, obterSituacaoAcessoComConn, listarSolicitacoesComConn, definirNivelUsuarioComConn, aprovarSolicitacaoComConn, recusarSolicitacaoComConn, excluirUsuarioComConn };
