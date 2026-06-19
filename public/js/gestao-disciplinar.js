// =========================================================
// Gestão Disciplinar (maquete interativa)
// Renderiza a tabela de pedidos disciplinares a partir de dados
// de exemplo, liga os filtros/botões e mostra o detalhamento do
// registro selecionado. É autocontido: registra os próprios
// ouvintes em configurarGestaoDisciplinar(), chamado no init do app.
// Não há backend — as ações operam sobre os dados em memória.
// Obs.: por padrão do painel, as pessoas são sempre "trabalhadores".
// =========================================================
import { escapeHtml } from "./utils.js";
import { ordenarLista, registrarOrdenacao } from "./ordenacao.js";

// ---------- Dados de exemplo ----------
// Cada item é um pedido disciplinar encaminhado por um DSEI. Os campos
// "detalhe*" alimentam o painel de detalhamento aberto ao clicar na linha.
const REGISTROS = [
  {
    processo: "25000.123456/2024-10", dsei: "Yanomami", trabalhador: "Maria Silva da Costa",
    cargo: "Enfermeiro", polo: "Polo Base Auaris", ocorrencia: "02/03/2024",
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
    cargo: "Técnico de Enfermagem", polo: "Polo Base São Gabriel", ocorrencia: "05/01/2024",
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
    cargo: "Enfermeiro", polo: "Polo Base Surucucu", ocorrencia: "15/03/2024",
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
    cargo: "Técnico de Enfermagem", polo: "Polo Base Amarante", ocorrencia: "18/03/2024",
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
    cargo: "Enfermeiro", polo: "Polo Base Parintins", ocorrencia: "20/03/2024",
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
  "Pendente": "is-pendente"
};
const BADGE_ATENDIMENTO = {
  "Totalmente": "is-total",
  "Parcialmente": "is-parcial",
  "Não atendido": "is-naoatendido"
};

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

function registrosFiltrados() {
  const dsei = $("gdFiltroDsei")?.value || "";
  const status = $("gdFiltroStatus")?.value || "";
  const ini = $("gdFiltroDataIni")?.value ? new Date($("gdFiltroDataIni").value) : null;
  const fim = $("gdFiltroDataFim")?.value ? new Date($("gdFiltroDataFim").value) : null;
  const buscaNome = ($("gdBuscaNome")?.value || "").trim().toLowerCase();
  const buscaPedido = ($("gdBuscaPedido")?.value || "").trim().toLowerCase();

  return REGISTROS.filter(r => {
    if (dsei && r.dsei !== dsei) return false;
    if (status && r.status !== status) return false;
    if (buscaNome && !r.trabalhador.toLowerCase().includes(buscaNome)) return false;
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
  const linhas = ordenarLista("gd", registrosFiltrados());

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
      <td>${escapeHtml(r.decisao)}</td>
      <td>${escapeHtml(r.dataSancao)}</td>
      <td>${escapeHtml(r.dataPedido)}</td>
      <td class="gfTd-center">
        <button class="gfIconBtn gfView" data-gd-ver="${escapeHtml(r.processo)}" title="Ver detalhamento"><i class="fa-solid fa-eye"></i></button>
      </td>
    </tr>`).join("") ||
    `<tr><td colspan="13" class="gfTd-center">Nenhum registro para os filtros selecionados.</td></tr>`;

  if (info) info.textContent = `Mostrando ${linhas.length} de ${REGISTROS.length} pedidos`;
}

// ---------- Detalhamento do registro selecionado ----------
function kv(rotulo, valor) {
  return `<div class="gdKv"><span>${escapeHtml(rotulo)}</span><strong>${escapeHtml(valor || "—")}</strong></div>`;
}

function renderDetalhe(processo) {
  const r = REGISTROS.find(x => x.processo === processo) || REGISTROS[0];
  processoSelecionado = r.processo;

  const titulo = $("gdDetTitulo");
  if (titulo) {
    titulo.innerHTML = `${escapeHtml(r.processo)} — ${escapeHtml(r.trabalhador)} ${badge(r.statusAtual, BADGE_STATUS)}`;
  }

  const dados = $("gdDetDados");
  if (dados) {
    dados.innerHTML =
      kv("DSEI", r.dsei) +
      kv("Trabalhador", r.trabalhador) +
      kv("Cargo", r.cargo) +
      kv("Matrícula", r.matricula) +
      kv("Polo Base / CASAI", r.polo) +
      kv("Pedido", r.pedido) +
      kv("Motivo", r.motivo) +
      kv("Atendimento", r.atendimento) +
      kv("Medida adotada (parcial)", r.medidaParcial) +
      kv("Motivo do não atendimento", r.motivoNaoAtendimento) +
      kv("Nº do Processo SEI", r.processo) +
      `<div class="gdResumo"><span>Resumo do processo</span><p>${escapeHtml(r.resumo)}</p></div>`;
  }

  const statusBox = $("gdDetStatus");
  if (statusBox) {
    statusBox.innerHTML =
      `<div class="gdKv"><span>Status atual</span><strong>${badge(r.statusAtual, BADGE_STATUS)}</strong></div>` +
      kv("Última atualização", r.ultimaAtualizacao) +
      kv("Data do pedido", r.dataPedido) +
      kv("Observações", r.observacoesStatus);
  }

  const sancao = $("gdDetSancao");
  if (sancao) {
    sancao.innerHTML =
      kv("Tipo de Sanção", r.tipoSancao) +
      kv("Data da Aplicação", r.dataAplicacao) +
      kv("Aplicada por", r.aplicadaPor) +
      kv("Documento Comprobatório", r.documento) +
      (r.comprovante
        ? `<div class="gfFileChip"><i class="fa-solid fa-file-pdf"></i><span>${escapeHtml(r.comprovante)}</span><button class="gfIconBtn" data-gd-baixar="${escapeHtml(r.comprovante)}" title="Baixar"><i class="fa-solid fa-download"></i></button></div>`
        : `<div class="gdKv"><span>Comprovante (anexo)</span><strong>—</strong></div>`) +
      kv("Observações", r.observacoesSancao);
  }

  const anexos = $("gdDetAnexos");
  if (anexos) {
    anexos.innerHTML = (r.anexos || []).map(a => `
      <div class="gfFileChip">
        <i class="fa-solid fa-file-pdf"></i>
        <span>${escapeHtml(a.nome)}<small>${escapeHtml(a.info)} · ${escapeHtml(a.data)}</small></span>
        <button class="gfIconBtn" data-gd-baixar="${escapeHtml(a.nome)}" title="Baixar"><i class="fa-solid fa-download"></i></button>
      </div>`).join("") +
      `<button type="button" class="gfBtn gfBtnGhost gfBtnBlock" id="gdBtnAddAnexo" style="margin-top:10px;"><i class="fa-solid fa-plus"></i> Adicionar anexo</button>`;
  }

  // Reflete a seleção na tabela.
  document.querySelectorAll(".gdRow").forEach(tr => {
    tr.classList.toggle("is-selected", tr.dataset.gdProcesso === r.processo);
  });
}

// ---------- Ações ----------
function limparFiltros() {
  ["gdFiltroDsei", "gdFiltroStatus"].forEach(id => { const el = $(id); if (el) el.value = ""; });
  ["gdFiltroDataIni", "gdFiltroDataFim", "gdBuscaNome", "gdBuscaPedido"].forEach(id => { const el = $(id); if (el) el.value = ""; });
  renderTabela();
  gdToast("Filtros limpos.");
}

// ---------- Formulário de novo registro ----------
const CAMPOS_FORM = ["gdFProcesso", "gdFDsei", "gdFTrabalhador", "gdFCargo", "gdFMatricula",
  "gdFPolo", "gdFOcorrencia", "gdFDataPedido", "gdFMotivo"];

function abrirFormulario() {
  const painel = $("gdFormPanel");
  if (!painel) return;
  painel.style.display = "";
  painel.scrollIntoView({ behavior: "smooth", block: "start" });
  $("gdFTrabalhador")?.focus();
}

function fecharFormulario(limpar) {
  const painel = $("gdFormPanel");
  if (!painel) return;
  painel.style.display = "none";
  if (limpar) {
    CAMPOS_FORM.forEach(id => { const el = $(id); if (el) el.value = ""; });
  }
}

// Ao escolher/digitar o trabalhador, puxa cargo, matrícula, DSEI e polo.
function autoPreencherTrabalhador() {
  const nome = ($("gdFTrabalhador")?.value || "").trim();
  const d = DIRETORIO.find(x => x.nome.toLowerCase() === nome.toLowerCase());
  if (!d) return;
  const set = (id, v) => { const el = $(id); if (el) el.value = v; };
  set("gdFCargo", d.cargo);
  set("gdFMatricula", d.matricula);
  set("gdFPolo", d.polo);
  if (!$("gdFDsei")?.value) set("gdFDsei", d.dsei);
}

// Converte "aaaa-mm-dd" (input date) para "dd/mm/aaaa" usado na tabela.
function dataParaBr(valor) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valor || "").trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}

function salvarRegistro() {
  const val = id => ($(id)?.value || "").trim();
  const trabalhador = val("gdFTrabalhador");
  const dsei = val("gdFDsei");
  if (!trabalhador || !dsei) {
    gdToast("Informe ao menos o trabalhador e o DSEI/CASAI.", "erro");
    return;
  }

  const atendimento = $("gdFAtendimento")?.value || "—";
  const dataSancao = dataParaBr(val("gdFDataSancao"));
  const novo = {
    processo: val("gdFProcesso") || "(sem nº SEI)",
    dsei,
    trabalhador,
    cargo: val("gdFCargo") || "—",
    matricula: val("gdFMatricula") || "—",
    polo: val("gdFPolo") || "—",
    ocorrencia: dataParaBr(val("gdFOcorrencia")),
    pedido: $("gdFPedido")?.value || "Advertência",
    status: $("gdFStatus")?.value || "Pendente",
    atendimento,
    decisao: $("gdFDecisao")?.value || "Não foi aplicado",
    dataSancao,
    dataPedido: dataParaBr(val("gdFDataPedido")),
    motivo: val("gdFMotivo") || "—",
    medidaParcial: "—",
    motivoNaoAtendimento: "—",
    resumo: `Registro cadastrado pelo supervisor/coordenador. ${val("gdFMotivo") || ""}`.trim(),
    statusAtual: $("gdFStatus")?.value || "Pendente",
    ultimaAtualizacao: dataParaBr(val("gdFDataPedido")),
    observacoesStatus: "—",
    tipoSancao: $("gdFDecisao")?.value === "Não foi aplicado" ? "—" : ($("gdFDecisao")?.value || "—"),
    dataAplicacao: dataSancao,
    aplicadaPor: "Coordenação Distrital",
    documento: "—",
    comprovante: "",
    observacoesSancao: "—",
    anexos: []
  };

  REGISTROS.unshift(novo);

  // Garante que um DSEI/CASAI novo passe a aparecer no filtro.
  if (!DSEIS_CASAIS.includes(dsei)) DSEIS_CASAIS.push(dsei);
  preencherFiltros();
  preencherDatalists();

  fecharFormulario(true);
  renderTabela();
  renderDetalhe(novo.processo);
  gdToast(`Pedido disciplinar de "${trabalhador}" registrado.`);
}

// ---------- Inicialização ----------
let gestaoDisciplinarConfigurada = false;

export function configurarGestaoDisciplinar() {
  if (gestaoDisciplinarConfigurada) return;
  const raiz = $("view-gestaoDisciplinar");
  if (!raiz) return;
  gestaoDisciplinarConfigurada = true;

  registrarOrdenacao("gd", () => renderTabela());

  preencherFiltros();
  preencherDatalists();
  renderTabela();
  renderDetalhe(processoSelecionado);

  // Filtros reagem na hora.
  ["gdFiltroDsei", "gdFiltroStatus"].forEach(id => $(id)?.addEventListener("change", renderTabela));
  ["gdFiltroDataIni", "gdFiltroDataFim"].forEach(id => $(id)?.addEventListener("change", renderTabela));
  ["gdBuscaNome", "gdBuscaPedido"].forEach(id => $(id)?.addEventListener("input", renderTabela));

  $("gdBtnLimpar")?.addEventListener("click", limparFiltros);
  $("gdBtnNovo")?.addEventListener("click", abrirFormulario);

  // Formulário de novo registro.
  $("gdBtnCancelar")?.addEventListener("click", () => fecharFormulario(true));
  $("gdBtnSalvarRegistro")?.addEventListener("click", salvarRegistro);
  ["change", "blur"].forEach(ev => $("gdFTrabalhador")?.addEventListener(ev, autoPreencherTrabalhador));

  // Delegação: clique na linha / botão "ver" abre o detalhamento; download é maquete.
  raiz.addEventListener("click", event => {
    const ver = event.target.closest("[data-gd-ver]");
    if (ver) { renderDetalhe(ver.dataset.gdVer); return; }

    const baixar = event.target.closest("[data-gd-baixar]");
    if (baixar) { gdToast(`Download de "${baixar.dataset.gdBaixar}" (maquete).`); return; }

    if (event.target.closest("#gdBtnAddAnexo")) { gdToast("Adicionar anexo (em construção)."); return; }

    const linha = event.target.closest(".gdRow");
    if (linha && linha.dataset.gdProcesso) renderDetalhe(linha.dataset.gdProcesso);
  });
}
