import { renderAlertasDaPagina, renderAlertasErro } from "./alertas.js";
import { apiGet, apiPost, carregarConfiguracaoApp_ } from "./api.js";
import { configurarLogin, verificarSessaoInicial } from "./auth.js";
import { renderBar, renderDoughnut, renderFunnel, renderLegend, renderProgressBarResumo, renderTreemap } from "./charts.js";
import { AUTO_FULL_RELOAD_MS, AUTO_REFRESH_MS, COLORS } from "./constants.js";
import { aplicarFiltros, atualizarModoRolagem, configurarDelegacaoEventos, configurarFechamentoDeMenus, configurarMultiSelectEstaticos, configurarNavegacao, criarMultiSelect, filtrarGraficoAtivo, getSelectedValues, matchMulti, restaurarEstadoMenuLateral } from "./filtros.js";
import { preencherKpiBloco, renderAlertasKpis, renderGraficos, renderKpis, renderResumosExecutivos } from "./kpis.js";
import { configurarPainelExterno, configurarPainelFerias, configurarRemanejamento, renderRemanejamentoLista, renderRemanejamentoListaErro } from "./remanejamento.js";
import { charts, pageLoadState, pageLoadingState } from "./runtime.js";
import { state } from "./state.js";
import { formatNumber, formatPercent, part, setText } from "./utils.js";
import { renderVagasDaPagina, renderVagasErro } from "./vagas.js";

    export async function init() {
      await carregarConfiguracaoApp_();
      if (typeof ChartDataLabels !== "undefined") {
        Chart.register(ChartDataLabels);
      }

      restaurarEstadoMenuLateral();
      configurarNavegacao();
      atualizarModoRolagem(state.activeView || "visaoGeral");
      configurarMultiSelectEstaticos();
      configurarFechamentoDeMenus();
      configurarDelegacaoEventos();
      configurarPainelExterno();
      configurarPainelFerias();
      configurarRemanejamento();
      configurarResponsividadePainel();
      configurarLogin();
      await verificarSessaoInicial();
    }

    export function configurarResponsividadePainel() {
      let resizeTimer = null;

      window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          Object.values(charts).forEach(chart => {
            if (chart) chart.resize();
          });
        }, 160);
      });
    }

    export function carregarDadosInicial() {
      const loading = document.getElementById("loading");
      if (loading) loading.style.display = "grid";

      marcarDetalhesCarregandoInicial();

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

      const filtros = payload.filtros || { dseis: [], cargos: [] };

      criarMultiSelect(
        "fDsei",
        (filtros.dseis || []).map(v => ({ value: v, label: v })),
        "Todos os DSEIs/CASAIs"
      );

      criarMultiSelect(
        "fCargo",
        (filtros.cargos || []).map(v => ({ value: v, label: v })),
        "Todos os cargos"
      );

      criarMultiSelect(
        "fTipoAlerta",
        [
          { value: "AFASTAMENTO_SEM_SUBSTITUTO", label: "Afastamento sem substituto" },
          { value: "TEMPORARIO_ATIVO", label: "Temporário ativo" },
          { value: "VAGA_EXCEDENTE", label: "Vaga excedente" },
          { value: "RT_EXCEDENTE", label: "RT excedente" }
        ],
        "Todos os alertas"
      );

      renderResumoInicial(payload);

      const loading = document.getElementById("loading");
      if (loading) loading.style.display = "none";

      iniciarCarregamentoPaginasEmSegundoPlano();
    }

    export function renderResumoInicial(payload) {
      payload = payload || {};
      const indicadores = payload.indicadores || {};

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

      const topCategorias = payload.topDseiVagas || payload.topCategorias || payload.topCargos || [];
      renderFunnel("chartCategoria", {
        items: topCategorias.map(i => ({
          label: i.label,
          value: Number(i.value || 0),
          color: COLORS.blue
        })),
        filterType: "dsei"
      });

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

      const indigenas = Number(indicadores.indigenas || 0);
      const percentualIndigenas = Number(indicadores.percentualIndigenas || 0);
      renderDoughnut("chartIndigenasGeral", {
        labels: ["Trabalhadores indígenas", "Demais trabalhadores"],
        values: [indigenas, Math.max(0, Number(indicadores.contratados || 0) - indigenas)],
        colors: [COLORS.green, COLORS.blue2],
        center: formatPercent(percentualIndigenas),
        centerSub: "INDÍGENAS"
      });
      renderLegend("legendIndigenasGeral", [
        ["Indígenas", indigenas, COLORS.green, percentualIndigenas],
        ["Demais", Math.max(0, Number(indicadores.contratados || 0) - indigenas), COLORS.blue2, Math.max(0, 100 - percentualIndigenas)]
      ]);

      const normal = Number(indicadores.contratadosNormal || 0);
      const substituicao = Number(indicadores.substituicoes || 0);
      const temporario = Number(indicadores.temporarios || 0);
      const totalContratacao = normal + substituicao + temporario;

      renderDoughnut("chartTipo", {
        labels: ["Normal", "Substituição", "Temporário"],
        values: [normal, substituicao, temporario],
        colors: [COLORS.blue, COLORS.orange, COLORS.green],
        center: formatNumber(totalContratacao),
        centerSub: "TOTAL"
      });
      renderLegend("legendTipo", [
        ["Normal", normal, COLORS.blue, part(normal, totalContratacao)],
        ["Substituição", substituicao, COLORS.orange, part(substituicao, totalContratacao)],
        ["Temporário", temporario, COLORS.green, part(temporario, totalContratacao)]
      ]);

      const topDseiOciosas = payload.topDseiOciosas || [];
      renderTreemap("chartTopDseiOciosas", {
        items: topDseiOciosas.map(i => ({
          label: i.label,
          value: Number(i.value || 0)
        })),
        color: COLORS.orange,
        filterType: "dsei"
      });

      const topCargoOciosas = payload.topCargoOciosas || [];
      renderBar("chartTopCargoOciosas", {
        labels: topCargoOciosas.map(i => i.label),
        values: topCargoOciosas.map(i => Number(i.value || 0)),
        color: COLORS.purple,
        labelFontSize: 9.6,
        dataLabelFontSize: 10.8,
        xTickFontSize: 9.5,
        rightPadding: 44,
        wrapLabels: true,
        maxCharsPerLine: 18,
        maxLines: 5,
        yAxisWidth: 205
      });

      const cobertos = Math.min(Math.max(0, substituicao), Math.max(0, Number(indicadores.afastados || 0)));
      const naoCobertos = Math.max(0, Number(indicadores.afastados || 0) - cobertos);
      renderDoughnut("chartCoberturaAfastamentos", {
        labels: ["Afastamentos cobertos", "Afastamentos sem cobertura"],
        values: [cobertos, naoCobertos],
        colors: [COLORS.blue, COLORS.orange],
        center: formatPercent(Number(indicadores.coberturaAfastamentos || 0)),
        centerSub: "COBERTURA",
        datalabelMin: 18,
        datalabelFontSize: 8,
        centerFontSize: 26,
        centerSubFontSize: 8
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

      renderAlertasKpis([{
        qtdTemporarioAtivo: Number(indicadores.riscoTemporario || 0),
        afastados: Number(indicadores.afastados || 0),
        cargo: "",
        quantitativoPlano: 0,
        totalContratados: 0
      }]);
    }

    export function configurarAutoAtualizacao() {
      if (state.autoRefreshTimer) clearInterval(state.autoRefreshTimer);
      if (state.autoReloadTimer) clearInterval(state.autoReloadTimer);

      state.autoRefreshTimer = setInterval(atualizarDadosEmSegundoPlano, AUTO_REFRESH_MS);
      state.autoReloadTimer = setInterval(() => {
        window.location.reload();
      }, AUTO_FULL_RELOAD_MS);
    }

    export function atualizarDadosEmSegundoPlano() {
      if (document.hidden) return;
      if (state.isAutoRefreshing) return;
      state.isAutoRefreshing = true;

      apiGet("/api/dashboard/resumo")
        .then(payload => {
          state.isAutoRefreshing = false;
          renderResumoInicial(payload || {});

          if (pageLoadState.alertas) carregarAlertasEmSegundoPlano(true);
          if (pageLoadState.remanejamentoLista) carregarRemanejamentoListaEmSegundoPlano(true);
          if (pageLoadState.remanejamentoCadastro) carregarRemanejamentoCadastroEmSegundoPlano(true);
          if (pageLoadState.vagas && state.activeView === "vagas") carregarVagasEmSegundoPlano(true);
        })
        .catch(error => {
          state.isAutoRefreshing = false;
          console.error("Falha na atualização automática do painel:", error);
        });
    }

    export async function recarregarTodosOsDados(botao) {
      const btn = botao || document.getElementById("refreshBtn");
      if (btn) {
        btn.disabled = true;
        btn.classList.add("refreshBtnLoading");
      }

      try {
        // Garante leitura fresca do banco (monitoramento, vagas ociosas, lista, etc.).
        await apiPost("/api/cache/clear", {}).catch(() => {});

        const resumo = await apiGet("/api/dashboard/resumo").catch(() => null);
        if (resumo) renderResumoInicial(resumo);

        // Força o recarregamento de todas as páginas (carregadas ou não).
        carregarVagasEmSegundoPlano(true);
        carregarAlertasEmSegundoPlano(true);
        carregarRemanejamentoListaEmSegundoPlano(true);
        carregarRemanejamentoCadastroEmSegundoPlano(true);
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
      carregarRemanejamentoListaEmSegundoPlano();
      carregarRemanejamentoCadastroEmSegundoPlano();
    }

    export function garantirCarregamentoPagina(view) {
      if (view === "vagas" && !pageLoadState.vagas) carregarVagasEmSegundoPlano();
      if (view === "alertas" && !pageLoadState.alertas) carregarAlertasEmSegundoPlano();
      if ((view === "remanejamento" || view === "remanejamentoFormulario") && !pageLoadState.remanejamentoLista) carregarRemanejamentoListaEmSegundoPlano();
      if ((view === "remanejamento" || view === "remanejamentoFormulario") && !pageLoadState.remanejamentoCadastro) carregarRemanejamentoCadastroEmSegundoPlano();
    }

    export function carregarVagasEmSegundoPlano(forcar) {
      if (pageLoadingState.vagas) return;
      if (pageLoadState.vagas && !forcar) return;
      pageLoadingState.vagas = true;

      const tbody = document.getElementById("vagasBody");
      const pagination = document.getElementById("vagasPagination");
      if (tbody && state.activeView === "vagas") tbody.innerHTML = '<tr><td colspan="9">Carregando tabela detalhada de vagas...</td></tr>';
      if (pagination && state.activeView === "vagas") pagination.innerHTML = "";

      apiGet("/api/vagas")
        .then(payload => {
          pageLoadingState.vagas = false;
          state.vagasBaseRows = payload.rows || [];
          state.allRows = state.vagasBaseRows;
          if (payload.indicadores) {
            state.indicadoresResumoBase = payload.indicadores;
          }
          pageLoadState.vagas = true;
          if (payload.atualizadoEm) document.getElementById("updatedAt").innerText = payload.atualizadoEm;
          aplicarFiltros();
        })
        .catch(error => {
          pageLoadingState.vagas = false;
          console.error("Falha ao carregar a aba Vagas:", error);
          renderVagasErro(error);
        });
    }

    export function carregarAlertasEmSegundoPlano(forcar) {
      if (pageLoadingState.alertas) return;
      if (pageLoadState.alertas && !forcar) return;
      pageLoadingState.alertas = true;

      apiGet("/api/alertas")
        .then(payload => {
          pageLoadingState.alertas = false;
          state.alertasBaseRows = payload.rows || [];
          state.observacoesAlertas = payload.observacoes || {};
          pageLoadState.alertas = true;
          renderAlertasKpis(filtrarRowsBase(state.alertasBaseRows));
          renderAlertasDaPagina();
        })
        .catch(error => {
          pageLoadingState.alertas = false;
          console.error("Falha ao carregar a aba Alertas:", error);
          renderAlertasErro(error);
        });
    }

    export function carregarRemanejamentoListaEmSegundoPlano(forcar) {
      if (pageLoadingState.remanejamentoLista) return;
      if (pageLoadState.remanejamentoLista && !forcar) return;
      pageLoadingState.remanejamentoLista = true;

      apiGet("/api/remanejamento/lista")
        .then(payload => {
          pageLoadingState.remanejamentoLista = false;
          state.remanejamentoListaRows = payload.rows || [];
          pageLoadState.remanejamentoLista = true;
          renderRemanejamentoLista();
        })
        .catch(error => {
          pageLoadingState.remanejamentoLista = false;
          console.error("Falha ao carregar a lista de remanejamento:", error);
          renderRemanejamentoListaErro(error);
        });
    }

    export function carregarRemanejamentoCadastroEmSegundoPlano(forcar) {
      if (pageLoadingState.remanejamentoCadastro) return;
      if (pageLoadState.remanejamentoCadastro && !forcar) return;
      pageLoadingState.remanejamentoCadastro = true;

      apiGet("/api/remanejamento/cadastro")
        .then(payload => {
          pageLoadingState.remanejamentoCadastro = false;
          state.remanejamentoCadastroRows = payload.rows || [];
          pageLoadState.remanejamentoCadastro = true;
          configurarRemanejamento();
        })
        .catch(error => {
          pageLoadingState.remanejamentoCadastro = false;
          console.error("Falha ao carregar dados do formulário de remanejamento:", error);
        });
    }

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

    export function onDataLoaded(payload) {
      payload = payload || {};
      state.allRows = payload.rows || [];
      state.vagasBaseRows = state.allRows;
      pageLoadState.vagas = state.allRows.length > 0;

      document.getElementById("updatedAt").innerText = payload.atualizadoEm || "-";

      const filtros = payload.filtros || { dseis: [], cargos: [] };

      criarMultiSelect(
        "fDsei",
        (filtros.dseis || []).map(v => ({ value: v, label: v })),
        "Todos os DSEIs/CASAIs"
      );

      criarMultiSelect(
        "fCargo",
        (filtros.cargos || []).map(v => ({ value: v, label: v })),
        "Todos os cargos"
      );

      criarMultiSelect(
        "fTipoAlerta",
        [
          { value: "AFASTAMENTO_SEM_SUBSTITUTO", label: "Afastamento sem substituto" },
          { value: "TEMPORARIO_ATIVO", label: "Temporário ativo" },
          { value: "VAGA_EXCEDENTE", label: "Vaga excedente" },
          { value: "RT_EXCEDENTE", label: "RT excedente" }
        ],
        "Todos os alertas"
      );

      document.getElementById("loading").style.display = "none";
      aplicarFiltros();
      iniciarCarregamentoPaginasEmSegundoPlano();
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

    export function renderTabelasDetalhadas() {
      renderVagasDaPagina();
      renderAlertasDaPagina();
    }

    document.addEventListener("DOMContentLoaded", () => { init().catch(onError); });
