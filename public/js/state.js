// Estado mutável compartilhado do painel.
// Centralizado num único objeto para poder ser reatribuído entre módulos
// (bindings importados não podem ser reatribuídos; propriedades de objeto sim).
export const state = {
  // Dados carregados / filtrados
  allRows: [],
  filteredRows: [],
  indicadoresResumoBase: null,
  vagasRows: [],
  alertasRows: [],
  vagasBaseRows: [],
  alertasBaseRows: [],

  // Observações de alertas
  observacoesAlertas: {},
  alertaObservacaoEditando: null,

  // Remanejamento
  remanejamentoListaRows: [],
  remanejamentoCadastroRows: [],
  remanejamentoDetalhePage: 1,
  remanejamentoLinhas: {
    reduzido: [],
    acrescentado: []
  },
  remanejamentoEditandoId: null,

  // Estado de visualização de vagas
  vagasViewAtual: "dsei",
  vagasTabelaAtual: "vagas",
  vagasSearchTerm: "",
  vagasSortState: { key: "label", direction: "asc" },
  vagasCurrentPage: 1,
  alertasCurrentPage: 1,

  // Navegação / filtros
  activeView: "visaoGeral",
  activeChartFilter: null,

  backgroundLoadStarted: false,

  // Painéis externos
  painelExternoCarregado: false,
  painelFeriasCarregado: false,
  DASHBOARD_SAUDE_INDIGENA_URL: "",
  DASHBOARD_FERIAS_URL: "",
  googleClientId: "",

  // Sessão / login
  painelLoginToken: "",
  painelLoginUsuario: null,
  painelIniciado: false
};
