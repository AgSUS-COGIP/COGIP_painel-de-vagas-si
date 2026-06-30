// =========================================================
// Processos Seletivos (dados reais dos editais)
// Aba autocontida, alimentada por dados reais embutidos
// (processos-seletivos-dados.js, gerado a partir do CSV oficial).
//   - Tabela: Unidade, UF, Edital, Data de Início, Data de
//     Encerramento, Status e Responsável.
//   - Detalhes (painel abaixo): as demais colunas do edital
//     (Processo SEI, Ciclo, Etapa, Risco, Vagas Previstas,
//     Contratados, Vagas Ociosas, Inscritos, Observações e o
//     link do edital).
// Registra os ouvintes em configurarProcessosSeletivos(),
// chamado no init do app. Somente leitura (sem cadastro).
// =========================================================
import { escapeAttr, escapeHtml, debounce, safeUrl } from "./utils.js";
import { preencherSelect, criarToast } from "./ui-utils.js";
import { abrirModal } from "./modal.js";
import { nivelModulo } from "./permissoes.js";
import { PROCESSOS_SELETIVOS_DADOS } from "./processos-seletivos-dados.js";
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
  "Cancelado": "is-encerrado"               // vermelho: cancelado
};

// Status que congelam o DSEI para fins de Remanejamento: enquanto houver um
// processo seletivo em andamento naquela unidade, a redução de vagas fica
// bloqueada (ver remanejamento.js). O cruzamento é feito pelo NOME da unidade.
const STATUS_BLOQUEIA_REMANEJAMENTO = ["Andamento"];

const POR_PAGINA = 10;

// Carrega os dados reais (status normalizado uma única vez).
let processos = (PROCESSOS_SELETIVOS_DADOS || []).map(p => ({
  ...p,
  status: normalizarStatus(p.status)
}));

// ---------- Estado da aba ----------
let paginaAtual = 1;
let processoExpandido = null; // id do edital com detalhamento aberto
let gradePs = null;           // grade Tabulator da tabela principal (só colunas)

// Dados de vagas/cronograma extraídos de anexos PDF enviados pelo usuário,
// por id de edital: { cargos: [...], cronograma: [...] }. Apenas em memória
// (não persiste; some ao recarregar a página).
const anexosExtraidos = new Map();
let anexoProcessoId = null; // edital alvo do modal "Inserir anexo"
let editandoId = null;      // edital em edição no modal (null = novo cadastro)

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
let aprovadoEditalId = null; // edital alvo do modal de aprovado
let aprovadoCargo = null;    // cargo alvo do modal de aprovado
let aprovadoEditId = null;   // id do aprovado em edição (null = novo)
let configEditalId = null;   // edital alvo do modal de configuração

const $ = id => document.getElementById(id);

// Toast reaproveitando o visual compartilhado (mesma classe das outras abas).
const psToast = criarToast("psToast", { className: "gfToast" });

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
function badgeStatus(status) {
  const cls = BADGE_STATUS[status] || "is-naoiniciado";
  return `<span class="psBadge ${cls}">${escapeHtml(status)}</span>`;
}

// "2025-06-09" -> "09/06/2025"; mantém o valor original se não for ISO.
function isoParaBr(iso) {
  if (!iso) return "—";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

const numFmt = n => Number(n || 0).toLocaleString("pt-BR");

// ---------- Colunas da tabela principal (Tabulator, só colunas) ----------
// O clique na linha abre/recolhe o detalhe (aoClicarLinha → alternarDetalhe);
// a linha aberta fica destacada via idSelecionado (classe tab-selected). O
// chevron acompanha o estado lendo processoExpandido no formatter.
const PS_COLS = [
  { title: "Unidade", field: "unidade", cssClass: "psCelNome", minWidth: 200,
    formatter: c => escapeHtml(c.getValue() || "—") },
  { title: "UF", field: "uf", hozAlign: "center", formatter: c => escapeHtml(c.getValue() || "—") },
  { title: "Edital", field: "edital", hozAlign: "center", formatter: c => escapeHtml(c.getValue() || "—") },
  { title: "Data de Início", field: "dataInicio", hozAlign: "center", formatter: c => isoParaBr(c.getValue()) },
  { title: "Data de Encerramento", field: "dataEncerramento", hozAlign: "center", formatter: c => isoParaBr(c.getValue()) },
  { title: "Status", field: "status", formatter: c => badgeStatus(c.getValue()) },
  { title: "Responsável", field: "responsavel", minWidth: 160, formatter: c => {
      const aberto = processoExpandido === c.getRow().getData().id;
      return `<div class="psRespCel"><span>${escapeHtml(c.getValue() || "—")}</span>` +
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
    if (status && p.status !== status) return false;
    if (termo) {
      const alvo = `${p.unidade} ${p.uf} ${p.edital} ${p.processoSei} ${p.status} ${p.etapa} ${p.responsavel} ${p.ciclo}`.toLowerCase();
      if (!alvo.includes(termo)) return false;
    }
    return true;
  });
}

// ---------- KPIs ----------
function renderKpis() {
  const conta = status => processos.filter(p => p.status === status).length;
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set("psKpiTotal", processos.length);
  set("psKpiAndamento", conta("Andamento"));
  set("psKpiConcluido", conta("Concluído"));
  set("psKpiCancelado", conta("Cancelado"));
  set("psKpiVagas", numFmt(processos.reduce((s, p) => s + Number(p.vagasPrevistas || 0), 0)));
}

// ---------- Selects de filtro ----------
function preencherFiltros() {
  const unidades = [...new Set(processos.map(p => p.unidade).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  preencherSelect("psFiltroUnidade", unidades, "Todas as unidades");

  const statuses = [...new Set(processos.map(p => p.status).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
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
      persistID: "psEditaisV2",
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
      formatter: c => escapeHtml(celulaVazia(c.getValue()) ? "—" : c.getValue())
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

// Destaca a etapa atual do processo no cronograma (casa pelo nome da atividade).
function ehEtapaAtual(proc, atividade) {
  const etapa = normChave(proc?.etapa);
  if (!etapa) return false;
  const alvo = normChave(atividade);
  return alvo === etapa || alvo.includes(etapa) || etapa.includes(alvo);
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
  criarTabelaArrastavel({
    elemento: "psCronogramaTab",
    colunas: [
      { title: "#", field: "ordem", hozAlign: "center", width: 64,
        formatter: c => escapeHtml(String(c.getValue() ?? "")) },
      { title: "Atividade", field: "atividade", cssClass: "psCelNome", minWidth: 220,
        formatter: c => {
          const e = c.getRow().getData();
          const atual = ehEtapaAtual(proc, e.atividade);
          return `${escapeHtml(e.atividade || "—")}${atual ? ` <span class="psBadge is-breve">Etapa atual</span>` : ""}`;
        } },
      { title: "Data", field: "data", minWidth: 120, formatter: c => escapeHtml(c.getValue() || "—") }
    ],
    persistID: "psCronograma",
    indexField: "ordem",
    movableColumns: false,
    movableRows: false,
    aoFormatarLinha: row => {
      if (ehEtapaAtual(proc, row.getData().atividade)) row.getElement().classList.add("is-etapa-atual");
    },
    dados: etapas
  });
}

// Rótulo da etapa atual: casa pela atividade atual no cronograma; senão proc.etapa.
function etapaAtualLabel(proc) {
  const atual = cronogramaDoEdital(proc).find(e => ehEtapaAtual(proc, e.atividade));
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
  const corpo = cronoExpandido
    ? `<div class="psEtapaCorpo">
         ${etapas.length ? `<div class="psEtapaMeta">${etapas.length} etapa(s)${viaAnexo}</div>` : ""}
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
        <h3>${escapeHtml(proc.unidade)} — Edital ${escapeHtml(proc.edital || "—")} ${badgeStatus(proc.status)}</h3>
        <p>${escapeHtml(proc.uf || "—")} &nbsp;·&nbsp; ${escapeHtml(proc.ciclo || "Ciclo não informado")} &nbsp;·&nbsp;
          Período: ${isoParaBr(proc.dataInicio)} a ${isoParaBr(proc.dataEncerramento)}</p>
      </div>
      <div class="psDetalheAcoes">
        ${podeEditarProcessos() ? `
        <button type="button" class="psBtn psBtnGhost" data-ps-editar="${escapeAttr(proc.id)}">
          <i class="fa-solid fa-pen-to-square"></i> Editar
        </button>
        <button type="button" class="psBtn psBtnGhost" data-ps-anexo="${escapeAttr(proc.id)}">
          <i class="fa-solid fa-file-arrow-up"></i> Inserir anexo
        </button>` : ""}
        <button type="button" class="psBtn psBtnGhost" data-ps-detalhe="${escapeAttr(proc.id)}">
          Recolher detalhes <i class="fa-solid fa-chevron-up"></i>
        </button>
      </div>
    </div>

    <div class="psResumoTiles">
      <div class="psTile"><div class="psTileValue">${numFmt(proc.vagasPrevistas)}</div><div class="psTileLabel">Vagas Previstas</div></div>
      <div class="psTile"><div class="psTileValue is-green">${numFmt(proc.contratados)}</div><div class="psTileLabel">Contratados</div></div>
      <div class="psTile"><div class="psTileValue is-red">${numFmt(proc.vagasOciosas)}</div><div class="psTileLabel">Vagas Ociosas</div></div>
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

// ---------- Render geral ----------
function renderTudo() {
  renderKpis();
  preencherFiltros();
  renderTabela();
  renderDetalhe();
}

// A grade Tabulator não monta com a aba oculta (largura 0). Ao navegar para a
// aba, re-renderiza (monta na 1ª vez) e recalcula o layout.
export function renderProcessosSeletivosAoMostrar() {
  renderTabela();
  gradePs?.redraw();
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

// ---------- Cadastro de novo edital (modal) ----------
function atualizarTipoDoc() {
  const tipo = document.querySelector('input[name="psDocTipo"]:checked')?.value || "link";
  const linkWrap = $("psDocLinkWrap");
  const anexoWrap = $("psDocAnexoWrap");
  if (linkWrap) linkWrap.hidden = tipo !== "link";
  if (anexoWrap) anexoWrap.hidden = tipo !== "anexo";
}

// Abre o modal em modo "novo" (sem id) ou "edição" (com o id do edital).
function abrirModalEdital(id) {
  const modal = $("psModalEdital");
  if (!modal) return;
  $("psFormEdital")?.reset();
  $("psFormAnexo")?._fi?.render(); // re-sincroniza o componente de arquivo após o reset
  const erro = $("psFormErro");
  if (erro) erro.textContent = "";

  editandoId = typeof id === "string" ? id : null;
  const proc = editandoId ? processos.find(p => p.id === editandoId) : null;

  // Ajusta título e botão conforme o modo.
  const titulo = $("psModalTitulo");
  if (titulo) {
    titulo.innerHTML = proc
      ? `<i class="fa-solid fa-pen-to-square"></i> Editar edital`
      : `<i class="fa-solid fa-file-circle-plus"></i> Adicionar edital`;
  }
  const btnSalvar = $("psModalSalvar");
  if (btnSalvar) {
    btnSalvar.innerHTML = proc
      ? `<i class="fa-solid fa-check"></i> Salvar alterações`
      : `<i class="fa-solid fa-check"></i> Salvar edital`;
  }

  // Em edição, preenche os campos com os dados atuais do edital.
  if (proc) {
    const set = (campo, valor) => { const el = $(campo); if (el) el.value = valor ?? ""; };
    set("psFormUnidade", proc.unidade);
    set("psFormUf", proc.uf);
    set("psFormEditalNum", proc.edital);
    set("psFormVagas", proc.vagasPrevistas || "");
    set("psFormContratados", proc.contratados || "");
    set("psFormRisco", proc.risco);
    set("psFormDataInicio", proc.dataInicio);
    set("psFormDataFim", proc.dataEncerramento);
    set("psFormResponsavel", proc.responsavel);
    set("psFormStatus", proc.status);
    set("psFormObs", proc.observacoes);
    // Só dá para repor um link http(s); anexos (object URL) não voltam a um input file.
    const ehLink = /^https?:\/\//i.test(proc.linkEdital || "");
    const radioLink = document.querySelector('input[name="psDocTipo"][value="link"]');
    if (radioLink) radioLink.checked = true;
    set("psFormLink", ehLink ? proc.linkEdital : "");
  }

  atualizarTipoDoc();
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  setTimeout(() => $("psFormUnidade")?.focus(), 40);
}

function fecharModalEdital() {
  const modal = $("psModalEdital");
  if (!modal) return;
  modal.hidden = true;
  editandoId = null;
  document.body.style.overflow = "";
}

// Lê um campo numérico do formulário (>= 0; vazio/ inválido vira 0).
function valorNum(id) {
  const v = Number($(id)?.value);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function salvarEdital(event) {
  event.preventDefault();
  const erro = $("psFormErro");

  const unidade = ($("psFormUnidade")?.value || "").trim();
  const uf = ($("psFormUf")?.value || "").trim().toUpperCase();
  const edital = ($("psFormEditalNum")?.value || "").trim();
  if (!unidade || !uf || !edital) {
    if (erro) erro.textContent = "Preencha os campos obrigatórios: Unidade, UF e Edital.";
    return;
  }

  // Documento: link OU anexo em PDF (um ou outro).
  const tipoDoc = document.querySelector('input[name="psDocTipo"]:checked')?.value || "link";
  let linkEdital = "";
  if (tipoDoc === "link") {
    linkEdital = ($("psFormLink")?.value || "").trim();
  } else {
    const arquivo = $("psFormAnexo")?.files?.[0];
    if (arquivo) linkEdital = URL.createObjectURL(arquivo);
  }

  const vagasPrevistas = valorNum("psFormVagas");
  const contratados = valorNum("psFormContratados");

  const dados = {
    unidade,
    uf,
    edital,
    risco: ($("psFormRisco")?.value || "").trim(),
    vagasPrevistas,
    contratados,
    vagasOciosas: Math.max(0, vagasPrevistas - contratados),
    dataInicio: $("psFormDataInicio")?.value || "",
    dataEncerramento: $("psFormDataFim")?.value || "",
    responsavel: ($("psFormResponsavel")?.value || "").trim(),
    status: normalizarStatus($("psFormStatus")?.value || "Andamento"),
    observacoes: ($("psFormObs")?.value || "").trim()
  };

  if (editandoId) {
    // Edição: atualiza o edital existente, preservando id/etapa e mantendo o
    // documento atual caso nenhum novo link/anexo tenha sido informado.
    processos = processos.map(p =>
      p.id === editandoId ? { ...p, ...dados, linkEdital: linkEdital || p.linkEdital } : p
    );
  } else {
    // Novo cadastro.
    const novo = { id: `novo-${Date.now()}`, etapa: "", ...dados, linkEdital };
    processos = [novo, ...processos];
    paginaAtual = 1;
  }

  fecharModalEdital();
  renderTudo();
}

// ---------- Inserir anexo (extrai vagas + cronograma do PDF) ----------
function abrirModalAnexo(id) {
  anexoProcessoId = id;
  const modal = $("psModalAnexo");
  if (!modal) return;
  $("psFormAnexoEdital")?.reset();
  $("psAnexoArquivo")?._fi?.render(); // re-sincroniza o componente de arquivo após o reset
  const erro = $("psAnexoErro");
  if (erro) erro.textContent = "";
  const status = $("psAnexoStatus");
  if (status) { status.hidden = true; status.innerHTML = ""; }
  const botao = $("psAnexoEnviar");
  if (botao) botao.disabled = false;
  modal.hidden = false;
  document.body.style.overflow = "hidden";
}

function fecharModalAnexo() {
  const modal = $("psModalAnexo");
  if (!modal) return;
  modal.hidden = true;
  document.body.style.overflow = "";
}

async function enviarAnexo(event) {
  event.preventDefault();
  const erro = $("psAnexoErro");
  const status = $("psAnexoStatus");
  const botao = $("psAnexoEnviar");
  if (erro) erro.textContent = "";

  const arquivo = $("psAnexoArquivo")?.files?.[0];
  if (!arquivo) {
    if (erro) erro.textContent = "Selecione um arquivo PDF.";
    return;
  }

  const fd = new FormData();
  fd.append("anexo", arquivo);

  if (status) {
    status.hidden = false;
    status.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Lendo o PDF e extraindo os dados…`;
  }
  if (botao) botao.disabled = true;

  try {
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

    anexosExtraidos.set(anexoProcessoId, { cargos, cronograma });
    fecharModalAnexo();
    renderDetalhe();
  } catch (e) {
    if (status) status.hidden = true;
    if (erro) erro.textContent = e.message || "Erro ao processar o anexo.";
  } finally {
    if (botao) botao.disabled = false;
  }
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

const ehCota = c => c.tipo === "PcD" || c.tipo === "PPIQ";

// Classifica por nota. Com intervaloCota X > 0, a cada X normais colocados a
// próxima posição é reservada ao melhor cotista (PcD ou PPIQ) disponível — ele
// "fura" a ordem por nota ("independente da classificação"). Sem cotista, cai
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
const BADGE_TIPO = { NORMAL: "is-naoiniciado", PcD: "is-aguardando", PPIQ: "is-breve" };
const BADGE_CAND_STATUS = { Convocado: "is-andamento", Aguardando: "is-aguardando", Desistiu: "is-encerrado" };
function badgeTipo(t) { return `<span class="psBadge ${BADGE_TIPO[t] || "is-naoiniciado"}">${escapeHtml(t || "—")}</span>`; }
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
    ? ` · regra: 1 PcD/PPIQ a cada ${config.intervaloCota} normais`
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

// Grade "Aprovados para [vaga]" (Tabulator só-estilo). Colunas condicionais:
// "#" (posição) só se config.mostrarPosicoes; "Ações" só para Editor. A posição
// e o selo "cota" saem da classificação; o aprovado que desistiu fica esmaecido
// (classe is-desistiu via aoFormatarLinha).
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

  const cols = [];
  if (colPos) {
    cols.push({ title: "#", hozAlign: "center", width: 72, formatter: c => {
      const d = c.getRow().getData();
      return `${d._posicao}${d._reservado ? ` <span class="psBadge is-aguardando">cota</span>` : ""}`;
    } });
  }
  cols.push({ title: "Nome", field: "nome", cssClass: "psCelNome", minWidth: 180, formatter: c => escapeHtml(c.getValue()) });
  cols.push({ title: "Nota", field: "nota", hozAlign: "center", formatter: c => fmtNota(c.getValue()) });
  cols.push({ title: "Tipo", field: "tipo", formatter: c => badgeTipo(c.getValue()) });
  cols.push({ title: "Status", field: "status", formatter: c => badgeCandStatus(c.getValue()) });
  cols.push({ title: "Documento", field: "docDesistencia", minWidth: 140, formatter: c => {
    const d = c.getRow().getData();
    return (d.status === "Desistiu" && d.docDesistencia)
      ? `<a class="psDocLink" href="${escapeAttr(safeUrl(d.docDesistencia.url))}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-file-arrow-down"></i> ${escapeHtml(d.docDesistencia.nome || "documento")}</a>`
      : "—";
  } });
  if (podeEditar) {
    cols.push({ title: "Ações", hozAlign: "center", minWidth: 90, formatter: c => {
      const id = c.getRow().getData().id;
      return `<span class="psAprovadoAcoes">` +
        `<button type="button" class="psIconBtn" data-ps-aprovado-editar="${escapeAttr(id)}" title="Editar aprovado"><i class="fa-solid fa-pen-to-square"></i></button>` +
        `<button type="button" class="psIconBtn" data-ps-aprovado-excluir="${escapeAttr(id)}" title="Excluir aprovado"><i class="fa-solid fa-trash"></i></button></span>`;
    } });
  }

  criarTabelaArrastavel({
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
}

// Seleciona/deseleciona a vaga e re-renderiza o detalhamento.
function selecionarVaga(nomeCargo) {
  vagaSelecionada = (normChave(vagaSelecionada) === normChave(nomeCargo)) ? null : nomeCargo;
  renderDetalhe();
}

// ---------- Modal de aprovado (criar/editar) ----------
function abrirModalAprovado(editalId, cargoNome, candId) {
  if (!editalId || !cargoNome) return;
  aprovadoEditalId = editalId;
  aprovadoCargo = cargoNome;
  aprovadoEditId = candId || null;

  const modal = $("psModalAprovado");
  if (!modal) return;
  $("psFormAprovado")?.reset();
  $("psAprovadoDoc")?._fi?.render(); // re-sincroniza o componente de arquivo após o reset
  const erro = $("psAprovadoErro");
  if (erro) erro.textContent = "";

  const cand = aprovadoEditId
    ? aprovadosDoCargo(editalId, cargoNome).find(c => c.id === aprovadoEditId)
    : null;

  const titulo = $("psModalAprovadoTitulo");
  if (titulo) {
    titulo.innerHTML = cand
      ? `<i class="fa-solid fa-user-pen"></i> Editar aprovado`
      : `<i class="fa-solid fa-user-plus"></i> Adicionar aprovado`;
  }
  if (cand) {
    const set = (id, v) => { const el = $(id); if (el) el.value = v ?? ""; };
    set("psAprovadoNome", cand.nome);
    set("psAprovadoNota", notaValida(cand.nota) ? valNota(cand.nota) : "");
    set("psAprovadoTipo", cand.tipo || "NORMAL");
    set("psAprovadoStatus", cand.status || "Aguardando");
  }
  atualizarCampoDesistencia();

  modal.hidden = false;
  document.body.style.overflow = "hidden";
  setTimeout(() => $("psAprovadoNome")?.focus(), 40);
}

function fecharModalAprovado() {
  const modal = $("psModalAprovado");
  if (!modal) return;
  modal.hidden = true;
  aprovadoEditalId = null;
  aprovadoCargo = null;
  aprovadoEditId = null;
  document.body.style.overflow = "";
}

// O documento de desistência só aparece quando o status é "Desistiu".
function atualizarCampoDesistencia() {
  const wrap = $("psAprovadoDocWrap");
  if (wrap) wrap.hidden = ($("psAprovadoStatus")?.value || "") !== "Desistiu";
}

function salvarAprovado(event) {
  event.preventDefault();
  const erro = $("psAprovadoErro");
  if (erro) erro.textContent = "";

  const nome = ($("psAprovadoNome")?.value || "").trim();
  if (!nome) { if (erro) erro.textContent = "Informe o nome do aprovado."; return; }

  const notaRaw = ($("psAprovadoNota")?.value || "").trim();
  const nota = notaRaw === "" ? null : Number(notaRaw.replace(",", "."));
  if (notaRaw !== "" && !Number.isFinite(nota)) { if (erro) erro.textContent = "Nota inválida."; return; }

  const tipo = $("psAprovadoTipo")?.value || "NORMAL";
  const status = $("psAprovadoStatus")?.value || "Aguardando";

  const lista = aprovadosDoCargo(aprovadoEditalId, aprovadoCargo);
  const atual = aprovadoEditId ? lista.find(c => c.id === aprovadoEditId) : null;

  // Documento de desistência: só quando status = Desistiu. Mantém o anterior se
  // nenhum arquivo novo for escolhido; limpa ao sair de "Desistiu". O object URL
  // não é revogado (protótipo, em memória).
  let docDesistencia = atual ? atual.docDesistencia : null;
  if (status === "Desistiu") {
    const arquivo = $("psAprovadoDoc")?.files?.[0];
    if (arquivo) docDesistencia = { url: URL.createObjectURL(arquivo), nome: arquivo.name };
  } else {
    docDesistencia = null;
  }

  if (atual) {
    Object.assign(atual, { nome, nota, tipo, status, docDesistencia });
    psToast("Aprovado atualizado.");
  } else {
    lista.push({
      id: `cand-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      nome, nota, tipo, status, docDesistencia
    });
    psToast("Aprovado adicionado.");
  }

  fecharModalAprovado();
  renderDetalhe();
}

async function excluirAprovado(candId) {
  if (!processoExpandido || !vagaSelecionada) return;
  const lista = aprovadosDoCargo(processoExpandido, vagaSelecionada);
  const cand = lista.find(c => c.id === candId);
  if (!cand) return;
  const r = await abrirModal({
    titulo: "Excluir aprovado",
    msg: `Deseja realmente excluir "${cand.nome}"? Esta ação não pode ser desfeita.`,
    confirmarTexto: "Excluir",
    perigo: true
  });
  if (!r.ok) return;
  const i = lista.findIndex(c => c.id === candId);
  if (i >= 0) lista.splice(i, 1);
  psToast("Aprovado excluído.");
  renderDetalhe();
}

// ---------- Modal de configuração da classificação (por edital) ----------
function abrirModalConfig(editalId) {
  if (!editalId) return;
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
  if (!configEditalId) { fecharModalConfig(); return; }
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

// ---------- Inicialização ----------
let processosConfigurado = false;

export function configurarProcessosSeletivos() {
  if (processosConfigurado) return;
  const raiz = $("view-processosSeletivos");
  if (!raiz) return;
  processosConfigurado = true;

  renderTudo();

  $("psFiltroUnidade")?.addEventListener("change", () => { paginaAtual = 1; renderTabela(); });
  $("psFiltroStatus")?.addEventListener("change", () => { paginaAtual = 1; renderTabela(); });
  $("psBusca")?.addEventListener("input", debounce(() => { paginaAtual = 1; renderTabela(); }, 250));

  // Modal de cadastro/edição de edital.
  $("psBtnAddEdital")?.addEventListener("click", () => abrirModalEdital());
  $("psModalFechar")?.addEventListener("click", fecharModalEdital);
  $("psModalCancelar")?.addEventListener("click", fecharModalEdital);
  $("psFormEdital")?.addEventListener("submit", salvarEdital);
  $("psModalEdital")?.addEventListener("click", event => {
    if (event.target.id === "psModalEdital") fecharModalEdital();
  });
  document.querySelectorAll('input[name="psDocTipo"]').forEach(radio =>
    radio.addEventListener("change", atualizarTipoDoc));

  // Modal de inserção de anexo (extração de vagas/cronograma do PDF).
  $("psModalAnexoFechar")?.addEventListener("click", fecharModalAnexo);
  $("psModalAnexoCancelar")?.addEventListener("click", fecharModalAnexo);
  $("psFormAnexoEdital")?.addEventListener("submit", enviarAnexo);
  $("psModalAnexo")?.addEventListener("click", event => {
    if (event.target.id === "psModalAnexo") fecharModalAnexo();
  });

  // Modal de aprovado (CRUD por vaga).
  $("psModalAprovadoFechar")?.addEventListener("click", fecharModalAprovado);
  $("psBtnAprovadoCancelar")?.addEventListener("click", fecharModalAprovado);
  $("psFormAprovado")?.addEventListener("submit", salvarAprovado);
  $("psAprovadoStatus")?.addEventListener("change", atualizarCampoDesistencia);
  $("psModalAprovado")?.addEventListener("click", event => {
    if (event.target.id === "psModalAprovado") fecharModalAprovado();
  });

  // Modal de configuração da classificação (por edital).
  $("psModalConfigFechar")?.addEventListener("click", fecharModalConfig);
  $("psModalConfigCancelar")?.addEventListener("click", fecharModalConfig);
  $("psFormConfig")?.addEventListener("submit", salvarConfig);
  $("psModalConfig")?.addEventListener("click", event => {
    if (event.target.id === "psModalConfig") fecharModalConfig();
  });

  // Delegação para os elementos gerados dinamicamente (tabela + detalhe).
  raiz.addEventListener("click", event => {
    const editar = event.target.closest("[data-ps-editar]");
    if (editar) { abrirModalEdital(editar.dataset.psEditar); return; }

    const anexo = event.target.closest("[data-ps-anexo]");
    if (anexo) { abrirModalAnexo(anexo.dataset.psAnexo); return; }

    const det = event.target.closest("[data-ps-detalhe]");
    if (det) { alternarDetalhe(det.dataset.psDetalhe); return; }

    // Ações dos aprovados / configuração / cronograma (dentro do detalhamento).
    // Vêm antes de data-ps-vaga: os botões ficam fora das linhas de vaga, então
    // nunca conflitam, mas a ordem deixa a intenção explícita.
    const aprNovo = event.target.closest("[data-ps-aprovado-novo]");
    if (aprNovo) { abrirModalAprovado(processoExpandido, aprNovo.dataset.psAprovadoNovo); return; }

    const aprEdit = event.target.closest("[data-ps-aprovado-editar]");
    if (aprEdit) { abrirModalAprovado(processoExpandido, vagaSelecionada, aprEdit.dataset.psAprovadoEditar); return; }

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
