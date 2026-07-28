import { cancelarEdicaoObservacaoAlertaPainel, editarObservacaoAlertaPainel, renderAlertasDaPagina, salvarObservacaoAlertaPainel } from "./alertas.js";
import { ajustarEscalaPainelFixo, carregarRemanejamentoListaEmSegundoPlano, garantirCarregamentoPagina, renderTudo } from "./app.js";
import { logoutPainel } from "./auth.js";
import { exportarAlertas, exportarDistribuicaoVagasOciosas, exportarPdf, exportarProcessoSeletivo, exportarVagas } from "./exportacao.js";
import { renderAlertasKpis } from "./kpis.js";
import { abrirPainelExterno, abrirPainelFerias, abrirJanelaAjustesRemanejamento, adicionarLinhaRemanejamento, alterarMesesRemanejamento, alternarDetalheRemanejamento, alternarModoAjusteRemanejamento, atualizarCampoLinhaRemanejamento, atualizarResumoRemanejamento, atualizarVagasOrigemPorDsei, cancelarEdicaoRemanejamento, carregarPainelExternoSobDemanda, carregarPainelFeriasSobDemanda, editarAjusteRemanejamentoPainel, editarRemanejamentoPainel, excluirAjusteRemanejamentoPainel, excluirRemanejamentoPainel, fecharJanelaAjustesRemanejamento, liberarBloqueioPSSRemanejamento, limparFormularioRemanejamento, removerLinhaRemanejamento, renderRemanejamentoLista, salvarRemanejamentoPainel } from "./remanejamento.js";
import { renderEntregaCrachaAoMostrar } from "./entrega-cracha.js";
import { renderProcessosSeletivosAoMostrar } from "./processos-seletivos.js";
import { renderMapaDseisAoMostrar } from "./mapa-dseis.js";
import { renderEscalaTrabalhoAoMostrar } from "./escala-trabalho.js";
import { renderGestaoDisciplinarAoMostrar } from "./gestao-disciplinar.js";
import { renderGestaoFeriasAoMostrar } from "./gestao-ferias.js";
import { renderSaudeIndigenaAoMostrar } from "./saude-indigena.js";
import { charts, filterConfigs, pageLoadState } from "./runtime.js";
import { state } from "./state.js";
import { escapeAttr, escapeHtml, normalizarTextoPainel, debounce } from "./utils.js";
import { alterarTabelaVagas, alterarVisualizacaoVagas, atualizarPesquisaVagas, mudarPaginaVagas, ordenarTabelaVagas, renderVagasDaPagina } from "./vagas.js";

export function atualizarModoRolagem(view) {
  const main = document.querySelector(".main");
  if (!main) return;

  const isVisaoGeral = view === "visaoGeral";

  // Modo painel fixo/TV ativo apenas na Visão Geral: o painel inteiro escala
  // para caber em uma tela (base 1918x927). Nas demais abas o body volta ao
  // fluxo normal com rolagem.
  document.body.classList.toggle("modoPainelFixo", isVisaoGeral);

  // A Visão Geral permanece sem rolagem para preservar o layout executivo em tela única.
  // As demais abas podem rolar verticalmente para acomodar tabelas e conteúdos maiores.
  main.classList.toggle("view-scroll", !isVisaoGeral);
  main.classList.toggle("view-alertas-active", view === "alertas");
  main.classList.toggle("view-iframe-active", view === "painelSaudeIndigena" || view === "ferias" || view === "gestaoFerias");
  main.classList.toggle("view-gestao-active", view === "gestaoFerias");
  main.classList.toggle("view-cracha-active", view === "entregaCracha");
  main.classList.toggle("view-gestao-active", view === "gestaoDisciplinar");
  main.classList.toggle("view-processos-active", view === "processosSeletivos");
  main.classList.toggle("view-escala-active", view === "escalaTrabalho");
  main.classList.toggle("view-remanejamento-active", view === "remanejamento" || view === "remanejamentoFormulario");
  main.classList.toggle("view-solicitacoes-active", view === "solicitacoes");

  if (isVisaoGeral) {
    ajustarEscalaPainelFixo();
    // Reescala os gráficos após a troca de layout/escala.
    setTimeout(() => {
      Object.values(charts).forEach(chart => {
        if (chart) chart.resize();
      });
    }, 80);
  }
}

let menuRecolhidoFinalTimer = null;

// --- Suaviza a animação de recolher/expandir o menu nas abas com Tabulator ---
// A transição anima a LARGURA (grid-template-columns do .app). O ResizeObserver do
// Tabulator recalcularia as colunas + re-renderizaria as linhas a CADA frame da
// animação (engasgo, pior em tabelas grandes). Solução: "congelar" o redraw das
// tabelas durante a transição e fazer UM único redraw ao final (transitionend),
// com fallback por tempo e proteção contra toggles rápidos.
let tabelasCongeladas = false;
let descongelarTabelasTimer = null;
let aoTerminarTransicaoMenu = null;

function tabelasTabulatorAtivas() {
  const T = window.Tabulator;
  if (!T || typeof T.findTable !== "function") return [];
  try { return T.findTable(".tabulator") || []; } catch (e) { return []; }
}

function congelarTabelasMenu() {
  if (tabelasCongeladas) return; // idempotente: não empilha blockRedraw
  tabelasTabulatorAtivas().forEach(t => { try { t.blockRedraw(); } catch (e) { /* nada */ } });
  tabelasCongeladas = true;
}

function descongelarTabelasMenu(app) {
  if (descongelarTabelasTimer) { clearTimeout(descongelarTabelasTimer); descongelarTabelasTimer = null; }
  if (aoTerminarTransicaoMenu) { app.removeEventListener("transitionend", aoTerminarTransicaoMenu); aoTerminarTransicaoMenu = null; }
  if (!tabelasCongeladas) return;
  tabelasCongeladas = false;
  // restoreRedraw reativa; redraw(true) recalcula colunas/linhas p/ a nova largura.
  tabelasTabulatorAtivas().forEach(t => { try { t.restoreRedraw(); t.redraw(true); } catch (e) { /* nada */ } });
}

function suavizarTransicaoMenu(app) {
  congelarTabelasMenu();
  // (Re)configura o gatilho de descongelamento — sempre um único listener/timer.
  if (descongelarTabelasTimer) clearTimeout(descongelarTabelasTimer);
  if (aoTerminarTransicaoMenu) app.removeEventListener("transitionend", aoTerminarTransicaoMenu);
  aoTerminarTransicaoMenu = (ev) => {
    if (ev.target === app && ev.propertyName === "grid-template-columns") descongelarTabelasMenu(app);
  };
  app.addEventListener("transitionend", aoTerminarTransicaoMenu);
  // Fallback: sem transitionend (sem mudança real de largura, prefers-reduced-motion…).
  descongelarTabelasTimer = setTimeout(() => descongelarTabelasMenu(app), 450);
}

export function toggleSidebar(forceState) {
  const app = document.querySelector(".app");
  if (!app) return;

  const shouldCollapse = typeof forceState === "boolean"
    ? forceState
    : !app.classList.contains("sidebar-collapsed");

  // Congela as tabelas ANTES de mudar a largura (a mudança de classe abaixo inicia
  // a transição de grid-template-columns).
  suavizarTransicaoMenu(app);

  if (menuRecolhidoFinalTimer) {
    clearTimeout(menuRecolhidoFinalTimer);
    menuRecolhidoFinalTimer = null;
  }

  if (shouldCollapse) {
    app.classList.add("sidebar-collapsed");
    // Depois que a animação de recolhimento termina (~280ms), os rótulos viram
    // display:none para não deixarem nenhum espaço residual.
    menuRecolhidoFinalTimer = setTimeout(() => {
      app.classList.add("menu-recolhido-final");
      menuRecolhidoFinalTimer = null;
    }, 320);
  } else {
    const estavaFinal = app.classList.contains("menu-recolhido-final");
    app.classList.remove("menu-recolhido-final");
    if (estavaFinal) {
      // Os rótulos estavam em display:none. Removemos o "collapsed" só no frame
      // seguinte para que eles renderizem um instante com opacity 0 e então
      // façam o fade-in suave (em vez de "pipocarem" já visíveis).
      requestAnimationFrame(() => {
        requestAnimationFrame(() => app.classList.remove("sidebar-collapsed"));
      });
    } else {
      app.classList.remove("sidebar-collapsed");
    }
  }

  const toggle = document.querySelector(".sidebarToggle");
  if (toggle) {
    toggle.title = shouldCollapse ? "Expandir menu" : "Recolher menu";
    toggle.setAttribute("aria-label", shouldCollapse ? "Expandir menu" : "Recolher menu");
  }

  try {
    localStorage.setItem("menuSaudeIndigenaRecolhido", shouldCollapse ? "SIM" : "NAO");
  } catch (e) {
    // Sem impacto para o painel caso o navegador bloqueie localStorage.
  }

  setTimeout(() => {
    Object.values(charts).forEach(chart => {
      if (chart) chart.resize();
    });
  }, 180);
}

export function restaurarEstadoMenuLateral() {
  try {
    const salvo = localStorage.getItem("menuSaudeIndigenaRecolhido");
    if (salvo === "SIM") {
      // Na carga inicial, aplica o estado recolhido já no final (sem animação)
      // para não exibir o menu "fechando" toda vez que a página abre.
      const app = document.querySelector(".app");
      if (app) app.classList.add("sidebar-collapsed", "menu-recolhido-final");
      toggleSidebar(true);
    }
  } catch (e) {
    // Mantém o menu aberto quando não houver permissão de armazenamento local.
  }
}

// Registro declarativo do "on-show" de cada view: o que roda ao ABRIR a aba.
// FONTE ÚNICA desse comportamento — antes espalhado num if-chain aqui + listeners
// de navegação próprios em alguns módulos (Gestão Disciplinar/Férias). Adicionar
// uma view nova passa a ser UMA entrada aqui. As entradas que dependem da base de
// monitoramento chamam garantirCarregamentoPagina (carga sob demanda) antes de
// renderizar. Views sem entrada (visaoGeral, solicitacoes) não têm ação de abertura
// própria aqui (visaoGeral vem do resumo; Perfis tem um redraw próprio em permissoes.js).
const REGISTRO_VIEWS = {
  vagas: () => { garantirCarregamentoPagina("vagas"); renderVagasDaPagina(); },
  alertas: () => { garantirCarregamentoPagina("alertas"); renderAlertasDaPagina(); },
  remanejamento: () => {
    garantirCarregamentoPagina("remanejamento");
    carregarRemanejamentoListaEmSegundoPlano(true);
    renderRemanejamentoLista();
  },
  processosSeletivos: () => renderProcessosSeletivosAoMostrar(),
  mapaDseis: () => renderMapaDseisAoMostrar(),
  escalaTrabalho: () => renderEscalaTrabalhoAoMostrar(),
  entregaCracha: () => renderEntregaCrachaAoMostrar(),
  painelSaudeIndigena: () => renderSaudeIndigenaAoMostrar(),
  ferias: () => carregarPainelFeriasSobDemanda(),
  gestaoDisciplinar: () => renderGestaoDisciplinarAoMostrar(),
  gestaoFerias: () => renderGestaoFeriasAoMostrar(),
};

export function configurarNavegacao() {
  document.querySelectorAll(".navItem").forEach(item => {
    // Tooltip com o nome completo: útil quando o texto é truncado (reticências)
    // e quando o menu está recolhido (só ícone).
    const label = item.querySelector("span:not(.navIcon)");
    const texto = label ? label.textContent.trim() : "";
    if (texto && !item.title) item.title = texto;

    item.addEventListener("click", () => {
      const view = item.dataset.view;
      if (!view) return;

      state.activeView = view;

      document.querySelectorAll(".navItem").forEach(i => i.classList.remove("active"));
      item.classList.add("active");

      document.querySelectorAll(".viewPanel").forEach(panel => panel.classList.remove("active"));
      const panel = document.getElementById(`view-${view}`);
      if (panel) panel.classList.add("active");

      // Acessibilidade: reflete a tela atual no título-raiz (h1) e move o foco
      // para o conteúdo, para que leitores de tela anunciem a nova view e o
      // usuário de teclado não precise re-tabular toda a navegação.
      if (texto) {
        const titulo = document.getElementById("tituloPagina");
        if (titulo) titulo.textContent = texto;
      }
      const conteudo = document.getElementById("conteudo");
      if (conteudo) conteudo.focus({ preventScroll: false });

      atualizarModoRolagem(view);

      // Dispara o "on-show" da aba pelo registro central: garante a carga sob
      // demanda e re-renderiza as grades Tabulator montadas com a aba oculta.
      REGISTRO_VIEWS[view]?.();

      setTimeout(() => {
        Object.values(charts).forEach(chart => {
          if (chart) chart.resize();
        });
      }, 80);
    });
  });
}

export function configurarMultiSelectEstaticos() {
  // Filtros de Tipo de Contratação e Tipo de Alerta removidos da Visão Geral.
}

export function configurarFechamentoDeMenus() {
  document.addEventListener("click", event => {
    document.querySelectorAll(".multiSelect.open").forEach(el => {
      if (!el.contains(event.target)) {
        el.classList.remove("open");
        el.querySelector(".multiSelectTrigger")?.setAttribute("aria-expanded", "false");
      }
    });
  });
}

export function configurarDelegacaoEventos() {
  document.addEventListener("click", event => {
    const el = event.target.closest("[data-click]");
    if (!el) return;
    const d = el.dataset;
    switch (d.click) {
      case "toggle-sidebar": toggleSidebar(); break;
      case "logout": logoutPainel(); break;
      case "limpar-filtros": limparFiltros(); break;
      case "alterar-tabela-vagas": alterarTabelaVagas(d.vagasTabela); break;
      case "alterar-visualizacao-vagas": alterarVisualizacaoVagas(d.vagasView); break;
      case "exportar-vagas": exportarVagas(); break;
      case "exportar-pdf": exportarPdf(); break;
      case "exportar-alertas": exportarAlertas(); break;
      case "exportar-distribuicao": exportarDistribuicaoVagasOciosas(); break;
      case "exportar-processo": exportarProcessoSeletivo(); break;
      case "abrir-painel-externo": abrirPainelExterno(); break;
      case "abrir-painel-ferias": abrirPainelFerias(); break;
      case "adicionar-linha-rem": adicionarLinhaRemanejamento(d.tipo); break;
      case "limpar-form-rem": limparFormularioRemanejamento(); break;
      case "salvar-rem": salvarRemanejamentoPainel(); break;
      case "filtro-grafico": alternarFiltroGrafico(d.filterType, d.filterValue); break;
      case "ordenar-vagas": ordenarTabelaVagas(d.key); break;
      case "mudar-pagina-vagas": mudarPaginaVagas(Number(d.delta || 0)); break;
      case "editar-obs": editarObservacaoAlertaPainel(d.chave); break;
      case "salvar-obs": salvarObservacaoAlertaPainel(d.chave); break;
      case "cancelar-obs": cancelarEdicaoObservacaoAlertaPainel(); break;
      case "detalhe-rem": alternarDetalheRemanejamento(d.id); break;
      case "editar-rem": editarRemanejamentoPainel(d.id); break;
      case "cancelar-edicao-rem": cancelarEdicaoRemanejamento(); break;
      case "excluir-rem": excluirRemanejamentoPainel(d.id); break;
      case "remover-linha-rem": removerLinhaRemanejamento(d.tipo, d.id); break;
      case "liberar-pss-rem": liberarBloqueioPSSRemanejamento(); break;
      case "toggle-ajuste-rem": alternarModoAjusteRemanejamento(); break;
      case "abrir-ajustes-rem": abrirJanelaAjustesRemanejamento(); break;
      case "fechar-ajustes-rem": fecharJanelaAjustesRemanejamento(); break;
      case "editar-ajuste-rem": editarAjusteRemanejamentoPainel(d.id); break;
      case "excluir-ajuste-rem": excluirAjusteRemanejamentoPainel(d.id); break;
    }
  });

  document.addEventListener("change", event => {
    const el = event.target.closest("[data-change]");
    if (!el) return;
    const d = el.dataset;
    switch (d.change) {
      case "atualizar-vagas-origem": atualizarVagasOrigemPorDsei(); break;
      // Mês (remanejamento normal) e Nº de meses (ajuste pontual) caem no mesmo
      // recálculo — a regra por lado é decidida em mesesRemanejamentoPorTipo.
      case "alterar-mes-rem":
      case "alterar-meses-rem": alterarMesesRemanejamento(); break;
      case "atualizar-resumo-rem": atualizarResumoRemanejamento(); break;
      case "render-rem-lista": renderRemanejamentoLista(); break;
      case "campo-linha-rem": atualizarCampoLinhaRemanejamento(d.tipo, d.id, d.campo, event.target.value); break;
    }
  });

  // Busca de vagas debounced (~250ms): evita refiltrar a base a cada tecla.
  const pesquisarVagasDebounced = debounce(valor => atualizarPesquisaVagas(valor), 250);

  document.addEventListener("input", event => {
    const el = event.target.closest("[data-input]");
    if (!el) return;
    const d = el.dataset;
    switch (d.input) {
      case "pesquisa-vagas": pesquisarVagasDebounced(event.target.value); break;
      case "alterar-meses-rem": alterarMesesRemanejamento(); break;
      case "atualizar-resumo-rem": atualizarResumoRemanejamento(); break;
      case "render-rem-lista": renderRemanejamentoLista(); break;
      case "campo-linha-rem": atualizarCampoLinhaRemanejamento(d.tipo, d.id, d.campo, event.target.value); break;
    }
  });
}

export function criarMultiSelect(id, options, placeholder) {
  const container = document.getElementById(id);
  if (!container) return;

  const selectedSet = filterConfigs[id]?.selected || new Set();
  const safeOptions = Array.isArray(options) ? options : [];

  container.className = "multiSelect";
  container.innerHTML = `
        <button type="button" class="multiSelectTrigger" aria-haspopup="listbox" aria-expanded="false">
          <span class="multiSelectValue" id="${id}-value"></span>
        </button>
        <div class="multiSelectMenu" role="group">
          <input type="search" class="multiSelectSearch" placeholder="Pesquisar neste filtro" aria-label="Pesquisar neste filtro">
          <div class="multiSelectActions">
            <button type="button" data-action="all">Selecionar todos</button>
            <button type="button" data-action="clear">Limpar</button>
          </div>
          <div class="multiSelectOptions"></div>
        </div>
      `;

  // Nome acessível do widget: associa o <label> do grupo de filtro (irmão do
  // container, sem `for` pois aponta para um <div>, não um controle) ao trigger
  // e ao menu, via id estável. Sem isso o leitor de tela anuncia o botão sem rótulo.
  const grupoLabel = container.parentElement?.querySelector("label");
  if (grupoLabel) {
    if (!grupoLabel.id) grupoLabel.id = `${id}-label`;
    const trigger = container.querySelector(".multiSelectTrigger");
    if (trigger) trigger.setAttribute("aria-labelledby", `${grupoLabel.id} ${id}-value`);
    const menu = container.querySelector(".multiSelectMenu");
    if (menu) menu.setAttribute("aria-label", grupoLabel.textContent.trim());
  }

  const cfg = filterConfigs[id] = {
    id,
    placeholder: placeholder || "Todos",
    options: safeOptions,
    selected: new Set(selectedSet)
  };

  const optionsWrap = container.querySelector(".multiSelectOptions");
  optionsWrap.innerHTML = safeOptions.map(opt => `
        <label class="multiSelectOption">
          <input type="checkbox" value="${escapeAttr(opt.value)}">
          <span>${escapeHtml(opt.label)}</span>
        </label>
      `).join("");

  if (cfg.selected.size) {
    optionsWrap.querySelectorAll("input").forEach(input => {
      input.checked = cfg.selected.has(input.value);
    });
  }

  container.querySelector(".multiSelectTrigger").addEventListener("click", event => {
    event.stopPropagation();
    document.querySelectorAll(".multiSelect.open").forEach(el => {
      if (el !== container) {
        el.classList.remove("open");
        el.querySelector(".multiSelectTrigger")?.setAttribute("aria-expanded", "false");
      }
    });
    const aberto = container.classList.toggle("open");
    container.querySelector(".multiSelectTrigger")?.setAttribute("aria-expanded", String(aberto));
  });

  container.querySelector('[data-action="all"]').addEventListener("click", event => {
    event.stopPropagation();
    cfg.selected = new Set(cfg.options.map(opt => String(opt.value)));
    sincronizarCheckboxes(cfg);
    atualizarResumoMultiSelect(cfg);
    aplicarFiltros();
  });

  container.querySelector('[data-action="clear"]').addEventListener("click", event => {
    event.stopPropagation();
    cfg.selected = new Set();
    sincronizarCheckboxes(cfg);
    atualizarResumoMultiSelect(cfg);
    aplicarFiltros();
  });

  optionsWrap.querySelectorAll("input").forEach(input => {
    input.addEventListener("change", () => {
      if (input.checked) {
        cfg.selected.add(input.value);
      } else {
        cfg.selected.delete(input.value);
      }
      atualizarResumoMultiSelect(cfg);
      aplicarFiltros();
    });
  });

  const searchInput = container.querySelector(".multiSelectSearch");
  if (searchInput) {
    searchInput.addEventListener("click", event => event.stopPropagation());
    const filtrarOpcoesDebounced = debounce(() => filtrarOpcoesMultiSelect(cfg, searchInput.value), 150);
    searchInput.addEventListener("input", filtrarOpcoesDebounced);
  }

  atualizarResumoMultiSelect(cfg);
}

export function filtrarOpcoesMultiSelect(cfg, termo) {
  const container = document.getElementById(cfg.id);
  if (!container) return;

  const busca = normalizarTextoPainel(termo || "");
  container.querySelectorAll(".multiSelectOption").forEach(option => {
    const texto = normalizarTextoPainel(option.innerText || "");
    option.style.display = !busca || texto.includes(busca) ? "grid" : "none";
  });
}

export function sincronizarCheckboxes(cfg) {
  const container = document.getElementById(cfg.id);
  if (!container) return;

  container.querySelectorAll(".multiSelectOptions input").forEach(input => {
    input.checked = cfg.selected.has(input.value);
  });
}

export function atualizarResumoMultiSelect(cfg) {
  const container = document.getElementById(cfg.id);
  if (!container) return;

  const labelEl = container.querySelector(".multiSelectValue");
  if (!labelEl) return;

  const selected = cfg.options.filter(opt => cfg.selected.has(String(opt.value)));

  if (!selected.length || selected.length === cfg.options.length) {
    labelEl.textContent = cfg.placeholder;
    return;
  }

  if (selected.length === 1) {
    labelEl.textContent = selected[0].label;
    return;
  }

  labelEl.textContent = `${selected.length} selecionados`;
}

export function getSelectedValues(id) {
  const cfg = filterConfigs[id];
  if (!cfg) return [];
  return Array.from(cfg.selected || []);
}

export function limparFiltros() {
  state.activeChartFilter = null;

  Object.values(filterConfigs).forEach(cfg => {
    cfg.selected = new Set();
    sincronizarCheckboxes(cfg);
    atualizarResumoMultiSelect(cfg);
  });

  aplicarFiltros();
}

export function aplicarFiltros() {
  if (state.allRows && state.allRows.length) {
    state.filteredRows = filtrarRowsBase(state.allRows);

    state.vagasCurrentPage = 1;
    state.alertasCurrentPage = 1;
    renderTudo();
    return;
  }

  // Enquanto a base completa não foi carregada, mantém a Visão Geral resumida
  // e aplica filtros apenas nas páginas que já possuem base própria carregada.
  state.vagasCurrentPage = 1;
  state.alertasCurrentPage = 1;

  if (pageLoadState.alertas) {
    renderAlertasKpis(filtrarRowsBase(state.alertasBaseRows));
    renderAlertasDaPagina();
  }

  if (pageLoadState.vagas) {
    renderVagasDaPagina();
  }
}

export function matchMulti(value, selectedValues) {
  if (!selectedValues || !selectedValues.length) return true;
  return selectedValues.includes(String(value || ""));
}

export function filtrarGraficoAtivo(row) {
  if (!state.activeChartFilter) return true;

  if (state.activeChartFilter.type === "cargo") {
    return String(row.cargo || "") === String(state.activeChartFilter.value || "");
  }

  if (state.activeChartFilter.type === "tipo") {
    if (state.activeChartFilter.value === "NORMAL") return Number(row.contratadosNormal || 0) > 0;
    if (state.activeChartFilter.value === "SUBSTITUICAO") return Number(row.contratadosSubstituicao || 0) > 0;
    if (state.activeChartFilter.value === "TEMPORARIO") return Number(row.contratadosTemporario || 0) > 0;
  }

  return true;
}

// Aplica os filtros superiores (DSEI/Cargo) + o filtro de gráfico ativo a um
// conjunto de linhas. Vive aqui por ser lógica de filtro pura.
export function filtrarRowsBase(rows) {
  const dseis = getSelectedValues("fDsei");
  const cargos = getSelectedValues("fCargo");

  return (rows || []).filter(row => {
    if (!matchMulti(row.dseiCasai, dseis)) return false;
    if (!matchMulti(row.cargo, cargos)) return false;
    if (!filtrarGraficoAtivo(row)) return false;
    return true;
  });
}

export function alternarFiltroGrafico(type, value) {
  if (state.activeChartFilter && state.activeChartFilter.type === type && state.activeChartFilter.value === value) {
    state.activeChartFilter = null;
  } else {
    state.activeChartFilter = { type, value };
  }

  aplicarFiltros();
}

export function haFiltrosAtivos() {
  return Object.values(filterConfigs).some(cfg => cfg && cfg.selected && cfg.selected.size > 0);
}

export function deveUsarIndicadoresResumoBase() {
  return !state.activeChartFilter && !haFiltrosAtivos();
}
