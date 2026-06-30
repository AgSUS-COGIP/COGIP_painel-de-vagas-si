// Domínio: Gestão Disciplinar (pedidos de sanção). Regras + persistência.
// As tabelas (PEDIDO_SANCAO, PEDIDO_DEMANDA, SANCAO, SANCAO_CATEGORIA,
// PEDIDO_ANEXO, PEDIDO_RESPONSABILIDADE_HISTORICO) já existem no banco; aqui só
// consultamos/gravamos. O front (public/js/gestao-disciplinar.js) trabalha com
// rótulos em português ("Em análise", "Suspensão (5 dias)"...), enquanto o banco
// usa ENUMs/categorias normalizadas. Toda a tradução acontece neste módulo, de
// modo que a API entrega/recebe exatamente as formas que a UI já usa.
const crypto = require("crypto");
const { DASH_CONFIG } = require("./config");
const { getMysqlConnection, fecharJdbc } = require("./db");
const { limparValorDash } = require("./utils");
const { dseiNoEscopo } = require("./escopo");

const SCHEMA = DASH_CONFIG.DB_SCHEMA;
const T_PEDIDO = `\`${SCHEMA}\`.\`PEDIDO_SANCAO\``;
const T_DEMANDA = `\`${SCHEMA}\`.\`PEDIDO_DEMANDA\``;
const T_SANCAO = `\`${SCHEMA}\`.\`SANCAO\``;
const T_CATEGORIA = `\`${SCHEMA}\`.\`SANCAO_CATEGORIA\``;
const T_ANEXO = `\`${SCHEMA}\`.\`PEDIDO_ANEXO\``;
const T_HIST = `\`${SCHEMA}\`.\`PEDIDO_RESPONSABILIDADE_HISTORICO\``;
const T_TRABALHADOR = `\`${SCHEMA}\`.\`${DASH_CONFIG.TRABALHADOR_CONSOLIDADO_TABLE}\``;

// ---------- Tradução status (UI <-> ENUM PEDIDO_DEMANDA.status) ----------
const STATUS_LABEL_TO_DB = {
  "Pendente": "PENDENTE",
  "Em análise": "EM_ANALISE",
  "Aguardando devolutiva do DSEI/Profissional": "AGUARDANDO_COMPLEMENTACAO",
  "Concluída": "CONCLUIDO",
  "Desligado antes da conclusão": "BLOQUEADO"
};
const STATUS_DB_TO_LABEL = Object.fromEntries(
  Object.entries(STATUS_LABEL_TO_DB).map(([label, db]) => [db, label])
);

// Datas de conclusão de cada etapa do funil (colunas em PEDIDO_DEMANDA). Ao mudar
// o status, carimba-se a data da etapa alcançada (preservando a 1ª vez, via
// COALESCE) e limpam-se as etapas à frente — assim "voltar fase"/"reativar"
// mantêm a linha do tempo coerente. BLOQUEADO (desligado) não mexe nas datas.
const DATAS_FASE_DEMANDA = {
  PENDENTE: { coalesce: [], limpar: ["data_inicio_analise", "data_envio_dsei", "data_conclusao"] },
  EM_ANALISE: { coalesce: ["data_inicio_analise"], limpar: ["data_envio_dsei", "data_conclusao"] },
  AGUARDANDO_COMPLEMENTACAO: { coalesce: ["data_envio_dsei"], limpar: ["data_conclusao"] },
  CONCLUIDO: { coalesce: ["data_conclusao"], limpar: [] }
};

// ---------- Tradução atendimento (UI <-> ENUM PEDIDO_DEMANDA.atendimento) ----------
const ATEND_LABEL_TO_DB = {
  "—": "PENDENTE",
  "Totalmente": "ATENDIDO",
  "Parcialmente": "PARCIALMENTE_ATENDIDO",
  "Não atendido": "NAO_ATENDIDO"
};
const ATEND_DB_TO_LABEL = {
  "PENDENTE": "—",
  "ATENDIDO": "Totalmente",
  "PARCIALMENTE_ATENDIDO": "Parcialmente",
  "NAO_ATENDIDO": "Não atendido"
};

// ---------- Datas ----------
// Aceita "dd/mm/aaaa" ou "aaaa-mm-dd" e devolve "aaaa-mm-dd" (DATE do MySQL) ou null.
function paraDataSql(valor) {
  const txt = limparValorDash(valor);
  if (!txt || txt === "—") return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(txt);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(txt);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

// "—" como vazio textual.
function texto(valor) {
  const t = limparValorDash(valor);
  return t && t !== "—" ? t : null;
}

// ---------- Tradução sanção (UI <-> SANCAO_CATEGORIA + dias_suspensao) ----------
// O rótulo da UI ("Suspensão (5 dias)") combina a categoria com a quantidade de
// dias; aqui separamos os dois para gravar e recombinamos para exibir.
function tipoSancaoParaCategoria(tipo) {
  const t = limparValorDash(tipo).toLowerCase();
  if (!t || t === "—" || t === "em apuração") return null; // sem linha de SANCAO
  if (/^advertência oral$/.test(t)) return { nome: "Advertência Oral", dias: null };
  if (/^advertência$/.test(t)) return { nome: "Advertência Escrita", dias: null };
  if (/^suspens/.test(t)) {
    const md = /(\d+)\s*dia/.exec(t);
    return { nome: "Suspensão", dias: md ? Number(md[1]) : null };
  }
  if (/justa causa/.test(t)) return { nome: "Rescisão por justa causa", dias: null };
  if (/não aplicada/.test(t)) return { nome: "Sem sanção", dias: null };
  return null;
}

// Rótulo-base do Tipo de Sanção na UI (sem os dias). A quantidade de dias da
// suspensão viaja em campo separado (diasSuspensao).
function categoriaParaTipoSancao(nomeCategoria) {
  switch (limparValorDash(nomeCategoria)) {
    case "Advertência Oral": return "Advertência oral";
    case "Advertência Escrita": return "Advertência";
    case "Suspensão": return "Suspensão";
    case "Rescisão por justa causa": return "Justa Causa";
    case "Sem sanção": return "Não Aplicada";
    default: return "—";
  }
}

// ---------- Anexos / Provas ----------
// Um anexo é um link externo (caminho_arquivo = URL http) OU um arquivo guardado
// no banco (coluna `conteudo`), baixado pelo endpoint /api/disciplinar/anexo/:id.
function mapearAnexo(row) {
  const caminho = limparValorDash(row.caminho_arquivo);
  const ehLink = /^https?:\/\//i.test(caminho);
  const temConteudo = Number(row.tem_conteudo) === 1;
  const bytes = Number(row.tamanho_bytes || 0);
  let info;
  if (ehLink) info = "Link";
  else if (bytes > 0) info = `${/pdf/i.test(row.mime_type || "") ? "PDF" : "Arquivo"} · ${Math.max(1, Math.round(bytes / 1024))} KB`;
  else info = "Arquivo";
  const id = Number(row.id_anexo);
  return {
    id,
    nome: limparValorDash(row.nome_arquivo),
    info,
    data: limparValorDash(row.enviado_em),
    tipo: limparValorDash(row.tipo_anexo),
    ehLink,
    disponivel: ehLink || temConteudo,
    url: ehLink ? caminho : (temConteudo ? `/api/disciplinar/anexo/${id}` : "")
  };
}

// ---------- Montagem do registro no formato que a UI já consome ----------
function mapearPedido(row) {
  const statusLabel = STATUS_DB_TO_LABEL[row.status] || "Pendente";
  const atendLabel = ATEND_DB_TO_LABEL[row.atendimento] || "—";
  const tipoSancao = row.categoria_nome
    ? categoriaParaTipoSancao(row.categoria_nome)
    : "—";
  const diasSuspensao = row.dias_suspensao ? Number(row.dias_suspensao) : null;
  const dataSancao = limparValorDash(row.data_sancao) || "—";
  return {
    id: Number(row.id_pedido),
    idDseiCasai: limparValorDash(row.id_dsei_casai), // p/ filtro de escopo por DSEI
    processo: limparValorDash(row.num_processo_sei) || "(sem nº SEI)",
    matricula: limparValorDash(row.matricula),
    trabalhador: limparValorDash(row.nome_trabalhador_snapshot) || "—",
    cargo: limparValorDash(row.cargo_snapshot) || "—",
    dsei: limparValorDash(row.dsei_casai_snapshot) || "—",
    polo: limparValorDash(row.polo_base_snapshot) || "—",
    pedido: limparValorDash(row.pedido) || "—",
    ocorrencia: limparValorDash(row.data_ocorrencia) || "—",
    dataPedido: limparValorDash(row.data_pedido) || "—",
    resumo: limparValorDash(row.resumo_processo) || "—",
    foraDoPrazo: Number(row.fora_prazo) === 1,
    responsavel: limparValorDash(row.responsavel_atual) || "",
    motivo: "",
    // Status / demanda
    status: statusLabel,
    statusAtual: statusLabel,
    atendimento: atendLabel,
    medidaParcial: limparValorDash(row.medida_parcial) || "—",
    motivoNaoAtendimento: limparValorDash(row.motivo_nao_atendimento) || "—",
    observacoesStatus: limparValorDash(row.obs_status) || "—",
    ultimaAtualizacao: limparValorDash(row.ultima_atualizacao_status) || limparValorDash(row.data_pedido) || "—",
    // Datas de conclusão de cada etapa do funil (para a linha do tempo do status).
    dataInicioAnalise: limparValorDash(row.data_inicio_analise) || "—",
    dataEnvioDsei: limparValorDash(row.data_envio_dsei) || "—",
    dataConclusao: limparValorDash(row.data_conclusao) || "—",
    // Sanção
    tipoSancao,
    diasSuspensao,
    decisao: limparValorDash(row.sancao_motivo) || "—",
    dataSancao,
    dataAplicacao: dataSancao,
    aplicadaPor: limparValorDash(row.aplicado_por) || "—",
    documento: limparValorDash(row.nome_documento) || "—",
    comprovante: limparValorDash(row.nome_documento) || "",
    // Documento comprobatório agora é guardado em BLOB; a URL aponta para o
    // endpoint de download quando há arquivo gravado.
    comprovanteUrl: Number(row.tem_documento) === 1 ? `/api/disciplinar/${Number(row.id_pedido)}/sancao/termo` : "",
    observacoesSancao: limparValorDash(row.descricao_sancao) || "—",
    anexos: []
  };
}

const SELECT_PEDIDOS = `
  SELECT
    p.id_pedido, p.matricula, p.id_dsei_casai, p.num_processo_sei,
    p.nome_trabalhador_snapshot, p.cargo_snapshot, p.dsei_casai_snapshot, p.polo_base_snapshot,
    p.pedido,
    DATE_FORMAT(p.data_ocorrencia, '%d/%m/%Y') AS data_ocorrencia,
    DATE_FORMAT(p.data_pedido, '%d/%m/%Y') AS data_pedido,
    p.resumo_processo, p.fora_prazo,
    d.responsavel_atual, d.atendimento, d.medida_parcial, d.motivo_nao_atendimento,
    d.status, DATE_FORMAT(d.ultima_atualizacao_status, '%d/%m/%Y') AS ultima_atualizacao_status,
    DATE_FORMAT(d.data_inicio_analise, '%d/%m/%Y') AS data_inicio_analise,
    DATE_FORMAT(d.data_envio_dsei, '%d/%m/%Y') AS data_envio_dsei,
    DATE_FORMAT(d.data_conclusao, '%d/%m/%Y') AS data_conclusao,
    d.obs AS obs_status,
    s.id_categoria, cat.nome AS categoria_nome, s.dias_suspensao,
    s.motivo AS sancao_motivo, DATE_FORMAT(s.data_sancao, '%d/%m/%Y') AS data_sancao,
    s.aplicado_por, s.nome_documento, s.descricao AS descricao_sancao,
    CASE WHEN s.documento_sancao IS NULL THEN 0 ELSE 1 END AS tem_documento
  FROM ${T_PEDIDO} p
  LEFT JOIN ${T_DEMANDA} d ON d.id_pedido = p.id_pedido
  LEFT JOIN ${T_SANCAO} s ON s.id_pedido = p.id_pedido
  LEFT JOIN ${T_CATEGORIA} cat ON cat.id_categoria = s.id_categoria
`;

async function anexarAnexos(conn, registros) {
  if (!registros.length) return registros;
  const porId = new Map(registros.map(r => [r.id, r]));
  const baseSel = `SELECT id_anexo, id_pedido, tipo_anexo, nome_arquivo, caminho_arquivo, mime_type, tamanho_bytes,
            DATE_FORMAT(enviado_em, '%d/%m/%Y') AS enviado_em`;
  let rows;
  try {
    // tem_conteudo indica se o arquivo está guardado no banco (coluna conteudo).
    [rows] = await conn.query(`${baseSel}, CASE WHEN \`conteudo\` IS NULL THEN 0 ELSE 1 END AS tem_conteudo FROM ${T_ANEXO} ORDER BY id_pedido, id_anexo`);
  } catch (e) {
    // Fallback caso a coluna `conteudo` ainda não exista (garantida no boot).
    [rows] = await conn.query(`${baseSel}, 0 AS tem_conteudo FROM ${T_ANEXO} ORDER BY id_pedido, id_anexo`);
  }
  (rows || []).forEach(a => {
    const reg = porId.get(Number(a.id_pedido));
    if (reg) reg.anexos.push(mapearAnexo(a));
  });
  return registros;
}

// Garante a coluna `conteudo` (LONGBLOB) em PEDIDO_ANEXO para guardar os bytes
// das provas no banco (mesma estratégia do anexo de remanejamento). Idempotente.
async function garantirColunaConteudoProva() {
  const conn = await getMysqlConnection();
  try {
    const [cols] = await conn.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'PEDIDO_ANEXO' AND COLUMN_NAME = 'conteudo'`,
      [SCHEMA]
    );
    if (!cols.length) {
      await conn.query(`ALTER TABLE ${T_ANEXO} ADD COLUMN \`conteudo\` LONGBLOB NULL`);
    }
  } finally {
    await fecharJdbc(conn);
  }
}

// Garante as colunas de data de conclusão de cada etapa do funil em
// PEDIDO_DEMANDA (data_inicio_analise / data_envio_dsei / data_conclusao).
// Idempotente: só adiciona o que ainda não existe.
async function garantirColunasDatasFasesDemanda() {
  const COLUNAS = ["data_inicio_analise", "data_envio_dsei", "data_conclusao"];
  const conn = await getMysqlConnection();
  try {
    const [cols] = await conn.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'PEDIDO_DEMANDA' AND COLUMN_NAME IN (?, ?, ?)`,
      [SCHEMA, ...COLUNAS]
    );
    const existentes = new Set((cols || []).map(c => c.COLUMN_NAME));
    const faltantes = COLUNAS.filter(c => !existentes.has(c));
    if (faltantes.length) {
      const add = faltantes.map(c => `ADD COLUMN \`${c}\` DATETIME NULL DEFAULT NULL`).join(", ");
      await conn.query(`ALTER TABLE ${T_DEMANDA} ${add}`);
    }
  } finally {
    await fecharJdbc(conn);
  }
}

async function listarPedidosComConn(conn, escopo) {
  const [rows] = await conn.query(`${SELECT_PEDIDOS} ORDER BY p.data_pedido DESC, p.id_pedido DESC`);
  let registros = (rows || []).map(mapearPedido);
  // Escopo por DSEI: usuário restrito só vê pedidos do seu DSEI. Pedido sem DSEI
  // resolvido (id nulo) é ocultado para o restrito (fail-closed).
  if (escopo && !escopo.todos) {
    registros = registros.filter(r => dseiNoEscopo(escopo, r.idDseiCasai));
  }
  return anexarAnexos(conn, registros);
}

// Garante a coluna id_dsei_casai em PEDIDO_SANCAO (escopo por DSEI) e faz o
// backfill dos pedidos existentes pela matrícula (consolidado). Idempotente.
async function garantirColunaDseiPedidoSancao() {
  const conn = await getMysqlConnection();
  try {
    const [cols] = await conn.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'PEDIDO_SANCAO' AND COLUMN_NAME = 'id_dsei_casai'`,
      [SCHEMA]
    );
    if (!cols.length) {
      await conn.query(`ALTER TABLE ${T_PEDIDO} ADD COLUMN \`id_dsei_casai\` INT NULL`);
      try {
        await conn.query(
          `UPDATE ${T_PEDIDO} p
             JOIN ${T_TRABALHADOR} tc ON tc.\`MATRICULA\` = p.\`matricula\`
              SET p.\`id_dsei_casai\` = tc.\`UNIDADE_ORCAMENTARIA_ID\`
            WHERE p.\`id_dsei_casai\` IS NULL`
        );
      } catch (e) {
        console.warn("Backfill de id_dsei_casai em PEDIDO_SANCAO falhou (segue sem):", e && e.message ? e.message : e);
      }
    }
  } finally {
    await fecharJdbc(conn);
  }
}

// Resolve o DSEI (UNIDADE_ORCAMENTARIA_ID) de um trabalhador pela matrícula.
async function obterDseiPorMatriculaComConn(conn, matricula) {
  try {
    const [rows] = await conn.query(
      `SELECT \`UNIDADE_ORCAMENTARIA_ID\` AS id FROM ${T_TRABALHADOR} WHERE \`MATRICULA\` = ? LIMIT 1`,
      [matricula]
    );
    const v = rows && rows[0] ? rows[0].id : null;
    return (v != null && v !== "") ? Number(v) : null;
  } catch (e) {
    return null;
  }
}

async function obterPedidoComConn(conn, idPedido) {
  const id = Number(idPedido);
  if (!id) return null;
  const [rows] = await conn.query(`${SELECT_PEDIDOS} WHERE p.id_pedido = ? LIMIT 1`, [id]);
  if (!rows || !rows[0]) return null;
  const [registro] = await anexarAnexos(conn, [mapearPedido(rows[0])]);
  return registro;
}

// Lista de categorias ativas (para o seletor de Tipo de Sanção, se necessário).
async function listarCategoriasComConn(conn) {
  const [rows] = await conn.query(
    `SELECT id_categoria, nome, descricao, exige_dias_suspensao
       FROM ${T_CATEGORIA} WHERE ativo = 1 ORDER BY id_categoria`
  );
  return (rows || []).map(r => ({
    id: Number(r.id_categoria),
    nome: limparValorDash(r.nome),
    descricao: limparValorDash(r.descricao),
    exigeDias: Number(r.exige_dias_suspensao) === 1
  }));
}

// Colunas opcionais do consolidado (instalações têm schemas ligeiramente
// diferentes). Detecta uma vez e cacheia para montar o SELECT só com o que existe.
let _trabColsCache = null;
async function colunasTrabalhadorComConn(conn) {
  if (_trabColsCache) return _trabColsCache;
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [SCHEMA, DASH_CONFIG.TRABALHADOR_CONSOLIDADO_TABLE]
  );
  _trabColsCache = new Set((rows || []).map(r => String(r.COLUMN_NAME)));
  return _trabColsCache;
}

// Trabalhador desligado: a situação detalhada é a fonte autoritativa quando
// existe ("Desligado..."); sem ela, usa a presença da data de desligamento.
function trabalhadorDesligado(situacao, dataDesligamento) {
  const sit = limparValorDash(situacao).toLowerCase();
  if (sit) return /deslig/.test(sit);
  const dd = limparValorDash(dataDesligamento);
  return !!dd && dd !== "—";
}

// Busca trabalhadores no consolidado (a matrícula é FK obrigatória do pedido).
// Retorna também a situação atual e um indicador `desligado` para o aviso na UI.
async function buscarTrabalhadoresComConn(conn, termo) {
  const t = limparValorDash(termo);
  if (t.length < 2) return [];
  const like = `%${t}%`;
  const cols = await colunasTrabalhadorComConn(conn);
  const polo = cols.has("LOCAL_TRABALHO_DESC") ? "`LOCAL_TRABALHO_DESC`" : "NULL";
  const situacao = cols.has("SITUACAO_DETALHADA_DESC") ? "`SITUACAO_DETALHADA_DESC`" : "NULL";
  const dataDeslig = cols.has("DATA_DESLIGAMENTO") ? "DATE_FORMAT(`DATA_DESLIGAMENTO`, '%d/%m/%Y')" : "NULL";
  const [rows] = await conn.query(
    `SELECT \`MATRICULA\` AS matricula, \`NOME\` AS nome,
            \`CARGO_ATUAL_DESC\` AS cargo, \`UNIDADE_ORCAMENTARIA_DESC\` AS dsei,
            ${polo} AS polo, ${situacao} AS situacao, ${dataDeslig} AS dataDesligamento
       FROM ${T_TRABALHADOR}
      WHERE \`NOME\` LIKE ? OR \`MATRICULA\` LIKE ?
      ORDER BY \`NOME\` LIMIT 25`,
    [like, like]
  );
  return (rows || []).map(r => ({
    matricula: limparValorDash(r.matricula),
    nome: limparValorDash(r.nome),
    cargo: limparValorDash(r.cargo),
    dsei: limparValorDash(r.dsei),
    polo: limparValorDash(r.polo),
    situacao: limparValorDash(r.situacao),
    dataDesligamento: limparValorDash(r.dataDesligamento),
    desligado: trabalhadorDesligado(r.situacao, r.dataDesligamento)
  }));
}

// ---------- Criação de pedido ----------
async function criarPedidoComConn(conn, body, criadoPor, oficioFile, anexos, anexosTipos) {
  const dados = body || {};
  const matricula = Number(limparValorDash(dados.matricula));
  if (!Number.isInteger(matricula) || matricula <= 0) {
    throw new Error("Selecione um trabalhador válido (matrícula).");
  }
  const numSei = limparValorDash(dados.processo);
  if (!numSei) throw new Error("O nº do Processo SEI é obrigatório.");

  const dataPedidoSql = paraDataSql(dados.dataPedido) || paraDataSql(new Date().toISOString().slice(0, 10));
  const statusDb = STATUS_LABEL_TO_DB[limparValorDash(dados.statusInicial)] || "PENDENTE";
  const responsavel = texto(dados.responsavel);
  // DSEI do trabalhador (escopo por unidade), derivado da matrícula no consolidado.
  const idDseiCasai = await obterDseiPorMatriculaComConn(conn, matricula);

  await conn.beginTransaction();
  try {
    const [resPedido] = await conn.execute(
      `INSERT INTO ${T_PEDIDO}
         (matricula, id_dsei_casai, nome_trabalhador_snapshot, cargo_snapshot, dsei_casai_snapshot, polo_base_snapshot,
          pedido, data_ocorrencia, data_pedido, num_processo_sei, resumo_processo, fora_prazo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        matricula,
        idDseiCasai,
        texto(dados.trabalhador),
        texto(dados.cargo),
        texto(dados.dsei),
        texto(dados.polo),
        texto(dados.pedido) || "Sem indicação",
        paraDataSql(dados.ocorrencia),
        dataPedidoSql,
        numSei,
        texto(dados.resumo),
        Number(dados.foraDoPrazo) === 1 || dados.foraDoPrazo === true ? 1 : 0
      ]
    );
    const idPedido = resPedido.insertId;

    // Se já nasce concluído (pedido fora do prazo marcado como concluído na
    // criação), carimba também a data de conclusão da etapa. A decisão é feita
    // aqui no JS para não comparar strings no SQL (evita erro de colação).
    const concluidoNaCriacao = statusDb === "CONCLUIDO";
    const [resDemanda] = await conn.execute(
      `INSERT INTO ${T_DEMANDA}
         (id_pedido, responsavel_atual, atendimento, status, ultima_atualizacao_status${concluidoNaCriacao ? ", data_conclusao" : ""})
       VALUES (?, ?, 'PENDENTE', ?, NOW()${concluidoNaCriacao ? ", NOW()" : ""})`,
      [idPedido, responsavel, statusDb]
    );

    // Coerência com a regra de desligamento: se o pedido já nasce como "Desligado
    // antes da conclusão", a sanção entra como "Não Aplicada".
    if (statusDb === "BLOQUEADO") {
      await definirSancaoNaoAplicadaComConn(conn, idPedido);
    }

    if (responsavel) {
      await conn.execute(
        `INSERT INTO ${T_HIST} (id_demanda, responsavel_anterior, responsavel_novo, acao, obs)
         VALUES (?, NULL, ?, 'ASSUMIU', ?)`,
        [resDemanda.insertId, responsavel, `Responsável definido na criação por ${criadoPor || "painel"}.`]
      );
    }

    // Documento do processo (OFÍCIO): arquivo guardado em BLOB OU link externo.
    // Apenas 1 ofício por pedido (garantido pela UNIQUE no banco).
    const anexoUrl = texto(dados.anexoUrl);
    if (oficioFile && oficioFile.buffer) {
      const hash = crypto.createHash("sha256").update(oficioFile.buffer).digest("hex");
      await conn.execute(
        `INSERT INTO ${T_ANEXO}
           (id_pedido, tipo_anexo, nome_arquivo, caminho_arquivo, mime_type, tamanho_bytes, hash_sha256, conteudo, enviado_por)
         VALUES (?, 'OFICIO', ?, ?, ?, ?, ?, ?, ?)`,
        [idPedido, oficioFile.originalname, oficioFile.originalname, oficioFile.mimetype || null,
         oficioFile.size || null, hash, oficioFile.buffer, criadoPor || null]
      );
    } else if (anexoUrl) {
      await conn.execute(
        `INSERT INTO ${T_ANEXO}
           (id_pedido, tipo_anexo, nome_arquivo, caminho_arquivo, enviado_por)
         VALUES (?, 'OFICIO', ?, ?, ?)`,
        [idPedido, texto(dados.anexoNome) || anexoUrl, anexoUrl, criadoPor || null]
      );
    }

    // Anexos extras enviados no cadastro (vários arquivos, com tipo por arquivo).
    const extras = anexos || [];
    const tipos = anexosTipos || [];
    for (let i = 0; i < extras.length; i++) {
      await inserirAnexoConteudoComConn(conn, idPedido, extras[i], tipos[i], criadoPor);
    }

    await conn.commit();
    return obterPedidoComConn(conn, idPedido);
  } catch (err) {
    await conn.rollback();
    if (err && err.code === "ER_DUP_ENTRY") {
      throw new Error("Já existe um pedido com este nº de Processo SEI.");
    }
    if (err && (err.code === "ER_NO_REFERENCED_ROW_2" || err.code === "ER_NO_REFERENCED_ROW")) {
      throw new Error("Matrícula não encontrada no cadastro de trabalhadores.");
    }
    throw err;
  }
}

// ---------- Atualização da demanda (status/atendimento/medida/motivo/obs) ----------
// Recebe um patch com chaves no formato da UI; grava apenas o que veio.
async function atualizarDemandaComConn(conn, idPedido, patch) {
  const id = Number(idPedido);
  if (!id) throw new Error("Pedido inválido.");
  const p = patch || {};
  const sets = [];
  const vals = [];

  if (p.status !== undefined) {
    const db = STATUS_LABEL_TO_DB[limparValorDash(p.status)];
    if (!db) throw new Error("Status inválido.");
    sets.push("`status` = ?", "`ultima_atualizacao_status` = NOW()");
    vals.push(db);
    // Carimba a data da etapa alcançada e limpa as etapas à frente.
    const datas = DATAS_FASE_DEMANDA[db];
    if (datas) {
      datas.coalesce.forEach(c => sets.push(`\`${c}\` = COALESCE(\`${c}\`, NOW())`));
      datas.limpar.forEach(c => sets.push(`\`${c}\` = NULL`));
    }
  }
  if (p.atendimento !== undefined) {
    const db = ATEND_LABEL_TO_DB[limparValorDash(p.atendimento)] || "PENDENTE";
    sets.push("`atendimento` = ?");
    vals.push(db);
  }
  if (p.medidaParcial !== undefined) { sets.push("`medida_parcial` = ?"); vals.push(texto(p.medidaParcial)); }
  if (p.motivoNaoAtendimento !== undefined) { sets.push("`motivo_nao_atendimento` = ?"); vals.push(texto(p.motivoNaoAtendimento)); }
  if (p.observacoesStatus !== undefined) { sets.push("`obs` = ?"); vals.push(texto(p.observacoesStatus)); }

  if (!sets.length) return obterPedidoComConn(conn, id);

  vals.push(id);
  await conn.execute(`UPDATE ${T_DEMANDA} SET ${sets.join(", ")} WHERE id_pedido = ?`, vals);

  // Ao desligar o trabalhador antes da conclusão, a sanção passa a "Não Aplicada"
  // (categoria "Sem sanção"): o processo encerra sem penalidade a aplicar.
  if (p.status !== undefined && STATUS_LABEL_TO_DB[limparValorDash(p.status)] === "BLOQUEADO") {
    await definirSancaoNaoAplicadaComConn(conn, id);
  }

  return obterPedidoComConn(conn, id);
}

// Marca a sanção do pedido como "Não Aplicada" (categoria "Sem sanção"). Usado no
// desligamento antes da conclusão; faz upsert da linha de SANCAO ajustando só a
// categoria (e zerando os dias de suspensão), sem mexer em motivo/data/observações.
async function definirSancaoNaoAplicadaComConn(conn, idPedido) {
  const id = Number(idPedido);
  if (!id) return;
  const [catRows] = await conn.query(`SELECT id_categoria FROM ${T_CATEGORIA} WHERE nome = 'Sem sanção' LIMIT 1`);
  if (!catRows || !catRows[0]) return;
  const idCategoria = Number(catRows[0].id_categoria);
  const [sancaoRows] = await conn.query(`SELECT id_sancao FROM ${T_SANCAO} WHERE id_pedido = ? LIMIT 1`, [id]);
  if (sancaoRows && sancaoRows[0]) {
    await conn.execute(`UPDATE ${T_SANCAO} SET \`id_categoria\` = ?, \`dias_suspensao\` = NULL WHERE id_pedido = ?`, [idCategoria, id]);
  } else {
    await conn.execute(`INSERT INTO ${T_SANCAO} (id_pedido, id_categoria) VALUES (?, ?)`, [id, idCategoria]);
  }
}

// ---------- Correção dos dados-base do pedido (PEDIDO_SANCAO) ----------
// Permite corrigir erros de digitação nos campos do próprio pedido (trabalhador,
// matrícula, processo SEI, datas, pedido de medida e resumo). Não toca em
// demanda/sanção/anexos — essas têm seus próprios fluxos.
async function atualizarPedidoBaseComConn(conn, idPedido, patch) {
  const id = Number(idPedido);
  if (!id) throw new Error("Pedido inválido.");
  const p = patch || {};
  const sets = [];
  const vals = [];

  if (p.matricula !== undefined) {
    const m = texto(p.matricula);
    if (!m) throw new Error("A matrícula é obrigatória.");
    sets.push("`matricula` = ?"); vals.push(m);
  }
  if (p.trabalhador !== undefined) { sets.push("`nome_trabalhador_snapshot` = ?"); vals.push(texto(p.trabalhador)); }
  if (p.cargo !== undefined) { sets.push("`cargo_snapshot` = ?"); vals.push(texto(p.cargo)); }
  if (p.dsei !== undefined) { sets.push("`dsei_casai_snapshot` = ?"); vals.push(texto(p.dsei)); }
  if (p.polo !== undefined) { sets.push("`polo_base_snapshot` = ?"); vals.push(texto(p.polo)); }
  if (p.pedido !== undefined) { sets.push("`pedido` = ?"); vals.push(texto(p.pedido) || "Sem indicação"); }
  if (p.ocorrencia !== undefined) { sets.push("`data_ocorrencia` = ?"); vals.push(paraDataSql(p.ocorrencia)); }
  if (p.dataPedido !== undefined) { sets.push("`data_pedido` = ?"); vals.push(paraDataSql(p.dataPedido)); }
  if (p.processo !== undefined) {
    const s = texto(p.processo);
    if (!s) throw new Error("O nº do Processo SEI é obrigatório.");
    sets.push("`num_processo_sei` = ?"); vals.push(s);
  }
  if (p.resumo !== undefined) { sets.push("`resumo_processo` = ?"); vals.push(texto(p.resumo)); }

  // Recalcula "fora do prazo" quando as duas datas vêm no patch (mesma regra do
  // cadastro: pedido feito mais de 30 dias após a ocorrência).
  if (p.ocorrencia !== undefined && p.dataPedido !== undefined) {
    const occ = paraDataSql(p.ocorrencia);
    const ped = paraDataSql(p.dataPedido);
    if (occ && ped) {
      const dias = (new Date(ped) - new Date(occ)) / 86400000;
      sets.push("`fora_prazo` = ?");
      vals.push(Number.isFinite(dias) && dias > 30 ? 1 : 0);
    }
  }

  if (!sets.length) return obterPedidoComConn(conn, id);

  vals.push(id);
  try {
    await conn.execute(`UPDATE ${T_PEDIDO} SET ${sets.join(", ")} WHERE id_pedido = ?`, vals);
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      throw new Error("Já existe um pedido com este nº de Processo SEI.");
    }
    if (err && (err.code === "ER_NO_REFERENCED_ROW_2" || err.code === "ER_NO_REFERENCED_ROW")) {
      throw new Error("Matrícula não encontrada no cadastro de trabalhadores.");
    }
    throw err;
  }
  return obterPedidoComConn(conn, id);
}

// ---------- Atualização da sanção (upsert; só para pedido concluído) ----------
async function atualizarSancaoComConn(conn, idPedido, patch, usuario) {
  const id = Number(idPedido);
  if (!id) throw new Error("Pedido inválido.");
  const p = patch || {};

  const [demRows] = await conn.query(`SELECT \`status\` FROM ${T_DEMANDA} WHERE id_pedido = ? LIMIT 1`, [id]);
  if (!demRows || !demRows[0] || demRows[0].status !== "CONCLUIDO") {
    throw new Error("A sanção só pode ser editada quando o pedido estiver concluído.");
  }

  // Se o Tipo de Sanção foi alterado para "—"/"Em apuração", remove a linha de SANCAO.
  if (p.tipoSancao !== undefined) {
    const cat = tipoSancaoParaCategoria(p.tipoSancao);
    if (!cat) {
      await conn.execute(`DELETE FROM ${T_SANCAO} WHERE id_pedido = ?`, [id]);
      return obterPedidoComConn(conn, id);
    }
  }

  const [sancaoRows] = await conn.query(`SELECT id_sancao, id_categoria FROM ${T_SANCAO} WHERE id_pedido = ? LIMIT 1`, [id]);
  const existente = sancaoRows && sancaoRows[0] ? sancaoRows[0] : null;

  // Categoria-alvo: a informada (se houver) ou a já gravada; sem nenhuma das duas,
  // assume "Sem sanção" para permitir registrar motivo/data/observações.
  let categoria = null;
  if (p.tipoSancao !== undefined) categoria = tipoSancaoParaCategoria(p.tipoSancao);

  // Dias de suspensão (campo separado; só fazem sentido para a categoria "Suspensão").
  // undefined => não altera; null => limpa.
  let dias;
  if (p.diasSuspensao !== undefined) {
    const n = Number(p.diasSuspensao);
    dias = Number.isInteger(n) && n > 0 ? n : null;
  } else if (categoria && categoria.dias) {
    dias = categoria.dias; // compat: rótulo combinado "Suspensão (5 dias)"
  }
  // Informar dias implica a categoria "Suspensão" — mesmo quando o tipo não veio
  // no patch (edição só dos dias) ou quando ainda não há linha de SANCAO. Evita
  // que os dias fiquem órfãos numa categoria que não é suspensão.
  if (dias && dias > 0 && (!categoria || categoria.nome !== "Suspensão")) {
    categoria = { nome: "Suspensão", dias };
  }
  // Trocar para uma categoria que não é suspensão zera os dias.
  if (categoria && categoria.nome !== "Suspensão") dias = null;

  const idCategoria = await resolverIdCategoria(conn, categoria, existente);

  const campos = {
    id_categoria: idCategoria,
    dias_suspensao: dias,
    motivo: p.decisao !== undefined ? texto(p.decisao) : undefined,
    data_sancao: p.dataSancao !== undefined ? paraDataSql(p.dataSancao) : undefined,
    descricao: p.observacoesSancao !== undefined ? texto(p.observacoesSancao) : undefined,
    nome_documento: p.comprovante !== undefined ? texto(p.comprovante) : undefined
    // documento_sancao (BLOB) é gravado só pelo upload do termo (definirTermoSancaoComConn).
  };

  if (existente) {
    const sets = [];
    const vals = [];
    Object.entries(campos).forEach(([col, v]) => {
      if (v !== undefined) { sets.push(`\`${col}\` = ?`); vals.push(v); }
    });
    // Quem aplicou: registra o usuário ao mexer na sanção.
    sets.push("`aplicado_por` = ?"); vals.push(usuario || null);
    vals.push(id);
    await conn.execute(`UPDATE ${T_SANCAO} SET ${sets.join(", ")} WHERE id_pedido = ?`, vals);
  } else {
    await conn.execute(
      `INSERT INTO ${T_SANCAO}
         (id_pedido, id_categoria, dias_suspensao, motivo, data_sancao, aplicado_por, nome_documento, descricao)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, idCategoria,
        dias === undefined ? null : dias,
        campos.motivo === undefined ? null : campos.motivo,
        campos.data_sancao === undefined ? null : campos.data_sancao,
        usuario || null,
        campos.nome_documento === undefined ? null : campos.nome_documento,
        campos.descricao === undefined ? null : campos.descricao
      ]
    );
  }
  return obterPedidoComConn(conn, id);
}

// Resolve o id_categoria a usar: a categoria informada, a já gravada, ou "Sem sanção".
async function resolverIdCategoria(conn, categoria, existente) {
  if (categoria) {
    const [rows] = await conn.query(`SELECT id_categoria FROM ${T_CATEGORIA} WHERE nome = ? LIMIT 1`, [categoria.nome]);
    if (rows && rows[0]) return Number(rows[0].id_categoria);
  }
  if (existente && existente.id_categoria) return Number(existente.id_categoria);
  const [semSancao] = await conn.query(`SELECT id_categoria FROM ${T_CATEGORIA} WHERE nome = 'Sem sanção' LIMIT 1`);
  if (semSancao && semSancao[0]) return Number(semSancao[0].id_categoria);
  throw new Error("Categoria de sanção não configurada no banco.");
}

// ---------- Responsável (assumir/delegar) ----------
async function definirResponsavelComConn(conn, idPedido, responsavelNovo, acao) {
  const id = Number(idPedido);
  if (!id) throw new Error("Pedido inválido.");
  const novo = limparValorDash(responsavelNovo);
  if (!novo) throw new Error("Responsável inválido.");

  const [rows] = await conn.query(`SELECT id_demanda, responsavel_atual FROM ${T_DEMANDA} WHERE id_pedido = ? LIMIT 1`, [id]);
  const demanda = rows && rows[0] ? rows[0] : null;
  if (!demanda) throw new Error("Demanda não encontrada.");

  const anterior = limparValorDash(demanda.responsavel_atual);
  if (anterior === novo) return obterPedidoComConn(conn, id);

  await conn.beginTransaction();
  try {
    await conn.execute(`UPDATE ${T_DEMANDA} SET \`responsavel_atual\` = ? WHERE id_pedido = ?`, [novo, id]);
    await conn.execute(
      `INSERT INTO ${T_HIST} (id_demanda, responsavel_anterior, responsavel_novo, acao)
       VALUES (?, ?, ?, ?)`,
      [demanda.id_demanda, anterior || null, novo, acao || (anterior ? "TRANSFERIU" : "ASSUMIU")]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  }
  return obterPedidoComConn(conn, id);
}

// ---------- Exclusão (cascade para demanda/sanção/anexos/histórico) ----------
async function excluirPedidoComConn(conn, idPedido) {
  const id = Number(idPedido);
  if (!id) throw new Error("Pedido inválido.");
  const [res] = await conn.execute(`DELETE FROM ${T_PEDIDO} WHERE id_pedido = ?`, [id]);
  return { id, removido: (res && res.affectedRows) || 0 };
}

// ---------- Provas (anexos do tipo PROVA, vários por pedido) ----------
// Responsável atual do pedido (para autorizar quem anexa/remove provas).
async function obterResponsavelPedidoComConn(conn, idPedido) {
  const [rows] = await conn.query(`SELECT responsavel_atual FROM ${T_DEMANDA} WHERE id_pedido = ? LIMIT 1`, [Number(idPedido)]);
  return rows && rows[0] ? limparValorDash(rows[0].responsavel_atual) : "";
}

// Responsável do pedido a partir do id de um anexo (para autorizar a remoção).
async function responsavelDoAnexoComConn(conn, idAnexo) {
  const [rows] = await conn.query(
    `SELECT d.responsavel_atual FROM ${T_ANEXO} a
       JOIN ${T_DEMANDA} d ON d.id_pedido = a.id_pedido
      WHERE a.id_anexo = ? LIMIT 1`,
    [Number(idAnexo)]
  );
  return rows && rows[0] ? limparValorDash(rows[0].responsavel_atual) : "";
}

const TIPOS_ANEXO = ["PROVA", "OFICIO", "MEMORANDO", "RELATORIO", "OUTRO"];

// Insere UM arquivo (bytes no banco) com o tipo informado. OFÍCIO é único por
// pedido: remove o anterior antes de inserir (substituição).
async function inserirAnexoConteudoComConn(conn, idPedido, file, tipo, enviadoPor) {
  if (!file || !file.buffer) return;
  const id = Number(idPedido);
  const t = TIPOS_ANEXO.includes(String(tipo)) ? String(tipo) : "PROVA";
  if (t === "OFICIO") {
    await conn.execute(`DELETE FROM ${T_ANEXO} WHERE id_pedido = ? AND tipo_anexo = 'OFICIO'`, [id]);
  }
  const hash = crypto.createHash("sha256").update(file.buffer).digest("hex");
  await conn.execute(
    `INSERT INTO ${T_ANEXO}
       (id_pedido, tipo_anexo, nome_arquivo, caminho_arquivo, mime_type, tamanho_bytes, hash_sha256, conteudo, enviado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, t, file.originalname, file.originalname, file.mimetype || null, file.size || null, hash, file.buffer, enviadoPor || null]
  );
}

// Anexa um ou mais arquivos a um pedido, todos do mesmo tipo. OFÍCIO usa só 1.
async function adicionarAnexosComConn(conn, idPedido, arquivos, tipo, enviadoPor) {
  const id = Number(idPedido);
  if (!id) throw new Error("Pedido inválido.");
  if (!arquivos || !arquivos.length) throw new Error("Nenhum arquivo enviado.");
  const t = TIPOS_ANEXO.includes(String(tipo)) ? String(tipo) : "PROVA";
  const lista = t === "OFICIO" ? arquivos.slice(0, 1) : arquivos;
  for (const f of lista) await inserirAnexoConteudoComConn(conn, id, f, t, enviadoPor);
  return obterPedidoComConn(conn, id);
}

// ---------- Termo / documento comprobatório da sanção (BLOB) ----------
// Grava o arquivo do termo em SANCAO.documento_sancao (BLOB). Só com o pedido
// concluído; cria a linha de SANCAO ("Sem sanção") caso ainda não exista.
async function definirTermoSancaoComConn(conn, idPedido, file, usuario) {
  const id = Number(idPedido);
  if (!id) throw new Error("Pedido inválido.");
  if (!file || !file.buffer) throw new Error("Nenhum arquivo enviado.");

  const [demRows] = await conn.query(`SELECT \`status\` FROM ${T_DEMANDA} WHERE id_pedido = ? LIMIT 1`, [id]);
  if (!demRows || !demRows[0] || demRows[0].status !== "CONCLUIDO") {
    throw new Error("O termo da sanção só pode ser enviado quando o pedido estiver concluído.");
  }

  const [sancaoRows] = await conn.query(`SELECT id_sancao, id_categoria FROM ${T_SANCAO} WHERE id_pedido = ? LIMIT 1`, [id]);
  const existente = sancaoRows && sancaoRows[0] ? sancaoRows[0] : null;

  if (existente) {
    await conn.execute(
      `UPDATE ${T_SANCAO} SET \`documento_sancao\` = ?, \`nome_documento\` = ?, \`aplicado_por\` = ? WHERE id_pedido = ?`,
      [file.buffer, file.originalname || null, usuario || null, id]
    );
  } else {
    const idCategoria = await resolverIdCategoria(conn, null, null);
    await conn.execute(
      `INSERT INTO ${T_SANCAO} (id_pedido, id_categoria, aplicado_por, nome_documento, documento_sancao)
       VALUES (?, ?, ?, ?, ?)`,
      [id, idCategoria, usuario || null, file.originalname || null, file.buffer]
    );
  }
  return obterPedidoComConn(conn, id);
}

// Conteúdo do termo da sanção para download.
async function obterTermoSancaoComConn(conn, idPedido) {
  const id = Number(idPedido);
  if (!id) return null;
  const [rows] = await conn.query(
    `SELECT nome_documento, documento_sancao FROM ${T_SANCAO} WHERE id_pedido = ? LIMIT 1`,
    [id]
  );
  return rows && rows[0] ? rows[0] : null;
}

// Conteúdo de uma prova para download.
async function obterProvaComConn(conn, idAnexo) {
  const id = Number(idAnexo);
  if (!id) return null;
  const [rows] = await conn.query(
    `SELECT nome_arquivo, mime_type, conteudo FROM ${T_ANEXO} WHERE id_anexo = ? LIMIT 1`,
    [id]
  );
  return rows && rows[0] ? rows[0] : null;
}

// Remove uma prova e devolve o pedido atualizado.
async function excluirProvaComConn(conn, idAnexo) {
  const id = Number(idAnexo);
  if (!id) throw new Error("Prova inválida.");
  const [rows] = await conn.query(`SELECT id_pedido FROM ${T_ANEXO} WHERE id_anexo = ? LIMIT 1`, [id]);
  if (!rows || !rows[0]) throw new Error("Prova não encontrada.");
  const idPedido = Number(rows[0].id_pedido);
  await conn.execute(`DELETE FROM ${T_ANEXO} WHERE id_anexo = ?`, [id]);
  return obterPedidoComConn(conn, idPedido);
}

module.exports = {
  listarPedidosComConn,
  obterPedidoComConn,
  listarCategoriasComConn,
  buscarTrabalhadoresComConn,
  criarPedidoComConn,
  atualizarPedidoBaseComConn,
  atualizarDemandaComConn,
  atualizarSancaoComConn,
  definirResponsavelComConn,
  excluirPedidoComConn,
  garantirColunaConteudoProva,
  garantirColunasDatasFasesDemanda,
  garantirColunaDseiPedidoSancao,
  obterResponsavelPedidoComConn,
  responsavelDoAnexoComConn,
  adicionarAnexosComConn,
  obterProvaComConn,
  excluirProvaComConn,
  definirTermoSancaoComConn,
  obterTermoSancaoComConn
};
