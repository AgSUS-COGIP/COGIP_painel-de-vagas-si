// =========================================================
// Processos Seletivos (dados reais dos editais)
// Aba autocontida, alimentada por dados reais embutidos
// (processos-seletivos-dados.js, gerado a partir do CSV oficial).
//   - Tabela: Unidade, UF, Edital, Data de Início, Data fim
//     (vigência), Status e Responsável.
//   - Detalhes (painel abaixo): as demais colunas do edital
//     (Processo SEI, Ciclo, Etapa, Risco, Vagas Previstas,
//     Contratados, Vagas Ociosas, Inscritos, Observações e o
//     link do edital).
// Registra os ouvintes em configurarProcessosSeletivos(),
// chamado no init do app. Somente leitura (sem cadastro).
// =========================================================
import { escapeAttr, escapeHtml, debounce, safeUrl, isoParaDataBr } from "./utils.js";
import { preencherSelect, criarToast } from "./ui-utils.js";
import { abrirModal } from "./modal.js";
import { nivelModulo } from "./permissoes.js";
import { criarTabelaArrastavel } from "./tabela-arrastavel.js";

// Adicionar/editar edital e inserir anexo exigem Editor (>= 2) no módulo;
// o Leitor só visualiza (tabela + detalhes).
const NIVEL_EDITOR_PS = 2;
function podeEditarProcessos() {
  return nivelModulo("processosSeletivos") >= NIVEL_EDITOR_PS;
}

// ---------- Status (conforme o CSV) e badges ----------
// "Em Andamento" e "Andamento" são tratados como o mesmo status.
function normalizarStatus(s) {
  const v = String(s || "").trim();
  if (/^em\s+andamento$/i.test(v)) return "Andamento";
  return v || "—";
}

const BADGE_STATUS = {
  "Concluído": "is-andamento",              // verde: finalizado
  "Andamento": "is-breve",                  // laranja: em curso
  "Aguardando Convocação": "is-aguardando", // azul: aguardando convocação
  "Cancelado": "is-encerrado",              // vermelho: cancelado
  "Encerrando em Breve": "is-encerrando",   // âmbar: a ≤30 dias da data fim (vigência)
  "Vencido": "is-vencido"                   // vermelho escuro: data fim (vigência) já passou
};

// Status que congelam o DSEI para fins de Remanejamento: enquanto houver um
// processo seletivo em andamento naquela unidade, a redução de vagas fica
// bloqueada (ver remanejamento.js). O cruzamento é feito pelo NOME da unidade.
const STATUS_BLOQUEIA_REMANEJAMENTO = ["Andamento"];

const POR_PAGINA = 10;

// Editais carregados do banco (via /api/processos-seletivos/editais). Populado
// por carregarDoBanco() no init e recarregado após cada mutação persistida.
let processos = [];

// ---------- Estado da aba ----------
let paginaAtual = 1;
let processoExpandido = null; // id do edital com detalhamento aberto
let gradePs = null;           // grade Tabulator da tabela principal (só colunas)

// Dados de vagas/cronograma extraídos de anexos PDF enviados pelo usuário,
// por id de edital: { cargos: [...], cronograma: [...] }. Apenas em memória
// (não persiste; some ao recarregar a página).
const anexosExtraidos = new Map();
let editandoId = null;      // edital em edição no assistente (null = novo cadastro)
let wizardPasso = 1;        // passo atual do assistente (1..3)
let wizardModo = "edital";  // "edital" (criar/editar) | "anexo" (só inserir anexo)

// ---------- Aprovados por vaga (protótipo em memória) ----------
// dadosAprovados.get(editalId) = {
//   configClassificacao: { mostrarPosicoes, intervaloCota } | null,
//   aprovadosPorCargo: Map<cargoKey, Candidato[]>   // cargoKey = normChave(nomeCargo)
// }
// Candidato = { id, nome, nota:number|null, tipo, status, docDesistencia:{url,nome}|null }
// Tudo em memória: some ao recarregar (mesmo padrão de anexosExtraidos). Editais
// criados na sessão (id "novo-*") só guardam aprovados enquanto a página viver.
const dadosAprovados = new Map();
const CONFIG_PADRAO = { mostrarPosicoes: true, intervaloCota: 0 };
let vagaSelecionada = null;  // nome do cargo com o painel de aprovados aberto
let cronoExpandido = false;  // widget "Etapa atual": true = mostra o cronograma completo
let gradeAprovados = null;   // grade Tabulator dos aprovados (edição inline por célula)
let aprovadoFocoId = null;   // id do aprovado recém-criado: abre a edição do Nome ao montar
let configEditalId = null;   // edital alvo do modal de configuração

const $ = id => document.getElementById(id);

// Toast reaproveitando o visual compartilhado (mesma classe das outras abas).
const psToast = criarToast("psToast", { className: "gfToast" });

// ---------- Camada de dados (banco) ----------
// Chamada JSON à API do módulo. Lança Error com a mensagem do servidor em falha.
async function psApi(metodo, path, corpo) {
  const opts = { method: metodo, credentials: "same-origin", headers: { Accept: "application/json" } };
  if (corpo !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(corpo); }
  const resp = await fetch(path, opts);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `Erro ${resp.status}`);
  return data;
}

// Recarrega editais do banco e re-hidrata as estruturas em memória usadas pelo
// render (processos, anexosExtraidos = {cargos, cronograma}, dadosAprovados).
async function carregarDoBanco() {
  const { editais } = await psApi("GET", "/api/processos-seletivos/editais");
  processos = (editais || []).map(e => ({
    id: e.id, unidade: e.unidade, uf: e.uf, edital: e.edital,
    dataInicio: e.dataInicio, dataEncerramento: e.dataEncerramento,
    status: normalizarStatus(e.status), observacoes: e.observacoes || "",
    linkEdital: e.linkEdital || "", etapa: e.etapa || "",
    vagasImediatas: Number(e.vagasImediatas || 0),   // total do quadro (derivado no back)
    temCadastroReserva: !!e.temCadastroReserva,      // "+ CR"
    vagasPrevistas: Number(e.vagasPrevistas || 0)    // número escolhido pelo usuário
  }));
  anexosExtraidos.clear();
  dadosAprovados.clear();
  (editais || []).forEach(e => {
    const cargos = e.cargos || [], cronograma = e.cronograma || [];
    if (cargos.length || cronograma.length) anexosExtraidos.set(e.id, { cargos, cronograma });
    (e.aprovados || []).forEach(a => {
      aprovadosDoCargo(e.id, a.cargo).push({
        id: a.id, nome: a.nome, nota: a.nota, tipo: a.tipo, status: a.status, docDesistencia: null
      });
    });
  });
}

// vagaId (DB) do cargo selecionado — necessário para persistir aprovados.
function vagaIdDoCargo(editalId, nomeCargo) {
  const extra = anexosExtraidos.get(editalId);
  const chave = normChave(nomeCargo);
  const c = extra && extra.cargos && extra.cargos.find(x => normChave(x.cargo) === chave);
  return c ? c.vagaId : null;
}

// Recarrega do banco e re-renderiza tudo. Usado no init, ao abrir a aba e após
// cada mutação persistida.
async function recarregar(silencioso) {
  try {
    await carregarDoBanco();
  } catch (e) {
    console.warn("[processos] falha ao carregar do banco:", e && e.message ? e.message : e);
    // No init roda para todos (mesmo sem permissão no módulo) — não incomoda com toast.
    if (!silencioso) psToast("Não foi possível carregar os editais do banco.");
  }
  renderTudo();
}

// ---------- Bloqueio de Remanejamento por PSS em andamento ----------
// Retorna: [{ dsei, cargos: [string], processos: [string] }]
// (o CSV não traz cargos, então cargos vem vazio — bloqueia a unidade inteira)
export function obterBloqueiosRemanejamentoPSS() {
  const mapa = new Map();
  (processos || []).forEach(proc => {
    if (!STATUS_BLOQUEIA_REMANEJAMENTO.includes(proc.status)) return;
    const nomeDsei = String(proc.unidade || "").trim();
    if (!nomeDsei) return;
    const chave = nomeDsei.toLowerCase();
    if (!mapa.has(chave)) {
      mapa.set(chave, { dsei: nomeDsei, cargos: new Set(), processos: [] });
    }
    mapa.get(chave).processos.push(proc.edital || proc.id || "Processo seletivo");
  });
  return [...mapa.values()].map(item => ({
    dsei: item.dsei,
    cargos: [...item.cargos],
    processos: item.processos
  }));
}

// ---------- Helpers ----------
// Status efetivo (exibido): o status é definido pelo USUÁRIO (campo `status`) —
// NÃO é derivado automaticamente do cronograma nem da vigência. A única
// sobreposição automática é o aviso visual "Encerrando em Breve", quando faltam
// ≤30 dias para a data fim (vigência). "Cancelado" tem prioridade e nunca é
// sobreposto. É o valor usado no badge (tabela + detalhe), nos KPIs e no filtro
// de status — assim status e KPIs sempre batem.
function statusEfetivo(proc) {
  if (!proc) return "—";
  if (proc.status === "Cancelado") return "Cancelado";
  const dias = diasAteVigencia(proc.dataEncerramento);
  if (dias !== null && dias >= 0 && dias <= 30) return "Encerrando em Breve";
  return proc.status || "Andamento";
}

function badgeStatus(status) {
  const cls = BADGE_STATUS[status] || "is-naoiniciado";
  return `<span class="psBadge ${cls}">${escapeHtml(status)}</span>`;
}

// "2025-06-09" -> "09/06/2025"; "—" quando vazio/inválido. Vem de utils.js.
const isoParaBr = (iso) => isoParaDataBr(iso, "—");

const numFmt = n => Number(n || 0).toLocaleString("pt-BR");

// ---------- Colunas da tabela principal (Tabulator, só colunas) ----------
// O clique na linha abre/recolhe o detalhe (aoClicarLinha → alternarDetalhe);
// a linha aberta fica destacada via idSelecionado (classe tab-selected). O
// chevron acompanha o estado lendo processoExpandido no formatter.
const PS_COLS = [
  { title: "DSEI/CASAI", field: "unidade", cssClass: "psCelNome", minWidth: 200,
    formatter: c => escapeHtml(c.getValue() || "—") },
  { title: "UF", field: "uf", hozAlign: "center", formatter: c => escapeHtml(c.getValue() || "—") },
  { title: "Edital", field: "edital", hozAlign: "center", formatter: c => escapeHtml(c.getValue() || "—") },
  { title: "Data de Início", field: "dataInicio", hozAlign: "center", formatter: c => isoParaBr(c.getValue()) },
  { title: "Data de Divulgação do Resultado Final", field: "dataDivulgacaoResultado", hozAlign: "center", minWidth: 180,
    formatter: c => escapeHtml(dataDivulgacaoResultado(c.getRow().getData()) || "—") },
  { title: "Data fim (vigência)", field: "dataEncerramento", hozAlign: "center", formatter: c => isoParaBr(c.getValue()) },
  // Status é a última coluna: leva o chevron de expandir/recolher a linha.
  { title: "Status", field: "status", minWidth: 140, formatter: c => {
      const aberto = processoExpandido === c.getRow().getData().id;
      return `<div class="psRespCel"><span>${badgeStatus(statusEfetivo(c.getRow().getData()))}</span>` +
        `<i class="fa-solid fa-chevron-down psRowChevron ${aberto ? "is-aberto" : ""}" aria-hidden="true"></i></div>`;
    } }
];

// ---------- Filtro + busca ----------
function processosFiltrados() {
  const unidade = $("psFiltroUnidade")?.value || "";
  const status = $("psFiltroStatus")?.value || "";
  const termo = ($("psBusca")?.value || "").trim().toLowerCase();
  return processos.filter(p => {
    if (unidade && p.unidade !== unidade) return false;
    if (status && statusEfetivo(p) !== status) return false;
    if (termo) {
      const alvo = `${p.unidade} ${p.uf} ${p.edital} ${p.processoSei} ${p.status} ${statusEfetivo(p)} ${p.etapa} ${p.ciclo}`.toLowerCase();
      if (!alvo.includes(termo)) return false;
    }
    return true;
  });
}

// ---------- KPIs ----------
// A data fim (vigência) é o campo dataEncerramento — a validade do edital após
// a divulgação do resultado final. A partir dela derivamos dois KPIs:
//   "Encerrando em Breve": a data fim chega nos próximos 30 dias (0 a 30 dias).
//   "Vencido": a data fim já passou.
// Editais cancelados não entram nessas contagens (não têm vigência ativa).
const MS_DIA = 86400000;

// Hoje às 00:00 (comparações por dia).
function hojeZerado() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }

// Dias entre hoje e a data fim (vigência); negativo se já passou; null se inválida.
function diasAteVigencia(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "").trim());
  if (!m) return null;
  const fim = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.round((fim - hoje) / MS_DIA);
}

function renderKpis() {
  // Conta pelo status EFETIVO (mesma regra do badge), então cada edital cai em um
  // único KPI e os cartões batem com a coluna Status: um edital "Concluído" a ≤30
  // dias da vigência sai de "Concluídos" e entra em "Encerrando em Breve".
  const efetivos = processos.map(statusEfetivo);
  const conta = status => efetivos.filter(s => s === status).length;
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set("psKpiTotal", processos.length);
  set("psKpiAndamento", conta("Andamento"));
  set("psKpiConcluido", conta("Concluído"));
  set("psKpiEncerrando", conta("Encerrando em Breve"));
  set("psKpiVencido", conta("Vencido"));
  set("psKpiCancelado", conta("Cancelado"));
  set("psKpiVagas", numFmt(processos.reduce((s, p) => s + Number(p.vagasPrevistas || 0), 0)));
}

// ---------- Selects de filtro ----------
function preencherFiltros() {
  const unidades = [...new Set(processos.map(p => p.unidade).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  preencherSelect("psFiltroUnidade", unidades, "Todas as unidades");

  const statuses = [...new Set(processos.map(statusEfetivo).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  preencherSelect("psFiltroStatus", statuses, "Todos os status");
}

// ---------- Tabela ----------
function renderTabela() {
  const body = $("psTabelaBody");
  if (!body) return;

  const lista = processosFiltrados();
  const totalPaginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  if (paginaAtual > totalPaginas) paginaAtual = totalPaginas;
  const inicio = (paginaAtual - 1) * POR_PAGINA;
  const pagina = lista.slice(inicio, inicio + POR_PAGINA);

  // Monta a grade Tabulator uma vez; depois só realimenta com a página atual.
  // Mantemos a paginação/contador existentes (a grade recebe só as linhas da
  // página). O clique na linha abre o detalhe; a linha aberta fica destacada.
  if (!gradePs) {
    gradePs = criarTabelaArrastavel({
      elemento: "psTabelaBody",
      colunas: PS_COLS,
      persistID: "psEditaisV3", // V3: descarta o layout salvo com o título antigo "Unidade"
      indexField: "id",
      movableRows: false,
      aoClicarLinha: row => alternarDetalhe(row.id),
      idSelecionado: () => processoExpandido,
      vazio: "Nenhum edital encontrado para os filtros selecionados."
    });
  }
  gradePs?.render(pagina);

  const contador = $("psContador");
  if (contador) {
    if (!lista.length) {
      contador.textContent = "Nenhum edital cadastrado.";
    } else {
      const fim = Math.min(inicio + POR_PAGINA, lista.length);
      contador.textContent = `Mostrando ${inicio + 1} a ${fim} de ${lista.length} edital(is)`;
    }
  }

  renderPaginacao(totalPaginas);
}

function renderPaginacao(totalPaginas) {
  const wrap = $("psPaginacao");
  if (!wrap) return;
  if (totalPaginas <= 1) { wrap.innerHTML = ""; return; }

  let botoes = "";
  for (let i = 1; i <= totalPaginas; i += 1) {
    botoes += `<button type="button" class="psPagBtn ${i === paginaAtual ? "is-ativo" : ""}" data-ps-pagina="${i}">${i}</button>`;
  }
  wrap.innerHTML = `
    <button type="button" class="psPagBtn" data-ps-pagina="${Math.max(1, paginaAtual - 1)}" ${paginaAtual === 1 ? "disabled" : ""}>
      <i class="fa-solid fa-chevron-left"></i>
    </button>
    ${botoes}
    <button type="button" class="psPagBtn" data-ps-pagina="${Math.min(totalPaginas, paginaAtual + 1)}" ${paginaAtual === totalPaginas ? "disabled" : ""}>
      <i class="fa-solid fa-chevron-right"></i>
    </button>`;
}

// ---------- Detalhamento do edital ----------
function linhaInfo(rotulo, valor) {
  return `<div class="psInfoItem"><span class="psInfoLabel">${escapeHtml(rotulo)}</span><span class="psInfoValor">${valor}</span></div>`;
}

// ---------- Quadro de Vagas Previstas (cargos do edital) ----------
// Normaliza o nome (sem acentos, minúsculo) para casar a vaga selecionada
// com o cargo da tabela.
function normChave(s) {
  return String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

function cargosDoEdital(proc) {
  if (!proc) return [];
  // Os cargos vêm do anexo (PDF) extraído para este edital.
  const extra = anexosExtraidos.get(proc.id);
  if (extra && extra.cargos && extra.cargos.length) return extra.cargos;
  return [];
}

// Vagas imediatas = total do quadro de vagas (soma das cotas de cada cargo).
function vagasImediatasEdital(proc) {
  return cargosDoEdital(proc).reduce((s, c) =>
    s + (Number(c.ampla) || 0) + (Number(c.pcd) || 0) + (Number(c.pretosPardos) || 0) + (Number(c.indigenas) || 0) + (Number(c.quilombolas) || 0), 0);
}

// Colunas possíveis do quadro, na ordem de exibição. Só são renderizadas
// as que tiverem ao menos um valor preenchido no edital (os editais variam:
// alguns trazem só "Vagas", outros o detalhamento por cota).
const COLUNAS_VAGAS = [
  { campo: "vagas", rotulo: "Vagas" },
  { campo: "ampla", rotulo: "Ampla Concorrência" },
  { campo: "pcd", rotulo: "PcD" },
  { campo: "pretosPardos", rotulo: "Pretos/Pardos" },
  { campo: "indigenas", rotulo: "Indígenas" },
  { campo: "quilombolas", rotulo: "Quilombolas" },
  { campo: "ppiq", rotulo: "PPIQ" },
  { campo: "total", rotulo: "Total" },
  { campo: "lotacao", rotulo: "Lotação" }
];

// Considera "vazio" células em branco ou com travessão.
function celulaVazia(v) {
  const s = String(v ?? "").trim();
  return s === "" || s === "-" || s === "—";
}

function renderQuadroVagas(proc) {
  const cargos = cargosDoEdital(proc);
  if (!cargos.length) {
    return `
      <div class="psBloco psBlocoFull">
        <h4 class="psBlocoTitulo">Vagas Previstas</h4>
        <p class="psObservacoes"><span class="psSemObs">Quadro de cargos não disponível para este edital. Use “Inserir anexo” para extrair as vagas do PDF.</span></p>
      </div>`;
  }

  const extra = anexosExtraidos.get(proc?.id);
  const viaAnexo = extra && extra.cargos && extra.cargos.length
    ? ` · <span class="psBlocoFonte"><i class="fa-solid fa-file-arrow-up"></i> via anexo enviado</span>`
    : "";

  return `
    <div class="psBloco psBlocoFull">
      <div class="psBlocoHead">
        <h4 class="psBlocoTitulo">Vagas Previstas</h4>
        <span class="psBlocoMeta">${cargos.length} cargo(s) no edital${viaAnexo} · selecione uma vaga para gerenciar os aprovados</span>
      </div>
      <div id="psVagasTab"></div>
      ${renderPainelAprovados(proc)}
    </div>`;
}

// Grade "Vagas Previstas" (Tabulator só-estilo). Colunas dinâmicas: só as de
// COLUNAS_VAGAS com algum valor no edital. Clique na linha seleciona a vaga
// (abre o painel de aprovados); a vaga selecionada fica destacada. Última
// coluna "Fila" = nº de aprovados da vaga (sem field, lê a linha no formatter).
function montarQuadroVagas(proc) {
  const cargos = cargosDoEdital(proc);
  if (!cargos.length || !$("psVagasTab")) return;
  const colunas = COLUNAS_VAGAS.filter(c => cargos.some(cargo => !celulaVazia(cargo[c.campo])));
  const ehNumerica = campo => campo !== "lotacao";
  const cols = [
    { title: "Cargo", field: "cargo", cssClass: "psCelNome", minWidth: 200, formatter: c => {
        const aberto = !!vagaSelecionada && normChave(c.getValue()) === normChave(vagaSelecionada);
        return `${escapeHtml(c.getValue())} <i class="fa-solid fa-chevron-down psRowChevron ${aberto ? "is-aberto" : ""}" aria-hidden="true"></i>`;
      } },
    ...colunas.map(col => ({
      title: col.rotulo, field: col.campo, hozAlign: ehNumerica(col.campo) ? "center" : "left",
      // Cota sem vaga imediata (valor 0) é Cadastro Reserva: mostra "CR" no lugar
      // do 0. Célula em branco continua "—"; texto (ex.: Lotação) não é afetado.
      formatter: c => {
        const v = c.getValue();
        if (celulaVazia(v)) return "—";
        if (ehNumerica(col.campo) && Number(v) === 0) return "CR";
        return escapeHtml(v);
      }
    })),
    { title: "Fila", hozAlign: "center", minWidth: 70,
      formatter: c => String(filaDoCargo(proc.id, c.getRow().getData().cargo)) }
  ];
  criarTabelaArrastavel({
    elemento: "psVagasTab",
    colunas: cols,
    persistID: "psVagas",
    indexField: "cargo",
    movableColumns: false,
    movableRows: false,
    aoClicarLinha: row => selecionarVaga(row.cargo),
    idSelecionado: () => vagaSelecionada,
    dados: cargos
  });
}

// ---------- Cronograma do edital (atividades e datas) ----------
// O cronograma vem do anexo (PDF) extraído para este edital.
function cronogramaDoEdital(proc) {
  if (!proc) return [];
  const extra = anexosExtraidos.get(proc.id);
  if (extra && extra.cronograma && extra.cronograma.length) return extra.cronograma;
  return [];
}

// Extrai as datas do TEXTO de uma etapa do cronograma. Trata data única
// ("30/07/2026"), intervalos ("22 a 24/06/2026") e listas ("31/07 e 01/08/2026").
// Dias sem mês/ano herdam do primeiro token completo do próprio texto.
// Retorna { inicio, fim } (Date | null); fim = inicio quando há só uma data.
function parseDatasCronograma(texto) {
  const tokens = String(texto || "").match(/\d{1,2}(?:\/\d{1,2}(?:\/\d{2,4})?)?/g);
  if (!tokens) return { inicio: null, fim: null };
  let refMes = null, refAno = null; // referência (mês/ano) do token mais completo
  tokens.forEach(t => {
    const p = t.split("/");
    if (p.length >= 2) refMes = Number(p[1]);
    if (p.length >= 3) refAno = Number(p[2].length === 2 ? "20" + p[2] : p[2]);
  });
  const datas = tokens.map(t => {
    const p = t.split("/");
    const dia = Number(p[0]);
    const mes = p.length >= 2 ? Number(p[1]) : refMes;
    const ano = p.length >= 3 ? Number(p[2].length === 2 ? "20" + p[2] : p[2]) : refAno;
    if (!dia || !mes || !ano) return null;
    const d = new Date(ano, mes - 1, dia); d.setHours(0, 0, 0, 0);
    return isNaN(d) ? null : d;
  }).filter(Boolean).sort((a, b) => a - b);
  if (!datas.length) return { inicio: null, fim: null };
  return { inicio: datas[0], fim: datas[datas.length - 1] };
}

// Índice da etapa atual: a de maior data de INÍCIO que já começou (início <= hoje).
// Uma etapa com intervalo vale durante o intervalo; com data única, vale a partir
// dela até a próxima começar. Retorna -1 se nenhuma começou.
function indiceEtapaAtual(cronograma) {
  const hoje = hojeZerado();
  let idx = -1, melhor = null;
  (cronograma || []).forEach((e, i) => {
    const { inicio } = parseDatasCronograma(e.data);
    if (inicio && inicio <= hoje && (!melhor || inicio > melhor)) { idx = i; melhor = inicio; }
  });
  return idx;
}

// Data de divulgação do resultado final: a data da etapa do cronograma cuja
// ATIVIDADE é o "Resultado Final do Processo Seletivo". Antes usávamos a última
// data do cronograma, mas etapas posteriores (homologação, convocação, posse…)
// resultavam numa data tarde demais. O casamento é por texto normalizado (sem
// acento/caixa): primeiro a frase completa; como reserva, qualquer "resultado
// final" (pega a ÚLTIMA ocorrência, para não cair em recurso/preliminar antes).
// Sem etapa correspondente (ou sem anexo), retorna "" e a coluna mostra "—" — aí
// basta usar "Ajustar cronograma" para nomear/ajustar a etapa. A data é a string
// crua do PDF (mesmo texto exibido na tabela do cronograma).
function dataDivulgacaoResultado(proc) {
  const etapas = cronogramaDoEdital(proc);
  const exato = etapas.find(e => normChave(e?.atividade).includes("resultado final do processo seletivo"));
  if (exato) return String(exato.data || "").trim();
  for (let i = etapas.length - 1; i >= 0; i--) {
    if (normChave(etapas[i]?.atividade).includes("resultado final")) return String(etapas[i].data || "").trim();
  }
  return "";
}

// Tabela completa do cronograma (mostrada quando o widget "Etapa atual" expande).
// Vira um Tabulator SÓ-ESTILO (sem mover linhas/colunas): aqui só emitimos o
// container; a grade é montada por montarCronograma() depois do innerHTML do
// detalhe (precisa estar visível para o Tabulator medir as colunas).
function cronogramaTabelaHtml(proc) {
  const etapas = cronogramaDoEdital(proc);
  if (!etapas.length) {
    return `<p class="psObservacoes"><span class="psSemObs">Cronograma não disponível para este edital.</span></p>`;
  }
  return `<div id="psCronogramaTab"></div>`;
}

// Instancia a grade do cronograma (só-estilo) no container já presente no DOM.
// A "etapa atual" é sinalizada por um selo na própria célula de Atividade.
function montarCronograma(proc) {
  const etapas = cronogramaDoEdital(proc);
  if (!etapas.length || !$("psCronogramaTab")) return;
  const iAtual = indiceEtapaAtual(etapas); // etapa atual pela data (índice na lista)
  const ehAtual = e => iAtual >= 0 && e.ordem === etapas[iAtual].ordem;
  const grade = criarTabelaArrastavel({
    elemento: "psCronogramaTab",
    // fitColumns: as colunas se ajustam à largura do contêiner e o texto quebra
    // (CSS: white-space:normal). Sem rolagem horizontal de saída — ela só aparece
    // se o contêiner for estreito demais para os minWidth abaixo.
    layout: "fitColumns",
    // Sem reordenar colunas (movableColumns:false) e sem ordenação por cabeçalho
    // (headerSort:false) — a ordem é sempre a do cronograma (campo "ordem"). O
    // redimensionamento de largura das colunas FICA liberado (resizable padrão).
    colunas: [
      { title: "#", field: "ordem", hozAlign: "center", width: 64, headerSort: false,
        formatter: c => escapeHtml(String(c.getValue() ?? "")) },
      { title: "Atividade", field: "atividade", cssClass: "psCelNome", minWidth: 200, headerSort: false,
        formatter: c => {
          const e = c.getRow().getData();
          return `${escapeHtml(e.atividade || "—")}${ehAtual(e) ? ` <span class="psBadge is-breve">Etapa atual</span>` : ""}`;
        } },
      { title: "Data", field: "data", minWidth: 110, headerSort: false,
        formatter: c => escapeHtml(c.getValue() || "—") }
    ],
    persistID: "psCronograma",
    indexField: "ordem",
    movableColumns: false,
    movableRows: false,
    aoFormatarLinha: row => {
      if (ehAtual(row.getData())) row.getElement().classList.add("is-etapa-atual");
    },
    dados: etapas
  });

  // Recalcula o layout já com o contêiner no tamanho final. Quando o detalhe é
  // reconstruído junto de outras grades (ex.: ao adicionar um aprovado), o
  // Tabulator pode medir a largura menor e estreitar a coluna "Atividade",
  // inflando a altura (texto quebrado) e forçando rolagem vertical. O redraw
  // após montar corrige a largura das colunas.
  grade?.tabela?.on("tableBuilt", () => { try { grade.tabela.redraw(true); } catch { /* recriando */ } });
}

// Rótulo da etapa atual: a etapa vigente pela data do cronograma; senão proc.etapa.
function etapaAtualLabel(proc) {
  const crono = cronogramaDoEdital(proc);
  const i = indiceEtapaAtual(crono);
  const atual = i >= 0 ? crono[i] : null;
  if (atual) return atual.data ? `${atual.atividade} · ${atual.data}` : atual.atividade;
  return proc.etapa || "—";
}

// Widget "Etapa atual" recolhível: recolhido mostra só a etapa atual; ao clicar,
// expande para o cronograma completo. O cronograma do edital virou este campo.
function renderEtapaAtual(proc) {
  const etapas = cronogramaDoEdital(proc);
  const extra = anexosExtraidos.get(proc?.id);
  const viaAnexo = extra && extra.cronograma && extra.cronograma.length
    ? ` <span class="psBlocoFonte"><i class="fa-solid fa-file-arrow-up"></i> via anexo</span>`
    : "";
  // "Ajustar cronograma" fica junto do próprio cronograma (só ao expandir): editor
  // e desde que haja dados extraídos (anexo) para corrigir/complementar.
  const podeAjustarCrono = podeEditarProcessos() && anexosExtraidos.has(proc?.id);
  const corpo = cronoExpandido
    ? `<div class="psEtapaCorpo">
         <div class="psEtapaBarra">
           <span class="psEtapaMeta">${etapas.length ? `${etapas.length} etapa(s)${viaAnexo}` : ""}</span>
           ${podeAjustarCrono ? `<button type="button" class="psBtn psBtnGhost psBtnSm" data-ps-cronograma="${escapeAttr(proc.id)}"><i class="fa-solid fa-calendar-days"></i> Ajustar cronograma</button>` : ""}
         </div>
         ${cronogramaTabelaHtml(proc)}
       </div>`
    : "";
  return `
    <div class="psEtapaWidget ${cronoExpandido ? "is-aberto" : ""}">
      <button type="button" class="psEtapaHead" data-ps-etapa-toggle aria-expanded="${cronoExpandido ? "true" : "false"}"
        title="${cronoExpandido ? "Recolher cronograma" : "Ver cronograma completo"}">
        <span class="psEtapaLabel">Etapa atual</span>
        <span class="psEtapaValor">${escapeHtml(etapaAtualLabel(proc))}</span>
        <i class="fa-solid fa-chevron-down psRowChevron ${cronoExpandido ? "is-aberto" : ""}" aria-hidden="true"></i>
      </button>
      ${corpo}
    </div>`;
}

function renderDetalhe() {
  const painel = $("psDetalhe");
  if (!painel) return;

  const proc = processos.find(p => p.id === processoExpandido);
  if (!proc) {
    painel.hidden = true;
    painel.innerHTML = "";
    return;
  }

  const link = proc.linkEdital
    ? `<a class="psDocLink" href="${escapeAttr(safeUrl(proc.linkEdital))}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-file-pdf"></i> Abrir edital</a>`
    : "—";

  const observacoes = proc.observacoes
    ? escapeHtml(proc.observacoes)
    : `<span class="psSemObs">Sem observações registradas.</span>`;

  painel.innerHTML = `
    <div class="psDetalheTopo">
      <div class="psDetalheTitulo">
        <h3>${escapeHtml(proc.unidade)} — Edital ${escapeHtml(proc.edital || "—")} ${badgeStatus(statusEfetivo(proc))}</h3>
        <p>${escapeHtml(proc.uf || "—")} &nbsp;·&nbsp;
          Período: ${isoParaBr(proc.dataInicio)} a ${isoParaBr(proc.dataEncerramento)}</p>
      </div>
      <div class="psDetalheAcoes">
        ${podeEditarProcessos() ? `
        <button type="button" class="psBtn psBtnGhost psBtnEditar" data-ps-editar="${escapeAttr(proc.id)}">
          <i class="fa-solid fa-pen-to-square"></i> Editar
        </button>
        <button type="button" class="psBtn psBtnGhost psBtnExcluir" data-ps-excluir="${escapeAttr(proc.id)}">
          <i class="fa-solid fa-trash"></i> Excluir
        </button>
        <button type="button" class="psBtn psBtnGhost psBtnEditar" data-ps-anexo="${escapeAttr(proc.id)}">
          <i class="fa-solid fa-file-arrow-up"></i> Inserir anexo
        </button>
        ${anexosExtraidos.has(proc.id) ? `
        <button type="button" class="psBtn psBtnGhost psBtnExcluir" data-ps-remover-anexo="${escapeAttr(proc.id)}">
          <i class="fa-solid fa-file-circle-xmark"></i> Remover anexo
        </button>` : ""}` : ""}
        <button type="button" class="psBtn psBtnGhost" data-ps-detalhe="${escapeAttr(proc.id)}">
          Recolher detalhes <i class="fa-solid fa-chevron-up"></i>
        </button>
      </div>
    </div>

    <div class="psResumoTiles">
      <div class="psTile"><div class="psTileValue">${numFmt(proc.vagasPrevistas)}</div><div class="psTileLabel">Vagas Previstas</div><div class="psTileSub">${numFmt(vagasImediatasEdital(proc))} imediatas${proc.temCadastroReserva ? " + CR" : ""}</div></div>
      <div class="psTile"><div class="psTileValue is-green">${numFmt(contratadosEdital(proc))}</div><div class="psTileLabel">Contratados</div></div>
      <div class="psTile"><div class="psTileValue is-red">${numFmt(Math.max(0, Number(proc.vagasPrevistas || 0) - contratadosEdital(proc)))}</div><div class="psTileLabel">Vagas Ociosas</div></div>
      <div class="psTile"><div class="psTileValue is-blue">${numFmt(totalAprovadosEdital(proc))}</div><div class="psTileLabel">Aprovados</div></div>
    </div>

    <div class="psDetalheGrid">
      <div class="psBloco">
        <h4 class="psBlocoTitulo">Dados do Edital</h4>
        ${renderEtapaAtual(proc)}
        <div class="psInfoGrid">
          ${linhaInfo("Link do edital", link)}
        </div>
      </div>

      <div class="psBloco">
        <h4 class="psBlocoTitulo">Observações</h4>
        <p class="psObservacoes">${observacoes}</p>
      </div>
    </div>

    ${renderQuadroVagas(proc)}`;

  painel.hidden = false;
  // Subtabelas só-estilo (Tabulator): os containers já estão no innerHTML; monta
  // agora que o painel está visível (o Tabulator precisa de largura para medir).
  montarQuadroVagas(proc);
  montarAprovados(proc);
  montarCronograma(proc);
}

// Marca o container em modo somente-leitura quando o usuário não é Editor. O CSS
// (.ps-readonly [data-ps-*]) esconde TODO botão de escrita em qualquer profundidade
// — assim, mesmo que um botão vaze (bug de render, DOM manipulado, cascata a partir
// de um botão de nível superior), ele nunca fica visível para o Leitor. Reavalia a
// cada render: no init o usuário ainda pode estar sem nível (0).
function aplicarModoLeituraPs() {
  const raiz = $("view-processosSeletivos");
  if (raiz) raiz.classList.toggle("ps-readonly", !podeEditarProcessos());
}

// ---------- Render geral ----------
function renderTudo() {
  aplicarModoLeituraPs();
  renderKpis();
  preencherFiltros();
  renderTabela();
  renderDetalhe();
}

// A grade Tabulator não monta com a aba oculta (largura 0). Ao navegar para a
// aba, re-renderiza (monta na 1ª vez) e recalcula o layout.
export function renderProcessosSeletivosAoMostrar() {
  aplicarModoLeituraPs();
  renderTabela();
  gradePs?.redraw();
  recarregar(); // atualiza do banco ao abrir a aba
}

// ---------- Ações ----------
function alternarDetalhe(id) {
  processoExpandido = processoExpandido === id ? null : id;
  // Troca de edital: zera a vaga selecionada e o widget de cronograma para não
  // vazar a seleção/expansão de um edital para outro.
  vagaSelecionada = null;
  cronoExpandido = false;
  renderTabela();
  renderDetalhe();
  if (processoExpandido) {
    setTimeout(() => $("psDetalhe")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 60);
  }
}

// ---------- Combobox de DSEI/CASAI + auto-preenchimento da UF ----------
// Fonte: endpoint /api/processos-seletivos/dseis (consulta a base consolidada de
// trabalhadores no banco), que devolve [{ uf, nome }] já limpos. Alimenta o
// <select> do formulário; ao escolher o DSEI, a UF é preenchida automaticamente.
let dseisFormCarregado = false;
const dseiUfMap = new Map(); // nome do DSEI/CASAI -> UF

async function carregarDseisForm() {
  if (dseisFormCarregado) return;
  try {
    const resp = await fetch("/api/processos-seletivos/dseis", { credentials: "same-origin" });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const json = await resp.json();
    dseiUfMap.clear();
    (json.dseis || []).forEach(d => {
      const nome = String(d.nome || "").trim();
      if (nome) dseiUfMap.set(nome, String(d.uf || "").trim().toUpperCase());
    });
    // Não marca como carregado se veio vazio — permite nova tentativa ao reabrir.
    if (dseiUfMap.size) dseisFormCarregado = true;
    else console.warn("[processos] lista de DSEIs/CASAIs veio vazia do servidor.");
    popularSelectDsei();
  } catch (e) {
    console.warn("[processos] não foi possível carregar os DSEIs/CASAIs:", e && e.message ? e.message : e);
  }
}

// Popula o <select> de DSEI/CASAI. `valorAtual` (edição) é injetado como opção
// caso não esteja na lista — assim editais com nome legado continuam aparecendo.
function popularSelectDsei(valorAtual) {
  const sel = $("psFormUnidade");
  if (!sel || sel.tagName !== "SELECT") return;
  const nomes = [...dseiUfMap.keys()].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const extra = (valorAtual && !dseiUfMap.has(valorAtual)) ? [valorAtual] : [];
  sel.innerHTML = `<option value="">Selecione o DSEI/CASAI</option>` +
    [...extra, ...nomes].map(n => `<option value="${escapeAttr(n)}">${escapeHtml(n)}</option>`).join("");
}

// ---------- Cadastro de novo edital (modal) ----------
function atualizarTipoDoc() {
  const tipo = document.querySelector('input[name="psDocTipo"]:checked')?.value || "link";
  const linkWrap = $("psDocLinkWrap");
  const anexoWrap = $("psDocAnexoWrap");
  if (linkWrap) linkWrap.hidden = tipo !== "link";
  if (anexoWrap) anexoWrap.hidden = tipo !== "anexo";
}

// Abre o assistente. `opts.modo`: "edital" (criar/editar, padrão) ou "anexo"
// (só inserir anexo num edital existente — começa no passo 2). `opts.passo`:
// passo inicial. Sem id => novo edital; com id => edição/anexo do edital.
async function abrirModalEdital(id, opts) {
  const modal = $("psModalEdital");
  if (!modal) return;
  opts = opts || {};
  wizardModo = opts.modo === "anexo" ? "anexo" : "edital";

  $("psFormEdital")?.reset();
  $("psFormAnexo")?._fi?.render();      // re-sincroniza o componente de arquivo após o reset
  // O anexo (passo 2) fica FORA do form, então reset() não o limpa: zera na mão.
  const faDados = $("psFormAnexoDados");
  if (faDados) { faDados.value = ""; faDados._fi?.render(); }
  const stAnx = $("psFormAnexoDadosStatus");
  if (stAnx) { stAnx.hidden = true; stAnx.innerHTML = ""; }
  ["psFormErro", "psWizAnexoErro", "psConfErro"].forEach(idErr => { const e = $(idErr); if (e) e.textContent = ""; });
  const vl = $("psConfVagasLista"); if (vl) vl.innerHTML = "";
  const cl = $("psConfCronoLista"); if (cl) cl.innerHTML = "";

  editandoId = typeof id === "string" ? id : null;
  const proc = editandoId ? processos.find(p => p.id === editandoId) : null;

  // Combobox de DSEI/CASAI: garante a lista carregada e injeta o valor atual
  // (edição) como opção antes de selecioná-lo mais abaixo.
  await carregarDseisForm();
  popularSelectDsei(proc?.unidade);

  const titulo = $("psModalTitulo");
  if (titulo) {
    titulo.innerHTML = wizardModo === "anexo"
      ? `<i class="fa-solid fa-file-arrow-up"></i> Inserir anexo do edital`
      : proc
        ? `<i class="fa-solid fa-pen-to-square"></i> Editar edital`
        : `<i class="fa-solid fa-file-circle-plus"></i> Adicionar edital`;
  }

  // Em edição/anexo, preenche os campos com os dados atuais do edital.
  if (proc) {
    const set = (campo, valor) => { const el = $(campo); if (el) el.value = valor ?? ""; };
    set("psFormUnidade", proc.unidade);
    set("psFormUf", proc.uf);
    set("psFormEditalNum", proc.edital);
    set("psFormVagas", proc.vagasPrevistas || "");
    const chkCR = $("psFormCadastroReserva");
    if (chkCR) chkCR.checked = !!proc.temCadastroReserva;
    set("psFormDataInicio", proc.dataInicio);
    set("psFormDataFim", proc.dataEncerramento);
    set("psFormStatus", proc.status);
    set("psFormObs", proc.observacoes);
    // Só dá para repor um link http(s); anexos (object URL) não voltam a um input file.
    const ehLink = /^https?:\/\//i.test(proc.linkEdital || "");
    const radioLink = document.querySelector('input[name="psDocTipo"][value="link"]');
    if (radioLink) radioLink.checked = true;
    set("psFormLink", ehLink ? proc.linkEdital : "");
  }

  atualizarTipoDoc();
  irParaPasso(opts.passo || (wizardModo === "anexo" ? 2 : 1));
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  if (wizardModo !== "anexo") setTimeout(() => $("psFormUnidade")?.focus(), 40);
}

function fecharModalEdital() {
  const modal = $("psModalEdital");
  if (!modal) return;
  modal.hidden = true;
  editandoId = null;
  wizardModo = "edital";
  wizardPasso = 1;
  document.body.style.overflow = "";
}

// Lê um campo numérico do formulário (>= 0; vazio/ inválido vira 0).
function valorNum(id) {
  const v = Number($(id)?.value);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

// ---------- Assistente de edital: navegação e gravação ----------
function irParaPasso(n) {
  wizardPasso = n;
  document.querySelectorAll("#psModalEdital .psStepPane").forEach(p => {
    p.hidden = Number(p.dataset.pane) !== n;
  });
  document.querySelectorAll("#psStepper .psStep").forEach(li => {
    const s = Number(li.dataset.step);
    li.classList.toggle("is-atual", s === n);
    // No modo anexo o passo 1 já está "concluído" (edital existe).
    li.classList.toggle("is-feito", s < n || (wizardModo === "anexo" && s === 1));
  });
  atualizarBotoesWizard();
}

function atualizarBotoesWizard() {
  const show = (idBtn, v) => { const el = $(idBtn); if (el) el.hidden = !v; };
  const anexo = wizardModo === "anexo";
  show("psWizVoltar", wizardPasso > 1 && !(anexo && wizardPasso === 2));
  show("psWizPular", wizardPasso === 2 && !anexo);  // pular a etapa de anexo (só ao criar/editar)
  show("psWizProximo", wizardPasso < 3);
  show("psWizConcluir", wizardPasso === 3);
}

// Passo 1: DSEI/UF/Edital + datas (obrigatórias) precisam estar preenchidos.
function validarPasso1() {
  const erro = $("psFormErro");
  const set = m => { if (erro) erro.textContent = m; };
  const unidade = ($("psFormUnidade")?.value || "").trim();
  const uf = ($("psFormUf")?.value || "").trim();
  const edital = ($("psFormEditalNum")?.value || "").trim();
  const di = $("psFormDataInicio")?.value || "";
  const df = $("psFormDataFim")?.value || "";
  if (!unidade || !uf || !edital) { set("Preencha os campos obrigatórios: DSEI/CASAI, UF e Edital."); return false; }
  if (!di || !df) { set("Informe a Data de início e a Data fim (previsto)."); return false; }
  set("");
  return true;
}

function coletarDadosEdital() {
  // Documento: só o LINK é persistido (o PDF do documento é blob, adiado). Na
  // edição, mantém o link atual se o usuário não informar um novo.
  const tipoDoc = document.querySelector('input[name="psDocTipo"]:checked')?.value || "link";
  const procAtual = editandoId ? processos.find(p => p.id === editandoId) : null;
  let linkEdital = procAtual ? (procAtual.linkEdital || "") : "";
  if (tipoDoc === "link") linkEdital = ($("psFormLink")?.value || "").trim();
  return {
    unidade: ($("psFormUnidade")?.value || "").trim(),
    uf: ($("psFormUf")?.value || "").trim().toUpperCase(),
    edital: ($("psFormEditalNum")?.value || "").trim(),
    vagasPrevistas: valorNum("psFormVagas"),
    temCadastroReserva: !!$("psFormCadastroReserva")?.checked,
    dataInicio: $("psFormDataInicio")?.value || "",
    dataEncerramento: $("psFormDataFim")?.value || "",
    status: normalizarStatus($("psFormStatus")?.value || "Andamento"),
    observacoes: ($("psFormObs")?.value || "").trim(),
    linkEdital
  };
}

// Preenche as listas da conferência (passo 3) com o que foi extraído do PDF.
function popularConferencia(dados) {
  const vagasEl = $("psConfVagasLista");
  if (vagasEl) {
    vagasEl.innerHTML = "";
    const cargos = (dados && dados.cargos) || [];
    (cargos.length ? cargos : [{}]).forEach(c => vagasEl.appendChild(criarLinhaVaga(c)));
  }
  const cronoEl = $("psConfCronoLista");
  if (cronoEl) {
    cronoEl.innerHTML = "";
    const et = (dados && dados.cronograma) || [];
    (et.length ? et : [{ atividade: "", data: "" }]).forEach(e => cronoEl.appendChild(criarLinhaCronograma(e.atividade, e.data)));
    renumerarLinhasCronograma(cronoEl);
  }
}

// Lê as edições da conferência -> { cargos, cronograma }. Descarta linhas vazias.
function lerConferencia() {
  const vagaRows = [...($("psConfVagasLista")?.querySelectorAll("[data-vaga-row]") || [])];
  const val = (row, k) => (row.querySelector(`[data-vaga-${k}]`)?.value || "").trim();
  const cargos = vagaRows.map(row => ({
    cargo: val(row, "cargo"),
    ampla: val(row, "ampla"),
    pcd: val(row, "pcd"),
    pretosPardos: val(row, "pretosPardos"),
    indigenas: val(row, "indigenas"),
    quilombolas: val(row, "quilombolas"),
  })).filter(c => c.cargo);
  const cronoRows = [...($("psConfCronoLista")?.querySelectorAll("[data-crono-row]") || [])];
  const cronograma = cronoRows.map(row => ({
    atividade: (row.querySelector("[data-crono-ativ]")?.value || "").trim(),
    data: (row.querySelector("[data-crono-data]")?.value || "").trim()
  })).filter(e => e.atividade);
  return { cargos, cronograma };
}

function wizardVoltar() {
  if (wizardPasso > 1) irParaPasso(wizardPasso - 1);
}

async function wizardProximo() {
  if (wizardPasso === 1) {
    if (validarPasso1()) irParaPasso(2);
  } else if (wizardPasso === 2) {
    await wizardAnalisarAnexo();
  }
}

// Passo 2 -> 3: lê o PDF (com OCR se for escaneado) e abre a conferência.
async function wizardAnalisarAnexo() {
  const erro = $("psWizAnexoErro");
  if (erro) erro.textContent = "";
  const arquivo = $("psFormAnexoDados")?.files?.[0];
  if (!arquivo) {
    if (erro) erro.textContent = wizardModo === "anexo"
      ? "Selecione um arquivo PDF."
      : "Selecione um PDF ou use “Pular etapa”.";
    return;
  }
  const status = $("psFormAnexoDadosStatus");
  const btn = $("psWizProximo");
  if (status) { status.hidden = false; status.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Lendo o PDF e extraindo os dados…`; }
  if (btn) btn.disabled = true;
  try {
    const dados = await extrairDadosAnexo(arquivo);
    popularConferencia(dados);
    irParaPasso(3);
  } catch (e) {
    if (erro) erro.textContent = e.message || "Não foi possível ler o PDF.";
  } finally {
    // Some com o "Lendo o PDF…" em qualquer desfecho (sucesso ou erro).
    if (status) { status.hidden = true; status.innerHTML = ""; }
    if (btn) btn.disabled = false;
  }
}

// "Pular etapa" (passo 2, ao criar/editar): salva o edital sem anexo.
async function wizardPular() {
  if (wizardModo === "anexo") { fecharModalEdital(); return; }
  await gravarWizard({ semAnexo: true, botao: "psWizPular" });
}

// "Concluir" (passo 3): salva com os dados conferidos/corrigidos.
async function wizardConcluir() {
  const { cargos, cronograma } = lerConferencia();
  await gravarWizard({ cargos, cronograma, botao: "psWizConcluir" });
}

async function gravarWizard({ cargos, cronograma, semAnexo, botao } = {}) {
  const btn = botao ? $(botao) : null;
  const mostrarErro = m => {
    const idErr = wizardPasso === 3 ? "psConfErro" : (wizardPasso === 2 ? "psWizAnexoErro" : "psFormErro");
    const e = $(idErr); if (e) e.textContent = m;
  };

  // Modo "anexo": grava só o anexo no edital existente (não altera os campos).
  if (wizardModo === "anexo") {
    if (btn) btn.disabled = true;
    try {
      await psApi("POST", `/api/processos-seletivos/editais/${encodeURIComponent(editandoId)}/anexo`, { cargos, cronograma });
    } catch (e) { mostrarErro(e.message || "Não foi possível salvar o anexo."); if (btn) btn.disabled = false; return; }
    if (btn) btn.disabled = false;
    fecharModalEdital();
    await recarregar();
    psToast("Anexo salvo.");
    return;
  }

  // Modo "edital": valida os campos e cria/atualiza o edital (com anexo, se houver).
  if (!validarPasso1()) { irParaPasso(1); return; }
  const dados = coletarDadosEdital();
  if (!semAnexo && ((cargos && cargos.length) || (cronograma && cronograma.length))) {
    dados.anexo = { cargos: cargos || [], cronograma: cronograma || [] };
  }
  if (btn) btn.disabled = true;
  try {
    if (editandoId) await psApi("PUT", `/api/processos-seletivos/editais/${encodeURIComponent(editandoId)}`, dados);
    else await psApi("POST", "/api/processos-seletivos/editais", dados);
  } catch (e) { mostrarErro(e.message || "Não foi possível salvar o edital."); if (btn) btn.disabled = false; return; }
  if (btn) btn.disabled = false;
  if (!editandoId) paginaAtual = 1;
  fecharModalEdital();
  await recarregar();
  psToast(dados.anexo ? "Edital salvo e anexo lido." : "Edital salvo.");
}

// Exclui um edital (protótipo em memória): confirma e remove da lista, junto do
// que estiver associado a ele em memória (aprovados/anexo). Mesmo padrão de
// confirmação do excluirAprovado / da Gestão Disciplinar.
async function excluirEdital(id) {
  if (!podeEditarProcessos()) return;
  const proc = processos.find(p => p.id === id);
  if (!proc) return;
  const r = await abrirModal({
    titulo: "Excluir edital",
    msg: `Deseja realmente excluir o edital ${proc.edital ? `"${escapeHtml(proc.edital)}" ` : ""}de ${escapeHtml(proc.unidade || "—")}? Esta ação não pode ser desfeita.`,
    confirmarTexto: "Excluir",
    perigo: true
  });
  if (!r.ok) return;
  try {
    await psApi("DELETE", `/api/processos-seletivos/editais/${encodeURIComponent(id)}`);
  } catch (e) {
    psToast(e.message || "Não foi possível excluir o edital.");
    return;
  }
  if (processoExpandido === id) { processoExpandido = null; vagaSelecionada = null; }
  psToast("Edital excluído.");
  await recarregar();
}

// Remove o anexo do edital (cronograma + quadro de vagas e, por consequência,
// TODOS os aprovados). Ação destrutiva: confirma com aviso do que será apagado.
async function removerAnexo(id) {
  if (!podeEditarProcessos()) return;
  const proc = processos.find(p => p.id === id);
  if (!proc) return;
  const r = await abrirModal({
    titulo: "Remover anexo",
    msg: `Isto vai apagar o cronograma, o quadro de vagas e TODOS os aprovados cadastrados do edital ${proc.edital ? `"${escapeHtml(proc.edital)}" ` : ""}de ${escapeHtml(proc.unidade || "—")}. Esta ação não pode ser desfeita. Deseja continuar?`,
    confirmarTexto: "Remover anexo",
    perigo: true
  });
  if (!r.ok) return;
  try {
    await psApi("DELETE", `/api/processos-seletivos/editais/${encodeURIComponent(id)}/anexo`);
  } catch (e) {
    psToast(e.message || "Não foi possível remover o anexo.");
    return;
  }
  vagaSelecionada = null;
  psToast("Anexo removido.");
  await recarregar();
}

// ---------- Extração do anexo (PDF -> { cargos, cronograma }) ----------
// Envia o PDF ao extrator e devolve { cargos, cronograma }. Lança erro (mensagem
// amigável) se o servidor falhar ou se nada for localizado no PDF. Usada no
// passo 2 do assistente (analisar anexo).
async function extrairDadosAnexo(arquivo) {
  const fd = new FormData();
  fd.append("anexo", arquivo);
  const resp = await fetch("/api/processos-seletivos/extrair-anexo", {
    method: "POST",
    body: fd,
    credentials: "same-origin"
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || "Falha ao extrair os dados do PDF.");
  const cargos = Array.isArray(data.cargos) ? data.cargos : [];
  const cronograma = Array.isArray(data.cronograma) ? data.cronograma : [];
  if (!cargos.length && !cronograma.length) {
    throw new Error("Não foi possível localizar o quadro de vagas nem o cronograma neste PDF.");
  }
  return { cargos, cronograma };
}

// =========================================================
// Aprovados por vaga (CRUD + classificação) — protótipo em memória
// =========================================================

// ---------- Acesso ao estado por edital/cargo ----------
function getDadosEdital(editalId) {
  let d = dadosAprovados.get(editalId);
  if (!d) {
    d = { configClassificacao: null, aprovadosPorCargo: new Map() };
    dadosAprovados.set(editalId, d);
  }
  return d;
}

// Lista (mutável) de aprovados de um cargo; cria sob demanda.
function aprovadosDoCargo(editalId, nomeCargo) {
  const d = getDadosEdital(editalId);
  const chave = normChave(nomeCargo);
  if (!d.aprovadosPorCargo.has(chave)) d.aprovadosPorCargo.set(chave, []);
  return d.aprovadosPorCargo.get(chave);
}

// Fila = todos os aprovados cadastrados na vaga (decisão do produto).
function filaDoCargo(editalId, nomeCargo) {
  return aprovadosDoCargo(editalId, nomeCargo).length;
}

// "Aprovados" do edital = soma dos aprovados de todas as vagas (contagem real).
function totalAprovadosEdital(proc) {
  const d = proc && dadosAprovados.get(proc.id);
  if (!d) return 0;
  let total = 0;
  d.aprovadosPorCargo.forEach(lista => { total += lista.length; });
  return total;
}

// Aprovados marcados como "Contratado" em todas as vagas do edital.
function totalContratadosMarcados(proc) {
  const d = proc && dadosAprovados.get(proc.id);
  if (!d) return 0;
  let total = 0;
  d.aprovadosPorCargo.forEach(lista => { total += lista.filter(c => c.status === "Contratado").length; });
  return total;
}

// "Contratados" exibido = os do edital (campo do cadastro) + os aprovados que
// foram marcados "Contratado" nesta sessão. Vagas Ociosas acompanha esse total.
function contratadosEdital(proc) {
  return Number(proc?.contratados || 0) + totalContratadosMarcados(proc);
}

function getConfig(editalId) {
  return { ...CONFIG_PADRAO, ...(dadosAprovados.get(editalId)?.configClassificacao || {}) };
}

// ---------- Classificação ----------
function notaValida(n) {
  if (n === null || n === undefined || n === "") return false;
  return Number.isFinite(Number(String(n).replace(",", ".")));
}
function valNota(n) { return Number(String(n).replace(",", ".")); }

// Ordem base: nota desc; sem nota vão para o fim; empate por nome (pt-BR).
function compararBase(a, b) {
  const na = notaValida(a.nota), nb = notaValida(b.nota);
  if (na && nb) {
    const d = valNota(b.nota) - valNota(a.nota);
    return d !== 0 ? d : String(a.nome).localeCompare(String(b.nome), "pt-BR");
  }
  if (na) return -1;
  if (nb) return 1;
  return String(a.nome).localeCompare(String(b.nome), "pt-BR");
}

// Cotista = qualquer tipo diferente de Ampla Concorrência.
const ehCota = c => !!c.tipo && c.tipo !== "AMPLA_CONCORRENCIA";

// Classifica por nota. Com intervaloCota X > 0, a cada X de ampla concorrência
// colocados a próxima posição é reservada ao melhor cotista (qualquer tipo de
// cota) disponível — ele "fura" a ordem por nota. Sem cotista, cai
// para o próximo por nota sem consumir a reserva. Retorna [{candidato,posicao,reservado}].
function classificar(candidatos, config) {
  const ordenados = [...candidatos].sort(compararBase);
  const X = Number(config.intervaloCota) || 0;
  if (X <= 0) {
    return ordenados.map((c, i) => ({ candidato: c, posicao: i + 1, reservado: false }));
  }
  const normais = ordenados.filter(c => !ehCota(c));
  const cotas = ordenados.filter(ehCota);
  const resultado = [];
  let iN = 0, iC = 0, contNormais = 0, posicao = 0;
  while (iN < normais.length || iC < cotas.length) {
    if (contNormais >= X && iC < cotas.length) {
      resultado.push({ candidato: cotas[iC++], posicao: ++posicao, reservado: true });
      contNormais = 0;
      continue;
    }
    if (iN < normais.length) {
      resultado.push({ candidato: normais[iN++], posicao: ++posicao, reservado: false });
      contNormais += 1;
      continue;
    }
    // Acabaram os normais: escoa os cotistas restantes na ordem base (sem reserva).
    resultado.push({ candidato: cotas[iC++], posicao: ++posicao, reservado: false });
  }
  return resultado;
}

// ---------- Badges/formatação dos aprovados ----------
// Tipo do aprovado = enum do banco (APROVADO_VAGA_EDITAL.TIPO). Rótulo p/ exibição.
const TIPO_APROVADO_LABEL = { AMPLA_CONCORRENCIA: "Ampla Concorrência", PCD: "PcD", PRETO_PARDO: "Preto/Pardo", INDIGENA: "Indígena", QUILOMBOLA: "Quilombola" };
const BADGE_TIPO = { AMPLA_CONCORRENCIA: "is-naoiniciado", PCD: "is-aguardando", PRETO_PARDO: "is-breve", INDIGENA: "is-andamento", QUILOMBOLA: "is-contratado" };
const BADGE_CAND_STATUS = { Convocado: "is-andamento", Aguardando: "is-aguardando", Contratado: "is-contratado", Desistiu: "is-encerrado" };
// Valores oferecidos nos editores inline (valor -> rótulo).
const CAND_STATUS_OPCOES = { Aguardando: "Aguardando", Convocado: "Convocado", Contratado: "Contratado", Desistiu: "Desistiu" };
const CAND_TIPO_OPCOES = TIPO_APROVADO_LABEL;
function badgeTipo(t) { return `<span class="psBadge ${BADGE_TIPO[t] || "is-naoiniciado"}">${escapeHtml(TIPO_APROVADO_LABEL[t] || t || "—")}</span>`; }
function badgeCandStatus(s) { return `<span class="psBadge ${BADGE_CAND_STATUS[s] || "is-naoiniciado"}">${escapeHtml(s || "—")}</span>`; }
function fmtNota(n) {
  if (!notaValida(n)) return "—";
  const v = valNota(n);
  return Number.isInteger(v) ? String(v) : v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

// ---------- Painel "Aprovados para [vaga]" ----------
function renderPainelAprovados(proc) {
  if (!proc || !vagaSelecionada) return "";
  // Cargo selecionado sumiu (troca de fonte/anexo): não renderiza painel órfão.
  if (!cargosDoEdital(proc).some(c => normChave(c.cargo) === normChave(vagaSelecionada))) return "";

  const podeEditar = podeEditarProcessos();
  const lista = aprovadosDoCargo(proc.id, vagaSelecionada);
  const config = getConfig(proc.id);
  const classificados = classificar(lista, config);

  const acoes = podeEditar
    ? `<div class="psDetalheAcoes">
         <button type="button" class="psBtn psBtnSm" data-ps-aprovado-novo="${escapeAttr(vagaSelecionada)}"><i class="fa-solid fa-user-plus"></i> Adicionar aprovado</button>
         <button type="button" class="psBtn psBtnGhost psBtnSm" data-ps-config="${escapeAttr(proc.id)}"><i class="fa-solid fa-sliders"></i> Configurar classificação</button>
       </div>`
    : "";

  // Sem aprovados: mensagem; senão, container da grade Tabulator só-estilo
  // (montada por montarAprovados após o innerHTML do detalhe).
  const corpo = classificados.length
    ? `<div id="psAprovadosTab"></div>`
    : `<p class="psObservacoes"><span class="psSemObs">Nenhum aprovado registrado para esta vaga.</span></p>`;

  const regra = config.intervaloCota > 0
    ? ` · regra: 1 cotista a cada ${config.intervaloCota} de ampla concorrência`
    : "";

  return `
    <div class="psAprovadosPainel">
      <div class="psBlocoHead">
        <h4 class="psBlocoTitulo">Aprovados para ${escapeHtml(vagaSelecionada)}</h4>
        <span class="psBlocoMeta">${lista.length} aprovado(s)${regra}</span>
      </div>
      ${acoes}
      ${corpo}
    </div>`;
}

// Grade "Aprovados para [vaga]" (Tabulator). Edição INLINE por célula para Editor:
// Nome/Nota/Tipo/Status são editáveis direto na linha (sem modal). A coluna
// Documento anexa o PDF de desistência na própria linha quando o status é
// "Desistiu". Colunas condicionais: "#" (posição) só se config.mostrarPosicoes;
// "Ações" (excluir) só para Editor. O aprovado que desistiu fica esmaecido.
function montarAprovados(proc) {
  if (!$("psAprovadosTab") || !proc || !vagaSelecionada) return;
  const podeEditar = podeEditarProcessos();
  const config = getConfig(proc.id);
  const lista = aprovadosDoCargo(proc.id, vagaSelecionada);
  const classificados = classificar(lista, config);
  if (!classificados.length) return;
  const colPos = !!config.mostrarPosicoes;

  // Achata {candidato, posicao, reservado} em linhas (preserva campos do candidato).
  const dados = classificados.map(({ candidato, posicao, reservado }) =>
    ({ ...candidato, _posicao: posicao, _reservado: reservado }));

  // Editor só para quem pode editar; o writeback vai ao candidato real (o `dados`
  // acima é uma cópia por classificação, então gravamos pelo id na lista original).
  const editar = (campo, tipo, params) => podeEditar ? {
    editor: tipo, editorParams: params || {},
    cellEdited: c => editarCampoAprovado(c.getRow().getData().id, campo, c.getValue())
  } : {};

  const cols = [];
  if (colPos) {
    cols.push({ title: "#", hozAlign: "center", width: 72, formatter: c => {
      const d = c.getRow().getData();
      return `${d._posicao}${d._reservado ? ` <span class="psBadge is-aguardando">cota</span>` : ""}`;
    } });
  }
  cols.push({ title: "Nome", field: "nome", cssClass: "psCelNome", minWidth: 180,
    ...editar("nome", "input"), formatter: c => escapeHtml(c.getValue() || "—") });
  cols.push({ title: "Nota", field: "nota", hozAlign: "center",
    ...editar("nota", "number", { min: 0, step: 0.01, selectContents: true }), formatter: c => fmtNota(c.getValue()) });
  cols.push({ title: "Tipo", field: "tipo",
    ...editar("tipo", "list", { values: CAND_TIPO_OPCOES }), formatter: c => badgeTipo(c.getValue()) });
  cols.push({ title: "Status", field: "status",
    ...editar("status", "list", { values: CAND_STATUS_OPCOES }), formatter: c => badgeCandStatus(c.getValue()) });
  cols.push({ title: "Documento", field: "docDesistencia", minWidth: 150, formatter: c => {
    const d = c.getRow().getData();
    if (d.status !== "Desistiu") return "—";
    if (d.docDesistencia) {
      const link = `<a class="psDocLink" href="${escapeAttr(safeUrl(d.docDesistencia.url))}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-file-arrow-down"></i> ${escapeHtml(d.docDesistencia.nome || "documento")}</a>`;
      return podeEditar
        ? `${link} <button type="button" class="psIconBtn" data-ps-aprovado-doc="${escapeAttr(d.id)}" title="Trocar documento"><i class="fa-solid fa-arrows-rotate"></i></button>`
        : link;
    }
    return podeEditar
      ? `<button type="button" class="psBtn psBtnGhost psBtnSm" data-ps-aprovado-doc="${escapeAttr(d.id)}"><i class="fa-solid fa-paperclip"></i> Anexar PDF</button>`
      : "—";
  } });
  if (podeEditar) {
    cols.push({ title: "Ações", hozAlign: "center", minWidth: 80, formatter: c => {
      const id = c.getRow().getData().id;
      return `<span class="psAprovadoAcoes">` +
        `<button type="button" class="psIconBtn" data-ps-aprovado-excluir="${escapeAttr(id)}" title="Excluir aprovado"><i class="fa-solid fa-trash"></i></button></span>`;
    } });
  }

  gradeAprovados = criarTabelaArrastavel({
    elemento: "psAprovadosTab",
    colunas: cols,
    persistID: "psAprovados",
    indexField: "id",
    movableColumns: false,
    movableRows: false,
    aoFormatarLinha: row => {
      if (row.getData().status === "Desistiu") row.getElement().classList.add("is-desistiu");
    },
    dados
  });

  // Aprovado recém-criado: abre a edição do Nome assim que a grade monta.
  if (aprovadoFocoId && gradeAprovados?.tabela) {
    const alvo = aprovadoFocoId;
    aprovadoFocoId = null;
    gradeAprovados.tabela.on("tableBuilt", () => {
      try { gradeAprovados.tabela.getRows().find(r => r.getData().id === alvo)?.getCell("nome")?.edit(true); }
      catch { /* grade recriada durante a edição */ }
    });
  }
}

// Seleciona/deseleciona a vaga e re-renderiza o detalhamento.
function selecionarVaga(nomeCargo) {
  vagaSelecionada = (normChave(vagaSelecionada) === normChave(nomeCargo)) ? null : nomeCargo;
  renderDetalhe();
}

// ---------- Aprovados: inserção e edição inline (sem modal) ----------
// "Adicionar aprovado" insere uma linha em branco na tabela e abre a edição do
// Nome; os demais campos (Nota/Tipo/Status) são editáveis clicando na célula.
async function adicionarAprovadoInline(cargoNome) {
  if (!processoExpandido || !cargoNome || !podeEditarProcessos()) return;
  const vagaId = vagaIdDoCargo(processoExpandido, cargoNome);
  if (!vagaId) { psToast("Cadastre o quadro de vagas (anexo) antes de adicionar aprovados."); return; }
  vagaSelecionada = cargoNome; // garante o painel da vaga aberto
  let novoId;
  try {
    const r = await psApi("POST", `/api/processos-seletivos/vagas/${encodeURIComponent(vagaId)}/aprovados`,
      { nome: "", nota: null, tipo: "AMPLA_CONCORRENCIA", status: "Aguardando" });
    novoId = r.id;
  } catch (e) {
    psToast(e.message || "Não foi possível adicionar o aprovado.");
    return;
  }
  aprovadosDoCargo(processoExpandido, cargoNome).push(
    { id: novoId, nome: "", nota: null, tipo: "AMPLA_CONCORRENCIA", status: "Aguardando", docDesistencia: null });
  aprovadoFocoId = novoId; // montarAprovados abre a edição do Nome desta linha
  renderDetalhe();
}

// Persiste a linha inteira do aprovado (PUT). Silencioso; avisa só em falha.
function persistirAprovado(cand) {
  psApi("PUT", `/api/processos-seletivos/aprovados/${encodeURIComponent(cand.id)}`,
    { nome: cand.nome, nota: cand.nota, tipo: cand.tipo, status: cand.status })
    .catch(e => { console.warn("[processos] falha ao salvar aprovado:", e && e.message ? e.message : e); psToast("Não foi possível salvar a alteração do aprovado."); });
}

// Writeback de uma célula editada para o candidato real (na lista da vaga) + persiste.
function editarCampoAprovado(candId, campo, valor) {
  if (!processoExpandido || !vagaSelecionada) return;
  const cand = aprovadosDoCargo(processoExpandido, vagaSelecionada).find(c => c.id === candId);
  if (!cand) return;
  if (campo === "nome") {
    cand.nome = String(valor ?? "").trim();
  } else if (campo === "nota") {
    const raw = String(valor ?? "").trim();
    const n = raw === "" ? null : Number(raw.replace(",", "."));
    cand.nota = Number.isFinite(n) ? n : null;
  } else if (campo === "tipo") {
    cand.tipo = valor || "AMPLA_CONCORRENCIA";
  } else if (campo === "status") {
    cand.status = valor || "Aguardando";
    if (cand.status !== "Desistiu") cand.docDesistencia = null;
  }
  persistirAprovado(cand);
  if (campo === "nome") return; // nome não reordena a classificação: só atualiza a célula
  // Nota/Tipo/Status mudam a ordem da classificação (e o status muda a coluna
  // Documento, o realce da linha e a contagem de Contratados): re-renderiza no
  // próximo tick para não colidir com a finalização interna da edição do Tabulator.
  setTimeout(renderDetalhe, 0);
}

// Anexa (ou troca) o PDF de desistência pela própria linha — abre o seletor de
// arquivo na hora. Object URL em memória (protótipo, não é revogado).
function anexarDocDesistencia(candId) {
  if (!processoExpandido || !vagaSelecionada || !podeEditarProcessos()) return;
  const cand = aprovadosDoCargo(processoExpandido, vagaSelecionada).find(c => c.id === candId);
  if (!cand) return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/pdf";
  input.addEventListener("change", () => {
    const arquivo = input.files?.[0];
    if (!arquivo) return;
    cand.docDesistencia = { url: URL.createObjectURL(arquivo), nome: arquivo.name };
    psToast("Documento de desistência anexado.");
    renderDetalhe();
  });
  input.click();
}

async function excluirAprovado(candId) {
  if (!processoExpandido || !vagaSelecionada || !podeEditarProcessos()) return;
  const lista = aprovadosDoCargo(processoExpandido, vagaSelecionada);
  const cand = lista.find(c => c.id === candId);
  if (!cand) return;
  const r = await abrirModal({
    titulo: "Excluir aprovado",
    msg: `Deseja realmente excluir ${cand.nome ? `"${cand.nome}"` : "este aprovado"}? Esta ação não pode ser desfeita.`,
    confirmarTexto: "Excluir",
    perigo: true
  });
  if (!r.ok) return;
  try {
    await psApi("DELETE", `/api/processos-seletivos/aprovados/${encodeURIComponent(candId)}`);
  } catch (e) {
    psToast(e.message || "Não foi possível excluir o aprovado.");
    return;
  }
  const i = lista.findIndex(c => c.id === candId);
  if (i >= 0) lista.splice(i, 1);
  psToast("Aprovado excluído.");
  renderDetalhe();
}

// ---------- Modal de configuração da classificação (por edital) ----------
function abrirModalConfig(editalId) {
  if (!editalId || !podeEditarProcessos()) return;
  configEditalId = editalId;
  const modal = $("psModalConfig");
  if (!modal) return;
  const erro = $("psConfigErro");
  if (erro) erro.textContent = "";
  const cfg = getConfig(editalId);
  const chk = $("psConfMostrarPosicoes");
  if (chk) chk.checked = !!cfg.mostrarPosicoes;
  const inter = $("psConfIntervalo");
  if (inter) inter.value = Number(cfg.intervaloCota) || 0;
  modal.hidden = false;
  document.body.style.overflow = "hidden";
}

function fecharModalConfig() {
  const modal = $("psModalConfig");
  if (!modal) return;
  modal.hidden = true;
  configEditalId = null;
  document.body.style.overflow = "";
}

function salvarConfig(event) {
  event.preventDefault();
  if (!configEditalId || !podeEditarProcessos()) { fecharModalConfig(); return; }
  const intervalo = Math.max(0, Math.floor(Number($("psConfIntervalo")?.value) || 0));
  const d = getDadosEdital(configEditalId);
  d.configClassificacao = {
    mostrarPosicoes: !!$("psConfMostrarPosicoes")?.checked,
    intervaloCota: intervalo
  };
  fecharModalConfig();
  renderDetalhe();
  psToast("Configuração de classificação salva.");
}

// ---------- Modal: ajustar cronograma (editar atividades/datas manualmente) ----------
// O cronograma extraído do PDF às vezes traz datas incompletas (ex.: "24/07" sem
// ano) que parseDatasCronograma() não reconhece. Este modal permite corrigir o
// texto das atividades e das datas e salvar. Reaproveita o endpoint do anexo
// enviando só o cronograma — sem `cargos`, o upsert de vagas é no-op, então o
// quadro de vagas e os aprovados são preservados.
let cronogramaEditId = null;

function abrirModalCronograma(editalId) {
  if (!editalId || !podeEditarProcessos()) return;
  cronogramaEditId = editalId;
  const modal = $("psModalCronograma");
  if (!modal) return;
  const erro = $("psCronogramaErro");
  if (erro) erro.textContent = "";
  const proc = processos.find(p => p.id === editalId);
  const etapas = cronogramaDoEdital(proc);
  const lista = $("psCronogramaLista");
  if (lista) {
    lista.innerHTML = "";
    (etapas.length ? etapas : [{ atividade: "", data: "" }])
      .forEach(e => lista.appendChild(criarLinhaCronograma(e.atividade, e.data)));
    renumerarLinhasCronograma();
  }
  modal.hidden = false;
  document.body.style.overflow = "hidden";
}

function fecharModalCronograma() {
  const modal = $("psModalCronograma");
  if (!modal) return;
  modal.hidden = true;
  cronogramaEditId = null;
  document.body.style.overflow = "";
}

// Monta uma linha editável (atividade + data) com o selo de leitura da data.
function criarLinhaCronograma(atividade, data) {
  const row = document.createElement("div");
  row.className = "psCronoEditRow";
  row.dataset.cronoRow = "";
  row.innerHTML = `
    <span class="psCronoEditColNum" data-crono-num></span>
    <input class="psInput" data-crono-ativ type="text" placeholder="Atividade" maxlength="255">
    <div class="psCronoEditColData">
      <input class="psInput" data-crono-data type="text" placeholder="dd/mm/aaaa" maxlength="120">
      <span class="psCronoDataHint" data-crono-hint></span>
    </div>
    <button type="button" class="psIconBtn" data-crono-remover title="Remover etapa"><i class="fa-solid fa-trash"></i></button>`;
  row.querySelector("[data-crono-ativ]").value = atividade || "";
  row.querySelector("[data-crono-data]").value = data || "";
  atualizarHintData(row);
  return row;
}

// Atualiza o selo de leitura da data: verde com a(s) data(s) reconhecida(s) ou
// vermelho quando o texto não vira uma data válida (mesma regra da tabela/KPIs).
function atualizarHintData(row) {
  const valor = (row.querySelector("[data-crono-data]")?.value || "").trim();
  const hint = row.querySelector("[data-crono-hint]");
  if (!hint) return;
  if (!valor) { hint.className = "psCronoDataHint"; hint.textContent = ""; return; }
  const { inicio, fim } = parseDatasCronograma(valor);
  if (!inicio) {
    hint.className = "psCronoDataHint is-erro";
    hint.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> não reconhecida — inclua o ano`;
  } else {
    const txt = fim && fim.getTime() !== inicio.getTime()
      ? `${inicio.toLocaleDateString("pt-BR")} a ${fim.toLocaleDateString("pt-BR")}`
      : inicio.toLocaleDateString("pt-BR");
    hint.className = "psCronoDataHint is-ok";
    hint.innerHTML = `<i class="fa-solid fa-check"></i> ${escapeHtml(txt)}`;
  }
}

function renumerarLinhasCronograma(lista) {
  lista = lista || $("psCronogramaLista");
  if (!lista) return;
  [...lista.querySelectorAll("[data-crono-row]")].forEach((row, i) => {
    const num = row.querySelector("[data-crono-num]");
    if (num) num.textContent = String(i + 1);
  });
}

async function salvarCronograma(event) {
  event.preventDefault();
  if (!cronogramaEditId || !podeEditarProcessos()) { fecharModalCronograma(); return; }
  const lista = $("psCronogramaLista");
  const rows = lista ? [...lista.querySelectorAll("[data-crono-row]")] : [];
  // Etapas sem atividade são descartadas (mesmo critério do servidor).
  const cronograma = rows.map(row => ({
    atividade: (row.querySelector("[data-crono-ativ]")?.value || "").trim(),
    data: (row.querySelector("[data-crono-data]")?.value || "").trim()
  })).filter(e => e.atividade);

  const btn = $("psModalCronogramaSalvar");
  if (btn) btn.disabled = true;
  try {
    // Só `cronograma`: sem `cargos`, o upsert de vagas não altera nada (quadro de
    // vagas e aprovados ficam intactos).
    await psApi("POST", `/api/processos-seletivos/editais/${encodeURIComponent(cronogramaEditId)}/anexo`, { cronograma });
  } catch (e) {
    const erro = $("psCronogramaErro");
    if (erro) erro.textContent = e.message || "Não foi possível salvar o cronograma.";
    if (btn) btn.disabled = false;
    return;
  }
  if (btn) btn.disabled = false;
  fecharModalCronograma();
  psToast("Cronograma atualizado.");
  await recarregar();
}

// ---------- Conferência (passo 3 do assistente): linha do quadro de vagas ----------
// Linha editável do quadro de vagas: cargo + 5 cotas (AC/PcD/P-P/Ind/Quil).
// Aceita número ou "CR". Total é derivado no back — não entra aqui.
function criarLinhaVaga(c) {
  c = c || {};
  const row = document.createElement("div");
  row.className = "psConfVagaRow";
  row.dataset.vagaRow = "";
  row.innerHTML = `
    <input class="psInput psConfCargo" data-vaga-cargo type="text" placeholder="Nome do cargo" maxlength="150">
    <input class="psInput" data-vaga-ampla type="text" maxlength="8" title="Ampla Concorrência">
    <input class="psInput" data-vaga-pcd type="text" maxlength="8" title="PcD">
    <input class="psInput" data-vaga-pretosPardos type="text" maxlength="8" title="Pretos/Pardos">
    <input class="psInput" data-vaga-indigenas type="text" maxlength="8" title="Indígenas">
    <input class="psInput" data-vaga-quilombolas type="text" maxlength="8" title="Quilombolas">
    <button type="button" class="psIconBtn" data-vaga-remover title="Remover cargo"><i class="fa-solid fa-trash"></i></button>`;
  row.querySelector("[data-vaga-cargo]").value = c.cargo || "";
  ["ampla", "pcd", "pretosPardos", "indigenas", "quilombolas"].forEach(k => {
    const v = c[k];
    row.querySelector(`[data-vaga-${k}]`).value = (v === undefined || v === null) ? "" : String(v);
  });
  return row;
}

// ---------- Inicialização ----------
let processosConfigurado = false;

export function configurarProcessosSeletivos() {
  if (processosConfigurado) return;
  const raiz = $("view-processosSeletivos");
  if (!raiz) return;
  processosConfigurado = true;

  renderTudo();       // estrutura inicial (vazia) enquanto carrega
  recarregar(true);   // carrega os editais do banco (silencioso: roda p/ todos no init)

  $("psFiltroUnidade")?.addEventListener("change", () => { paginaAtual = 1; renderTabela(); });
  $("psFiltroStatus")?.addEventListener("change", () => { paginaAtual = 1; renderTabela(); });
  $("psBusca")?.addEventListener("input", debounce(() => { paginaAtual = 1; renderTabela(); }, 250));

  // Assistente de edital (3 passos: dados -> anexo -> conferência).
  $("psBtnAddEdital")?.addEventListener("click", () => abrirModalEdital());
  $("psModalFechar")?.addEventListener("click", fecharModalEdital);
  $("psModalCancelar")?.addEventListener("click", fecharModalEdital);
  // Enter no formulário do passo 1 = avançar (não submete/grava direto).
  $("psFormEdital")?.addEventListener("submit", event => { event.preventDefault(); wizardProximo(); });
  $("psModalEdital")?.addEventListener("click", event => {
    if (event.target.id === "psModalEdital") fecharModalEdital();
  });
  // Botões de navegação do assistente.
  $("psWizVoltar")?.addEventListener("click", wizardVoltar);
  $("psWizProximo")?.addEventListener("click", wizardProximo);
  $("psWizPular")?.addEventListener("click", wizardPular);
  $("psWizConcluir")?.addEventListener("click", wizardConcluir);
  document.querySelectorAll('input[name="psDocTipo"]').forEach(radio =>
    radio.addEventListener("change", atualizarTipoDoc));
  // Ao escolher o DSEI/CASAI, traz a UF principal automaticamente.
  $("psFormUnidade")?.addEventListener("change", () => {
    const uf = dseiUfMap.get($("psFormUnidade").value || "");
    const el = $("psFormUf");
    if (uf && el) el.value = uf;
  });
  carregarDseisForm(); // aquece o cache da lista de DSEIs (não bloqueia o init)

  // Aprovados: sem modal — inserção/edição inline na própria tabela.

  // Modal de configuração da classificação (por edital).
  $("psModalConfigFechar")?.addEventListener("click", fecharModalConfig);
  $("psModalConfigCancelar")?.addEventListener("click", fecharModalConfig);
  $("psFormConfig")?.addEventListener("submit", salvarConfig);
  $("psModalConfig")?.addEventListener("click", event => {
    if (event.target.id === "psModalConfig") fecharModalConfig();
  });

  // Modal de ajuste do cronograma (edição manual de atividades/datas).
  $("psModalCronogramaFechar")?.addEventListener("click", fecharModalCronograma);
  $("psModalCronogramaCancelar")?.addEventListener("click", fecharModalCronograma);
  $("psFormCronograma")?.addEventListener("submit", salvarCronograma);
  $("psModalCronograma")?.addEventListener("click", event => {
    if (event.target.id === "psModalCronograma") fecharModalCronograma();
  });
  $("psCronogramaAddLinha")?.addEventListener("click", () => {
    const lista = $("psCronogramaLista");
    if (!lista) return;
    lista.appendChild(criarLinhaCronograma("", ""));
    renumerarLinhasCronograma();
  });
  // Remover etapa e revalidar o selo da data ao digitar (delegação na lista).
  $("psCronogramaLista")?.addEventListener("click", event => {
    const rem = event.target.closest("[data-crono-remover]");
    if (rem) { rem.closest("[data-crono-row]")?.remove(); renumerarLinhasCronograma(); }
  });
  $("psCronogramaLista")?.addEventListener("input", event => {
    if (event.target.matches("[data-crono-data]")) atualizarHintData(event.target.closest("[data-crono-row]"));
  });

  // Conferência (passo 3 do assistente): adicionar/remover cargos e etapas.
  $("psConfAddVaga")?.addEventListener("click", () => {
    $("psConfVagasLista")?.appendChild(criarLinhaVaga({}));
  });
  $("psConfVagasLista")?.addEventListener("click", event => {
    const rem = event.target.closest("[data-vaga-remover]");
    if (rem) rem.closest("[data-vaga-row]")?.remove();
  });
  $("psConfAddCrono")?.addEventListener("click", () => {
    const lista = $("psConfCronoLista");
    if (!lista) return;
    lista.appendChild(criarLinhaCronograma("", ""));
    renumerarLinhasCronograma(lista);
  });
  $("psConfCronoLista")?.addEventListener("click", event => {
    const rem = event.target.closest("[data-crono-remover]");
    if (rem) { const l = $("psConfCronoLista"); rem.closest("[data-crono-row]")?.remove(); renumerarLinhasCronograma(l); }
  });
  $("psConfCronoLista")?.addEventListener("input", event => {
    if (event.target.matches("[data-crono-data]")) atualizarHintData(event.target.closest("[data-crono-row]"));
  });

  // Delegação para os elementos gerados dinamicamente (tabela + detalhe).
  raiz.addEventListener("click", event => {
    const editar = event.target.closest("[data-ps-editar]");
    if (editar) { abrirModalEdital(editar.dataset.psEditar); return; }

    const excluir = event.target.closest("[data-ps-excluir]");
    if (excluir) { excluirEdital(excluir.dataset.psExcluir); return; }

    const anexo = event.target.closest("[data-ps-anexo]");
    if (anexo) { abrirModalEdital(anexo.dataset.psAnexo, { modo: "anexo", passo: 2 }); return; }

    const remAnexo = event.target.closest("[data-ps-remover-anexo]");
    if (remAnexo) { removerAnexo(remAnexo.dataset.psRemoverAnexo); return; }

    const ajCrono = event.target.closest("[data-ps-cronograma]");
    if (ajCrono) { abrirModalCronograma(ajCrono.dataset.psCronograma); return; }

    const det = event.target.closest("[data-ps-detalhe]");
    if (det) { alternarDetalhe(det.dataset.psDetalhe); return; }

    // Ações dos aprovados / configuração / cronograma (dentro do detalhamento).
    // Vêm antes de data-ps-vaga: os botões ficam fora das linhas de vaga, então
    // nunca conflitam, mas a ordem deixa a intenção explícita.
    const aprNovo = event.target.closest("[data-ps-aprovado-novo]");
    if (aprNovo) { adicionarAprovadoInline(aprNovo.dataset.psAprovadoNovo); return; }

    const aprDoc = event.target.closest("[data-ps-aprovado-doc]");
    if (aprDoc) { anexarDocDesistencia(aprDoc.dataset.psAprovadoDoc); return; }

    const aprDel = event.target.closest("[data-ps-aprovado-excluir]");
    if (aprDel) { excluirAprovado(aprDel.dataset.psAprovadoExcluir); return; }

    const cfg = event.target.closest("[data-ps-config]");
    if (cfg) { abrirModalConfig(cfg.dataset.psConfig); return; }

    const etapa = event.target.closest("[data-ps-etapa-toggle]");
    if (etapa) { cronoExpandido = !cronoExpandido; renderDetalhe(); return; }

    const vaga = event.target.closest("[data-ps-vaga]");
    if (vaga) { selecionarVaga(vaga.dataset.psVaga); return; }

    const pag = event.target.closest("[data-ps-pagina]");
    if (pag) { paginaAtual = Number(pag.dataset.psPagina) || 1; renderTabela(); return; }
  });

  // Acessibilidade: linhas clicáveis também respondem a Enter/Espaço.
  raiz.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const linhaEdital = event.target.closest("tr.psRow[data-ps-detalhe]");
    if (linhaEdital) { event.preventDefault(); alternarDetalhe(linhaEdital.dataset.psDetalhe); return; }
    const linhaVaga = event.target.closest("tr.psRow[data-ps-vaga]");
    if (linhaVaga) { event.preventDefault(); selecionarVaga(linhaVaga.dataset.psVaga); }
  });
}
