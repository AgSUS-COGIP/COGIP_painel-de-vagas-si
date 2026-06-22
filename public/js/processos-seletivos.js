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
import { escapeAttr, escapeHtml } from "./utils.js";
import { PROCESSOS_SELETIVOS_DADOS } from "./processos-seletivos-dados.js";
import { EDITAIS_VAGAS_DADOS } from "./editais-vagas-dados.js";
import { CRONOGRAMA_EDITAIS_DADOS } from "./cronograma-editais-dados.js";
import { ordenarLista, registrarOrdenacao, thOrdenavel } from "./ordenacao.js";

// ---------- Status (conforme o CSV) e badges ----------
// "Em Andamento" e "Andamento" são tratados como o mesmo status.
function normalizarStatus(s) {
  const v = String(s || "").trim();
  if (/^em\s+andamento$/i.test(v)) return "Andamento";
  return v || "—";
}

const BADGE_STATUS = {
  "Concluído": "is-andamento",   // verde: finalizado
  "Andamento": "is-breve",       // laranja: em curso
  "Cancelado": "is-encerrado"    // vermelho: cancelado
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

const $ = id => document.getElementById(id);

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
  const selU = $("psFiltroUnidade");
  if (selU) {
    const atual = selU.value;
    const unidades = [...new Set(processos.map(p => p.unidade).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
    selU.innerHTML = `<option value="">Todas as unidades</option>` +
      unidades.map(u => `<option value="${escapeAttr(u)}">${escapeHtml(u)}</option>`).join("");
    if (unidades.includes(atual)) selU.value = atual;
  }

  const selS = $("psFiltroStatus");
  if (selS) {
    const atual = selS.value;
    const statuses = [...new Set(processos.map(p => p.status).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
    selS.innerHTML = `<option value="">Todos os status</option>` +
      statuses.map(s => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join("");
    if (statuses.includes(atual)) selS.value = atual;
  }
}

// ---------- Tabela ----------
function renderTabela() {
  const body = $("psTabelaBody");
  if (!body) return;

  const lista = ordenarLista("ps", processosFiltrados());
  const totalPaginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  if (paginaAtual > totalPaginas) paginaAtual = totalPaginas;
  const inicio = (paginaAtual - 1) * POR_PAGINA;
  const pagina = lista.slice(inicio, inicio + POR_PAGINA);

  if (!pagina.length) {
    body.innerHTML = `<tr><td colspan="8" class="psEmpty">Nenhum edital encontrado para os filtros selecionados.</td></tr>`;
  } else {
    body.innerHTML = pagina.map(p => {
      const aberto = processoExpandido === p.id;
      return `
        <tr class="${aberto ? "is-expandido" : ""}">
          <td class="psCelNome">${escapeHtml(p.unidade)}</td>
          <td class="psTd-center">${escapeHtml(p.uf || "—")}</td>
          <td class="psTd-center">${escapeHtml(p.edital || "—")}</td>
          <td class="psTd-center">${isoParaBr(p.dataInicio)}</td>
          <td class="psTd-center">${isoParaBr(p.dataEncerramento)}</td>
          <td>${badgeStatus(p.status)}</td>
          <td>${escapeHtml(p.responsavel || "—")}</td>
          <td class="psTd-center">
            <button type="button" class="psAcaoBtn ${aberto ? "is-aberto" : ""}" data-ps-detalhe="${escapeAttr(p.id)}"
              title="Ver detalhes do edital">
              <span>Detalhes</span>
              <i class="fa-solid fa-chevron-down"></i>
            </button>
          </td>
        </tr>`;
    }).join("");
  }

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
// Normaliza o nome para casar o processo (unidade/uf/edital) com o CSV
// consolidado de cargos por edital (editais-vagas-dados.js).
function normChave(s) {
  return String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

function cargosDoEdital(proc) {
  if (!proc) return [];
  const chave = `${normChave(proc.unidade)}|${normChave(proc.uf)}|${normChave(proc.edital)}`;
  return EDITAIS_VAGAS_DADOS[chave] || [];
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
      <div class="psBloco">
        <h4 class="psBlocoTitulo">Vagas Previstas</h4>
        <p class="psObservacoes"><span class="psSemObs">Quadro de cargos não disponível para este edital.</span></p>
      </div>`;
  }

  const colunas = COLUNAS_VAGAS.filter(c => cargos.some(cargo => !celulaVazia(cargo[c.campo])));
  const ehNumerica = campo => campo !== "lotacao";

  const cabecalho = thOrdenavel("psVagas", "Cargo", "cargo") +
    colunas.map(c => thOrdenavel("psVagas", escapeHtml(c.rotulo), c.campo, { classe: ehNumerica(c.campo) ? "psTd-center" : "" })).join("");

  const linhas = ordenarLista("psVagas", cargos).map(cargo => {
    const celulas = colunas.map(c => {
      const valor = celulaVazia(cargo[c.campo]) ? "—" : cargo[c.campo];
      return `<td class="${ehNumerica(c.campo) ? "psTd-center" : ""}">${escapeHtml(valor)}</td>`;
    }).join("");
    return `<tr><td class="psCelNome">${escapeHtml(cargo.cargo)}</td>${celulas}</tr>`;
  }).join("");

  return `
    <div class="psBloco psBlocoFull">
      <div class="psBlocoHead">
        <h4 class="psBlocoTitulo">Vagas Previstas</h4>
        <span class="psBlocoMeta">${cargos.length} cargo(s) no edital</span>
      </div>
      <div class="psTableWrap">
        <table class="psTable psTableSub">
          <thead><tr>${cabecalho}</tr></thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>
    </div>`;
}

// ---------- Cronograma do edital (atividades e datas) ----------
// Cruza o processo (unidade/uf/edital) com o CSV consolidado de cronograma
// (cronograma-editais-dados.js).
function cronogramaDoEdital(proc) {
  if (!proc) return [];
  const chave = `${normChave(proc.unidade)}|${normChave(proc.uf)}|${normChave(proc.edital)}`;
  return CRONOGRAMA_EDITAIS_DADOS[chave] || [];
}

// Destaca a etapa atual do processo no cronograma (casa pelo nome da atividade).
function ehEtapaAtual(proc, atividade) {
  const etapa = normChave(proc?.etapa);
  if (!etapa) return false;
  const alvo = normChave(atividade);
  return alvo === etapa || alvo.includes(etapa) || etapa.includes(alvo);
}

function renderCronograma(proc) {
  const etapas = cronogramaDoEdital(proc);
  if (!etapas.length) {
    return `
      <div class="psBloco psBlocoFull">
        <h4 class="psBlocoTitulo">Cronograma do Edital</h4>
        <p class="psObservacoes"><span class="psSemObs">Cronograma não disponível para este edital.</span></p>
      </div>`;
  }

  const linhas = etapas.map(e => {
    const atual = ehEtapaAtual(proc, e.atividade);
    return `<tr class="${atual ? "is-etapa-atual" : ""}">
        <td class="psTd-center">${escapeHtml(String(e.ordem))}</td>
        <td class="psCelNome">${escapeHtml(e.atividade || "—")}${atual ? ` <span class="psBadge is-breve">Etapa atual</span>` : ""}</td>
        <td>${escapeHtml(e.data || "—")}</td>
      </tr>`;
  }).join("");

  return `
    <div class="psBloco psBlocoFull">
      <div class="psBlocoHead">
        <h4 class="psBlocoTitulo">Cronograma do Edital</h4>
        <span class="psBlocoMeta">${etapas.length} etapa(s)</span>
      </div>
      <div class="psTableWrap">
        <table class="psTable psTableSub">
          <thead>
            <tr>
              <th class="psTd-center">#</th>
              <th>Atividade</th>
              <th>Data</th>
            </tr>
          </thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>
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
    ? `<a class="psDocLink" href="${escapeAttr(proc.linkEdital)}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-file-pdf"></i> Abrir edital</a>`
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
        <button type="button" class="psBtn psBtnGhost" data-ps-detalhe="${escapeAttr(proc.id)}">
          Recolher detalhes <i class="fa-solid fa-chevron-up"></i>
        </button>
      </div>
    </div>

    <div class="psResumoTiles">
      <div class="psTile"><div class="psTileValue">${numFmt(proc.vagasPrevistas)}</div><div class="psTileLabel">Vagas Previstas</div></div>
      <div class="psTile"><div class="psTileValue is-green">${numFmt(proc.contratados)}</div><div class="psTileLabel">Contratados</div></div>
      <div class="psTile"><div class="psTileValue is-red">${numFmt(proc.vagasOciosas)}</div><div class="psTileLabel">Vagas Ociosas</div></div>
      <div class="psTile"><div class="psTileValue is-blue">${numFmt(proc.inscritos)}</div><div class="psTileLabel">Inscritos</div></div>
    </div>

    <div class="psDetalheGrid">
      <div class="psBloco">
        <h4 class="psBlocoTitulo">Dados do Edital</h4>
        <div class="psInfoGrid">
          ${linhaInfo("Processo SEI", escapeHtml(proc.processoSei || "—"))}
          ${linhaInfo("Ciclo", escapeHtml(proc.ciclo || "—"))}
          ${linhaInfo("Etapa atual", escapeHtml(proc.etapa || "—"))}
          ${linhaInfo("Risco", escapeHtml(proc.risco || "—"))}
          ${linhaInfo("Responsável", escapeHtml(proc.responsavel || "—"))}
          ${linhaInfo("Link do edital", link)}
        </div>
      </div>

      <div class="psBloco">
        <h4 class="psBlocoTitulo">Observações</h4>
        <p class="psObservacoes">${observacoes}</p>
      </div>
    </div>

    ${renderCronograma(proc)}

    ${renderQuadroVagas(proc)}`;

  painel.hidden = false;
}

// ---------- Render geral ----------
function renderTudo() {
  renderKpis();
  preencherFiltros();
  renderTabela();
  renderDetalhe();
}

// ---------- Ações ----------
function alternarDetalhe(id) {
  processoExpandido = processoExpandido === id ? null : id;
  renderTabela();
  renderDetalhe();
  if (processoExpandido) {
    setTimeout(() => $("psDetalhe")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 60);
  }
}

// ---------- Inicialização ----------
let processosConfigurado = false;

export function configurarProcessosSeletivos() {
  if (processosConfigurado) return;
  const raiz = $("view-processosSeletivos");
  if (!raiz) return;
  processosConfigurado = true;

  // Ordenação por clique no cabeçalho: tabela de editais e sub-tabela de vagas.
  registrarOrdenacao("ps", () => { paginaAtual = 1; renderTabela(); });
  registrarOrdenacao("psVagas", () => renderDetalhe());

  renderTudo();

  $("psFiltroUnidade")?.addEventListener("change", () => { paginaAtual = 1; renderTabela(); });
  $("psFiltroStatus")?.addEventListener("change", () => { paginaAtual = 1; renderTabela(); });
  $("psBusca")?.addEventListener("input", () => { paginaAtual = 1; renderTabela(); });

  // Delegação para os elementos gerados dinamicamente (tabela + detalhe).
  raiz.addEventListener("click", event => {
    const det = event.target.closest("[data-ps-detalhe]");
    if (det) { alternarDetalhe(det.dataset.psDetalhe); return; }

    const pag = event.target.closest("[data-ps-pagina]");
    if (pag) { paginaAtual = Number(pag.dataset.psPagina) || 1; renderTabela(); return; }
  });
}
