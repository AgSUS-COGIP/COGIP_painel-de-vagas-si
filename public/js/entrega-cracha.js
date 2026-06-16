// =========================================================
// Entrega de Crachá (maquete interativa)
// Acompanha o fluxo de confecção do crachá em 5 etapas:
//   Foto Pendente de Envio -> Envio à Gráfica Pendente ->
//   Crachás em Confecção -> Aguardando Envio -> Crachá Confeccionado
// É autocontido: registra os próprios ouvintes em
// configurarEntregaCracha(), chamado no init do app.
// Não há backend — as ações operam sobre os dados em memória.
// =========================================================
import { escapeHtml } from "./utils.js";
import { apiGet } from "./api.js";

const PAGE_SIZE = 10;

// ---------- Status do crachá (funil de confecção) ----------
const STATUS = {
  FOTO: "Foto Pendente de Envio",
  GRAFICA: "Envio à Gráfica Pendente",
  CONFECCAO: "Crachás em Confecção",
  AGUARDANDO: "Aguardando Envio",
  CONFECCIONADO: "Crachá Confeccionado"
};

// Ordem do funil (índice = avanço da etapa).
const STATUS_LISTA = [
  STATUS.FOTO, STATUS.GRAFICA, STATUS.CONFECCAO, STATUS.AGUARDANDO, STATUS.CONFECCIONADO
];

const STATUS_CLASSE = {
  [STATUS.FOTO]: "is-foto",
  [STATUS.GRAFICA]: "is-grafica",
  [STATUS.CONFECCAO]: "is-confeccao",
  [STATUS.AGUARDANDO]: "is-aguardando",
  [STATUS.CONFECCIONADO]: "is-confeccionado"
};

function badgeStatus(status) {
  const cls = STATUS_CLASSE[status] || "is-foto";
  return `<span class="ecBadge ${cls}">${escapeHtml(status)}</span>`;
}

function statusIndex(status) {
  const i = STATUS_LISTA.indexOf(status);
  return i < 0 ? 0 : i;
}

// Etapas do histórico (uma entrada por status alcançado até o atual).
const ETAPAS = [
  { evento: "Solicitação registrada — foto pendente de envio", ator: "ADMIN", hora: "09:12", campoData: "dataSolicitacao" },
  { evento: "Foto recebida — aguardando envio à gráfica", ator: "ADMIN", hora: "10:05", campoData: "dataSolicitacao" },
  { evento: "Crachá enviado à gráfica para confecção", ator: "GRÁFICA", hora: "14:30", campoData: "dataEnvio" },
  { evento: "Confecção concluída — aguardando envio", ator: "GRÁFICA", hora: "16:20", campoData: "dataEnvio" },
  { evento: "Crachá confeccionado e enviado", ator: "GRÁFICA", hora: "17:00", campoData: "dataEnvio" }
];

// Transições disparadas pelos botões de ação (avançam uma etapa).
const TRANSICOES = {
  foto: { de: STATUS.FOTO, para: STATUS.GRAFICA, msg: "Foto recebida.", aplicar: s => { s.possuiFoto = true; } },
  grafica: { de: STATUS.GRAFICA, para: STATUS.CONFECCAO, msg: "Envio à gráfica registrado.", aplicar: s => { if (!s.dataEnvio) s.dataEnvio = hojeBR(); } },
  confeccao: { de: STATUS.CONFECCAO, para: STATUS.AGUARDANDO, msg: "Confecção concluída." },
  aguardando: { de: STATUS.AGUARDANDO, para: STATUS.CONFECCIONADO, msg: "Crachá enviado." }
};

// ---------- Unidades (DSEIs/CASAIs) ----------
// Lista de fallback (usada se o backend não responder). A lista real é
// carregada de /api/acesso/listas — a MESMA fonte do formulário de
// solicitação de acesso (login Google) — em carregarUnidades().
const DSEIS = [
  "DSEI Yanomami", "DSEI Alto Rio Negro", "DSEI Kayapó do Pará",
  "DSEI Leste de Roraima", "DSEI Maranhão", "DSEI Parintins",
  "DSEI Xingu", "DSEI Cuiabá do Norte", "DSEI Guamá-Tocantins", "DSEI Araguaia"
];

let unidadesDisponiveis = DSEIS.slice();

async function carregarUnidades() {
  try {
    const listas = await apiGet("/api/acesso/listas");
    const unidades = [].concat(listas.casai || [], listas.dsei || []);
    if (unidades.length) unidadesDisponiveis = unidades;
  } catch (e) {
    // Mantém a lista de fallback (mockup continua utilizável offline).
  }
}

function escritorioDoDsei(dsei) {
  return (dsei || "").replace(/^(DSEI|CASAI)\s+/, "Escritório ");
}

// ---------- Dados de exemplo ----------
function registro(id, dsei, nome, cargo, status, dataSolic, dataEnvio) {
  return {
    id, dsei, nome, cargo, status,
    possuiFoto: status !== STATUS.FOTO,
    dataSolicitacao: dataSolic || "",
    dataEnvio: dataEnvio || "",
    observacao: ""
  };
}

let solicitacoes = [
  registro(1, "DSEI Yanomami", "Maria Silva da Costa", "Enfermeiro", STATUS.CONFECCIONADO, "10/04/2024", "15/04/2024"),
  registro(2, "DSEI Alto Rio Negro", "João Pereira Lima", "Técnico de Enfermagem", STATUS.AGUARDANDO, "12/04/2024", "16/04/2024"),
  registro(3, "DSEI Kayapó do Pará", "Carlos Mendes dos Santos", "Agente Indígena de Saúde", STATUS.FOTO, "15/04/2024", ""),
  registro(4, "DSEI Leste de Roraima", "Ana Beatriz Souza", "Enfermeiro", STATUS.GRAFICA, "18/04/2024", ""),
  registro(5, "DSEI Maranhão", "Rafael Oliveira", "Técnico de Enfermagem", STATUS.CONFECCAO, "20/04/2024", "24/04/2024"),
  registro(6, "DSEI Parintins", "Luana Ferreira", "Enfermeiro", STATUS.CONFECCIONADO, "22/04/2024", "25/04/2024"),
  registro(7, "DSEI Xingu", "Paulo Henrique Dias", "Agente Indígena de Saúde", STATUS.FOTO, "23/04/2024", ""),
  registro(8, "DSEI Cuiabá do Norte", "Fernanda Lima", "Técnico de Enfermagem", STATUS.CONFECCAO, "24/04/2024", "25/04/2024"),
  registro(9, "DSEI Guamá-Tocantins", "Tiago Soares", "Enfermeiro", STATUS.FOTO, "25/04/2024", ""),
  registro(10, "DSEI Araguaia", "Juliana Nunes", "Agente Indígena de Saúde", STATUS.AGUARDANDO, "26/04/2024", "29/04/2024"),
  registro(11, "DSEI Yanomami", "Marcos Vinícius Alves", "Médico Clínico Geral", STATUS.CONFECCIONADO, "27/04/2024", "02/05/2024"),
  registro(12, "DSEI Alto Rio Negro", "Patrícia Gomes", "Enfermeiro", STATUS.CONFECCAO, "28/04/2024", "03/05/2024"),
  registro(13, "DSEI Maranhão", "Roberto Carlos Pinto", "Dentista", STATUS.FOTO, "29/04/2024", ""),
  registro(14, "DSEI Xingu", "Camila Rodrigues", "Técnico de Enfermagem", STATUS.CONFECCIONADO, "30/04/2024", "04/05/2024"),
  registro(15, "DSEI Parintins", "Eduardo Santos", "Agente Indígena de Saúde", STATUS.AGUARDANDO, "02/05/2024", "06/05/2024"),
  registro(16, "DSEI Leste de Roraima", "Beatriz Almeida", "Enfermeiro", STATUS.CONFECCIONADO, "03/05/2024", "07/05/2024"),
  registro(17, "DSEI Cuiabá do Norte", "Gustavo Henrique Reis", "Médico Clínico Geral", STATUS.FOTO, "04/05/2024", ""),
  registro(18, "DSEI Araguaia", "Larissa Martins", "Técnico de Enfermagem", STATUS.CONFECCAO, "05/05/2024", "09/05/2024"),
  registro(19, "DSEI Guamá-Tocantins", "Felipe Andrade", "Agente Indígena de Saúde", STATUS.CONFECCIONADO, "06/05/2024", "10/05/2024"),
  registro(20, "DSEI Kayapó do Pará", "Vanessa Cardoso", "Enfermeiro", STATUS.FOTO, "07/05/2024", ""),
  registro(21, "DSEI Yanomami", "Bruno Teixeira", "Técnico de Enfermagem", STATUS.GRAFICA, "08/05/2024", ""),
  registro(22, "DSEI Maranhão", "Sabrina Lopes", "Agente Indígena de Saúde", STATUS.AGUARDANDO, "09/05/2024", "13/05/2024")
];

let proximoId = 23;

// ---------- Estado da view ----------
let filtros = { dsei: "", status: "", escritorio: "", dataIni: "", dataFim: "", nome: "", cargo: "" };
let paginaAtual = 1;
let detalheId = null;

const $ = id => document.getElementById(id);

// ---------- Datas ----------
function isoParaBR(iso) {
  if (!iso) return "";
  const [a, m, d] = iso.split("-");
  if (!a || !m || !d) return "";
  return `${d}/${m}/${a}`;
}

function brParaISO(br) {
  if (!br) return "";
  const [d, m, a] = br.split("/");
  if (!d || !m || !a) return "";
  return `${a}-${m}-${d}`;
}

function brParaTime(br) {
  if (!br) return null;
  const [d, m, a] = br.split("/");
  if (!d || !m || !a) return null;
  return new Date(Number(a), Number(m) - 1, Number(d)).getTime();
}

function hojeBR() {
  const hoje = new Date();
  const dd = String(hoje.getDate()).padStart(2, "0");
  const mm = String(hoje.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${hoje.getFullYear()}`;
}

// ---------- Toast ----------
let toastTimer = null;
function ecToast(mensagem, tipo) {
  let el = $("ecToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "ecToast";
    el.className = "ecToast";
    document.body.appendChild(el);
  }
  el.textContent = mensagem;
  el.classList.remove("is-erro", "is-ok");
  el.classList.add(tipo === "erro" ? "is-erro" : "is-ok", "show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

// ---------- KPIs (um por status do funil) ----------
function renderKpis(lista) {
  const porStatus = st => lista.filter(s => s.status === st).length;
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set("ecKpiTrabalhadores", lista.length);
  set("ecKpiFoto", porStatus(STATUS.FOTO));
  set("ecKpiGrafica", porStatus(STATUS.GRAFICA));
  set("ecKpiConfeccao", porStatus(STATUS.CONFECCAO));
  set("ecKpiAguardando", porStatus(STATUS.AGUARDANDO));
  set("ecKpiConfeccionado", porStatus(STATUS.CONFECCIONADO));
}

// ---------- Filtros ----------
function lerFiltros() {
  filtros = {
    dsei: $("ecFiltroDsei")?.value || "",
    status: $("ecFiltroStatus")?.value || "",
    escritorio: $("ecFiltroEscritorio")?.value || "",
    dataIni: $("ecFiltroDataInicial")?.value || "",
    dataFim: $("ecFiltroDataFinal")?.value || "",
    nome: ($("ecBuscaNome")?.value || "").trim().toLowerCase(),
    cargo: ($("ecBuscaCargo")?.value || "").trim().toLowerCase()
  };
}

function aplicarFiltros() {
  const iniT = filtros.dataIni ? new Date(filtros.dataIni + "T00:00:00").getTime() : null;
  const fimT = filtros.dataFim ? new Date(filtros.dataFim + "T00:00:00").getTime() : null;

  return solicitacoes.filter(s => {
    if (filtros.dsei && s.dsei !== filtros.dsei) return false;
    if (filtros.status && s.status !== filtros.status) return false;
    if (filtros.escritorio && escritorioDoDsei(s.dsei) !== filtros.escritorio) return false;
    if (filtros.nome && !s.nome.toLowerCase().includes(filtros.nome)) return false;
    if (filtros.cargo && !s.cargo.toLowerCase().includes(filtros.cargo)) return false;
    if (iniT !== null || fimT !== null) {
      const t = brParaTime(s.dataSolicitacao);
      if (t === null) return false;
      if (iniT !== null && t < iniT) return false;
      if (fimT !== null && t > fimT) return false;
    }
    return true;
  });
}

// ---------- Tabela + paginação ----------
function celulaData(valor) {
  return valor ? escapeHtml(valor) : "—";
}

function render() {
  renderKpis(solicitacoes);

  const lista = aplicarFiltros();
  const totalPaginas = Math.max(1, Math.ceil(lista.length / PAGE_SIZE));
  if (paginaAtual > totalPaginas) paginaAtual = totalPaginas;
  const inicio = (paginaAtual - 1) * PAGE_SIZE;
  const pagina = lista.slice(inicio, inicio + PAGE_SIZE);

  const body = $("ecTabelaBody");
  if (body) {
    body.innerHTML = pagina.map(s => `
      <tr${s.id === detalheId ? ' class="ecLinhaAtiva"' : ""}>
        <td>${escapeHtml(s.dsei)}</td>
        <td>${escapeHtml(s.nome)}</td>
        <td>${escapeHtml(s.cargo)}</td>
        <td>${celulaData(s.dataSolicitacao)}</td>
        <td class="ecTd-center">${s.possuiFoto ? '<span class="ecFotoSim">Sim</span>' : '<span class="ecFotoNao">Não</span>'}</td>
        <td>${celulaData(s.dataEnvio)}</td>
        <td>${badgeStatus(s.status)}</td>
        <td class="ecTd-center ecAcoesCol">
          <button class="ecIconBtn" data-ec-ver="${s.id}" title="Ver detalhes"><i class="fa-regular fa-eye"></i></button>
          <button class="ecIconBtn" data-ec-editar="${s.id}" title="Editar"><i class="fa-solid fa-pen"></i></button>
          <button class="ecIconBtn ecIconBtnDanger" data-ec-excluir="${s.id}" title="Excluir"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>`).join("") ||
      `<tr><td colspan="8" class="ecVazio">Nenhuma solicitação encontrada para os filtros selecionados.</td></tr>`;
  }

  const registros = $("ecRegistros");
  if (registros) {
    if (!lista.length) {
      registros.textContent = "Mostrando 0 registros";
    } else {
      const fim = Math.min(inicio + PAGE_SIZE, lista.length);
      registros.textContent = `Mostrando ${inicio + 1} a ${fim} de ${lista.length} registros`;
    }
  }

  renderPaginacao(totalPaginas);
}

function renderPaginacao(totalPaginas) {
  const wrap = $("ecPagination");
  if (!wrap) return;
  if (totalPaginas <= 1) { wrap.innerHTML = ""; return; }

  let html = `<button class="ecPageBtn ecPageNav" data-ec-pagina="prev" ${paginaAtual === 1 ? "disabled" : ""} title="Anterior"><i class="fa-solid fa-angle-left"></i></button>`;
  for (let p = 1; p <= totalPaginas; p++) {
    html += `<button class="ecPageBtn${p === paginaAtual ? " is-ativo" : ""}" data-ec-pagina="${p}">${p}</button>`;
  }
  html += `<button class="ecPageBtn ecPageNav" data-ec-pagina="next" ${paginaAtual === totalPaginas ? "disabled" : ""} title="Próxima"><i class="fa-solid fa-angle-right"></i></button>`;
  wrap.innerHTML = html;
}

function irParaPagina(valor) {
  const lista = aplicarFiltros();
  const totalPaginas = Math.max(1, Math.ceil(lista.length / PAGE_SIZE));
  if (valor === "prev") paginaAtual = Math.max(1, paginaAtual - 1);
  else if (valor === "next") paginaAtual = Math.min(totalPaginas, paginaAtual + 1);
  else paginaAtual = Math.min(totalPaginas, Math.max(1, Number(valor) || 1));
  render();
}

// ---------- Painel de detalhe ----------
function timelineDe(s) {
  const ate = statusIndex(s.status);
  return ETAPAS.slice(0, ate + 1).map(e => ({
    data: s[e.campoData] || s.dataSolicitacao,
    hora: e.hora,
    evento: e.evento,
    ator: e.ator
  }));
}

function abrirDetalhe(id) {
  const s = solicitacoes.find(r => r.id === id);
  if (!s) return;
  detalheId = id;

  const set = (elId, v) => { const el = $(elId); if (el) el.textContent = v || "—"; };
  $("ecDetalheNome").textContent = s.nome;
  $("ecDetalheBadge").innerHTML = badgeStatus(s.status);

  set("ecDetDsei", s.dsei);
  set("ecDetCargo", s.cargo);
  set("ecDetDataSolic", s.dataSolicitacao);
  set("ecDetFoto", s.possuiFoto ? "Sim" : "Não");
  set("ecDetDataEnvio", s.dataEnvio);

  set("ecDetStatus", s.status);
  set("ecDetStatusSolic", s.dataSolicitacao);
  set("ecDetStatusEnvio", s.dataEnvio);

  const timeline = $("ecDetTimeline");
  if (timeline) {
    timeline.innerHTML = timelineDe(s).map(i => `
      <li class="ecTimelineItem">
        <div class="ecTimelineDot"></div>
        <div class="ecTimelineConteudo">
          <div class="ecTimelineQuando">${escapeHtml(i.data || "—")} ${escapeHtml(i.hora)}</div>
          <div class="ecTimelineEvento">${escapeHtml(i.evento)}</div>
          <div class="ecTimelineAtor">${escapeHtml(i.ator)}</div>
        </div>
      </li>`).join("") || `<li class="ecTimelineVazio">Sem histórico registrado.</li>`;
  }

  atualizarBotoesAcao(s);

  const obs = $("ecDetObs");
  if (obs) obs.value = s.observacao || "";

  const painel = $("ecDetalhe");
  if (painel) {
    painel.hidden = false;
    painel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  render();
}

// Habilita apenas o botão da próxima etapa válida.
function atualizarBotoesAcao(s) {
  document.querySelectorAll("#ecDetalhe [data-ec-acao]").forEach(btn => {
    const t = TRANSICOES[btn.dataset.ecAcao];
    btn.disabled = !t || s.status !== t.de;
  });
}

function recolherDetalhe() {
  detalheId = null;
  const painel = $("ecDetalhe");
  if (painel) painel.hidden = true;
  render();
}

// ---------- Ações: avançar etapa do funil ----------
function registrarEtapa(tipo) {
  const s = solicitacoes.find(r => r.id === detalheId);
  if (!s) return;
  const t = TRANSICOES[tipo];
  if (!t) return;
  if (s.status !== t.de) {
    ecToast("Esta ação não se aplica ao status atual.", "erro");
    return;
  }
  s.status = t.para;
  if (t.aplicar) t.aplicar(s);
  ecToast(t.msg);
  abrirDetalhe(s.id);
}

function salvarObservacao() {
  const s = solicitacoes.find(r => r.id === detalheId);
  if (!s) return;
  s.observacao = $("ecDetObs")?.value || "";
  ecToast("Observação salva.");
}

// ---------- Modal de nova solicitação / edição ----------
let modalEditId = null;

function abrirModal(editId) {
  modalEditId = editId || null;
  const erro = $("ecModalErro");
  if (erro) erro.textContent = "";

  const titulo = $("ecModalTitulo");
  if (modalEditId) {
    const s = solicitacoes.find(r => r.id === modalEditId);
    if (!s) return;
    if (titulo) titulo.textContent = "Editar Solicitação de Crachá";
    $("ecFormNome").value = s.nome;
    $("ecFormDsei").value = s.dsei;
    $("ecFormCargo").value = s.cargo;
    $("ecFormFoto").value = s.possuiFoto ? "sim" : "nao";
    $("ecFormDataSolic").value = brParaISO(s.dataSolicitacao);
  } else {
    if (titulo) titulo.textContent = "Nova Solicitação de Crachá";
    $("ecFormNome").value = "";
    $("ecFormDsei").value = unidadesDisponiveis[0] || "";
    $("ecFormCargo").value = "";
    $("ecFormFoto").value = "sim";
    $("ecFormDataSolic").value = "";
  }

  const modal = $("ecModal");
  if (modal) modal.hidden = false;
}

function fecharModal() {
  const modal = $("ecModal");
  if (modal) modal.hidden = true;
  modalEditId = null;
}

function salvarModal() {
  const nome = ($("ecFormNome")?.value || "").trim();
  const dsei = $("ecFormDsei")?.value || "";
  const cargo = ($("ecFormCargo")?.value || "").trim();
  const foto = $("ecFormFoto")?.value === "sim";
  const dataSolic = isoParaBR($("ecFormDataSolic")?.value || "") || hojeBR();

  const erro = $("ecModalErro");
  if (!nome || !cargo || !dsei) {
    if (erro) erro.textContent = "Preencha nome, DSEI e cargo.";
    return;
  }

  if (modalEditId) {
    const s = solicitacoes.find(r => r.id === modalEditId);
    if (s) {
      s.nome = nome; s.dsei = dsei; s.cargo = cargo;
      s.possuiFoto = foto; s.dataSolicitacao = dataSolic;
    }
    ecToast("Solicitação atualizada.");
    if (detalheId === modalEditId) abrirDetalhe(modalEditId);
  } else {
    // Sem foto entra no funil em "Foto Pendente"; com foto, em "Envio à Gráfica Pendente".
    const status = foto ? STATUS.GRAFICA : STATUS.FOTO;
    solicitacoes.unshift(registro(proximoId++, dsei, nome, cargo, status, dataSolic, ""));
    paginaAtual = 1;
    ecToast("Nova solicitação registrada.");
  }

  fecharModal();
  render();
}

function excluirSolicitacao(id) {
  const s = solicitacoes.find(r => r.id === id);
  if (!s) return;
  if (!window.confirm(`Excluir a solicitação de "${s.nome}"?`)) return;
  solicitacoes = solicitacoes.filter(r => r.id !== id);
  if (detalheId === id) recolherDetalhe();
  ecToast("Solicitação excluída.");
  render();
}

// ---------- Preenchimento dos selects ----------
function preencherSelects() {
  // Preserva o valor selecionado ao repopular (a lista do servidor chega async).
  const opcoes = (id, valores, rotuloTodos) => {
    const el = $(id);
    if (!el) return;
    const atual = el.value;
    el.innerHTML = `<option value="">${rotuloTodos}</option>` +
      valores.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
    if (atual && valores.includes(atual)) el.value = atual;
  };
  opcoes("ecFiltroDsei", unidadesDisponiveis, "Todos os DSEIs");
  opcoes("ecFiltroStatus", STATUS_LISTA, "Todos os Status");
  opcoes("ecFiltroEscritorio", unidadesDisponiveis.map(escritorioDoDsei), "Todos os Escritórios");

  const formDsei = $("ecFormDsei");
  if (formDsei) {
    const atual = formDsei.value;
    formDsei.innerHTML = unidadesDisponiveis.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
    if (atual && unidadesDisponiveis.includes(atual)) formDsei.value = atual;
  }
}

function limparFiltros() {
  ["ecFiltroDsei", "ecFiltroStatus", "ecFiltroEscritorio", "ecFiltroDataInicial", "ecFiltroDataFinal", "ecBuscaNome", "ecBuscaCargo"]
    .forEach(id => { const el = $(id); if (el) el.value = ""; });
  lerFiltros();
  paginaAtual = 1;
  render();
}

// ---------- Inicialização ----------
let entregaCrachaConfigurada = false;

export function configurarEntregaCracha() {
  if (entregaCrachaConfigurada) return;
  const raiz = $("view-entregaCracha");
  if (!raiz) return;
  entregaCrachaConfigurada = true;

  preencherSelects();
  render();

  // Carrega a lista real de DSEIs/CASAIs (mesma do formulário de acesso) e
  // repopula os selects quando chegar.
  carregarUnidades().then(preencherSelects);

  // Filtros reagem na hora (change para selects/datas, input para buscas).
  raiz.querySelectorAll("[data-ec-filtro]").forEach(el => {
    const evento = el.tagName === "INPUT" && el.type === "search" ? "input" : "change";
    el.addEventListener(evento, () => { lerFiltros(); paginaAtual = 1; render(); });
  });

  $("ecBtnLimpar")?.addEventListener("click", limparFiltros);
  $("ecBtnNova")?.addEventListener("click", () => abrirModal(null));
  $("ecBtnRecolher")?.addEventListener("click", recolherDetalhe);
  $("ecBtnSalvarObs")?.addEventListener("click", salvarObservacao);

  // Modal.
  $("ecModalFechar")?.addEventListener("click", fecharModal);
  $("ecModalCancelar")?.addEventListener("click", fecharModal);
  $("ecModalSalvar")?.addEventListener("click", salvarModal);
  $("ecModal")?.addEventListener("click", event => {
    if (event.target === $("ecModal")) fecharModal();
  });

  // Delegação para elementos gerados dinamicamente (linhas, paginação, ações).
  raiz.addEventListener("click", event => {
    const ver = event.target.closest("[data-ec-ver]");
    if (ver) { abrirDetalhe(Number(ver.dataset.ecVer)); return; }

    const editar = event.target.closest("[data-ec-editar]");
    if (editar) { abrirModal(Number(editar.dataset.ecEditar)); return; }

    const excluir = event.target.closest("[data-ec-excluir]");
    if (excluir) { excluirSolicitacao(Number(excluir.dataset.ecExcluir)); return; }

    const pagina = event.target.closest("[data-ec-pagina]");
    if (pagina && !pagina.disabled) { irParaPagina(pagina.dataset.ecPagina); return; }

    const acao = event.target.closest("[data-ec-acao]");
    if (acao && !acao.disabled) { registrarEtapa(acao.dataset.ecAcao); return; }
  });
}
