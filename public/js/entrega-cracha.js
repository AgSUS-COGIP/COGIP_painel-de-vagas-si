// =========================================================
// Entrega de Crachá (maquete interativa)
// Acompanha o fluxo solicitação -> confecção -> envio ->
// entrega ao escritório -> entrega ao colaborador (e devolução).
// É autocontido: registra os próprios ouvintes em
// configurarEntregaCracha(), chamado no init do app.
// Não há backend — as ações operam sobre os dados em memória.
// =========================================================
import { escapeHtml } from "./utils.js";
import { apiGet } from "./api.js";

const PAGE_SIZE = 10;

// Lista de fallback de DSEIs (usada se o backend não responder). A lista real
// é carregada de /api/acesso/listas — a MESMA fonte do formulário de
// solicitação de acesso (login Google) — em carregarUnidades().
const DSEIS = [
  "DSEI Yanomami", "DSEI Alto Rio Negro", "DSEI Kayapó do Pará",
  "DSEI Leste de Roraima", "DSEI Maranhão", "DSEI Parintins",
  "DSEI Xingu", "DSEI Cuiabá do Norte", "DSEI Guamá-Tocantins", "DSEI Araguaia"
];

// DSEIs/CASAIs efetivamente disponíveis nos selects (filtro + formulário).
// Começa com o fallback e é substituída pela lista do servidor.
let unidadesDisponiveis = DSEIS.slice();

// Busca DSEIs e CASAIs do servidor (mesma combinação do form de acesso:
// CASAIs antes dos DSEIs). Mantém o fallback se a requisição falhar.
async function carregarUnidades() {
  try {
    const listas = await apiGet("/api/acesso/listas");
    const unidades = [].concat(listas.casai || [], listas.dsei || []);
    if (unidades.length) unidadesDisponiveis = unidades;
  } catch (e) {
    // Mantém a lista de fallback (mockup continua utilizável offline).
  }
}

// O escritório de um trabalhador deriva da unidade ("Escritório <unidade>").
function escritorioDoDsei(dsei) {
  return (dsei || "").replace(/^(DSEI|CASAI)\s+/, "Escritório ");
}

// ---------- Dados de exemplo ----------
// Guardamos apenas as datas + foto; o status e o histórico são derivados
// a partir do estágio mais avançado já alcançado (datas preenchidas).
function registro(id, dsei, nome, cargo, possuiFoto, dataSolic, dataEnvio, dataEscritorio, dataColaborador, dataDevolucao) {
  return {
    id, dsei, nome, cargo, possuiFoto,
    dataSolicitacao: dataSolic || "",
    dataEnvio: dataEnvio || "",
    dataEntregaEscritorio: dataEscritorio || "",
    dataEntregaColaborador: dataColaborador || "",
    dataDevolucao: dataDevolucao || "",
    observacao: ""
  };
}

let solicitacoes = [
  registro(1, "DSEI Yanomami", "Maria Silva da Costa", "Enfermeiro", true, "10/04/2024", "15/04/2024", "16/04/2024", "18/04/2024", ""),
  registro(2, "DSEI Alto Rio Negro", "João Pereira Lima", "Técnico de Enfermagem", true, "12/04/2024", "16/04/2024", "22/04/2024", "", ""),
  registro(3, "DSEI Kayapó do Pará", "Carlos Mendes dos Santos", "Agente Indígena de Saúde", false, "15/04/2024", "", "", "", ""),
  registro(4, "DSEI Leste de Roraima", "Ana Beatriz Souza", "Enfermeiro", true, "18/04/2024", "", "", "", ""),
  registro(5, "DSEI Maranhão", "Rafael Oliveira", "Técnico de Enfermagem", true, "20/04/2024", "24/04/2024", "26/04/2024", "", ""),
  registro(6, "DSEI Parintins", "Luana Ferreira", "Enfermeiro", true, "22/04/2024", "25/04/2024", "26/04/2024", "26/04/2024", ""),
  registro(7, "DSEI Xingu", "Paulo Henrique Dias", "Agente Indígena de Saúde", false, "23/04/2024", "", "", "", ""),
  registro(8, "DSEI Cuiabá do Norte", "Fernanda Lima", "Técnico de Enfermagem", true, "24/04/2024", "25/04/2024", "", "", ""),
  registro(9, "DSEI Guamá-Tocantins", "Tiago Soares", "Enfermeiro", false, "25/04/2024", "", "", "", ""),
  registro(10, "DSEI Araguaia", "Juliana Nunes", "Agente Indígena de Saúde", true, "26/04/2024", "29/04/2024", "29/04/2024", "", ""),
  registro(11, "DSEI Yanomami", "Marcos Vinícius Alves", "Médico Clínico Geral", true, "27/04/2024", "02/05/2024", "05/05/2024", "07/05/2024", ""),
  registro(12, "DSEI Alto Rio Negro", "Patrícia Gomes", "Enfermeiro", true, "28/04/2024", "03/05/2024", "", "", ""),
  registro(13, "DSEI Maranhão", "Roberto Carlos Pinto", "Dentista", false, "29/04/2024", "", "", "", ""),
  registro(14, "DSEI Xingu", "Camila Rodrigues", "Técnico de Enfermagem", true, "30/04/2024", "04/05/2024", "06/05/2024", "08/05/2024", ""),
  registro(15, "DSEI Parintins", "Eduardo Santos", "Agente Indígena de Saúde", true, "02/05/2024", "06/05/2024", "08/05/2024", "", ""),
  registro(16, "DSEI Leste de Roraima", "Beatriz Almeida", "Enfermeiro", true, "03/05/2024", "07/05/2024", "09/05/2024", "10/05/2024", "14/05/2024"),
  registro(17, "DSEI Cuiabá do Norte", "Gustavo Henrique Reis", "Médico Clínico Geral", false, "04/05/2024", "", "", "", ""),
  registro(18, "DSEI Araguaia", "Larissa Martins", "Técnico de Enfermagem", true, "05/05/2024", "09/05/2024", "11/05/2024", "", ""),
  registro(19, "DSEI Guamá-Tocantins", "Felipe Andrade", "Agente Indígena de Saúde", true, "06/05/2024", "10/05/2024", "12/05/2024", "13/05/2024", ""),
  registro(20, "DSEI Kayapó do Pará", "Vanessa Cardoso", "Enfermeiro", false, "07/05/2024", "", "", "", ""),
  registro(21, "DSEI Yanomami", "Bruno Teixeira", "Técnico de Enfermagem", true, "08/05/2024", "12/05/2024", "", "", ""),
  registro(22, "DSEI Maranhão", "Sabrina Lopes", "Agente Indígena de Saúde", true, "09/05/2024", "13/05/2024", "15/05/2024", "16/05/2024", "")
];

let proximoId = 23;

// ---------- Derivações de status ----------
// Ordem do funil; o status é o estágio mais avançado com data preenchida.
function statusDe(s) {
  if (s.dataDevolucao) return "Devolvido";
  if (s.dataEntregaColaborador) return "Entregue ao Colaborador";
  if (s.dataEntregaEscritorio) return "Entregue ao Escritório";
  if (s.dataEnvio) return "Enviado";
  if (s.dataSolicitacao) return "Solicitado à Gráfica";
  return "Não Solicitado";
}

const STATUS_CLASSE = {
  "Solicitado à Gráfica": "is-solicitado",
  "Enviado": "is-enviado",
  "Entregue ao Escritório": "is-escritorio",
  "Entregue ao Colaborador": "is-colaborador",
  "Devolvido": "is-devolvido",
  "Não Solicitado": "is-pendente"
};

const STATUS_LISTA = [
  "Não Solicitado", "Solicitado à Gráfica", "Enviado",
  "Entregue ao Escritório", "Entregue ao Colaborador", "Devolvido"
];

function badgeStatus(status) {
  const cls = STATUS_CLASSE[status] || "is-pendente";
  return `<span class="ecBadge ${cls}">${escapeHtml(status)}</span>`;
}

// Confeccionado = a gráfica já enviou o crachá (qualquer estágio a partir de "Enviado").
function foiConfeccionado(s) {
  return Boolean(s.dataEnvio);
}

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

function agoraHora() {
  const agora = new Date();
  return `${String(agora.getHours()).padStart(2, "0")}:${String(agora.getMinutes()).padStart(2, "0")}`;
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

// ---------- KPIs ----------
function renderKpis(lista) {
  const total = lista.length;
  const solicitados = lista.filter(s => statusDe(s) !== "Não Solicitado").length;
  const confeccionados = lista.filter(foiConfeccionado).length;
  const escritorio = lista.filter(s => s.dataEntregaEscritorio).length;
  const colaborador = lista.filter(s => s.dataEntregaColaborador).length;
  const semFoto = lista.filter(s => !s.possuiFoto).length;

  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set("ecKpiTrabalhadores", total);
  set("ecKpiSolicitados", solicitados);
  set("ecKpiConfeccionados", confeccionados);
  set("ecKpiEscritorio", escritorio);
  set("ecKpiColaborador", colaborador);
  set("ecKpiSemFoto", semFoto);
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
    if (filtros.status && statusDe(s) !== filtros.status) return false;
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
    body.innerHTML = pagina.map(s => {
      const status = statusDe(s);
      return `
      <tr${s.id === detalheId ? ' class="ecLinhaAtiva"' : ""}>
        <td>${escapeHtml(s.dsei)}</td>
        <td>${escapeHtml(s.nome)}</td>
        <td>${escapeHtml(s.cargo)}</td>
        <td>${celulaData(s.dataSolicitacao)}</td>
        <td class="ecTd-center">${s.possuiFoto ? '<span class="ecFotoSim">Sim</span>' : '<span class="ecFotoNao">Não</span>'}</td>
        <td>${celulaData(s.dataEnvio)}</td>
        <td>${badgeStatus(status)}</td>
        <td>${celulaData(s.dataEntregaEscritorio)}</td>
        <td>${celulaData(s.dataEntregaColaborador)}</td>
        <td>${celulaData(s.dataDevolucao)}</td>
        <td class="ecTd-center ecAcoesCol">
          <button class="ecIconBtn" data-ec-ver="${s.id}" title="Ver detalhes"><i class="fa-regular fa-eye"></i></button>
          <button class="ecIconBtn" data-ec-editar="${s.id}" title="Editar"><i class="fa-solid fa-pen"></i></button>
          <button class="ecIconBtn ecIconBtnDanger" data-ec-excluir="${s.id}" title="Excluir"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>`;
    }).join("") ||
      `<tr><td colspan="11" class="ecVazio">Nenhuma solicitação encontrada para os filtros selecionados.</td></tr>`;
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
  const itens = [];
  const escritorio = escritorioDoDsei(s.dsei);
  if (s.dataSolicitacao) itens.push({ data: s.dataSolicitacao, hora: "09:12", evento: "Solicitação enviada à gráfica", ator: "ADMIN" });
  if (s.dataEnvio) itens.push({ data: s.dataEnvio, hora: "14:30", evento: "Crachá enviado pela gráfica", ator: "GRÁFICA" });
  if (s.dataEntregaEscritorio) itens.push({ data: s.dataEntregaEscritorio, hora: "10:45", evento: "Crachá entregue ao escritório", ator: escritorio });
  if (s.dataEntregaColaborador) itens.push({ data: s.dataEntregaColaborador, hora: "11:20", evento: "Crachá entregue ao colaborador", ator: escritorio });
  if (s.dataDevolucao) itens.push({ data: s.dataDevolucao, hora: "16:05", evento: "Crachá devolvido", ator: escritorio });
  return itens;
}

function abrirDetalhe(id) {
  const s = solicitacoes.find(r => r.id === id);
  if (!s) return;
  detalheId = id;

  const set = (elId, v) => { const el = $(elId); if (el) el.textContent = v || "—"; };
  $("ecDetalheNome").textContent = s.nome;
  $("ecDetalheBadge").innerHTML = badgeStatus(statusDe(s));

  set("ecDetDsei", s.dsei);
  set("ecDetCargo", s.cargo);
  set("ecDetDataSolic", s.dataSolicitacao);
  set("ecDetFoto", s.possuiFoto ? "Sim" : "Não");
  set("ecDetDataEnvio", s.dataEnvio);

  set("ecDetStatus", statusDe(s));
  set("ecDetStatusSolic", s.dataSolicitacao);
  set("ecDetStatusEnvio", s.dataEnvio);
  set("ecDetStatusEscritorio", s.dataEntregaEscritorio);
  set("ecDetStatusColaborador", s.dataEntregaColaborador);
  set("ecDetStatusDevolucao", s.dataDevolucao);

  const timeline = $("ecDetTimeline");
  if (timeline) {
    timeline.innerHTML = timelineDe(s).map(i => `
      <li class="ecTimelineItem">
        <div class="ecTimelineDot"></div>
        <div class="ecTimelineConteudo">
          <div class="ecTimelineQuando">${escapeHtml(i.data)} ${escapeHtml(i.hora)}</div>
          <div class="ecTimelineEvento">${escapeHtml(i.evento)}</div>
          <div class="ecTimelineAtor">${escapeHtml(i.ator)}</div>
        </div>
      </li>`).join("") || `<li class="ecTimelineVazio">Sem histórico registrado.</li>`;
  }

  const obs = $("ecDetObs");
  if (obs) obs.value = s.observacao || "";

  const painel = $("ecDetalhe");
  if (painel) {
    painel.hidden = false;
    painel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  render();
}

function recolherDetalhe() {
  detalheId = null;
  const painel = $("ecDetalhe");
  if (painel) painel.hidden = true;
  render();
}

// ---------- Ações do escritório (registro de etapas) ----------
function registrarEtapa(tipo) {
  const s = solicitacoes.find(r => r.id === detalheId);
  if (!s) return;
  const data = hojeBR();

  if (tipo === "escritorio") {
    if (!s.dataEnvio) { ecToast("O crachá ainda não foi enviado pela gráfica.", "erro"); return; }
    if (s.dataEntregaEscritorio) { ecToast("Entrega ao escritório já registrada.", "erro"); return; }
    s.dataEntregaEscritorio = data;
    ecToast(`Entrega ao escritório registrada (${data}).`);
  } else if (tipo === "colaborador") {
    if (!s.dataEntregaEscritorio) { ecToast("Registre primeiro a entrega ao escritório.", "erro"); return; }
    if (s.dataEntregaColaborador) { ecToast("Entrega ao colaborador já registrada.", "erro"); return; }
    s.dataEntregaColaborador = data;
    ecToast(`Entrega ao colaborador registrada (${data}).`);
  } else if (tipo === "devolucao") {
    if (!s.dataEntregaColaborador) { ecToast("Só é possível devolver após a entrega ao colaborador.", "erro"); return; }
    if (s.dataDevolucao) { ecToast("Devolução já registrada.", "erro"); return; }
    s.dataDevolucao = data;
    ecToast(`Devolução registrada (${data}).`);
  }

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

function brParaISO(br) {
  if (!br) return "";
  const [d, m, a] = br.split("/");
  if (!d || !m || !a) return "";
  return `${a}-${m}-${d}`;
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
    solicitacoes.unshift(registro(proximoId++, dsei, nome, cargo, foto, dataSolic, "", "", "", ""));
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
    if (acao) { registrarEtapa(acao.dataset.ecAcao); return; }
  });
}
