export const AUTO_REFRESH_MS = 5 * 60 * 1000; // Atualiza os dados a cada 5 minutos.

export const AUTO_FULL_RELOAD_MS = 60 * 60 * 1000; // Recarrega a página inteira a cada 60 minutos para manter estabilidade em tela fixa.

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
    exportHtml: '<button type="button" class="exportBtn" data-click="exportar-vagas"><i class="fa-solid fa-download"></i> Exportar base filtrada</button><button type="button" class="exportBtn" data-click="exportar-pdf">Salvar em PDF</button>',
    avisoHtml: '<div class="processoSeletivoAviso"><i class="fa-solid fa-circle-exclamation"></i> Os campos <strong>Substituições</strong> e <strong>Temporárias</strong> são apenas para informação e já estão atribuídos ao cálculo de <strong>Total de Trabalhadores</strong>.</div>'
  },
  ociosas: {
    bloco: "blocoTabelaOciosas",
    titulo: "Distribuição das Vagas Ociosas",
    subtitulo: "Vagas não ocupadas, afastamento sem substituição e o total de vagas ociosas, conforme a visualização atual.",
    exportHtml: '<button type="button" class="exportBtn" data-click="exportar-distribuicao"><i class="fa-solid fa-download"></i> Exportar distribuição</button>',
    avisoHtml: '<div class="processoSeletivoAviso"><i class="fa-solid fa-circle-exclamation"></i> O campo <strong>Vagas não ocupadas</strong> não considera os trabalhadores em substituições.</div>'
  },
  processo: {
    bloco: "blocoTabelaProcesso",
    titulo: "Vagas para Processo Seletivo",
    subtitulo: "Vagas não ocupadas somadas às temporárias (total para processo seletivo).",
    exportHtml: '<button type="button" class="exportBtn" data-click="exportar-processo"><i class="fa-solid fa-download"></i> Exportar processo seletivo</button>',
    avisoHtml: '<div class="processoSeletivoAviso"><i class="fa-solid fa-circle-exclamation"></i> O campo <strong>Vagas não ocupadas</strong> não considera os trabalhadores em substituições.</div><div class="processoSeletivoAviso"><i class="fa-solid fa-circle-exclamation"></i> Não entram no cálculo do processo seletivo os cargos de provimento comunitário/indicação: <strong>Agente Indígena de Saúde</strong>, <strong>Agente Indígena de Saneamento</strong>, <strong>Assessor Técnico Indígena</strong> e <strong>Secretário do CONDISI</strong>.</div>'
  }
};

export const CARGOS_FORA_PROCESSO_SELETIVO = new Set([
  "AGENTE INDIGENA DE SAUDE",
  "AGENTE INDIGENA DE SANEAMENTO",
  "ASSESSOR TECNICO INDIGENA",
  "SECRETARIO DO CONDISI"
]);
