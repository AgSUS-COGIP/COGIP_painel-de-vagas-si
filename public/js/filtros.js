import { cancelarEdicaoObservacaoAlertaPainel, editarObservacaoAlertaPainel, renderAlertasDaPagina, salvarObservacaoAlertaPainel } from "./alertas.js";
import { ajustarEscalaPainelFixo, filtrarRowsBase, garantirCarregamentoPagina, renderTudo } from "./app.js";
import { logoutPainel } from "./auth.js";
import { exportarAlertas, exportarDistribuicaoVagasOciosas, exportarPdf, exportarProcessoSeletivo, exportarVagas } from "./exportacao.js";
import { renderAlertasKpis } from "./kpis.js";
import { abrirPainelExterno, abrirPainelFerias, adicionarLinhaRemanejamento, alterarMesRemanejamento, alternarDetalheRemanejamento, atualizarCampoLinhaRemanejamento, atualizarResumoRemanejamento, atualizarVagasOrigemPorDsei, cancelarEdicaoRemanejamento, carregarPainelExternoSobDemanda, carregarPainelFeriasSobDemanda, editarRemanejamentoPainel, excluirRemanejamentoPainel, limparFormularioRemanejamento, removerLinhaRemanejamento, renderRemanejamentoLista, salvarRemanejamentoPainel } from "./remanejamento.js";
import { charts, filterConfigs, pageLoadState } from "./runtime.js";
import { state } from "./state.js";
import { escapeAttr, escapeHtml, normalizarTextoPainel } from "./utils.js";
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
  main.classList.toggle("view-iframe-active", view === "painelSaudeIndigena" || view === "ferias");
  main.classList.toggle("view-gestao-active", view === "gestaoFerias");
  main.classList.toggle("view-remanejamento-active", view === "remanejamento" || view === "remanejamentoFormulario");

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

export function toggleSidebar(forceState) {
  const app = document.querySelector(".app");
  if (!app) return;

  const shouldCollapse = typeof forceState === "boolean"
    ? forceState
    : !app.classList.contains("sidebar-collapsed");

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
      atualizarModoRolagem(view);
      garantirCarregamentoPagina(view);

      if (view === "painelSaudeIndigena") {
        carregarPainelExternoSobDemanda();
      }

      if (view === "ferias") {
        carregarPainelFeriasSobDemanda();
      }

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
    }
  });

  document.addEventListener("change", event => {
    const el = event.target.closest("[data-change]");
    if (!el) return;
    const d = el.dataset;
    switch (d.change) {
      case "atualizar-vagas-origem": atualizarVagasOrigemPorDsei(); break;
      case "alterar-mes-rem": alterarMesRemanejamento(); break;
      case "atualizar-resumo-rem": atualizarResumoRemanejamento(); break;
      case "render-rem-lista": renderRemanejamentoLista(); break;
      case "campo-linha-rem": atualizarCampoLinhaRemanejamento(d.tipo, d.id, d.campo, event.target.value); break;
    }
  });

  document.addEventListener("input", event => {
    const el = event.target.closest("[data-input]");
    if (!el) return;
    const d = el.dataset;
    switch (d.input) {
      case "pesquisa-vagas": atualizarPesquisaVagas(event.target.value); break;
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
        <button type="button" class="multiSelectTrigger">
          <span class="multiSelectValue"></span>
        </button>
        <div class="multiSelectMenu">
          <input type="search" class="multiSelectSearch" placeholder="Pesquisar neste filtro" aria-label="Pesquisar neste filtro">
          <div class="multiSelectActions">
            <button type="button" data-action="all">Selecionar todos</button>
            <button type="button" data-action="clear">Limpar</button>
          </div>
          <div class="multiSelectOptions"></div>
        </div>
      `;

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
      if (el !== container) el.classList.remove("open");
    });
    container.classList.toggle("open");
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
    searchInput.addEventListener("input", () => filtrarOpcoesMultiSelect(cfg, searchInput.value));
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

export function filtrarTipoContratacao(row, tipos) {
  if (!tipos || !tipos.length) return true;

  return tipos.some(tipo => {
    if (tipo === "NORMAL") return Number(row.contratadosNormal || 0) > 0;
    if (tipo === "SUBSTITUICAO") return Number(row.contratadosSubstituicao || 0) > 0;
    if (tipo === "TEMPORARIO") return Number(row.contratadosTemporario || 0) > 0;
    return true;
  });
}

export function filtrarTipoAlerta(row, alertas) {
  if (!alertas || !alertas.length) return true;

  const afastamentoSemSubstituto = Number(row.qtdAfastamentoSemSubstituto || 0);
  const temporarioAtivo = Number(row.qtdTemporarioAtivo || 0);

  return alertas.some(alerta => {
    if (alerta === "AFASTAMENTO_SEM_SUBSTITUTO") {
      return afastamentoSemSubstituto > 0;
    }
    if (alerta === "TEMPORARIO_ATIVO") {
      return temporarioAtivo > 0;
    }
    if (alerta === "SEM_ALERTA") {
      return afastamentoSemSubstituto === 0 && temporarioAtivo === 0;
    }
    return true;
  });
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
