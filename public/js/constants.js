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

export const STATIC_FILTERS = {
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

export const REMANEJAMENTO_EMPTY_OPTION = { value: "", label: "Selecione" };

export const VAGAS_TABELA_CONFIG = {
  vagas: {
    bloco: "blocoTabelaVagas",
    titulo: "Vagas",
    subtitulo: "Detalhamento por DSEI/CASAI e cargo conforme filtros selecionados.",
    exportHtml: '<button type="button" class="exportBtn" data-click="exportar-vagas"><i class="fa-solid fa-download"></i> Exportar base filtrada</button><button type="button" class="exportBtn" data-click="exportar-pdf"><i class="fa-solid fa-file-pdf"></i> Salvar em PDF</button>',
    avisoHtml: '<div class="processoSeletivoAviso"><i class="fa-solid fa-circle-exclamation"></i> Os campos <strong>Normais</strong>, <strong>Substituições</strong> e <strong>Temporárias</strong> são apenas para informação e já estão atribuídos ao cálculo de <strong>Total de Trabalhadores</strong>.</div>'
  },
  ociosas: {
    bloco: "blocoTabelaOciosas",
    titulo: "Distribuição das Vagas Ociosas",
    subtitulo: "Normais/Temporárias, afastamento sem substituição e o total de vagas ociosas, conforme a visualização atual.",
    exportHtml: '<button type="button" class="exportBtn" data-click="exportar-distribuicao"><i class="fa-solid fa-download"></i> Exportar distribuição</button>',
    avisoHtml: '<div class="processoSeletivoAviso"><i class="fa-solid fa-circle-exclamation"></i> O campo <strong>Normais/Temporárias</strong> não considera os trabalhadores em substituições.</div>'
  },
  processo: {
    bloco: "blocoTabelaProcesso",
    titulo: "Vagas para Processo Seletivo",
    subtitulo: "Normais/Temporárias somadas às temporárias (total para processo seletivo).",
    exportHtml: '<button type="button" class="exportBtn" data-click="exportar-processo"><i class="fa-solid fa-download"></i> Exportar processo seletivo</button>',
    avisoHtml: '<div class="processoSeletivoSugestao"><i class="fa-solid fa-triangle-exclamation"></i><span><strong>ALERTA:</strong> É imprescindível verificar previamente junto ao DSEI a existência de vagas que necessitem ser reservadas para <strong>trabalhadoras gestantes</strong> vinculadas ao processo de transição. Caso sejam identificadas vagas nessa condição, estas deverão ser <strong>excluídas</strong> do quantitativo previsto para o processo seletivo, evitando inconsistências no planejamento das contratações e assegurando o cumprimento das obrigações institucionais aplicáveis.</span></div><div class="processoSeletivoSugestao"><i class="fa-solid fa-triangle-exclamation"></i><span><strong>Sugestão:</strong> Considerando a necessidade de resguardar a Administração quanto a possíveis inconsistências nos levantamentos ou eventuais ajustes posteriores, propõe-se que, <strong>para os cargos com quantitativo superior a 3 vagas previstas, seja reduzida 1 vaga para cada conjunto de 3 vagas existentes.</strong> Adicionalmente, recomenda-se que, sempre que possível, os processos seletivos sejam estruturados com previsão de cadastro de reserva, de modo a conferir maior flexibilidade à gestão das contratações e possibilitar o atendimento de demandas futuras sem a necessidade de abertura imediata de novos certames. As medidas visam criar uma margem de segurança para adequações posteriores, sem prejuízo à ampla concorrência e à continuidade da prestação dos serviços.</span></div><div class="processoSeletivoAviso"><i class="fa-solid fa-circle-exclamation"></i> O campo <strong>Normais/Temporárias</strong> não considera os trabalhadores em substituições.</div><div class="processoSeletivoAviso"><i class="fa-solid fa-circle-exclamation"></i> Não entram no cálculo do processo seletivo os cargos de provimento comunitário/indicação: <strong>Agente Indígena de Saúde</strong>, <strong>Agente Indígena de Saneamento</strong>, <strong>Assessor Técnico Indígena</strong> e <strong>Secretário do CONDISI</strong>.</div>'
  }
};

export const CARGOS_FORA_PROCESSO_SELETIVO = new Set([
  "AGENTE INDIGENA DE SAUDE",
  "AGENTE INDIGENA DE SANEAMENTO",
  "ASSESSOR TECNICO INDIGENA",
  "SECRETARIO DO CONDISI"
]);
