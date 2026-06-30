// Domínio: escopo de dados por DSEI/CASAI (multi-tenancy por linha).
//
// Regra de negócio: um usuário pode ter acesso a TODOS os DSEIs (sede/escritório)
// ou ficar restrito a um conjunto de DSEIs (ex.: usuário do DSEI Yanomami só vê o
// próprio DSEI). O escopo é um atributo da PESSOA (vale para todos os módulos),
// não da matriz de permissões por módulo.
//
// Armazenamento:
//   USUARIOS_PAINEL.ACESSO_TODOS_DSEIS  -> 1 = vê tudo (padrão) · 0 = restrito
//   USUARIO_DSEI (EMAIL, ID_DSEI_CASAI) -> DSEIs liberados quando restrito
//
// A chave de escopo é o ID inteiro da unidade (UNIDADE_ORCAMENTARIA_ID nas views,
// = id_dsei_casai). Nunca filtre por texto (o nome do DSEI varia de grafia).
//
// IMPORTANTE: este módulo só MODELA e CONSULTA o escopo. A IMPOSIÇÃO nas queries
// de leitura e nos downloads por registro (helpers escopoSqlDsei/dseiNoEscopo)
// será plugada módulo a módulo numa etapa seguinte.
const { DASH_CONFIG } = require("./config");
const { getMysqlConnection, fecharJdbc } = require("./db");
const { limparValorDash, normalizarChaveDash } = require("./utils");

const SCHEMA = DASH_CONFIG.DB_SCHEMA;
// SAMU Indígena tem um id especial e rótulo próprio (espelha lib/sql.js).
const ID_SAMU = 9610501;

function tabelaUsuarios() {
  return `\`${SCHEMA}\`.\`${DASH_CONFIG.USUARIOS_TABLE}\``;
}

function tabelaUsuarioDsei() {
  return `\`${SCHEMA}\`.\`${DASH_CONFIG.USUARIO_DSEI_TABLE}\``;
}

function normalizarEmail(email) {
  return String(email || "").trim().toLowerCase();
}

// Cria a coluna ACESSO_TODOS_DSEIS (default 1 = preserva o comportamento atual) e
// a tabela USUARIO_DSEI. Idempotente — roda no boot, junto das demais garantir*.
async function garantirEstruturaEscopoDsei() {
  const conn = await getMysqlConnection();
  try {
    const [cols] = await conn.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = 'ACESSO_TODOS_DSEIS'`,
      [SCHEMA, DASH_CONFIG.USUARIOS_TABLE]
    );
    if (!cols.length) {
      // Default 1: todos os usuários existentes continuam "vendo tudo" até um
      // super admin restringir alguém. Migração sem mudança de comportamento.
      await conn.query(`ALTER TABLE ${tabelaUsuarios()} ADD COLUMN \`ACESSO_TODOS_DSEIS\` TINYINT NOT NULL DEFAULT 1`);
    }
    await conn.query(`
      CREATE TABLE IF NOT EXISTS ${tabelaUsuarioDsei()} (
        \`EMAIL\`         VARCHAR(255) NOT NULL,
        \`ID_DSEI_CASAI\` INT NOT NULL,
        \`CRIADO_EM\`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`EMAIL\`, \`ID_DSEI_CASAI\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } finally {
    await fecharJdbc(conn);
  }
}

// Lista de DSEIs/CASAIs disponíveis ({id, nome}) para o seletor de escopo na UI.
// Cacheada (30 min) — a fonte (VW_SAUDE_INDIGENA) muda pouco.
let _dseisCache = { expira: 0, data: null };
async function listarDseisComConn(conn) {
  if (_dseisCache.data && Date.now() < _dseisCache.expira) return _dseisCache.data;
  let rows = [];
  try {
    [rows] = await conn.query(
      `SELECT UNIDADE_ORCAMENTARIA_ID AS id, MAX(UNIDADE_ORCAMENTARIA_DESC) AS nome
         FROM \`${SCHEMA}\`.\`VW_SAUDE_INDIGENA\`
        WHERE UNIDADE_ORCAMENTARIA_ID IS NOT NULL
        GROUP BY UNIDADE_ORCAMENTARIA_ID
        ORDER BY nome`
    );
  } catch (e) {
    rows = [];
  }
  const data = (rows || [])
    .map(r => ({
      id: Number(r.id),
      nome: Number(r.id) === ID_SAMU
        ? "SAMU INDÍGENA"
        : (limparValorDash(r.nome) || `DSEI/CASAI ID ${r.id}`)
    }))
    .filter(d => Number.isInteger(d.id) && d.id > 0);
  _dseisCache = { expira: Date.now() + 30 * 60 * 1000, data };
  return data;
}

// Escopo de UM usuário: { todos: bool, dseis: number[] }. Usuário sem linha (ou
// com ACESSO_TODOS_DSEIS=1) => { todos: true }.
async function obterEscopoUsuarioComConn(conn, email) {
  const e = normalizarEmail(email);
  if (!e) return { todos: true, dseis: [] };
  const [rows] = await conn.query(
    `SELECT \`ACESSO_TODOS_DSEIS\` FROM ${tabelaUsuarios()} WHERE \`EMAIL\` = ? LIMIT 1`,
    [e]
  );
  const todos = !rows || !rows[0] || Number(rows[0].ACESSO_TODOS_DSEIS) === 1;
  if (todos) return { todos: true, dseis: [] };
  const [vincs] = await conn.query(
    `SELECT \`ID_DSEI_CASAI\` FROM ${tabelaUsuarioDsei()} WHERE \`EMAIL\` = ?`,
    [e]
  );
  return { todos: false, dseis: (vincs || []).map(v => Number(v.ID_DSEI_CASAI)) };
}

// Mapa { email: {todos, dseis} } de TODOS os usuários ativos — para a matriz de
// perfis (uma só ida ao banco em vez de uma por usuário).
async function obterEscoposMapaComConn(conn) {
  const [users] = await conn.query(
    `SELECT \`EMAIL\`, \`ACESSO_TODOS_DSEIS\` FROM ${tabelaUsuarios()} WHERE \`ATIVO\` = 1`
  );
  const [vincs] = await conn.query(
    `SELECT \`EMAIL\`, \`ID_DSEI_CASAI\` FROM ${tabelaUsuarioDsei()}`
  );
  const dseisPorEmail = new Map();
  for (const v of vincs || []) {
    const e = normalizarEmail(v.EMAIL);
    if (!dseisPorEmail.has(e)) dseisPorEmail.set(e, []);
    dseisPorEmail.get(e).push(Number(v.ID_DSEI_CASAI));
  }
  const mapa = {};
  for (const u of users || []) {
    const e = normalizarEmail(u.EMAIL);
    if (!e) continue;
    mapa[e] = { todos: Number(u.ACESSO_TODOS_DSEIS) === 1, dseis: dseisPorEmail.get(e) || [] };
  }
  return mapa;
}

// Define o escopo de um usuário. todos=true => acesso total (limpa os vínculos);
// todos=false => restrito aos DSEIs informados (ao menos um). Transacional.
async function definirEscopoUsuarioComConn(conn, email, todos, dseis) {
  const e = normalizarEmail(email);
  if (!e) throw new Error("E-mail inválido.");

  const acessoTodos = (todos === true || todos === 1 || todos === "1" || todos === "true") ? 1 : 0;
  const ids = Array.from(new Set((Array.isArray(dseis) ? dseis : [])
    .map(n => Number(n))
    .filter(n => Number.isInteger(n) && n > 0)));

  if (!acessoTodos && !ids.length) {
    throw new Error("Selecione ao menos um DSEI ou marque \"Acesso a todos os DSEIs\".");
  }

  // Garante que o usuário existe (e está aprovado) antes de gravar o escopo.
  const [uRows] = await conn.query(`SELECT \`ID_USUARIO\` FROM ${tabelaUsuarios()} WHERE \`EMAIL\` = ? LIMIT 1`, [e]);
  if (!uRows || !uRows[0]) throw new Error("Usuário não encontrado.");

  await conn.beginTransaction();
  try {
    await conn.execute(`UPDATE ${tabelaUsuarios()} SET \`ACESSO_TODOS_DSEIS\` = ? WHERE \`EMAIL\` = ?`, [acessoTodos, e]);
    await conn.execute(`DELETE FROM ${tabelaUsuarioDsei()} WHERE \`EMAIL\` = ?`, [e]);
    if (!acessoTodos) {
      for (const id of ids) {
        await conn.execute(
          `INSERT INTO ${tabelaUsuarioDsei()} (\`EMAIL\`, \`ID_DSEI_CASAI\`) VALUES (?, ?)`,
          [e, id]
        );
      }
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  }
  return { email: e, todos: acessoTodos === 1, dseis: acessoTodos ? [] : ids };
}

// ---- Helpers de IMPOSIÇÃO (para plugar nas queries/downloads na próxima etapa) ----

// Fragmento SQL para filtrar uma listagem pelo escopo do usuário. `coluna` precisa
// ser um identificador CONFIÁVEL (literal do código), nunca input do usuário.
//   escopo.todos  -> sem filtro
//   restrito      -> AND <coluna> IN (?, ?, ...)
//   restrito vazio-> AND <coluna> = -1 (não casa nada: usuário sem DSEI não vê nada)
function escopoSqlDsei(escopo, coluna) {
  if (!escopo || escopo.todos) return { sql: "", params: [] };
  const ids = (escopo.dseis || []).map(Number).filter(Number.isFinite);
  if (!ids.length) return { sql: ` AND ${coluna} = -1`, params: [] };
  return { sql: ` AND ${coluna} IN (${ids.map(() => "?").join(",")})`, params: ids };
}

// true se o DSEI informado está no escopo do usuário (para validar downloads por
// registro e escrita). Acesso total sempre passa.
function dseiNoEscopo(escopo, idDsei) {
  if (!escopo || escopo.todos) return true;
  const id = Number(idDsei);
  if (!Number.isFinite(id)) return false;
  return (escopo.dseis || []).map(Number).includes(id);
}

// Conjunto de "chaves de nome" (normalizadas via normalizarChaveDash) dos DSEIs no
// escopo do usuário. Para módulos cujos dados só carregam o NOME do DSEI e não o id
// (ex.: Crachá, view de monitoramento). Retorna null quando o usuário vê tudo
// (sem filtro). Restrito sem DSEI => Set vazio (não casa nada). Os nomes vêm de
// VW_SAUDE_INDIGENA (mesma fonte dos rótulos), casados pelos ids do escopo.
// FILTRO POR NOME É FAIL-CLOSED: se o rótulo não casar, o registro é ocultado
// (preferimos esconder a vazar). Para robustez total, o ideal é expor o id da
// unidade na fonte do módulo e usar dseiNoEscopo.
async function obterChavesNomeEscopoComConn(conn, escopo) {
  if (!escopo || escopo.todos) return null;
  const ids = (escopo.dseis || []).map(Number).filter(Number.isFinite);
  if (!ids.length) return new Set();
  let rows = [];
  try {
    [rows] = await conn.query(
      `SELECT DISTINCT UNIDADE_ORCAMENTARIA_DESC AS nome
         FROM \`${SCHEMA}\`.\`VW_SAUDE_INDIGENA\`
        WHERE UNIDADE_ORCAMENTARIA_ID IN (${ids.map(() => "?").join(",")})`,
      ids
    );
  } catch (e) {
    rows = [];
  }
  const set = new Set();
  for (const r of rows || []) {
    const chave = normalizarChaveDash(limparValorDash(r.nome));
    if (chave) set.add(chave);
  }
  return set;
}

// Filtra um payload "dim-encoded" (Saúde Indígena / Férias) pelo escopo. O loader
// guarda um array paralelo `_dseiIds` (um id de DSEI por linha) usado só aqui; ele
// NUNCA é devolvido ao cliente (o contrato fields/rawFields/rows fica intacto).
// Não muta o objeto cacheado: devolve uma cópia.
function filtrarPayloadPorEscopo(full, escopo) {
  const { _dseiIds, ...resto } = full || {};
  if (!escopo || escopo.todos) return resto;
  const ids = _dseiIds || [];
  const rows = (full.rows || []).filter((_, i) => dseiNoEscopo(escopo, ids[i]));
  return { ...resto, rows, total: rows.length };
}

module.exports = {
  garantirEstruturaEscopoDsei,
  listarDseisComConn,
  obterEscopoUsuarioComConn,
  obterEscoposMapaComConn,
  definirEscopoUsuarioComConn,
  escopoSqlDsei,
  dseiNoEscopo,
  obterChavesNomeEscopoComConn,
  filtrarPayloadPorEscopo
};
