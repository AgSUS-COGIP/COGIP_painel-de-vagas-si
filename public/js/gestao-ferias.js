// =========================================================
// Gestão de Férias
// Análise (somente leitura) a partir de /api/ferias — que cruza a VW_SAUDE_INDIGENA
// (trabalhadores ativos) com a SIP_HISTORICO_AFASTAMENTO (férias), ligadas por
// MATRICULA. KPIs no topo, alertas de "dobra" pela CLT e consulta geral.
// O fluxo de solicitação/aprovação (escritório -> COAPE) é uma DEMONSTRAÇÃO em
// memória (sem gravação no banco) — a integração será definida depois.
// =========================================================
import { apiGet } from "./api.js";
import { nivelModulo } from "./permissoes.js";
import { state } from "./state.js";
import { escapeHtml, formatNumber, baixarArquivoCsv } from "./utils.js";
import { criarToast } from "./ui-utils.js";
import { criarTabelaArrastavel } from "./tabela-arrastavel.js";

const $ = id => document.getElementById(id);

// CLT: período concessivo encerra 24 meses após a admissão (1º ciclo).
const MESES_LIMITE_GOZO = 24;

// COAPE: por enquanto, a análise/aprovação é liberada para nível administrativo
// (>= 2). O papel "COAPE" próprio deve ser definido depois no controle de acesso.
const NIVEL_COAPE = 2;
function ehCoape() {
  return nivelModulo("gestaoFerias") >= NIVEL_COAPE;
}

// Solicitação / alteração / cancelamento de férias exigem Editor (>= 2) no
// módulo. O Leitor só vê a aba "Visão Geral" (análise somente leitura).
function podeSolicitarFerias() {
  return nivelModulo("gestaoFerias") >= NIVEL_COAPE;
}

// Toast simples (controlador compartilhado em ui-utils).
const gfToast = criarToast("gfToast", { duracaoMs: 3000 });

// ---------- Estado ----------
let dados = null;       // { rows (objetos), hoje, atualizadoEm }
let porMatricula = new Map();
let carregado = false;
let carregando = false;
let configurado = false;

// Fluxo (em memória)
let lote = [];          // solicitações em elaboração
let coape = [];         // solicitações encaminhadas à COAPE
let trabSelecionado = null;
let abaAtiva = "visaoGeral"; // sub-aba ativa

// ---------- Sub-abas (Visão Geral | Solicitação | Aprovação COAPE) ----------
function trocarTab(tab) {
  if (tab === "coape" && !ehCoape()) tab = "visaoGeral";          // COAPE só para a COAPE
  if (tab === "solicitacao" && !podeSolicitarFerias()) tab = "visaoGeral"; // Leitor não solicita
  abaAtiva = tab;
  document.querySelectorAll("#gfTabs .gfTab").forEach(b => b.classList.toggle("is-active", b.dataset.gfTab === tab));
  document.querySelectorAll("#gfBody .gfPane").forEach(p => { p.hidden = p.dataset.gfPane !== tab; });
  // Sub-aba recém-exibida: suas grades estavam ocultas (largura 0) e não montaram —
  // (re)constrói/recalcula agora que o painel está visível.
  if (tab === "solicitacao") { renderPedido(); renderHistLotes(); gfGradeProf?.redraw(); gfGradeDet?.redraw(); gfGradeHistLotes?.redraw(); }
  else if (tab === "coape") { renderCoape(); gfGradeCoape?.redraw(); }
}
// Mostra a aba da COAPE só para a COAPE e a aba de Solicitação só para Editor+;
// o Leitor fica apenas com a Visão Geral. Reavalia a cada render.
function atualizarAcessoCoape() {
  const tCoape = $("gfTabCoape");
  const okCoape = ehCoape();
  if (tCoape) tCoape.hidden = !okCoape;

  const tSolic = $("gfTabSolicitacao");
  const okSolic = podeSolicitarFerias();
  if (tSolic) tSolic.hidden = !okSolic;

  if ((!okCoape && abaAtiva === "coape") || (!okSolic && abaAtiva === "solicitacao")) {
    trocarTab("visaoGeral");
  }
}

// Filtros (multi-seleção) — cada um é um array de valores selecionados.
const combos = {};
let filtros = vazio();
function vazio() {
  return { nome: [], matricula: [], centro: [], cargo: [], situacao: [], tipoAdm: [], status: [], alerta: [] };
}

// ---------- Combobox multi-seleção pesquisável ----------
function fecharTodosCombos(exceto) {
  Object.values(combos).forEach(c => { if (c.root !== exceto) c.fechar(); });
}
function criarCombo(id, rotuloTodos, onChange, opts) {
  const root = $(id);
  if (!root) return null;
  const maxRender = (opts && opts.maxRender) || 200;
  const ph = (opts && opts.searchPlaceholder) || "Buscar…";
  root.innerHTML = `
    <button type="button" class="gfComboBtn"><span class="gfComboValor"></span><i class="fa-solid fa-chevron-down"></i></button>
    <div class="gfComboPop" hidden>
      <div class="gfComboSearch"><i class="fa-solid fa-magnifying-glass"></i><input type="text" class="gfComboInput" placeholder="${ph}" autocomplete="off"><button type="button" class="gfComboClear" hidden>Limpar</button></div>
      <ul class="gfComboList"></ul>
    </div>`;
  const btn = root.querySelector(".gfComboBtn");
  const valorEl = root.querySelector(".gfComboValor");
  const pop = root.querySelector(".gfComboPop");
  const input = root.querySelector(".gfComboInput");
  const clearBtn = root.querySelector(".gfComboClear");
  const list = root.querySelector(".gfComboList");
  let opcoes = [];
  const sel = new Set();
  let rotuloAll = rotuloTodos;

  function atualizarBotao() {
    let txt = rotuloAll;
    if (sel.size === 1) { const o = opcoes.find(o => o.value === [...sel][0]); txt = o ? o.label : [...sel][0]; }
    else if (sel.size > 1) txt = `${sel.size} selecionados`;
    valorEl.textContent = txt;
    root.classList.toggle("temValor", sel.size > 0);
    clearBtn.hidden = sel.size === 0;
  }
  function renderLista(f) {
    const q = (f || "").trim().toLowerCase();
    const vis = opcoes.filter(o => !q || o.label.toLowerCase().includes(q));
    const mostra = vis.slice(0, maxRender);
    let html = mostra.map(o => `<li class="gfComboOpt${sel.has(o.value) ? " is-sel" : ""}" data-v="${escapeHtml(o.value)}" title="${escapeHtml(o.label)}"><span class="gfComboCheck"><i class="fa-solid fa-check"></i></span><span class="gfComboOptLabel">${escapeHtml(o.label)}</span></li>`).join("");
    if (!vis.length) html = `<li class="gfComboVazio">Nenhuma opção</li>`;
    else if (vis.length > maxRender) html += `<li class="gfComboMais">+${vis.length - maxRender} — digite para refinar…</li>`;
    list.innerHTML = html;
  }
  function abrir() { fecharTodosCombos(root); pop.hidden = false; root.classList.add("aberto"); input.value = ""; renderLista(""); setTimeout(() => input.focus(), 10); }
  function fechar() { pop.hidden = true; root.classList.remove("aberto"); }
  function toggle(v) { if (sel.has(v)) sel.delete(v); else sel.add(v); atualizarBotao(); renderLista(input.value); if (onChange) onChange(); }

  btn.addEventListener("click", e => { e.stopPropagation(); pop.hidden ? abrir() : fechar(); });
  pop.addEventListener("click", e => e.stopPropagation());
  input.addEventListener("input", () => renderLista(input.value));
  input.addEventListener("keydown", e => { if (e.key === "Enter") { const o = list.querySelector(".gfComboOpt"); if (o) toggle(o.dataset.v); e.preventDefault(); } else if (e.key === "Escape") fechar(); });
  list.addEventListener("click", e => { const li = e.target.closest(".gfComboOpt"); if (li) toggle(li.dataset.v); });
  clearBtn.addEventListener("click", () => { sel.clear(); atualizarBotao(); renderLista(input.value); if (onChange) onChange(); });

  const inst = {
    root,
    setOptions(valores, rotulo) {
      if (rotulo) rotuloAll = rotulo;
      opcoes = valores.map(v => (v && typeof v === "object") ? { value: String(v.value), label: String(v.label) } : { value: String(v), label: String(v) });
      atualizarBotao();
    },
    getValues() { return [...sel]; },
    clear() { sel.clear(); atualizarBotao(); },
    fechar
  };
  atualizarBotao();
  combos[id] = inst;
  return inst;
}

// ---------- Datas / CLT ----------
function fData(iso) {
  if (!iso) return "";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return (a && m && d) ? `${d}/${m}/${a}` : "";
}
function somarMeses(iso, meses) {
  const [a, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!a) return "";
  return new Date(Date.UTC(a, m - 1 + meses, d)).toISOString().slice(0, 10);
}
function diasEntre(isoA, isoB) {
  const [a1, m1, d1] = String(isoA).split("-").map(Number);
  const [a2, m2, d2] = String(isoB).split("-").map(Number);
  if (!a1 || !a2) return null;
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86400000);
}
function diasPeriodo(ini, fim) {
  const d = diasEntre(ini, fim);
  return d === null ? 0 : d + 1; // inclusivo (corridos)
}

// ---------- Carregamento ----------
async function carregar() {
  if (carregando || carregado) return;
  carregando = true;
  mostrarEstado("Carregando dados de férias…");
  try {
    const payload = await apiGet("/api/ferias");
    dados = decodificar(payload);
    porMatricula = new Map(dados.rows.map(r => [String(r.matricula), r]));
    carregado = true;
    esconderEstado();
    preencherFiltros();
    render();
  } catch (e) {
    mostrarEstado(e && e.message ? e.message : "Falha ao carregar os dados de férias.", true);
  } finally {
    carregando = false;
  }
}

function decodificar(payload) {
  const fields = payload.fields || [];
  const rawFields = payload.rawFields || [];
  const dim = payload.dim || {};
  const base = fields.length;
  const rows = (payload.rows || []).map(r => {
    const o = {};
    fields.forEach((f, i) => { o[f] = dim[f][r[i]]; });
    rawFields.forEach((f, j) => { o[f] = r[base + j]; });
    return o;
  });
  return { rows, hoje: payload.hoje, atualizadoEm: payload.atualizadoEm };
}

// ---------- Estado visual ----------
function mostrarEstado(msg, erro) {
  const el = $("gfEstado"), body = $("gfBody");
  if (el) {
    el.hidden = false;
    el.classList.toggle("is-erro", !!erro);
    el.innerHTML = erro ? `<i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(msg)}`
      : `<span class="gfSpinner"></span> ${escapeHtml(msg)}`;
  }
  if (body) body.style.display = "none";
}
function esconderEstado() {
  const el = $("gfEstado"); if (el) el.hidden = true;
  const body = $("gfBody"); if (body) body.style.display = "";
}

function setText(id, v) { const el = $(id); if (el) el.textContent = v; }

// ---------- Render principal ----------
function render() {
  if (!carregado || !dados) return;
  const rows = aplicarFiltros();

  // KPIs
  const cont = st => rows.filter(r => r.status === st).length;
  setText("gfKpiAtivos", formatNumber(rows.length));
  setText("gfKpiGozo", formatNumber(cont("Em gozo")));
  setText("gfKpiProgramadas", formatNumber(cont("Programadas")));
  setText("gfKpiConcluidas", formatNumber(cont("Concluídas")));
  setText("gfKpiSemProg", formatNumber(cont("Sem programação")));
  const aler = b => rows.filter(r => r.alerta === b).length;
  setText("gfKpiA180", formatNumber(aler("Menos de 180 dias")));
  setText("gfKpiA90", formatNumber(aler("Menos de 90 dias")));
  setText("gfKpiA30", formatNumber(aler("Menos de 30 dias")));

  setText("gfAtualizado", dados.atualizadoEm ? new Date(dados.atualizadoEm).toLocaleDateString("pt-BR") : "—");

  // Mini-cards de alerta (faixas).
  setText("gfAlA30", formatNumber(aler("Menos de 30 dias")));
  setText("gfAlA90", formatNumber(aler("Menos de 90 dias")));
  setText("gfAlA180", formatNumber(aler("Menos de 180 dias")));

  renderResumoFiltro(rows);
  renderAlertas(rows);
  renderConsulta(rows);
  renderPedido();
  renderCoape();
  atualizarAcessoCoape();
}

function renderResumoFiltro(rows) {
  const p = [];
  const arr = (nome, lista) => { if (lista.length) p.push(lista.length <= 2 ? lista.join(", ") : `${lista.length} ${nome}`); };
  arr("nomes", filtros.nome); arr("matrículas", filtros.matricula); arr("DSEIs/CASAIs", filtros.centro);
  arr("cargos", filtros.cargo); arr("situações", filtros.situacao); arr("tipos de admissão", filtros.tipoAdm);
  arr("status", filtros.status); arr("alertas", filtros.alerta);
  setText("gfResumoFiltro", `${formatNumber(rows.length)} trabalhadores · ${p.length ? p.join(" · ") : "Todos os ativos"}`);
}

// Filtra os trabalhadores ativos conforme os filtros selecionados (multi-seleção).
function aplicarFiltros() {
  const f = filtros;
  return dados.rows.filter(r =>
    (!f.nome.length || f.nome.includes(r.nome)) &&
    (!f.matricula.length || f.matricula.includes(String(r.matricula))) &&
    (!f.centro.length || f.centro.includes(r.centro)) &&
    (!f.cargo.length || f.cargo.includes(r.cargo)) &&
    (!f.situacao.length || f.situacao.includes(r.situacaoFuncional)) &&
    (!f.tipoAdm.length || f.tipoAdm.includes(r.tipoAdmissao)) &&
    (!f.status.length || f.status.includes(r.status)) &&
    (!f.alerta.length || f.alerta.includes(r.alerta)));
}

// ---------- Alertas de dobra ----------
function corDias(d) {
  if (d < 30) return "is-red";
  if (d < 90) return "is-orange";
  return "is-yellow";
}
// Grade arrastável dos Alertas de Dobra (colunas/linhas reordenáveis, persistidas).
let gfGradeAlertas = null;
const GF_COLS_ALERTAS = [
  { title: "Matrícula", field: "matricula" },
  { title: "DSEI/CASAI", field: "centro" },
  { title: "Trabalhador", field: "nome" },
  { title: "Cargo", field: "cargo" },
  { title: "Admissão", field: "admissao", formatter: c => fData(c.getValue()) },
  { title: "Prazo-limite de gozo", field: "limiteGozo", formatter: c => fData(c.getValue()) },
  {
    title: "Dias restantes", field: "dias", hozAlign: "center", headerHozAlign: "center",
    formatter: c => {
      const d = Number(c.getValue());
      return `<span class="gfDays ${corDias(d)}">${d < 0 ? "Em dobra" : escapeHtml(String(c.getValue()))}</span>`;
    }
  },
];

function renderAlertas(rows) {
  if (!$("gfAlertasTab")) return;
  const lista = (rows || dados.rows)
    .filter(r => r.alerta && r.alerta !== "—" && r.dias !== "")
    .sort((a, b) => Number(a.dias) - Number(b.dias));
  if (!gfGradeAlertas) gfGradeAlertas = criarTabelaArrastavel({
    elemento: "gfAlertasTab", colunas: GF_COLS_ALERTAS,
    persistID: "gfAlertas", ordemKey: "gfAlertas:ordem", indexField: "matricula",
    altura: "420px", vazio: "Nenhum trabalhador em alerta de dobra para os filtros selecionados. 🎉",
  });
  gfGradeAlertas?.render(lista);
}

// ---------- Consulta geral ----------
const BADGE_STATUS = {
  "Em gozo": "is-gozo", "Programadas": "is-programado",
  "Concluídas": "is-concluida", "Sem programação": "is-sem"
};
function badgeStatus(s) {
  return `<span class="gfBadge ${BADGE_STATUS[s] || "is-sem"}">${escapeHtml(s)}</span>`;
}

// Popula os combos de filtro (com totais quando faz sentido) + o DSEI do pedido.
function preencherFiltros() {
  const rows = dados.rows;
  const ordenar = a => [...a].sort((x, y) => String(x).localeCompare(String(y), "pt-BR"));
  const unicos = chave => ordenar([...new Set(rows.map(r => r[chave]).filter(Boolean))]);
  const contagem = chave => { const m = new Map(); rows.forEach(r => m.set(r[chave], (m.get(r[chave]) || 0) + 1)); return m; };
  const comTotal = (valores, mapa) => ordenar(valores).map(v => ({ value: v, label: `${v} (${formatNumber(mapa.get(v) || 0)})` }));

  // Nome e Registro: alta cardinalidade, sem total.
  combos.gfFNome?.setOptions(unicos("nome"));
  combos.gfFMatricula?.setOptions(unicos("matricula").map(String));
  // Categóricos: com total na frente.
  combos.gfFCentro?.setOptions(comTotal(unicos("centro"), contagem("centro")));
  combos.gfFCargo?.setOptions(comTotal(unicos("cargo"), contagem("cargo")));
  combos.gfFSituacao?.setOptions(comTotal(unicos("situacaoFuncional"), contagem("situacaoFuncional")));
  combos.gfFTipoAdm?.setOptions(comTotal(unicos("tipoAdmissao"), contagem("tipoAdmissao")));
  const cStatus = contagem("status");
  combos.gfFStatus?.setOptions(comTotal(["Em gozo", "Programadas", "Concluídas", "Sem programação"], cStatus));
  const cAlerta = contagem("alerta");
  combos.gfFAlerta?.setOptions(comTotal(["Menos de 30 dias", "Menos de 90 dias", "Menos de 180 dias"], cAlerta));

  // DSEI do registro do pedido (select nativo) + data do ofício.
  const reg = $("gfRegDsei");
  if (reg) reg.innerHTML = `<option value="">Selecione…</option>` + unicos("centro").map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
  const dataOf = $("gfRegData");
  if (dataOf && !dataOf.value && dados.hoje) dataOf.value = dados.hoje;
}

function lerFiltros() {
  const cv = id => combos[id] ? combos[id].getValues() : [];
  filtros = {
    nome: cv("gfFNome"), matricula: cv("gfFMatricula"), centro: cv("gfFCentro"), cargo: cv("gfFCargo"),
    situacao: cv("gfFSituacao"), tipoAdm: cv("gfFTipoAdm"), status: cv("gfFStatus"), alerta: cv("gfFAlerta")
  };
}

function limparFiltros() {
  Object.values(combos).forEach(c => c.clear());
  filtros = vazio();
  render();
}

// HTML de uma linha da Consulta Geral.
// Grade arrastável da Consulta Geral. O Tabulator virtualiza a renderização
// (DOM virtual), então alimentamos a lista filtrada inteira de uma vez — não é
// mais preciso paginar por rolagem manual. Sem persistência de ordem de linhas
// (lista grande/dinâmica); colunas continuam reordenáveis/persistidas.
let gfGradeConsulta = null;
const GF_COLS_CONSULTA = [
  { title: "Matrícula", field: "matricula" },
  { title: "DSEI/CASAI", field: "centro" },
  { title: "Trabalhador", field: "nome" },
  { title: "Cargo", field: "cargo" },
  { title: "Admissão", field: "admissao", formatter: c => fData(c.getValue()) },
  { title: "Status", field: "status", formatter: c => badgeStatus(c.getValue()) },
  {
    title: "Período de Férias", field: "periodoIni",
    formatter: c => {
      const r = c.getData();
      return (r.periodoIni && r.periodoFim) ? `${fData(r.periodoIni)} a ${fData(r.periodoFim)}` : "—";
    }
  },
];

function renderConsulta(rows) {
  if (!$("gfConsTab")) return;
  const lista = rows || dados.rows;
  setText("gfConsCount", `${formatNumber(lista.length)} trabalhadores`);
  setText("gfConsRegistros", lista.length ? `${formatNumber(lista.length)} trabalhadores` : "Nenhum registro");
  if (!gfGradeConsulta) gfGradeConsulta = criarTabelaArrastavel({
    elemento: "gfConsTab", colunas: GF_COLS_CONSULTA,
    persistID: "gfConsulta", indexField: "matricula", alturaFixa: true,
    vazio: "Nenhum trabalhador para os filtros selecionados.",
  });
  gfGradeConsulta?.render(lista);
}

// ---------- Fluxo: escritório registra ----------
function buscarTrabalhador() {
  const termo = ($("gfBuscaTrab")?.value || "").trim().toLowerCase();
  const info = $("gfTrabInfo");
  if (!termo) { trabSelecionado = null; if (info) info.hidden = true; return; }
  const achado = dados.rows.find(r =>
    String(r.matricula) === termo || (r.nome || "").toLowerCase().includes(termo));
  if (!achado) {
    trabSelecionado = null;
    if (info) { info.hidden = false; info.innerHTML = `<span class="gfErro">Trabalhador não encontrado entre os ativos.</span>`; }
    return;
  }
  trabSelecionado = achado;
  const aquisitivoFim = somarMeses(achado.admissao, 12);
  const limite = somarMeses(achado.admissao, MESES_LIMITE_GOZO);
  if (info) {
    info.hidden = false;
    info.innerHTML = `
      <div><strong>${escapeHtml(achado.nome)}</strong> · mat. ${escapeHtml(String(achado.matricula))}</div>
      <div>${escapeHtml(achado.cargo)} · ${escapeHtml(achado.centro)}</div>
      <div class="gfTrabClt">
        <span>Admissão: <strong>${fData(achado.admissao)}</strong></span>
        <span>Período aquisitivo: <strong>${fData(achado.admissao)} a ${fData(aquisitivoFim)}</strong></span>
        <span>Prazo-limite de gozo: <strong>${fData(limite)}</strong></span>
        <span>Status atual: ${badgeStatus(achado.status)}</span>
      </div>`;
  }
}

// Valida o fracionamento conforme a CLT (Art. 134 §1º) e os 30 dias.
function validarPeriodos(periodos, abono) {
  const msgs = [];
  let ok = true;
  const totalGozo = periodos.reduce((s, p) => s + p.dias, 0);
  const diasAbono = abono ? 10 : 0;
  const totalDevido = 30 - diasAbono;

  if (!periodos.length) return { ok: false, msgs: ["Informe ao menos o Período 1."] };
  if (periodos.length > 3) { ok = false; msgs.push("Máximo de 3 períodos (CLT Art. 134 §1º)."); }
  if (periodos.some(p => p.dias <= 0)) { ok = false; msgs.push("Há período com data fim anterior ao início."); }
  if (periodos.length > 1) {
    if (!periodos.some(p => p.dias >= 14)) { ok = false; msgs.push("Um dos períodos deve ter no mínimo 14 dias."); }
    if (periodos.some(p => p.dias < 5)) { ok = false; msgs.push("Os demais períodos devem ter no mínimo 5 dias."); }
  }
  if (totalGozo !== totalDevido) {
    ok = false;
    msgs.push(`A soma dos dias (${totalGozo}) deve ser ${totalDevido}${abono ? " (30 − 10 de abono)" : ""}.`);
  }
  if (ok) msgs.push("Conforme as regras da CLT. ✓");
  return { ok, msgs };
}

function lerPeriodosForm() {
  const par = (i) => {
    const ini = $(`gfP${i}Ini`)?.value || "", fim = $(`gfP${i}Fim`)?.value || "";
    if (!ini || !fim) return null;
    return { ini, fim, dias: diasPeriodo(ini, fim) };
  };
  return [par(1), par(2), par(3)].filter(Boolean);
}

function atualizarValidacao() {
  const el = $("gfValida");
  if (!el) return;
  const periodos = lerPeriodosForm();
  const abono = $("gfAbono")?.checked;
  if (!periodos.length) { el.innerHTML = ""; return; }
  const { ok, msgs } = validarPeriodos(periodos, abono);
  el.className = `gfValida ${ok ? "is-ok" : "is-erro"}`;
  el.innerHTML = msgs.map(m => `<div>${escapeHtml(m)}</div>`).join("");
}

function adicionarSolicitacao() {
  if (!trabSelecionado) { alert("Busque e selecione um trabalhador primeiro."); return; }
  const periodos = lerPeriodosForm();
  const abono = !!$("gfAbono")?.checked;
  const val = validarPeriodos(periodos, abono);
  if (!periodos.length) { alert("Informe ao menos o Período 1."); return; }
  lote.push({
    matricula: trabSelecionado.matricula,
    nome: trabSelecionado.nome,
    cargo: trabSelecionado.cargo,
    centro: trabSelecionado.centro,
    admissao: trabSelecionado.admissao,
    periodos, abono,
    diasAbono: abono ? 10 : 0,
    clt: val,
    situacao: "Em elaboração"
  });
  // Limpa o formulário.
  ["gfP1Ini", "gfP1Fim", "gfP2Ini", "gfP2Fim", "gfP3Ini", "gfP3Fim", "gfBuscaTrab"].forEach(id => { const e = $(id); if (e) e.value = ""; });
  if ($("gfAbono")) $("gfAbono").checked = false;
  const info = $("gfTrabInfo"); if (info) info.hidden = true;
  trabSelecionado = null;
  atualizarValidacao();
  renderPedido();
  gfToast("Trabalhador adicionado à solicitação.");
}

function periodosTexto(periodos) {
  return periodos.map(p => `${fData(p.ini)}–${fData(p.fim)} (${p.dias}d)`).join(" · ") || "—";
}
function periodoAquisitivo(adm) {
  return adm ? `${fData(adm)} a ${fData(somarMeses(adm, 12))}` : "—";
}
function periodoSlot(periodos, i) {
  return periodos && periodos[i] ? `${fData(periodos[i].ini)}–${fData(periodos[i].fim)} (${periodos[i].dias}d)` : "—";
}

// Grades arrastáveis do fluxo de solicitação (DEMO, em memória). São listas que
// re-renderizam a cada ação (incluir/remover/aprovar), então NÃO habilitamos
// arrastar LINHAS (a ordem seria redefinida a cada ação, parecendo travada); só
// COLUNAS são reordenáveis/persistidas. As ações usam o índice do array (`_idx`),
// injetado em cada linha, o que mantém a delegação existente válida.
let gfGradeProf = null;
let gfGradeDet = null;
let gfGradeAcomp = null;
let gfGradeCoape = null;

const GF_COLS_PROF = [
  { title: "Nome", field: "nome" },
  { title: "Cargo", field: "cargo" },
  { title: "Matrícula", field: "matricula" },
  { title: "Período aquisitivo", field: "_periodoAq", formatter: c => periodoAquisitivo(c.getData().admissao) },
  { title: "Prazo-limite de gozo", field: "_prazo", formatter: c => fData(somarMeses(c.getData().admissao, MESES_LIMITE_GOZO)) },
  {
    title: "Ação", field: "_acao", hozAlign: "center", headerHozAlign: "center",
    formatter: c => `<button class="gfIconBtn is-danger" data-gf-rem-lote="${c.getData()._idx}" title="Remover"><i class="fa-solid fa-trash"></i></button>`,
  },
];

const GF_COLS_DET = [
  { title: "Nome", field: "nome" },
  { title: "Cargo", field: "cargo" },
  { title: "Período aquisitivo", field: "_periodoAq", formatter: c => periodoAquisitivo(c.getData().admissao) },
  { title: "Período 1", field: "_p1", formatter: c => periodoSlot(c.getData().periodos, 0) },
  { title: "Período 2", field: "_p2", formatter: c => periodoSlot(c.getData().periodos, 1) },
  { title: "Período 3", field: "_p3", formatter: c => periodoSlot(c.getData().periodos, 2) },
  { title: "Abono", field: "abono", hozAlign: "center", headerHozAlign: "center", formatter: c => (c.getValue() ? "Sim" : "Não") },
  { title: "Dias (abono)", field: "diasAbono", hozAlign: "center", headerHozAlign: "center", formatter: c => String(c.getValue() || 0) },
  {
    title: "Situação", field: "_clt",
    formatter: c => { const r = c.getData(); return `<span class="gfBadge ${r.clt.ok ? "is-gozo" : "is-orange"}">${r.clt.ok ? "Conforme CLT" : "Verificar CLT"}</span>`; },
  },
];

// Registro do pedido = Profissionais incluídos + Detalhamento + Resumo do lote.
function renderPedido() {
  if ($("gfProfTab")) {
    const linhas = lote.map((s, i) => ({ ...s, _idx: i }));
    if (!gfGradeProf) gfGradeProf = criarTabelaArrastavel({
      elemento: "gfProfTab", colunas: GF_COLS_PROF, persistID: "gfProf",
      indexField: "_idx", movableRows: false, altura: "300px",
      vazio: "Nenhum profissional incluído. Busque um trabalhador e adicione.",
    });
    gfGradeProf?.render(linhas);
  }
  if ($("gfDetTab")) {
    const linhas = lote.map((s, i) => ({ ...s, _idx: i }));
    if (!gfGradeDet) gfGradeDet = criarTabelaArrastavel({
      elemento: "gfDetTab", colunas: GF_COLS_DET, persistID: "gfDet",
      indexField: "_idx", movableRows: false, altura: "300px", vazio: "Sem solicitações.",
    });
    gfGradeDet?.render(linhas);
  }
  renderResumo();
}

function renderResumo() {
  const frac = lote.filter(s => s.periodos.length > 1).length;
  setText("gfResTotal", lote.length);
  setText("gfResIntegrais", lote.length - frac);
  setText("gfResFracionadas", frac);
  setText("gfResAbono", lote.filter(s => s.abono).length);
  setText("gfResAprovacao", coape.filter(s => s.status === "Em análise").length);
  setText("gfResAprovadas", coape.filter(s => s.status === "Aprovado").length);
  setText("gfResRejeitadas", coape.filter(s => s.status === "Reprovado").length);
}

// Histórico dos Lotes de Férias (DEMO — dados de exemplo, antes fixos no HTML).
// Lista estática de leitura: não re-renderiza, então pode ter colunas E linhas
// arrastáveis (a ordem não "salta"). Quando integrar ao fluxo real, basta trocar
// GF_LOTES_HIST pela fonte de dados.
const GF_LOTES_HIST = [
  { data: "20/05/2024", dsei: "DSEI Yanomami", lote: "LT-2024-005", qtd: 18, responsavel: "João da Silva", status: "Em análise" },
  { data: "15/05/2024", dsei: "DSEI Alto Rio Negro", lote: "LT-2024-004", qtd: 22, responsavel: "Maria Oliveira", status: "Aprovado" },
  { data: "10/05/2024", dsei: "DSEI Leste de Roraima", lote: "LT-2024-003", qtd: 15, responsavel: "Carlos Mendes", status: "Aprovado" },
];
const GF_COLS_HISTLOTE = [
  { title: "Data", field: "data" },
  { title: "DSEI/CASAI", field: "dsei" },
  { title: "Lote", field: "lote" },
  { title: "Qtd. prof.", field: "qtd", hozAlign: "center", headerHozAlign: "center" },
  { title: "Responsável", field: "responsavel" },
  { title: "Status", field: "status", formatter: c => `<span class="gfBadge ${BADGE_FLUXO[c.getValue()] || "is-sem"}">${escapeHtml(c.getValue())}</span>` },
];
let gfGradeHistLotes = null;

function renderHistLotes() {
  if (!$("gfHistLotesTab")) return;
  if (!gfGradeHistLotes) gfGradeHistLotes = criarTabelaArrastavel({
    elemento: "gfHistLotesTab", colunas: GF_COLS_HISTLOTE,
    persistID: "gfHistLotes", ordemKey: "gfHistLotes:ordem", indexField: "lote",
    altura: "260px", vazio: "Nenhum lote no histórico.",
  });
  gfGradeHistLotes?.render(GF_LOTES_HIST);
}

function salvarLote() {
  if (!lote.length) { gfToast("Inclua ao menos um trabalhador antes de salvar.", "erro"); return; }
  const dsei = $("gfRegDsei")?.value || "—";
  gfToast(`Lote salvo em memória (${lote.length} prof. · ${dsei}).`);
}

function encaminharCoape() {
  if (!lote.length) { gfToast("Adicione ao menos um trabalhador antes de encaminhar.", "erro"); return; }
  lote.forEach(s => coape.push({ ...s, status: "Em análise", motivo: "" }));
  lote = [];
  renderPedido();
  renderCoape();
  gfToast("Solicitação encaminhada para a COAPE.");
}

// ---------- Fluxo: COAPE ----------
const BADGE_FLUXO = {
  "Em elaboração": "is-sem", "Em análise": "is-programado",
  "Aprovado": "is-gozo", "Reprovado": "is-red", "Ajuste solicitado": "is-orange", "Cancelado": "is-sem"
};
const GF_COLS_COAPE = [
  { title: "Trabalhador", field: "nome" },
  { title: "Cargo", field: "cargo" },
  { title: "Períodos", field: "_periodos", formatter: c => escapeHtml(periodosTexto(c.getData().periodos)) },
  { title: "Status", field: "status", formatter: c => `<span class="gfBadge ${BADGE_FLUXO[c.getValue()] || "is-sem"}">${escapeHtml(c.getValue())}</span>` },
  {
    title: "Ações", field: "_acoes", hozAlign: "center", headerHozAlign: "center",
    formatter: c => {
      const r = c.getData();
      return r.status === "Em análise"
        ? `<button class="gfIconBtn is-ok" data-gf-coape="aprovar" data-i="${r._idx}" title="Aprovar"><i class="fa-solid fa-check"></i></button>
           <button class="gfIconBtn is-warn" data-gf-coape="ajustar" data-i="${r._idx}" title="Solicitar ajuste"><i class="fa-solid fa-rotate-left"></i></button>
           <button class="gfIconBtn is-danger" data-gf-coape="reprovar" data-i="${r._idx}" title="Reprovar"><i class="fa-solid fa-xmark"></i></button>`
        : `<span class="gfMotivo">${r.motivo ? escapeHtml(r.motivo) : "—"}</span>`;
    },
  },
];

const GF_COLS_ACOMP = [
  { title: "Trabalhador", field: "nome" },
  { title: "Cargo", field: "cargo" },
  { title: "Períodos", field: "_periodos", formatter: c => escapeHtml(periodosTexto(c.getData().periodos)) },
  { title: "Status", field: "status", formatter: c => `<span class="gfBadge ${BADGE_FLUXO[c.getValue()] || "is-sem"}">${escapeHtml(c.getValue())}</span>` },
  { title: "Observação", field: "motivo", formatter: c => { const m = c.getValue(); return m ? escapeHtml(m) : "—"; } },
  {
    title: "Ação", field: "_acaoCan", hozAlign: "center", headerHozAlign: "center",
    formatter: c => {
      const r = c.getData();
      return r.status === "Em análise"
        ? `<button class="gfIconBtn is-danger" data-gf-cancelar="${r._idx}" title="Cancelar solicitação"><i class="fa-solid fa-ban"></i></button>`
        : "—";
    },
  },
];

function renderCoape() {
  // Acesso restrito à COAPE: bloqueia o conteúdo para quem não é COAPE.
  const coapeOk = ehCoape();
  const bloq = $("gfCoapeBloqueio");
  const cont = $("gfCoapeConteudo");
  if (bloq) bloq.hidden = coapeOk;
  if (cont) cont.style.display = coapeOk ? "" : "none";

  if ($("gfCoapeTab")) {
    const linhas = coape.map((s, i) => ({ ...s, _idx: i }));
    if (!gfGradeCoape) gfGradeCoape = criarTabelaArrastavel({
      elemento: "gfCoapeTab", colunas: GF_COLS_COAPE, persistID: "gfCoape",
      indexField: "_idx", movableRows: false, altura: "360px",
      vazio: "Nenhuma solicitação encaminhada à COAPE.",
    });
    gfGradeCoape?.render(linhas);
  }

  // Acompanhamento (lado do escritório): leitura + cancelar enquanto "Em análise".
  if ($("gfAcompTab")) {
    const linhas = coape.map((s, i) => ({ ...s, _idx: i }));
    if (!gfGradeAcomp) gfGradeAcomp = criarTabelaArrastavel({
      elemento: "gfAcompTab", colunas: GF_COLS_ACOMP, persistID: "gfAcomp",
      indexField: "_idx", movableRows: false, altura: "300px",
      vazio: "Nenhuma solicitação encaminhada ainda.",
    });
    gfGradeAcomp?.render(linhas);
  }
}

function acaoCoape(tipo, i) {
  const s = coape[i];
  if (!s) return;
  if (tipo === "aprovar") s.status = "Aprovado";
  else if (tipo === "reprovar") {
    const m = window.prompt("Motivo da reprovação:", "");
    if (m === null) return;
    s.status = "Reprovado"; s.motivo = m || "Sem motivo informado";
  } else if (tipo === "ajustar") {
    const m = window.prompt("O que deve ser ajustado?", "");
    if (m === null) return;
    s.status = "Ajuste solicitado"; s.motivo = m || "Ajuste solicitado";
  }
  renderCoape();
  renderResumo();
}

function cancelarSolicitacao(i) {
  const s = coape[i];
  if (!s || s.status !== "Em análise") return;
  if (!window.confirm(`Cancelar a solicitação de férias de "${s.nome}"?`)) return;
  s.status = "Cancelado"; s.motivo = "Cancelado pelo escritório";
  renderCoape();
  renderResumo();
  gfToast("Solicitação cancelada.");
}

// ---------- Exportação CSV ----------
function baixarCsv(linhas, nome) {
  const csv = String.fromCharCode(0xFEFF) + linhas.map(l => l.map(v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`).join(";")).join("\r\n");
  baixarArquivoCsv(csv, nome);
}
function exportarConsulta() {
  const lista = aplicarFiltros();
  if (!lista.length) { gfToast("Nada para exportar com os filtros atuais.", "erro"); return; }
  const cab = ["Matrícula", "Trabalhador", "Cargo", "DSEI/CASAI", "Admissão", "Status", "Período de Férias", "Prazo-limite"];
  const linhas = [cab].concat(lista.map(r => [
    r.matricula, r.nome, r.cargo, r.centro, fData(r.admissao), r.status,
    (r.periodoIni && r.periodoFim) ? `${fData(r.periodoIni)} a ${fData(r.periodoFim)}` : "",
    r.status === "Sem programação" ? fData(r.limiteGozo) : ""
  ]));
  baixarCsv(linhas, "consulta_ferias.csv");
}
function exportarAlertas() {
  const lista = aplicarFiltros().filter(r => r.alerta && r.alerta !== "—" && r.dias !== "").sort((a, b) => a.dias - b.dias);
  if (!lista.length) { gfToast("Nenhum alerta para exportar.", "erro"); return; }
  const cab = ["Matrícula", "DSEI/CASAI", "Trabalhador", "Cargo", "Admissão", "Prazo-limite", "Dias restantes", "Faixa"];
  const linhas = [cab].concat(lista.map(r => [r.matricula, r.centro, r.nome, r.cargo, fData(r.admissao), fData(r.limiteGozo), r.dias, r.alerta]));
  baixarCsv(linhas, "alertas_dobra_ferias.csv");
}

// ---------- Inicialização ----------
export function configurarGestaoFerias() {
  if (configurado) return;
  const raiz = $("view-gestaoFerias");
  if (!raiz) return;
  configurado = true;

  // Filtros (combos multi-seleção pesquisáveis) — recomputam KPIs, alertas e consulta.
  const onFiltro = () => { lerFiltros(); render(); };
  criarCombo("gfFNome", "Todos os trabalhadores", onFiltro, { searchPlaceholder: "Digite o nome…", maxRender: 60 });
  criarCombo("gfFMatricula", "Todas as matrículas", onFiltro, { searchPlaceholder: "Digite a matrícula…", maxRender: 60 });
  criarCombo("gfFCentro", "Todos os DSEIs/CASAIs", onFiltro);
  criarCombo("gfFCargo", "Todos os cargos", onFiltro);
  criarCombo("gfFSituacao", "Todas as situações", onFiltro);
  criarCombo("gfFTipoAdm", "Todos os tipos", onFiltro);
  criarCombo("gfFStatus", "Todos os status", onFiltro);
  criarCombo("gfFAlerta", "Todos os alertas", onFiltro);
  document.addEventListener("click", () => fecharTodosCombos(null));
  $("gfBtnLimparFiltros")?.addEventListener("click", limparFiltros);

  // Carregamento sob demanda ao abrir a aba.
  const navItem = document.querySelector('.navItem[data-view="gestaoFerias"]');
  if (navItem) navItem.addEventListener("click", () => { if (!carregado && !carregando) carregar(); });
  if (state.activeView === "gestaoFerias") carregar();

  // Exportações.
  $("gfBtnExportar")?.addEventListener("click", exportarConsulta);
  $("gfBtnExportAlertas")?.addEventListener("click", exportarAlertas);

  // Consulta Geral migrada para a grade Tabulator (DOM virtual): a rolagem
  // infinita manual deixou de ser necessária — o Tabulator virtualiza as linhas.

  // Sub-abas (Visão Geral | Solicitação | Aprovação COAPE).
  $("gfTabs")?.addEventListener("click", e => {
    const b = e.target.closest("[data-gf-tab]");
    if (b) trocarTab(b.dataset.gfTab);
  });

  // Fluxo — escritório.
  $("gfBtnBuscarTrab")?.addEventListener("click", buscarTrabalhador);
  $("gfBuscaTrab")?.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); buscarTrabalhador(); } });
  ["gfP1Ini", "gfP1Fim", "gfP2Ini", "gfP2Fim", "gfP3Ini", "gfP3Fim", "gfAbono"].forEach(id => $(id)?.addEventListener("input", atualizarValidacao));
  $("gfBtnAddSolic")?.addEventListener("click", adicionarSolicitacao);
  $("gfBtnSalvar")?.addEventListener("click", salvarLote);
  $("gfBtnEncaminhar")?.addEventListener("click", encaminharCoape);

  // Delegação: remover do lote / ações COAPE.
  raiz.addEventListener("click", e => {
    const rem = e.target.closest("[data-gf-rem-lote]");
    if (rem) { lote.splice(Number(rem.dataset.gfRemLote), 1); renderPedido(); return; }
    const co = e.target.closest("[data-gf-coape]");
    if (co) { acaoCoape(co.dataset.gfCoape, Number(co.dataset.i)); return; }
    const can = e.target.closest("[data-gf-cancelar]");
    if (can) { cancelarSolicitacao(Number(can.dataset.gfCancelar)); return; }
  });
}
