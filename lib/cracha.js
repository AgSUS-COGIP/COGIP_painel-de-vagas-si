// Domínio: Entrega de Crachá.
// DUAS FONTES, papéis separados:
//   - Roster/identidade: VW_SAUDE_INDIGENA (trabalhador consolidado) — nome, CPF,
//     cargo, DSEI (nome e id p/ escopo), situação funcional e admissão. É a fonte
//     da lista da aba: trabalhador novo no consolidado aparece automaticamente.
//   - Controle: UGP_CRACHAS_CONTROLE_MANUAL — SÓ os inputs do usuário (status do
//     funil, datas de marco, devolução, 2ª via, observação, foto, link da foto,
//     snapshot de desfazer, auditoria). A linha só nasce quando o usuário
//     registra algo; identidade NÃO é mais gravada aqui (as colunas NOME/CARGO/
//     DSEI/SITUACAO_DETALHADA/DATA_ADMISSAO ficaram legadas — ver
//     scripts/ddl-cracha-drop-identidade.sql).
// Escritas exigem que a matrícula exista no consolidado (não se cadastra
// trabalhador por aqui). Linhas de controle órfãs (matrícula fora do
// consolidado) ficam no banco mas não aparecem na aba.
const { DASH_CONFIG } = require("./config");
const { getMysqlConnection, fecharJdbc, obterOuCarregarJsonCache, atualizarJsonCache, limparJsonCache } = require("./db");
const { limparValorDash, normalizarChaveDash } = require("./utils");
const { obterChavesNomeEscopoComConn, dseiNoEscopo, erroEscopo } = require("./escopo");

const SCHEMA = DASH_CONFIG.DB_SCHEMA;
const MANUAL = `\`${SCHEMA}\`.\`${DASH_CONFIG.CRACHAS_CONTROLE_TABLE}\``;
// Vista do trabalhador consolidado (Saúde Indígena, ~20k linhas) — mesma fonte
// das abas Saúde Indígena/Férias/Escala. Matrícula PODE repetir (deduplicamos
// mantendo a 1ª linha, como em lib/ferias.js).
const CONSOLIDADO = `\`${SCHEMA}\`.\`VW_SAUDE_INDIGENA\``;

// Funil de status: valor no banco (db) -> rótulo amigável (label).
// "POSSUI FOTO NA IMPACTO" é renomeado para "Envio à Gráfica Pendente".
// As duas últimas etapas (entrega) são registradas pelo escritório (STATUS_MANUAL).
// "Foto Reprovada" é um status manual: a foto enviada foi rejeitada e precisa
// ser reenviada. Fica logo após "Foto Pendente de Envio" no funil e, assim como
// ela, é tratado como "ainda sem foto válida".
const STATUS_FUNIL = [
  { db: "FOTO PENDENTE DE ENVIO", label: "Foto Pendente de Envio" },
  { db: "FOTO REPROVADA", label: "Foto Reprovada" },
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
// recebe uma foto válida (deixa de estar sem foto).
const STATUS_ENVIO_GRAFICA_LABEL = "Envio à Gráfica Pendente";
// Status que representam "ainda não há foto válida" (não contam como possui
// foto e, ao receber uma foto, avançam para "Envio à Gráfica Pendente").
const STATUS_SEM_FOTO = new Set([PRIMEIRO_STATUS_LABEL, "Foto Reprovada"]);

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

function hojeMysql() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Colunas adicionais do overlay (além das criadas originalmente). Migradas em
// bases já existentes via ALTER TABLE no boot. As antigas colunas de identidade
// (NOME, CARGO, DSEI, SITUACAO_DETALHADA, DATA_ADMISSAO) NÃO entram mais aqui:
// a identidade vem sempre do consolidado (VW_SAUDE_INDIGENA). Em bases antigas
// elas ficam intocadas até rodar scripts/ddl-cracha-drop-identidade.sql.
const COLUNAS_EXTRAS = [
  { nome: "DATA_CONFECCAO", ddl: "`DATA_CONFECCAO` DATE NULL" },
  { nome: "DATA_RECEB_ESCRITORIO", ddl: "`DATA_RECEB_ESCRITORIO` DATE NULL" },
  { nome: "DATA_RECEB_TRABALHADOR", ddl: "`DATA_RECEB_TRABALHADOR` DATE NULL" },
  { nome: "DEVOLVIDO", ddl: "`DEVOLVIDO` TINYINT NOT NULL DEFAULT 0" },
  { nome: "SEGUNDA_VIA", ddl: "`SEGUNDA_VIA` TINYINT NOT NULL DEFAULT 0" },
  { nome: "MOTIVO_SEGUNDA_VIA", ddl: "`MOTIVO_SEGUNDA_VIA` VARCHAR(255) NULL" },
  // Link da foto (override manual).
  { nome: "LINK_FOTOS", ddl: "`LINK_FOTOS` VARCHAR(1000) NULL" },
  { nome: "MOTIVO_NAO_CRACHA", ddl: "`MOTIVO_NAO_CRACHA` VARCHAR(255) NULL" },
  // Snapshot do estado anterior à última alteração, p/ "desfazer" de 1 nível.
  // PREV_TINHA: NULL = nada a desfazer; 1 = há snapshot; 0 = antes não havia overlay.
  { nome: "PREV_SNAPSHOT", ddl: "`PREV_SNAPSHOT` TEXT NULL" },
  { nome: "PREV_TINHA", ddl: "`PREV_TINHA` TINYINT NULL" },
  { nome: "FOTO_DADOS", ddl: "`FOTO_DADOS` LONGBLOB NULL" },
  { nome: "FOTO_MIME", ddl: "`FOTO_MIME` VARCHAR(50) NULL" }
];

// Garante a tabela de controle (chamada no boot do servidor) e migra colunas
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
        \`OBSERVACAO_CRACHA\` VARCHAR(500) NULL,
        \`LINK_FOTOS\`        VARCHAR(1000) NULL,
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

// ---- Consolidado (identidade/roster) ----
// Colunas de identidade lidas do consolidado (contrato compartilhado entre o
// roster completo e o lookup por matrícula). Aliases = nomes que mapearLinha lê.
const SELECT_IDENT = `
      v.\`MATRICULA\`                                  AS MATRICULA,
      v.\`NOME\`                                       AS NOME,
      v.\`CPF\`                                        AS CPF,
      v.\`CARGO_ATUAL_DESC\`                           AS CARGO,
      v.\`UNIDADE_ORCAMENTARIA_DESC\`                  AS DSEI,
      v.\`UNIDADE_ORCAMENTARIA_ID\`                    AS ID_DSEI_CASAI,
      v.\`SITUACAO_DETALHADA_DESC\`                    AS SITUACAO_DETALHADA,
      DATE_FORMAT(v.\`DATA_ADMISSAO\`, '%d/%m/%Y')     AS DATA_ADMISSAO`;

// Colunas de CONTROLE lidas da tabela manual (contrato que o mapearLinha lê).
// Em LEFT JOIN sem linha de controle, tudo sai NULL (funil no estado inicial).
const SELECT_CONTROLE = `
      m.\`LINK_FOTOS\`                                 AS LINK_FOTOS,
      m.\`MOTIVO_NAO_CRACHA\`                          AS MOTIVO,
      m.\`STATUS_MANUAL\`                              AS STATUS_EFETIVO,
      m.\`STATUS_MANUAL\`                              AS STATUS_MANUAL,
      DATE_FORMAT(m.\`DATA_SOLICITACAO\`, '%d/%m/%Y')   AS DATA_SOLICITACAO,
      DATE_FORMAT(m.\`DATA_ENVIO\`, '%d/%m/%Y')         AS DATA_ENVIO,
      DATE_FORMAT(m.\`DATA_CONFECCAO\`, '%d/%m/%Y')     AS DATA_CONFECCAO,
      DATE_FORMAT(m.\`DATA_RECEB_ESCRITORIO\`, '%d/%m/%Y') AS DATA_RECEB_ESCRITORIO,
      DATE_FORMAT(m.\`DATA_RECEB_TRABALHADOR\`, '%d/%m/%Y') AS DATA_RECEB_TRABALHADOR,
      m.\`DEVOLVIDO\`                                  AS DEVOLVIDO,
      m.\`SEGUNDA_VIA\`                                AS SEGUNDA_VIA,
      m.\`MOTIVO_SEGUNDA_VIA\`                         AS MOTIVO_SEGUNDA_VIA,
      m.\`OBSERVACAO_CRACHA\`                          AS OBSERVACAO_CRACHA,
      m.\`PREV_TINHA\`                                 AS PREV_TINHA,
      DATE_FORMAT(m.\`ATUALIZADO_EM\`, '%d/%m/%Y %H:%i:%s') AS ATUALIZADO_EM,
      m.\`ATUALIZADO_POR\`                             AS ATUALIZADO_POR,
      (m.\`FOTO_DADOS\` IS NOT NULL)                   AS TEM_FOTO
`;

// Chunks das operações em lote (leitura IN (...) e INSERT multi-linha).
const IMPORT_READ_CHUNK = 1000;   // matrículas por SELECT ... IN (...)
const IMPORT_INSERT_CHUNK = 500;  // linhas por INSERT multi-linha

// Mapa matrícula -> linha de identidade do consolidado (em lote, por chunks).
// A view pode repetir a matrícula: mantém a 1ª linha (mesma regra do roster).
async function infoTrabalhadorComConn(conn, matriculas) {
  const mats = [...new Set((matriculas || []).map(m => limparValorDash(m)).filter(Boolean))];
  const mapa = new Map();
  if (!mats.length) return mapa;
  for (let i = 0; i < mats.length; i += IMPORT_READ_CHUNK) {
    const chunk = mats.slice(i, i + IMPORT_READ_CHUNK);
    const ph = chunk.map(() => "?").join(", ");
    const [rows] = await conn.query(
      `SELECT ${SELECT_IDENT} FROM ${CONSOLIDADO} v WHERE v.\`MATRICULA\` IN (${ph})`,
      chunk
    );
    for (const r of rows || []) {
      const k = limparValorDash(r.MATRICULA);
      if (k && !mapa.has(k)) mapa.set(k, r);
    }
  }
  return mapa;
}

// Guard de escrita: a matrícula precisa existir no trabalhador consolidado.
// Não se cadastra trabalhador pela aba de crachás.
async function garantirNoConsolidadoComConn(conn, matricula) {
  const mat = limparValorDash(matricula);
  if (!mat) { const e = new Error("Matrícula não informada."); e.status = 400; throw e; }
  const mapa = await infoTrabalhadorComConn(conn, [mat]);
  if (!mapa.has(mat)) {
    const e = new Error("Matrícula não encontrada no Trabalhador Consolidado.");
    e.status = 404;
    throw e;
  }
}

function mapearLinha(row) {
  const status = statusLabelDeDb(row.STATUS_EFETIVO);
  return {
    id: limparValorDash(row.MATRICULA),       // chave estável p/ o frontend
    matricula: limparValorDash(row.MATRICULA),
    nome: limparValorDash(row.NOME),
    cpf: limparValorDash(row.CPF),
    cargo: limparValorDash(row.CARGO),
    dsei: limparValorDash(row.DSEI),
    idDseiCasai: limparValorDash(row.ID_DSEI_CASAI), // p/ filtro de escopo por id

    situacaoDetalhada: limparValorDash(row.SITUACAO_DETALHADA),
    linkFotos: limparValorDash(row.LINK_FOTOS), // URL da foto na base (coluna LINK_FOTOS)
    dataAdmissao: limparValorDash(row.DATA_ADMISSAO),
    status,
    statusManual: !!limparValorDash(row.STATUS_MANUAL), // se há override manual
    possuiFoto: !STATUS_SEM_FOTO.has(status),
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
    // Identidade agora vem do consolidado; "importado" ficou sem função (mantido
    // por compatibilidade com o frontend).
    importado: false,
    // Há "desfazer" quando existe um snapshot a restaurar (PREV_TINHA = 1).
    // PREV_TINHA = 0 é o primeiro registro de controle da matrícula — não há
    // estado anterior a restaurar.
    podeReverter: (row.PREV_TINHA !== null && row.PREV_TINHA !== undefined)
      && Number(row.PREV_TINHA) !== 0,
    observacao: limparValorDash(row.OBSERVACAO_CRACHA),
    atualizadoEm: limparValorDash(row.ATUALIZADO_EM),
    atualizadoPor: limparValorDash(row.ATUALIZADO_POR)
  };
}

// Mescla uma linha de controle (pode ser null — trabalhador ainda sem registro)
// com a identidade do consolidado, no formato de row que o mapearLinha lê.
function mesclarRow(ident, ctrlRow, matricula) {
  return {
    ...(ctrlRow || {}),
    MATRICULA: (ident && ident.MATRICULA != null) ? ident.MATRICULA : String(matricula),
    NOME: ident ? ident.NOME : null,
    CPF: ident ? ident.CPF : null,
    CARGO: ident ? ident.CARGO : null,
    DSEI: ident ? ident.DSEI : null,
    ID_DSEI_CASAI: ident ? ident.ID_DSEI_CASAI : null,
    SITUACAO_DETALHADA: ident ? ident.SITUACAO_DETALHADA : null,
    DATA_ADMISSAO: ident ? ident.DATA_ADMISSAO : null
  };
}

// ---- Guardas de escopo por DSEI (escrita/download por matrícula) ----
// Lança 403 se a matrícula não estiver no escopo do usuário. O id do DSEI vem
// do consolidado; matrícula sem vínculo => id nulo (fail-closed p/ o restrito).
async function garantirEscopoMatriculaComConn(conn, matricula, escopo) {
  if (!escopo || escopo.todos) return;
  const info = (await infoTrabalhadorComConn(conn, [matricula])).get(limparValorDash(matricula));
  const id = info && info.ID_DSEI_CASAI != null && info.ID_DSEI_CASAI !== "" ? Number(info.ID_DSEI_CASAI) : null;
  if (!dseiNoEscopo(escopo, id)) throw erroEscopo("Trabalhador fora do seu escopo de DSEI.");
}

// Lança 403 se QUALQUER matrícula do lote estiver fora do escopo. Resolve os
// DSEIs numa única ida ao banco (IN em chunks), não 1 query por matrícula.
async function garantirEscopoMatriculasComConn(conn, matriculas, escopo) {
  if (!escopo || escopo.todos) return;
  const lista = (Array.isArray(matriculas) ? matriculas : []).map(m => limparValorDash(m)).filter(Boolean);
  if (!lista.length) return;
  const mapa = await infoTrabalhadorComConn(conn, lista);
  for (const m of lista) {
    const info = mapa.get(m);
    const id = info && info.ID_DSEI_CASAI != null && info.ID_DSEI_CASAI !== "" ? Number(info.ID_DSEI_CASAI) : null;
    if (!dseiNoEscopo(escopo, id)) throw erroEscopo("Trabalhador fora do seu escopo de DSEI.");
  }
}

// Registro individual (retorno das escritas): controle + identidade do
// consolidado, mesclados por matrícula.
async function obterRegistroComConn(conn, matricula) {
  const mat = limparValorDash(matricula);
  const [ctrl] = await conn.query(
    `SELECT m.\`MATRICULA\` AS MATRICULA, ${SELECT_CONTROLE} FROM ${MANUAL} m WHERE m.\`MATRICULA\` = ? LIMIT 1`,
    [mat]
  );
  const ident = (await infoTrabalhadorComConn(conn, [mat])).get(mat) || null;
  const ctrlRow = ctrl && ctrl[0] ? ctrl[0] : null;
  if (!ctrlRow && !ident) return null;
  return mapearLinha(mesclarRow(ident, ctrlRow, mat));
}

// Vários registros de uma vez (retorno das ações em lote), em chunks.
async function obterRegistrosComConn(conn, matriculas) {
  const mats = [...new Set((matriculas || []).map(m => limparValorDash(m)).filter(Boolean))];
  if (!mats.length) return [];
  const identMapa = await infoTrabalhadorComConn(conn, mats);
  const out = [];
  for (let i = 0; i < mats.length; i += IMPORT_READ_CHUNK) {
    const chunk = mats.slice(i, i + IMPORT_READ_CHUNK);
    const ph = chunk.map(() => "?").join(", ");
    const [rows] = await conn.query(
      `SELECT m.\`MATRICULA\` AS MATRICULA, ${SELECT_CONTROLE} FROM ${MANUAL} m WHERE m.\`MATRICULA\` IN (${ph})`,
      chunk
    );
    const ctrl = new Map((rows || []).map(row => [limparValorDash(row.MATRICULA), row]));
    for (const mat of chunk) {
      const ident = identMapa.get(mat) || null;
      const ctrlRow = ctrl.get(mat) || null;
      if (ident || ctrlRow) out.push(mapearLinha(mesclarRow(ident, ctrlRow, mat)));
    }
  }
  return out;
}

// forcar=true ignora o cache e relê do banco (botão "Atualizar": reflete na hora
// mudanças na tabela feitas fora do app).
async function getCrachaData(forcar = false, escopo = null, incluirCpf = false) {
  const todas = await obterOuCarregarJsonCache(
    DASH_CONFIG.CACHE_CRACHAS_KEY,
    DASH_CONFIG.CACHE_SECONDS,
    async () => {
      // Lista da aba: TODO o consolidado, com o controle mesclado por matrícula.
      // NÃO usa JOIN: a VW_SAUDE_INDIGENA é uma view pesada e juntá-la à tabela
      // de controle numa única query força a materialização (o servidor chega a
      // derrubar a conexão). As duas leituras separadas são rápidas (mesmo
      // padrão das abas Saúde Indígena/Férias) e rodam em PARALELO, em conexões
      // próprias; o merge por matrícula é feito aqui.
      const lerRoster = async () => {
        const conn = await getMysqlConnection();
        try {
          const [rows] = await conn.query(
            `SELECT ${SELECT_IDENT} FROM ${CONSOLIDADO} v ORDER BY v.\`NOME\``
          );
          return rows || [];
        } finally {
          await fecharJdbc(conn);
        }
      };
      const lerControle = async () => {
        const conn = await getMysqlConnection();
        try {
          const [rows] = await conn.query(
            `SELECT m.\`MATRICULA\` AS MATRICULA, ${SELECT_CONTROLE} FROM ${MANUAL} m`
          );
          return rows || [];
        } finally {
          await fecharJdbc(conn);
        }
      };
      const [roster, controle] = await Promise.all([lerRoster(), lerControle()]);

      const ctrl = new Map(controle.map(row => [limparValorDash(row.MATRICULA), row]));
      // A view pode ter mais de uma linha por matrícula: mantém a 1ª. Trabalhador
      // sem linha de controle aparece com o funil no estado inicial; linhas de
      // controle órfãs (matrícula fora do consolidado) ficam de fora.
      const vistos = new Set();
      const rows = [];
      for (const r of roster) {
        const k = limparValorDash(r.MATRICULA);
        if (!k || vistos.has(k)) continue;
        vistos.add(k);
        rows.push(mapearLinha(mesclarRow(r, ctrl.get(k) || null, k)));
      }
      return rows;
    },
    forcar
  );

  // Escopo de DSEI: filtra por id (vindo do consolidado via matrícula). Linhas
  // sem id caem no filtro por nome normalizado (fail-closed).
  let rows = todas;
  if (escopo && !escopo.todos) {
    const conn = await getMysqlConnection();
    let chaves;
    try {
      chaves = await obterChavesNomeEscopoComConn(conn, escopo);
    } finally {
      await fecharJdbc(conn);
    }
    rows = (todas || []).filter(r => {
      const temId = r.idDseiCasai !== "" && r.idDseiCasai != null;
      return temId
        ? dseiNoEscopo(escopo, r.idDseiCasai)
        : chaves.has(normalizarChaveDash(r.dsei));
    });
  }

  // CPF é sensível: só administradores recebem. Para os demais, remove do payload
  // (não basta esconder a coluna no front). Copia p/ não corromper o cache.
  if (!incluirCpf) rows = rows.map(r => ({ ...r, cpf: "" }));

  return { rows, total: rows.length, statusFunil: STATUS_FUNIL.map(s => s.label) };
}

// Pós-escrita: troca as linhas alteradas DIRETO no cache em memória, pela
// matrícula — reconstruir as ~20k linhas leva segundos e não se justifica para
// uma edição pontual. Os registros já saem de obterRegistroComConn no mesmo
// formato das linhas do cache.
function atualizarCacheCracha(registros) {
  const lista = (Array.isArray(registros) ? registros : [registros]).filter(Boolean);
  if (!lista.length) return;
  atualizarJsonCache(DASH_CONFIG.CACHE_CRACHAS_KEY, (todas) => {
    const porMat = new Map(lista.map(r => [r.matricula, r]));
    for (let i = 0; i < (todas || []).length; i++) {
      const novo = porMat.get(todas[i].matricula);
      if (novo) todas[i] = novo;
    }
  });
}

// Importação em lote muda linhas demais para atualização pontual: descarta o
// cache do crachá (só ele — os caches dos demais painéis não dependem daqui).
function limparCacheCracha() {
  limparJsonCache(DASH_CONFIG.CACHE_CRACHAS_KEY);
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

// Mapeia campos amigáveis -> colunas da tabela (whitelist contra injeção).
// Identidade (nome/cargo/DSEI/situação) NÃO é gravada aqui: vem sempre do
// trabalhador consolidado.
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
  linkFotos: { coluna: "LINK_FOTOS", transform: v => limparValorDash(v) || null }
};

// Ao mudar para um destes status, carimba a data correspondente (hoje) se ela
// ainda estiver vazia — datas de marco do funil. Chaveado pelo valor de banco.
const DATA_POR_STATUS = {
  "CRACHÁS EM CONFECÇÃO": "DATA_ENVIO",             // saiu para a gráfica
  "CRACHÁ CONFECCIONADO": "DATA_CONFECCAO",         // gráfica concluiu
  "ENTREGUE AO ESCRITÓRIO": "DATA_RECEB_ESCRITORIO",
  "ENTREGUE AO TRABALHADOR": "DATA_RECEB_TRABALHADOR"
};

// Colunas de dados do controle (sem auditoria/identificador) — usadas no
// snapshot do "desfazer última alteração". Identidade NÃO entra mais.
const COLS_SNAPSHOT = [
  "STATUS_MANUAL", "DATA_SOLICITACAO", "DATA_ENVIO", "DATA_CONFECCAO",
  "DATA_RECEB_ESCRITORIO", "DATA_RECEB_TRABALHADOR", "DEVOLVIDO", "SEGUNDA_VIA",
  "MOTIVO_SEGUNDA_VIA", "OBSERVACAO_CRACHA", "LINK_FOTOS"
];
// Colunas de dados com NOT NULL: uma linha nova que não as informa recebe o
// default (não pode gravar NULL).
const OVERLAY_DEFAULT = { DEVOLVIDO: 0, SEGUNDA_VIA: 0 };

// SELECT do estado atual do controle (datas como aaaa-mm-dd, p/ regravar sem
// ambiguidade) — usado pelo snapshot individual e pela leitura em lote do import.
const SELECT_SNAPSHOT = `
       \`STATUS_MANUAL\`,
       DATE_FORMAT(\`DATA_SOLICITACAO\`, '%Y-%m-%d')       AS DATA_SOLICITACAO,
       DATE_FORMAT(\`DATA_ENVIO\`, '%Y-%m-%d')             AS DATA_ENVIO,
       DATE_FORMAT(\`DATA_CONFECCAO\`, '%Y-%m-%d')         AS DATA_CONFECCAO,
       DATE_FORMAT(\`DATA_RECEB_ESCRITORIO\`, '%Y-%m-%d')  AS DATA_RECEB_ESCRITORIO,
       DATE_FORMAT(\`DATA_RECEB_TRABALHADOR\`, '%Y-%m-%d') AS DATA_RECEB_TRABALHADOR,
       \`DEVOLVIDO\`, \`SEGUNDA_VIA\`, \`MOTIVO_SEGUNDA_VIA\`,
       \`OBSERVACAO_CRACHA\`, \`LINK_FOTOS\``;

// Lê o estado atual do controle (antes de uma alteração) para guardar como "anterior".
async function capturarSnapshotAnterior(conn, mat) {
  const [rows] = await conn.query(
    `SELECT ${SELECT_SNAPSHOT} FROM ${MANUAL} WHERE \`MATRICULA\` = ? LIMIT 1`,
    [mat]
  );
  if (rows && rows[0]) return { snapshot: JSON.stringify(rows[0]), tinha: 1 };
  return { snapshot: null, tinha: 0 }; // antes não havia registro de controle
}

// Núcleo do upsert: grava SOMENTE os campos informados em `campos`, preservando
// os demais. NÃO valida existência no consolidado (quem chama decide). Faz o
// auto-carimbo da data de marco ao mudar status.
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

// Edição manual pela tela. A existência da matrícula é validada no CONSOLIDADO
// (a linha de controle pode ainda não existir — o upsert cria). Identidade não
// é editável (a whitelist COLUNAS_OVERLAY a descarta).
async function salvarControleComConn(conn, matricula, campos, usuario) {
  const mat = limparValorDash(matricula);
  if (!mat) throw new Error("Matrícula não informada.");
  await garantirNoConsolidadoComConn(conn, mat);
  return await aplicarOverlayComConn(conn, mat, campos || {}, usuario);
}

async function atualizarStatusCrachaComConn(conn, matricula, statusLabel, usuario) {
  if (!statusDbDeLabel(statusLabel)) throw new Error("Status inválido.");
  return await salvarControleComConn(conn, matricula, { statusManual: statusLabel }, usuario);
}

// Loop por matrícula (ação em lote não-atômica: cada falha entra em `erros`).
// A existência no consolidado é checada em LOTE (uma ida ao banco); matrícula
// fora do consolidado vira erro individual, sem interromper as demais.
async function aplicarLoteComConn(conn, matriculas, campos, usuario) {
  const lista = Array.isArray(matriculas) ? [...new Set(matriculas.map(m => limparValorDash(m)).filter(Boolean))] : [];
  if (!lista.length) throw new Error("Nenhuma matrícula informada.");
  const consolidado = await infoTrabalhadorComConn(conn, lista);
  const registros = [];
  const erros = [];
  for (const mat of lista) {
    try {
      if (!consolidado.has(mat)) throw new Error("Matrícula não encontrada no Trabalhador Consolidado.");
      registros.push(await aplicarOverlayComConn(conn, mat, campos, usuario));
    } catch (err) {
      erros.push({ matricula: mat, erro: err && err.message ? err.message : "Falha." });
    }
  }
  return { registros, erros };
}

// Atualiza o mesmo status para várias matrículas de uma vez (ação em lote do
// escritório). Valida o status uma única vez.
async function atualizarStatusLoteComConn(conn, matriculas, statusLabel, usuario) {
  if (!statusDbDeLabel(statusLabel)) throw new Error("Status inválido.");
  return await aplicarLoteComConn(conn, matriculas, { statusManual: statusLabel }, usuario);
}

// Aplica os MESMOS campos (status, datas, devolvido, 2ª via, motivo, observação)
// a várias matrículas de uma vez. Só os campos presentes são alterados; identidade
// (nome/cargo/DSEI) nunca é mexida (COLUNAS_OVERLAY já a descarta).
const CAMPOS_LOTE_PERMITIDOS = [
  "statusManual", "dataSolicitacao", "dataEnvio", "dataConfeccao", "dataRecebEscritorio",
  "dataRecebTrabalhador", "devolvido", "segundaVia", "motivoSegundaVia", "observacao"
];

async function atualizarLoteComConn(conn, matriculas, campos, usuario) {
  const limpos = {};
  CAMPOS_LOTE_PERMITIDOS.forEach(k => { if (campos && campos[k] !== undefined) limpos[k] = campos[k]; });
  if (!Object.keys(limpos).length) throw new Error("Nenhum campo para aplicar.");
  if (limpos.statusManual !== undefined && !statusDbDeLabel(limpos.statusManual)) throw new Error("Status inválido.");
  return await aplicarLoteComConn(conn, matriculas, limpos, usuario);
}

// ---- Importação de planilha (em lote, chunked) ----
// Valida tudo em memória, lê existência/estado atual em poucas consultas
// `IN (...)` e grava com INSERT multi-linha em chunks (transação = tudo-ou-nada).
// NÃO cadastra trabalhador novo — colunas de identidade na planilha são
// ignoradas; a matrícula precisa existir no consolidado.
// Células em branco não alteram o campo (import é aditivo, nunca apaga).
const CAMPOS_DATA_IMPORT = ["dataSolicitacao", "dataEnvio", "dataConfeccao", "dataRecebEscritorio", "dataRecebTrabalhador"];

// Resolve os valores finais das 11 colunas do snapshot para uma linha do import:
// campo informado vence; senão preserva o valor atual (inclusive null); linha
// nova recebe os defaults das colunas NOT NULL. Auto-carimbo da data do marco
// resolvido em JS (equivalente ao COALESCE do upsert de 1 linha).
function montarValoresOverlay(campos, existente) {
  const val = {};
  Object.keys(campos).forEach(chave => {
    const def = COLUNAS_OVERLAY[chave];
    if (def) val[def.coluna] = def.transform(campos[chave]);
  });
  if (campos.statusManual !== undefined) {
    const colData = DATA_POR_STATUS[(statusDbDeLabel(campos.statusManual) || "").toUpperCase()];
    if (colData && val[colData] === undefined) {
      const atual = existente ? existente[colData] : null;
      val[colData] = atual || hojeMysql();
    }
  }
  return COLS_SNAPSHOT.map(col => {
    if (val[col] !== undefined) return val[col];
    const atual = existente ? existente[col] : undefined;
    if (atual !== undefined) return atual;               // preserva o valor atual (inclusive null)
    return OVERLAY_DEFAULT[col] !== undefined ? OVERLAY_DEFAULT[col] : null; // linha nova
  });
}

// Lê o estado atual do controle das matrículas do lote (chunks de IN).
async function lerOverlayEmLoteComConn(conn, mats) {
  const mapa = new Map();
  for (let i = 0; i < mats.length; i += IMPORT_READ_CHUNK) {
    const chunk = mats.slice(i, i + IMPORT_READ_CHUNK);
    const ph = chunk.map(() => "?").join(", ");
    const [rows] = await conn.query(
      `SELECT \`MATRICULA\`, ${SELECT_SNAPSHOT} FROM ${MANUAL} WHERE \`MATRICULA\` IN (${ph})`,
      chunk
    );
    for (const row of rows || []) mapa.set(limparValorDash(row.MATRICULA), row);
  }
  return mapa;
}

function snapshotOverlayDe(existente) {
  if (!existente) return { snapshot: null, tinha: 0 };
  const snap = {};
  COLS_SNAPSHOT.forEach(c => { snap[c] = existente[c]; });
  return { snapshot: JSON.stringify(snap), tinha: 1 };
}

// Grava as tuplas com INSERT multi-linha + ON DUPLICATE KEY, numa transação.
async function gravarOverlayEmLoteComConn(conn, tuplas) {
  const insertCols = ["MATRICULA", ...COLS_SNAPSHOT, "PREV_SNAPSHOT", "PREV_TINHA", "ATUALIZADO_POR"];
  const updates = [...COLS_SNAPSHOT, "PREV_SNAPSHOT", "PREV_TINHA", "ATUALIZADO_POR"]
    .map(c => `\`${c}\` = VALUES(\`${c}\`)`).join(", ");
  const colsSql = insertCols.map(c => `\`${c}\``).join(", ");
  await conn.beginTransaction();
  try {
    for (let i = 0; i < tuplas.length; i += IMPORT_INSERT_CHUNK) {
      const chunk = tuplas.slice(i, i + IMPORT_INSERT_CHUNK);
      const valuesSql = chunk.map(() => `(${insertCols.map(() => "?").join(", ")})`).join(", ");
      await conn.query(
        `INSERT INTO ${MANUAL} (${colsSql}) VALUES ${valuesSql}
         ON DUPLICATE KEY UPDATE ${updates}`,
        chunk.flat()
      );
    }
    await conn.commit();
  } catch (err) {
    try { await conn.rollback(); } catch (e) { /* rollback best-effort */ }
    throw err;
  }
}

async function importarCrachasComConn(conn, linhas, usuario) {
  const lista = Array.isArray(linhas) ? linhas : [];
  if (!lista.length) throw new Error("Planilha sem linhas para importar.");

  // Fase 1: validação em memória, sem banco. Erros com linha = i + 2 (cabeçalho).
  const erros = [];
  const preparadas = [];
  for (let i = 0; i < lista.length; i++) {
    const linha = lista[i] || {};
    const mat = limparValorDash(linha.matricula);
    try {
      if (!mat) throw new Error("Matrícula em branco.");
      const campos = {};
      const setStr = (chave, v) => { const s = limparValorDash(v); if (s) campos[chave] = s; };
      if (limparValorDash(linha.status)) campos.statusManual = linha.status;
      CAMPOS_DATA_IMPORT.forEach(k => setStr(k, linha[k]));
      setStr("motivoSegundaVia", linha.motivoSegundaVia);
      setStr("observacao", linha.observacao);
      setStr("linkFotos", linha.linkFotos);
      const dev = paraBooleanoImport(linha.devolvido);
      if (dev !== undefined) campos.devolvido = dev;
      const seg = paraBooleanoImport(linha.segundaVia);
      if (seg !== undefined) campos.segundaVia = seg;
      CAMPOS_DATA_IMPORT.forEach(k => {
        if (campos[k] && !normalizarDataParaMysql(campos[k])) {
          throw new Error(`Data inválida (use uma data real no formato dd/mm/aaaa) no campo "${k}".`);
        }
      });
      if (campos.statusManual !== undefined && !statusDbDeLabel(campos.statusManual)) throw new Error("Status inválido.");
      preparadas.push({ linhaNum: i + 2, mat, campos });
    } catch (err) {
      erros.push({ linha: i + 2, matricula: mat, erro: err && err.message ? err.message : "Falha." });
    }
  }
  if (!preparadas.length) return { criados: 0, atualizados: 0, erros, total: lista.length };

  // Fase 2: leituras em lote (consolidado + estado atual do controle).
  const mats = [...new Set(preparadas.map(p => p.mat))];
  const consolidado = await infoTrabalhadorComConn(conn, mats);
  const overlayAtual = await lerOverlayEmLoteComConn(conn, mats);

  // Fase 3: monta as tuplas em memória.
  const tuplas = [];
  let atualizados = 0;
  for (const p of preparadas) {
    try {
      if (!consolidado.has(p.mat)) throw new Error("Matrícula não encontrada no Trabalhador Consolidado.");
      if (!Object.keys(p.campos).length) throw new Error("Nenhum dado preenchido para atualizar.");
      const existente = overlayAtual.get(p.mat) || null;
      const { snapshot, tinha } = snapshotOverlayDe(existente);
      tuplas.push([p.mat, ...montarValoresOverlay(p.campos, existente), snapshot, tinha, usuario || null]);
      atualizados++;
    } catch (err) {
      erros.push({ linha: p.linhaNum, matricula: p.mat, erro: err && err.message ? err.message : "Falha." });
    }
  }

  // Fase 4: gravação em lote atômica.
  if (tuplas.length) await gravarOverlayEmLoteComConn(conn, tuplas);
  return { criados: 0, atualizados, erros, total: lista.length };
}

// "Reverter": desfaz SOMENTE a última alteração, restaurando o estado anterior
// guardado no snapshot (undo de 1 nível). O primeiro registro de controle de
// uma matrícula não tem estado anterior a restaurar.
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
    throw new Error("Não há estado anterior para restaurar (primeiro registro desta matrícula).");
  }

  // Há snapshot: restaura os valores anteriores e zera o "desfazer" (1 nível só).
  const snap = JSON.parse(rows[0].PREV_SNAPSHOT || "{}");
  const sets = COLS_SNAPSHOT.map(c => `\`${c}\` = ?`)
    .concat(["`PREV_SNAPSHOT` = NULL", "`PREV_TINHA` = NULL"]);
  const valores = COLS_SNAPSHOT.map(c => (snap[c] === undefined ? null : snap[c]));
  await conn.execute(`UPDATE ${MANUAL} SET ${sets.join(", ")} WHERE \`MATRICULA\` = ?`, [...valores, mat]);
  return await obterRegistroComConn(conn, mat);
}

// Reverte a última alteração de VÁRIAS matrículas de uma vez (ação em lote).
// Snapshots lidos em chunks de IN e restaurados numa transação com upsert
// multi-linha; as que não têm o que desfazer entram em `erros`, sem interromper
// as demais.
async function reverterLoteComConn(conn, matriculas) {
  const lista = Array.isArray(matriculas) ? [...new Set(matriculas.map(m => limparValorDash(m)).filter(Boolean))] : [];
  if (!lista.length) throw new Error("Nenhuma matrícula informada.");

  const prevPorMat = new Map();
  for (let i = 0; i < lista.length; i += IMPORT_READ_CHUNK) {
    const chunk = lista.slice(i, i + IMPORT_READ_CHUNK);
    const ph = chunk.map(() => "?").join(", ");
    const [rows] = await conn.query(
      `SELECT \`MATRICULA\`, \`PREV_SNAPSHOT\`, \`PREV_TINHA\` FROM ${MANUAL} WHERE \`MATRICULA\` IN (${ph})`,
      chunk
    );
    for (const row of rows || []) prevPorMat.set(limparValorDash(row.MATRICULA), row);
  }

  const erros = [];
  const aRestaurar = [];
  for (const mat of lista) {
    const r = prevPorMat.get(mat);
    const tinha = r ? r.PREV_TINHA : null;
    if (tinha === null || tinha === undefined) erros.push({ matricula: mat, erro: "Não há alteração para desfazer." });
    else if (Number(tinha) === 0) erros.push({ matricula: mat, erro: "Não há estado anterior para restaurar (primeiro registro desta matrícula)." });
    else {
      try { aRestaurar.push({ mat, snap: JSON.parse(r.PREV_SNAPSHOT || "{}") }); }
      catch (e) { erros.push({ matricula: mat, erro: "Snapshot inválido para desfazer." }); }
    }
  }

  await conn.beginTransaction();
  try {
    if (aRestaurar.length) {
      const insertCols = ["MATRICULA", ...COLS_SNAPSHOT, "PREV_SNAPSHOT", "PREV_TINHA"];
      const updates = [...COLS_SNAPSHOT, "PREV_SNAPSHOT", "PREV_TINHA"].map(c => `\`${c}\` = VALUES(\`${c}\`)`).join(", ");
      const colsSql = insertCols.map(c => `\`${c}\``).join(", ");
      for (let i = 0; i < aRestaurar.length; i += IMPORT_INSERT_CHUNK) {
        const chunk = aRestaurar.slice(i, i + IMPORT_INSERT_CHUNK);
        const valuesSql = chunk.map(() => `(${insertCols.map(() => "?").join(", ")})`).join(", ");
        const params = [];
        for (const it of chunk) params.push(it.mat, ...COLS_SNAPSHOT.map(c => (it.snap[c] === undefined ? null : it.snap[c])), null, null);
        await conn.query(`INSERT INTO ${MANUAL} (${colsSql}) VALUES ${valuesSql} ON DUPLICATE KEY UPDATE ${updates}`, params);
      }
    }
    await conn.commit();
  } catch (err) {
    try { await conn.rollback(); } catch (e) { /* rollback best-effort */ }
    throw err;
  }

  const registros = await obterRegistrosComConn(conn, aRestaurar.map(it => it.mat));
  return { registros, erros };
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

// Salva (insere/atualiza) a foto, sem mexer nos demais campos. A matrícula é
// validada contra o consolidado; o upsert cria a linha de controle se for o
// primeiro registro.
async function salvarFotoCrachaComConn(conn, matricula, buffer, mime, usuario) {
  const mat = limparValorDash(matricula);
  if (!mat) throw new Error("Matrícula não informada.");
  await garantirNoConsolidadoComConn(conn, mat);
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
  // Receber a foto faz o trabalhador deixar de estar sem foto válida (Foto
  // Pendente de Envio ou Foto Reprovada): avança o funil para "Envio à Gráfica
  // Pendente" (passa a "possuir foto").
  if (registro && STATUS_SEM_FOTO.has(registro.status)) {
    return await aplicarOverlayComConn(conn, mat, { statusManual: STATUS_ENVIO_GRAFICA_LABEL }, usuario);
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

// Remove a foto (mantém o restante do registro intacto).
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
  atualizarCacheCracha,
  limparCacheCracha,
  garantirEscopoMatriculaComConn,
  garantirEscopoMatriculasComConn,
  salvarControleComConn,
  atualizarStatusCrachaComConn,
  atualizarStatusLoteComConn,
  atualizarLoteComConn,
  importarCrachasComConn,
  reverterControleComConn,
  reverterLoteComConn,
  garantirTabelaCrachasControle,
  decodificarImagemDataUrl,
  salvarFotoCrachaComConn,
  obterFotoCrachaComConn,
  removerFotoCrachaComConn,
  STATUS_FUNIL
};
