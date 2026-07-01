// Domínio: Dashboard Saúde Indígena (nativo).
// Lê a VW_SAUDE_INDIGENA (trabalhadores da Saúde Indígena, ~20k linhas) e entrega
// os dados para o frontend montar KPIs, gráficos, filtros e a tabela geral 100% no
// cliente (mesma estratégia da aba Entrega de Crachá). Para não trafegar ~10MB de
// texto repetido, o payload é HÍBRIDO:
//   - colunas categóricas (baixa cardinalidade) -> índice inteiro + dicionário (dim)
//   - colunas de alta cardinalidade / datas (nome, registro, datas) -> valor cru
// O frontend remonta as linhas (ver saude-indigena.js). Cacheado por CACHE_SECONDS.
const { DASH_CONFIG } = require("./config");
const { getMysqlConnection, fecharJdbc, obterOuCarregarJsonCache } = require("./db");
const { limparValorDash } = require("./utils");
const { filtrarPayloadPorEscopo } = require("./escopo");

const SCHEMA = DASH_CONFIG.DB_SCHEMA;
const VIEW = `\`${SCHEMA}\`.\`VW_SAUDE_INDIGENA\``;

const SELECT_SAUDE = `
  SELECT
    \`CARGO_ATUAL_DESC\`           AS cargo,
    \`SITUACAO_DETALHADA_DESC\`    AS situacao,
    \`SEXO_DESC\`                  AS sexo,
    \`RACA_COR_DESC\`             AS raca,
    \`FAIXA_ETARIA\`              AS faixaEtaria,
    \`TIPO_ATUACAO_TRABALHADOR\`  AS tipoAtuacao,
    \`GRAU_INSTRUCAO_DESC\`       AS grauInstrucao,
    \`TIPO_ADMISSAO_SI\`          AS tipoAdmissao,
    \`LOCAL_TRABALHO_UF\`         AS uf,
    \`UNIDADE_ORCAMENTARIA_ID\`   AS idDseiCasai,
    \`UNIDADE_ORCAMENTARIA_DESC\` AS centroCusto,
    \`LOCAL_TRABALHO_DESC\`       AS localTrabalho,
    \`DESC_AFASTAMENTO\`          AS tipoDesligamento,
    \`IDADE\`                     AS idade,
    \`AFASTAMENTO_SITUACAO\`      AS emAfastamento,
    \`FERIAS_SITUACAO\`           AS emFerias,
    \`REGISTRO\`                  AS registro,
    \`NOME\`                      AS nome,
    \`DATA_NASCIMENTO\`           AS dataNascimento,
    \`DATA_ADMISSAO\`             AS dataAdmissao,
    \`DATA_DESLIGAMENTO\`         AS dataDesligamento,
    \`SITUACAO_DATA_INICIO\`      AS situacaoDataInicio,
    \`SITUACAO_DATA_FIM\`         AS situacaoDataFim,
    \`STATUS_TIPO_ADMISSAO_SI\`   AS statusSubstituicao
  FROM ${VIEW}
`;

// Colunas categóricas dicionarizadas (na ordem em que viajam em cada linha).
const DIM_FIELDS = [
  "cargo", "situacao", "sexo", "raca", "faixaEtaria", "tipoAtuacao",
  "grauInstrucao", "tipoAdmissao", "uf", "centroCusto", "localTrabalho", "tipoDesligamento"
];

// Colunas cruas (na ordem em que viajam, após as dicionarizadas).
const RAW_FIELDS = [
  "idade", "flags", "registro", "nome", "dataNascimento", "dataAdmissao",
  "dataDesligamento", "situacaoDataInicio", "situacaoDataFim", "statusSubstituicao"
];

const FLAG_AFASTAMENTO = 1;
const FLAG_FERIAS = 2;

// Agrupa graus de instrução numa escala curta e legível para o gráfico.
function agruparGrauInstrucao(desc) {
  const v = (desc || "").toLowerCase();
  if (!v) return "Não informado";
  if (v.includes("analfabeto")) return "Sem instrução";
  if (v.includes("doutorado") || v.includes("mestrado") || v.includes("pós") || v.includes("pos")) return "Pós-graduação";
  if (v.includes("superior completa")) return "Superior completo";
  if (v.includes("superior incompleta")) return "Superior incompleto";
  if (v.includes("técnico") || v.includes("tecnico")) return "Técnico";
  if (v.includes("médio completo") || v.includes("medio completo")) return "Médio completo";
  if (v.includes("médio incompleto") || v.includes("medio incompleto")) return "Médio incompleto";
  if (v.includes("fundamental") || v.includes("ano")) return "Fundamental";
  return "Outros";
}

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

function dataIso(valor) {
  const v = limparValorDash(valor);
  // dateStrings:true => "YYYY-MM-DD" (ou "YYYY-MM-DD HH:mm:ss"); guarda só a data.
  return v ? v.slice(0, 10) : "";
}

async function getSaudeIndigenaData(escopo) {
  const full = await obterOuCarregarJsonCache(
    DASH_CONFIG.CACHE_SAUDE_INDIGENA_KEY,
    DASH_CONFIG.CACHE_SECONDS,
    async () => {
      const conn = await getMysqlConnection();
      try {
        const [data] = await conn.query(`${SELECT_SAUDE} ORDER BY \`NOME\``);

        const interners = {};
        DIM_FIELDS.forEach(f => { interners[f] = criarInterner(); });

        // Contagem sempre por REGISTRO distinto: a view pode ter o mesmo REGISTRO
        // repetido (linhas idênticas). Mantém só a 1ª ocorrência de cada REGISTRO.
        const registrosVistos = new Set();

        // Array paralelo (id de DSEI por linha) usado só para o filtro de escopo;
        // não é exposto ao cliente (ver filtrarPayloadPorEscopo).
        const dseiIds = [];

        const rows = (data || []).filter(row => {
          const reg = limparValorDash(row.registro);
          if (reg) {
            if (registrosVistos.has(reg)) return false;
            registrosVistos.add(reg);
          }
          return true;
        }).map(row => {
          let flags = 0;
          if (limparValorDash(row.emAfastamento) === "S") flags |= FLAG_AFASTAMENTO;
          if (limparValorDash(row.emFerias) === "S") flags |= FLAG_FERIAS;

          const grau = agruparGrauInstrucao(limparValorDash(row.grauInstrucao));

          const dimIdx = [
            interners.cargo.id(limparValorDash(row.cargo)),
            interners.situacao.id(limparValorDash(row.situacao)),
            interners.sexo.id(limparValorDash(row.sexo)),
            interners.raca.id(limparValorDash(row.raca)),
            interners.faixaEtaria.id(limparValorDash(row.faixaEtaria)),
            interners.tipoAtuacao.id(limparValorDash(row.tipoAtuacao)),
            interners.grauInstrucao.id(grau),
            interners.tipoAdmissao.id(limparValorDash(row.tipoAdmissao) || "NORMAL"),
            interners.uf.id(limparValorDash(row.uf) || "—"),
            interners.centroCusto.id(limparValorDash(row.centroCusto)),
            interners.localTrabalho.id(limparValorDash(row.localTrabalho)),
            interners.tipoDesligamento.id(limparValorDash(row.tipoDesligamento) || "—")
          ];

          const raw = [
            Math.round(Number(row.idade || 0)) || 0,
            flags,
            limparValorDash(row.registro),
            limparValorDash(row.nome),
            dataIso(row.dataNascimento),
            dataIso(row.dataAdmissao),
            dataIso(row.dataDesligamento),
            dataIso(row.situacaoDataInicio),
            dataIso(row.situacaoDataFim),
            limparValorDash(row.statusSubstituicao)
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

module.exports = { getSaudeIndigenaData };
