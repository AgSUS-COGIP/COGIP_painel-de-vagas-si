// Domínio: Escala de Trabalho — roster de profissionais + escala REAL gravada.
//
// Pipeline igual às demais abas: MySQL -> servidor -> apresentação. A identidade
// (nome, cargo, DSEI) vem da VW_SAUDE_INDIGENA; o polo base, da TB_LOTACAO_OVERRIDE
// (por matrícula). A ESCALA em si (tipo, alternância, dias trabalhados, UBSI, polo
// editado, território) é PERSISTIDA numa tabela-companheira (TB_ESCALA_TRABALHO),
// também por matrícula — NÃO há mais dado mockado. Quem ainda não tem linha nessa
// tabela conta como "sem escala registrada" (semEscala = true) até ser editado.
//
// Desempenho: o conjunto completo (~18k linhas) é lido e montado UMA vez e cacheado
// por CACHE_SECONDS; o escopo por DSEI e as opções de filtro são aplicados em
// memória por request. Após gravar/remover, o servidor limpa o cache (CACHE_ESCALA_KEY).
const { DASH_CONFIG } = require("./config");
const { getMysqlConnection, fecharJdbc, obterOuCarregarJsonCache } = require("./db");
const { limparValorDash } = require("./utils");
const { dseiNoEscopo, erroEscopo } = require("./escopo");

const SCHEMA = DASH_CONFIG.DB_SCHEMA;
const VIEW = `\`${SCHEMA}\`.\`VW_SAUDE_INDIGENA\``;
const OVERRIDE = `\`${SCHEMA}\`.\`${DASH_CONFIG.LOTACAO_OVERRIDE_TABLE}\``;
const ESCALA = `\`${SCHEMA}\`.\`${DASH_CONFIG.ESCALA_TABLE}\``;

// Valores aceitos (validação de escrita — evita gravar lixo vindo do cliente).
const ESCALAS_VALIDAS = new Set(["diarista", "diurno", "noturno", "territorio"]);
const ALTERNANCIAS_VALIDAS = new Set(["par", "impar"]);

// ---- Serialização dos dias trabalhados (CSV de números 1..31) ----
function serializarDias(dias) {
  if (!Array.isArray(dias)) return null;
  const nums = [...new Set(dias.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 31))].sort((a, b) => a - b);
  return nums.length ? nums.join(",") : null;
}
function parsearDias(csv) {
  const s = limparValorDash(csv);
  if (!s) return null;
  const nums = String(s).split(",").map(n => parseInt(n, 10)).filter(n => Number.isInteger(n) && n >= 1 && n <= 31);
  return nums.length ? nums : null;
}

// Garante a tabela-companheira da escala (chamada no boot do servidor).
async function garantirTabelaEscala() {
  const conn = await getMysqlConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS ${ESCALA} (
        \`ID_ESCALA\`       BIGINT       NOT NULL AUTO_INCREMENT,
        \`MATRICULA\`       VARCHAR(20)  NOT NULL,
        \`ESCALA\`          VARCHAR(20)  NULL,
        \`ALTERNANCIA\`     VARCHAR(10)  NULL,
        \`DIAS_MARCADOS\`   VARCHAR(200) NULL,
        \`UBSI\`            VARCHAR(255) NULL,
        \`POLO\`            VARCHAR(255) NULL,
        \`TIPO_TERRITORIO\` VARCHAR(30)  NULL,
        \`IDA\`             VARCHAR(20)  NULL,
        \`RETORNO\`         VARCHAR(20)  NULL,
        \`ATUALIZADO_EM\`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        \`ATUALIZADO_POR\`  VARCHAR(255) NULL,
        PRIMARY KEY (\`ID_ESCALA\`),
        UNIQUE KEY \`uk_escala_matricula\` (\`MATRICULA\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } finally {
    await fecharJdbc(conn);
  }
}

// Monta a linha do roster a partir do JOIN identidade + polo base + escala real.
function montarRow(r) {
  const escala = limparValorDash(r.escala) || null;
  const poloOverride = limparValorDash(r.poloOverride);
  const poloBase = limparValorDash(r.poloBase);
  return {
    id: String(limparValorDash(r.matricula) || ""),
    matricula: String(limparValorDash(r.matricula) || ""),
    nome: limparValorDash(r.nome) || "",
    cargo: limparValorDash(r.cargo) || "",
    dsei: limparValorDash(r.dsei) || "",
    situacao: limparValorDash(r.situacao) || "",
    // Polo efetivo: o editado na escala tem prioridade sobre o polo base do override.
    polo: poloOverride || poloBase || "",
    ubsi: limparValorDash(r.ubsi) || "",
    escala,
    alternancia: limparValorDash(r.alternancia) || null,
    diasMarcados: parsearDias(r.diasMarcados),
    tipoTerritorio: limparValorDash(r.tipoTerritorio) || null,
    ida: limparValorDash(r.ida) || null,
    retorno: limparValorDash(r.retorno) || null,
    // Sem linha de escala (ou escala nula) = ainda não inserido no controle.
    semEscala: !escala
  };
}

// Lê o roster completo (sem escopo) e cacheia. TODOS os ativos (sem
// DATA_DESLIGAMENTO), inclusive quem ainda NÃO tem lotação nem escala — por isso a
// view é a base e as tabelas por matrícula entram por LEFT JOIN. Uma linha por matrícula.
async function carregarEscalaFull() {
  const conn = await getMysqlConnection();
  try {
    const [rows] = await conn.query(
      `SELECT
         v.\`MATRICULA\`                        AS matricula,
         MAX(v.\`NOME\`)                        AS nome,
         MAX(v.\`CARGO_ATUAL_DESC\`)            AS cargo,
         MAX(v.\`UNIDADE_ORCAMENTARIA_DESC\`)   AS dsei,
         MAX(v.\`UNIDADE_ORCAMENTARIA_ID\`)     AS idDsei,
         MAX(v.\`SITUACAO_DETALHADA_DESC\`)     AS situacao,
         MAX(o.\`LOTACAO\`)                     AS poloBase,
         MAX(e.\`ESCALA\`)                      AS escala,
         MAX(e.\`ALTERNANCIA\`)                 AS alternancia,
         MAX(e.\`DIAS_MARCADOS\`)               AS diasMarcados,
         MAX(e.\`UBSI\`)                        AS ubsi,
         MAX(e.\`POLO\`)                        AS poloOverride,
         MAX(e.\`TIPO_TERRITORIO\`)             AS tipoTerritorio,
         MAX(e.\`IDA\`)                         AS ida,
         MAX(e.\`RETORNO\`)                     AS retorno
       FROM ${VIEW} v
       LEFT JOIN ${OVERRIDE} o ON o.\`MATRICULA\` = v.\`MATRICULA\`
       LEFT JOIN ${ESCALA}   e ON e.\`MATRICULA\` = v.\`MATRICULA\`
       WHERE v.\`DATA_DESLIGAMENTO\` IS NULL
       GROUP BY v.\`MATRICULA\`
       ORDER BY nome`
    );

    const profissionais = [];
    const _dseiIds = []; // array paralelo (id do DSEI por linha) — só para o escopo
    for (const r of rows || []) {
      const row = montarRow(r);
      if (!row.matricula || !row.nome) continue;
      profissionais.push(row);
      const idn = Number(limparValorDash(r.idDsei));
      _dseiIds.push(Number.isFinite(idn) ? idn : null);
    }
    return { atualizadoEm: new Date().toISOString(), profissionais, _dseiIds };
  } finally {
    await fecharJdbc(conn);
  }
}

// Opções dos filtros (DSEI, cargo, polo, situação + o mapa polo-por-DSEI para a
// cascata), calculadas sobre o conjunto já filtrado por escopo.
function montarOpcoes(rows) {
  const dseiSet = new Set();
  const cargoSet = new Set();
  const poloSet = new Set();
  const situacaoSet = new Set();
  const porDsei = {};
  for (const p of rows) {
    if (p.dsei) dseiSet.add(p.dsei);
    if (p.cargo) cargoSet.add(p.cargo);
    if (p.situacao) situacaoSet.add(p.situacao);
    if (p.polo) {
      poloSet.add(p.polo);
      if (p.dsei) {
        if (!porDsei[p.dsei]) porDsei[p.dsei] = new Set();
        porDsei[p.dsei].add(p.polo);
      }
    }
  }
  const ord = (a, b) => a.localeCompare(b, "pt-BR");
  const polosPorDsei = {};
  Object.keys(porDsei).forEach(k => { polosPorDsei[k] = [...porDsei[k]].sort(ord); });
  return {
    filtros: {
      dseis: [...dseiSet].sort(ord),
      cargos: [...cargoSet].sort(ord),
      polos: [...poloSet].sort(ord),
      situacoes: [...situacaoSet].sort(ord)
    },
    polosPorDsei
  };
}

async function getEscalaData(escopo, forcar) {
  const full = await obterOuCarregarJsonCache(
    DASH_CONFIG.CACHE_ESCALA_KEY,
    DASH_CONFIG.CACHE_SECONDS,
    carregarEscalaFull,
    !!forcar
  );

  let profissionais = full.profissionais;
  if (escopo && !escopo.todos) {
    const ids = full._dseiIds || [];
    profissionais = profissionais.filter((_, i) => dseiNoEscopo(escopo, ids[i]));
  }

  const opcoes = montarOpcoes(profissionais);
  return {
    atualizadoEm: full.atualizadoEm,
    total: profissionais.length,
    profissionais,
    ...opcoes
  };
}

// ---- Escrita (grava a escala real por matrícula) ----

// Resolve o DSEI (UNIDADE_ORCAMENTARIA_ID) de uma matrícula pela view (fonte da
// identidade/escopo). Fail-closed: sem vínculo => null (bloqueia o usuário restrito).
async function dseiDaMatriculaComConn(conn, matricula) {
  const mat = limparValorDash(matricula);
  if (!mat) return null;
  const [rows] = await conn.query(
    `SELECT MAX(\`UNIDADE_ORCAMENTARIA_ID\`) AS id FROM ${VIEW} WHERE \`MATRICULA\` = ?`,
    [mat]
  );
  const v = rows && rows[0] ? rows[0].id : null;
  return (v != null && v !== "") ? Number(v) : null;
}

// Lança 403 se a matrícula não estiver no escopo de DSEI do usuário.
async function garantirEscopoMatriculaEscalaComConn(conn, matricula, escopo) {
  if (!escopo || escopo.todos) return;
  const id = await dseiDaMatriculaComConn(conn, matricula);
  if (!dseiNoEscopo(escopo, id)) throw erroEscopo("Profissional fora do seu escopo de DSEI.");
}

// Normaliza/valida o corpo vindo do cliente para as colunas da escala.
function normalizarCampos(body) {
  const b = body || {};
  const escala = ESCALAS_VALIDAS.has(b.escala) ? b.escala : null;
  const territorio = escala === "territorio";
  const plantonista = escala === "diurno" || escala === "noturno";
  return {
    ESCALA: escala,
    ALTERNANCIA: plantonista && ALTERNANCIAS_VALIDAS.has(b.alternancia) ? b.alternancia : null,
    // Dias marcados só fazem sentido para escala diária (diarista/plantonista).
    DIAS_MARCADOS: (escala && !territorio) ? serializarDias(b.diasMarcados) : null,
    UBSI: (limparValorDash(b.ubsi) || "").slice(0, 255) || null,
    POLO: (limparValorDash(b.polo) || "").slice(0, 255) || null,
    TIPO_TERRITORIO: territorio ? ((limparValorDash(b.tipoTerritorio) || "").slice(0, 30) || null) : null,
    IDA: territorio ? ((limparValorDash(b.ida) || "").slice(0, 20) || null) : null,
    RETORNO: territorio ? ((limparValorDash(b.retorno) || "").slice(0, 20) || null) : null
  };
}

// Upsert da escala de uma matrícula (a matrícula precisa existir na view = ativo).
async function salvarEscalaComConn(conn, matricula, body, usuario) {
  const mat = limparValorDash(matricula);
  if (!mat) throw new Error("Matrícula não informada.");
  const id = await dseiDaMatriculaComConn(conn, mat);
  if (id === null) {
    const [existe] = await conn.query(`SELECT 1 FROM ${VIEW} WHERE \`MATRICULA\` = ? LIMIT 1`, [mat]);
    if (!existe.length) throw new Error("Profissional não encontrado na base de ativos.");
  }
  const c = normalizarCampos(body);
  await conn.execute(
    `INSERT INTO ${ESCALA}
       (\`MATRICULA\`, \`ESCALA\`, \`ALTERNANCIA\`, \`DIAS_MARCADOS\`, \`UBSI\`, \`POLO\`, \`TIPO_TERRITORIO\`, \`IDA\`, \`RETORNO\`, \`ATUALIZADO_POR\`)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       \`ESCALA\` = VALUES(\`ESCALA\`),
       \`ALTERNANCIA\` = VALUES(\`ALTERNANCIA\`),
       \`DIAS_MARCADOS\` = VALUES(\`DIAS_MARCADOS\`),
       \`UBSI\` = VALUES(\`UBSI\`),
       \`POLO\` = VALUES(\`POLO\`),
       \`TIPO_TERRITORIO\` = VALUES(\`TIPO_TERRITORIO\`),
       \`IDA\` = VALUES(\`IDA\`),
       \`RETORNO\` = VALUES(\`RETORNO\`),
       \`ATUALIZADO_POR\` = VALUES(\`ATUALIZADO_POR\`)`,
    [mat, c.ESCALA, c.ALTERNANCIA, c.DIAS_MARCADOS, c.UBSI, c.POLO, c.TIPO_TERRITORIO, c.IDA, c.RETORNO, usuario || null]
  );
  return { matricula: mat, ...c };
}

// Remove APENAS a escala (UBSI, escala, alternância, dias/território), preservando
// a identidade e a situação (que vêm da view). Mantém o polo editado. Se não havia
// linha, não faz nada. Não apaga a linha (guarda o polo/ata de auditoria).
async function removerEscalaComConn(conn, matricula, usuario) {
  const mat = limparValorDash(matricula);
  if (!mat) throw new Error("Matrícula não informada.");
  await conn.execute(
    `UPDATE ${ESCALA}
        SET \`ESCALA\` = NULL, \`ALTERNANCIA\` = NULL, \`DIAS_MARCADOS\` = NULL, \`UBSI\` = NULL,
            \`TIPO_TERRITORIO\` = NULL, \`IDA\` = NULL, \`RETORNO\` = NULL, \`ATUALIZADO_POR\` = ?
      WHERE \`MATRICULA\` = ?`,
    [usuario || null, mat]
  );
  return { matricula: mat };
}

module.exports = {
  getEscalaData,
  garantirTabelaEscala,
  salvarEscalaComConn,
  removerEscalaComConn,
  garantirEscopoMatriculaEscalaComConn
};
