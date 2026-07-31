// Domínio: aba "Mapa dos DSEIs".
// Base = VW_SAUDE_INDIGENA (só matrículas dela). Faz LEFT JOIN com
// TB_LOTACAO_OVERRIDE por MATRICULA para trazer a LOTAÇÃO (unidade/polo).
// Matrícula sem lotação no override => lotação em branco.
//
// Mesma estratégia da aba Painel da Força de Trabalho (saude-indigena.js): o
// payload é HÍBRIDO (colunas categóricas -> índice + dicionário; nome/registro
// -> valor cru) para não trafegar MBs de texto repetido, e é cacheado por
// CACHE_SECONDS. A contagem é por REGISTRO distinto (dedup no backend).
const fs = require("fs");
const path = require("path");
const { DASH_CONFIG } = require("./config");
const { getMysqlConnection, fecharJdbc, obterOuCarregarJsonCache } = require("./db");
const { limparValorDash } = require("./utils");
const { filtrarPayloadPorEscopo } = require("./escopo");

const SCHEMA = DASH_CONFIG.DB_SCHEMA;
const VIEW = `\`${SCHEMA}\`.\`VW_SAUDE_INDIGENA\``;
const OVERRIDE = `\`${SCHEMA}\`.\`TB_LOTACAO_OVERRIDE\``;

// LEFT JOIN: mantém TODA matrícula da VW; quem não está no override vem com
// LOTACAO NULL (tratado como "SEM LOTAÇÃO" no dicionário).
const SELECT_MAPA = `
  SELECT
    v.\`CARGO_ATUAL_DESC\`           AS cargo,
    v.\`SITUACAO_DETALHADA_DESC\`    AS situacao,
    v.\`SEXO_DESC\`                  AS sexo,
    v.\`GRAU_INSTRUCAO_DESC\`        AS grauInstrucao,
    v.\`TIPO_ADMISSAO_SI\`           AS tipoAdmissao,
    v.\`LOCAL_TRABALHO_UF\`          AS uf,
    v.\`UNIDADE_ORCAMENTARIA_ID\`    AS idDseiCasai,
    v.\`UNIDADE_ORCAMENTARIA_DESC\`  AS dsei,
    o.\`LOTACAO\`                    AS lotacao,
    v.\`REGISTRO\`                   AS registro,
    v.\`NOME\`                       AS nome
  FROM ${VIEW} v
  LEFT JOIN ${OVERRIDE} o ON o.\`MATRICULA\` = v.\`MATRICULA\`
`;

// Colunas categóricas dicionarizadas (na ordem em que viajam em cada linha).
const DIM_FIELDS = [
  "dsei", "lotacao", "cargo", "situacao", "sexo", "grauInstrucao", "tipoAdmissao", "uf"
];

// Colunas cruas (na ordem em que viajam, após as dicionarizadas).
const RAW_FIELDS = ["registro", "nome"];

function criarInterner() {
  const lista = [];
  const indice = new Map();
  return {
    lista,
    id(valor) {
      const v = valor || "Não informado";
      let i = indice.get(v);
      if (i === undefined) { i = lista.length; lista.push(v); indice.set(v, i); }
      return i;
    }
  };
}

async function getMapaDseisData(escopo) {
  const full = await obterOuCarregarJsonCache(
    DASH_CONFIG.CACHE_MAPA_DSEIS_KEY,
    DASH_CONFIG.CACHE_SECONDS,
    async () => {
      const conn = await getMysqlConnection();
      try {
        const [data] = await conn.query(`${SELECT_MAPA} ORDER BY v.\`NOME\``);

        const interners = {};
        DIM_FIELDS.forEach(f => { interners[f] = criarInterner(); });

        // Contagem sempre por REGISTRO distinto (a view pode repetir o mesmo
        // REGISTRO). Mantém só a 1ª ocorrência de cada REGISTRO.
        const registrosVistos = new Set();
        // Array paralelo (id de DSEI por linha) usado só para o filtro de escopo.
        const dseiIds = [];

        const rows = (data || []).filter(row => {
          const reg = limparValorDash(row.registro);
          if (reg) {
            if (registrosVistos.has(reg)) return false;
            registrosVistos.add(reg);
          }
          return true;
        }).map(row => {
          const dimIdx = [
            interners.dsei.id(limparValorDash(row.dsei)),
            interners.lotacao.id(limparValorDash(row.lotacao) || "SEM LOTAÇÃO"),
            interners.cargo.id(limparValorDash(row.cargo)),
            interners.situacao.id(limparValorDash(row.situacao)),
            interners.sexo.id(limparValorDash(row.sexo)),
            interners.grauInstrucao.id(limparValorDash(row.grauInstrucao)),
            interners.tipoAdmissao.id(limparValorDash(row.tipoAdmissao) || "NORMAL"),
            interners.uf.id(limparValorDash(row.uf) || "—")
          ];
          const raw = [
            limparValorDash(row.registro),
            limparValorDash(row.nome)
          ];
          const idDsei = limparValorDash(row.idDseiCasai);
          dseiIds.push(idDsei !== "" ? Number(idDsei) : null);
          return dimIdx.concat(raw);
        });

        const dim = {};
        DIM_FIELDS.forEach(f => { dim[f] = interners[f].lista; });

        return {
          total: rows.length,
          atualizadoEm: new Date().toISOString(),
          fields: DIM_FIELDS,
          rawFields: RAW_FIELDS,
          dim,
          rows,
          _dseiIds: dseiIds
        };
      } finally {
        await fecharJdbc(conn);
      }
    }
  );
  return filtrarPayloadPorEscopo(full, escopo);
}

// Rede CNES (mock/rede_cnes.json): estabelecimentos por DSEI, com lat/lng e
// município. Serve para geolocalizar os DSEIs nos mapas e cruzar por nome
// (o campo `dsei` do arquivo casa com UNIDADE_ORCAMENTARIA_DESC sem o "DSEI ").
// Lido do disco uma vez (cache em memória).
// Código IBGE de UF (2 primeiros dígitos de uf_codigo) -> sigla, p/ Localização.
const UF_POR_CODIGO = {
  "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO",
  "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL", "28": "SE", "29": "BA",
  "31": "MG", "32": "ES", "33": "RJ", "35": "SP",
  "41": "PR", "42": "SC", "43": "RS",
  "50": "MS", "51": "MT", "52": "GO", "53": "DF"
};
let _redeCache = null;
function getRedeCnes() {
  if (_redeCache) return _redeCache;
  try {
    const raw = fs.readFileSync(path.join(__dirname, "..", "mock", "rede_cnes.json"), "utf8");
    const arr = JSON.parse(raw);
    _redeCache = (arr || []).map(e => ({
      dsei: String(e.dsei || "").trim(),
      nome: String(e.nome_estabelecimento || "").trim(),
      cnes: String(e.cnes || "").trim(),
      lat: Number(e.latitude),
      lng: Number(e.longitude),
      municipio: String(e.municipio || "").trim(),
      uf: UF_POR_CODIGO[String(e.uf_codigo || "").trim().slice(0, 2)] || "",
      grupo: String(e.grupo || "").trim()
    })).filter(e => Number.isFinite(e.lat) && Number.isFinite(e.lng));
  } catch (e) {
    _redeCache = [];
  }
  return _redeCache;
}

// Base territorial indígena (mock/dados_indigenas.json): resumo por DSEI já
// agregado (população indígena, terras indígenas e aldeias) pelo script
// scripts/gerar-dados-indigenas.js — MESMA estratégia do rede_cnes. O vínculo
// com a base de trabalhadores é por nome de DSEI (UNIDADE_ORCAMENTARIA_DESC),
// feito no cliente. Lido do disco uma vez (cache em memória).
let _territorioCache = null;
function getDadosIndigenas() {
  if (_territorioCache) return _territorioCache;
  try {
    const raw = fs.readFileSync(path.join(__dirname, "..", "mock", "dados_indigenas.json"), "utf8");
    const arr = JSON.parse(raw);
    _territorioCache = Array.isArray(arr) ? arr : [];
  } catch (e) {
    _territorioCache = [];
  }
  return _territorioCache;
}

module.exports = { getMapaDseisData, getRedeCnes, getDadosIndigenas };
