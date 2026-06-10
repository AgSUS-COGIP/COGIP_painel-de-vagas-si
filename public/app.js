
    let allRows = [];
    let filteredRows = [];
    let indicadoresResumoBase = null;
    let vagasRows = [];
    let alertasRows = [];
    let vagasBaseRows = [];
    let alertasBaseRows = [];
    let observacoesAlertas = {};
    let alertaObservacaoEditando = null;
    let remanejamentoListaRows = [];
    let remanejamentoCadastroRows = [];
    let remanejamentoDetalhePage = 1;
    let remanejamentoLinhas = {
      reduzido: [],
      acrescentado: []
    };
    let vagasViewAtual = "dsei";
    let vagasTabelaAtual = "vagas";
    let vagasSearchTerm = "";
    let vagasSortState = { key: "label", direction: "asc" };
    let activeView = "visaoGeral";
    let activeChartFilter = null;
    let vagasCurrentPage = 1;
    let alertasCurrentPage = 1;
    const AUTO_REFRESH_MS = 5 * 60 * 1000; // Atualiza os dados a cada 5 minutos.
    const AUTO_FULL_RELOAD_MS = 60 * 60 * 1000; // Recarrega a página inteira a cada 60 minutos para manter estabilidade em tela fixa.
    let autoRefreshTimer = null;
    let autoReloadTimer = null;
    let isAutoRefreshing = false;
    let backgroundLoadStarted = false;
    let painelExternoCarregado = false;
    let painelFeriasCarregado = false;
    const pageLoadState = {
      vagas: false,
      alertas: false,
      remanejamentoLista: false,
      remanejamentoCadastro: false
    };
    const pageLoadingState = {
      vagas: false,
      alertas: false,
      remanejamentoLista: false,
      remanejamentoCadastro: false
    };

    const charts = {};
    const filterConfigs = {};

    const COLORS = {
      blue: "#20b2ff",
      blue2: "#74d7ff",
      orange: "#f6b232",
      yellow: "#f3bb18",
      purple: "#6c55d9",
      cyan: "#00b5d8",
      green: "#49d18d",
      red: "#dc3f3f",
      muted: "#d9ecf7"
    };

    const STATIC_FILTERS = {
      fTipo: [
        { value: "NORMAL", label: "Normal" },
        { value: "SUBSTITUICAO", label: "Substituição" },
        { value: "TEMPORARIO", label: "Temporário" }
      ],
      fAlerta: [
        { value: "AFASTAMENTO_SEM_SUBSTITUTO", label: "Afastamento sem substituto" },
        { value: "TEMPORARIO_ATIVO", label: "Temporário ativo" },
        { value: "VAGA_EXCEDENTE", label: "Vaga excedente" },
        { value: "RT_EXCEDENTE", label: "RT excedente" },
        { value: "SEM_ALERTA", label: "Sem alerta" }
      ]
    };

    // URL opcional do Dashboard SI.
    // Usa a função do Código.gs quando ela existir; se não existir, mantém vazio para não quebrar o painel.
    let DASHBOARD_SAUDE_INDIGENA_URL = "";
    // URL opcional do Dashboard de Férias.
    let DASHBOARD_FERIAS_URL = "";
    



    const REMANEJAMENTO_EMPTY_OPTION = { value: "", label: "Selecione" };

    document.addEventListener("DOMContentLoaded", () => { init().catch(onError); });

    async function init() {
      await carregarConfiguracaoApp_();
      if (typeof ChartDataLabels !== "undefined") {
        Chart.register(ChartDataLabels);
      }

      restaurarEstadoMenuLateral();
      configurarNavegacao();
      atualizarModoRolagem(activeView || "visaoGeral");
      configurarMultiSelectEstaticos();
      configurarFechamentoDeMenus();
      configurarPainelExterno();
      configurarPainelFerias();
      configurarRemanejamento();
      configurarResponsividadePainel();
      configurarLogin();
      await verificarSessaoInicial();
    }

    let painelLoginToken = "";
    let painelLoginUsuario = null;
    let painelIniciado = false;

    function configurarLogin() {
      const form = document.getElementById("loginForm");
      if (form && !form.dataset.bound) {
        form.dataset.bound = "1";
        form.addEventListener("submit", (ev) => {
          ev.preventDefault();
          realizarLoginPainel();
        });
      }
    }

    async function verificarSessaoInicial() {
      try {
        painelLoginToken = localStorage.getItem("painelLoginToken") || "";
      } catch (e) {
        painelLoginToken = "";
      }

      if (painelLoginToken) {
        try {
          const payload = await apiGet("/api/sessao");
          painelLoginUsuario = payload.usuario || null;
          iniciarPainelAutenticado();
          return;
        } catch (e) {
          painelLoginToken = "";
          painelLoginUsuario = null;
        }
      }

      mostrarLoginOverlay();
    }

    function mostrarLoginOverlay() {
      const loading = document.getElementById("loading");
      if (loading) loading.style.display = "none";
      const login = document.getElementById("loginScreen");
      if (login) login.style.display = "grid";
      const usuarioInput = document.getElementById("loginUsuario");
      if (usuarioInput) setTimeout(() => usuarioInput.focus(), 0);
    }

    async function realizarLoginPainel() {
      const usuario = document.getElementById("loginUsuario")?.value || "";
      const senha = document.getElementById("loginSenha")?.value || "";
      const btn = document.getElementById("loginBtn");
      const erro = document.getElementById("loginErro");

      if (erro) erro.innerText = "";
      if (!usuario.trim() || !senha) {
        if (erro) erro.innerText = "Informe usuário e senha.";
        return;
      }

      if (btn) btn.disabled = true;

      try {
        const payload = await apiPost("/api/login", { login: usuario, senha });
        painelLoginToken = payload.token || "";
        painelLoginUsuario = payload.usuario || null;
        try { localStorage.setItem("painelLoginToken", painelLoginToken); } catch (e) {}

        const senhaInput = document.getElementById("loginSenha");
        if (senhaInput) senhaInput.value = "";

        const login = document.getElementById("loginScreen");
        if (login) login.style.display = "none";

        iniciarPainelAutenticado();
      } catch (error) {
        if (erro) erro.innerText = error && error.message ? error.message : "Falha ao entrar.";
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    function iniciarPainelAutenticado() {
      aplicarPermissoesUsuario();

      if (painelIniciado) return;
      painelIniciado = true;

      configurarAutoAtualizacao();
      carregarDadosInicial();
    }

    function aplicarPermissoesUsuario() {
      const nivel = painelLoginUsuario ? Number(painelLoginUsuario.nivelAutorizacao || 0) : 0;

      // Nível 0: sem acesso à página de Remanejamento (oculta o menu).
      const navRemanejamento = document.querySelector('.navItem[data-view="remanejamento"]');
      if (navRemanejamento) navRemanejamento.style.display = nivel >= 1 ? "" : "none";

      // Nível 1: pode visualizar, mas o botão salvar fica desabilitado. Nível 2: libera tudo.
      const btnSalvar = document.getElementById("remSaveBtn");
      if (btnSalvar) {
        const podeSalvar = nivel >= 2;
        btnSalvar.disabled = !podeSalvar;
        btnSalvar.title = podeSalvar ? "" : "Você não tem permissão para salvar remanejamentos.";
      }

      // Se o usuário sem acesso estiver na aba de remanejamento, volta para a Visão Geral.
      if (nivel < 1 && activeView === "remanejamento") {
        const navVisao = document.querySelector('.navItem[data-view="visaoGeral"]');
        if (navVisao) navVisao.click();
      }

      const wrap = document.getElementById("sidebarUsuario");
      const nome = document.getElementById("sidebarUsuarioNome");
      if (wrap) wrap.style.display = painelLoginUsuario ? "" : "none";
      if (nome && painelLoginUsuario) {
        nome.innerText = painelLoginUsuario.nome || painelLoginUsuario.login || "";
      }
    }

    function logoutPainel() {
      painelLoginToken = "";
      painelLoginUsuario = null;
      try { localStorage.removeItem("painelLoginToken"); } catch (e) {}
      window.location.reload();
    }



    async function carregarConfiguracaoApp_() {
      const config = await apiGet("/api/config");
      DASHBOARD_SAUDE_INDIGENA_URL = String(config.dashboardSaudeIndigenaUrl || "").trim();
      DASHBOARD_FERIAS_URL = String(config.dashboardFeriasUrl || "").trim();

      const root = document.documentElement;
      root.style.setProperty("--background-painel-image", config.backgroundPainelUrl ? `url("${config.backgroundPainelUrl}")` : "none");
      root.style.setProperty("--imagem-indigena-painel-image", config.imagemIndigenaPainelUrl ? `url("${config.imagemIndigenaPainelUrl}")` : "none");

      document.querySelectorAll("[data-config-src]").forEach(img => {
        const key = img.getAttribute("data-config-src");
        const value = config[key];

        if (value) {
          img.src = value;
        }
      });
    }

    function authHeaders(extra) {
      const headers = Object.assign({ Accept: "application/json" }, extra || {});
      if (painelLoginToken) headers.Authorization = `Bearer ${painelLoginToken}`;
      return headers;
    }

    async function apiGet(path) {
      const response = await fetch(path, {
        headers: authHeaders()
      });

      if (!response.ok) {
        let message = `Erro ${response.status}`;

        try {
          const payload = await response.json();
          if (payload && payload.error) message = payload.error;
        } catch (err) {}

        throw new Error(message);
      }

      return response.json();
    }

    async function apiPost(path, body) {
      const response = await fetch(path, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body || {})
      });

      if (!response.ok) {
        let message = `Erro ${response.status}`;

        try {
          const payload = await response.json();
          if (payload && payload.error) message = payload.error;
        } catch (err) {}

        throw new Error(message);
      }

      return response.json();
    }
    function configurarResponsividadePainel() {
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

    function carregarDadosInicial() {
      const loading = document.getElementById("loading");
      if (loading) loading.style.display = "grid";

      marcarDetalhesCarregandoInicial();

      apiGet("/api/dashboard/resumo")
        .then(onResumoDataLoaded)
        .catch(onError);
    }

    function marcarDetalhesCarregandoInicial() {
      const vagasBody = document.getElementById("vagasBody");
      if (vagasBody) vagasBody.innerHTML = '<tr><td colspan="9">Aguardando carregamento sob demanda...</td></tr>';

      const alertasBody = document.getElementById("alertasBody");
      if (alertasBody) alertasBody.innerHTML = '<tr><td colspan="5">Aguardando carregamento em segundo plano...</td></tr>';

      const remanejamentoBody = document.getElementById("remanejamentoBody");
      if (remanejamentoBody) remanejamentoBody.innerHTML = '<tr><td class="remanejamentoEmpty" colspan="10">Aguardando carregamento em segundo plano...</td></tr>';
    }

    function onResumoDataLoaded(payload) {
      payload = payload || {};
      indicadoresResumoBase = payload.indicadores || null;

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

    function renderResumoInicial(payload) {
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

    function configurarAutoAtualizacao() {
      if (autoRefreshTimer) clearInterval(autoRefreshTimer);
      if (autoReloadTimer) clearInterval(autoReloadTimer);

      autoRefreshTimer = setInterval(atualizarDadosEmSegundoPlano, AUTO_REFRESH_MS);
      autoReloadTimer = setInterval(() => {
        window.location.reload();
      }, AUTO_FULL_RELOAD_MS);
    }

    function atualizarDadosEmSegundoPlano() {
      if (document.hidden) return;
      if (isAutoRefreshing) return;
      isAutoRefreshing = true;

      apiGet("/api/dashboard/resumo")
        .then(payload => {
          isAutoRefreshing = false;
          renderResumoInicial(payload || {});

          if (pageLoadState.alertas) carregarAlertasEmSegundoPlano(true);
          if (pageLoadState.remanejamentoLista) carregarRemanejamentoListaEmSegundoPlano(true);
          if (pageLoadState.remanejamentoCadastro) carregarRemanejamentoCadastroEmSegundoPlano(true);
          if (pageLoadState.vagas && activeView === "vagas") carregarVagasEmSegundoPlano(true);
        })
        .catch(error => {
          isAutoRefreshing = false;
          console.error("Falha na atualização automática do painel:", error);
        });
    }

    // Recarrega todos os dados do painel buscando do banco (limpa o cache do servidor antes).
    // Usado pelo botão "Atualizar dados" e após salvar um remanejamento.
    async function recarregarTodosOsDados(botao) {
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

    function iniciarCarregamentoPaginasEmSegundoPlano() {
      if (backgroundLoadStarted) return;
      backgroundLoadStarted = true;
      recarregarPaginasEmSegundoPlano();
    }

    function recarregarPaginasEmSegundoPlano() {
      // Carrega a base completa de Vagas já no início para que a Visão Geral possa
      // filtrar os dados desde a primeira tela (sem precisar abrir a aba Vagas antes).
      carregarVagasEmSegundoPlano();
      carregarAlertasEmSegundoPlano();
      carregarRemanejamentoListaEmSegundoPlano();
      carregarRemanejamentoCadastroEmSegundoPlano();
    }

    function garantirCarregamentoPagina(view) {
      if (view === "vagas" && !pageLoadState.vagas) carregarVagasEmSegundoPlano();
      if (view === "alertas" && !pageLoadState.alertas) carregarAlertasEmSegundoPlano();
      if ((view === "remanejamento" || view === "remanejamentoFormulario") && !pageLoadState.remanejamentoLista) carregarRemanejamentoListaEmSegundoPlano();
      if ((view === "remanejamento" || view === "remanejamentoFormulario") && !pageLoadState.remanejamentoCadastro) carregarRemanejamentoCadastroEmSegundoPlano();
    }

    function carregarVagasEmSegundoPlano(forcar) {
      if (pageLoadingState.vagas) return;
      if (pageLoadState.vagas && !forcar) return;
      pageLoadingState.vagas = true;

      const tbody = document.getElementById("vagasBody");
      const pagination = document.getElementById("vagasPagination");
      if (tbody && activeView === "vagas") tbody.innerHTML = '<tr><td colspan="9">Carregando tabela detalhada de vagas...</td></tr>';
      if (pagination && activeView === "vagas") pagination.innerHTML = "";

      apiGet("/api/vagas")
        .then(payload => {
          pageLoadingState.vagas = false;
          vagasBaseRows = payload.rows || [];
          allRows = vagasBaseRows;
          if (payload.indicadores) {
            indicadoresResumoBase = payload.indicadores;
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

    function carregarAlertasEmSegundoPlano(forcar) {
      if (pageLoadingState.alertas) return;
      if (pageLoadState.alertas && !forcar) return;
      pageLoadingState.alertas = true;

      apiGet("/api/alertas")
        .then(payload => {
          pageLoadingState.alertas = false;
          alertasBaseRows = payload.rows || [];
          observacoesAlertas = payload.observacoes || {};
          pageLoadState.alertas = true;
          renderAlertasKpis(filtrarRowsBase(alertasBaseRows));
          renderAlertasDaPagina();
        })
        .catch(error => {
          pageLoadingState.alertas = false;
          console.error("Falha ao carregar a aba Alertas:", error);
          renderAlertasErro(error);
        });
    }

    function carregarRemanejamentoListaEmSegundoPlano(forcar) {
      if (pageLoadingState.remanejamentoLista) return;
      if (pageLoadState.remanejamentoLista && !forcar) return;
      pageLoadingState.remanejamentoLista = true;

      apiGet("/api/remanejamento/lista")
        .then(payload => {
          pageLoadingState.remanejamentoLista = false;
          remanejamentoListaRows = payload.rows || [];
          pageLoadState.remanejamentoLista = true;
          renderRemanejamentoLista();
        })
        .catch(error => {
          pageLoadingState.remanejamentoLista = false;
          console.error("Falha ao carregar a lista de remanejamento:", error);
          renderRemanejamentoListaErro(error);
        });
    }

    function carregarRemanejamentoCadastroEmSegundoPlano(forcar) {
      if (pageLoadingState.remanejamentoCadastro) return;
      if (pageLoadState.remanejamentoCadastro && !forcar) return;
      pageLoadingState.remanejamentoCadastro = true;

      apiGet("/api/remanejamento/cadastro")
        .then(payload => {
          pageLoadingState.remanejamentoCadastro = false;
          remanejamentoCadastroRows = payload.rows || [];
          pageLoadState.remanejamentoCadastro = true;
          configurarRemanejamento();
        })
        .catch(error => {
          pageLoadingState.remanejamentoCadastro = false;
          console.error("Falha ao carregar dados do formulário de remanejamento:", error);
        });
    }

    function filtrarRowsBase(rows) {
      const dseis = getSelectedValues("fDsei");
      const cargos = getSelectedValues("fCargo");

      return (rows || []).filter(row => {
        if (!matchMulti(row.dseiCasai, dseis)) return false;
        if (!matchMulti(row.cargo, cargos)) return false;
        if (!filtrarGraficoAtivo(row)) return false;
        return true;
      });
    }

    function renderVagasDaPagina() {
      const tbody = document.getElementById("vagasBody");
      const pagination = document.getElementById("vagasPagination");
      const distribuicaoBody = document.getElementById("distribuicaoOciosasBody");
      const processoSeletivoBody = document.getElementById("processoSeletivoBody");

      if (!pageLoadState.vagas) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="9">Carregando dados da aba Vagas...</td></tr>';
        if (distribuicaoBody) distribuicaoBody.innerHTML = '<tr><td colspan="4">Carregando distribuição de vagas ociosas...</td></tr>';
        if (processoSeletivoBody) processoSeletivoBody.innerHTML = '<tr><td colspan="4">Carregando vagas para processo seletivo...</td></tr>';
        if (pagination) pagination.innerHTML = "";
        return;
      }

      vagasRows = montarVagas(filtrarRowsBase(vagasBaseRows));
      renderVagasTable(vagasRows);
      renderDistribuicaoVagasOciosas(vagasRows);
      renderProcessoSeletivo(vagasRows);
    }

    function renderAlertasDaPagina() {
      const tbody = document.getElementById("alertasBody");
      const pagination = document.getElementById("alertasPagination");

      if (!pageLoadState.alertas) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="5">Carregando dados da aba Alertas...</td></tr>';
        if (pagination) pagination.innerHTML = "";
        return;
      }

      const tiposAlertaSelecionados = getSelectedValues("fTipoAlerta");
      alertasRows = montarAlertas(filtrarRowsBase(alertasBaseRows)).filter(row => {
        if (!tiposAlertaSelecionados || !tiposAlertaSelecionados.length) return true;
        return tiposAlertaSelecionados.includes(String(row.tipoValor || ""));
      });

      renderAlertasTable(alertasRows);
    }

    function renderVagasErro(error) {
      const tbody = document.getElementById("vagasBody");
      if (tbody) tbody.innerHTML = `<tr><td colspan="9">Erro ao carregar Vagas: ${escapeHtml(error && error.message ? error.message : String(error))}</td></tr>`;
      const distribuicaoBody = document.getElementById("distribuicaoOciosasBody");
      if (distribuicaoBody) distribuicaoBody.innerHTML = `<tr><td colspan="4">Erro ao carregar distribuição: ${escapeHtml(error && error.message ? error.message : String(error))}</td></tr>`;
      const processoSeletivoBody = document.getElementById("processoSeletivoBody");
      if (processoSeletivoBody) processoSeletivoBody.innerHTML = `<tr><td colspan="4">Erro ao carregar processo seletivo: ${escapeHtml(error && error.message ? error.message : String(error))}</td></tr>`;
    }

    function renderAlertasErro(error) {
      const tbody = document.getElementById("alertasBody");
      if (tbody) tbody.innerHTML = `<tr><td colspan="5">Erro ao carregar Alertas: ${escapeHtml(error && error.message ? error.message : String(error))}</td></tr>`;
    }

    function atualizarModoRolagem(view) {
      const main = document.querySelector(".main");
      if (!main) return;

      // A Visão Geral permanece sem rolagem para preservar o layout executivo em tela única.
      // As demais abas podem rolar verticalmente para acomodar tabelas e conteúdos maiores.
      main.classList.toggle("view-scroll", view !== "visaoGeral");
      main.classList.toggle("view-alertas-active", view === "alertas");
      main.classList.toggle("view-iframe-active", view === "painelSaudeIndigena" || view === "ferias");
      main.classList.toggle("view-remanejamento-active", view === "remanejamento" || view === "remanejamentoFormulario");
    }

    function toggleSidebar(forceState) {
      const app = document.querySelector(".app");
      if (!app) return;

      const shouldCollapse = typeof forceState === "boolean"
        ? forceState
        : !app.classList.contains("sidebar-collapsed");

      app.classList.toggle("sidebar-collapsed", shouldCollapse);

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

    function restaurarEstadoMenuLateral() {
      try {
        const salvo = localStorage.getItem("menuSaudeIndigenaRecolhido");
        if (salvo === "SIM") toggleSidebar(true);
      } catch (e) {
        // Mantém o menu aberto quando não houver permissão de armazenamento local.
      }
    }

    function configurarNavegacao() {
      document.querySelectorAll(".navItem").forEach(item => {
        item.addEventListener("click", () => {
          const view = item.dataset.view;
          if (!view) return;

          activeView = view;

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

    function configurarMultiSelectEstaticos() {
      // Filtros de Tipo de Contratação e Tipo de Alerta removidos da Visão Geral.
    }

    function configurarFechamentoDeMenus() {
      document.addEventListener("click", event => {
        document.querySelectorAll(".multiSelect.open").forEach(el => {
          if (!el.contains(event.target)) {
            el.classList.remove("open");
          }
        });
      });
    }

    function onDataLoaded(payload) {
      payload = payload || {};
      allRows = payload.rows || [];
      vagasBaseRows = allRows;
      pageLoadState.vagas = allRows.length > 0;

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

    function onError(error) {
      document.getElementById("loading").style.display = "none";

      const box = document.getElementById("errorBox");
      box.style.display = "block";
      box.innerText = error && error.message ? error.message : String(error);
    }

    function criarMultiSelect(id, options, placeholder) {
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

    function filtrarOpcoesMultiSelect(cfg, termo) {
      const container = document.getElementById(cfg.id);
      if (!container) return;

      const busca = normalizarTextoPainel(termo || "");
      container.querySelectorAll(".multiSelectOption").forEach(option => {
        const texto = normalizarTextoPainel(option.innerText || "");
        option.style.display = !busca || texto.includes(busca) ? "grid" : "none";
      });
    }

    function sincronizarCheckboxes(cfg) {
      const container = document.getElementById(cfg.id);
      if (!container) return;

      container.querySelectorAll(".multiSelectOptions input").forEach(input => {
        input.checked = cfg.selected.has(input.value);
      });
    }

    function atualizarResumoMultiSelect(cfg) {
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

    function getSelectedValues(id) {
      const cfg = filterConfigs[id];
      if (!cfg) return [];
      return Array.from(cfg.selected || []);
    }

    function limparFiltros() {
      activeChartFilter = null;

      Object.values(filterConfigs).forEach(cfg => {
        cfg.selected = new Set();
        sincronizarCheckboxes(cfg);
        atualizarResumoMultiSelect(cfg);
      });

      aplicarFiltros();
    }

    function aplicarFiltros() {
      if (allRows && allRows.length) {
        filteredRows = filtrarRowsBase(allRows);

        vagasCurrentPage = 1;
        alertasCurrentPage = 1;
        renderTudo();
        return;
      }

      // Enquanto a base completa não foi carregada, mantém a Visão Geral resumida
      // e aplica filtros apenas nas páginas que já possuem base própria carregada.
      vagasCurrentPage = 1;
      alertasCurrentPage = 1;

      if (pageLoadState.alertas) {
        renderAlertasKpis(filtrarRowsBase(alertasBaseRows));
        renderAlertasDaPagina();
      }

      if (pageLoadState.vagas) {
        renderVagasDaPagina();
      }
    }

    function matchMulti(value, selectedValues) {
      if (!selectedValues || !selectedValues.length) return true;
      return selectedValues.includes(String(value || ""));
    }

    function filtrarTipoContratacao(row, tipos) {
      if (!tipos || !tipos.length) return true;

      return tipos.some(tipo => {
        if (tipo === "NORMAL") return Number(row.contratadosNormal || 0) > 0;
        if (tipo === "SUBSTITUICAO") return Number(row.contratadosSubstituicao || 0) > 0;
        if (tipo === "TEMPORARIO") return Number(row.contratadosTemporario || 0) > 0;
        return true;
      });
    }

    function filtrarTipoAlerta(row, alertas) {
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


    function filtrarGraficoAtivo(row) {
      if (!activeChartFilter) return true;

      if (activeChartFilter.type === "cargo") {
        return String(row.cargo || "") === String(activeChartFilter.value || "");
      }

      if (activeChartFilter.type === "tipo") {
        if (activeChartFilter.value === "NORMAL") return Number(row.contratadosNormal || 0) > 0;
        if (activeChartFilter.value === "SUBSTITUICAO") return Number(row.contratadosSubstituicao || 0) > 0;
        if (activeChartFilter.value === "TEMPORARIO") return Number(row.contratadosTemporario || 0) > 0;
      }

      return true;
    }

    function alternarFiltroGrafico(type, value) {
      if (activeChartFilter && activeChartFilter.type === type && activeChartFilter.value === value) {
        activeChartFilter = null;
      } else {
        activeChartFilter = { type, value };
      }

      aplicarFiltros();
    }

    function renderTudo() {
      renderKpis(filteredRows);
      renderGraficos(filteredRows);
      renderResumosExecutivos(filteredRows);

      const alertasKpiBase = pageLoadState.alertas ? filtrarRowsBase(alertasBaseRows) : filteredRows;
      renderAlertasKpis(alertasKpiBase);

      if (activeView === "vagas" || pageLoadState.vagas) {
        renderVagasDaPagina();
      }

      if (activeView === "alertas" || pageLoadState.alertas) {
        renderAlertasDaPagina();
      }
    }

    function haFiltrosAtivos() {
      return Object.values(filterConfigs).some(cfg => cfg && cfg.selected && cfg.selected.size > 0);
    }

    function deveUsarIndicadoresResumoBase() {
      return !activeChartFilter && !haFiltrosAtivos();
    }

    function calcularIndicadores(data) {
      const vagasPrevistas = soma(data, "quantitativoPlano");
      const contratadosCalculados = soma(data, "totalContratados");
      const afastados = soma(data, "afastados");
      const substituicoes = soma(data, "contratadosSubstituicao");
      const temporarios = soma(data, "contratadosTemporario");

      const contratados = deveUsarIndicadoresResumoBase() && indicadoresResumoBase
        ? Number(indicadoresResumoBase.contratados || 0)
        : contratadosCalculados;
      // Vagas ociosas (déficit operacional) = previstas - contratados + afastados.
      // Considera os negativos (excedente) abatendo — vale para todos os KPIs.
      const vagasOciosas = vagasPrevistas - contratados + afastados;
      // Vagas preenchidas = trabalhadores contratados (dado correto).
      const vagasPreenchidas = contratados;
      const vagasPreenchidasPerc = vagasPrevistas > 0
        ? (vagasPreenchidas / vagasPrevistas) * 100
        : 0;

      const coberturaAfastamentos = afastados > 0
        ? (substituicoes / afastados) * 100
        : 0;

      return {
        vagasPrevistas,
        contratados,
        afastados,
        substituicoes,
        temporarios,
        vagasOciosas,
        vagasPreenchidas,
        vagasPreenchidasPerc,
        coberturaAfastamentos,
        indigenas: soma(data, "contratadosIndigenas"),
        percentualIndigenas: part(soma(data, "contratadosIndigenas"), contratados)
      };
    }

    function renderKpis(data) {
      const indicadores = calcularIndicadores(data);

      preencherKpiBloco("kpi", indicadores);
      preencherKpiBloco("vagasKpi", indicadores);
    }

    function preencherKpiBloco(prefixo, indicadores) {
      setText(`${prefixo}VagasPrevistas`, formatNumber(indicadores.vagasPrevistas));
      setText(`${prefixo}Contratados`, formatNumber(indicadores.contratados));
      setText(`${prefixo}Ociosas`, formatNumber(indicadores.vagasOciosas));
      setText(`${prefixo}PreenchidasPerc`, formatPercent(indicadores.vagasPreenchidasPerc));
      setText(`${prefixo}PreenchidasSub`, `${formatNumber(indicadores.vagasPreenchidas)} de ${formatNumber(indicadores.vagasPrevistas)} vagas preenchidas`);
      setText(`${prefixo}Afastados`, formatNumber(indicadores.afastados));
      setText(`${prefixo}Substituicoes`, formatNumber(indicadores.substituicoes));
      setText(`${prefixo}Temporarios`, formatNumber(indicadores.temporarios));
      setText(`${prefixo}Cobertura`, formatPercent(indicadores.coberturaAfastamentos));
      setText(`${prefixo}CoberturaSub`, `${formatNumber(indicadores.substituicoes)} de ${formatNumber(indicadores.afastados)} afastamentos cobertos`);
    }

    function renderGraficos(data) {
      const indicadores = calcularIndicadores(data);

      const topCategorias = topAgrupadoCalculado(data, "dseiCasai", row => Number(row.quantitativoPlano || 0), 5);
      renderFunnel("chartCategoria", {
        items: topCategorias.map(i => ({
          label: i.label,
          value: i.value,
          color: COLORS.blue
        })),
        filterType: "dsei"
      });

      const preenchidas = Math.max(0, Number(indicadores.vagasPreenchidas || 0));
      const ociosas = Math.max(0, Number(indicadores.vagasOciosas || 0));
      renderProgressBarResumo({
        preenchidas,
        ociosas,
        vagasPrevistas: indicadores.vagasPrevistas,
        percentual: indicadores.vagasPreenchidasPerc
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

      const normal = soma(data, "contratadosNormal");
      const substituicao = soma(data, "contratadosSubstituicao");
      const temporario = soma(data, "contratadosTemporario");
      const totalContratacao = normal + substituicao + temporario;
      renderDoughnut("chartTipo", {
        labels: ["Normal", "Substituição", "Temporário"],
        values: [normal, substituicao, temporario],
        colors: [COLORS.blue, COLORS.orange, COLORS.green],
        center: formatNumber(totalContratacao),
        centerSub: "TOTAL",
        filterType: "tipo",
        filterValues: ["NORMAL", "SUBSTITUICAO", "TEMPORARIO"]
      });
      renderLegend("legendTipo", [
        ["Normal", normal, COLORS.blue, part(normal, totalContratacao)],
        ["Substituição", substituicao, COLORS.orange, part(substituicao, totalContratacao)],
        ["Temporário", temporario, COLORS.green, part(temporario, totalContratacao)]
      ]);

      const topDseiOciosas = topAgrupadoCalculado(data, "dseiCasai", row => calcularOciosas(row), 5);
      renderTreemap("chartTopDseiOciosas", {
        items: topDseiOciosas.map(i => ({
          label: i.label,
          value: i.value
        })),
        color: COLORS.orange,
        filterType: "dsei"
      });

      const topCargoOciosas = topAgrupadoCalculado(data, "cargo", row => calcularOciosas(row), 5);
      renderBar("chartTopCargoOciosas", {
        labels: topCargoOciosas.map(i => i.label),
        values: topCargoOciosas.map(i => i.value),
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

      const cobertos = Math.min(Math.max(0, indicadores.substituicoes), Math.max(0, indicadores.afastados));
      const naoCobertos = Math.max(0, indicadores.afastados - cobertos);
      renderDoughnut("chartCoberturaAfastamentos", {
        labels: ["Afastamentos cobertos", "Afastamentos sem cobertura"],
        values: [cobertos, naoCobertos],
        colors: [COLORS.blue, COLORS.orange],
        center: formatPercent(indicadores.coberturaAfastamentos),
        centerSub: "COBERTURA",
        datalabelMin: 18,
        datalabelFontSize: 8,
        centerFontSize: 26,
        centerSubFontSize: 8
      });
      renderLegend("legendCoberturaAfastamentos", [
        ["Cobertos", cobertos, COLORS.blue, part(cobertos, indicadores.afastados)],
        ["Sem cobertura", naoCobertos, COLORS.orange, part(naoCobertos, indicadores.afastados)]
      ]);

    }


    function renderRankingBars(containerId, items, color, filterType) {
      const container = document.getElementById(containerId);
      if (!container) return;

      const lista = (items || []).filter(item => Number(item.value || 0) > 0);
      const max = Math.max(...lista.map(item => Number(item.value || 0)), 1);

      if (!lista.length) {
        container.innerHTML = '<div class="emptyState">Sem dados para os filtros selecionados.</div>';
        return;
      }

      container.innerHTML = lista.map(item => {
        const valor = Number(item.value || 0);
        const largura = Math.max(4, (valor / max) * 100);
        const label = escapeHtml(item.label || '');
        const safeValue = escapeHtml(String(item.label || ''));
        return `
          <button type="button" class="rankingRow" title="${label}" onclick="alternarFiltroGrafico('${filterType}', '${safeValue.replace(/'/g, "\'")}')">
            <span class="rankingLabel">${label}</span>
            <span class="rankingTrack"><span class="rankingFill" style="width:${largura}%; background:${color};"></span></span>
            <strong class="rankingValue">${formatNumber(valor)}</strong>
          </button>
        `;
      }).join('');
    }

    function renderProgressBarResumo(cfg) {
      const fill = document.getElementById("preenchimentoBarFill");
      if (fill) {
        fill.style.width = `${Math.max(0, Math.min(100, Number(cfg.percentual || 0)))}%`;
      }

      setText("preenchimentoBarPercentual", formatPercent(cfg.percentual || 0));
      setText("preenchimentoBarTexto", `${formatNumber(cfg.preenchidas || 0)} de ${formatNumber(cfg.vagasPrevistas || 0)} vagas preenchidas`);
      setText("preenchimentoBarOciosas", `${formatNumber(cfg.ociosas || 0)} vagas ociosas`);
    }

    function renderFunnel(containerId, cfg) {
      const container = document.getElementById(containerId);
      if (!container) return;

      const items = (cfg.items || [])
        .filter(item => Number(item.value || 0) > 0)
        .sort((a, b) => Number(b.value || 0) - Number(a.value || 0));

      if (!items.length) {
        container.innerHTML = '<div class="emptyState">Sem dados para os filtros selecionados.</div>';
        return;
      }

      container.innerHTML = items.map((item, index) => {
        const width = Math.max(50, 100 - (index * 11));
        const opacity = Math.max(.54, 1 - (index * .09));
        const safeLabel = escapeHtml(item.label || "");
        const safeRaw = String(item.label || "").replace(/'/g, "\\'");

        return `
          <button type="button" class="funnelStep" title="${safeLabel}" onclick="alternarFiltroGrafico('${cfg.filterType || ""}', '${safeRaw}')">
            <span class="funnelStepShape" style="width:${width}%; background:${item.color || COLORS.blue}; opacity:${opacity};"></span>
            <span class="funnelStepLabel">${safeLabel}</span>
            <strong class="funnelStepValue">${formatNumber(item.value)}</strong>
          </button>
        `;
      }).join("");
    }

    function renderTreemap(containerId, cfg) {
      const container = document.getElementById(containerId);
      if (!container) return;

      const items = (cfg.items || [])
        .filter(item => Number(item.value || 0) > 0)
        .sort((a, b) => Number(b.value || 0) - Number(a.value || 0));

      if (!items.length) {
        container.innerHTML = '<div class="emptyState">Sem dados para os filtros selecionados.</div>';
        return;
      }

      const total = items.reduce((acc, item) => acc + Number(item.value || 0), 0) || 1;
      container.innerHTML = items.map((item, index) => {
        const basis = Math.max(16, (Number(item.value || 0) / total) * 100);
        const tone = 0.92 - (index * 0.12);
        const safeLabel = escapeHtml(item.label || "");
        const safeRaw = String(item.label || "").replace(/'/g, "\\'");

        return `
          <button type="button" class="treemapNode" style="flex-basis:${basis}%; background:linear-gradient(135deg, rgba(246,178,50,${tone}), rgba(255,133,0,${Math.max(.32, tone - .18)}));" title="${safeLabel}" onclick="alternarFiltroGrafico('${cfg.filterType || ""}', '${safeRaw}')">
            <span class="treemapLabel">${safeLabel}</span>
            <strong class="treemapValue">${formatNumber(item.value)}</strong>
          </button>
        `;
      }).join("");
    }

    function escapeHtml(valor) {
      return String(valor || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function renderDoughnut(canvasId, cfg) {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;

      if (charts[canvasId]) {
        charts[canvasId].destroy();
      }

      charts[canvasId] = new Chart(canvas, {
        type: "doughnut",
        data: {
          labels: cfg.labels,
          datasets: [{
            data: cfg.values,
            backgroundColor: cfg.colors,
            borderColor: "#ffffff",
            borderWidth: 3,
            hoverOffset: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: "60%",
          onClick: function(event, elements) {
            if (!elements || !elements.length) return;
            const index = elements[0].index;
            if (cfg.filterType && cfg.filterValues) {
              alternarFiltroGrafico(cfg.filterType, cfg.filterValues[index]);
            }
          },
          layout: { padding: 8 },
          plugins: {
            legend: { display: false },
            datalabels: {
              display: function(context) {
                const values = context.chart.data.datasets[0].data || [];
                const value = Number(values[context.dataIndex] || 0);
                const total = values.reduce((acc, item) => acc + Number(item || 0), 0);
                const pct = total > 0 ? (value / total) * 100 : 0;
                return pct >= (cfg.datalabelMin || 8);
              },
              color: "#ffffff",
              font: { size: cfg.datalabelFontSize || 11, weight: "900" },
              formatter: function(value, context) {
                const values = context.chart.data.datasets[0].data || [];
                const total = values.reduce((acc, item) => acc + Number(item || 0), 0);
                const pct = total > 0 ? (Number(value || 0) / total) * 100 : 0;
                return formatPercent(pct);
              },
              clip: true
            },
            tooltip: {
              callbacks: {
                label: function(ctx) {
                  const total = ctx.dataset.data.reduce((acc, item) => acc + Number(item || 0), 0);
                  const pct = total > 0 ? (Number(ctx.raw || 0) / total) * 100 : 0;
                  return `${ctx.label}: ${formatNumber(ctx.raw)} (${formatPercent(pct)})`;
                }
              }
            }
          }
        },
        plugins: [centerTextPlugin(cfg.center, cfg.centerSub, cfg.centerFontSize, cfg.centerSubFontSize)]
      });
    }

    function renderBar(canvasId, cfg) {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;

      if (charts[canvasId]) {
        charts[canvasId].destroy();
      }

      const labelsOriginais = cfg.labels || [];
      const labelsGrafico = cfg.wrapLabels
        ? labelsOriginais.map(label => quebrarLabelGrafico(label, cfg.maxCharsPerLine || 18, cfg.maxLines || 2))
        : labelsOriginais;

      charts[canvasId] = new Chart(canvas, {
        type: "bar",
        data: {
          labels: labelsGrafico,
          datasets: [{
            data: cfg.values,
            backgroundColor: cfg.color,
            borderRadius: 7,
            barPercentage: cfg.barPercentage || .70,
            categoryPercentage: cfg.categoryPercentage || .70
          }]
        },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          onClick: function(event, elements) {
            if (!elements || !elements.length) return;
            const index = elements[0].index;
            if (cfg.filterType && cfg.filterValues) {
              alternarFiltroGrafico(cfg.filterType, cfg.filterValues[index]);
            }
          },
          layout: {
            padding: { right: cfg.rightPadding ?? 44, left: cfg.leftPadding ?? 0, top: cfg.topPadding ?? 4, bottom: cfg.bottomPadding ?? 2 }
          },
          plugins: {
            legend: { display: false },
            datalabels: {
              anchor: "end",
              align: "right",
              color: "#07346b",
              font: { size: cfg.dataLabelFontSize || 12, weight: "900" },
              formatter: value => formatNumber(value),
              clip: false
            },
            tooltip: {
              callbacks: {
                title: function(items) {
                  if (!items || !items.length) return "";
                  return labelsOriginais[items[0].dataIndex] || "";
                },
                label: ctx => formatNumber(ctx.raw)
              }
            }
          },
          scales: {
            x: {
              beginAtZero: true,
              grid: { color: "rgba(0, 83, 166, .12)" },
              ticks: {
                color: "rgba(7, 52, 107, .72)",
                font: { size: cfg.xTickFontSize || 10.5, weight: "700" }
              }
            },
            y: {
              afterFit: function(scale) {
                if (cfg.yAxisWidth) {
                  const larguraGrafico = scale && scale.chart ? Number(scale.chart.width || 0) : 0;
                  const larguraMaxima = larguraGrafico > 0 ? Math.max(120, larguraGrafico * 0.56) : cfg.yAxisWidth;
                  scale.width = Math.min(cfg.yAxisWidth, larguraMaxima);
                }
              },
              grid: { display: false },
              ticks: {
                autoSkip: false,
                color: "#07346b",
                padding: 4,
                font: { size: cfg.labelFontSize || 11, weight: "900" }
              }
            }
          }
        }
      });
    }

    function quebrarLabelGrafico(label, maxChars, maxLines) {
      const texto = String(label || "").trim();
      if (!texto) return "";

      const palavras = texto.split(/\s+/);
      const linhas = [];
      let linha = "";

      palavras.forEach(palavra => {
        const teste = linha ? `${linha} ${palavra}` : palavra;
        if (teste.length <= maxChars || !linha) {
          linha = teste;
        } else {
          linhas.push(linha);
          linha = palavra;
        }
      });

      if (linha) linhas.push(linha);

      if (linhas.length <= maxLines) return linhas;

      const reduzidas = linhas.slice(0, maxLines);
      reduzidas[maxLines - 1] = reduzidas[maxLines - 1].replace(/\s+$/g, "") + "…";
      return reduzidas;
    }

    function limitarLabelGrafico(label, limite) {
      const texto = String(label || "");
      const max = limite || 14;
      if (texto.length <= max) return texto;
      return texto.slice(0, max - 1).trim() + "…";
    }

    function renderColumn(canvasId, cfg) {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;

      if (charts[canvasId]) {
        charts[canvasId].destroy();
      }

      const labelsOriginais = cfg.labels || [];
      const labelsCurtos = labelsOriginais.map(label => limitarLabelGrafico(label, cfg.maxLabelLength || 14));

      charts[canvasId] = new Chart(canvas, {
        type: "bar",
        data: {
          labels: labelsCurtos,
          datasets: [{
            data: cfg.values,
            backgroundColor: cfg.color,
            borderRadius: 8,
            barPercentage: .62,
            categoryPercentage: .74
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          onClick: function(event, elements) {
            if (!elements || !elements.length) return;
            const index = elements[0].index;
            if (cfg.filterType && cfg.filterValues) {
              alternarFiltroGrafico(cfg.filterType, cfg.filterValues[index]);
            }
          },
          layout: {
            padding: { top: 20, right: 10, bottom: 8, left: 8 }
          },
          plugins: {
            legend: { display: false },
            datalabels: {
              anchor: "end",
              align: "top",
              offset: 2,
              color: "#07346b",
              font: { size: 11, weight: "900" },
              formatter: value => formatNumber(value),
              clip: false
            },
            tooltip: {
              callbacks: {
                title: function(items) {
                  if (!items || !items.length) return "";
                  return labelsOriginais[items[0].dataIndex] || "";
                },
                label: ctx => formatNumber(ctx.raw)
              }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              grid: { color: "rgba(0, 83, 166, .12)" },
              ticks: {
                color: "rgba(7, 52, 107, .72)",
                font: { size: 10, weight: "800" }
              }
            },
            x: {
              grid: { display: false },
              ticks: {
                color: "#07346b",
                font: { size: 9.5, weight: "900" },
                maxRotation: 0,
                minRotation: 0
              }
            }
          }
        }
      });
    }

    function centerTextPlugin(text, subtext, fontSize, subFontSize) {
      return {
        id: "centerText" + Math.random().toString(36).slice(2),
        beforeDraw(chart) {
          const area = chart.chartArea;
          if (!area) return;

          const ctx = chart.ctx;
          const centerX = (area.left + area.right) / 2;
          const centerY = (area.top + area.bottom) / 2;

          ctx.save();
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";

          ctx.fillStyle = "#07346b";
          ctx.font = `900 ${fontSize || 25}px Arial`;
          ctx.fillText(text || "0", centerX, subtext ? centerY - 6 : centerY);

          if (subtext) {
            ctx.fillStyle = "rgba(7, 52, 107, .72)";
            ctx.font = `900 ${subFontSize || 9}px Arial`;
            ctx.fillText(subtext, centerX, centerY + 18);
          }

          ctx.restore();
        }
      };
    }

    function renderLegend(containerId, items) {
      const el = document.getElementById(containerId);
      if (!el) return;

      el.innerHTML = items.map(([label, value, color, pct]) => `
        <div class="legendItem">
          <span class="dot" style="background:${color};"></span>
          <div>
            <span>${escapeHtml(label)}</span>
            <strong>${formatNumber(value)} (${formatPercent(pct)})</strong>
          </div>
        </div>
      `).join("");
    }

    function renderResumosExecutivos(data) {
      const indicadores = calcularIndicadores(data);
      setText("resumoCoberturaPercentual", formatPercent(indicadores.coberturaAfastamentos));
      setText("resumoCoberturaSubstituicoes", formatNumber(indicadores.substituicoes));
      setText("resumoCoberturaAfastados", formatNumber(indicadores.afastados));
      setText(
        "resumoCoberturaTexto",
        `${formatNumber(indicadores.substituicoes)} de ${formatNumber(indicadores.afastados)} afastamentos cobertos.`
      );
    }

    function renderTabelasDetalhadas() {
      renderVagasDaPagina();
      renderAlertasDaPagina();
    }

    function montarVagas(data) {
      return [...data]
        .map(row => {
          const ociosas = calcularOciosas(row);
          const preenchimento = calcularPreenchimento(row.quantitativoPlano, ociosas);
          // Valores das tabelas de distribuição/processo seletivo calculados POR LINHA
          // (negativos já zerados). São somados na agregação, então o total independe
          // de a visão ser por DSEI ou por Cargo.
          const dist = montarLinhaDistribuicaoBase({ ...row, ociosas });
          return {
            ...row,
            ociosas,
            preenchimento,
            distOciosas: dist.vagasOciosas,
            distSubstituicao: dist.substituicaoTabela,
            distNormalTemp: dist.normalTemporario,
            distTemporario: dist.contratadosTemporario,
            distProcessoSeletivo: dist.processoSeletivo
          };
        })
        .filter(row => !linhaVagasZerada(row))
        .sort((a, b) => {
          const d = String(a.dseiCasai || "").localeCompare(String(b.dseiCasai || ""));
          if (d !== 0) return d;

          return String(a.cargo || "").localeCompare(String(b.cargo || ""));
        });
    }

    function alterarVisualizacaoVagas(view) {
      vagasViewAtual = view || "dsei";
      vagasSortState = { key: vagasViewAtual === "detalhado" ? "dseiCasai" : "label", direction: "asc" };
      vagasCurrentPage = 1;
      renderVagasDaPagina();
    }

    // Configuração de cada tabela da aba Vagas: título, subtítulo, botões de exportar e aviso.
    const VAGAS_TABELA_CONFIG = {
      vagas: {
        bloco: "blocoTabelaVagas",
        titulo: "Vagas",
        subtitulo: "Detalhamento por DSEI/CASAI e cargo conforme filtros selecionados.",
        exportHtml: '<button type="button" class="exportBtn" onclick="exportarVagas()">Exportar base filtrada</button><button type="button" class="exportBtn" onclick="exportarPdf()">Salvar em PDF</button>',
        avisoHtml: ""
      },
      ociosas: {
        bloco: "blocoTabelaOciosas",
        titulo: "Distribuição das Vagas Ociosas",
        subtitulo: "Vagas não ocupadas, afastamento sem substituição e o total de vagas ociosas, conforme a visualização atual.",
        exportHtml: '<button type="button" class="exportBtn" onclick="exportarDistribuicaoVagasOciosas()">Exportar distribuição</button>',
        avisoHtml: ""
      },
      processo: {
        bloco: "blocoTabelaProcesso",
        titulo: "Vagas para Processo Seletivo",
        subtitulo: "Vagas não ocupadas somadas às temporárias (total para processo seletivo).",
        exportHtml: '<button type="button" class="exportBtn" onclick="exportarProcessoSeletivo()">Exportar processo seletivo</button>',
        avisoHtml: '<div class="processoSeletivoAviso">⚠ Não entram no cálculo do processo seletivo os cargos de provimento comunitário/indicação: <strong>Agente Indígena de Saúde</strong>, <strong>Agente Indígena de Saneamento</strong>, <strong>Assessor Técnico Indígena</strong> e <strong>Secretário do CONDISI</strong>.</div>'
      }
    };

    // Alterna entre as três tabelas da aba Vagas (menu superior). As três continuam
    // renderizadas; só a selecionada fica visível, e o cabeçalho/aviso/exportar mudam junto.
    function alterarTabelaVagas(tabela) {
      vagasTabelaAtual = VAGAS_TABELA_CONFIG[tabela] ? tabela : "vagas";
      const cfg = VAGAS_TABELA_CONFIG[vagasTabelaAtual];

      document.querySelectorAll(".vagasTabelaTab").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.vagasTabela === vagasTabelaAtual);
      });

      Object.keys(VAGAS_TABELA_CONFIG).forEach(chave => {
        const el = document.getElementById(VAGAS_TABELA_CONFIG[chave].bloco);
        if (el) el.hidden = chave !== vagasTabelaAtual;
      });

      setText("vagasTituloDinamico", cfg.titulo);
      setText("vagasSubtituloDinamico", cfg.subtitulo);
      const exp = document.getElementById("vagasExportActions");
      if (exp) exp.innerHTML = cfg.exportHtml;
      const aviso = document.getElementById("vagasAvisoDinamico");
      if (aviso) aviso.innerHTML = cfg.avisoHtml;
    }

    function atualizarPesquisaVagas(valor) {
      vagasSearchTerm = String(valor || "").trim().toUpperCase();
      vagasCurrentPage = 1;
      renderVagasDaPagina();
    }

    function ordenarTabelaVagas(key) {
      if (!key) return;
      if (vagasSortState.key === key) {
        vagasSortState.direction = vagasSortState.direction === "asc" ? "desc" : "asc";
      } else {
        vagasSortState = { key, direction: "asc" };
      }
      renderVagasDaPagina();
    }

    function obterRowsVagasPorVisualizacao(rows) {
      let linhas;

      if (vagasViewAtual === "dsei") {
        linhas = montarVagasAgrupadas(rows, "dseiCasai", "DSEI/CASAI");
      } else if (vagasViewAtual === "cargo") {
        linhas = montarVagasAgrupadas(rows, "cargo", "Cargo");
      } else {
        linhas = rows;
      }

      linhas = filtrarPesquisaVagas(linhas);
      return ordenarLinhasVagas(linhas);
    }

    function montarVagasAgrupadas(rows, campo, labelCampo) {
      const mapa = new Map();

      rows.forEach(row => {
        const label = row[campo] || "Não informado";

        if (!mapa.has(label)) {
          mapa.set(label, {
            label,
            labelCampo,
            quantitativoPlano: 0,
            totalContratados: 0,
            afastados: 0,
            ociosas: 0,
            contratadosSubstituicao: 0,
            contratadosTemporario: 0,
            preenchimento: 0,
            distOciosas: 0,
            distSubstituicao: 0,
            distNormalTemp: 0,
            distTemporario: 0,
            distProcessoSeletivo: 0
          });
        }

        const item = mapa.get(label);
        item.quantitativoPlano += Number(row.quantitativoPlano || 0);
        item.totalContratados += Number(row.totalContratados || 0);
        item.afastados += Number(row.afastados || 0);
        item.ociosas += Number(row.ociosas || 0);
        item.contratadosSubstituicao += Number(row.contratadosSubstituicao || 0);
        item.contratadosTemporario += Number(row.contratadosTemporario || 0);
        // Soma dos valores derivados por linha (já clampados) — total independe da visão.
        item.distOciosas += Number(row.distOciosas || 0);
        item.distSubstituicao += Number(row.distSubstituicao || 0);
        item.distNormalTemp += Number(row.distNormalTemp || 0);
        item.distTemporario += Number(row.distTemporario || 0);
        item.distProcessoSeletivo += Number(row.distProcessoSeletivo || 0);
      });

      return [...mapa.values()]
        .map(item => ({
          ...item,
          preenchimento: calcularPreenchimento(item.quantitativoPlano, item.ociosas)
        }))
        .sort((a, b) => String(a.label || "").localeCompare(String(b.label || "")));
    }

    function atualizarCabecalhoVagas() {
      const header = document.getElementById("vagasHeaderRow");
      const colgroup = document.getElementById("vagasColGroup");

      document.querySelectorAll(".vagasTab").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.vagasView === vagasViewAtual);
      });

      if (!header || !colgroup) return;

      const th = (label, key) => {
        const ativo = vagasSortState.key === key;
        const classe = ativo ? (vagasSortState.direction === "asc" ? "sortAsc" : "sortDesc") : "";
        const extraClasse = key === "ociosas" ? " colOciosasHead" : "";
        return `<th class="sortable ${classe}${extraClasse}" onclick="ordenarTabelaVagas('${key}')">${label}</th>`;
      };

      if (vagasViewAtual === "detalhado") {
        colgroup.innerHTML = `
          <col style="width: 14%;">
          <col style="width: 20%;">
          <col style="width: 9%;">
          <col style="width: 11%;">
          <col style="width: 8%;">
          <col style="width: 12%;">
          <col style="width: 9%;">
          <col style="width: 9%;">
          <col style="width: 8%;">
        `;

        header.innerHTML = `
          ${th("DSEI/CASAI", "dseiCasai")}
          ${th("Cargo", "cargo")}
          ${th("Vagas previstas", "quantitativoPlano")}
          ${th("Total de Contratados", "totalContratados")}
          ${th("Afastados", "afastados")}
          ${th("Vagas Ociosas (Déficit Operacional)", "ociosas")}
          ${th("Substituições", "contratadosSubstituicao")}
          ${th("Temporárias", "contratadosTemporario")}
          ${th("% preenchimento", "preenchimento")}
        `;
        return;
      }

      const primeiraColuna = vagasViewAtual === "dsei" ? "DSEI/CASAI" : "Cargo";

      colgroup.innerHTML = `
        <col style="width: 25%;">
        <col style="width: 11%;">
        <col style="width: 13%;">
        <col style="width: 9%;">
        <col style="width: 14%;">
        <col style="width: 10%;">
        <col style="width: 10%;">
        <col style="width: 8%;">
      `;

      header.innerHTML = `
        ${th(primeiraColuna, "label")}
        ${th("Vagas previstas", "quantitativoPlano")}
        ${th("Total de Contratados", "totalContratados")}
        ${th("Afastados", "afastados")}
        ${th("Vagas Ociosas (Déficit Operacional)", "ociosas")}
        ${th("Substituições", "contratadosSubstituicao")}
        ${th("Temporárias", "contratadosTemporario")}
        ${th("% preenchimento", "preenchimento")}
      `;
    }

    function renderVagasTable(rows) {
      const tbody = document.getElementById("vagasBody");
      const pagination = document.getElementById("vagasPagination");
      if (!tbody) return;

      atualizarCabecalhoVagas();

      const linhas = obterRowsVagasPorVisualizacao(rows);
      const totalColunas = vagasViewAtual === "detalhado" ? 9 : 8;

      if (!linhas.length) {
        tbody.innerHTML = `<tr><td colspan="${totalColunas}">Sem dados para os filtros selecionados.</td></tr>`;
        if (pagination) pagination.innerHTML = "";
        return;
      }

      const { linhasPagina, resumoPaginacao } = obterPaginaVagas(linhas);
      const totalRow = calcularTotalVagasTabela(linhasPagina);

      if (vagasViewAtual === "detalhado") {
        tbody.innerHTML = linhasPagina.map(row => `
          <tr>
            <td>${escapeHtml(row.dseiCasai)}</td>
            <td>${escapeHtml(row.cargo)}</td>
            <td>${formatNumber(row.quantitativoPlano)}</td>
            <td>${formatNumber(row.totalContratados)}</td>
            <td>${formatNumber(row.afastados)}</td>
            <td class="colOciosas ${Number(row.ociosas || 0) < 0 ? "negativo" : ""}">${formatNumber(row.ociosas)}</td>
            <td>${formatNumber(row.contratadosSubstituicao)}</td>
            <td>${formatNumber(row.contratadosTemporario)}</td>
            <td>${formatPercent(row.preenchimento)}</td>
          </tr>
        `).join("") + `
          <tr class="totalRow">
            <td>TOTAL</td>
            <td>${formatNumber(linhasPagina.length)} registro(s)</td>
            <td>${formatNumber(totalRow.quantitativoPlano)}</td>
            <td>${formatNumber(totalRow.totalContratados)}</td>
            <td>${formatNumber(totalRow.afastados)}</td>
            <td class="colOciosas ${Number(totalRow.ociosas || 0) < 0 ? "negativo" : ""}">${formatNumber(totalRow.ociosas)}</td>
            <td>${formatNumber(totalRow.contratadosSubstituicao)}</td>
            <td>${formatNumber(totalRow.contratadosTemporario)}</td>
            <td>${formatPercent(totalRow.preenchimento)}</td>
          </tr>
        `;
      } else {
        tbody.innerHTML = linhasPagina.map(row => `
          <tr>
            <td>${escapeHtml(row.label)}</td>
            <td>${formatNumber(row.quantitativoPlano)}</td>
            <td>${formatNumber(row.totalContratados)}</td>
            <td>${formatNumber(row.afastados)}</td>
            <td class="colOciosas ${Number(row.ociosas || 0) < 0 ? "negativo" : ""}">${formatNumber(row.ociosas)}</td>
            <td>${formatNumber(row.contratadosSubstituicao)}</td>
            <td>${formatNumber(row.contratadosTemporario)}</td>
            <td>${formatPercent(row.preenchimento)}</td>
          </tr>
        `).join("") + `
          <tr class="totalRow">
            <td>TOTAL</td>
            <td>${formatNumber(totalRow.quantitativoPlano)}</td>
            <td>${formatNumber(totalRow.totalContratados)}</td>
            <td>${formatNumber(totalRow.afastados)}</td>
            <td class="colOciosas ${Number(totalRow.ociosas || 0) < 0 ? "negativo" : ""}">${formatNumber(totalRow.ociosas)}</td>
            <td>${formatNumber(totalRow.contratadosSubstituicao)}</td>
            <td>${formatNumber(totalRow.contratadosTemporario)}</td>
            <td>${formatPercent(totalRow.preenchimento)}</td>
          </tr>
        `;
      }

      if (pagination) {
        pagination.innerHTML = resumoPaginacao;
      }
    }

    function calcularTotalVagasTabela(linhas) {
      const total = linhas.reduce((acc, row) => {
        acc.quantitativoPlano += Number(row.quantitativoPlano || 0);
        acc.totalContratados += Number(row.totalContratados || 0);
        acc.afastados += Number(row.afastados || 0);
        acc.ociosas += Number(row.ociosas || 0);
        acc.contratadosSubstituicao += Number(row.contratadosSubstituicao || 0);
        acc.contratadosTemporario += Number(row.contratadosTemporario || 0);
        return acc;
      }, {
        quantitativoPlano: 0,
        totalContratados: 0,
        afastados: 0,
        ociosas: 0,
        contratadosSubstituicao: 0,
        contratadosTemporario: 0,
        preenchimento: 0
      });

      total.preenchimento = calcularPreenchimento(total.quantitativoPlano, total.ociosas);
      return total;
    }

    function atualizarCabecalhoDistribuicaoVagasOciosas() {
      const header = document.getElementById("distribuicaoHeaderRow");
      const colgroup = document.getElementById("distribuicaoColGroup");
      const descricao = document.getElementById("distribuicaoDescricao");
      if (!header || !colgroup) return;

      if (vagasViewAtual === "detalhado") {
        colgroup.innerHTML = `
          <col style="width: 24%;">
          <col style="width: 28%;">
          <col style="width: 16%;">
          <col style="width: 16%;">
          <col style="width: 16%;">
        `;
        header.innerHTML = `
          <th>DSEI/CASAI</th>
          <th>Cargo</th>
          <th>Vagas não ocupadas</th>
          <th>Afastamento sem substituição</th>
          <th>Vagas Ociosas</th>
        `;
        if (descricao) descricao.textContent = "Composição das vagas ociosas por DSEI/CASAI e cargo nos filtros selecionados.";
        return;
      }

      const primeiraColuna = vagasViewAtual === "cargo" ? "Cargo" : "DSEI/CASAI";
      colgroup.innerHTML = `
        <col style="width: 40%;">
        <col style="width: 20%;">
        <col style="width: 20%;">
        <col style="width: 20%;">
      `;
      header.innerHTML = `
        <th>${primeiraColuna}</th>
        <th>Vagas não ocupadas</th>
        <th>Afastamento sem substituição</th>
        <th>Vagas Ociosas</th>
      `;
      if (descricao) {
        descricao.textContent = vagasViewAtual === "cargo"
          ? "Composição das vagas ociosas por cargo nos filtros selecionados."
          : "Composição das vagas ociosas por DSEI/CASAI nos filtros selecionados.";
      }
    }

    // Cargos que NÃO são providos por processo seletivo (comunitários/indicação),
    // portanto ficam de fora da tabela "Vagas para Processo Seletivo".
    const CARGOS_FORA_PROCESSO_SELETIVO = new Set([
      "AGENTE INDIGENA DE SAUDE",
      "AGENTE INDIGENA DE SANEAMENTO",
      "ASSESSOR TECNICO INDIGENA",
      "SECRETARIO DO CONDISI"
    ]);

    function normalizarNomeCargo(cargo) {
      return String(cargo || "")
        .normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
        .toUpperCase().replace(/\s+/g, " ").trim();
    }

    function filtrarCargosProcessoSeletivo(rows) {
      return (rows || []).filter(row => !CARGOS_FORA_PROCESSO_SELETIVO.has(normalizarNomeCargo(row.cargo)));
    }

    function montarLinhaDistribuicaoBase(row) {
      // Zera negativos por linha: um excedente (valor negativo) nunca abate os positivos.
      const afastados = Math.max(0, Number(row.afastados || 0));
      const substituicoesContratadas = Math.max(0, Number(row.contratadosSubstituicao || 0));
      const contratadosTemporario = Math.max(0, Number(row.contratadosTemporario || 0));
      const contratadosNormal = Math.max(0, Number(row.contratadosNormal || 0));
      const quantitativoPlano = Math.max(0, Number(row.quantitativoPlano || 0));

      // Vagas não ocupadas = vagas previstas - (contratados normais + contratados temporários).
      const normalTemporario = Math.max(0, quantitativoPlano - (contratadosNormal + contratadosTemporario));

      // Substituição = afastados ainda não cobertos por substitutos.
      const substituicaoTabela = Math.max(0, afastados - substituicoesContratadas);

      // Vagas Ociosas = soma das duas colunas anteriores (sem negativos abatendo positivos).
      const vagasOciosas = normalTemporario + substituicaoTabela;

      // Total para processo seletivo = Vagas não ocupadas + Temporárias.
      const processoSeletivo = normalTemporario + contratadosTemporario;

      return {
        vagasOciosas,
        substituicaoTabela,
        normalTemporario,
        substituicoesContratadas,
        contratadosTemporario,
        processoSeletivo
      };
    }

    // Extrai os valores derivados (já somados por linha) de uma linha/grupo.
    function valoresDistribuicao(row) {
      return {
        vagasOciosas: Number(row.distOciosas || 0),
        substituicaoTabela: Number(row.distSubstituicao || 0),
        normalTemporario: Number(row.distNormalTemp || 0),
        contratadosTemporario: Number(row.distTemporario || 0),
        processoSeletivo: Number(row.distProcessoSeletivo || 0)
      };
    }

    function montarDistribuicaoVagasOciosas(rows) {
      const linhasBase = obterRowsVagasPorVisualizacao(rows);
      const { linhasPagina } = obterPaginaVagas(linhasBase);

      if (vagasViewAtual === "detalhado") {
        return linhasPagina.map(row => ({
          dseiCasai: row.dseiCasai || "Não informado",
          cargo: row.cargo || "Não informado",
          ...valoresDistribuicao(row)
        }));
      }

      return linhasPagina.map(row => ({
        label: row.label || "Não informado",
        ...valoresDistribuicao(row)
      }));
    }

    function renderDistribuicaoVagasOciosas(rows) {
      const tbody = document.getElementById("distribuicaoOciosasBody");
      if (!tbody) return;

      atualizarCabecalhoDistribuicaoVagasOciosas();
      renderPaginacaoTabela("distribuicaoPagination", rows);
      const linhas = montarDistribuicaoVagasOciosas(rows).filter(item => {
        return Number(item.vagasOciosas || 0) !== 0 ||
          Number(item.substituicaoTabela || 0) !== 0 ||
          Number(item.normalTemporario || 0) !== 0;
      });

      const totalColunas = vagasViewAtual === "detalhado" ? 5 : 4;
      if (!linhas.length) {
        tbody.innerHTML = `<tr><td colspan="${totalColunas}" class="remanejamentoEmpty">Sem dados para os filtros selecionados.</td></tr>`;
        return;
      }

      const total = linhas.reduce((acc, row) => {
        acc.vagasOciosas += Number(row.vagasOciosas || 0);
        acc.substituicaoTabela += Number(row.substituicaoTabela || 0);
        acc.normalTemporario += Number(row.normalTemporario || 0);
        return acc;
      }, { vagasOciosas: 0, substituicaoTabela: 0, normalTemporario: 0 });

      if (vagasViewAtual === "detalhado") {
        tbody.innerHTML = linhas.map(row => `
          <tr>
            <td>${escapeHtml(row.dseiCasai)}</td>
            <td>${escapeHtml(row.cargo)}</td>
            <td>${formatNumber(row.normalTemporario)}</td>
            <td>${formatNumber(row.substituicaoTabela)}</td>
            <td>${formatNumber(row.vagasOciosas)}</td>
          </tr>
        `).join("") + `
          <tr class="totalRow">
            <td colspan="2">TOTAL</td>
            <td>${formatNumber(total.normalTemporario)}</td>
            <td>${formatNumber(total.substituicaoTabela)}</td>
            <td>${formatNumber(total.vagasOciosas)}</td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = linhas.map(row => `
        <tr>
          <td>${escapeHtml(row.label)}</td>
          <td>${formatNumber(row.normalTemporario)}</td>
          <td>${formatNumber(row.substituicaoTabela)}</td>
          <td>${formatNumber(row.vagasOciosas)}</td>
        </tr>
      `).join("") + `
        <tr class="totalRow">
          <td>TOTAL</td>
          <td>${formatNumber(total.normalTemporario)}</td>
          <td>${formatNumber(total.substituicaoTabela)}</td>
          <td>${formatNumber(total.vagasOciosas)}</td>
        </tr>
      `;
    }

    function atualizarCabecalhoProcessoSeletivo() {
      const header = document.getElementById("processoSeletivoHeaderRow");
      const colgroup = document.getElementById("processoSeletivoColGroup");
      const descricao = document.getElementById("processoSeletivoDescricao");
      if (!header || !colgroup) return;

      if (vagasViewAtual === "detalhado") {
        colgroup.innerHTML = `
          <col style="width: 24%;">
          <col style="width: 28%;">
          <col style="width: 16%;">
          <col style="width: 16%;">
          <col style="width: 16%;">
        `;
        header.innerHTML = `
          <th>DSEI/CASAI</th>
          <th>Cargo</th>
          <th>Vagas não ocupadas</th>
          <th>Temporárias</th>
          <th>Total Processo Seletivo</th>
        `;
        if (descricao) descricao.textContent = "Vagas para processo seletivo por DSEI/CASAI e cargo nos filtros selecionados.";
        return;
      }

      const primeiraColuna = vagasViewAtual === "cargo" ? "Cargo" : "DSEI/CASAI";
      colgroup.innerHTML = `
        <col style="width: 40%;">
        <col style="width: 20%;">
        <col style="width: 20%;">
        <col style="width: 20%;">
      `;
      header.innerHTML = `
        <th>${primeiraColuna}</th>
        <th>Vagas não ocupadas</th>
        <th>Temporárias</th>
        <th>Total Processo Seletivo</th>
      `;
      if (descricao) {
        descricao.textContent = vagasViewAtual === "cargo"
          ? "Vagas não ocupadas somado às temporárias (total para processo seletivo) por cargo."
          : "Vagas não ocupadas somado às temporárias (total para processo seletivo) por DSEI/CASAI.";
      }
    }

    function renderProcessoSeletivo(rows) {
      const tbody = document.getElementById("processoSeletivoBody");
      if (!tbody) return;

      atualizarCabecalhoProcessoSeletivo();
      renderPaginacaoTabela("processoSeletivoPagination", rows);
      // Exclui os cargos que não passam por processo seletivo (antes da agregação).
      const linhas = montarDistribuicaoVagasOciosas(filtrarCargosProcessoSeletivo(rows)).filter(item => {
        return Number(item.normalTemporario || 0) !== 0 ||
          Number(item.contratadosTemporario || 0) !== 0 ||
          Number(item.processoSeletivo || 0) !== 0;
      });

      const totalColunas = vagasViewAtual === "detalhado" ? 5 : 4;
      if (!linhas.length) {
        tbody.innerHTML = `<tr><td colspan="${totalColunas}" class="remanejamentoEmpty">Sem dados para os filtros selecionados.</td></tr>`;
        return;
      }

      const total = linhas.reduce((acc, row) => {
        acc.normalTemporario += Number(row.normalTemporario || 0);
        acc.contratadosTemporario += Number(row.contratadosTemporario || 0);
        acc.processoSeletivo += Number(row.processoSeletivo || 0);
        return acc;
      }, { normalTemporario: 0, contratadosTemporario: 0, processoSeletivo: 0 });

      if (vagasViewAtual === "detalhado") {
        tbody.innerHTML = linhas.map(row => `
          <tr>
            <td>${escapeHtml(row.dseiCasai)}</td>
            <td>${escapeHtml(row.cargo)}</td>
            <td>${formatNumber(row.normalTemporario)}</td>
            <td>${formatNumber(row.contratadosTemporario)}</td>
            <td>${formatNumber(row.processoSeletivo)}</td>
          </tr>
        `).join("") + `
          <tr class="totalRow">
            <td colspan="2">TOTAL</td>
            <td>${formatNumber(total.normalTemporario)}</td>
            <td>${formatNumber(total.contratadosTemporario)}</td>
            <td>${formatNumber(total.processoSeletivo)}</td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = linhas.map(row => `
        <tr>
          <td>${escapeHtml(row.label)}</td>
          <td>${formatNumber(row.normalTemporario)}</td>
          <td>${formatNumber(row.contratadosTemporario)}</td>
          <td>${formatNumber(row.processoSeletivo)}</td>
        </tr>
      `).join("") + `
        <tr class="totalRow">
          <td>TOTAL</td>
          <td>${formatNumber(total.normalTemporario)}</td>
          <td>${formatNumber(total.contratadosTemporario)}</td>
          <td>${formatNumber(total.processoSeletivo)}</td>
        </tr>
      `;
    }

    function mudarPaginaVagas(delta) {
      vagasCurrentPage = Math.max(1, vagasCurrentPage + Number(delta || 0));
      // As três tabelas compartilham a mesma página (mesmo grupo de DSEI),
      // então navegam juntas.
      renderVagasTable(vagasRows);
      renderDistribuicaoVagasOciosas(vagasRows);
      renderProcessoSeletivo(vagasRows);
    }

    function obterPaginaVagas(linhas) {
      if (vagasViewAtual !== "detalhado") {
        return {
          linhasPagina: linhas,
          resumoPaginacao: `<span>Exibindo ${formatNumber(linhas.length)} registro(s) com rolagem.</span>`
        };
      }

      const grupos = [...new Set(linhas.map(row => row.dseiCasai).filter(Boolean))];
      const totalPaginas = Math.max(1, grupos.length);
      vagasCurrentPage = Math.min(Math.max(1, vagasCurrentPage), totalPaginas);
      const grupoAtual = grupos[vagasCurrentPage - 1] || "";
      const linhasPagina = linhas.filter(row => String(row.dseiCasai || "") === String(grupoAtual || ""));

      return {
        linhasPagina,
        resumoPaginacao: `
          <button type="button" onclick="mudarPaginaVagas(-1)" ${vagasCurrentPage <= 1 ? "disabled" : ""}>Anterior</button>
          <span>Página ${formatNumber(vagasCurrentPage)} de ${formatNumber(totalPaginas)}${grupoAtual ? ` · ${escapeHtml(grupoAtual)}` : ""}</span>
          <button type="button" onclick="mudarPaginaVagas(1)" ${vagasCurrentPage >= totalPaginas ? "disabled" : ""}>Próxima</button>
        `
      };
    }

    // Renderiza os controles de paginação (mesmo grupo de DSEI da tabela de Vagas)
    // num elemento alvo, reaproveitando a lógica de paginação da tabela principal.
    function renderPaginacaoTabela(elementId, rows) {
      const el = document.getElementById(elementId);
      if (!el) return;
      const linhasBase = obterRowsVagasPorVisualizacao(rows);
      const { resumoPaginacao } = obterPaginaVagas(linhasBase);
      el.innerHTML = resumoPaginacao;
    }

    function montarAlertas(data) {
      const rows = [];

      // A regra de excedente (incluindo a consolidação ENFERMEIRO/FARMACÊUTICO + ART
      // e a separação RT) é calculada na própria view e exposta nas colunas
      // qtdVagasExcedentes (cargos comuns) e qtdVagasArtExcedentes (cargos ART).
      data.forEach(row => {
        const afastamento = Number(row.qtdAfastamentoSemSubstituto || 0);
        const temporario = Number(row.qtdTemporarioAtivo || 0);
        const excedente = Number(row.qtdVagasExcedentes || 0);
        const excedenteRt = Number(row.qtdVagasArtExcedentes || 0);

        if (afastamento > 0) {
          rows.push({
            tipoValor: "AFASTAMENTO_SEM_SUBSTITUTO",
            tipo: "Afastamento sem substituto",
            dsei: row.dseiCasai,
            cargo: row.cargo,
            qtd: formatNumber(afastamento),
            detalhe: `${formatNumber(afastamento)} afastamento(s) sem substituto`
          });
        }

        if (temporario > 0) {
          rows.push({
            tipoValor: "TEMPORARIO_ATIVO",
            tipo: "Temporário ativo — monitorar",
            dsei: row.dseiCasai,
            cargo: row.cargo,
            qtd: formatNumber(temporario),
            detalhe: `${formatNumber(temporario)} temporário(s) ativo(s)`
          });
        }

        if (excedenteRt > 0) {
          rows.push({
            tipoValor: "RT_EXCEDENTE",
            tipo: "RT excedente",
            dsei: row.dseiCasai,
            cargo: row.cargo,
            qtd: formatNumber(excedenteRt),
            detalhe: `${formatNumber(excedenteRt)} vaga(s) excedente(s) de RT pela coluna Vagas Ociosas`
          });
        }

        if (excedente > 0) {
          rows.push({
            tipoValor: "VAGA_EXCEDENTE",
            tipo: "Vaga excedente",
            dsei: row.dseiCasai,
            cargo: row.cargo,
            qtd: formatNumber(excedente),
            detalhe: `${formatNumber(excedente)} contratado(s) acima da necessidade operacional após considerar afastados`
          });
        }
      });

      rows.forEach(row => {
        row.chave = gerarChaveAlerta(row);
        row.observacao = observacoesAlertas[row.chave]?.observacao || "";
      });

      return rows.sort((a, b) => {
        const d = String(a.dsei || "").localeCompare(String(b.dsei || ""));
        if (d !== 0) return d;
        return String(a.cargo || "").localeCompare(String(b.cargo || ""));
      });
    }

    function renderAlertasTable(rows) {
      const tbody = document.getElementById("alertasBody");
      const pagination = document.getElementById("alertasPagination");
      if (!tbody) return;

      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="5">Sem alertas para os filtros selecionados.</td></tr>`;
        if (pagination) pagination.innerHTML = "";
        return;
      }

      tbody.innerHTML = rows.map(row => {
        const chave = row.chave || gerarChaveAlerta(row);
        const infoObs = observacoesAlertas[chave] || {};
        const obs = infoObs.observacao || row.observacao || "";

        return `
          <tr>
            <td>${escapeHtml(row.dsei)}</td>
            <td>${escapeHtml(row.cargo)}</td>
            <td>${escapeHtml(row.tipo)}</td>
            <td>${escapeHtml(row.detalhe)}</td>
            <td class="alertaObservacaoCell">${renderObservacaoAlertaHtml(chave, obs, infoObs)}</td>
          </tr>
        `;
      }).join("");

      if (pagination) {
        pagination.innerHTML = `<span>Exibindo ${formatNumber(rows.length)} alerta(s) com rolagem.</span>`;
      }
    }

    function renderObservacaoAlertaHtml(chave, obs, infoObs) {
      const emEdicao = alertaObservacaoEditando === chave || !obs;
      const atualizadoEm = infoObs?.atualizadoEm || "";
      const usuarioEdicao = infoObs?.usuario || "";
      const metaPartes = [];

      if (atualizadoEm) metaPartes.push(`Última edição: ${escapeHtml(atualizadoEm)}`);
      if (usuarioEdicao) metaPartes.push(`Editado por: ${escapeHtml(usuarioEdicao)}`);

      const meta = metaPartes.length
        ? `<div class="alertaObservacaoMeta">${metaPartes.join("<br>")}</div>`
        : "";

      if (!emEdicao) {
        return `
          <div class="alertaObservacaoWrap">
            <div class="alertaObservacaoTexto">${escapeHtml(obs)}</div>
            <div class="alertaObservacaoActions">
              <button type="button" class="alertaObservacaoBtn secundario" onclick="editarObservacaoAlertaPainel('${escapeJs(chave)}')">Editar</button>
            </div>
            ${meta}
            <div class="alertaObservacaoStatus" id="${idStatusObservacaoAlerta(chave)}"></div>
          </div>
        `;
      }

      return `
        <div class="alertaObservacaoWrap">
          <textarea class="alertaObservacaoInput" id="${idObservacaoAlerta(chave)}" placeholder="Digite uma justificativa ou observação">${escapeHtml(obs)}</textarea>
          <div class="alertaObservacaoActions">
            <button type="button" class="alertaObservacaoBtn" id="${idBotaoObservacaoAlerta(chave)}" onclick="salvarObservacaoAlertaPainel('${escapeJs(chave)}')">Salvar</button>
            ${obs ? `<button type="button" class="alertaObservacaoBtn secundario" onclick="cancelarEdicaoObservacaoAlertaPainel()">Cancelar</button>` : ""}
          </div>
          ${meta}
          <div class="alertaObservacaoStatus" id="${idStatusObservacaoAlerta(chave)}"></div>
        </div>
      `;
    }

    function idSeguroAlerta(chave) {
      return String(chave || "").replace(/[^A-Za-z0-9_-]/g, "_");
    }

    function idObservacaoAlerta(chave) {
      return "obsAlerta_" + idSeguroAlerta(chave);
    }

    function idBotaoObservacaoAlerta(chave) {
      return "btnObsAlerta_" + idSeguroAlerta(chave);
    }

    function idStatusObservacaoAlerta(chave) {
      return "statusObsAlerta_" + idSeguroAlerta(chave);
    }

    function gerarChaveAlerta(row) {
      return [
        row?.dsei || "",
        row?.cargo || "",
        row?.tipoValor || ""
      ].map(normalizarTextoPainel).join("|");
    }

    function editarObservacaoAlertaPainel(chave) {
      alertaObservacaoEditando = chave;
      renderAlertasTable(alertasRows);

      setTimeout(() => {
        const campo = document.getElementById(idObservacaoAlerta(chave));
        if (campo) {
          campo.focus();
          campo.selectionStart = campo.value.length;
          campo.selectionEnd = campo.value.length;
        }
      }, 0);
    }

    function cancelarEdicaoObservacaoAlertaPainel() {
      alertaObservacaoEditando = null;
      renderAlertasTable(alertasRows);
    }

    function salvarObservacaoAlertaPainel(chave) {
      const row = alertasRows.find(item => (item.chave || gerarChaveAlerta(item)) === chave);
      const campo = document.getElementById(idObservacaoAlerta(chave));
      const botao = document.getElementById(idBotaoObservacaoAlerta(chave));
      const status = document.getElementById(idStatusObservacaoAlerta(chave));

      if (!row || !campo) {
        alert("Não foi possível identificar o alerta para salvar a observação.");
        return;
      }

      const observacao = campo.value || "";

      if (botao) botao.disabled = true;
      if (status) status.innerText = "Salvando...";

      apiPost("/api/alertas/observacao", {
        chave,
        dsei: row.dsei,
        cargo: row.cargo,
        tipoValor: row.tipoValor,
        tipo: row.tipo,
        detalhe: row.detalhe,
        observacao
      })
        .then(payload => {
          observacoesAlertas[chave] = {
            ...(observacoesAlertas[chave] || {}),
            observacao: payload?.observacao ?? observacao,
            usuario: payload?.usuario || "",
            atualizadoEm: payload?.atualizadoEm || ""
          };

          alertaObservacaoEditando = null;
          renderAlertasTable(alertasRows);
        })
        .catch(error => {
          if (botao) botao.disabled = false;
          if (status) status.innerText = "";
          alert(error && error.message ? error.message : String(error));
        });
    }

    function mudarPaginaAlertas(delta) {
      renderAlertasTable(alertasRows);
    }


    function filtrarPesquisaVagas(linhas) {
      if (!vagasSearchTerm) return linhas;
      return linhas.filter(row => {
        const texto = [
          row.dseiCasai,
          row.cargo,
          row.label,
          row.quantitativoPlano,
          row.totalContratados,
          row.afastados,
          row.ociosas,
          row.contratadosSubstituicao,
          row.contratadosTemporario,
          formatPercent(row.preenchimento)
        ].join(" ").toUpperCase();
        return texto.includes(vagasSearchTerm);
      });
    }

    function ordenarLinhasVagas(linhas) {
      const key = vagasSortState.key || (vagasViewAtual === "detalhado" ? "dseiCasai" : "label");
      const direction = vagasSortState.direction === "desc" ? -1 : 1;

      return [...linhas].sort((a, b) => {
        const av = a[key];
        const bv = b[key];
        const an = Number(av);
        const bn = Number(bv);

        if (!isNaN(an) && !isNaN(bn) && String(av).trim() !== "" && String(bv).trim() !== "") {
          return (an - bn) * direction;
        }

        return String(av || "").localeCompare(String(bv || ""), "pt-BR") * direction;
      });
    }

    function linhaVagasZerada(row) {
      return [
        row.quantitativoPlano,
        row.totalContratados,
        row.afastados,
        row.ociosas,
        row.contratadosSubstituicao,
        row.contratadosTemporario
      ].every(valor => Number(valor || 0) === 0);
    }

    function montarComposicaoOciosas(row) {
      return `
        <div class="composicaoOciosas">
          <div><strong>Vagas normais:</strong> ${formatNumber(row.quantitativoPlano)}</div>
          <div><strong>Substituições:</strong> ${formatNumber(row.contratadosSubstituicao)}</div>
          <div><strong>Temporárias:</strong> ${formatNumber(row.contratadosTemporario)}</div>
          <div><strong>Afastados:</strong> ${formatNumber(row.afastados)}</div>
          <div><strong>Saldo atual:</strong> ${formatNumber(row.ociosas)}</div>
        </div>
      `;
    }

    function normalizarTextoPainel(valor) {
      return String(valor || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^A-Za-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();
    }

    function renderAlertasKpis(data) {
      const temporarios = soma(data, "qtdTemporarioAtivo");
      const afastamentos = soma(data, "afastados");
      const substituicoes = soma(data, "contratadosSubstituicao");
      const afastamentosSemSubstituto = Math.max(0, afastamentos - substituicoes);
      // Fonte de verdade: colunas já calculadas na view (consolidação RT incluída).
      const rtExcedente = soma(data, "qtdVagasArtExcedentes");
      const excedentes = soma(data, "qtdVagasExcedentes");

      setText("alertaKpiTemporarios", formatNumber(temporarios));
      setText("alertaKpiAfastamentos", formatNumber(afastamentos));
      setText("alertaKpiRtExcedente", formatNumber(rtExcedente));
      setText("alertaKpiExcedentes", formatNumber(excedentes));
      setText("alertaKpiAfastamentosSemSubstituto", formatNumber(afastamentosSemSubstituto));
      setText(`alertaKpiAfastamentosSemSubstitutoSub`, `${formatNumber(afastamentosSemSubstituto)} de ${formatNumber(afastamentos)} afastamentos totais`);
    }

    function exportarPdf() {
      window.print();
    }

    function topAgrupadoCalculado(data, groupField, calcFn, limit, labelFn) {
      const map = {};

      data.forEach(row => {
        const rawKey = groupField === "chaveRisco"
          ? `${row.dseiCasai || "Não informado"}|||${row.cargo || "Não informado"}`
          : (row[groupField] || "Não informado");

        const key = String(rawKey);
        const value = Number(calcFn(row) || 0);

        if (!map[key]) {
          map[key] = {
            label: labelFn ? labelFn(row) : key,
            value: 0
          };
        }

        map[key].value += value;
      });

      return Object.keys(map)
        .map(key => ({
          label: map[key].label,
          value: map[key].value
        }))
        .filter(row => row.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, limit);
    }

    function calcularOciosas(row) {
      // A coluna "Vagas Ociosas (Déficit Operacional)" da tabela de Vagas PODE ser
      // negativa (excedente). Os demais quadros (distribuição/processo seletivo) zeram
      // os negativos por conta própria em montarLinhaDistribuicaoBase.
      if (row && row.vagasOciosas !== null && row.vagasOciosas !== undefined && row.vagasOciosas !== "") {
        return Number(row.vagasOciosas || 0);
      }

      if (row && row.ociosas !== null && row.ociosas !== undefined && row.ociosas !== "") {
        return Number(row.ociosas || 0);
      }

      const vagas = Number(row.quantitativoPlano || 0);
      const contratados = Number(row.totalContratados || 0);
      const afastados = Number(row.afastados || 0);
      return vagas - contratados + afastados;
    }

    function calcularPreenchimento(vagas, ociosas) {
      const totalVagas = Number(vagas || 0);
      if (!totalVagas) return 0;
      return ((totalVagas - Number(ociosas || 0)) / totalVagas) * 100;
    }

    function soma(data, field) {
      return data.reduce((acc, row) => acc + Number(row[field] || 0), 0);
    }

    function part(value, total) {
      if (!total) return 0;
      return (Number(value || 0) / Number(total || 0)) * 100;
    }

    function setText(id, value) {
      const el = document.getElementById(id);
      if (el) el.innerText = value;
    }

    function exportarVagas() {
      const rows = vagasRows.map(row => ({
        "DSEI/CASAI": row.dseiCasai,
        "Cargo": row.cargo,
        "Vagas previstas": row.quantitativoPlano,
        "Total de Contratados": row.totalContratados,
        "Afastados": row.afastados,
        "Vagas Ociosas (Déficit Operacional)": row.ociosas,
        "Substituições": row.contratadosSubstituicao,
        "Temporárias": row.contratadosTemporario,
        "Percentual de preenchimento": formatPercent(row.preenchimento),
        "Atualização": row.atualizacaoDados
      }));

      baixarCsv("base_vagas_saude_indigena", rows, false);
    }

    function exportarDistribuicaoVagasOciosas() {
      // Exporta a tabela "Distribuição das Vagas Ociosas" conforme a visualização
      // ativa da aba Vagas e respeitando os filtros superiores DSEI/CASAI e Cargo.
      const linhasBase = obterRowsVagasPorVisualizacao(vagasRows);
      let rows;

      if (vagasViewAtual === "detalhado") {
        rows = linhasBase.map(row => {
          const base = valoresDistribuicao(row);
          return {
            "DSEI/CASAI": row.dseiCasai || "Não informado",
            "Cargo": row.cargo || "Não informado",
            "Vagas não ocupadas": base.normalTemporario,
            "Afastamento sem substituição": base.substituicaoTabela,
            "Vagas Ociosas": base.vagasOciosas
          };
        });
      } else {
        const primeiraColuna = vagasViewAtual === "cargo" ? "Cargo" : "DSEI/CASAI";
        rows = linhasBase.map(row => {
          const base = valoresDistribuicao(row);
          return {
            [primeiraColuna]: row.label || "Não informado",
            "Vagas não ocupadas": base.normalTemporario,
            "Afastamento sem substituição": base.substituicaoTabela,
            "Vagas Ociosas": base.vagasOciosas
          };
        });
      }

      rows = rows.filter(item =>
        Number(item["Vagas Ociosas"] || 0) !== 0 ||
        Number(item["Afastamento sem substituição"] || 0) !== 0 ||
        Number(item["Vagas não ocupadas"] || 0) !== 0
      );

      baixarCsv("distribuicao_vagas_ociosas", rows, false);
    }

    function exportarProcessoSeletivo() {
      // Exporta a tabela "Vagas para Processo Seletivo" conforme a visualização ativa
      // e respeitando os filtros superiores DSEI/CASAI e Cargo.
      const linhasBase = obterRowsVagasPorVisualizacao(filtrarCargosProcessoSeletivo(vagasRows));
      let rows;

      if (vagasViewAtual === "detalhado") {
        rows = linhasBase.map(row => {
          const base = valoresDistribuicao(row);
          return {
            "DSEI/CASAI": row.dseiCasai || "Não informado",
            "Cargo": row.cargo || "Não informado",
            "Vagas não ocupadas": base.normalTemporario,
            "Temporárias": base.contratadosTemporario,
            "Total Processo Seletivo": base.processoSeletivo
          };
        });
      } else {
        const primeiraColuna = vagasViewAtual === "cargo" ? "Cargo" : "DSEI/CASAI";
        rows = linhasBase.map(row => {
          const base = valoresDistribuicao(row);
          return {
            [primeiraColuna]: row.label || "Não informado",
            "Vagas não ocupadas": base.normalTemporario,
            "Temporárias": base.contratadosTemporario,
            "Total Processo Seletivo": base.processoSeletivo
          };
        });
      }

      rows = rows.filter(item =>
        Number(item["Vagas não ocupadas"] || 0) !== 0 ||
        Number(item["Temporárias"] || 0) !== 0 ||
        Number(item["Total Processo Seletivo"] || 0) !== 0
      );

      baixarCsv("vagas_processo_seletivo", rows, false);
    }

    function exportarAlertas() {
      const rows = alertasRows.map(row => ({
        "DSEI/CASAI": row.dsei,
        "Cargo": row.cargo,
        "Tipo de Alerta": row.tipo,
        "Detalhe": row.detalhe,
        "Observação": row.observacao || observacoesAlertas[row.chave || gerarChaveAlerta(row)]?.observacao || ""
      }));

      baixarCsv("alertas_saude_indigena", rows, true);
    }

    function baixarCsv(nomeArquivo, rows, incluirTipoAlerta = false) {
      const linhas = [];

      linhas.push(["Arquivo", nomeArquivo]);
      linhas.push(["Exportado em", new Date().toLocaleString("pt-BR")]);
      linhas.push(["DSEI/CASAI", valorFiltro("fDsei")]);
      linhas.push(["Cargo", valorFiltro("fCargo")]);
      if (incluirTipoAlerta) {
        linhas.push(["Tipo de Alerta", valorFiltro("fTipoAlerta")]);
      }
      linhas.push([]);

      if (!rows || rows.length === 0) {
        linhas.push(["Sem dados para os filtros selecionados."]);
      } else {
        const headers = Object.keys(rows[0]);
        linhas.push(headers);
        rows.forEach(row => {
          linhas.push(headers.map(h => row[h]));
        });
      }

      const csv = "\uFEFF" + linhas
        .map(linha => linha.map(valorCsv).join(";"))
        .join("\r\n");

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");

      a.href = url;
      a.download = `${nomeArquivo}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    function valorFiltro(id) {
      const cfg = filterConfigs[id];
      if (!cfg) return "Todos";

      const selected = cfg.options.filter(opt => cfg.selected.has(String(opt.value))).map(opt => opt.label);
      if (!selected.length || selected.length === cfg.options.length) return "Todos";
      return selected.join(", ");
    }



    function configurarPainelExterno() {
      const iframe = document.getElementById("iframeDashboardSaudeIndigena");
      const placeholder = document.getElementById("dashboardSaudeIndigenaPlaceholder");
      const btn = document.getElementById("btnAbrirPainelExterno");
      const url = String(DASHBOARD_SAUDE_INDIGENA_URL || "").trim();

      if (!iframe || !placeholder) return;

      iframe.removeAttribute("src");
      iframe.style.display = "none";

      if (!url) {
        placeholder.style.display = "grid";
        if (btn) btn.disabled = true;
        return;
      }

      placeholder.style.display = "grid";
      if (btn) btn.disabled = false;
    }


    function carregarPainelExternoSobDemanda() {
      if (painelExternoCarregado) return;

      const iframe = document.getElementById("iframeDashboardSaudeIndigena");
      const placeholder = document.getElementById("dashboardSaudeIndigenaPlaceholder");
      const url = String(DASHBOARD_SAUDE_INDIGENA_URL || "").trim();

      if (!iframe || !placeholder || !url) return;

      iframe.src = url;
      iframe.style.display = "block";
      placeholder.style.display = "none";
      painelExternoCarregado = true;
    }

    function abrirPainelExterno() {
      const url = String(DASHBOARD_SAUDE_INDIGENA_URL || "").trim();

      if (!url) {
        alert("O link do painel ainda não foi configurado em DASHBOARD_SAUDE_INDIGENA_URL.");
        return;
      }

      window.open(url, "_blank", "noopener,noreferrer");
    }


    function configurarPainelFerias() {
      const iframe = document.getElementById("iframeDashboardFerias");
      const placeholder = document.getElementById("dashboardFeriasPlaceholder");
      const btn = document.getElementById("btnAbrirPainelFerias");
      const url = String(DASHBOARD_FERIAS_URL || "").trim();

      if (!iframe || !placeholder) return;

      iframe.removeAttribute("src");
      iframe.style.display = "none";

      placeholder.style.display = "grid";
      if (btn) btn.disabled = !url;
    }

    function carregarPainelFeriasSobDemanda() {
      if (painelFeriasCarregado) return;

      const iframe = document.getElementById("iframeDashboardFerias");
      const placeholder = document.getElementById("dashboardFeriasPlaceholder");
      const url = String(DASHBOARD_FERIAS_URL || "").trim();

      if (!iframe || !placeholder || !url) return;

      iframe.src = url;
      iframe.style.display = "block";
      placeholder.style.display = "none";
      painelFeriasCarregado = true;
    }

    function abrirPainelFerias() {
      const url = String(DASHBOARD_FERIAS_URL || "").trim();

      if (!url) {
        alert("O link do painel ainda não foi configurado em DASHBOARD_FERIAS_URL.");
        return;
      }

      window.open(url, "_blank", "noopener,noreferrer");
    }


    function configurarRemanejamento() {
      remanejamentoDetalhePage = 1;

      if (!pageLoadState.remanejamentoCadastro) {
        preencherSelectRemanejamento("remanejamentoDsei", [REMANEJAMENTO_EMPTY_OPTION], item => item.label);
        inicializarFormularioRemanejamento();
        atualizarResumoRemanejamento();
        return;
      }

      const dseis = montarOpcoesDseiRemanejamento();
      preencherSelectRemanejamento("remanejamentoDsei", dseis, item => item.label);
      inicializarFormularioRemanejamento(true);
      atualizarResumoRemanejamento();
    }

    function montarOpcoesDseiRemanejamento() {
      const mapa = new Map();

      (remanejamentoCadastroRows || []).forEach(row => {
        if (!row.idDseiCasai || !row.dseiCasai) return;
        mapa.set(String(row.idDseiCasai), {
          value: String(row.idDseiCasai),
          label: row.dseiCasai
        });
      });

      const lista = [...mapa.values()].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
      return lista.length ? lista : [REMANEJAMENTO_EMPTY_OPTION];
    }

    function montarOpcoesCargosRemanejamento() {
      const idDsei = String(document.getElementById("remanejamentoDsei")?.value || "");
      return (remanejamentoCadastroRows || [])
        .filter(row => !idDsei || String(row.idDseiCasai || "") === idDsei)
        .slice()
        .sort((a, b) => String(a.cargo || "").localeCompare(String(b.cargo || ""), "pt-BR"))
        .map(row => {
          const cargo = row.cargo || `Cargo ID ${row.idCargoFuncao}`;
          const ociosas = Math.max(0, Math.floor(Number(row.vagasOciosas || 0)));
          return {
            value: String(row.idCargoFuncao || ""),
            // Mostra quantas vagas ociosas o cargo tem no DSEI selecionado.
            label: `${cargo} — ${ociosas} ociosa(s)`,
            row
          };
        });
    }

    function obterCadastroCargoRemanejamento(idCargoFuncao) {
      const idDsei = String(document.getElementById("remanejamentoDsei")?.value || "");
      return (remanejamentoCadastroRows || []).find(row => {
        return String(row.idDseiCasai || "") === idDsei
          && String(row.idCargoFuncao || "") === String(idCargoFuncao || "");
      }) || null;
    }

    function preencherSelectRemanejamento(id, items, labelFn) {
      const select = document.getElementById(id);
      if (!select) return;

      select.innerHTML = (items || []).map(item => `
        <option value="${escapeAttr(item.value)}">${escapeHtml(labelFn(item))}</option>
      `).join("");
    }

    function abrirFormularioRemanejamento() {
      exibirViewRemanejamento("remanejamento");
      inicializarFormularioRemanejamento();
      atualizarResumoRemanejamento();
    }

    function voltarListaRemanejamento() {
      exibirViewRemanejamento("remanejamento");
    }

    function exibirViewRemanejamento(view) {
      activeView = view;

      document.querySelectorAll(".viewPanel").forEach(panel => panel.classList.remove("active"));
      const panel = document.getElementById("view-remanejamento");
      if (panel) panel.classList.add("active");

      document.querySelectorAll(".navItem").forEach(item => {
        item.classList.toggle("active", item.dataset.view === "remanejamento");
      });

      atualizarModoRolagem("remanejamento");
      garantirCarregamentoPagina("remanejamento");
    }

    function renderRemanejamentoLista() {
      const tbody = document.getElementById("remanejamentoBody");
      atualizarIndicadoresRemanejamento();
      if (!tbody) return;

      if (!pageLoadState.remanejamentoLista) {
        tbody.innerHTML = '<tr><td class="remanejamentoEmpty" colspan="10">Carregando dados de remanejamento...</td></tr>';
        return;
      }

      if (!remanejamentoListaRows.length) {
        tbody.innerHTML = '<tr><td class="remanejamentoEmpty" colspan="10">Nenhum remanejamento registrado.</td></tr>';
        return;
      }

      const termo = normalizarTextoPainel(document.getElementById("remanejamentoSearch")?.value || "");
      const status = String(document.getElementById("remanejamentoStatusFiltro")?.value || "");

      const rows = (remanejamentoListaRows || []).filter(row => {
        if (status && String(row.situacao || "") !== status) return false;
        if (!termo) return true;
        const texto = normalizarTextoPainel([
          row.dataCriacaoFormatada || row.dataCriacao,
          row.dseiCasai,
          row.competencia,
          row.cargosReduzidos,
          row.cargosAcrescentados,
          row.numeroProcessoSei,
          row.inseridoPorEmail,
          row.situacao
        ].join(" "));
        return texto.includes(termo);
      });

      if (!rows.length) {
        tbody.innerHTML = '<tr><td class="remanejamentoEmpty" colspan="10">Nenhum remanejamento encontrado para a busca informada.</td></tr>';
        return;
      }

      const podeExcluir = painelLoginUsuario && Number(painelLoginUsuario.nivelAutorizacao || 0) >= 2;

      tbody.innerHTML = rows.map(row => {
        const impacto = Number(row.impactoMensal || 0);
        const impactoClass = classeValorImpacto(impacto);
        const idAttr = escapeAttr(row.idProcesso);

        const btnDetalhe = `<button type="button" class="remAcaoBtn" title="Ver detalhes" onclick="alternarDetalheRemanejamento('${escapeJs(row.idProcesso)}')">👁</button>`;
        const btnExcluir = podeExcluir
          ? `<button type="button" class="remAcaoBtn remAcaoExcluir" title="Excluir remanejamento" onclick="excluirRemanejamentoPainel('${escapeJs(row.idProcesso)}')">🗑</button>`
          : "";

        return `
          <tr data-rem-id="${idAttr}">
            <td>${escapeHtml(row.dataCriacaoFormatada || row.dataCriacao)}</td>
            <td>${escapeHtml(row.dseiCasai || "-")}</td>
            <td>${escapeHtml(row.competencia || "-")}</td>
            <td>${escapeHtml(row.cargosReduzidos || "-")}</td>
            <td>${formatCurrency(row.totalReduzidoPeriodo)}</td>
            <td>${escapeHtml(row.cargosAcrescentados || "-")}</td>
            <td>${formatCurrency(row.totalAcrescentadoPeriodo)}</td>
            <td class="${impactoClass}">${formatCurrency(row.impactoMensal)}</td>
            <td>${escapeHtml(row.inseridoPorEmail || row.criadoPor || "-")}</td>
            <td class="remAcoesCell">${btnDetalhe}${btnExcluir}</td>
          </tr>
        `;
      }).join("");
    }

    // Classe de cor invertida: negativo (economia) em verde, positivo (acréscimo) em vermelho.
    function classeValorImpacto(valor) {
      const n = Number(valor || 0);
      return n < 0 ? "remNegativo" : n > 0 ? "remPositivo" : "";
    }

    const detalhesRemanejamentoCache = {};

    async function alternarDetalheRemanejamento(idProcesso) {
      const tbody = document.getElementById("remanejamentoBody");
      if (!tbody) return;

      const existente = document.getElementById(`remDetalhe-${idSeguroAlerta(idProcesso)}`);
      if (existente) {
        existente.remove();
        return;
      }

      const linhaPrincipal = tbody.querySelector(`tr[data-rem-id="${cssEscapeAttr(idProcesso)}"]`);
      if (!linhaPrincipal) return;

      const detalheTr = document.createElement("tr");
      detalheTr.id = `remDetalhe-${idSeguroAlerta(idProcesso)}`;
      detalheTr.className = "remDetalheRow";
      detalheTr.innerHTML = `<td colspan="10" class="remDetalheCell">Carregando detalhes...</td>`;
      linhaPrincipal.after(detalheTr);

      try {
        let detalhe = detalhesRemanejamentoCache[idProcesso];
        if (!detalhe) {
          detalhe = await apiGet(`/api/remanejamento/detalhe/${encodeURIComponent(idProcesso)}`);
          detalhesRemanejamentoCache[idProcesso] = detalhe;
        }
        const rowLista = (remanejamentoListaRows || []).find(r => String(r.idProcesso) === String(idProcesso)) || {};
        detalheTr.querySelector("td").innerHTML = renderDetalheRemanejamentoHtml(detalhe, rowLista);
      } catch (error) {
        detalheTr.querySelector("td").innerHTML = `Erro ao carregar detalhes: ${escapeHtml(error && error.message ? error.message : String(error))}`;
      }
    }

    function cssEscapeAttr(valor) {
      return String(valor ?? "").replace(/"/g, '\\"');
    }

    function renderTabelaDetalheRemanejamento(titulo, itens) {
      const linhas = (itens || []).map(item => `
        <tr>
          <td>${escapeHtml(item.cargo || "-")}</td>
          <td>${formatNumber(item.quantidade)}</td>
          <td>${formatNumber(item.meses)}</td>
          <td>${formatCurrency(item.salario)}</td>
          <td>${formatCurrency(item.insalubridade)}</td>
          <td>${formatCurrency(item.gratificacaoRt)}</td>
          <td>${formatCurrency(item.noturno)}</td>
          <td>${formatCurrency(item.encargos)}</td>
          <td>${formatCurrency(item.provisoes)}</td>
          <td>${formatCurrency(item.mensal)}</td>
          <td>${formatCurrency(item.periodo)}</td>
        </tr>
      `).join("");

      const totalMensal = (itens || []).reduce((s, i) => s + Number(i.mensal || 0), 0);
      const totalPeriodo = (itens || []).reduce((s, i) => s + Number(i.periodo || 0), 0);

      return `
        <div class="remDetalheTitulo">${escapeHtml(titulo)}</div>
        <div class="remDetalheTableWrap">
          <table class="remTable remDetalheTable">
            <thead>
              <tr>
                <th>Cargo</th><th>Qtd.</th><th>Meses</th><th>Salário</th><th>Insal./Peric.</th>
                <th>Grat. RT</th><th>Noturno</th><th>Encargos</th><th>Provisões</th><th>Mensal</th><th>Período</th>
              </tr>
            </thead>
            <tbody>${linhas || '<tr><td colspan="11">Sem itens.</td></tr>'}</tbody>
            <tfoot>
              <tr><td colspan="9">TOTAL</td><td>${formatCurrency(totalMensal)}</td><td>${formatCurrency(totalPeriodo)}</td></tr>
            </tfoot>
          </table>
        </div>
      `;
    }

    function renderDetalheRemanejamentoHtml(detalhe, rowLista) {
      const impacto = Number(detalhe.impactoMensal || 0);
      const anexo = rowLista.anexoOficioUrl
        ? `<a class="remAnexoLink" href="${escapeAttr(rowLista.anexoOficioUrl)}" target="_blank" rel="noopener noreferrer">Abrir PDF</a>`
        : "—";

      return `
        <div class="remDetalheBox">
          ${renderTabelaDetalheRemanejamento("VAGAS REDUZIDAS", detalhe.reduzidos)}
          ${renderTabelaDetalheRemanejamento("VAGAS ACRESCENTADAS", detalhe.acrescentados)}
          <div class="remDetalheImpacto ${classeValorImpacto(impacto)}">Impacto Mensal: ${formatCurrency(impacto)}</div>
          <div class="remDetalheMeta">
            <div><strong>Usuário:</strong> ${escapeHtml(rowLista.inseridoPorEmail || rowLista.criadoPor || "-")}</div>
            <div><strong>Processo SEI:</strong> ${escapeHtml(rowLista.numeroProcessoSei || "-")}</div>
            <div><strong>Documento PDF:</strong> ${anexo}</div>
            <div><strong>Observação:</strong> ${escapeHtml(rowLista.observacao || "-")}</div>
          </div>
        </div>
      `;
    }

    async function excluirRemanejamentoPainel(idProcesso) {
      if (!confirm("Tem certeza que deseja excluir este remanejamento? Esta ação remove o registro nas três tabelas e não pode ser desfeita.")) {
        return;
      }

      try {
        const response = await fetch(`/api/remanejamento/${encodeURIComponent(idProcesso)}`, {
          method: "DELETE",
          headers: painelLoginToken ? { Authorization: `Bearer ${painelLoginToken}` } : {}
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `Erro ${response.status}`);

        delete detalhesRemanejamentoCache[idProcesso];
        alert("Remanejamento excluído com sucesso.");
        // Atualiza todos os dados afetados pela exclusão (vagas ociosas voltam ao saldo,
        // monitoramento, alertas, visão geral e a própria lista).
        recarregarTodosOsDados();
      } catch (error) {
        alert(`Erro ao excluir remanejamento: ${error && error.message ? error.message : error}`);
      }
    }

    function renderRemanejamentoListaErro(error) {
      const tbody = document.getElementById("remanejamentoBody");
      if (!tbody) return;

      tbody.innerHTML = `<tr><td class="remanejamentoEmpty" colspan="10">Erro ao carregar remanejamentos: ${escapeHtml(error && error.message ? error.message : String(error))}</td></tr>`;
    }

    function atualizarVagasOrigemPorDsei() {
      remanejamentoLinhas.reduzido = [criarLinhaRemanejamento("reduzido", { quantidade: 1, meses: 6 })];
      remanejamentoLinhas.acrescentado = [criarLinhaRemanejamento("acrescentado", { quantidade: 1, meses: 6 })];
      renderLinhasRemanejamento("reduzido");
      renderLinhasRemanejamento("acrescentado");
      atualizarResumoRemanejamento();
    }

    function atualizarVagasDestinoPorDsei() {
      atualizarVagasOrigemPorDsei();
    }

    function atualizarResumoRemanejamento() {
      const dseiSelect = document.getElementById("remanejamentoDsei");
      const dseiLabel = dseiSelect?.options?.[dseiSelect.selectedIndex]?.text || "DSEI não selecionado";
      const processoInput = document.getElementById("remanejamentoProcessoSei");
      const anexoInput = document.getElementById("remAnexoArquivo");
      const anexoPreview = document.getElementById("remanejamentoAnexoPreview");
      const processo = processoInput?.value || "";
      const anexoNome = anexoInput?.files?.[0]?.name || "";
      const resumoFinanceiro = atualizarResumoRemanejamentoPainel();
      const qtdMovimentada = soma(coletarLinhasRemanejamento("reduzido"), "quantidade") + soma(coletarLinhasRemanejamento("acrescentado"), "quantidade");

      setText(
        "remanejamentoCalculoTexto",
        `${dseiLabel}. Processo SEI: ${processo || "não informado"}. Impacto mensal previsto: ${formatCurrency(resumoFinanceiro.impactoMensal)}.`
      );

      setText("remanejamentoResultadoTotal", formatNumber(qtdMovimentada));

      if (anexoPreview) {
        anexoPreview.innerHTML = anexoNome
          ? `Anexo selecionado: <strong>${escapeHtml(anexoNome)}</strong>.`
          : "Clique ou arraste o arquivo para enviar. PDF até 10MB.";
      }

      atualizarAvisoOciosasRemanejamento();
    }

    // Mostra/oculta a notificação visual de vagas ociosas e habilita/desabilita o botão Salvar.
    function atualizarAvisoOciosasRemanejamento() {
      const erros = validarOciosasReduzidoCliente();
      const aviso = document.getElementById("remOciosasAviso");
      const botao = document.getElementById("remSaveBtn");

      if (aviso) {
        if (erros.length) {
          aviso.hidden = false;
          aviso.innerHTML = `⚠ <strong>Não é possível salvar:</strong> não há vagas ociosas suficientes para reduzir — ${erros.map(escapeHtml).join("; ")}.`;
        } else {
          aviso.hidden = true;
          aviso.innerHTML = "";
        }
      }

      if (botao) {
        botao.disabled = erros.length > 0;
        botao.classList.toggle("remSaveBtnBloqueado", erros.length > 0);
        botao.title = erros.length ? "Ajuste as quantidades reduzidas: não há vagas ociosas suficientes." : "";
      }

      return erros;
    }

    function obterRemanejamentoCadastroSelecionado() {
      return null;
    }

    function atualizarIndicadoresRemanejamento() {
      setText("remKpiTotalRegistros", formatNumber(remanejamentoListaRows.length));
      setText("remKpiAnexos", formatNumber(remanejamentoListaRows.filter(row => row.temAnexo || row.anexoOficioUrl).length));
      setText("remKpiOrigens", formatNumber(new Set(remanejamentoListaRows.map(row => row.dseiCasai).filter(Boolean)).size));
    }

    function inicializarFormularioRemanejamento(resetar) {
      if (resetar || !remanejamentoLinhas.reduzido.length) {
        remanejamentoLinhas.reduzido = [criarLinhaRemanejamento("reduzido", { quantidade: 1, meses: 6 })];
      }

      if (resetar || !remanejamentoLinhas.acrescentado.length) {
        remanejamentoLinhas.acrescentado = [criarLinhaRemanejamento("acrescentado", { quantidade: 1, meses: 6 })];
      }

      renderLinhasRemanejamento("reduzido");
      renderLinhasRemanejamento("acrescentado");
      atualizarResumoRemanejamentoPainel();
    }

    // Meses derivados: do mês atual até dezembro (ex.: junho => 7). É um valor de sistema,
    // não editável pelo usuário, alinhado à regra usada no servidor.
    function mesesAteFimDoAno() {
      const mes = new Date().getMonth() + 1; // 1..12
      return Math.max(1, 13 - mes);
    }

    function criarLinhaRemanejamento(tipo, valores) {
      return {
        id: `${tipo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        idCargoFuncao: valores?.idCargoFuncao || "",
        cargo: valores?.cargo || "",
        quantidade: Number(valores?.quantidade || 1),
        vagasOciosas: Number(valores?.vagasOciosas || 0),
        meses: mesesAteFimDoAno(),
        salarioBase: Number(valores?.salarioBase || 0),
        insalubridadePericulosidade: Number(valores?.insalubridadePericulosidade || 0),
        gratificacaoRt: Number(valores?.gratificacaoRt || 0),
        adicionalNoturno: Number(valores?.adicionalNoturno || 0),
        encargos: Number(valores?.encargos || 0),
        provisoes: Number(valores?.provisoes || 0)
      };
    }

    function adicionarLinhaRemanejamento(tipo) {
      remanejamentoLinhas[tipo] = remanejamentoLinhas[tipo] || [];
      remanejamentoLinhas[tipo].push(criarLinhaRemanejamento(tipo, { quantidade: 1, meses: 6 }));
      renderLinhasRemanejamento(tipo);
      atualizarResumoRemanejamento();
    }

    function removerLinhaRemanejamento(tipo, id) {
      remanejamentoLinhas[tipo] = (remanejamentoLinhas[tipo] || []).filter(item => item.id !== id);
      if (!remanejamentoLinhas[tipo].length) {
        remanejamentoLinhas[tipo].push(criarLinhaRemanejamento(tipo, { quantidade: 1, meses: 6 }));
      }
      renderLinhasRemanejamento(tipo);
      atualizarResumoRemanejamento();
    }

    function atualizarCampoLinhaRemanejamento(tipo, id, campo, valor) {
      const linha = (remanejamentoLinhas[tipo] || []).find(item => item.id === id);
      if (!linha) return;

      if (campo === "idCargoFuncao") {
        const cadastro = obterCadastroCargoRemanejamento(valor);
        linha.idCargoFuncao = valor;
        linha.cargo = cadastro?.cargo || "";
        linha.vagasOciosas = Number(cadastro?.vagasOciosas || 0);
        linha.salarioBase = Number(cadastro?.salarioBase || 0);
        linha.insalubridadePericulosidade = Number(cadastro?.insalubridadePericulosidade || 0);
        linha.gratificacaoRt = Number(cadastro?.gratificacaoRt || 0);
        linha.adicionalNoturno = Number(cadastro?.adicionalNoturno || 0);
        linha.encargos = Number(cadastro?.encargos || 0);
        linha.provisoes = Number(cadastro?.provisoes || 0);
      } else if (["quantidade", "meses", "salarioBase", "insalubridadePericulosidade", "gratificacaoRt", "adicionalNoturno", "encargos", "provisoes"].includes(campo)) {
        linha[campo] = Number(valor || 0);
      } else {
        linha[campo] = valor;
      }

      atualizarResumoRemanejamento();
      renderLinhasRemanejamento(tipo);
    }

    function renderLinhasRemanejamento(tipo) {
      const body = document.getElementById(tipo === "reduzido" ? "remReduzidoBody" : "remAcrescentadoBody");
      if (!body) return;

      const rows = remanejamentoLinhas[tipo] || [];
      const opcoesCargo = montarOpcoesCargosRemanejamento();
      const optionsHtml = ['<option value="">Selecione</option>'].concat(opcoesCargo.map(opt => `<option value="${escapeAttr(opt.value)}">${escapeHtml(opt.label)}</option>`)).join("");

      body.innerHTML = rows.map(row => {
        const total = calcularTotalLinhaRemanejamento(row);
        const selectHtml = `<select onchange="atualizarCampoLinhaRemanejamento('${tipo}','${row.id}','idCargoFuncao',this.value)">${optionsHtml.replace(`value="${escapeAttr(row.idCargoFuncao)}"`, `value="${escapeAttr(row.idCargoFuncao)}" selected`)}</select>`;

        // Apenas para o lado reduzido: exibe vagas ociosas disponíveis e sinaliza quando falta.
        let infoOciosas = "";
        let classeLinha = "";
        if (tipo === "reduzido" && row.idCargoFuncao) {
          const ociosas = Math.max(0, Math.floor(Number(row.vagasOciosas || 0)));
          const solicitado = Math.max(0, Number(row.quantidade || 0));
          const excede = solicitado > ociosas;
          classeLinha = excede ? ' class="remLinhaInvalida"' : "";
          infoOciosas = `<div class="remOciosasInfo ${excede ? "remOciosasInfoErro" : ""}">${
            excede
              ? `⚠ Sem vaga ociosa suficiente: ${ociosas} disponível(is)`
              : `Vagas ociosas disponíveis: ${ociosas}`
          }</div>`;
        }

        return `
          <tr${classeLinha}>
            <td>${selectHtml}${infoOciosas}</td>
            <td><input type="number" min="0" step="1" value="${escapeAttr(row.quantidade)}" oninput="atualizarCampoLinhaRemanejamento('${tipo}','${row.id}','quantidade',this.value)"></td>
            <td><span class="remMesesValor" title="Meses do mês atual até dezembro (calculado automaticamente).">${escapeHtml(row.meses)}</span></td>
            <td><strong>${formatCurrency(total.total)}</strong></td>
            <td><button type="button" class="remDeleteBtn" onclick="removerLinhaRemanejamento('${tipo}','${row.id}')">🗑</button></td>
          </tr>
        `;
      }).join("");
    }

    // Verifica, no cliente, se há vagas ociosas suficientes para os cargos reduzidos.
    // Agrega por cargo (ID), pois várias linhas podem apontar para o mesmo cargo.
    function validarOciosasReduzidoCliente() {
      const porCargo = {};
      (remanejamentoLinhas.reduzido || []).forEach(linha => {
        if (!linha.idCargoFuncao) return;
        const id = String(linha.idCargoFuncao);
        if (!porCargo[id]) {
          porCargo[id] = { cargo: linha.cargo || `Cargo ${id}`, ociosas: Math.max(0, Math.floor(Number(linha.vagasOciosas || 0))), solicitado: 0 };
        }
        porCargo[id].solicitado += Math.max(0, Number(linha.quantidade || 0));
      });

      return Object.values(porCargo)
        .filter(item => item.solicitado > item.ociosas)
        .map(item => `${item.cargo}: ${item.ociosas} vaga(s) ociosa(s), solicitado ${item.solicitado}`);
    }

    function calcularTotalLinhaRemanejamento(row) {
      const quantidade = Math.max(0, Number(row.quantidade || 0));
      const meses = Math.max(1, Number(row.meses || 1));
      const salarioBase = Number(row.salarioBase || 0) * quantidade;
      const insalubridadePericulosidade = Number(row.insalubridadePericulosidade || 0) * quantidade;
      const gratificacaoRt = Number(row.gratificacaoRt || 0) * quantidade;
      const adicionalNoturno = Number(row.adicionalNoturno || 0) * quantidade;
      const encargos = Number(row.encargos || 0) * quantidade;
      const provisoes = Number(row.provisoes || 0) * quantidade;
      const mensal = salarioBase + insalubridadePericulosidade + gratificacaoRt + adicionalNoturno + encargos + provisoes;
      return { mensal, total: mensal * meses };
    }

    function coletarLinhasRemanejamento(tipo) {
      return (remanejamentoLinhas[tipo] || [])
        .map(item => ({
          ...item,
          idCargoFuncao: Number(item.idCargoFuncao || 0),
          quantidade: Number(item.quantidade || 0),
          meses: Math.max(1, Number(item.meses || 1)),
          salarioBase: Number(item.salarioBase || 0),
          insalubridadePericulosidade: Number(item.insalubridadePericulosidade || 0),
          gratificacaoRt: Number(item.gratificacaoRt || 0),
          adicionalNoturno: Number(item.adicionalNoturno || 0),
          encargos: Number(item.encargos || 0),
          provisoes: Number(item.provisoes || 0)
        }))
        .filter(item => item.idCargoFuncao || item.quantidade || item.salarioBase || item.encargos || item.provisoes);
    }

    function calcularResumoLinhasRemanejamento(items) {
      return (items || []).reduce((acc, item) => {
        const quantidade = Number(item.quantidade || 0);
        const meses = Math.max(1, Number(item.meses || 1));
        const salarioBase = Number(item.salarioBase || 0) * quantidade;
        const insalubridadePericulosidade = Number(item.insalubridadePericulosidade || 0) * quantidade;
        const gratificacaoRt = Number(item.gratificacaoRt || 0) * quantidade;
        const adicionalNoturno = Number(item.adicionalNoturno || 0) * quantidade;
        const encargos = Number(item.encargos || 0) * quantidade;
        const provisoes = Number(item.provisoes || 0) * quantidade;
        const mensal = salarioBase + insalubridadePericulosidade + gratificacaoRt + adicionalNoturno + encargos + provisoes;
        acc.salarioBase += salarioBase;
        acc.insalubridadePericulosidade += insalubridadePericulosidade;
        acc.gratificacaoRt += gratificacaoRt;
        acc.adicionalNoturno += adicionalNoturno;
        acc.encargos += encargos;
        acc.provisoes += provisoes;
        acc.mensal += mensal;
        acc.total += mensal * meses;
        return acc;
      }, { salarioBase: 0, insalubridadePericulosidade: 0, gratificacaoRt: 0, adicionalNoturno: 0, encargos: 0, provisoes: 0, mensal: 0, total: 0 });
    }

    function atualizarResumoRemanejamentoPainel() {
      const reduzidos = coletarLinhasRemanejamento("reduzido");
      const acrescentados = coletarLinhasRemanejamento("acrescentado");
      const red = calcularResumoLinhasRemanejamento(reduzidos);
      const add = calcularResumoLinhasRemanejamento(acrescentados);
      const impactoMensal = add.mensal - red.mensal;
      const impactoPeriodo = add.total - red.total;

      setText("remTotalReduzidoTopo", formatCurrency(red.mensal));
      setText("remTotalAcrescentadoTopo", formatCurrency(add.mensal));
      setText("remImpactoMensalTopo", formatCurrency(impactoMensal));
      setText("remImpactoPeriodoTopo", formatCurrency(impactoPeriodo));
      setText("remTotalReduzidoTabela", formatCurrency(red.total));
      setText("remTotalAcrescentadoTabela", formatCurrency(add.total));
      setText("remTotalReduzidoMensal", formatCurrency(red.mensal));
      setText("remTotalAcrescentadoMensal", formatCurrency(add.mensal));
      setText("remImpactoMensal2", formatCurrency(impactoMensal));
      setText("remImpactoPeriodo2", formatCurrency(impactoPeriodo));
      setText("remImpactoPeriodoMeses", String(mesesAteFimDoAno()));

      setText("remSalarioRed", formatCurrency(red.salarioBase));
      setText("remSalarioAdd", formatCurrency(add.salarioBase));
      setText("remSalarioImpacto", formatCurrency(add.salarioBase - red.salarioBase));
      setText("remInsalRed", formatCurrency(red.insalubridadePericulosidade));
      setText("remInsalAdd", formatCurrency(add.insalubridadePericulosidade));
      setText("remInsalImpacto", formatCurrency(add.insalubridadePericulosidade - red.insalubridadePericulosidade));
      setText("remRtRed", formatCurrency(red.gratificacaoRt));
      setText("remRtAdd", formatCurrency(add.gratificacaoRt));
      setText("remRtImpacto", formatCurrency(add.gratificacaoRt - red.gratificacaoRt));
      setText("remNoturnoRed", formatCurrency(red.adicionalNoturno));
      setText("remNoturnoAdd", formatCurrency(add.adicionalNoturno));
      setText("remNoturnoImpacto", formatCurrency(add.adicionalNoturno - red.adicionalNoturno));
      setText("remEncargoRed", formatCurrency(red.encargos));
      setText("remEncargoAdd", formatCurrency(add.encargos));
      setText("remEncargoImpacto", formatCurrency(add.encargos - red.encargos));
      setText("remProvisaoRed", formatCurrency(red.provisoes));
      setText("remProvisaoAdd", formatCurrency(add.provisoes));
      setText("remProvisaoImpacto", formatCurrency(add.provisoes - red.provisoes));
      setText("remResumoTotalRed", formatCurrency(red.mensal));
      setText("remResumoTotalAdd", formatCurrency(add.mensal));
      setText("remResumoTotalImpacto", formatCurrency(impactoMensal));

      ["remImpactoMensalTopo", "remImpactoPeriodoTopo", "remImpactoMensal2", "remImpactoPeriodo2", "remResumoTotalImpacto"].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const value = id.includes("Periodo") ? impactoPeriodo : impactoMensal;
        el.classList.toggle("remNegativo", value < 0);
        el.classList.toggle("remPositivo", value > 0);
      });

      return { red, add, impactoMensal, impactoPeriodo };
    }

    function limparFormularioRemanejamento() {
      remanejamentoLinhas = {
        reduzido: [criarLinhaRemanejamento("reduzido", { quantidade: 1, meses: 6 })],
        acrescentado: [criarLinhaRemanejamento("acrescentado", { quantidade: 1, meses: 6 })]
      };

      setValue("remanejamentoProcessoSei", "");
      setValue("remObservacao", "");

      const anexo = document.getElementById("remAnexoArquivo");
      if (anexo) anexo.value = "";

      renderLinhasRemanejamento("reduzido");
      renderLinhasRemanejamento("acrescentado");
      atualizarResumoRemanejamento();
    }

    async function salvarRemanejamentoPainel() {
      const idDseiCasai = document.getElementById("remanejamentoDsei")?.value || "";
      const processoSei = document.getElementById("remanejamentoProcessoSei")?.value || "";
      const observacao = document.getElementById("remObservacao")?.value || "";
      const anexo = document.getElementById("remAnexoArquivo")?.files?.[0] || null;
      const linhasReduzido = coletarLinhasRemanejamento("reduzido").filter(item => item.idCargoFuncao && item.quantidade > 0);
      const linhasAcrescentado = coletarLinhasRemanejamento("acrescentado").filter(item => item.idCargoFuncao && item.quantidade > 0);

      if (!idDseiCasai) {
        alert("Selecione o DSEI.");
        return;
      }
      if (!processoSei.trim()) {
        alert("Informe o número do Processo SEI.");
        return;
      }
      if (!linhasReduzido.length || !linhasAcrescentado.length) {
        alert("Informe ao menos um cargo reduzido e um cargo acrescentado.");
        return;
      }

      const errosOciosas = atualizarAvisoOciosasRemanejamento();
      if (errosOciosas.length) {
        alert(`Não é possível salvar: não há vagas ociosas suficientes para reduzir — ${errosOciosas.join("; ")}.`);
        return;
      }

      const resumo = atualizarResumoRemanejamentoPainel();
      if (resumo && (Number(resumo.impactoMensal || 0) > 0 || Number(resumo.impactoPeriodo || 0) > 0)) {
        alert("Remanejamento bloqueado: o impacto financeiro está positivo (aumento de custo). Ajuste os cargos para que o impacto fique zerado ou negativo.");
        return;
      }

      const formData = new FormData();
      formData.append("idDseiCasai", idDseiCasai);
      formData.append("processoSei", processoSei);
      formData.append("observacao", observacao);
      formData.append("criadoPor", "painel");
      formData.append("linhasReduzido", JSON.stringify(linhasReduzido));
      formData.append("linhasAcrescentado", JSON.stringify(linhasAcrescentado));
      if (anexo) formData.append("anexo", anexo);

      try {
        const response = await fetch("/api/remanejamento/salvar", {
          method: "POST",
          headers: painelLoginToken ? { Authorization: `Bearer ${painelLoginToken}` } : {},
          body: formData
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `Erro ${response.status}`);

        alert("Remanejamento salvo com sucesso.");
        limparFormularioRemanejamento();
        // Atualiza todos os dados afetados: lista de remanejamentos, vagas ociosas do
        // formulário, monitoramento, alertas e visão geral.
        recarregarTodosOsDados();
      } catch (error) {
        alert(`Erro ao salvar remanejamento: ${error && error.message ? error.message : error}`);
      }
    }


    function aplicarClasseResultado(id, value) {
      const el = document.getElementById(id);
      if (!el) return;

      el.classList.toggle("positivo", Number(value || 0) > 0);
      el.classList.toggle("negativo", Number(value || 0) < 0);
    }


    function formatCurrency(value) {
      return Number(value || 0).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL"
      });
    }

    function setValue(id, value) {
      const el = document.getElementById(id);
      if (el) el.value = value;
    }

    function valorCsv(value) {
      if (value === null || value === undefined) return "";
      return `"${String(value).replace(/"/g, '""')}"`;
    }

    function formatNumber(value) {
      return Number(value || 0).toLocaleString("pt-BR");
    }

    function formatPercent(value) {
      return `${Number(value || 0).toLocaleString("pt-BR", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
      })}%`;
    }

    function escapeHtml(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function escapeAttr(value) {
      return escapeHtml(value).replace(/`/g, "&#096;");
    }

    function escapeJs(value) {
      return String(value ?? "")
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
    }
  
