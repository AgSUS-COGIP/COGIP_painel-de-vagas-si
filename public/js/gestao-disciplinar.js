// =========================================================
// Gestão Disciplinar (maquete interativa)
// Renderiza a tabela de pedidos disciplinares a partir de dados
// de exemplo, liga os filtros/botões e mostra o detalhamento do
// registro selecionado. É autocontido: registra os próprios
// ouvintes em configurarGestaoDisciplinar(), chamado no init do app.
// Não há backend — as ações operam sobre os dados em memória.
// Obs.: por padrão do painel, as pessoas são sempre "trabalhadores".
// =========================================================
import { escapeHtml, escapeAttr } from "./utils.js";
import { state } from "./state.js";

// ---------- Dados de exemplo ----------
// Cada item é um pedido disciplinar encaminhado por um DSEI. Os campos
// "detalhe*" alimentam o painel de detalhamento aberto ao clicar na linha.
const REGISTROS = [
  {
    processo: "25000.123456/2024-10", dsei: "Yanomami", trabalhador: "Maria Silva da Costa",
    cargo: "Enfermeiro", polo: "Polo Base Auaris", ocorrencia: "25/03/2024",
    pedido: "Advertência", status: "Em análise", atendimento: "Parcialmente",
    decisao: "Advertência", dataSancao: "10/04/2024", dataPedido: "10/04/2024",
    motivo: "Descumprimento de normas internas e falta de assiduidade.",
    medidaParcial: "Advertência formal e participação em capacitação obrigatória.",
    motivoNaoAtendimento: "—",
    resumo: "Pedido de advertência encaminhado pelo DSEI Yanomami em razão de descumprimento de normas internas e falta de assiduidade. Após análise, foi aplicada advertência formal e determinada a participação do trabalhador em capacitação obrigatória.",
    statusAtual: "Em análise", ultimaAtualizacao: "15/05/2024", observacoesStatus: "—",
    tipoSancao: "Advertência", dataAplicacao: "10/04/2024", aplicadaPor: "Coordenação Distrital",
    documento: "Termo de Advertência nº 05/2024", comprovante: "Termo_Advertencia_05_2024.pdf",
    observacoesSancao: "Advertência registrada no prontuário do trabalhador.",
    anexos: [{ nome: "Oficio_DSEI_Yanomami_GD001_2024.pdf", info: "PDF · 256 KB", data: "10/04/2024" }]
  },
  {
    processo: "25000.123457/2024-30", dsei: "Alto Rio Negro", trabalhador: "João Pereira Lima",
    cargo: "Técnico de Enfermagem", polo: "Polo Base São Gabriel", ocorrencia: "25/03/2024",
    pedido: "Suspensão", status: "Aguardando devolutiva do DSEI", atendimento: "Totalmente",
    decisao: "Suspensão", dataSancao: "12/04/2024", dataPedido: "12/04/2024",
    motivo: "Abandono de posto durante escala em área indígena.",
    medidaParcial: "—",
    motivoNaoAtendimento: "—",
    resumo: "Pedido de suspensão encaminhado pelo DSEI Alto Rio Negro por abandono de posto durante escala. Sanção aplicada integralmente; aguardando devolutiva do DSEI quanto ao cumprimento.",
    statusAtual: "Aguardando devolutiva do DSEI", ultimaAtualizacao: "30/04/2024", observacoesStatus: "Devolutiva solicitada ao DSEI em 25/04/2024.",
    tipoSancao: "Suspensão (3 dias)", dataAplicacao: "12/04/2024", aplicadaPor: "Coordenação Distrital",
    documento: "Termo de Suspensão nº 02/2024", comprovante: "Termo_Suspensao_02_2024.pdf",
    observacoesSancao: "Suspensão de 3 dias registrada no prontuário do trabalhador.",
    anexos: [{ nome: "Oficio_DSEI_AltoRioNegro_GD002_2024.pdf", info: "PDF · 312 KB", data: "12/04/2024" }]
  },
  {
    processo: "25000.123458/2024-71", dsei: "Kayapó do Pará", trabalhador: "Carlos Mendes dos Santos",
    cargo: "Agente Indígena de Saúde", polo: "Polo Base Tucumã", ocorrencia: "11/03/2024",
    pedido: "Justa Causa", status: "Concluída", atendimento: "Não atendido",
    decisao: "Justa Causa", dataSancao: "15/04/2024", dataPedido: "15/04/2024",
    motivo: "Reincidência em faltas graves e insubordinação.",
    medidaParcial: "—",
    motivoNaoAtendimento: "Ausência de provas documentais suficientes para a rescisão por justa causa.",
    resumo: "Pedido de rescisão por justa causa encaminhado pelo DSEI Kayapó do Pará. Após análise jurídica, o pedido não foi atendido por insuficiência de provas documentais.",
    statusAtual: "Concluída", ultimaAtualizacao: "28/04/2024", observacoesStatus: "Processo encerrado sem aplicação de justa causa.",
    tipoSancao: "Não aplicada", dataAplicacao: "—", aplicadaPor: "—",
    documento: "Parecer Jurídico nº 11/2024", comprovante: "Parecer_Juridico_11_2024.pdf",
    observacoesSancao: "Recomendada nova advertência formal em substituição.",
    anexos: [{ nome: "Oficio_DSEI_Kayapo_GD003_2024.pdf", info: "PDF · 198 KB", data: "15/04/2024" }]
  },
  {
    processo: "25000.123459/2024-05", dsei: "Leste de Roraima", trabalhador: "Ana Beatriz Souza",
    cargo: "Enfermeiro", polo: "Polo Base Surucucu", ocorrencia: "28/03/2024",
    pedido: "Suspensão", status: "Pendente", atendimento: "—",
    decisao: "Não foi aplicado", dataSancao: "—", dataPedido: "18/04/2024",
    motivo: "Conduta inadequada no atendimento à comunidade.",
    medidaParcial: "—",
    motivoNaoAtendimento: "—",
    resumo: "Pedido de suspensão encaminhado pelo DSEI Leste de Roraima. Em fila de análise pela coordenação; sanção ainda não definida.",
    statusAtual: "Pendente", ultimaAtualizacao: "20/04/2024", observacoesStatus: "Aguardando distribuição para análise.",
    tipoSancao: "—", dataAplicacao: "—", aplicadaPor: "—",
    documento: "—", comprovante: "",
    observacoesSancao: "—",
    anexos: [{ nome: "Oficio_DSEI_LesteRoraima_GD004_2024.pdf", info: "PDF · 221 KB", data: "18/04/2024" }]
  },
  {
    processo: "25000.123460/2024-16", dsei: "Maranhão", trabalhador: "Rafael Oliveira",
    cargo: "Técnico de Enfermagem", polo: "Polo Base Amarante", ocorrencia: "05/04/2024",
    pedido: "Advertência", status: "Em análise", atendimento: "Parcialmente",
    decisao: "Advertência", dataSancao: "20/04/2024", dataPedido: "20/04/2024",
    motivo: "Atrasos recorrentes no início da jornada.",
    medidaParcial: "Advertência verbal formalizada e plano de adequação de jornada.",
    motivoNaoAtendimento: "—",
    resumo: "Pedido de advertência encaminhado pelo DSEI Maranhão por atrasos recorrentes. Aplicada advertência com plano de adequação de jornada.",
    statusAtual: "Em análise", ultimaAtualizacao: "22/04/2024", observacoesStatus: "—",
    tipoSancao: "Advertência", dataAplicacao: "20/04/2024", aplicadaPor: "Coordenação Distrital",
    documento: "Termo de Advertência nº 06/2024", comprovante: "Termo_Advertencia_06_2024.pdf",
    observacoesSancao: "Advertência registrada no prontuário do trabalhador.",
    anexos: [{ nome: "Oficio_DSEI_Maranhao_GD005_2024.pdf", info: "PDF · 264 KB", data: "20/04/2024" }]
  },
  {
    processo: "25000.123461/2024-64", dsei: "Parintins", trabalhador: "Luana Ferreira",
    cargo: "Enfermeiro", polo: "Polo Base Parintins", ocorrencia: "10/04/2024",
    pedido: "Suspensão", status: "Concluída", atendimento: "Totalmente",
    decisao: "Suspensão", dataSancao: "22/04/2024", dataPedido: "22/04/2024",
    motivo: "Quebra de protocolo de biossegurança.",
    medidaParcial: "—",
    motivoNaoAtendimento: "—",
    resumo: "Pedido de suspensão encaminhado pelo DSEI Parintins por quebra de protocolo de biossegurança. Sanção aplicada integralmente e processo concluído.",
    statusAtual: "Concluída", ultimaAtualizacao: "26/04/2024", observacoesStatus: "Cumprimento confirmado pelo DSEI.",
    tipoSancao: "Suspensão (5 dias)", dataAplicacao: "22/04/2024", aplicadaPor: "Coordenação Distrital",
    documento: "Termo de Suspensão nº 03/2024", comprovante: "Termo_Suspensao_03_2024.pdf",
    observacoesSancao: "Suspensão de 5 dias registrada no prontuário do trabalhador.",
    anexos: [{ nome: "Oficio_DSEI_Parintins_GD006_2024.pdf", info: "PDF · 287 KB", data: "22/04/2024" }]
  },
  {
    processo: "25000.123462/2024-89", dsei: "Xingu", trabalhador: "Paulo Henrique Dias",
    cargo: "Agente Indígena de Saúde", polo: "Polo Base Gaúcha do Norte", ocorrencia: "22/03/2024",
    pedido: "Justa Causa", status: "Aguardando devolutiva do DSEI", atendimento: "Não atendido",
    decisao: "Justa Causa", dataSancao: "25/04/2024", dataPedido: "25/04/2024",
    motivo: "Apropriação indevida de insumos da unidade.",
    medidaParcial: "—",
    motivoNaoAtendimento: "Necessidade de apuração complementar pelo DSEI antes da decisão final.",
    resumo: "Pedido de rescisão por justa causa encaminhado pelo DSEI Xingu. Aguardando devolutiva do DSEI com apuração complementar.",
    statusAtual: "Aguardando devolutiva do DSEI", ultimaAtualizacao: "02/05/2024", observacoesStatus: "Apuração complementar solicitada ao DSEI.",
    tipoSancao: "Em apuração", dataAplicacao: "—", aplicadaPor: "—",
    documento: "Memorando nº 14/2024", comprovante: "Memorando_14_2024.pdf",
    observacoesSancao: "Decisão suspensa até a devolutiva do DSEI.",
    anexos: [{ nome: "Oficio_DSEI_Xingu_GD007_2024.pdf", info: "PDF · 309 KB", data: "25/04/2024" }]
  }
];

// ---------- Diretório de trabalhadores (auto-preenchimento) ----------
// Ao selecionar/digitar o nome no formulário, puxa cargo, matrícula,
// DSEI/CASAI e polo. Inclui os trabalhadores já presentes nos registros
// de exemplo e alguns extras para demonstrar a busca.
const DIRETORIO = [
  { nome: "Maria Silva da Costa", cargo: "Enfermeiro", matricula: "100245", dsei: "Yanomami", polo: "Polo Base Auaris" },
  { nome: "João Pereira Lima", cargo: "Técnico de Enfermagem", matricula: "100312", dsei: "Alto Rio Negro", polo: "Polo Base São Gabriel" },
  { nome: "Carlos Mendes dos Santos", cargo: "Agente Indígena de Saúde", matricula: "100487", dsei: "Kayapó do Pará", polo: "Polo Base Tucumã" },
  { nome: "Ana Beatriz Souza", cargo: "Enfermeiro", matricula: "100519", dsei: "Leste de Roraima", polo: "Polo Base Surucucu" },
  { nome: "Rafael Oliveira", cargo: "Técnico de Enfermagem", matricula: "100634", dsei: "Maranhão", polo: "Polo Base Amarante" },
  { nome: "Luana Ferreira", cargo: "Enfermeiro", matricula: "100721", dsei: "Parintins", polo: "Polo Base Parintins" },
  { nome: "Paulo Henrique Dias", cargo: "Agente Indígena de Saúde", matricula: "100808", dsei: "Xingu", polo: "Polo Base Gaúcha do Norte" },
  { nome: "Fernanda Ribeiro Alves", cargo: "Médico Clínico Geral", matricula: "100915", dsei: "CASAI Boa Vista", polo: "CASAI Boa Vista" },
  { nome: "Bruno Carvalho Nunes", cargo: "Odontólogo", matricula: "101003", dsei: "CASAI Manaus", polo: "CASAI Manaus" },
  { nome: "Patrícia Gomes Teixeira", cargo: "Téc. de Enfermagem", matricula: "101129", dsei: "Médio Rio Purus", polo: "Polo Base Lábrea" }
];

// Atribui a matrícula aos registros de exemplo a partir do diretório.
REGISTROS.forEach(r => {
  const d = DIRETORIO.find(x => x.nome === r.trabalhador);
  if (d && !r.matricula) r.matricula = d.matricula;
});

// Lista de DSEIs/CASAIs oferecida no formulário (digitável e selecionável).
const DSEIS_CASAIS = [...new Set([
  ...DIRETORIO.map(d => d.dsei),
  "DSEI Médio Rio Solimões", "DSEI Vale do Javari", "CASAI Tabatinga"
])];

// ---------- Mapas de classe das badges ----------
const BADGE_STATUS = {
  "Em análise": "is-analise",
  "Aguardando devolutiva do DSEI": "is-aguardando",
  "Concluída": "is-concluida",
  "Pendente": "is-pendente",
  "Desligado antes da conclusão": "is-desligado",
  "Pedido fora do prazo": "is-foraprazo"
};
const BADGE_ATENDIMENTO = {
  "Totalmente": "is-total",
  "Parcialmente": "is-parcial",
  "Não atendido": "is-naoatendido"
};

// ---------- Fases do processo (funil linear, padrão da Entrega de Crachá) ----------
// As fases avançam uma a uma; não é possível pular etapas. "Desligado antes da
// conclusão" é um estado terminal alternativo (trabalhador desligado no meio).
const STATUS_FASES = ["Pendente", "Em análise", "Aguardando devolutiva do DSEI", "Concluída"];
const STATUS_DESLIGADO = "Desligado antes da conclusão";
// "Pedido fora do prazo" é um status terminal que BLOQUEIA o processo (sem fases).
const STATUS_FORA_PRAZO = "Pedido fora do prazo";
// Rótulo do botão que AVANÇA a partir de cada fase.
const AVANCO_LABEL = {
  "Pendente": "Assumir processo",
  "Em análise": "Enviar para devolutiva do DSEI",
  "Aguardando devolutiva do DSEI": "Concluir processo"
};

// Marca foraDoPrazo nos registros mockados a partir das datas (pedido cadastrado
// mais de 30 dias após a ocorrência). dataBr é hoisteada (declaração de função).
REGISTROS.forEach(r => {
  if (r.foraDoPrazo === undefined) {
    const o = dataBr(r.ocorrencia);
    const p = dataBr(r.dataPedido);
    r.foraDoPrazo = !!(o && p && (p - o) / 86400000 > 30);
  }
  // Fora do prazo é um status terminal: trava o processo nesse estado.
  if (r.foraDoPrazo) { r.statusAtual = STATUS_FORA_PRAZO; r.status = STATUS_FORA_PRAZO; }
});

// Opções para edição em linha no detalhamento.
const STATUS_OPCOES = ["Em análise", "Aguardando devolutiva do DSEI", "Concluída", "Pendente"];
const ATENDIMENTO_OPCOES = ["—", "Totalmente", "Parcialmente", "Não atendido"];

// Tipo de Sanção: somente as sanções aplicáveis.
const SANCAO_OPCOES = ["Advertência oral", "Advertência", "Suspensão (3 dias)", "Suspensão (5 dias)",
  "Justa Causa", "Não aplicada", "Em apuração", "—"];

// Decisão: somente o artigo e as alíneas do Art. 482 da CLT (hipóteses de justa causa).
const DECISAO_OPCOES = [
  "—",
  "Art. 482, a) Ato de improbidade",
  "Art. 482, b) Incontinência de conduta ou mau procedimento",
  "Art. 482, c) Negociação habitual sem permissão ou concorrência à empresa",
  "Art. 482, d) Condenação criminal transitada em julgado",
  "Art. 482, e) Desídia no desempenho das funções",
  "Art. 482, f) Embriaguez habitual ou em serviço",
  "Art. 482, g) Violação de segredo da empresa",
  "Art. 482, h) Ato de indisciplina ou de insubordinação",
  "Art. 482, i) Abandono de emprego",
  "Art. 482, j) Ato lesivo da honra ou ofensas físicas (contra terceiros)",
  "Art. 482, k) Ato lesivo da honra ou ofensas físicas (contra empregador/superiores)",
  "Art. 482, l) Prática constante de jogos de azar",
  "Art. 482, m) Perda da habilitação por conduta dolosa"
];

// Campos editáveis em linha no detalhamento. Cada um define: rótulo na confirmação,
// chave(s) do registro a atualizar (a 1ª é a "fonte" do valor atual), o tipo de
// controle e o aviso de sucesso. "dataSancao" mantém dataSancao+dataAplicacao em sincronia.
const CAMPOS_EDITAVEIS = {
  status: { rotulo: "o status da demanda", chaves: ["statusAtual", "status"], tipo: "select", opcoes: STATUS_OPCOES, toast: "Status da demanda atualizado." },
  sancao: { rotulo: "a sanção aplicada", chaves: ["tipoSancao"], tipo: "select", opcoes: SANCAO_OPCOES, toast: "Sanção aplicada atualizada." },
  atendimento: { rotulo: "o atendimento", chaves: ["atendimento"], tipo: "select", opcoes: ATENDIMENTO_OPCOES, toast: "Atendimento atualizado." },
  decisao: { rotulo: "o motivo", chaves: ["decisao"], tipo: "select", opcoes: DECISAO_OPCOES, toast: "Motivo atualizado." },
  dataSancao: { rotulo: "a data de aplicação da sanção", chaves: ["dataSancao", "dataAplicacao"], tipo: "data", toast: "Data de aplicação da sanção atualizada." },
  medidaParcial: { rotulo: "a medida adotada", chaves: ["medidaParcial"], tipo: "texto", toast: "Medida adotada atualizada." },
  motivoNaoAtendimento: { rotulo: "o motivo do não atendimento", chaves: ["motivoNaoAtendimento"], tipo: "texto", toast: "Motivo do não atendimento atualizado." },
  observacoesStatus: { rotulo: "as observações do status", chaves: ["observacoesStatus"], tipo: "texto", toast: "Observações do status atualizadas." },
  observacoesSancao: { rotulo: "as observações da sanção", chaves: ["observacoesSancao"], tipo: "texto", toast: "Observações da sanção atualizadas." }
};

// Permissão para editar os campos do detalhamento.
// TODO: trocar pelo nível de acesso específico da Gestão Disciplinar quando ele
// for criado. Por ora, libera a edição para usuários autenticados com nível >= 1.
const NIVEL_EDITAR_DISCIPLINAR = 1;
function podeEditarGestaoDisciplinar() {
  const nivel = Number(state.painelLoginUsuario?.nivelAutorizacao || 0);
  return nivel >= NIVEL_EDITAR_DISCIPLINAR;
}

// Indicadores restritos a administradores (nível >= 2, mesmo patamar das telas de admin).
const NIVEL_ADMIN_DISCIPLINAR = 2;
function ehAdminDisciplinar() {
  return Number(state.painelLoginUsuario?.nivelAutorizacao || 0) >= NIVEL_ADMIN_DISCIPLINAR;
}

// Mostra/oculta os cards restritos a admin (ex.: "Tempo Médio p/ Aplicação da Sanção").
// O grid de indicadores reflui sozinho ao ocultar um card.
function aplicarVisibilidadeCardsDisciplinar() {
  const card = document.getElementById("gdKpiTempoMedio");
  if (card) card.style.display = ehAdminDisciplinar() ? "" : "none";
}

// Login do usuário logado para vincular como responsável. Se for um e-mail,
// usa só a parte antes do "@".
function loginResponsavel() {
  const u = state.painelLoginUsuario || {};
  const base = String(u.login || u.email || u.nome || "").trim();
  return base.includes("@") ? base.split("@")[0] : base;
}

function badge(texto, mapa) {
  if (!texto || texto === "—") return "—";
  const cls = mapa[texto] || "is-pendente";
  return `<span class="gfBadge ${cls}">${escapeHtml(texto)}</span>`;
}

const $ = id => document.getElementById(id);

// ---------- Toast simples ----------
let toastTimer = null;
function gdToast(mensagem, tipo) {
  let el = $("gdToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "gdToast";
    el.className = "gfToast";
    document.body.appendChild(el);
  }
  el.textContent = mensagem;
  el.classList.remove("is-erro", "is-ok");
  el.classList.add(tipo === "erro" ? "is-erro" : "is-ok", "show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

// ---------- Filtros ----------
function preencherFiltros() {
  const opcoes = (sel, valores, rotuloTodos) => {
    const el = $(sel);
    if (!el) return;
    el.innerHTML = `<option value="">${rotuloTodos}</option>` +
      valores.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
  };
  const unicos = chave => [...new Set(REGISTROS.map(r => r[chave]).filter(v => v && v !== "—"))];
  opcoes("gdFiltroDsei", unicos("dsei"), "Todos os DSEIs/CASAIs");
  opcoes("gdFiltroStatus", unicos("status"), "Todos os Status");
}

// Popula as listas de autocompletar do formulário de novo registro.
function preencherDatalists() {
  const dseis = $("gdListaDseis");
  if (dseis) dseis.innerHTML = DSEIS_CASAIS.map(v => `<option value="${escapeHtml(v)}">`).join("");
  const trab = $("gdListaTrabalhadores");
  if (trab) trab.innerHTML = DIRETORIO.map(d => `<option value="${escapeHtml(d.nome)}">${escapeHtml(d.cargo)} · ${escapeHtml(d.dsei)}</option>`).join("");
}

// Converte "dd/mm/aaaa" para Date (para comparar com os inputs de data).
function dataBr(str) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(str || "").trim());
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

// Filtro rápido "processos em que eu sou o responsável".
let filtroMeusProcessos = false;

function registrosFiltrados() {
  const dsei = $("gdFiltroDsei")?.value || "";
  const status = $("gdFiltroStatus")?.value || "";
  const ini = $("gdFiltroDataIni")?.value ? new Date($("gdFiltroDataIni").value) : null;
  const fim = $("gdFiltroDataFim")?.value ? new Date($("gdFiltroDataFim").value) : null;
  const buscaNome = ($("gdBuscaNome")?.value || "").trim().toLowerCase();
  const buscaPedido = ($("gdBuscaPedido")?.value || "").trim().toLowerCase();
  const buscaResp = ($("gdBuscaResponsavel")?.value || "").trim().toLowerCase();
  const meuLogin = filtroMeusProcessos ? loginResponsavel() : "";

  return REGISTROS.filter(r => {
    if (filtroMeusProcessos && r.responsavel !== meuLogin) return false;
    if (dsei && r.dsei !== dsei) return false;
    if (status && r.status !== status) return false;
    if (buscaNome && !r.trabalhador.toLowerCase().includes(buscaNome)) return false;
    if (buscaResp && !String(r.responsavel || "").toLowerCase().includes(buscaResp)) return false;
    if (buscaPedido) {
      const alvo = `${r.processo} ${r.pedido} ${r.motivo}`.toLowerCase();
      if (!alvo.includes(buscaPedido)) return false;
    }
    const dataPedido = dataBr(r.dataPedido);
    if (ini && dataPedido && dataPedido < ini) return false;
    if (fim && dataPedido && dataPedido > fim) return false;
    return true;
  });
}

// ---------- Renderização da tabela ----------
let processoSelecionado = REGISTROS[0].processo;

function renderTabela() {
  const body = $("gdTableBody");
  const info = $("gdTableInfo");
  if (!body) return;
  const linhas = registrosFiltrados();

  body.innerHTML = linhas.map(r => `
    <tr class="gdRow${r.processo === processoSelecionado ? " is-selected" : ""}" data-gd-processo="${escapeHtml(r.processo)}">
      <td>${escapeHtml(r.processo)}</td>
      <td>${escapeHtml(r.dsei)}</td>
      <td>${escapeHtml(r.trabalhador)}</td>
      <td>${escapeHtml(r.cargo)}</td>
      <td>${escapeHtml(r.polo)}</td>
      <td>${escapeHtml(r.ocorrencia)}</td>
      <td>${escapeHtml(r.pedido)}</td>
      <td>${badge(r.status, BADGE_STATUS)}</td>
      <td>${badge(r.atendimento, BADGE_ATENDIMENTO)}</td>
      <td>${escapeHtml(r.tipoSancao || "—")}</td>
      <td>${escapeHtml(r.dataSancao)}</td>
      <td>${escapeHtml(r.dataPedido)}</td>
      <td>${escapeHtml(r.responsavel || "—")}</td>
    </tr>`).join("") ||
    `<tr><td colspan="13" class="gfTd-center">Nenhum registro para os filtros selecionados.</td></tr>`;

  if (info) info.textContent = `Mostrando ${linhas.length} de ${REGISTROS.length} pedidos`;
}

// ---------- Detalhamento do registro selecionado ----------
function kv(rotulo, valor) {
  return `<div class="gdKv"><span>${escapeHtml(rotulo)}</span><strong>${escapeHtml(valor || "—")}</strong></div>`;
}

// "dd/mm/aaaa" -> "aaaa-mm-dd" (para preencher <input type="date">). Vazio se não casar.
function brParaIso(valor) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(valor || "").trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

// <select> de edição em linha; garante que o valor atual esteja entre as opções.
function gdSelect(campo, valor, opcoes) {
  const lista = [...new Set([valor, ...opcoes].filter(v => v != null && v !== ""))];
  const opts = lista.map(o =>
    `<option value="${escapeHtml(o)}"${o === valor ? " selected" : ""}>${escapeHtml(o)}</option>`).join("");
  return `<select class="gdEditField" data-gd-campo="${campo}">${opts}</select>`;
}

// Renderiza um campo do detalhamento: editável (controle conforme o tipo) quando há
// permissão, ou somente leitura (kv) caso contrário.
function campoEditavel(rotulo, campo, valor, podeEditar) {
  if (!podeEditar) return kv(rotulo, valor);
  const cfg = CAMPOS_EDITAVEIS[campo];
  let controle;
  if (cfg.tipo === "select") {
    controle = gdSelect(campo, valor, cfg.opcoes);
  } else if (cfg.tipo === "data") {
    controle = `<input type="date" class="gdEditField" data-gd-campo="${campo}" value="${escapeHtml(brParaIso(valor))}">`;
  } else {
    const v = valor && valor !== "—" ? valor : "";
    controle = `<input type="text" class="gdEditField" data-gd-campo="${campo}" value="${escapeHtml(v)}" placeholder="—">`;
  }
  return `<div class="gdKv gdKvEdit"><span>${escapeHtml(rotulo)}</span>${controle}</div>`;
}

function renderDetalhe(processo) {
  const r = REGISTROS.find(x => x.processo === processo) || REGISTROS[0];
  processoSelecionado = r.processo;
  const podeEditar = podeEditarGestaoDisciplinar();

  const titulo = $("gdDetTitulo");
  if (titulo) {
    const meuLogin = loginResponsavel();
    const ehResp = !!r.responsavel && r.responsavel === meuLogin;
    const respLabel = r.responsavel && !ehResp
      ? `<span class="gdRespAtual"><i class="fa-solid fa-user-check"></i> Resp.: ${escapeHtml(r.responsavel)}</span>`
      : "";
    titulo.innerHTML = `
      <span class="gdDetTituloTxt">${escapeHtml(r.processo)} — ${escapeHtml(r.trabalhador)} ${badge(r.statusAtual, BADGE_STATUS)}</span>
      <span class="gdDetTituloAcoes">
        ${respLabel}
        <button type="button" class="gfBtn gdAssumirBtn" data-gd-assumir="${escapeAttr(r.processo)}"${ehResp ? " disabled" : ""}>
          <i class="fa-solid fa-user-shield"></i> ${ehResp ? "Você é o responsável" : "Assumir a responsabilidade"}
        </button>
      </span>`;
  }

  const dados = $("gdDetDados");
  if (dados) {
    dados.innerHTML =
      kv("Trabalhador", r.trabalhador) +
      kv("Matrícula", r.matricula) +
      kv("Cargo", r.cargo) +
      kv("DSEI/CASAI", r.dsei) +
      kv("Polo Base", r.polo) +
      kv("Pedido", r.pedido) +
      kv("Data da Ocorrência", r.ocorrencia) +
      kv("Data do Pedido", r.dataPedido) +
      campoEditavel("Atendimento", "atendimento", r.atendimento, podeEditar) +
      campoEditavel("Medida adotada (parcial)", "medidaParcial", r.medidaParcial, podeEditar) +
      campoEditavel("Motivo do não atendimento", "motivoNaoAtendimento", r.motivoNaoAtendimento, podeEditar) +
      kv("Nº do Processo SEI", r.processo) +
      `<div class="gdResumo"><span>Resumo do processo</span><p>${escapeHtml(r.resumo)}</p></div>`;
  }

  const statusBox = $("gdDetStatus");
  if (statusBox) {
    const idxFase = STATUS_FASES.indexOf(r.statusAtual);
    const desligado = r.statusAtual === STATUS_DESLIGADO;
    const bloqueado = r.statusAtual === STATUS_FORA_PRAZO; // terminal: trava o processo
    const concluido = r.statusAtual === "Concluída";

    const linhaStatus = `<div class="gdKv"><span>Status atual</span><strong>${badge(r.statusAtual, BADGE_STATUS)}</strong></div>`;

    let stepper = "";
    let acoes = "";
    let avisoBloqueio = "";

    if (bloqueado) {
      // Pedido fora do prazo: processo bloqueado, sem fases nem ações.
      avisoBloqueio = `<div class="gdKv"><span>Situação</span><strong><span class="gdTagPrazo"><i class="fa-solid fa-lock"></i> Processo bloqueado — pedido fora do prazo</span></strong></div>`;
    } else {
      // Linha do tempo das fases (não é possível pular etapas).
      stepper = `<div class="gdStepper">` + STATUS_FASES.map((f, i) => {
        const cls = desligado ? "" : (i === idxFase ? "is-atual" : (idxFase > i ? "is-feito" : ""));
        return `<span class="gdStep ${cls}">${i + 1}. ${escapeHtml(f)}</span>`;
      }).join("") + `</div>`;

      // Ações de fase (padrão da Entrega de Crachá: só a transição válida é habilitada).
      if (podeEditar) {
        if (desligado) {
          acoes = `<button type="button" class="gfBtn gfBtnGhost gdFaseBtn" data-gd-fase="reativar"><i class="fa-solid fa-rotate-left"></i> Reativar processo</button>`;
        } else {
          const proximo = idxFase >= 0 && idxFase < STATUS_FASES.length - 1 ? STATUS_FASES[idxFase + 1] : null;
          const btnAvancar = proximo
            ? `<button type="button" class="gfBtn gdFaseBtn" data-gd-fase="avancar"><i class="fa-solid fa-arrow-right"></i> ${escapeHtml(AVANCO_LABEL[r.statusAtual] || `Avançar para ${proximo}`)}</button>`
            : "";
          const btnVoltar = idxFase > 0
            ? `<button type="button" class="gfBtn gfBtnGhost gdFaseBtn" data-gd-fase="voltar"><i class="fa-solid fa-arrow-left"></i> Voltar fase</button>`
            : "";
          const btnDeslig = !concluido
            ? `<button type="button" class="gfBtn gdFaseBtn gdBtnDesligar" data-gd-fase="desligar"><i class="fa-solid fa-user-xmark"></i> Desligado antes da conclusão</button>`
            : "";
          acoes = btnAvancar + btnVoltar + btnDeslig;
        }
        acoes = `<div class="gdFaseAcoes">${acoes}</div>`;
      }
    }

    statusBox.innerHTML =
      linhaStatus +
      avisoBloqueio +
      stepper +
      acoes +
      kv("Última atualização", r.ultimaAtualizacao) +
      kv("Data do pedido", r.dataPedido) +
      campoEditavel("Observações", "observacoesStatus", r.observacoesStatus, podeEditar);
  }

  const sancao = $("gdDetSancao");
  if (sancao) {
    const comprovanteChip = r.comprovante
      ? `<div class="gfFileChip"><i class="fa-solid fa-file-pdf"></i><span>${escapeHtml(r.comprovante)}</span>${
          r.comprovanteUrl
            ? `<a class="gfIconBtn" href="${escapeAttr(r.comprovanteUrl)}" target="_blank" rel="noopener noreferrer" title="Abrir"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>`
            : `<button class="gfIconBtn" data-gd-baixar="${escapeHtml(r.comprovante)}" title="Baixar"><i class="fa-solid fa-download"></i></button>`
        }</div>`
      : `<div class="gdKv"><span>Comprovante (anexo)</span><strong>—</strong></div>`;
    const comprovanteUpload = podeEditar
      ? `<label class="gdUploadTermo"><i class="fa-solid fa-upload"></i> ${r.comprovante ? "Substituir termo (PDF)" : "Enviar termo (PDF)"}<input type="file" accept="application/pdf" data-gd-upload="comprovante" hidden></label>`
      : "";
    sancao.innerHTML =
      campoEditavel("Motivo", "decisao", r.decisao, podeEditar) +
      campoEditavel("Tipo de Sanção", "sancao", r.tipoSancao, podeEditar) +
      campoEditavel("Data da Aplicação", "dataSancao", r.dataAplicacao, podeEditar) +
      kv("Aplicada por", r.aplicadaPor) +
      kv("Documento Comprobatório", r.documento) +
      comprovanteChip +
      comprovanteUpload +
      campoEditavel("Observações", "observacoesSancao", r.observacoesSancao, podeEditar);
  }

  const anexos = $("gdDetAnexos");
  if (anexos) {
    anexos.innerHTML = (r.anexos || []).map(a => {
      const icone = a.info === "Link" ? "fa-link" : "fa-file-pdf";
      const acao = a.url
        ? `<a class="gfIconBtn" href="${escapeAttr(a.url)}" target="_blank" rel="noopener noreferrer" title="Abrir"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>`
        : `<button class="gfIconBtn" data-gd-baixar="${escapeHtml(a.nome)}" title="Baixar"><i class="fa-solid fa-download"></i></button>`;
      return `<div class="gfFileChip">
        <i class="fa-solid ${icone}"></i>
        <span>${escapeHtml(a.nome)}<small>${escapeHtml(a.info)} · ${escapeHtml(a.data)}</small></span>
        ${acao}
      </div>`;
    }).join("") +
      `<button type="button" class="gfBtn gfBtnGhost gfBtnBlock" id="gdBtnAddAnexo" style="margin-top:10px;"><i class="fa-solid fa-plus"></i> Adicionar anexo</button>`;
  }

  // Reflete a seleção na tabela.
  document.querySelectorAll(".gdRow").forEach(tr => {
    tr.classList.toggle("is-selected", tr.dataset.gdProcesso === r.processo);
  });
}

// ---------- Edição em linha com confirmação ----------
// Caixa de diálogo de confirmação. Resolve para true (confirmar) ou false (cancelar).
// opts: { titulo, okTexto, cancelTexto, amarelo } personalizam o diálogo.
function gdConfirmar(mensagem, opts = {}) {
  return new Promise(resolve => {
    const overlay = $("gdConfirmOverlay");
    if (!overlay) { resolve(window.confirm(mensagem)); return; }
    const card = overlay.querySelector(".gdConfirmCard");
    const titulo = $("gdConfirmTitulo");
    const msg = $("gdConfirmMsg");
    const btnOk = $("gdConfirmOk");
    const btnCancel = $("gdConfirmCancelar");
    if (msg) msg.textContent = mensagem;
    if (titulo) titulo.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(opts.titulo || "Confirmar alteração")}`;
    if (btnOk) btnOk.innerHTML = `<i class="fa-solid fa-check"></i> ${escapeHtml(opts.okTexto || "Confirmar alteração")}`;
    if (btnCancel) btnCancel.textContent = opts.cancelTexto || "Cancelar";
    if (card) card.classList.toggle("is-aviso", !!opts.amarelo);
    overlay.hidden = false;
    document.body.style.overflow = "hidden";

    const finalizar = valor => {
      overlay.hidden = true;
      document.body.style.overflow = "";
      btnOk.removeEventListener("click", onOk);
      btnCancel.removeEventListener("click", onCancel);
      overlay.removeEventListener("click", onOverlay);
      resolve(valor);
    };
    const onOk = () => finalizar(true);
    const onCancel = () => finalizar(false);
    const onOverlay = e => { if (e.target === overlay) finalizar(false); };
    btnOk.addEventListener("click", onOk);
    btnCancel.addEventListener("click", onCancel);
    overlay.addEventListener("click", onOverlay);
  });
}

// Aplica a alteração de um campo do detalhamento após confirmação; ao cancelar,
// re-renderiza para reverter o controle ao valor anterior.
async function aplicarAlteracao(campo, novoValor) {
  const r = REGISTROS.find(x => x.processo === processoSelecionado);
  const cfg = CAMPOS_EDITAVEIS[campo];
  if (!r || !cfg) return;

  let valor = String(novoValor ?? "").trim();
  if (cfg.tipo === "data") valor = valor ? dataParaBr(valor) : "—";
  else if (cfg.tipo === "texto" && valor === "") valor = "—";

  const atual = r[cfg.chaves[0]] ?? "";
  if (valor === String(atual)) { renderDetalhe(processoSelecionado); return; }

  const ok = await gdConfirmar(`Deseja realmente alterar ${cfg.rotulo} de "${atual || "—"}" para "${valor || "—"}"?`);
  if (!ok) { renderDetalhe(processoSelecionado); return; }

  cfg.chaves.forEach(k => { r[k] = valor; }); // sincroniza chaves espelhadas (ex.: dataSancao/dataAplicacao)
  renderTabela();
  renderDetalhe(processoSelecionado);
  gdToast(cfg.toast);
}

// Upload do termo (comprovante) na Sanção Aplicada, com confirmação.
async function aplicarUploadTermo(arquivo) {
  if (!arquivo) return;
  const r = REGISTROS.find(x => x.processo === processoSelecionado);
  if (!r) return;
  const acao = r.comprovante ? "substituir" : "enviar";
  const ok = await gdConfirmar(`Deseja realmente ${acao} o termo (comprovante) por "${arquivo.name}"?`);
  if (!ok) { renderDetalhe(processoSelecionado); return; }
  r.comprovante = arquivo.name;
  r.comprovanteUrl = URL.createObjectURL(arquivo); // visualização na sessão (não persiste)
  renderDetalhe(processoSelecionado);
  gdToast("Termo (comprovante) atualizado.");
}

// Vincula o login do usuário logado como responsável pelo processo.
function assumirResponsabilidade(processo) {
  const r = REGISTROS.find(x => x.processo === processo);
  if (!r) return;
  const login = loginResponsavel();
  if (!login) { gdToast("Não foi possível identificar seu login.", "erro"); return; }
  if (r.responsavel === login) { gdToast("Você já é o responsável por este processo."); return; }
  r.responsavel = login;
  renderDetalhe(processo);
  gdToast(`Você assumiu a responsabilidade (${login}).`);
}

// ---------- Fases do processo (avançar/voltar/desligar) ----------
function definirStatusDisc(r, novo, msg) {
  r.statusAtual = novo;
  r.status = novo;
  r.ultimaAtualizacao = dataParaBr(hojeIso());
  renderTabela();
  renderIndicadores();
  renderDetalhe(r.processo);
  gdToast(msg || `Status atualizado para "${novo}".`);
}

function avancarFaseDisc() {
  const r = REGISTROS.find(x => x.processo === processoSelecionado);
  if (!r) return;
  const idx = STATUS_FASES.indexOf(r.statusAtual);
  if (idx < 0 || idx >= STATUS_FASES.length - 1) { gdToast("Não há próxima fase.", "erro"); return; }
  const novo = STATUS_FASES[idx + 1];
  definirStatusDisc(r, novo, `Processo avançado para "${novo}".`);
}

function voltarFaseDisc() {
  const r = REGISTROS.find(x => x.processo === processoSelecionado);
  if (!r) return;
  const idx = STATUS_FASES.indexOf(r.statusAtual);
  if (idx <= 0) { gdToast("O processo já está na primeira fase.", "erro"); return; }
  const novo = STATUS_FASES[idx - 1];
  definirStatusDisc(r, novo, `Fase revertida para "${novo}".`);
}

function desligarProcessoDisc() {
  const r = REGISTROS.find(x => x.processo === processoSelecionado);
  if (!r || r.statusAtual === STATUS_DESLIGADO) return;
  r.faseAntesDesligamento = r.statusAtual; // permite reativar de onde parou
  definirStatusDisc(r, STATUS_DESLIGADO, "Trabalhador marcado como desligado antes da conclusão.");
}

function reativarProcessoDisc() {
  const r = REGISTROS.find(x => x.processo === processoSelecionado);
  if (!r) return;
  const volta = STATUS_FASES.includes(r.faseAntesDesligamento) ? r.faseAntesDesligamento : "Em análise";
  definirStatusDisc(r, volta, `Processo reativado em "${volta}".`);
}

// ---------- Indicadores gerais (calculados a partir dos dados em memória) ----------
function renderIndicadores() {
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  const cont = fn => REGISTROS.filter(fn).length;
  set("gdKpiTotal", REGISTROS.length);
  set("gdKpiTotalmente", cont(r => r.atendimento === "Totalmente"));
  set("gdKpiParcialmente", cont(r => r.atendimento === "Parcialmente"));
  set("gdKpiNaoAtendidos", cont(r => r.atendimento === "Não atendido"));
  set("gdKpiPendentes", cont(r => r.statusAtual === "Pendente"));
  set("gdKpiConcluidos", cont(r => r.statusAtual === "Concluída"));
  set("gdKpiAdvertencias", cont(r => /^advert/i.test(r.tipoSancao || "")));
  set("gdKpiSuspensoes", cont(r => /^suspens/i.test(r.tipoSancao || "")));
  set("gdKpiJustasCausas", cont(r => (r.tipoSancao || "").toLowerCase() === "justa causa"));
  set("gdKpiForaPrazo", cont(r => r.foraDoPrazo));
  set("gdKpiAguardando", cont(r => r.statusAtual === "Aguardando devolutiva do DSEI"));
  // Tempo médio: dias entre a data do pedido e a data de aplicação da sanção.
  const tempos = REGISTROS.map(r => {
    const p = dataBr(r.dataPedido);
    const a = dataBr(r.dataAplicacao);
    return (p && a) ? (a - p) / 86400000 : null;
  }).filter(d => d !== null && d >= 0);
  const media = tempos.length ? Math.round(tempos.reduce((s, d) => s + d, 0) / tempos.length) : 0;
  set("gdKpiTempoMedioValor", `${media} dia${media === 1 ? "" : "s"}`);
}

// ---------- Ações ----------
function limparFiltros() {
  ["gdFiltroDsei", "gdFiltroStatus"].forEach(id => { const el = $(id); if (el) el.value = ""; });
  ["gdFiltroDataIni", "gdFiltroDataFim", "gdBuscaNome", "gdBuscaPedido", "gdBuscaResponsavel"].forEach(id => { const el = $(id); if (el) el.value = ""; });
  filtroMeusProcessos = false;
  $("gdBtnMeusProcessos")?.classList.remove("is-ativo");
  renderTabela();
  gdToast("Filtros limpos.");
}

// ---------- Formulário de novo registro ----------
const CAMPOS_FORM = ["gdFProcesso", "gdFDsei", "gdFTrabalhador", "gdFCargo", "gdFMatricula",
  "gdFPolo", "gdFOcorrencia", "gdFDataPedido", "gdFResumo", "gdFLink", "gdFArquivo"];

// Documento do processo: alterna entre os campos de link e de anexo (PDF).
function atualizarDocTipoGd() {
  const tipo = document.querySelector('input[name="gdDocTipo"]:checked')?.value || "link";
  const link = $("gdFLink");
  const arquivo = $("gdFArquivo");
  if (link) link.hidden = tipo !== "link";
  if (arquivo) arquivo.hidden = tipo !== "anexo";
}

// Data de hoje no formato "aaaa-mm-dd" (para <input type="date">).
function hojeIso() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function abrirFormulario() {
  const painel = $("gdFormPanel");
  if (!painel) return;
  painel.style.display = "";
  atualizarDocTipoGd();
  // Data do pedido começa na data atual, mas pode ser editada.
  const dPed = $("gdFDataPedido");
  if (dPed && !dPed.value) dPed.value = hojeIso();
  painel.scrollIntoView({ behavior: "smooth", block: "start" });
  $("gdFTrabalhador")?.focus();
}

function fecharFormulario(limpar) {
  const painel = $("gdFormPanel");
  if (!painel) return;
  painel.style.display = "none";
  if (limpar) {
    CAMPOS_FORM.forEach(id => { const el = $(id); if (el) el.value = ""; });
    const radioLink = document.querySelector('input[name="gdDocTipo"][value="link"]');
    if (radioLink) radioLink.checked = true;
    atualizarDocTipoGd();
  }
}

// Reinicia e dispara a animação de auto-preenchimento num campo.
function animarCampo(el) {
  if (!el) return;
  el.classList.remove("gd-autofill");
  void el.offsetWidth; // força reflow para reiniciar a animação a cada seleção
  el.classList.add("gd-autofill");
}

// Ao escolher/digitar o trabalhador, puxa cargo, matrícula, DSEI e polo (com animação).
function autoPreencherTrabalhador() {
  const nome = ($("gdFTrabalhador")?.value || "").trim();
  const d = DIRETORIO.find(x => x.nome.toLowerCase() === nome.toLowerCase());
  if (!d) return;
  const set = (id, v) => {
    const el = $(id);
    if (!el) return;
    el.value = v;
    animarCampo(el);
  };
  set("gdFMatricula", d.matricula);
  set("gdFCargo", d.cargo);
  set("gdFPolo", d.polo);
  if (!$("gdFDsei")?.value) set("gdFDsei", d.dsei);
}

// Converte "aaaa-mm-dd" (input date) para "dd/mm/aaaa" usado na tabela.
function dataParaBr(valor) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valor || "").trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}

async function salvarRegistro() {
  const val = id => ($(id)?.value || "").trim();
  const trabalhador = val("gdFTrabalhador");
  const dsei = val("gdFDsei");
  if (!trabalhador || !dsei) {
    gdToast("Informe ao menos o trabalhador e o DSEI/CASAI.", "erro");
    return;
  }

  // Prazo: o pedido cadastrado mais de 30 dias após a data da ocorrência está
  // fora do prazo. Nesse caso, pede confirmação antes de gravar.
  const ocorrenciaIso = val("gdFOcorrencia");
  const pedidoIso = val("gdFDataPedido");
  let foraDoPrazo = false;
  if (ocorrenciaIso && pedidoIso) {
    const dias = (new Date(pedidoIso) - new Date(ocorrenciaIso)) / 86400000;
    foraDoPrazo = Number.isFinite(dias) && dias > 30;
  }
  if (foraDoPrazo) {
    const ok = await gdConfirmar("Pedido cadastrado fora do prazo, deseja prosseguir?", {
      titulo: "Pedido fora do prazo",
      okTexto: "Sim, prosseguir",
      cancelTexto: "Não",
      amarelo: true
    });
    if (!ok) return;
  }

  // Documento do processo: link OU anexo em PDF. Vira uma entrada na lista de anexos.
  const dataPedido = dataParaBr(pedidoIso);
  const tipoDoc = document.querySelector('input[name="gdDocTipo"]:checked')?.value || "link";
  const anexos = [];
  if (tipoDoc === "link") {
    const link = val("gdFLink");
    if (link) anexos.push({ nome: link, info: "Link", data: dataPedido, url: link });
  } else {
    const arquivo = $("gdFArquivo")?.files?.[0];
    if (arquivo) {
      const kb = Math.max(1, Math.round(arquivo.size / 1024));
      anexos.push({ nome: arquivo.name, info: `PDF · ${kb} KB`, data: dataPedido, url: URL.createObjectURL(arquivo) });
    }
  }

  // Status entra automaticamente como "Pendente". Atendimento, Decisão, Sanção e a
  // data de aplicação não são pedidos no cadastro: começam neutros e são definidos
  // depois, no detalhamento.
  const novo = {
    processo: val("gdFProcesso") || "(sem nº SEI)",
    dsei,
    trabalhador,
    cargo: val("gdFCargo") || "—",
    matricula: val("gdFMatricula") || "—",
    polo: val("gdFPolo") || "—",
    ocorrencia: dataParaBr(ocorrenciaIso),
    pedido: $("gdFPedido")?.value || "—",
    status: foraDoPrazo ? STATUS_FORA_PRAZO : "Pendente",
    foraDoPrazo,
    atendimento: "—",
    decisao: "—",
    dataSancao: "—",
    dataPedido,
    motivo: "—",
    medidaParcial: "—",
    motivoNaoAtendimento: "—",
    resumo: val("gdFResumo") || "—",
    statusAtual: foraDoPrazo ? STATUS_FORA_PRAZO : "Pendente",
    ultimaAtualizacao: dataPedido,
    observacoesStatus: "—",
    tipoSancao: "—",
    dataAplicacao: "—",
    aplicadaPor: "Coordenação Distrital",
    documento: "—",
    comprovante: "",
    observacoesSancao: "—",
    anexos
  };

  REGISTROS.unshift(novo);

  // Garante que um DSEI/CASAI novo passe a aparecer no filtro.
  if (!DSEIS_CASAIS.includes(dsei)) DSEIS_CASAIS.push(dsei);
  preencherFiltros();
  preencherDatalists();

  fecharFormulario(true);
  renderIndicadores();
  renderTabela();
  renderDetalhe(novo.processo);
  gdToast(`Pedido disciplinar de "${trabalhador}" registrado.`);
}

// ---------- Inicialização ----------
let gestaoDisciplinarConfigurada = false;

// Re-renderiza o detalhamento quando a permissão do usuário muda (ex.: a sessão é
// carregada DEPOIS do primeiro render). Sem isto, os campos de edição só apareciam
// ao clicar em outra linha. Chamado por aplicarPermissoesUsuario() (auth.js).
export function atualizarPermissaoGestaoDisciplinar() {
  aplicarVisibilidadeCardsDisciplinar();
  if (gestaoDisciplinarConfigurada) renderDetalhe(processoSelecionado);
}

export function configurarGestaoDisciplinar() {
  if (gestaoDisciplinarConfigurada) return;
  const raiz = $("view-gestaoDisciplinar");
  if (!raiz) return;
  gestaoDisciplinarConfigurada = true;

  preencherFiltros();
  preencherDatalists();
  aplicarVisibilidadeCardsDisciplinar();
  renderIndicadores();
  renderTabela();
  renderDetalhe(processoSelecionado);

  // Filtros reagem na hora.
  ["gdFiltroDsei", "gdFiltroStatus"].forEach(id => $(id)?.addEventListener("change", renderTabela));
  ["gdFiltroDataIni", "gdFiltroDataFim"].forEach(id => $(id)?.addEventListener("change", renderTabela));
  ["gdBuscaNome", "gdBuscaPedido", "gdBuscaResponsavel"].forEach(id => $(id)?.addEventListener("input", renderTabela));

  $("gdBtnLimpar")?.addEventListener("click", limparFiltros);
  $("gdBtnNovo")?.addEventListener("click", abrirFormulario);

  // Recolher/expandir a barra de filtros.
  $("gdBtnToggleFiltros")?.addEventListener("click", () => {
    const toolbar = $("gdToolbar");
    const btn = $("gdBtnToggleFiltros");
    if (!toolbar || !btn) return;
    const recolhido = toolbar.classList.toggle("is-recolhido");
    btn.setAttribute("aria-expanded", String(!recolhido));
  });

  // Filtro rápido: só os processos em que o usuário logado é o responsável.
  $("gdBtnMeusProcessos")?.addEventListener("click", () => {
    filtroMeusProcessos = !filtroMeusProcessos;
    $("gdBtnMeusProcessos")?.classList.toggle("is-ativo", filtroMeusProcessos);
    renderTabela();
  });

  // Formulário de novo registro.
  $("gdBtnCancelar")?.addEventListener("click", () => fecharFormulario(true));
  $("gdBtnSalvarRegistro")?.addEventListener("click", salvarRegistro);
  ["change", "blur"].forEach(ev => $("gdFTrabalhador")?.addEventListener(ev, autoPreencherTrabalhador));
  document.querySelectorAll('input[name="gdDocTipo"]').forEach(radio =>
    radio.addEventListener("change", atualizarDocTipoGd));

  // Delegação: clique na linha / botão "ver" abre o detalhamento; download é maquete.
  raiz.addEventListener("click", event => {
    const assumir = event.target.closest("[data-gd-assumir]");
    if (assumir) { assumirResponsabilidade(assumir.dataset.gdAssumir); return; }

    const fase = event.target.closest("[data-gd-fase]");
    if (fase) {
      const acao = fase.dataset.gdFase;
      if (acao === "avancar") avancarFaseDisc();
      else if (acao === "voltar") voltarFaseDisc();
      else if (acao === "desligar") desligarProcessoDisc();
      else if (acao === "reativar") reativarProcessoDisc();
      return;
    }

    const baixar = event.target.closest("[data-gd-baixar]");
    if (baixar) { gdToast(`Download de "${baixar.dataset.gdBaixar}" (maquete).`); return; }

    if (event.target.closest("#gdBtnAddAnexo")) { gdToast("Adicionar anexo (em construção)."); return; }

    const linha = event.target.closest(".gdRow");
    if (linha && linha.dataset.gdProcesso) renderDetalhe(linha.dataset.gdProcesso);
  });

  // Edição em linha do detalhamento: ao escolher um novo valor no Status/Sanção,
  // abre a confirmação antes de aplicar (campos só editáveis com permissão).
  raiz.addEventListener("change", event => {
    const up = event.target.closest("[data-gd-upload]");
    if (up) { aplicarUploadTermo(up.files?.[0]); return; }
    const sel = event.target.closest("[data-gd-campo]");
    if (sel) { aplicarAlteracao(sel.dataset.gdCampo, sel.value); return; }
  });
}
