// Domínio: Gestão de Férias (análise — somente leitura).
// Cruza os trabalhadores ATIVOS da VW_SAUDE_INDIGENA (mesma regra de vínculo do
// Dashboard SI, por MATRICULA distinta) com o histórico de férias da
// SIP_HISTORICO_AFASTAMENTO (TIPO_AFASTAMENTO = 'Férias'), ligando por MATRICULA
// e considerando só quem existe na VW. Classifica cada trabalhador em um estado
// (Em gozo / Programadas / Concluídas / Sem programação) e calcula o prazo-limite
// de gozo pela CLT (admissão + 24 meses = fim do período concessivo) para os
// alertas de "dobra". NÃO grava nada no banco — apenas consultas.
const { DASH_CONFIG } = require("./config");
const { getMysqlConnection, fecharJdbc, obterOuCarregarJsonCache } = require("./db");
const { limparValorDash } = require("./utils");
const { filtrarPayloadPorEscopo } = require("./escopo");

const SCHEMA = DASH_CONFIG.DB_SCHEMA;
const VW = `\`${SCHEMA}\`.\`VW_SAUDE_INDIGENA\``;
const SIP = `\`${SCHEMA}\`.\`SIP_HISTORICO_AFASTAMENTO\``;

// Mesma regra de "vínculo" do Dashboard SI: estas situações = Desligado.
const SITUACOES_DESLIGADO = new Set([
  "aviso indenizado", "aviso trabalhado", "desligado", "desligamento sem rescisão"
]);
const norm = s => (s || "").trim().toLowerCase();

const DIM_FIELDS = ["cargo", "centro", "situacaoFuncional", "tipoAdmissao", "status", "alerta"];
// feriasLista: TODOS os períodos de férias do trabalhador (cada um com seu status
// individual), para a Consulta Geral exibir uma linha por período. As colunas
// periodoIni/periodoFim seguem sendo o período "principal" (por prioridade), usado
// como resumo/fallback. O status/alerta do trabalhador (DIM_FIELDS) continua sendo
// o do nível da PESSOA — é o que alimenta os KPIs (que contam trabalhadores).
const RAW_FIELDS = ["matricula", "registro", "nome", "admissao", "periodoIni", "periodoFim", "limiteGozo", "dias", "feriasLista"];

// CLT: período concessivo encerra 24 meses após o início do período aquisitivo
// (admissão, para quem ainda não gozou nenhuma férias). Após esse prazo, dobra.
const MESES_LIMITE_GOZO = 24;

function hojeSP() {
  // Data atual no fuso America/Sao_Paulo, no formato YYYY-MM-DD.
  return new Date().toLocaleDateString("en-CA", { timeZone: DASH_CONFIG.TIMEZONE });
}

function isoData(valor) {
  const v = limparValorDash(valor);
  return v ? v.slice(0, 10) : "";
}

function somarMeses(iso, meses) {
  const [a, m, d] = iso.split("-").map(Number);
  if (!a || !m || !d) return "";
  const base = new Date(Date.UTC(a, m - 1 + meses, d));
  return base.toISOString().slice(0, 10);
}

function diasEntre(isoA, isoB) {
  // isoB - isoA em dias (inteiro).
  const [a1, m1, d1] = isoA.split("-").map(Number);
  const [a2, m2, d2] = isoB.split("-").map(Number);
  const tA = Date.UTC(a1, m1 - 1, d1);
  const tB = Date.UTC(a2, m2 - 1, d2);
  return Math.round((tB - tA) / 86400000);
}

function criarInterner() {
  const lista = [];
  const indice = new Map();
  return {
    lista,
    id(v) {
      const x = v || "Não informado";
      let i = indice.get(x);
      if (i === undefined) { i = lista.length; lista.push(x); indice.set(x, i); }
      return i;
    }
  };
}

function bucketAlerta(dias) {
  if (dias === null) return "";
  if (dias < 30) return "Menos de 30 dias";
  if (dias < 90) return "Menos de 90 dias";
  if (dias < 180) return "Menos de 180 dias";
  return "";
}

// Status de UM período de férias (não do trabalhador): comparação por data ISO.
function statusPeriodo(f, hoje) {
  if (f.ini <= hoje && f.fim >= hoje) return "Em gozo";
  if (f.ini > hoje) return "Programadas";
  return "Concluídas"; // f.fim < hoje
}

async function getFeriasData(escopo) {
  const full = await obterOuCarregarJsonCache(
    DASH_CONFIG.CACHE_FERIAS_KEY,
    DASH_CONFIG.CACHE_SECONDS,
    async () => {
      const conn = await getMysqlConnection();
      try {
        const hoje = hojeSP();

        // Trabalhadores (todas as linhas; deduplicamos por MATRICULA mantendo a 1ª).
        const [ativosRaw] = await conn.query(`
          SELECT \`MATRICULA\` AS matricula, \`REGISTRO\` AS registro, \`NOME\` AS nome,
                 \`CARGO_ATUAL_DESC\` AS cargo, \`UNIDADE_ORCAMENTARIA_DESC\` AS centro,
                 \`UNIDADE_ORCAMENTARIA_ID\` AS idDseiCasai,
                 \`DATA_ADMISSAO\` AS admissao, \`SITUACAO_DETALHADA_DESC\` AS situacao,
                 \`TIPO_ADMISSAO_SI\` AS tipoAdmissao
          FROM ${VW}
          ORDER BY \`NOME\`
        `);

        // Férias (só de quem existe na VW), agrupadas por matrícula no JS.
        const [feriasRaw] = await conn.query(`
          SELECT h.\`MATRICULA\` AS matricula,
                 DATE_FORMAT(h.\`DATA_INICIO\`, '%Y-%m-%d') AS ini,
                 DATE_FORMAT(h.\`DATA_FIM\`, '%Y-%m-%d') AS fim,
                 h.\`DIAS_ABONO\` AS abono
          FROM ${SIP} h
          WHERE h.\`TIPO_AFASTAMENTO\` = 'Férias'
            AND EXISTS (SELECT 1 FROM ${VW} v WHERE v.\`MATRICULA\` = h.\`MATRICULA\`)
        `);

        // Agrupa férias por matrícula.
        const feriasPorMat = new Map();
        for (const r of feriasRaw) {
          const mat = String(r.matricula);
          const ini = isoData(r.ini), fim = isoData(r.fim);
          if (!ini || !fim) continue;
          if (!feriasPorMat.has(mat)) feriasPorMat.set(mat, []);
          feriasPorMat.get(mat).push({ ini, fim, abono: Number(r.abono) || 0 });
        }

        const interners = {};
        DIM_FIELDS.forEach(f => { interners[f] = criarInterner(); });

        const vistos = new Set();
        const rows = [];
        // Array paralelo (id de DSEI por linha) só para o filtro de escopo; não vai
        // ao cliente (ver filtrarPayloadPorEscopo).
        const dseiIds = [];

        for (const t of ativosRaw) {
          const mat = String(limparValorDash(t.matricula));
          if (!mat || vistos.has(mat)) continue;       // distinto por MATRICULA
          vistos.add(mat);
          // Só trabalhadores ATIVOS (regra de vínculo do Dashboard SI).
          if (SITUACOES_DESLIGADO.has(norm(t.situacao))) continue;

          const admissao = isoData(t.admissao);
          // Admissão programada (data de admissão no futuro): ainda não começou a
          // trabalhar, então NÃO entra na Gestão de Férias.
          if (admissao && admissao > hoje) continue;
          const ferias = feriasPorMat.get(mat) || [];

          // Classifica o estado por prioridade: Em gozo > Programadas > Concluídas > Sem programação.
          let status = "Sem programação";
          let periodoIni = "", periodoFim = "";

          const emGozo = ferias.filter(f => f.ini <= hoje && f.fim >= hoje).sort((a, b) => b.fim.localeCompare(a.fim))[0];
          const futura = ferias.filter(f => f.ini > hoje).sort((a, b) => a.ini.localeCompare(b.ini))[0];
          const passada = ferias.filter(f => f.fim < hoje).sort((a, b) => b.fim.localeCompare(a.fim))[0];

          if (emGozo) { status = "Em gozo"; periodoIni = emGozo.ini; periodoFim = emGozo.fim; }
          else if (futura) { status = "Programadas"; periodoIni = futura.ini; periodoFim = futura.fim; }
          else if (passada) { status = "Concluídas"; periodoIni = passada.ini; periodoFim = passada.fim; }

          // Lista COMPLETA de períodos (cada um com seu status), em ordem cronológica.
          // É o que a Consulta Geral usa para mostrar uma linha por período.
          const feriasLista = ferias
            .map(f => ({ ini: f.ini, fim: f.fim, status: statusPeriodo(f, hoje), abono: Number(f.abono) || 0 }))
            .sort((a, b) => a.ini.localeCompare(b.ini));

          // Prazo-limite de gozo (CLT) e dias restantes — só para Sem programação.
          let limiteGozo = "", dias = null;
          if (status === "Sem programação" && admissao) {
            limiteGozo = somarMeses(admissao, MESES_LIMITE_GOZO);
            dias = diasEntre(hoje, limiteGozo);
          }
          const alerta = bucketAlerta(dias);

          rows.push([
            interners.cargo.id(limparValorDash(t.cargo)),
            interners.centro.id(limparValorDash(t.centro)),
            interners.situacaoFuncional.id(limparValorDash(t.situacao)),
            interners.tipoAdmissao.id(limparValorDash(t.tipoAdmissao) || "NORMAL"),
            interners.status.id(status),
            interners.alerta.id(alerta || "—"),
            Number(mat) || 0,
            limparValorDash(t.registro),
            limparValorDash(t.nome),
            admissao,
            periodoIni,
            periodoFim,
            limiteGozo,
            dias === null ? "" : dias,
            feriasLista
          ]);
          const idDsei = limparValorDash(t.idDseiCasai);
          dseiIds.push(idDsei !== "" ? Number(idDsei) : null);
        }

        const dim = {};
        DIM_FIELDS.forEach(f => { dim[f] = interners[f].lista; });

        return {
          total: rows.length,
          atualizadoEm: new Date().toISOString(),
          hoje,
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

module.exports = { getFeriasData };
