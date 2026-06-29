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
// As duas últimas etapas (entrega) não existem na base do ETL — só surgem
// pelo overlay manual (STATUS_MANUAL), registradas pelo escritório.
const STATUS_FUNIL = [
  { db: "FOTO PENDENTE DE ENVIO", label: "Foto Pendente de Envio" },
  { db: "POSSUI FOTO NA IMPACTO", label: "Envio à Gráfica Pendente" },
  { db: "CRACHÁS EM CONFECÇÃO", label: "Crachás em Confecção" },
  { db: "CRACHÁ CONFECCIONADO", label: "Crachá Confeccionado" },
  { db: "ENTREGUE AO ESCRITÓRIO", label: "Entregue ao Escritório" },
  { db: "ENTREGUE AO TRABALHADOR", label: "Entregue ao Trabalhador" }
];
const LABEL_POR_DB = new Map(STATUS_FUNIL.map(s => [s.db.toUpperCase(), s.label]));
const DB_POR_LABEL = new Map(STATUS_FUNIL.map(s => [s.label.toLowerCase(), s.db]));
const PRIMEIRO_STATUS_LABEL = STATUS_FUNIL[0].label;
// "Envio à Gráfica Pendente": status para o qual o trabalhador avança quando
// recebe foto (deixa de estar em "Foto Pendente de Envio").
const SEGUNDO_STATUS_LABEL = STATUS_FUNIL[1] ? STATUS_FUNIL[1].label : null;

function statusLabelDeDb(valorDb) {
  const bruto = limparValorDash(valorDb);
  if (!bruto) return PRIMEIRO_STATUS_LABEL;
  return LABEL_POR_DB.get(bruto.toUpperCase()) || bruto;
}

function statusDbDeLabel(label) {
  const chave = limparValorDash(label).toLowerCase();
  return DB_POR_LABEL.get(chave) || null;
}

// Aceita dd/mm/aaaa ou aaaa-mm-dd e valida o calendário de verdade: rejeita
// dia/mês fora da faixa e datas impossíveis (31/02, 30/02, dia 32, mês 13...).
// Retorna a data em aaaa-mm-dd (formato do MySQL) ou null se inválida.
function normalizarDataParaMysql(valor) {
  const v = limparValorDash(valor);
  if (!v) return null;

  let ano, mes, dia;
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) { ano = +m[1]; mes = +m[2]; dia = +m[3]; }
  else {
    m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    dia = +m[1]; mes = +m[2]; ano = +m[3];
  }

  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  // Round-trip: se algum componente "transbordar" (ex.: 30/02), a data não bate.
  const dt = new Date(Date.UTC(ano, mes - 1, dia));
  if (dt.getUTCFullYear() !== ano || dt.getUTCMonth() !== mes - 1 || dt.getUTCDate() !== dia) return null;

  const pad = n => String(n).padStart(2, "0");
  return `${ano}-${pad(mes)}-${pad(dia)}`;
}

// Colunas adicionais do overlay (além das criadas originalmente). Migradas em
// bases já existentes via ALTER TABLE no boot.
const COLUNAS_EXTRAS = [
  { nome: "DATA_CONFECCAO", ddl: "`DATA_CONFECCAO` DATE NULL" },
  { nome: "DATA_RECEB_ESCRITORIO", ddl: "`DATA_RECEB_ESCRITORIO` DATE NULL" },
  { nome: "DATA_RECEB_TRABALHADOR", ddl: "`DATA_RECEB_TRABALHADOR` DATE NULL" },
  { nome: "DEVOLVIDO", ddl: "`DEVOLVIDO` TINYINT NOT NULL DEFAULT 0" },
  { nome: "SEGUNDA_VIA", ddl: "`SEGUNDA_VIA` TINYINT NOT NULL DEFAULT 0" },
  { nome: "MOTIVO_SEGUNDA_VIA", ddl: "`MOTIVO_SEGUNDA_VIA` VARCHAR(255) NULL" },
  // Identidade usada apenas para trabalhadores importados que NÃO existem na
  // base do ETL (para os que existem, a identidade vem da base).
  { nome: "NOME", ddl: "`NOME` VARCHAR(255) NULL" },
  { nome: "CARGO", ddl: "`CARGO` VARCHAR(255) NULL" },
  { nome: "DSEI", ddl: "`DSEI` VARCHAR(255) NULL" },
  { nome: "SITUACAO_DETALHADA", ddl: "`SITUACAO_DETALHADA` VARCHAR(255) NULL" },
  // Snapshot do estado anterior à última alteração, p/ "desfazer" de 1 nível.
  // PREV_TINHA: NULL = nada a desfazer; 1 = há snapshot; 0 = antes não havia overlay.
  { nome: "PREV_SNAPSHOT", ddl: "`PREV_SNAPSHOT` TEXT NULL" },
  { nome: "PREV_TINHA", ddl: "`PREV_TINHA` TINYINT NULL" },
  { nome: "FOTO_DADOS", ddl: "`FOTO_DADOS` LONGBLOB NULL" },
  { nome: "FOTO_MIME", ddl: "`FOTO_MIME` VARCHAR(50) NULL" }
];

// Garante a tabela-companheira (chamada no boot do servidor) e migra colunas
// novas em bases que já existiam.
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
        \`DATA_CONFECCAO\`   DATE         NULL,
        \`DATA_RECEB_ESCRITORIO\` DATE    NULL,
        \`DATA_RECEB_TRABALHADOR\` DATE   NULL,
        \`DEVOLVIDO\`        TINYINT      NOT NULL DEFAULT 0,
        \`SEGUNDA_VIA\`      TINYINT      NOT NULL DEFAULT 0,
        \`MOTIVO_SEGUNDA_VIA\` VARCHAR(255) NULL,
        \`NOME\`             VARCHAR(255) NULL,
        \`CARGO\`            VARCHAR(255) NULL,
        \`DSEI\`             VARCHAR(255) NULL,
        \`SITUACAO_DETALHADA\` VARCHAR(255) NULL,
        \`OBSERVACAO_CRACHA\` VARCHAR(500) NULL,
        \`PREV_SNAPSHOT\`     TEXT         NULL,
        \`PREV_TINHA\`        TINYINT      NULL,
        \`ATUALIZADO_EM\`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        \`ATUALIZADO_POR\`   VARCHAR(255) NULL,
        PRIMARY KEY (\`ID_CONTROLE\`),
        UNIQUE KEY \`uk_cracha_manual_matricula\` (\`MATRICULA\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Migração: adiciona colunas que faltam em tabelas pré-existentes.
    const [cols] = await conn.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [SCHEMA, DASH_CONFIG.CRACHAS_CONTROLE_TABLE]
    );
    const existentes = new Set(cols.map(c => String(c.COLUMN_NAME).toUpperCase()));
    for (const col of COLUNAS_EXTRAS) {
      if (!existentes.has(col.nome)) {
        await conn.query(`ALTER TABLE ${MANUAL} ADD COLUMN ${col.ddl}`);
      }
    }
  } finally {
    await fecharJdbc(conn);
  }
}

// Colunas do overlay comuns às duas pernas do UNION (datas/indicadores/auditoria).
const COLS_OVERLAY_SELECT = `
    DATE_FORMAT(m.\`DATA_SOLICITACAO\`, '%d/%m/%Y')   AS DATA_SOLICITACAO,
    DATE_FORMAT(m.\`DATA_ENVIO\`, '%d/%m/%Y')         AS DATA_ENVIO,
    DATE_FORMAT(m.\`DATA_CONFECCAO\`, '%d/%m/%Y')     AS DATA_CONFECCAO,
    DATE_FORMAT(m.\`DATA_RECEB_ESCRITORIO\`, '%d/%m/%Y') AS DATA_RECEB_ESCRITORIO,
    DATE_FORMAT(m.\`DATA_RECEB_TRABALHADOR\`, '%d/%m/%Y') AS DATA_RECEB_TRABALHADOR,
    m.\`DEVOLVIDO\`                                   AS DEVOLVIDO,
    m.\`SEGUNDA_VIA\`                                 AS SEGUNDA_VIA,
    m.\`MOTIVO_SEGUNDA_VIA\`                          AS MOTIVO_SEGUNDA_VIA,
    m.\`OBSERVACAO_CRACHA\`                           AS OBSERVACAO_CRACHA,
    m.\`PREV_TINHA\`                                  AS PREV_TINHA,
    DATE_FORMAT(m.\`ATUALIZADO_EM\`, '%d/%m/%Y %H:%i:%s') AS ATUALIZADO_EM,
    m.\`ATUALIZADO_POR\`                              AS ATUALIZADO_POR,
    (m.\`FOTO_DADOS\` IS NOT NULL)                    AS TEM_FOTO
`;

// Monta o SELECT de leitura. É um UNION de duas pernas: (1) trabalhadores da
// base do ETL (identidade da base), e (2) trabalhadores que só existem no
// overlay — importados que ainda não estão na base (identidade do overlay).
// A MATRICULA é única entre as duas pernas (base XOR overlay-only).
function montarSelectCrachas(porMatricula) {
  const filtroBase = porMatricula ? "WHERE b.`MATRICULA` = ?" : "";
  const filtroOverlay = porMatricula ? "AND m.`MATRICULA` = ?" : "";
  return `
    SELECT
      b.\`MATRICULA\`                                 AS MATRICULA,
      b.\`NOME\`                                      AS NOME,
      b.\`CARGO_ATUAL_DESC\`                          AS CARGO,
      b.\`UNIDADE_ORCAMENTARIA_DESC\`                 AS DSEI,
      b.\`SITUACAO_DETALHADA_DESC\`                   AS SITUACAO_DETALHADA,
      b.\`MOTIVO_NAO_CRACHA\`                         AS MOTIVO,
      COALESCE(m.\`STATUS_MANUAL\`, b.\`SITUACAO_CRACHA\`) AS STATUS_EFETIVO,
      m.\`STATUS_MANUAL\`                             AS STATUS_MANUAL,
      0                                               AS IMPORTADO,
      ${COLS_OVERLAY_SELECT}
    FROM ${BASE} b
    LEFT JOIN ${MANUAL} m ON m.\`MATRICULA\` = b.\`MATRICULA\`
    ${filtroBase}
    UNION ALL
    SELECT
      m.\`MATRICULA\`                                 AS MATRICULA,
      m.\`NOME\`                                      AS NOME,
      m.\`CARGO\`                                     AS CARGO,
      m.\`DSEI\`                                      AS DSEI,
      m.\`SITUACAO_DETALHADA\`                        AS SITUACAO_DETALHADA,
      NULL                                            AS MOTIVO,
      m.\`STATUS_MANUAL\`                             AS STATUS_EFETIVO,
      m.\`STATUS_MANUAL\`                             AS STATUS_MANUAL,
      1                                               AS IMPORTADO,
      ${COLS_OVERLAY_SELECT}
    FROM ${MANUAL} m
    WHERE NOT EXISTS (SELECT 1 FROM ${BASE} b WHERE b.\`MATRICULA\` = m.\`MATRICULA\`) ${filtroOverlay}
  `;
}

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
    // Foto enviada pelo usuário (separada do indicador "possuiFoto", derivado do
    // status). fotoUrl só é preenchida quando há imagem armazenada.
    temFoto: Number(row.TEM_FOTO) === 1,
    fotoUrl: Number(row.TEM_FOTO) === 1
      ? `/api/cracha/foto/${encodeURIComponent(limparValorDash(row.MATRICULA))}`
      : "",
    motivo: limparValorDash(row.MOTIVO),
    dataSolicitacao: limparValorDash(row.DATA_SOLICITACAO),
    dataEnvio: limparValorDash(row.DATA_ENVIO),
    dataConfeccao: limparValorDash(row.DATA_CONFECCAO),
    dataRecebEscritorio: limparValorDash(row.DATA_RECEB_ESCRITORIO),
    dataRecebTrabalhador: limparValorDash(row.DATA_RECEB_TRABALHADOR),
    devolvido: Number(row.DEVOLVIDO) === 1,
    segundaVia: Number(row.SEGUNDA_VIA) === 1,
    motivoSegundaVia: limparValorDash(row.MOTIVO_SEGUNDA_VIA),
    importado: Number(row.IMPORTADO) === 1,   // só existe no overlay (não veio do ETL)
    // Há "desfazer" disponível quando existe snapshot anterior; exceto quando
    // desfazer apagaria um importado (antes não havia overlay e ele não está na base).
    podeReverter: (row.PREV_TINHA !== null && row.PREV_TINHA !== undefined)
      && !(Number(row.PREV_TINHA) === 0 && Number(row.IMPORTADO) === 1),
    observacao: limparValorDash(row.OBSERVACAO_CRACHA),
    atualizadoEm: limparValorDash(row.ATUALIZADO_EM),
    atualizadoPor: limparValorDash(row.ATUALIZADO_POR)
  };
}

async function obterRegistroComConn(conn, matricula) {
  const mat = String(matricula);
  const [rows] = await conn.query(
    `SELECT * FROM (${montarSelectCrachas(true)}) t LIMIT 1`,
    [mat, mat]
  );
  return rows && rows[0] ? mapearLinha(rows[0]) : null;
}

// forcar=true ignora o cache e relê do banco (botão "Atualizar": reflete na hora
// mudanças do ETL e da tabela manual feitas fora do app).
async function getCrachaData(forcar = false) {
  const rows = await obterOuCarregarJsonCache(
    DASH_CONFIG.CACHE_CRACHAS_KEY,
    DASH_CONFIG.CACHE_SECONDS,
    async () => {
      const conn = await getMysqlConnection();
      try {
        const [data] = await conn.query(`SELECT * FROM (${montarSelectCrachas(false)}) t ORDER BY t.\`NOME\``);
        return (data || []).map(mapearLinha);
      } finally {
        await fecharJdbc(conn);
      }
    },
    forcar
  );
  return { rows, total: rows.length, statusFunil: STATUS_FUNIL.map(s => s.label) };
}

const paraBooleano01 = v => (v === true || v === 1 || v === "1" || v === "true" ? 1 : 0);

// Booleano estrito para a importação: aceita só Sim/Não (e sinônimos óbvios).
// Vazio -> undefined (não altera). Qualquer outra coisa é erro (não coage em silêncio).
function paraBooleanoImport(v) {
  if (v === true) return true;
  if (v === false) return false;
  let s = limparValorDash(v);
  if (!s) return undefined;
  s = s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/^(sim|s|1|true|verdadeiro|x)$/.test(s)) return true;
  if (/^(nao|n|0|false|falso)$/.test(s)) return false;
  throw new Error('Use "Sim" ou "Não" em Crachá Devolvido / Solicitação 2ª Via.');
}

// Mapeia campos amigáveis -> colunas da companheira (whitelist contra injeção).
const COLUNAS_OVERLAY = {
  statusManual: { coluna: "STATUS_MANUAL", transform: v => statusDbDeLabel(v) },
  dataSolicitacao: { coluna: "DATA_SOLICITACAO", transform: normalizarDataParaMysql },
  dataEnvio: { coluna: "DATA_ENVIO", transform: normalizarDataParaMysql },
  dataConfeccao: { coluna: "DATA_CONFECCAO", transform: normalizarDataParaMysql },
  dataRecebEscritorio: { coluna: "DATA_RECEB_ESCRITORIO", transform: normalizarDataParaMysql },
  dataRecebTrabalhador: { coluna: "DATA_RECEB_TRABALHADOR", transform: normalizarDataParaMysql },
  devolvido: { coluna: "DEVOLVIDO", transform: paraBooleano01 },
  segundaVia: { coluna: "SEGUNDA_VIA", transform: paraBooleano01 },
  motivoSegundaVia: { coluna: "MOTIVO_SEGUNDA_VIA", transform: v => limparValorDash(v) || null },
  observacao: { coluna: "OBSERVACAO_CRACHA", transform: v => limparValorDash(v) || null },
  // Identidade — gravada apenas para trabalhadores importados fora da base.
  nome: { coluna: "NOME", transform: v => limparValorDash(v) || null },
  cargo: { coluna: "CARGO", transform: v => limparValorDash(v) || null },
  dsei: { coluna: "DSEI", transform: v => limparValorDash(v) || null },
  situacaoDetalhada: { coluna: "SITUACAO_DETALHADA", transform: v => limparValorDash(v) || null }
};

// Ao mudar para um destes status, carimba a data correspondente (hoje) se ela
// ainda estiver vazia — datas de marco do funil. Chaveado pelo valor de banco.
const DATA_POR_STATUS = {
  "CRACHÁS EM CONFECÇÃO": "DATA_ENVIO",             // saiu para a gráfica
  "CRACHÁ CONFECCIONADO": "DATA_CONFECCAO",         // gráfica concluiu
  "ENTREGUE AO ESCRITÓRIO": "DATA_RECEB_ESCRITORIO",
  "ENTREGUE AO TRABALHADOR": "DATA_RECEB_TRABALHADOR"
};

function hojeMysql() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Colunas de dados do overlay (sem auditoria/identificador) — usadas no snapshot
// do "desfazer última alteração".
const COLS_SNAPSHOT = [
  "STATUS_MANUAL", "DATA_SOLICITACAO", "DATA_ENVIO", "DATA_CONFECCAO",
  "DATA_RECEB_ESCRITORIO", "DATA_RECEB_TRABALHADOR", "DEVOLVIDO", "SEGUNDA_VIA",
  "MOTIVO_SEGUNDA_VIA", "NOME", "CARGO", "DSEI", "SITUACAO_DETALHADA", "OBSERVACAO_CRACHA"
];

// Lê o estado atual do overlay (antes de uma alteração) para guardar como "anterior".
// Datas vêm como aaaa-mm-dd (texto) para regravar sem ambiguidade.
async function capturarSnapshotAnterior(conn, mat) {
  const [rows] = await conn.query(
    `SELECT
       \`STATUS_MANUAL\`,
       DATE_FORMAT(\`DATA_SOLICITACAO\`, '%Y-%m-%d')       AS DATA_SOLICITACAO,
       DATE_FORMAT(\`DATA_ENVIO\`, '%Y-%m-%d')             AS DATA_ENVIO,
       DATE_FORMAT(\`DATA_CONFECCAO\`, '%Y-%m-%d')         AS DATA_CONFECCAO,
       DATE_FORMAT(\`DATA_RECEB_ESCRITORIO\`, '%Y-%m-%d')  AS DATA_RECEB_ESCRITORIO,
       DATE_FORMAT(\`DATA_RECEB_TRABALHADOR\`, '%Y-%m-%d') AS DATA_RECEB_TRABALHADOR,
       \`DEVOLVIDO\`, \`SEGUNDA_VIA\`, \`MOTIVO_SEGUNDA_VIA\`,
       \`NOME\`, \`CARGO\`, \`DSEI\`, \`SITUACAO_DETALHADA\`, \`OBSERVACAO_CRACHA\`
     FROM ${MANUAL} WHERE \`MATRICULA\` = ? LIMIT 1`,
    [mat]
  );
  if (rows && rows[0]) return { snapshot: JSON.stringify(rows[0]), tinha: 1 };
  return { snapshot: null, tinha: 0 }; // antes não havia overlay
}

// Núcleo do upsert: grava SOMENTE os campos informados em `campos`, preservando
// os demais. NÃO valida existência na base (quem chama decide). Faz o auto-
// carimbo da data de marco ao mudar status.
async function aplicarOverlayComConn(conn, mat, campos, usuario) {
  // Cada entrada: { coluna, valor, coalesce }. `coalesce` mantém o valor atual
  // se já houver (usado no auto-carimbo de data, que não sobrescreve edição manual).
  const entradas = [];
  Object.keys(campos || {}).forEach(chave => {
    const def = COLUNAS_OVERLAY[chave];
    if (!def) return;
    if (chave === "statusManual" && !def.transform(campos[chave])) {
      throw new Error("Status inválido.");
    }
    entradas.push({ coluna: def.coluna, valor: def.transform(campos[chave]), coalesce: false });
  });

  // Auto-carimbo: ao definir o status, preenche a data do marco (se vazia e se o
  // usuário não informou essa data explicitamente neste mesmo salvamento).
  if (campos && campos.statusManual !== undefined) {
    const dbStatus = (statusDbDeLabel(campos.statusManual) || "").toUpperCase();
    const colData = DATA_POR_STATUS[dbStatus];
    if (colData && !entradas.some(e => e.coluna === colData)) {
      entradas.push({ coluna: colData, valor: hojeMysql(), coalesce: true });
    }
  }

  if (!entradas.length) throw new Error("Nada para salvar.");

  // Guarda o estado anterior (para "desfazer última alteração") antes de aplicar.
  const prev = await capturarSnapshotAnterior(conn, mat);

  const colunas = entradas.map(e => `\`${e.coluna}\``);
  const valores = entradas.map(e => e.valor);
  const updates = entradas.map(e => e.coalesce
    ? `\`${e.coluna}\` = COALESCE(\`${e.coluna}\`, VALUES(\`${e.coluna}\`))`
    : `\`${e.coluna}\` = VALUES(\`${e.coluna}\`)`);

  await conn.execute(
    `INSERT INTO ${MANUAL} (\`MATRICULA\`, ${colunas.join(", ")}, \`PREV_SNAPSHOT\`, \`PREV_TINHA\`, \`ATUALIZADO_POR\`)
     VALUES (?, ${colunas.map(() => "?").join(", ")}, ?, ?, ?)
     ON DUPLICATE KEY UPDATE ${updates.join(", ")},
       \`PREV_SNAPSHOT\` = VALUES(\`PREV_SNAPSHOT\`),
       \`PREV_TINHA\` = VALUES(\`PREV_TINHA\`),
       \`ATUALIZADO_POR\` = VALUES(\`ATUALIZADO_POR\`)`,
    [mat, ...valores, prev.snapshot, prev.tinha, usuario || null]
  );

  return await obterRegistroComConn(conn, mat);
}

// Edição manual pela tela: exige que a matrícula exista na base do ETL OU no
// overlay (trabalhador criado via importação). Não cria trabalhador novo aqui.
// A identidade (nome/cargo/DSEI) não é editável por aqui.
async function salvarControleComConn(conn, matricula, campos, usuario) {
  const mat = limparValorDash(matricula);
  if (!mat) throw new Error("Matrícula não informada.");

  const [naBase] = await conn.query(`SELECT 1 FROM ${BASE} WHERE \`MATRICULA\` = ? LIMIT 1`, [mat]);
  if (!naBase.length) {
    const [noOverlay] = await conn.query(`SELECT 1 FROM ${MANUAL} WHERE \`MATRICULA\` = ? LIMIT 1`, [mat]);
    if (!noOverlay.length) throw new Error("Trabalhador não encontrado na base de crachás.");
  }

  // Identidade só pode ser definida via importação (de quem não está na base).
  const { nome, cargo, dsei, situacaoDetalhada, ...resto } = campos || {};
  return await aplicarOverlayComConn(conn, mat, resto, usuario);
}

async function atualizarStatusCrachaComConn(conn, matricula, statusLabel, usuario) {
  if (!statusDbDeLabel(statusLabel)) throw new Error("Status inválido.");
  return await salvarControleComConn(conn, matricula, { statusManual: statusLabel }, usuario);
}

// Atualiza o mesmo status para várias matrículas de uma vez (ação em lote do
// escritório). Valida o status uma única vez; aplica por matrícula e devolve os
// registros atualizados (as que falharem entram em `erros`).
async function atualizarStatusLoteComConn(conn, matriculas, statusLabel, usuario) {
  if (!statusDbDeLabel(statusLabel)) throw new Error("Status inválido.");
  const lista = Array.isArray(matriculas) ? [...new Set(matriculas.map(m => limparValorDash(m)).filter(Boolean))] : [];
  if (!lista.length) throw new Error("Nenhuma matrícula informada.");

  const registros = [];
  const erros = [];
  for (const mat of lista) {
    try {
      registros.push(await salvarControleComConn(conn, mat, { statusManual: statusLabel }, usuario));
    } catch (err) {
      erros.push({ matricula: mat, erro: err && err.message ? err.message : "Falha." });
    }
  }
  return { registros, erros };
}

// Aplica os MESMOS campos (status, datas, devolvido, 2ª via, motivo, observação)
// a várias matrículas de uma vez. Só os campos presentes são alterados; identidade
// (nome/cargo/DSEI) nunca é mexida (salvarControleComConn já a descarta).
const CAMPOS_LOTE_PERMITIDOS = [
  "statusManual", "dataSolicitacao", "dataEnvio", "dataConfeccao", "dataRecebEscritorio",
  "dataRecebTrabalhador", "devolvido", "segundaVia", "motivoSegundaVia", "observacao"
];

async function atualizarLoteComConn(conn, matriculas, campos, usuario) {
  const lista = Array.isArray(matriculas) ? [...new Set(matriculas.map(m => limparValorDash(m)).filter(Boolean))] : [];
  if (!lista.length) throw new Error("Nenhuma matrícula informada.");

  const limpos = {};
  CAMPOS_LOTE_PERMITIDOS.forEach(k => { if (campos && campos[k] !== undefined) limpos[k] = campos[k]; });
  if (!Object.keys(limpos).length) throw new Error("Nenhum campo para aplicar.");
  if (limpos.statusManual !== undefined && !statusDbDeLabel(limpos.statusManual)) throw new Error("Status inválido.");

  const registros = [];
  const erros = [];
  for (const mat of lista) {
    try {
      registros.push(await salvarControleComConn(conn, mat, limpos, usuario));
    } catch (err) {
      erros.push({ matricula: mat, erro: err && err.message ? err.message : "Falha." });
    }
  }
  return { registros, erros };
}

// Importação de planilha. Para cada linha: se a matrícula existe na base do
// ETL, atualiza só os campos de controle informados; se não existe, cria o
// trabalhador no overlay com a identidade da planilha (Nome obrigatório).
// Células em branco não alteram o campo (import é aditivo, nunca apaga).
const CAMPOS_DATA_IMPORT = ["dataSolicitacao", "dataEnvio", "dataConfeccao", "dataRecebEscritorio", "dataRecebTrabalhador"];

async function importarCrachasComConn(conn, linhas, usuario) {
  const lista = Array.isArray(linhas) ? linhas : [];
  if (!lista.length) throw new Error("Planilha sem linhas para importar.");

  let criados = 0, atualizados = 0;
  const erros = [];

  for (let i = 0; i < lista.length; i++) {
    const linha = lista[i] || {};
    const mat = limparValorDash(linha.matricula);
    try {
      if (!mat) throw new Error("Matrícula em branco.");

      const [existe] = await conn.query(`SELECT 1 FROM ${BASE} WHERE \`MATRICULA\` = ? LIMIT 1`, [mat]);
      const novo = !existe.length;

      // Monta apenas os campos preenchidos (branco = não altera).
      const campos = {};
      const setStr = (chave, v) => { const s = limparValorDash(v); if (s) campos[chave] = s; };
      if (limparValorDash(linha.status)) campos.statusManual = linha.status;
      CAMPOS_DATA_IMPORT.forEach(k => setStr(k, linha[k]));
      setStr("motivoSegundaVia", linha.motivoSegundaVia);
      setStr("observacao", linha.observacao);
      const dev = paraBooleanoImport(linha.devolvido);
      if (dev !== undefined) campos.devolvido = dev;
      const seg = paraBooleanoImport(linha.segundaVia);
      if (seg !== undefined) campos.segundaVia = seg;

      // Validação de datas: vazio é ok; formato ou calendário inválido é erro.
      CAMPOS_DATA_IMPORT.forEach(k => {
        if (campos[k] && !normalizarDataParaMysql(campos[k])) {
          throw new Error(`Data inválida (use uma data real no formato dd/mm/aaaa) no campo "${k}".`);
        }
      });

      if (novo) {
        const nome = limparValorDash(linha.nome);
        if (!nome) throw new Error("Trabalhador não está na base; informe o Nome para cadastrá-lo.");
        campos.nome = nome;
        setStr("cargo", linha.cargo);
        setStr("dsei", linha.dsei);
        setStr("situacaoDetalhada", linha.situacaoDetalhada);
      }

      if (!Object.keys(campos).length) throw new Error("Nenhum dado preenchido para atualizar.");

      await aplicarOverlayComConn(conn, mat, campos, usuario);
      if (novo) criados++; else atualizados++;
    } catch (err) {
      erros.push({ linha: i + 2, matricula: mat, erro: err && err.message ? err.message : "Falha." });
    }
  }

  return { criados, atualizados, erros, total: lista.length };
}

// "Reverter": desfaz SOMENTE a última alteração, restaurando o estado anterior
// guardado no snapshot (undo de 1 nível). Não volta ao ETL nem apaga importados.
async function reverterControleComConn(conn, matricula) {
  const mat = limparValorDash(matricula);
  if (!mat) throw new Error("Matrícula não informada.");

  const [rows] = await conn.query(
    `SELECT \`PREV_SNAPSHOT\`, \`PREV_TINHA\` FROM ${MANUAL} WHERE \`MATRICULA\` = ? LIMIT 1`,
    [mat]
  );
  const prevTinha = rows && rows[0] ? rows[0].PREV_TINHA : null;
  if (prevTinha === null || prevTinha === undefined) {
    throw new Error("Não há alteração para desfazer.");
  }

  if (Number(prevTinha) === 0) {
    // Antes da última alteração não havia overlay.
    const [naBase] = await conn.query(`SELECT 1 FROM ${BASE} WHERE \`MATRICULA\` = ? LIMIT 1`, [mat]);
    if (!naBase.length) {
      // Importado: desfazer apagaria o cadastro inteiro — não permitido.
      throw new Error("Não é possível desfazer o cadastro de um trabalhador importado.");
    }
    // Trabalhador da base: remover o overlay volta aos valores do ETL.
    await conn.execute(`DELETE FROM ${MANUAL} WHERE \`MATRICULA\` = ?`, [mat]);
    return await obterRegistroComConn(conn, mat);
  }

  // Há snapshot: restaura os valores anteriores e zera o "desfazer" (1 nível só).
  const snap = JSON.parse(rows[0].PREV_SNAPSHOT || "{}");
  const sets = COLS_SNAPSHOT.map(c => `\`${c}\` = ?`)
    .concat(["`PREV_SNAPSHOT` = NULL", "`PREV_TINHA` = NULL"]);
  const valores = COLS_SNAPSHOT.map(c => (snap[c] === undefined ? null : snap[c]));
  await conn.execute(`UPDATE ${MANUAL} SET ${sets.join(", ")} WHERE \`MATRICULA\` = ?`, [...valores, mat]);
  return await obterRegistroComConn(conn, mat);
}

// ---------- Foto do trabalhador (crachá) ----------
const MIMES_FOTO = new Set(["image/jpeg", "image/png", "image/webp"]);
const FOTO_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

// Decodifica uma data URL base64 de imagem, validando o tipo e o tamanho.
// Retorna { buffer, mime } ou lança erro amigável.
function decodificarImagemDataUrl(dataUrl) {
  const s = typeof dataUrl === "string" ? dataUrl : "";
  const m = s.match(/^data:([a-z0-9/+.-]+);base64,(.+)$/i);
  if (!m) throw new Error("Imagem inválida.");
  const mime = m[1].toLowerCase();
  if (!MIMES_FOTO.has(mime)) throw new Error("Formato não suportado. Use JPG, PNG ou WEBP.");
  const buffer = Buffer.from(m[2], "base64");
  if (!buffer.length) throw new Error("Imagem vazia.");
  if (buffer.length > FOTO_MAX_BYTES) throw new Error("Imagem muito grande (máx. 5 MB).");
  return { buffer, mime };
}

// Garante que a matrícula existe (na base do ETL ou no overlay) — não cria
// trabalhador novo só por causa da foto.
async function exigirMatriculaExistente(conn, mat) {
  const [naBase] = await conn.query(`SELECT 1 FROM ${BASE} WHERE \`MATRICULA\` = ? LIMIT 1`, [mat]);
  if (naBase.length) return;
  const [noOverlay] = await conn.query(`SELECT 1 FROM ${MANUAL} WHERE \`MATRICULA\` = ? LIMIT 1`, [mat]);
  if (!noOverlay.length) throw new Error("Trabalhador não encontrado na base de crachás.");
}

// Salva (insere/atualiza) a foto no overlay manual, sem mexer nos demais campos.
async function salvarFotoCrachaComConn(conn, matricula, buffer, mime, usuario) {
  const mat = limparValorDash(matricula);
  if (!mat) throw new Error("Matrícula não informada.");
  await exigirMatriculaExistente(conn, mat);
  await conn.query(
    `INSERT INTO ${MANUAL} (\`MATRICULA\`, \`FOTO_DADOS\`, \`FOTO_MIME\`, \`ATUALIZADO_POR\`)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       \`FOTO_DADOS\` = VALUES(\`FOTO_DADOS\`),
       \`FOTO_MIME\` = VALUES(\`FOTO_MIME\`),
       \`ATUALIZADO_POR\` = VALUES(\`ATUALIZADO_POR\`)`,
    [mat, buffer, mime, usuario || null]
  );

  const registro = await obterRegistroComConn(conn, mat);
  // Receber a foto faz o trabalhador deixar de estar em "Foto Pendente de Envio":
  // avança o funil para "Envio à Gráfica Pendente" (passa a "possuir foto").
  if (registro && registro.status === PRIMEIRO_STATUS_LABEL && SEGUNDO_STATUS_LABEL) {
    return await aplicarOverlayComConn(conn, mat, { statusManual: SEGUNDO_STATUS_LABEL }, usuario);
  }
  return registro;
}

// Lê os bytes da foto para servir (ou null se não houver).
async function obterFotoCrachaComConn(conn, matricula) {
  const mat = limparValorDash(matricula);
  if (!mat) return null;
  const [rows] = await conn.query(
    `SELECT \`FOTO_DADOS\` AS dados, \`FOTO_MIME\` AS mime FROM ${MANUAL} WHERE \`MATRICULA\` = ? LIMIT 1`,
    [mat]
  );
  const r = rows && rows[0];
  if (!r || !r.dados) return null;
  return { dados: r.dados, mime: r.mime || "image/jpeg" };
}

// Remove a foto (mantém o restante do overlay intacto).
async function removerFotoCrachaComConn(conn, matricula, usuario) {
  const mat = limparValorDash(matricula);
  if (!mat) throw new Error("Matrícula não informada.");
  await conn.query(
    `UPDATE ${MANUAL} SET \`FOTO_DADOS\` = NULL, \`FOTO_MIME\` = NULL, \`ATUALIZADO_POR\` = ? WHERE \`MATRICULA\` = ?`,
    [usuario || null, mat]
  );
  return await obterRegistroComConn(conn, mat);
}

module.exports = {
  getCrachaData,
  salvarControleComConn,
  atualizarStatusCrachaComConn,
  atualizarStatusLoteComConn,
  atualizarLoteComConn,
  importarCrachasComConn,
  reverterControleComConn,
  garantirTabelaCrachasControle,
  decodificarImagemDataUrl,
  salvarFotoCrachaComConn,
  obterFotoCrachaComConn,
  removerFotoCrachaComConn,
  STATUS_FUNIL
};
