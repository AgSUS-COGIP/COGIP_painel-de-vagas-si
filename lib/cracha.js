// Domínio: Entrega de Crachá.
// A base UGP_CONTROLE_CRACHAS_SI é recriada/truncada por um ETL diário, então
// os dados manuais (status, datas, observação) ficam numa tabela-companheira
// (UGP_CRACHAS_CONTROLE_MANUAL) ligada por MATRICULA — assim sobrevivem às
// cargas. A leitura é base LEFT JOIN companheira (o overlay manual vence).
const { DASH_CONFIG } = require("./config");
const { getMysqlConnection, fecharJdbc, obterOuCarregarJsonCache } = require("./db");
const { limparValorDash } = require("./utils");

const SCHEMA = DASH_CONFIG.DB_SCHEMA;
const BASE = `\`${SCHEMA}\`.\`${DASH_CONFIG.CRACHAS_TABLE}\``;
const MANUAL = `\`${SCHEMA}\`.\`${DASH_CONFIG.CRACHAS_CONTROLE_TABLE}\``;

// Funil de status: valor no banco (db) -> rótulo amigável (label).
// "POSSUI FOTO NA IMPACTO" é renomeado para "Envio à Gráfica Pendente".
const STATUS_FUNIL = [
  { db: "FOTO PENDENTE DE ENVIO", label: "Foto Pendente de Envio" },
  { db: "POSSUI FOTO NA IMPACTO", label: "Envio à Gráfica Pendente" },
  { db: "CRACHÁS EM CONFECÇÃO", label: "Crachás em Confecção" },
  { db: "CRACHÁ CONFECCIONADO", label: "Crachá Confeccionado" }
];
const LABEL_POR_DB = new Map(STATUS_FUNIL.map(s => [s.db.toUpperCase(), s.label]));
const DB_POR_LABEL = new Map(STATUS_FUNIL.map(s => [s.label.toLowerCase(), s.db]));
const PRIMEIRO_STATUS_LABEL = STATUS_FUNIL[0].label;

function statusLabelDeDb(valorDb) {
  const bruto = limparValorDash(valorDb);
  if (!bruto) return PRIMEIRO_STATUS_LABEL;
  return LABEL_POR_DB.get(bruto.toUpperCase()) || bruto;
}

function statusDbDeLabel(label) {
  const chave = limparValorDash(label).toLowerCase();
  return DB_POR_LABEL.get(chave) || null;
}

function normalizarDataParaMysql(valor) {
  const v = limparValorDash(valor);
  if (!v) return null;
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

// Garante a tabela-companheira (chamada no boot do servidor).
async function garantirTabelaCrachasControle() {
  const conn = await getMysqlConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS ${MANUAL} (
        \`ID_CONTROLE\`      BIGINT       NOT NULL AUTO_INCREMENT,
        \`MATRICULA\`        VARCHAR(20)  NOT NULL,
        \`STATUS_MANUAL\`    VARCHAR(255) NULL,
        \`DATA_SOLICITACAO\` DATE         NULL,
        \`DATA_ENVIO\`       DATE         NULL,
        \`OBSERVACAO_CRACHA\` VARCHAR(500) NULL,
        \`ATUALIZADO_EM\`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        \`ATUALIZADO_POR\`   VARCHAR(255) NULL,
        PRIMARY KEY (\`ID_CONTROLE\`),
        UNIQUE KEY \`uk_cracha_manual_matricula\` (\`MATRICULA\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } finally {
    await fecharJdbc(conn);
  }
}

// SELECT base + overlay manual. O id exposto é a MATRICULA (estável entre cargas).
const SELECT_CRACHAS = `
  SELECT
    b.\`MATRICULA\`                                   AS MATRICULA,
    b.\`NOME\`                                        AS NOME,
    b.\`CARGO_ATUAL_DESC\`                            AS CARGO,
    b.\`UNIDADE_ORCAMENTARIA_DESC\`                   AS DSEI,
    b.\`SITUACAO_DETALHADA_DESC\`                     AS SITUACAO_DETALHADA,
    b.\`MOTIVO_NAO_CRACHA\`                           AS MOTIVO,
    COALESCE(m.\`STATUS_MANUAL\`, b.\`SITUACAO_CRACHA\`) AS STATUS_EFETIVO,
    m.\`STATUS_MANUAL\`                               AS STATUS_MANUAL,
    DATE_FORMAT(m.\`DATA_SOLICITACAO\`, '%d/%m/%Y')   AS DATA_SOLICITACAO,
    DATE_FORMAT(m.\`DATA_ENVIO\`, '%d/%m/%Y')         AS DATA_ENVIO,
    m.\`OBSERVACAO_CRACHA\`                           AS OBSERVACAO_CRACHA,
    DATE_FORMAT(m.\`ATUALIZADO_EM\`, '%d/%m/%Y %H:%i:%s') AS ATUALIZADO_EM,
    m.\`ATUALIZADO_POR\`                              AS ATUALIZADO_POR
  FROM ${BASE} b
  LEFT JOIN ${MANUAL} m ON m.\`MATRICULA\` = b.\`MATRICULA\`
`;

function mapearLinha(row) {
  const status = statusLabelDeDb(row.STATUS_EFETIVO);
  return {
    id: limparValorDash(row.MATRICULA),       // chave estável p/ o frontend
    matricula: limparValorDash(row.MATRICULA),
    nome: limparValorDash(row.NOME),
    cargo: limparValorDash(row.CARGO),
    dsei: limparValorDash(row.DSEI),
    situacaoDetalhada: limparValorDash(row.SITUACAO_DETALHADA),
    status,
    statusManual: !!limparValorDash(row.STATUS_MANUAL), // se há override manual
    possuiFoto: status !== PRIMEIRO_STATUS_LABEL,
    motivo: limparValorDash(row.MOTIVO),
    dataSolicitacao: limparValorDash(row.DATA_SOLICITACAO),
    dataEnvio: limparValorDash(row.DATA_ENVIO),
    observacao: limparValorDash(row.OBSERVACAO_CRACHA),
    atualizadoEm: limparValorDash(row.ATUALIZADO_EM),
    atualizadoPor: limparValorDash(row.ATUALIZADO_POR)
  };
}

async function obterRegistroComConn(conn, matricula) {
  const [rows] = await conn.query(`${SELECT_CRACHAS} WHERE b.\`MATRICULA\` = ? LIMIT 1`, [String(matricula)]);
  return rows && rows[0] ? mapearLinha(rows[0]) : null;
}

async function getCrachaData() {
  const rows = await obterOuCarregarJsonCache(
    DASH_CONFIG.CACHE_CRACHAS_KEY,
    DASH_CONFIG.CACHE_SECONDS,
    async () => {
      const conn = await getMysqlConnection();
      try {
        const [data] = await conn.query(`${SELECT_CRACHAS} ORDER BY b.\`NOME\``);
        return (data || []).map(mapearLinha);
      } finally {
        await fecharJdbc(conn);
      }
    }
  );
  return { rows, total: rows.length, statusFunil: STATUS_FUNIL.map(s => s.label) };
}

// Mapeia campos amigáveis -> colunas da companheira (whitelist contra injeção).
const COLUNAS_OVERLAY = {
  statusManual: { coluna: "STATUS_MANUAL", transform: v => statusDbDeLabel(v) },
  dataSolicitacao: { coluna: "DATA_SOLICITACAO", transform: normalizarDataParaMysql },
  dataEnvio: { coluna: "DATA_ENVIO", transform: normalizarDataParaMysql },
  observacao: { coluna: "OBSERVACAO_CRACHA", transform: v => limparValorDash(v) || null }
};

// Upsert de overlay na companheira: grava SOMENTE os campos informados em
// `campos`, preservando os demais (cada ação altera só o que lhe diz respeito).
async function salvarControleComConn(conn, matricula, campos, usuario) {
  const mat = limparValorDash(matricula);
  if (!mat) throw new Error("Matrícula não informada.");

  // Garante que a matrícula existe na base (não se cria trabalhador manualmente).
  const [existe] = await conn.query(`SELECT 1 FROM ${BASE} WHERE \`MATRICULA\` = ? LIMIT 1`, [mat]);
  if (!existe.length) throw new Error("Trabalhador não encontrado na base de crachás.");

  const colunas = [], valores = [], updates = [];
  Object.keys(campos || {}).forEach(chave => {
    const def = COLUNAS_OVERLAY[chave];
    if (!def) return;
    if (chave === "statusManual" && !def.transform(campos[chave])) {
      throw new Error("Status inválido.");
    }
    colunas.push(`\`${def.coluna}\``);
    valores.push(def.transform(campos[chave]));
    updates.push(`\`${def.coluna}\` = VALUES(\`${def.coluna}\`)`);
  });

  if (!colunas.length) throw new Error("Nada para salvar.");

  await conn.execute(
    `INSERT INTO ${MANUAL} (\`MATRICULA\`, ${colunas.join(", ")}, \`ATUALIZADO_POR\`)
     VALUES (?, ${colunas.map(() => "?").join(", ")}, ?)
     ON DUPLICATE KEY UPDATE ${updates.join(", ")}, \`ATUALIZADO_POR\` = VALUES(\`ATUALIZADO_POR\`)`,
    [mat, ...valores, usuario || null]
  );

  return await obterRegistroComConn(conn, mat);
}

async function atualizarStatusCrachaComConn(conn, matricula, statusLabel, usuario) {
  if (!statusDbDeLabel(statusLabel)) throw new Error("Status inválido.");
  return await salvarControleComConn(conn, matricula, { statusManual: statusLabel }, usuario);
}

// "Reverter": remove o overlay manual, voltando o registro aos valores do ETL.
async function reverterControleComConn(conn, matricula) {
  const mat = limparValorDash(matricula);
  if (!mat) throw new Error("Matrícula não informada.");
  await conn.execute(`DELETE FROM ${MANUAL} WHERE \`MATRICULA\` = ?`, [mat]);
  return await obterRegistroComConn(conn, mat);
}

module.exports = {
  getCrachaData,
  salvarControleComConn,
  atualizarStatusCrachaComConn,
  reverterControleComConn,
  garantirTabelaCrachasControle,
  STATUS_FUNIL
};
