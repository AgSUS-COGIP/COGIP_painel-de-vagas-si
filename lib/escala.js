// Domínio: Escala de Trabalho — roster de profissionais.
// Cruza a identidade do trabalhador (VW_SAUDE_INDIGENA) com o polo base já
// mapeado por matrícula (TB_LOTACAO_OVERRIDE), trazendo nome, cargo, DSEI e o
// polo (LOTACAO).
//
// Pipeline igual às demais abas: MySQL -> servidor -> apresentação. O frontend só
// RENDERIZA o que este módulo devolve. As colunas de escala (escala, UBSI,
// período/dias, situação) ainda NÃO têm origem no banco; até existir, são
// preenchidas AQUI (no servidor) com um placeholder determinístico por matrícula,
// para a tela não ficar vazia. Quando a fonte real existir, basta trocar
// `decorarEscala` por leitura das colunas — o frontend não muda.
//
// Desempenho: o conjunto completo (~16k linhas) é lido e decorado UMA vez e
// cacheado por CACHE_SECONDS; o escopo por DSEI e as opções de filtro são
// aplicados em memória por request.
const { DASH_CONFIG } = require("./config");
const { getMysqlConnection, fecharJdbc, obterOuCarregarJsonCache } = require("./db");
const { limparValorDash } = require("./utils");
const { dseiNoEscopo } = require("./escopo");

const SCHEMA = DASH_CONFIG.DB_SCHEMA;
const VIEW = `\`${SCHEMA}\`.\`VW_SAUDE_INDIGENA\``;
const OVERRIDE = `\`${SCHEMA}\`.\`${DASH_CONFIG.LOTACAO_OVERRIDE_TABLE}\``;

// ---- Placeholder determinístico das colunas ainda sem fonte no banco ----
// (remover quando escala/UBSI/período/situação vierem de tabela real)
const TIPOS_TERRITORIO = ["1x1", "2x1", "30x20x10", "20x10"];
function matNum(m) {
  const n = parseInt(String(m).replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}
function fmtDiaMaio(d) {
  const dd = Math.max(1, Math.min(31, d));
  return `${String(dd).padStart(2, "0")}/05/2024`;
}
// A `situacao` é REAL (SITUACAO_DETALHADA_DESC da view, ex.: "Normal", "Férias",
// "Atestado", "Auxilio doença") — NÃO é mockada; vem em `p.situacao` e é
// preservada. O afastamento no calendário é derivado dela no front. Só as colunas
// de escala (escala/alternância/território) são placeholder.
function decorarEscala(p) {
  const m = matNum(p.matricula);
  const row = {
    ...p, ubsi: "", escala: null,
    alternancia: null, tipoTerritorio: null, ida: null, retorno: null, semEscala: false
  };
  if (m % 17 === 0) { row.semEscala = true; return row; }

  const r = m % 20;
  if (r <= 1) row.escala = "territorio";
  else if (r <= 6) row.escala = "noturno";
  else if (r <= 12) row.escala = "diurno";
  else row.escala = "diarista";

  if (row.escala === "territorio") {
    row.tipoTerritorio = TIPOS_TERRITORIO[m % TIPOS_TERRITORIO.length];
    const ini = (m % 18) + 1;
    row.ida = fmtDiaMaio(ini);
    row.retorno = fmtDiaMaio(ini + (m % 12) + 1);
  } else if (row.escala === "diurno" || row.escala === "noturno") {
    // Plantonista (12x36): alternância par/ímpar define os dias do mês escalados.
    row.alternancia = (m % 2 === 0) ? "par" : "impar";
  }
  return row;
}

// Lê o roster completo (sem escopo), decora e cacheia. TODOS os ativos (sem
// DATA_DESLIGAMENTO), inclusive quem ainda NÃO tem lotação mapeada — por isso a
// view é a tabela-base e a TB_LOTACAO_OVERRIDE entra por LEFT JOIN (polo pode
// vir vazio). Uma linha por matrícula (a view pode repetir).
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
         MAX(o.\`LOTACAO\`)                     AS polo
       FROM ${VIEW} v
       LEFT JOIN ${OVERRIDE} o ON o.\`MATRICULA\` = v.\`MATRICULA\`
       WHERE v.\`DATA_DESLIGAMENTO\` IS NULL
       GROUP BY v.\`MATRICULA\`
       ORDER BY nome`
    );

    const profissionais = [];
    const _dseiIds = []; // array paralelo (id do DSEI por linha) — só para o escopo
    for (const r of rows || []) {
      const matricula = String(limparValorDash(r.matricula) || "");
      const nome = limparValorDash(r.nome) || "";
      if (!matricula || !nome) continue;
      profissionais.push(decorarEscala({
        id: matricula,
        matricula,
        nome,
        cargo: limparValorDash(r.cargo) || "",
        dsei: limparValorDash(r.dsei) || "",
        polo: limparValorDash(r.polo) || "",
        situacao: limparValorDash(r.situacao) || ""
      }));
      const idn = Number(limparValorDash(r.idDsei));
      _dseiIds.push(Number.isFinite(idn) ? idn : null);
    }
    return { atualizadoEm: new Date().toISOString(), profissionais, _dseiIds };
  } finally {
    await fecharJdbc(conn);
  }
}

// Opções dos filtros (DSEI, cargo, polo e o mapa polo-por-DSEI para a cascata),
// calculadas sobre o conjunto já filtrado por escopo.
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

module.exports = { getEscalaData };
