import { renderAlertasDaPagina, renderAlertasErro } from "./alertas.js";
import { apiGet, apiPost, carregarConfiguracaoApp_ } from "./api.js";
import { configurarLogin, verificarSessaoInicial } from "./auth.js";
import { configurarAcesso } from "./acesso.js";
import { configurarPerfisAcesso, podeVerModulo } from "./permissoes.js";
import { aplicarAcessibilidade } from "./a11y.js";
import { renderBar, renderCardsOciosas, renderDoughnut, renderFunnelDsei, renderLegend, renderProgressBarResumo } from "./charts.js";
import { COLORS } from "./constants.js";
import { aplicarFiltros, atualizarModoRolagem, configurarDelegacaoEventos, configurarFechamentoDeMenus, configurarMultiSelectEstaticos, configurarNavegacao, criarMultiSelect, filtrarRowsBase, restaurarEstadoMenuLateral } from "./filtros.js";
import { preencherKpiBloco, renderAlertasKpis, renderGraficos, renderKpis, renderResumosExecutivos } from "./kpis.js";
import { configurarPainelExterno, configurarPainelFerias, configurarRemanejamento, renderRemanejamentoLista, renderRemanejamentoListaErro } from "./remanejamento.js";
import { configurarGestaoFerias } from "./gestao-ferias.js";
import { configurarEntregaCracha } from "./entrega-cracha.js";
import { configurarSaudeIndigena, prefetchSaudeIndigena } from "./saude-indigena.js";
import { configurarGestaoDisciplinar } from "./gestao-disciplinar.js";
import { configurarProcessosSeletivos } from "./processos-seletivos.js";
import { configurarMapaDseis } from "./mapa-dseis.js";
import { configurarEscalaTrabalho } from "./escala-trabalho.js";
import { configurarAssistente } from "./assistente.js";
import { configurarOrdenacaoTabelas } from "./ordenacao-tabelas.js";
import { ativarSelectsPesquisaveisGlobal } from "./searchable-select.js";
import { ativarDatePickersGlobal } from "./date-picker.js";
import { ativarFileInputsGlobal } from "./file-input.js";
import { charts, pageLoadState, pageLoadingState } from "./runtime.js";
import { state } from "./state.js";
import { formatNumber, formatPercent, part, setText } from "./utils.js";
import { renderVagasDaPagina, renderVagasErro } from "./vagas.js";

export async function init() {
  // Config em PARALELO com a configuração síncrona abaixo (antes era o 1º await,
  // serializando tudo). carregarConfiguracaoApp_ nunca rejeita (segue com defaults),
  // então uma falha em /api/config não derruba mais o app. É aguardada logo antes
  // da sessão, só para o googleClientId estar pronto quando a tela de login montar.
  const configPromise = carregarConfiguracaoApp_();

  if (typeof ChartDataLabels !== "undefined") {
    Chart.register(ChartDataLabels);
  }

  aplicarAcessibilidade();
  restaurarEstadoMenuLateral();
  configurarNavegacao();
  atualizarModoRolagem(state.activeView || "visaoGeral");
  configurarMultiSelectEstaticos();
  configurarFechamentoDeMenus();
  configurarDelegacaoEventos();
  configurarPainelExterno();
  configurarPainelFerias();
  configurarRemanejamento();
  configurarGestaoFerias();
  configurarEntregaCracha();
  configurarSaudeIndigena();
  configurarGestaoDisciplinar();
  configurarProcessosSeletivos();
  configurarMapaDseis();
  configurarEscalaTrabalho();
  configurarAssistente();
  configurarOrdenacaoTabelas();
  configurarResponsividadePainel();
  configurarLogin();
  configurarAcesso();
  configurarPerfisAcesso();
  // Padroniza TODOS os <select> nativos do app como dropdown pesquisável (e
  // observa o DOM para cobrir selects criados dinamicamente). Os filtros
  // multi-seleção de SI/Férias são <div> (não <select>), então não são afetados.
  ativarSelectsPesquisaveisGlobal();
  // TODOS os date pickers do app (filtros, formulários, ações em lote, modais)
  // usam o calendário customizado, inclusive os criados dinamicamente.
  ativarDatePickersGlobal();
  // Inputs de arquivo marcados com [data-file-input] viram o componente padrão
  // (botão + chips/estados), inclusive os criados dinamicamente.
  ativarFileInputsGlobal();

  // Espera a config (já em voo desde o topo) antes de decidir login/painel — o
  // botão "Entrar com Google" depende de state.googleClientId. Não é mais o 1º
  // await do boot e nunca rejeita, então não bloqueia a preparação nem quebra o app.
  await configPromise;
  await verificarSessaoInicial();
}

// Escala do painel fixo/TV: mantém a composição da base 1918x927 e
// apenas ajusta o zoom para caber na janela (igual ao modelo do Apps Script).
export function ajustarEscalaPainelFixo() {
  const larguraBase = 1918;
  const alturaBase = 927;
  // Escala X e Y de forma independente para o painel preencher toda a janela
  // (sem bordas vazias nas laterais), mesmo quando a proporção difere da base.
  const escalaX = window.innerWidth / larguraBase;
  const escalaY = window.innerHeight / alturaBase;

  const root = document.documentElement.style;
  root.setProperty("--painel-scale-x", escalaX.toFixed(6));
  root.setProperty("--painel-scale-y", escalaY.toFixed(6));
  root.setProperty("--painel-scale", Math.min(escalaX, escalaY).toFixed(6));
}

export function configurarResponsividadePainel() {
  let resizeTimer = null;

  ajustarEscalaPainelFixo();
  window.addEventListener("load", ajustarEscalaPainelFixo);

  window.addEventListener("resize", () => {
    ajustarEscalaPainelFixo();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      Object.values(charts).forEach(chart => {
        if (chart) chart.resize();
      });
    }, 160);
  });
}

// Cria os multiselects do topo (DSEI, cargo, tipo de alerta) uma única vez, a
// partir do primeiro payload que trouxer os filtros (resumo OU vagas). Assim, um
// usuário sem acesso à Visão Geral (que não busca o resumo) ainda recebe os
// filtros ao carregar a aba de Vagas.
function garantirFiltrosMultiSelect(filtros) {
  if (state.filtrosCriados) return;
  filtros = filtros || { dseis: [], cargos: [] };
  criarMultiSelect("fDsei", (filtros.dseis || []).map(v => ({ value: v, label: v })), "Todos os DSEIs/CASAIs");
  criarMultiSelect("fCargo", (filtros.cargos || []).map(v => ({ value: v, label: v })), "Todos os cargos");
  criarMultiSelect("fTipoAlerta", [
    { value: "AFASTAMENTO_SEM_SUBSTITUTO", label: "Afastamento sem substituto" },
    { value: "SUBSTITUICAO_SEGURANDO_VAGA", label: "Substituição sem afastado" },
    { value: "TEMPORARIO_ATIVO", label: "Temporário ativo" },
    { value: "VAGA_EXCEDENTE", label: "Vaga excedente" },
    { value: "RT_EXCEDENTE", label: "RT excedente" }
  ], "Todos os alertas");
  state.filtrosCriados = true;
}

// Agenda um trabalho em segundo plano para quando o browser estiver ocioso, sem
// competir com o 1º paint. Cai em setTimeout onde requestIdleCallback não existe.
function agendarEmIdle(fn) {
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(fn, { timeout: 2000 });
  } else {
    setTimeout(fn, 1);
  }
}

export function carregarDadosInicial() {
  const loading = document.getElementById("loading");
  if (loading) loading.style.display = "grid";

  marcarDetalhesCarregandoInicial();

  // Prefetch das demais páginas EM PARALELO com o resumo (antes ficava encadeado
  // no .then do resumo, criando a cascata sessão -> resumo -> prefetch). Agendado
  // em idle para não competir com o 1º paint; o guard interno (backgroundLoadStarted)
  // evita disparo duplo. Vale para todos, tenham ou não acesso à Visão Geral.
  agendarEmIdle(iniciarCarregamentoPaginasEmSegundoPlano);

  // A Visão Geral é gateada como qualquer módulo: só busca o resumo quem tem
  // acesso. Sem acesso, a aba já está oculta e a navegação redireciona para a
  // primeira aba permitida; os filtros do topo são populados pela aba que carregar.
  if (!podeVerModulo("visaoGeral")) {
    if (loading) loading.style.display = "none";
    return;
  }

  apiGet("/api/dashboard/resumo")
    .then(onResumoDataLoaded)
    .catch(onError);
}

export function marcarDetalhesCarregandoInicial() {
  const vagasBody = document.getElementById("vagasBody");
  if (vagasBody) vagasBody.innerHTML = '<tr><td colspan="9">Aguardando carregamento sob demanda...</td></tr>';

  const alertasBody = document.getElementById("alertasBody");
  if (alertasBody) alertasBody.innerHTML = '<tr><td colspan="5">Aguardando carregamento em segundo plano...</td></tr>';

  const remanejamentoBody = document.getElementById("remanejamentoBody");
  if (remanejamentoBody) remanejamentoBody.innerHTML = '<tr><td class="remanejamentoEmpty" colspan="10">Aguardando carregamento em segundo plano...</td></tr>';
}

export function onResumoDataLoaded(payload) {
  payload = payload || {};
  state.indicadoresResumoBase = payload.indicadores || null;

  document.getElementById("updatedAt").innerText = payload.atualizadoEm || "-";

  garantirFiltrosMultiSelect(payload.filtros);

  renderResumoInicial(payload);

  const loading = document.getElementById("loading");
  if (loading) loading.style.display = "none";

  // O prefetch das demais páginas já foi agendado em paralelo por
  // carregarDadosInicial() — não é mais encadeado aqui (fim da cascata).
}

export function renderResumoInicial(payload) {
  payload = payload || {};
  const indicadores = payload.indicadores || {};

  renderResumoKpis(indicadores);
  renderResumoFunnel(payload);
  renderResumoProgresso(indicadores);
  renderResumoIndigenas(indicadores);
  renderResumoTipo(indicadores);
  renderResumoOciosas(payload);
  renderResumoCobertura(indicadores);
  renderResumoAlertasKpi(indicadores);
}

function renderResumoKpis(indicadores) {
  preencherKpiBloco("kpi", {
    vagasPrevistas: Number(indicadores.vagasPrevistas || 0),
    contratados: Number(indicadores.contratados || 0),
    afastados: Number(indicadores.afastados || 0),
    substituicoes: Number(indicadores.substituicoes || 0),
    temporarios: Number(indicadores.temporarios || 0),
    vagasOciosas: Number(indicadores.vagasOciosas || 0),
    vagasPreenchidas: Number(indicadores.vagasPreenchidas || 0),
    vagasPreenchidasPerc: Number(indicadores.vagasPreenchidasPerc || 0),
    coberturaAfastamentos: Number(indicadores.coberturaAfastamentos || 0)
  });
}

function renderResumoFunnel(payload) {
  const topCategorias = payload.topDseiVagas || payload.topCategorias || payload.topCargos || [];
  renderFunnelDsei("funnelTopDsei", topCategorias.map(i => ({
    label: i.label,
    value: Number(i.value || 0)
  })), "dsei");
}

function renderResumoProgresso(indicadores) {
  const preenchidas = Math.max(0, Number(indicadores.vagasPreenchidas || 0));
  const ociosas = Math.max(0, Number(indicadores.vagasOciosas || 0));
  const vagasPrevistas = Number(indicadores.vagasPrevistas || 0);
  const preenchidasPerc = Number(indicadores.vagasPreenchidasPerc || 0);

  renderProgressBarResumo({
    preenchidas,
    ociosas,
    vagasPrevistas,
    percentual: preenchidasPerc
  });
}

function renderResumoIndigenas(indicadores) {
  const indigenas = Number(indicadores.indigenas || 0);
  const totalTrabalhadores = Number(indicadores.contratados || 0);
  const demaisTrabalhadores = Math.max(0, totalTrabalhadores - indigenas);
  const percentualIndigenas = Number(indicadores.percentualIndigenas || 0);
  renderDoughnut("chartIndigenasGeral", {
    labels: ["Indígenas", "Demais"],
    values: [indigenas, demaisTrabalhadores],
    colors: [COLORS.green, COLORS.blue2],
    center: formatPercent(percentualIndigenas),
    centerSub: "INDÍGENAS",
    datalabelMin: 1,
    datalabelFontSize: 15,
    datalabelOffset: 12,
    cutout: "68%",
    radius: "90%",
    layoutPadding: { left: 18, right: 18, top: 18, bottom: 18 },
    centerFontSize: 19,
    centerSubFontSize: 12
  });
  renderLegend("legendIndigenasGeral", [
    ["Indígenas", indigenas, COLORS.green, part(indigenas, totalTrabalhadores)],
    ["Demais", demaisTrabalhadores, COLORS.blue2, part(demaisTrabalhadores, totalTrabalhadores)]
  ]);
}

function renderResumoTipo(indicadores) {
  const normal = Number(indicadores.contratadosNormal || 0);
  const substituicao = Number(indicadores.substituicoes || 0);
  const temporario = Number(indicadores.temporarios || 0);
  const totalContratacao = normal + substituicao + temporario;

  renderDoughnut("chartTipo", {
    labels: ["Normal (Transição/PSS)", "Substituição", "Temporário"],
    values: [normal, substituicao, temporario],
    colors: [COLORS.blue, COLORS.orange, COLORS.green],
    center: formatNumber(totalContratacao),
    centerSub: "TOTAL",
    filterType: "tipo",
    filterValues: ["NORMAL", "SUBSTITUICAO", "TEMPORARIO"],
    datalabelMin: 0.4,
    datalabelFontSize: 15,
    datalabelOffset: function (context) {
      const index = context.dataIndex;
      if (index === 0) return 26;
      if (index === 1) return 16;
      return 14;
    },
    datalabelAlign: function (context) {
      const index = context.dataIndex;
      if (index === 0) return "left";
      if (index === 1) return "top";
      return "right";
    },
    datalabelAnchor: "end",
    cutout: "70%",
    radius: "84%",
    layoutPadding: { left: 78, right: 34, top: 28, bottom: 14 },
    centerFontSize: 20,
    centerSubFontSize: 12
  });
  renderLegend("legendTipo", [
    ["Normal (Transição/PSS)", normal, COLORS.blue, part(normal, totalContratacao)],
    ["Substituição", substituicao, COLORS.orange, part(substituicao, totalContratacao)],
    ["Temporário", temporario, COLORS.green, part(temporario, totalContratacao)]
  ]);
}

function renderResumoOciosas(payload) {
  const topDseiOciosas = payload.topDseiOciosas || [];
  renderCardsOciosas("cardsTopDseiOciosas", topDseiOciosas.map(i => ({
    label: i.label,
    value: Number(i.value || 0)
  })), "dsei");

  const topCargoOciosas = payload.topCargoOciosas || [];
  renderBar("chartTopCargoOciosas", {
    labels: topCargoOciosas.map(i => i.label),
    values: topCargoOciosas.map(i => Number(i.value || 0)),
    color: COLORS.purple,
    labelFontSize: 9.6,
    dataLabelFontSize: 10,
    xTickFontSize: 9.5,
    rightPadding: 44,
    wrapLabels: true,
    maxCharsPerLine: 24,
    maxLines: 5,
    yAxisWidth: 290
  });
}

function renderResumoCobertura(indicadores) {
  // `substituicao` é recalculado aqui (era compartilhado com o gráfico de tipo).
  const substituicao = Number(indicadores.substituicoes || 0);
  const cobertos = Math.min(Math.max(0, substituicao), Math.max(0, Number(indicadores.afastados || 0)));
  const naoCobertos = Math.max(0, Number(indicadores.afastados || 0) - cobertos);
  renderDoughnut("chartCoberturaAfastamentos", {
    labels: ["Cobertos", "Sem cobertura"],
    values: [cobertos, naoCobertos],
    colors: [COLORS.blue, COLORS.orange],
    center: formatPercent(Number(indicadores.coberturaAfastamentos || 0)),
    centerSub: "COBERTURA",
    datalabelMin: 1,
    datalabelFontSize: 20,
    datalabelOffset: 12,
    cutout: "70%",
    radius: "90%",
    layoutPadding: { left: 34, right: 18, top: 20, bottom: 20 },
    centerFontSize: 18,
    centerSubFontSize: 12
  });
  renderLegend("legendCoberturaAfastamentos", [
    ["Cobertos", cobertos, COLORS.blue, part(cobertos, Number(indicadores.afastados || 0))],
    ["Sem cobertura", naoCobertos, COLORS.orange, part(naoCobertos, Number(indicadores.afastados || 0))]
  ]);

  setText("resumoCoberturaPercentual", formatPercent(Number(indicadores.coberturaAfastamentos || 0)));
  setText("resumoCoberturaSubstituicoes", formatNumber(Number(indicadores.substituicoes || 0)));
  setText("resumoCoberturaAfastados", formatNumber(Number(indicadores.afastados || 0)));
  setText(
    "resumoCoberturaTexto",
    `${formatNumber(Number(indicadores.substituicoes || 0))} de ${formatNumber(Number(indicadores.afastados || 0))} afastamentos cobertos.`
  );
}

function renderResumoAlertasKpi(indicadores) {
  renderAlertasKpis([{
    qtdTemporarioAtivo: Number(indicadores.riscoTemporario || 0),
    afastados: Number(indicadores.afastados || 0),
    cargo: "",
    quantitativoPlano: 0,
    totalTrabalhadores: 0
  }]);
}

export async function recarregarTodosOsDados(botao) {
  const btn = botao || document.getElementById("refreshBtn");
  if (btn) {
    btn.disabled = true;
    btn.classList.add("refreshBtnLoading");
  }

  try {
    // Garante leitura fresca do banco (monitoramento, vagas ociosas, lista, etc.).
    await apiPost("/api/cache/clear", {}).catch(() => { });

    if (podeVerModulo("visaoGeral")) {
      const resumo = await apiGet("/api/dashboard/resumo").catch(() => null);
      if (resumo) renderResumoInicial(resumo);
    }

    // Força o recarregamento das páginas que o usuário tem permissão de ver
    // (os loaders de Vagas/Alertas já se autoguardam; o backend bloqueia o resto).
    carregarVagasEmSegundoPlano(true);
    carregarAlertasEmSegundoPlano(true);
    if (podeVerModulo("remanejamento")) {
      carregarRemanejamentoListaEmSegundoPlano(true);
      carregarRemanejamentoCadastroEmSegundoPlano(true);
    }
  } catch (error) {
    console.error("Falha ao atualizar os dados do painel:", error);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove("refreshBtnLoading");
    }
  }
}

export function iniciarCarregamentoPaginasEmSegundoPlano() {
  if (state.backgroundLoadStarted) return;
  state.backgroundLoadStarted = true;
  recarregarPaginasEmSegundoPlano();
}

export function recarregarPaginasEmSegundoPlano() {
  // Carrega a base completa de Vagas já no início para que a Visão Geral possa
  // filtrar os dados desde a primeira tela (sem precisar abrir a aba Vagas antes).
  carregarVagasEmSegundoPlano();
  carregarAlertasEmSegundoPlano();
  // Remanejamento NÃO é mais pré-carregado no boot: carrega sob demanda ao abrir a
  // aba (garantirCarregamentoPagina). Poupa 2 GETs por sessão para quem só usa a
  // Visão Geral; o refresh manual (recarregarTodosOsDados) segue atualizando-o.

  // Saúde Indígena (base ~20k, render pesado): pré-carrega em segundo plano SÓ para
  // quem tem a aba, num idle POSTERIOR ao núcleo (não compete com Vagas/Alertas),
  // para que a 1ª abertura seja instantânea em vez de esperar o fetch+render.
  if (podeVerModulo("painelSaudeIndigena")) agendarEmIdle(prefetchSaudeIndigena);
}

export function garantirCarregamentoPagina(view) {
  if (view === "vagas" && !pageLoadState.vagas) carregarVagasEmSegundoPlano();
  if (view === "alertas" && !pageLoadState.alertas) carregarAlertasEmSegundoPlano();
  // Alertas usam a base de monitoramento de Vagas: ao abrir Alertas, garante que a
  // base esteja carregando (self-guard por permissão + pageLoadState evitam duplo GET).
  if (view === "alertas" && !pageLoadState.vagas) carregarVagasEmSegundoPlano();
  if ((view === "remanejamento" || view === "remanejamentoFormulario") && !pageLoadState.remanejamentoLista) carregarRemanejamentoListaEmSegundoPlano();
  if ((view === "remanejamento" || view === "remanejamentoFormulario") && !pageLoadState.remanejamentoCadastro) carregarRemanejamentoCadastroEmSegundoPlano();
}

// Protocolo comum de carregamento sob demanda: guarda de concorrência
// (pageLoadingState), cache por página (pageLoadState) e tratamento de erro.
// `antes()` roda antes do fetch; `aoCarregar(payload)` define o estado e
// renderiza (já com pageLoadState[chave] = true); `aoFalhar(error)` é opcional.
function carregarPaginaEmSegundoPlano({ chave, endpoint, forcar, antes, aoCarregar, aoFalhar, mensagemErro }) {
  if (pageLoadingState[chave]) return;
  if (pageLoadState[chave] && !forcar) return;
  pageLoadingState[chave] = true;

  if (antes) antes();

  apiGet(endpoint)
    .then(payload => {
      pageLoadingState[chave] = false;
      pageLoadState[chave] = true;
      aoCarregar(payload);
    })
    .catch(error => {
      pageLoadingState[chave] = false;
      console.error(mensagemErro, error);
      if (aoFalhar) aoFalhar(error);
    });
}

export function carregarVagasEmSegundoPlano(forcar) {
  if (!podeVerModulo("vagas")) return; // sem acesso à aba Vagas: backend bloqueia o GET
  carregarPaginaEmSegundoPlano({
    chave: "vagas",
    endpoint: "/api/vagas",
    forcar,
    mensagemErro: "Falha ao carregar a aba Vagas:",
    antes: () => {
      const tbody = document.getElementById("vagasBody");
      const pagination = document.getElementById("vagasPagination");
      if (tbody && state.activeView === "vagas") tbody.innerHTML = '<tr><td colspan="9">Carregando tabela detalhada de vagas...</td></tr>';
      if (pagination && state.activeView === "vagas") pagination.innerHTML = "";
    },
    aoCarregar: payload => {
      state.vagasBaseRows = payload.rows || [];
      state.allRows = state.vagasBaseRows;
      // Alertas usam a MESMA base de monitoramento que Vagas: reaproveita aqui
      // para não baixar a base uma 2ª vez (ver carregarAlertasEmSegundoPlano).
      state.alertasBaseRows = state.vagasBaseRows;
      if (payload.indicadores) {
        state.indicadoresResumoBase = payload.indicadores;
      }
      // Garante os filtros do topo mesmo quando a Visão Geral (resumo) não foi carregada.
      garantirFiltrosMultiSelect(payload.filtros);
      if (payload.atualizadoEm) document.getElementById("updatedAt").innerText = payload.atualizadoEm;
      // aplicarFiltros -> renderTudo já re-renderiza os Alertas (KPIs + tabela)
      // quando as observações também já chegaram (pageLoadState.alertas).
      aplicarFiltros();
    },
    aoFalhar: renderVagasErro
  });
}

export function carregarAlertasEmSegundoPlano(forcar) {
  if (!podeVerModulo("alertas")) return; // sem acesso à aba Alertas: backend bloqueia o GET

  // Alertas usam a MESMA base de monitoramento que Vagas. Se o usuário tem acesso
  // a Vagas, reaproveita state.vagasBaseRows e busca SÓ as observações (endpoint
  // leve) — evita transferir a base inteira uma 2ª vez. Sem acesso a Vagas (a base
  // não vem de lá e o GET /api/vagas daria 403), baixa a base completa por /api/alertas.
  if (podeVerModulo("vagas")) {
    carregarPaginaEmSegundoPlano({
      chave: "alertas",
      endpoint: "/api/alertas/observacoes",
      forcar,
      mensagemErro: "Falha ao carregar as observações de Alertas:",
      aoCarregar: payload => {
        state.observacoesAlertas = payload.observacoes || {};
        // A base vem de Vagas. Se já chegou, renderiza; senão, o load de Vagas
        // renderiza os Alertas quando a base chegar (renderTudo em aplicarFiltros).
        if (pageLoadState.vagas) {
          state.alertasBaseRows = state.vagasBaseRows || [];
          renderAlertasKpis(filtrarRowsBase(state.alertasBaseRows));
          renderAlertasDaPagina();
        }
      },
      aoFalhar: renderAlertasErro
    });
    return;
  }

  carregarPaginaEmSegundoPlano({
    chave: "alertas",
    endpoint: "/api/alertas",
    forcar,
    mensagemErro: "Falha ao carregar a aba Alertas:",
    aoCarregar: payload => {
      state.alertasBaseRows = payload.rows || [];
      state.observacoesAlertas = payload.observacoes || {};
      renderAlertasKpis(filtrarRowsBase(state.alertasBaseRows));
      renderAlertasDaPagina();
    },
    aoFalhar: renderAlertasErro
  });
}

export function carregarRemanejamentoListaEmSegundoPlano(forcar) {
  if (!podeVerModulo("remanejamento")) return; // sem acesso: backend bloqueia o GET
  carregarPaginaEmSegundoPlano({
    chave: "remanejamentoLista",
    endpoint: "/api/remanejamento/lista",
    forcar,
    mensagemErro: "Falha ao carregar a lista de remanejamento:",
    aoCarregar: payload => {
      state.remanejamentoListaRows = payload.rows || [];
      renderRemanejamentoLista();
    },
    aoFalhar: renderRemanejamentoListaErro
  });
}

export function carregarRemanejamentoCadastroEmSegundoPlano(forcar) {
  if (!podeVerModulo("remanejamento")) return; // sem acesso: backend bloqueia o GET
  carregarPaginaEmSegundoPlano({
    chave: "remanejamentoCadastro",
    endpoint: "/api/remanejamento/cadastro",
    forcar,
    mensagemErro: "Falha ao carregar dados do formulário de remanejamento:",
    aoCarregar: payload => {
      state.remanejamentoCadastroRows = payload.rows || [];
      configurarRemanejamento();
    }
  });
}

export function onError(error) {
  document.getElementById("loading").style.display = "none";

  const box = document.getElementById("errorBox");
  box.style.display = "block";
  box.innerText = error && error.message ? error.message : String(error);
}

export function renderTudo() {
  renderKpis(state.filteredRows);
  renderGraficos(state.filteredRows);
  renderResumosExecutivos(state.filteredRows);

  const alertasKpiBase = pageLoadState.alertas ? filtrarRowsBase(state.alertasBaseRows) : state.filteredRows;
  renderAlertasKpis(alertasKpiBase);

  if (state.activeView === "vagas" || pageLoadState.vagas) {
    renderVagasDaPagina();
  }

  if (state.activeView === "alertas" || pageLoadState.alertas) {
    renderAlertasDaPagina();
  }
}

document.addEventListener("DOMContentLoaded", () => { init().catch(onError); });
