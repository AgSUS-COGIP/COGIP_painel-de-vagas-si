// =========================================================
// Entrega de Crachá
// Consome os dados reais da tabela UGP_CONTROLE_CRACHAS_SI via API
// (/api/cracha). Funil de status (4 etapas):
//   Foto Pendente de Envio -> Envio à Gráfica Pendente ->
//   Crachás em Confecção -> Crachá Confeccionado
// CRUD persistido no banco (criar/editar/excluir/avançar/voltar status),
// disponível apenas para administradores (nível >= 2).
// =========================================================
import { escapeHtml } from "./utils.js";
import { apiGet, apiPost } from "./api.js";
import { state } from "./state.js";
import { ordenarLista, registrarOrdenacao } from "./ordenacao.js";

// Getters de ordenação (Possui Foto exibido como Sim/Não).
const EC_ORDENACAO_GETTERS = { possuiFoto: s => (s.possuiFoto ? "Sim" : "Não") };

const PAGE_SIZE = 10;
const NIVEL_ADMIN = 2;

// Funil de status (rótulos amigáveis; o de-para para o banco é feito no backend).
let STATUS_LISTA = [
  "Foto Pendente de Envio", "Envio à Gráfica Pendente", "Crachás em Confecção", "Crachá Confeccionado"
];

const STATUS_CLASSE = {
  "Foto Pendente de Envio": "is-foto",
  "Envio à Gráfica Pendente": "is-grafica",
  "Crachás em Confecção": "is-confeccao",
  "Crachá Confeccionado": "is-confeccionado"
};

// Transições de avanço (botões "Registrar ...").
const TRANSICOES = {
  foto: { de: "Foto Pendente de Envio", para: "Envio à Gráfica Pendente", msg: "Foto recebida." },
  grafica: { de: "Envio à Gráfica Pendente", para: "Crachás em Confecção", msg: "Envio à gráfica registrado." },
  confeccao: { de: "Crachás em Confecção", para: "Crachá Confeccionado", msg: "Confecção concluída." }
};

function badgeStatus(status) {
  const cls = STATUS_CLASSE[status] || "is-foto";
  return `<span class="ecBadge ${cls}">${escapeHtml(status)}</span>`;
}

function statusIndex(status) {
  const i = STATUS_LISTA.indexOf(status);
  return i < 0 ? 0 : i;
}

function escritorioDoDsei(dsei) {
  return (dsei || "").replace(/^(DSEI|CASAI)\s+/, "Escritório ");
}

function podeEditar() {
  return Number((state.painelLoginUsuario || {}).nivelAutorizacao || 0) >= NIVEL_ADMIN;
}

// ---------- Estado da view ----------
let solicitacoes = [];
let carregado = false;
let carregando = false;
let erroCarregamento = "";

let filtros = { dsei: "", status: "", escritorio: "", dataIni: "", dataFim: "", nome: "", cargo: "" };
let paginaAtual = 1;
let detalheId = null;

const $ = id => document.getElementById(id);

// ---------- Datas ----------
function brParaISO(br) {
  if (!br) return "";
  const [d, m, a] = br.split("/");
  if (!d || !m || !a) return "";
  return `${a}-${m}-${d}`;
}

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
  set("ecKpiFoto", porStatus("Foto Pendente de Envio"));
  set("ecKpiGrafica", porStatus("Envio à Gráfica Pendente"));
  set("ecKpiConfeccao", porStatus("Crachás em Confecção"));
  set("ecKpiConfeccionado", porStatus("Crachá Confeccionado"));
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

// `ignorarStatus` é usado pelos KPIs: os cards de status já são a quebra por
// status, então o filtro de status não deve zerar os demais cards.
function aplicarFiltros(ignorarStatus) {
  const iniT = filtros.dataIni ? new Date(filtros.dataIni + "T00:00:00").getTime() : null;
  const fimT = filtros.dataFim ? new Date(filtros.dataFim + "T00:00:00").getTime() : null;

  return solicitacoes.filter(s => {
    if (filtros.dsei && s.dsei !== filtros.dsei) return false;
    if (!ignorarStatus && filtros.status && s.status !== filtros.status) return false;
    if (filtros.escritorio && escritorioDoDsei(s.dsei) !== filtros.escritorio) return false;
    if (filtros.nome && !(s.nome || "").toLowerCase().includes(filtros.nome) && !(s.matricula || "").toLowerCase().includes(filtros.nome)) return false;
    if (filtros.cargo && !(s.cargo || "").toLowerCase().includes(filtros.cargo)) return false;
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
  // Reavalia a permissão a cada render: no init o usuário ainda não está
  // logado (nível 0); após o login/carregamento isto reflete o nível real.
  const raiz = $("view-entregaCracha");
  if (raiz) raiz.classList.toggle("ec-readonly", !podeEditar());

  renderKpis(aplicarFiltros(true));

  const lista = ordenarLista("ec", aplicarFiltros(), EC_ORDENACAO_GETTERS);
  const totalPaginas = Math.max(1, Math.ceil(lista.length / PAGE_SIZE));
  if (paginaAtual > totalPaginas) paginaAtual = totalPaginas;
  const inicio = (paginaAtual - 1) * PAGE_SIZE;
  const pagina = lista.slice(inicio, inicio + PAGE_SIZE);
  const editar = podeEditar();

  const body = $("ecTabelaBody");
  if (body) {
    if (carregando && !carregado) {
      body.innerHTML = `<tr><td colspan="9" class="ecVazio">Carregando dados de crachás...</td></tr>`;
    } else if (erroCarregamento) {
      body.innerHTML = `<tr><td colspan="9" class="ecVazio">${escapeHtml(erroCarregamento)}</td></tr>`;
    } else {
      body.innerHTML = pagina.map(s => {
        const reverter = s.statusManual || s.dataSolicitacao || s.dataEnvio || s.observacao
          ? `<button class="ecIconBtn ecIconBtnDanger" data-ec-reverter="${escapeHtml(s.id)}" title="Reverter alterações manuais"><i class="fa-solid fa-rotate-left"></i></button>`
          : "";
        const acoesEdicao = editar
          ? `<button class="ecIconBtn" data-ec-editar="${escapeHtml(s.id)}" title="Editar datas/observação"><i class="fa-solid fa-pen"></i></button>${reverter}`
          : "";
        return `
        <tr${s.id === detalheId ? ' class="ecLinhaAtiva"' : ""}>
          <td>${celulaData(s.matricula)}</td>
          <td>${escapeHtml(s.dsei || "—")}</td>
          <td>${escapeHtml(s.nome || "—")}</td>
          <td>${escapeHtml(s.cargo || "—")}</td>
          <td>${celulaData(s.dataSolicitacao)}</td>
          <td class="ecTd-center">${s.possuiFoto ? '<span class="ecFotoSim">Sim</span>' : '<span class="ecFotoNao">Não</span>'}</td>
          <td>${celulaData(s.dataEnvio)}</td>
          <td>${badgeStatus(s.status)}</td>
          <td class="ecTd-center ecAcoesCol">
            <button class="ecIconBtn" data-ec-ver="${escapeHtml(s.id)}" title="Ver detalhes"><i class="fa-regular fa-eye"></i></button>
            ${acoesEdicao}
          </td>
        </tr>`;
      }).join("") ||
        `<tr><td colspan="9" class="ecVazio">Nenhum registro encontrado para os filtros selecionados.</td></tr>`;
    }
  }

  const registros = $("ecRegistros");
  if (registros) {
    if (!lista.length) {
      registros.textContent = carregado ? "Mostrando 0 registros" : "";
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

  // Janela de páginas em torno da atual (a base é grande: até ~1879 páginas).
  const janela = 2;
  let ini = Math.max(1, paginaAtual - janela);
  let fim = Math.min(totalPaginas, paginaAtual + janela);
  if (paginaAtual <= janela) fim = Math.min(totalPaginas, 1 + janela * 2);
  if (paginaAtual > totalPaginas - janela) ini = Math.max(1, totalPaginas - janela * 2);

  let html = `<button class="ecPageBtn ecPageNav" data-ec-pagina="prev" ${paginaAtual === 1 ? "disabled" : ""} title="Anterior"><i class="fa-solid fa-angle-left"></i></button>`;
  if (ini > 1) {
    html += `<button class="ecPageBtn" data-ec-pagina="1">1</button>`;
    if (ini > 2) html += `<span class="ecPageEllipsis">…</span>`;
  }
  for (let p = ini; p <= fim; p++) {
    html += `<button class="ecPageBtn${p === paginaAtual ? " is-ativo" : ""}" data-ec-pagina="${p}">${p}</button>`;
  }
  if (fim < totalPaginas) {
    if (fim < totalPaginas - 1) html += `<span class="ecPageEllipsis">…</span>`;
    html += `<button class="ecPageBtn" data-ec-pagina="${totalPaginas}">${totalPaginas}</button>`;
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
  if (s.dataSolicitacao) itens.push({ data: s.dataSolicitacao, evento: "Solicitação registrada", ator: "" });
  if (s.dataEnvio) itens.push({ data: s.dataEnvio, evento: "Enviado à gráfica", ator: "" });
  itens.push({ data: s.atualizadoEm || "—", evento: `Status: ${s.status}`, ator: s.atualizadoPor || "" });
  return itens;
}

function abrirDetalhe(id) {
  const s = solicitacoes.find(r => r.id === id);
  if (!s) return;
  detalheId = id;

  const set = (elId, v) => { const el = $(elId); if (el) el.textContent = v || "—"; };
  $("ecDetalheNome").textContent = s.nome || "—";
  $("ecDetalheBadge").innerHTML = badgeStatus(s.status);

  set("ecDetMatricula", s.matricula);
  set("ecDetDsei", s.dsei);
  set("ecDetCargo", s.cargo);
  set("ecDetSituacao", s.situacaoDetalhada);
  set("ecDetFoto", s.possuiFoto ? "Sim" : "Não");

  set("ecDetStatus", s.status);
  set("ecDetStatusSolic", s.dataSolicitacao);
  set("ecDetStatusEnvio", s.dataEnvio);
  set("ecDetMotivo", s.motivo);
  set("ecDetAtualizado", s.atualizadoEm ? `${s.atualizadoEm}${s.atualizadoPor ? " · " + s.atualizadoPor : ""}` : "");

  const timeline = $("ecDetTimeline");
  if (timeline) {
    timeline.innerHTML = timelineDe(s).map(i => `
      <li class="ecTimelineItem">
        <div class="ecTimelineDot"></div>
        <div class="ecTimelineConteudo">
          <div class="ecTimelineQuando">${escapeHtml(i.data || "—")}</div>
          <div class="ecTimelineEvento">${escapeHtml(i.evento)}</div>
          ${i.ator ? `<div class="ecTimelineAtor">${escapeHtml(i.ator)}</div>` : ""}
        </div>
      </li>`).join("");
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

// Habilita só o botão da próxima etapa válida; "voltar" enquanto não for a 1ª.
function atualizarBotoesAcao(s) {
  document.querySelectorAll("#ecDetalhe [data-ec-acao]").forEach(btn => {
    const tipo = btn.dataset.ecAcao;
    if (tipo === "voltar") {
      btn.disabled = statusIndex(s.status) <= 0;
      return;
    }
    const t = TRANSICOES[tipo];
    btn.disabled = !t || s.status !== t.de;
  });
}

function recolherDetalhe() {
  detalheId = null;
  const painel = $("ecDetalhe");
  if (painel) painel.hidden = true;
  render();
}

// ---------- Persistência (API) ----------
function aplicarRegistro(reg) {
  if (!reg) return;
  const i = solicitacoes.findIndex(r => r.id === reg.id);
  if (i >= 0) solicitacoes[i] = reg;
  else solicitacoes.unshift(reg);
}

async function registrarEtapa(tipo) {
  const s = solicitacoes.find(r => r.id === detalheId);
  if (!s) return;
  const t = TRANSICOES[tipo];
  if (!t || s.status !== t.de) {
    ecToast("Esta ação não se aplica ao status atual.", "erro");
    return;
  }
  await mudarStatus(s.id, t.para, t.msg);
}

async function voltarEtapa() {
  const s = solicitacoes.find(r => r.id === detalheId);
  if (!s) return;
  const idx = statusIndex(s.status);
  if (idx <= 0) { ecToast("O crachá já está na primeira etapa.", "erro"); return; }
  const novo = STATUS_LISTA[idx - 1];
  await mudarStatus(s.id, novo, `Status revertido para "${novo}".`);
}

async function mudarStatus(matricula, status, msgOk) {
  try {
    const resp = await apiPost("/api/cracha/status", { matricula, status });
    aplicarRegistro(resp.registro);
    ecToast(msgOk);
    abrirDetalhe(matricula);
  } catch (e) {
    ecToast(e && e.message ? e.message : "Falha ao atualizar o status.", "erro");
  }
}

async function salvarObservacao() {
  const s = solicitacoes.find(r => r.id === detalheId);
  if (!s) return;
  try {
    const resp = await apiPost("/api/cracha/salvar", {
      matricula: s.matricula,
      observacao: $("ecDetObs")?.value || ""
    });
    aplicarRegistro(resp.registro);
    ecToast("Observação salva.");
    abrirDetalhe(s.id);
  } catch (e) {
    ecToast(e && e.message ? e.message : "Falha ao salvar a observação.", "erro");
  }
}

// ---------- Modal de edição do overlay (datas) ----------
// A identidade (matrícula/nome/DSEI/cargo) vem do ETL e é só leitura; o status
// é gerido pelos botões de etapa. Aqui só editamos as datas de controle.
let modalEditId = null;

function abrirModal(editId) {
  const s = solicitacoes.find(r => r.id === editId);
  if (!s) return;
  modalEditId = s.id;

  const erro = $("ecModalErro");
  if (erro) erro.textContent = "";
  const titulo = $("ecModalTitulo");
  if (titulo) titulo.textContent = "Editar Datas do Crachá";

  const matInput = $("ecFormMatricula");
  if (matInput) { matInput.value = s.matricula || ""; matInput.disabled = true; }
  const nomeInput = $("ecFormNome");
  if (nomeInput) { nomeInput.value = s.nome || ""; nomeInput.disabled = true; }
  const cargoInput = $("ecFormCargo");
  if (cargoInput) { cargoInput.value = s.cargo || ""; cargoInput.disabled = true; }
  const dseiInput = $("ecFormDsei");
  if (dseiInput) { dseiInput.value = s.dsei || ""; dseiInput.disabled = true; }
  $("ecFormDataSolic").value = brParaISO(s.dataSolicitacao);
  $("ecFormDataEnvio").value = brParaISO(s.dataEnvio);
  const fotoWrap = $("ecFormFotoWrap");
  if (fotoWrap) fotoWrap.hidden = true;

  const modal = $("ecModal");
  if (modal) modal.hidden = false;
}

function fecharModal() {
  const modal = $("ecModal");
  if (modal) modal.hidden = true;
  modalEditId = null;
}

async function salvarModal() {
  const erro = $("ecModalErro");
  if (erro) erro.textContent = "";
  const s = solicitacoes.find(r => r.id === modalEditId);
  if (!s) return;

  try {
    const resp = await apiPost("/api/cracha/salvar", {
      matricula: s.matricula,
      dataSolicitacao: $("ecFormDataSolic")?.value || "",
      dataEnvio: $("ecFormDataEnvio")?.value || ""
    });
    aplicarRegistro(resp.registro);
    ecToast("Datas atualizadas.");
    fecharModal();
    render();
    if (detalheId === s.id) abrirDetalhe(s.id);
  } catch (e) {
    if (erro) erro.textContent = e && e.message ? e.message : "Falha ao salvar.";
  }
}

// "Reverter": remove o overlay manual (datas/observação/status), voltando o
// registro aos valores do ETL. O trabalhador continua na lista.
async function reverterSolicitacao(matricula) {
  const s = solicitacoes.find(r => r.id === matricula);
  if (!s) return;
  if (!window.confirm(`Reverter as alterações manuais de "${s.nome}" (matrícula ${s.matricula})?`)) return;
  try {
    const resp = await apiPost("/api/cracha/reverter", { matricula });
    aplicarRegistro(resp.registro);
    ecToast("Alterações manuais revertidas.");
    render();
    if (detalheId === matricula) abrirDetalhe(matricula);
  } catch (e) {
    ecToast(e && e.message ? e.message : "Falha ao reverter.", "erro");
  }
}

// ---------- Selects (DSEIs vêm dos próprios dados) ----------
function preencherSelects() {
  const dseis = [...new Set(solicitacoes.map(s => s.dsei).filter(Boolean))].sort();
  const opcoes = (id, valores, rotuloTodos) => {
    const el = $(id);
    if (!el) return;
    const atual = el.value;
    el.innerHTML = `<option value="">${rotuloTodos}</option>` +
      valores.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
    if (atual && valores.includes(atual)) el.value = atual;
  };
  opcoes("ecFiltroDsei", dseis, "Todos os DSEIs");
  opcoes("ecFiltroStatus", STATUS_LISTA, "Todos os Status");
  opcoes("ecFiltroEscritorio", dseis.map(escritorioDoDsei), "Todos os Escritórios");

  const formDsei = $("ecFormDsei");
  if (formDsei) {
    const atual = formDsei.value;
    formDsei.innerHTML = `<option value="">Selecione…</option>` +
      dseis.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
    if (atual && dseis.includes(atual)) formDsei.value = atual;
  }
}

function limparFiltros() {
  ["ecFiltroDsei", "ecFiltroStatus", "ecFiltroEscritorio", "ecFiltroDataInicial", "ecFiltroDataFinal", "ecBuscaNome", "ecBuscaCargo"]
    .forEach(id => { const el = $(id); if (el) el.value = ""; });
  lerFiltros();
  paginaAtual = 1;
  render();
}

// ---------- Carregamento dos dados reais ----------
async function carregarDados() {
  if (carregando) return;
  carregando = true;
  erroCarregamento = "";
  render();
  try {
    const payload = await apiGet("/api/cracha");
    solicitacoes = payload.rows || [];
    if (Array.isArray(payload.statusFunil) && payload.statusFunil.length) {
      STATUS_LISTA = payload.statusFunil;
    }
    carregado = true;
  } catch (e) {
    erroCarregamento = e && e.message ? e.message : "Falha ao carregar os dados de crachás.";
  } finally {
    carregando = false;
    preencherSelects();
    render();
  }
}

// ---------- Inicialização ----------
let entregaCrachaConfigurada = false;

export function configurarEntregaCracha() {
  if (entregaCrachaConfigurada) return;
  const raiz = $("view-entregaCracha");
  if (!raiz) return;
  entregaCrachaConfigurada = true;

  registrarOrdenacao("ec", () => { paginaAtual = 1; render(); });

  raiz.classList.toggle("ec-readonly", !podeEditar());

  preencherSelects();
  render();

  // Carregamento sob demanda: a base tem ~18k linhas; só busca quando a aba é
  // aberta pela primeira vez (evita baixar tudo em todo load do painel).
  const navItem = document.querySelector('.navItem[data-view="entregaCracha"]');
  if (navItem) navItem.addEventListener("click", () => { if (!carregado && !carregando) carregarDados(); });
  if (state.activeView === "entregaCracha") carregarDados();

  // Filtros reagem na hora (change para selects/datas, input para buscas).
  raiz.querySelectorAll("[data-ec-filtro]").forEach(el => {
    const evento = el.tagName === "INPUT" && el.type === "search" ? "input" : "change";
    el.addEventListener(evento, () => { lerFiltros(); paginaAtual = 1; render(); });
  });

  $("ecBtnLimpar")?.addEventListener("click", limparFiltros);
  $("ecBtnRecolher")?.addEventListener("click", recolherDetalhe);
  $("ecBtnSalvarObs")?.addEventListener("click", salvarObservacao);

  // Modal.
  $("ecModalFechar")?.addEventListener("click", fecharModal);
  $("ecModalCancelar")?.addEventListener("click", fecharModal);
  $("ecModalSalvar")?.addEventListener("click", salvarModal);
  $("ecModal")?.addEventListener("click", event => {
    if (event.target === $("ecModal")) fecharModal();
  });

  // Delegação para elementos gerados dinamicamente.
  raiz.addEventListener("click", event => {
    const ver = event.target.closest("[data-ec-ver]");
    if (ver) { abrirDetalhe(ver.dataset.ecVer); return; }

    const editar = event.target.closest("[data-ec-editar]");
    if (editar) { abrirModal(editar.dataset.ecEditar); return; }

    const reverter = event.target.closest("[data-ec-reverter]");
    if (reverter) { reverterSolicitacao(reverter.dataset.ecReverter); return; }

    const pagina = event.target.closest("[data-ec-pagina]");
    if (pagina && !pagina.disabled) { irParaPagina(pagina.dataset.ecPagina); return; }

    const acao = event.target.closest("[data-ec-acao]");
    if (acao && !acao.disabled) {
      if (acao.dataset.ecAcao === "voltar") voltarEtapa();
      else registrarEtapa(acao.dataset.ecAcao);
      return;
    }
  });
}
