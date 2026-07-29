export const COLORS = {
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

export const REMANEJAMENTO_EMPTY_OPTION = { value: "", label: "Selecione" };

// Duração padrão (em meses) de uma nova linha de remanejamento até o usuário ajustar.
export const REMANEJAMENTO_MESES_PADRAO = 6;

// Componentes do valor mensal de uma vaga (CUSTO_GERAL_VAGA), na MESMA ordem do
// backend (COMPONENTES_CUSTO_VAGA em lib/sql.js). Governam o "Resumo dos Valores
// (Mensal)", o detalhe do remanejamento e a soma do mensal de cada linha.
//   campo    -> nome do campo vindo da API
//   rotulo   -> texto exibido
//   idResumo -> sufixo dos ids da tabela de resumo (remXxxRed/Add/Impacto)
//   rotuloCurto -> cabeçalho na tabela de detalhe (mais estreita)
export const REMANEJAMENTO_COMPONENTES_CUSTO = [
  { campo: "salarioBase", rotulo: "Salários", idResumo: "Salario", rotuloCurto: "Salário" },
  { campo: "insalubridadePericulosidade", rotulo: "Insalubridade/Periculosidade", idResumo: "Insal", rotuloCurto: "Insal./Peric." },
  { campo: "gratificacaoRt", rotulo: "Gratificação RT", idResumo: "Rt", rotuloCurto: "Grat. RT" },
  { campo: "adicionalNoturno", rotulo: "Adicional Noturno", idResumo: "Noturno", rotuloCurto: "Noturno" },
  { campo: "encargos", rotulo: "Encargos", idResumo: "Encargo", rotuloCurto: "Encargos" },
  { campo: "provisoes", rotulo: "Provisões", idResumo: "Provisao", rotuloCurto: "Provisões" },
  { campo: "valeAlimentacao", rotulo: "Vale Alimentação", idResumo: "Vale", rotuloCurto: "Vale Alim." },
  { campo: "abonoEmergencial", rotulo: "Abono Emergencial", idResumo: "Abono", rotuloCurto: "Abono Emerg." },
  { campo: "trabalhoEmCampo", rotulo: "Trabalho em Campo", idResumo: "Campo", rotuloCurto: "Trab. Campo" },
  { campo: "captacaoMedica", rotulo: "Captação Médica", idResumo: "Captacao", rotuloCurto: "Capt. Médica" },
  { campo: "auxilioAreaRemota", rotulo: "Auxílio de Área Remota", idResumo: "Remota", rotuloCurto: "Aux. Área Remota" }
];

// Níveis de permissão POR MÓDULO (não há mais nível global). São apenas dicas de
// UI no front; o backend reaplica a regra por módulo a cada requisição.
//   1 = Leitor   2 = Editor   3 = Administrador (no módulo "solicitacoes" = super admin)
export const NIVEL = {
  APROVADO: 1,
  ADMIN: 2,
  SUPERADMIN: 3
};

export const VAGAS_TABELA_CONFIG = {
  vagas: {
    bloco: "blocoTabelaVagas",
    titulo: "Vagas",
    subtitulo: "Detalhamento por DSEI/CASAI e cargo conforme filtros selecionados.",
    exportHtml: '<button type="button" class="exportBtn" data-click="exportar-vagas"><i class="fa-solid fa-download"></i> Exportar base filtrada</button><button type="button" class="exportBtn" data-click="exportar-pdf"><i class="fa-solid fa-file-pdf"></i> Salvar em PDF</button>',
    avisoHtml: '<div class="processoSeletivoAviso"><i class="fa-solid fa-circle-exclamation"></i> <strong>Importante:</strong> As colunas de <strong>normais</strong>, <strong>substituiçôes</strong> e <strong>temporárias</strong> possuem caráter exclusivamente gerencial, detalhando a modalidade de ocupação das vagas. Essas informações <strong>NÃO</strong> compõem o cálculo das <strong>vagas ociosas</strong>, pois todos esses trabalhadores já estão considerados no quantitativo total de trabalhadores. Seu objetivo é apenas subsidiar a identificação da modalidade de provimento das vagas disponíveis.</div>'
  },
  ociosas: {
    bloco: "blocoTabelaOciosas",
    titulo: "Distribuição das Vagas Ociosas",
    subtitulo: "Normais/Temporárias, afastamento sem substituição e o total de vagas ociosas, conforme a visualização atual.",
    exportHtml: '<button type="button" class="exportBtn" data-click="exportar-distribuicao"><i class="fa-solid fa-download"></i> Exportar distribuição</button><button type="button" class="exportBtn" data-click="exportar-pdf"><i class="fa-solid fa-file-pdf"></i> Salvar em PDF</button>',
    avisoHtml: ''
  },
  processo: {
    bloco: "blocoTabelaProcesso",
    titulo: "Vagas para Processo Seletivo",
    subtitulo: "Normais/Temporárias somadas às temporárias (total para processo seletivo).",
    exportHtml: '<button type="button" class="exportBtn" data-click="exportar-processo"><i class="fa-solid fa-download"></i> Exportar processo seletivo</button><button type="button" class="exportBtn" data-click="exportar-pdf"><i class="fa-solid fa-file-pdf"></i> Salvar em PDF</button>',
    avisoHtml: '<div class="processoSeletivoSugestao"><i class="fa-solid fa-triangle-exclamation"></i><span><strong>ALERTA:</strong> É imprescindível verificar previamente junto ao DSEI a existência de vagas que necessitem ser reservadas para <strong>trabalhadoras gestantes</strong> vinculadas ao processo de transição. Caso sejam identificadas vagas nessa condição, estas deverão ser <strong>excluídas</strong> do quantitativo previsto para o processo seletivo, evitando inconsistências no planejamento das contratações e assegurando o cumprimento das obrigações institucionais aplicáveis.</span></div><div class="processoSeletivoSugestao"><i class="fa-solid fa-triangle-exclamation"></i><span><strong>Sugestão:</strong> Considerando a necessidade de resguardar a Administração quanto a possíveis inconsistências nos levantamentos ou eventuais ajustes posteriores, propõe-se que, <strong>para os cargos com quantitativo superior a 3 vagas previstas, seja reduzida 1 vaga para cada conjunto de 3 vagas existentes.</strong> Adicionalmente, recomenda-se que, sempre que possível, os processos seletivos sejam estruturados com previsão de cadastro de reserva, de modo a conferir maior flexibilidade à gestão das contratações e possibilitar o atendimento de demandas futuras sem a necessidade de abertura imediata de novos certames. As medidas visam criar uma margem de segurança para adequações posteriores, sem prejuízo à ampla concorrência e à continuidade da prestação dos serviços.</span></div><div class="processoSeletivoAviso"><i class="fa-solid fa-circle-exclamation"></i> Não entram no cálculo do processo seletivo os cargos de provimento comunitário/indicação: <strong>Agente Indígena de Saúde</strong>, <strong>Agente Indígena de Saneamento</strong>, <strong>Assessor Técnico Indígena</strong> e <strong>Secretário do CONDISI</strong>.</div>'
  }
};

export const CARGOS_FORA_PROCESSO_SELETIVO = new Set([
  "AGENTE INDIGENA DE SAUDE",
  "AGENTE INDIGENA DE SANEAMENTO",
  "ASSESSOR TECNICO INDIGENA",
  "SECRETARIO DO CONDISI"
]);
