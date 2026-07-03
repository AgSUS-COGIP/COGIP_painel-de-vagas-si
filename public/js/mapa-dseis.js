// =========================================================
// Mapa dos DSEIs — dados reais (VW_SAUDE_INDIGENA + TB_LOTACAO_OVERRIDE)
// Consome /api/mapa-dseis (payload híbrido colunar/dicionarizado, ver
// lib/mapa-dseis.js), remonta as linhas e monta filtros, mapas, métricas e a
// tabela 100% no cliente. Carga sob demanda ao abrir a aba (base grande) —
// mesma estratégia do Painel da Força de Trabalho.
//
// Mapas:
//   - mdMapaBrasil: um marcador por DSEI/CASAI (UNIDADE_ORCAMENTARIA_DESC),
//     geolocalizado por uma tabela fixa (DSEI_COORDS) com fallback ao centro da UF.
//   - mdMapaDsei:   centraliza no DSEI selecionado; o painel lateral lista as
//     LOTAÇÕES (unidade/polo) com a contagem de trabalhadores (sem pino por
//     lotação — não há coordenada de lotação na base).
// =========================================================
import { apiGet } from "./api.js";
import { state } from "./state.js";
import { formatNumber, formatPercent, escapeHtml, escapeAttr } from "./utils.js";

const $ = id => document.getElementById(id);
const norm = s => (s || "").trim().toLowerCase();

// Regra de Vínculo com a Agência — MESMA do Painel da Força de Trabalho.
const SITUACOES_DESLIGADO = new Set([
  "aviso indenizado", "aviso trabalhado", "desligado", "desligamento sem rescisão"
]);

// Cor das bolinhas da lista de DSEIs (cicla).
const CORES_LISTA = [
  "#2563eb", "#f59e0b", "#16a34a", "#7c3aed", "#0ea5e9", "#e11d48", "#0891b2",
  "#ca8a04", "#4f46e5", "#059669", "#db2777", "#65a30d", "#9333ea", "#dc2626",
  "#0d9488", "#f97316", "#3b82f6", "#a855f7", "#22c55e", "#eab308", "#06b6d4"
];

// --------- Geolocalização (aproximada) dos DSEIs, por palavra-chave do nome ---------
// A chave é um trecho normalizado do UNIDADE_ORCAMENTARIA_DESC (sem "dsei"/"casai").
// Coordenadas da cidade-sede de cada DSEI (fonte: SESAI / conhecimento público).
const DSEI_COORDS = {
  "alagoas e sergipe": [-9.67, -35.73], "altamira": [-3.20, -52.21],
  "alto rio jurua": [-7.63, -72.67], "alto rio negro": [-0.13, -67.09],
  "alto rio purus": [-9.97, -67.81], "alto rio solimoes": [-4.25, -69.94],
  "amapa e norte do para": [0.03, -51.07], "araguaia": [-11.62, -50.67],
  "bahia": [-12.97, -38.50], "ceara": [-3.73, -38.52], "cuiaba": [-15.60, -56.10],
  "guama tocantins": [-1.46, -48.50], "interior sul": [-25.43, -49.27],
  "kaiapo do mato grosso": [-10.81, -55.46], "kayapo do para": [-8.03, -50.03],
  "kaiapo do para": [-8.03, -50.03], "leste de roraima": [2.82, -60.67],
  "litoral sul": [-27.59, -48.55], "manaus": [-3.12, -60.02],
  "maranhao": [-2.53, -44.30], "mato grosso do sul": [-20.44, -54.65],
  "medio rio purus": [-7.26, -64.80], "medio rio solimoes": [-3.36, -64.72],
  "minas gerais e espirito santo": [-18.85, -41.95], "parintins": [-2.63, -56.74],
  "pernambuco": [-8.05, -34.90], "porto velho": [-8.76, -63.90],
  "potiguara": [-7.12, -34.86], "rio tapajos": [-4.28, -55.98],
  "tocantins": [-10.18, -48.33], "vale do javari": [-4.37, -70.19],
  "vilhena": [-12.74, -60.14], "xavante": [-15.89, -52.26], "xingu": [-13.55, -52.27],
  "yanomami": [2.82, -60.67], "samu": [-15.79, -47.88]
};
const UF_COORDS = {
  AC: [-8.77, -70.55], AL: [-9.71, -35.73], AP: [1.41, -51.77], AM: [-3.42, -65.86],
  BA: [-12.96, -38.51], CE: [-3.72, -38.54], DF: [-15.83, -47.86], ES: [-19.19, -40.31],
  GO: [-16.64, -49.31], MA: [-2.55, -44.30], MT: [-12.64, -55.42], MS: [-20.51, -54.54],
  MG: [-18.10, -44.38], PA: [-3.79, -52.48], PB: [-7.28, -36.72], PR: [-24.89, -51.55],
  PE: [-8.38, -37.86], PI: [-6.60, -42.28], RJ: [-22.25, -42.66], RN: [-5.81, -36.59],
  RS: [-30.17, -53.50], RO: [-10.83, -63.34], RR: [1.99, -61.33], SC: [-27.45, -50.95],
  SP: [-22.19, -48.79], SE: [-10.57, -37.45], TO: [-9.46, -48.26]
};
const CENTRO_BRASIL = [-14.5, -52.5];

// Remove acentos/pontuação e as palavras "dsei"/"casai" para casar com DSEI_COORDS.
function chaveGeo(desc) {
  let s = (desc || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  s = s.replace(/\b(dsei|casai|distrito sanitario especial indigena|polo base|sede)\b/g, " ");
  return s.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
// Geo por DSEI a partir do rede_cnes.json (estabelecimentos com lat/lng/município).
// chaveGeo(dsei) -> { estabs, municipios:Set, centroid:[lat,lng] }.
let dseiGeo = {};
function construirGeo(rede) {
  dseiGeo = {};
  (rede || []).forEach(e => {
    const k = chaveGeo(e.dsei);
    if (!k) return;
    if (!dseiGeo[k]) dseiGeo[k] = { estabs: [], municipios: new Set() };
    dseiGeo[k].estabs.push(e);
    if (e.municipio) dseiGeo[k].municipios.add(e.municipio);
  });
  Object.values(dseiGeo).forEach(g => {
    const n = g.estabs.length || 1;
    g.centroid = [g.estabs.reduce((s, e) => s + e.lat, 0) / n, g.estabs.reduce((s, e) => s + e.lng, 0) / n];
  });
}
// Cruza o UNIDADE_ORCAMENTARIA_DESC ("DSEI CEARA") com o `dsei` do arquivo
// ("CEARA") por nome normalizado, aceitando inclusão parcial.
function geoDoDsei(desc) {
  const k = chaveGeo(desc);
  if (!k) return null;
  if (dseiGeo[k]) return dseiGeo[k];
  let best = null;
  for (const key of Object.keys(dseiGeo)) {
    if ((k.includes(key) || key.includes(k)) && (!best || key.length > best.length)) best = key;
  }
  return best ? dseiGeo[best] : null;
}

// Coordenada de um DSEI/CASAI: 1º o centroide dos estabelecimentos (rede_cnes);
// senão a tabela fixa; senão o centro da UF; senão o centro do Brasil.
function coordDsei(desc, uf) {
  const g = geoDoDsei(desc);
  if (g && g.centroid) return g.centroid;
  const k = chaveGeo(desc);
  let melhor = null;
  for (const chave of Object.keys(DSEI_COORDS)) {
    if (k.includes(chave) && (!melhor || chave.length > melhor.length)) melhor = chave;
  }
  if (melhor) return DSEI_COORDS[melhor];
  const u = (uf || "").toUpperCase().trim();
  if (UF_COORDS[u]) return UF_COORDS[u];
  return CENTRO_BRASIL;
}

// ---------- Estado ----------
let dados = null;
let carregado = false, carregando = false, configurado = false;
let mapasIniciados = false, mapaBrasil = null, mapaDsei = null;
let camadaBrasil = null, camadaDsei = null, mascaraCarregada = false;
let dseiSelecionado = "";

const combos = {};
let filtros = vazio();
function vazio() {
  return { dsei: [], lotacao: [], nome: [], cargo: [], situacao: [], vinculo: [], tipoAdmissao: [], grau: [] };
}

// ---------- Combobox pesquisável de múltipla seleção (mesmo visual do SI) ----------
function fecharTodosCombos(exceto) {
  Object.values(combos).forEach(c => { if (c.root !== exceto) c.fechar(); });
}
function criarCombo(containerId, rotuloTodos, onChange, opts) {
  const root = $(containerId);
  if (!root) return null;
  const maxRender = (opts && opts.maxRender) || 200;
  const buscaPlaceholder = (opts && opts.searchPlaceholder) || "Buscar…";
  root.innerHTML = `
    <button type="button" class="siComboBtn">
      <span class="siComboValor"></span><i class="fa-solid fa-chevron-down"></i>
    </button>
    <div class="siComboPop" hidden>
      <div class="siComboSearch">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="text" class="siComboInput" placeholder="${escapeAttr(buscaPlaceholder)}" autocomplete="off">
        <button type="button" class="siComboClear" hidden>Limpar</button>
      </div>
      <ul class="siComboList"></ul>
    </div>`;
  const btn = root.querySelector(".siComboBtn");
  const valorEl = root.querySelector(".siComboValor");
  const pop = root.querySelector(".siComboPop");
  const input = root.querySelector(".siComboInput");
  const clearBtn = root.querySelector(".siComboClear");
  const list = root.querySelector(".siComboList");

  let opcoes = [];
  const selecionados = new Set();
  let rotuloAll = rotuloTodos;

  function atualizarBotao() {
    let txt = rotuloAll;
    if (selecionados.size === 1) {
      const v = [...selecionados][0];
      const o = opcoes.find(o => o.value === v);
      txt = o ? o.label : v;
    } else if (selecionados.size > 1) txt = `${selecionados.size} selecionados`;
    valorEl.textContent = txt;
    root.classList.toggle("temValor", selecionados.size > 0);
    clearBtn.hidden = selecionados.size === 0;
  }
  function renderLista(filtro) {
    const f = (filtro || "").trim().toLowerCase();
    const vis = opcoes.filter(o => !f || o.label.toLowerCase().includes(f));
    const mostrados = vis.slice(0, maxRender);
    let html = mostrados.map(o =>
      `<li class="siComboOpt${selecionados.has(o.value) ? " is-sel" : ""}" data-v="${escapeAttr(o.value)}" title="${escapeAttr(o.label)}">
        <span class="siComboCheck"><i class="fa-solid fa-check"></i></span>
        <span class="siComboOptLabel">${escapeHtml(o.label)}</span>
      </li>`).join("");
    if (!vis.length) html = `<li class="siComboVazio">Nenhuma opção</li>`;
    else if (vis.length > maxRender) html += `<li class="siComboMais">+${vis.length - maxRender} — digite para refinar…</li>`;
    list.innerHTML = html;
  }
  function abrir() { fecharTodosCombos(root); pop.hidden = false; root.classList.add("aberto"); input.value = ""; renderLista(""); setTimeout(() => input.focus(), 10); }
  function fechar() { pop.hidden = true; root.classList.remove("aberto"); }
  function toggle(v) {
    if (selecionados.has(v)) selecionados.delete(v); else selecionados.add(v);
    atualizarBotao(); renderLista(input.value); if (onChange) onChange();
  }
  btn.addEventListener("click", e => { e.stopPropagation(); pop.hidden ? abrir() : fechar(); });
  pop.addEventListener("click", e => e.stopPropagation());
  input.addEventListener("input", () => renderLista(input.value));
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") { const o = list.querySelector(".siComboOpt"); if (o) toggle(o.dataset.v); e.preventDefault(); }
    else if (e.key === "Escape") fechar();
  });
  list.addEventListener("click", e => { const li = e.target.closest(".siComboOpt"); if (li) toggle(li.dataset.v); });
  clearBtn.addEventListener("click", () => { selecionados.clear(); atualizarBotao(); renderLista(input.value); if (onChange) onChange(); });

  const inst = {
    root,
    setOptions(valores, rotulo) {
      if (rotulo) rotuloAll = rotulo;
      opcoes = valores.map(v => (v && typeof v === "object") ? { value: String(v.value), label: String(v.label) } : { value: String(v), label: String(v) });
      atualizarBotao();
    },
    getValues() { return [...selecionados]; },
    clear() { selecionados.clear(); atualizarBotao(); },
    // Define a seleção por código (sem disparar onChange — quem chama re-renderiza).
    definir(valores) { selecionados.clear(); (valores || []).forEach(v => selecionados.add(String(v))); atualizarBotao(); },
    fechar
  };
  atualizarBotao();
  combos[containerId] = inst;
  return inst;
}

// ---------- Carga ----------
async function carregar() {
  if (carregando || carregado) return;
  carregando = true;
  mostrarEstado("Carregando dados dos DSEIs…");
  try {
    const [payload, rede] = await Promise.all([
      apiGet("/api/mapa-dseis"),
      apiGet("/api/mapa-dseis/rede").catch(() => [])
    ]);
    dados = decodificar(payload);
    construirGeo(rede);
    carregado = true;
    esconderEstado();
    preencherFiltros();
    render();
    garantirMapas();
  } catch (e) {
    mostrarEstado(e && e.message ? e.message : "Falha ao carregar os dados.", true);
  } finally {
    carregando = false;
  }
}
function decodificar(payload) {
  const fields = payload.fields || [], rawFields = payload.rawFields || [], dim = payload.dim || {};
  const base = fields.length;
  const rows = (payload.rows || []).map(r => {
    const o = {};
    fields.forEach((f, i) => { o[f] = dim[f][r[i]]; });
    rawFields.forEach((f, j) => { o[f] = r[base + j]; });
    o.vinculo = SITUACOES_DESLIGADO.has(norm(o.situacao)) ? "Desligado" : "Ativo";
    return o;
  });
  return { rows, atualizadoEm: payload.atualizadoEm };
}
function mostrarEstado(msg, erro) {
  const el = $("mdEstado"), body = $("mdBody");
  if (el) { el.hidden = false; el.classList.toggle("is-erro", !!erro); el.innerHTML = erro ? `<i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(msg)}` : `<span class="siSpinner"></span> ${escapeHtml(msg)}`; }
  if (body) body.style.display = "none";
}
function esconderEstado() { const el = $("mdEstado"); if (el) el.hidden = true; const body = $("mdBody"); if (body) body.style.display = ""; }

// ---------- Filtros ----------
const ordenar = arr => [...arr].sort((a, b) => String(a).localeCompare(String(b), "pt-BR"));
function contagem(chave) {
  const m = new Map();
  dados.rows.forEach(r => { const k = r[chave]; m.set(k, (m.get(k) || 0) + 1); });
  return m;
}
function comTotal(valores, mapa) {
  return ordenar(valores).map(v => ({ value: v, label: `${v} (${formatNumber(mapa.get(v) || 0)})` }));
}
function preencherFiltros() {
  const distintos = ch => [...new Set(dados.rows.map(r => r[ch]).filter(Boolean))];
  combos.mdFiltroDsei?.setOptions(comTotal(distintos("dsei"), contagem("dsei")));
  combos.mdFiltroLotacao?.setOptions(comTotal(distintos("lotacao"), contagem("lotacao")));
  combos.mdFiltroNome?.setOptions(ordenar(distintos("nome")));
  combos.mdFiltroCargo?.setOptions(comTotal(distintos("cargo"), contagem("cargo")));
  combos.mdFiltroSituacao?.setOptions(comTotal(distintos("situacao"), contagem("situacao")));
  combos.mdFiltroVinculo?.setOptions(comTotal(["Ativo", "Desligado"], contagem("vinculo")));
  combos.mdFiltroTipoAdmissao?.setOptions(comTotal(distintos("tipoAdmissao"), contagem("tipoAdmissao")));
  combos.mdFiltroGrau?.setOptions(comTotal(distintos("grauInstrucao"), contagem("grauInstrucao")));
}
function lerFiltros() {
  const cv = id => combos[id] ? combos[id].getValues() : [];
  filtros = {
    dsei: cv("mdFiltroDsei"), lotacao: cv("mdFiltroLotacao"), nome: cv("mdFiltroNome"),
    cargo: cv("mdFiltroCargo"), situacao: cv("mdFiltroSituacao"), vinculo: cv("mdFiltroVinculo"),
    tipoAdmissao: cv("mdFiltroTipoAdmissao"), grau: cv("mdFiltroGrau")
  };
}
// Aplica todos os filtros EXCETO o de DSEI (o DSEI é a "dimensão" do mapa/lista).
function aplicarFiltrosBase() {
  const f = filtros;
  return dados.rows.filter(r => {
    if (f.lotacao.length && !f.lotacao.includes(r.lotacao)) return false;
    if (f.nome.length && !f.nome.includes(r.nome)) return false;
    if (f.cargo.length && !f.cargo.includes(r.cargo)) return false;
    if (f.situacao.length && !f.situacao.includes(r.situacao)) return false;
    if (f.vinculo.length && !f.vinculo.includes(r.vinculo)) return false;
    if (f.tipoAdmissao.length && !f.tipoAdmissao.includes(r.tipoAdmissao)) return false;
    if (f.grau.length && !f.grau.includes(r.grauInstrucao)) return false;
    if (f.dsei.length && !f.dsei.includes(r.dsei)) return false;
    return true;
  });
}
function limparFiltros() {
  Object.values(combos).forEach(c => c.clear());
  filtros = vazio();
  render();
}

// ---------- Render ----------
function render() {
  if (!carregado || !dados) return;
  const rows = aplicarFiltrosBase();

  // Agrega por DSEI/CASAI.
  const porDsei = new Map();
  rows.forEach(r => {
    const k = r.dsei || "Não informado";
    if (!porDsei.has(k)) porDsei.set(k, { nome: k, total: 0, uf: r.uf });
    porDsei.get(k).total++;
  });
  const listaDseis = [...porDsei.values()].sort((a, b) => b.total - a.total);

  // A seleção do detalhe é derivada 100% do filtro de DSEI: exatamente 1 DSEI
  // filtrado => detalhe daquele DSEI; 0 (ou vários) => considera TODOS. Clicar
  // num DSEI (mapa/lista) apenas marca esse DSEI no filtro (ver selecionarDsei).
  dseiSelecionado = filtros.dsei.length === 1 ? filtros.dsei[0] : "";

  renderResumoFiltro(rows.length, listaDseis.length);
  renderLista(listaDseis);
  renderMapaBrasil(listaDseis);
  renderDetalhe(rows);
}

// Clicar num DSEI (mapa/lista) marca esse DSEI no filtro e re-renderiza. Assim a
// seleção fica coerente com o filtro (desmarcar o filtro volta a considerar todos).
function selecionarDseiPorClique(nome) {
  const c = combos.mdFiltroDsei;
  if (c) c.definir([nome]);
  lerFiltros();
  render();
}

function renderResumoFiltro(totalPessoas, totalDseis) {
  const p = [];
  const arr = (nome, lista) => { if (lista.length) p.push(lista.length <= 2 ? lista.join(", ") : `${lista.length} ${nome}`); };
  arr("DSEIs", filtros.dsei); arr("unidades", filtros.lotacao); arr("nomes", filtros.nome);
  arr("cargos", filtros.cargo); arr("situações", filtros.situacao); arr("vínculos", filtros.vinculo);
  arr("tipos de admissão", filtros.tipoAdmissao); arr("graus", filtros.grau);
  const resumo = p.length ? p.join(" · ") : "Todos os trabalhadores";
  const el = $("mdResumoFiltro");
  if (el) el.textContent = `${formatNumber(totalPessoas)} trabalhadores · ${formatNumber(totalDseis)} DSEIs/CASAIs · ${resumo}`;
}

function renderLista(listaDseis) {
  const html = listaDseis.map((d, i) => `
    <li class="mdListaItem${d.nome === dseiSelecionado ? " is-ativo" : ""}" data-md-dsei="${escapeAttr(d.nome)}">
      <span class="mdListaDot" style="background:${CORES_LISTA[i % CORES_LISTA.length]}"></span>
      <span class="mdListaNome">${escapeHtml(d.nome)}</span>
      <span class="mdListaValor">${formatNumber(d.total)}</span>
    </li>`).join("");
  const el = $("mdListaDseis");
  if (el) el.innerHTML = html || `<li class="mdVazio">Nenhum DSEI para os filtros.</li>`;
}

// ---------- KPI / resumo helpers ----------
function kpiCard(icone, rotulo, valor, hint) {
  return `
    <div class="mdKpi">
      <div class="mdKpiIcon"><i class="fa-solid ${icone}"></i></div>
      <div class="mdKpiText">
        <span class="mdKpiLabel">${escapeHtml(rotulo)}</span>
        <span class="mdKpiValue">${valor}</span>
        ${hint ? `<span class="mdKpiHint">${escapeHtml(hint)}</span>` : ""}
      </div>
    </div>`;
}
function topN(rows, chave, n) {
  const m = new Map();
  rows.forEach(r => { const k = r[chave] || "Não informado"; m.set(k, (m.get(k) || 0) + 1); });
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}
function blocoResumo(titulo, icone, pares) {
  const linhas = pares.length
    ? pares.map(([l, v]) => `<li><span>${escapeHtml(l)}</span><strong>${formatNumber(v)}</strong></li>`).join("")
    : `<li class="mdVazio">Sem dados</li>`;
  return `<div class="mdInfoBloco"><h4 class="mdInfoTitulo"><i class="fa-solid ${icone}"></i> ${escapeHtml(titulo)}</h4><ul class="mdInfoLista">${linhas}</ul></div>`;
}

function renderDetalhe(rowsBase) {
  // Sem DSEI selecionado: mostra o agregado de TODOS os dados (filtrados).
  const rows = dseiSelecionado ? rowsBase.filter(r => r.dsei === dseiSelecionado) : rowsBase;
  $("mdDseiNome").textContent = dseiSelecionado || "Todos os DSEIs / CASAIs";
  $("mdMapaDseiNome").textContent = dseiSelecionado || "Brasil";
  $("mdInfoDseiNome").textContent = dseiSelecionado || "Brasil";

  const total = rows.length;
  const ativos = rows.filter(r => r.vinculo === "Ativo").length;
  const desligados = total - ativos;
  const lotacoes = new Set(rows.map(r => r.lotacao)).size;

  // Métricas geográficas (rede_cnes): municípios e estabelecimentos do DSEI
  // selecionado — ou o total de todos, quando nada está selecionado.
  let municipios = 0, estabs = 0;
  if (dseiSelecionado) {
    const g = geoDoDsei(dseiSelecionado);
    municipios = g ? g.municipios.size : 0;
    estabs = g ? g.estabs.length : 0;
  } else {
    const munSet = new Set();
    Object.values(dseiGeo).forEach(g => { g.municipios.forEach(m => munSet.add(m)); estabs += g.estabs.length; });
    municipios = munSet.size;
  }

  $("mdKpiRow").innerHTML =
    kpiCard("fa-users", "Total de trabalhadores", formatNumber(total)) +
    kpiCard("fa-user-check", "Ativos", formatNumber(ativos), total ? `${formatPercent(ativos / total * 100)} do total` : "") +
    kpiCard("fa-user-xmark", "Desligados", formatNumber(desligados)) +
    kpiCard("fa-sitemap", "Lotações", formatNumber(lotacoes)) +
    kpiCard("fa-city", "Municípios", formatNumber(municipios)) +
    kpiCard("fa-hospital", "Estabelecimentos", formatNumber(estabs));

  renderMapaUnidades(rows);

  $("mdInfoGrid").innerHTML =
    blocoResumo("Top cargos", "fa-id-badge", topN(rows, "cargo", 6)) +
    blocoResumo("Situação", "fa-notes-medical", topN(rows, "situacao", 6)) +
    blocoResumo("Grau de instrução", "fa-graduation-cap", topN(rows, "grauInstrucao", 6)) +
    blocoResumo("Tipo de admissão", "fa-file-signature", topN(rows, "tipoAdmissao", 6));

  renderTabela(rows);
  renderMapaDsei(rows);
}

// Painel lateral do mapa do DSEI: lotações (unidade/polo) com contagem.
function renderMapaUnidades(rows) {
  const m = new Map();
  rows.forEach(r => { const k = r.lotacao || "SEM LOTAÇÃO"; m.set(k, (m.get(k) || 0) + 1); });
  const lista = [...m.entries()].sort((a, b) => b[1] - a[1]);
  const el = $("mdMapaUnidades");
  if (!el) return;
  el.innerHTML = `<div class="mdUniTitulo"><i class="fa-solid fa-list-ul"></i> Unidades / Polos <span>${formatNumber(lista.length)}</span></div>` +
    (lista.length
      ? lista.map(([nome, val]) => `
        <div class="mdUniRow">
          <span class="mdUniIcon"><i class="fa-solid fa-location-dot"></i></span>
          <span class="mdUniLabel" title="${escapeAttr(nome)}">${escapeHtml(nome)}</span>
          <span class="mdUniValor">${formatNumber(val)}</span>
        </div>`).join("")
      : `<div class="mdVazio">Sem lotações para os filtros.</div>`);
}

// ---------- Tabela ----------
const cel = v => v ? escapeHtml(v) : "—";
const TABELA_MAX = 300;
function renderTabela(rows) {
  const body = $("mdTabelaBody");
  if (!body) return;
  $("mdTabelaCount").textContent = `${formatNumber(rows.length)} trabalhadores`;
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="11" class="mdVazio">Nenhum trabalhador para os filtros selecionados.</td></tr>`;
    $("mdTabelaRegistros").textContent = "Nenhum registro";
    return;
  }
  const vis = rows.slice(0, TABELA_MAX);
  body.innerHTML = vis.map(r => `
    <tr>
      <td>${cel(r.registro)}</td>
      <td class="mdTdNome">${cel(r.nome)}</td>
      <td>${cel(r.cargo)}</td>
      <td>${cel(r.situacao)}</td>
      <td><span class="mdBadge ${r.vinculo === "Ativo" ? "is-ativo" : "is-deslig"}">${cel(r.vinculo)}</span></td>
      <td>${cel(r.lotacao)}</td>
      <td>${cel(r.dsei)}</td>
      <td>${cel(r.uf)}</td>
      <td>${cel(r.sexo)}</td>
      <td>${cel(r.grauInstrucao)}</td>
      <td>${cel(r.tipoAdmissao)}</td>
    </tr>`).join("");
  $("mdTabelaRegistros").textContent = rows.length > TABELA_MAX
    ? `Mostrando ${formatNumber(TABELA_MAX)} de ${formatNumber(rows.length)} trabalhadores`
    : `${formatNumber(rows.length)} trabalhadores`;
}

// ---------- Mapas (Leaflet) ----------
function tileLayer() {
  return L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap" });
}
function pinEstab() {
  return L.divIcon({ className: "", html: `<span class="mdEstabPin"><i class="fa-solid fa-location-dot"></i></span>`, iconSize: [22, 28], iconAnchor: [11, 26], popupAnchor: [0, -24] });
}

// Desenha a máscara "mundo com buraco no Brasil" (cobre os países vizinhos) +
// o contorno do país, num mapa qualquer.
let brasilGeo = null;
function mascararMapa(map) {
  if (!map || !brasilGeo) return;
  const g = brasilGeo.geometry;
  const polys = g.type === "MultiPolygon" ? g.coordinates : [g.coordinates];
  const buracos = polys.map(p => p[0].map(c => [c[1], c[0]])); // [lng,lat] -> [lat,lng]
  const mundo = [[20, -95], [20, -25], [-45, -25], [-45, -95]];
  L.polygon([mundo, ...buracos], { stroke: false, fillColor: "#eef4fb", fillOpacity: 1, interactive: false }).addTo(map);
  L.geoJSON(brasilGeo, { style: { color: "#2563eb", weight: 1.1, fill: false, interactive: false } }).addTo(map);
}
// Busca o contorno do Brasil (jsdelivr, liberado na CSP) e aplica a máscara nos
// DOIS mapas. Se a busca falhar (offline), mantém os limites retangulares.
function aplicarMascaraBrasil() {
  if (mascaraCarregada) return;
  mascaraCarregada = true;
  fetch("https://cdn.jsdelivr.net/gh/johan/world.geo.json@master/countries/BRA.geo.json")
    .then(r => r.json())
    .then(geo => {
      brasilGeo = geo.features ? geo.features[0] : geo;
      const bounds = L.geoJSON(brasilGeo).getBounds();
      if (mapaBrasil) { mascararMapa(mapaBrasil); mapaBrasil.setMaxBounds(bounds.pad(0.06)); mapaBrasil.fitBounds(bounds); }
      if (mapaDsei) { mascararMapa(mapaDsei); if (!dseiSelecionado) mapaDsei.fitBounds(bounds); }
    })
    .catch(() => { /* offline: segue com os bounds retangulares do Brasil */ });
}
function garantirMapas() {
  if (mapasIniciados || typeof L === "undefined") return;
  if (!$("mdMapaBrasil") || !$("mdMapaDsei")) return;
  mapasIniciados = true;
  // Limita à área do Brasil: não dá para arrastar/zoom para fora.
  const brasilBounds = L.latLngBounds([[5.8, -74.5], [-34.0, -33.5]]);
  mapaBrasil = L.map("mdMapaBrasil", { scrollWheelZoom: false, maxBounds: brasilBounds, maxBoundsViscosity: 1.0, minZoom: 4 });
  tileLayer().addTo(mapaBrasil);
  mapaBrasil.fitBounds(brasilBounds);
  camadaBrasil = L.layerGroup().addTo(mapaBrasil);

  // Mapa do DSEI: mesma máscara (só Brasil); sem maxBounds rígido para o zoom
  // no DSEI selecionado funcionar livremente (vizinhos ficam mascarados mesmo assim).
  mapaDsei = L.map("mdMapaDsei", { scrollWheelZoom: false, minZoom: 4 });
  tileLayer().addTo(mapaDsei);
  mapaDsei.fitBounds(brasilBounds);
  camadaDsei = L.layerGroup().addTo(mapaDsei);

  aplicarMascaraBrasil();

  if (carregado) render();
  setTimeout(() => { mapaBrasil && mapaBrasil.invalidateSize(); mapaDsei && mapaDsei.invalidateSize(); }, 120);
}
function marcadorContagem(total, ativo) {
  return L.divIcon({
    className: "",
    html: `<span class="mdMapDot${ativo ? " is-ativo" : ""}">${escapeHtml(formatNumber(total))}</span>`,
    iconSize: [30, 30], iconAnchor: [15, 15]
  });
}
function renderMapaBrasil(listaDseis) {
  if (!mapaBrasil || !camadaBrasil) return;
  camadaBrasil.clearLayers();
  listaDseis.forEach(d => {
    const [lat, lng] = coordDsei(d.nome, d.uf);
    L.marker([lat, lng], { icon: marcadorContagem(d.total, d.nome === dseiSelecionado) })
      .addTo(camadaBrasil)
      .bindTooltip(`<strong>${escapeHtml(d.nome)}</strong><br>${formatNumber(d.total)} trabalhadores`)
      .on("click", () => selecionarDseiPorClique(d.nome));
  });
}
function renderMapaDsei(rows) {
  if (!mapaDsei || !camadaDsei) return;
  camadaDsei.clearLayers();
  // Sem DSEI selecionado: enquadra o Brasil (máscara cobre o entorno).
  if (!dseiSelecionado) { mapaDsei.fitBounds(L.latLngBounds([[5.8, -74.5], [-34.0, -33.5]])); return; }

  const g = geoDoDsei(dseiSelecionado);
  if (g && g.estabs.length) {
    // Plota os estabelecimentos (CNES) do DSEI com coordenadas reais.
    const pts = [];
    g.estabs.forEach(e => {
      L.marker([e.lat, e.lng], { icon: pinEstab() }).addTo(camadaDsei)
        .bindTooltip(`<strong>${escapeHtml(e.nome)}</strong>${e.municipio ? `<br>${escapeHtml(e.municipio)}` : ""}`);
      pts.push([e.lat, e.lng]);
    });
    if (pts.length > 1) mapaDsei.fitBounds(L.latLngBounds(pts).pad(0.3));
    else mapaDsei.setView(pts[0], 8);
    setTimeout(() => mapaDsei.invalidateSize(), 60);
    return;
  }

  // Sem estabelecimentos no rede_cnes: cai no marcador central (contagem).
  const [lat, lng] = coordDsei(dseiSelecionado, rows[0] ? rows[0].uf : "");
  L.marker([lat, lng], { icon: marcadorContagem(rows.length, true) }).addTo(camadaDsei)
    .bindTooltip(`<strong>${escapeHtml(dseiSelecionado)}</strong><br>${formatNumber(rows.length)} trabalhadores`);
  mapaDsei.setView([lat, lng], 6);
  setTimeout(() => mapaDsei.invalidateSize(), 60);
}

// ---------- Inicialização ----------
function debounce(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }

export function configurarMapaDseis() {
  if (configurado) return;
  const raiz = $("view-mapaDseis");
  if (!raiz) return;
  configurado = true;

  const onFiltro = debounce(() => { lerFiltros(); render(); }, 140);
  criarCombo("mdFiltroDsei", "Todos os DSEIs/CASAIs", onFiltro, { searchPlaceholder: "Buscar DSEI/CASAI…" });
  criarCombo("mdFiltroLotacao", "Todas as unidades/polos", onFiltro, { searchPlaceholder: "Buscar lotação…" });
  criarCombo("mdFiltroNome", "Todos os trabalhadores", onFiltro, { searchPlaceholder: "Digite o nome…", maxRender: 80 });
  criarCombo("mdFiltroCargo", "Todos os cargos", onFiltro);
  criarCombo("mdFiltroSituacao", "Todas as situações", onFiltro);
  criarCombo("mdFiltroVinculo", "Todos os vínculos", onFiltro);
  criarCombo("mdFiltroTipoAdmissao", "Todos os tipos de admissão", onFiltro);
  criarCombo("mdFiltroGrau", "Todos os graus", onFiltro);

  document.addEventListener("click", () => fecharTodosCombos(null));
  $("mdBtnLimpar")?.addEventListener("click", limparFiltros);

  // Clique na lista de DSEIs seleciona o detalhe.
  $("mdListaDseis")?.addEventListener("click", e => {
    const li = e.target.closest("[data-md-dsei]");
    if (li) selecionarDseiPorClique(li.dataset.mdDsei);
  });

  if (state.activeView === "mapaDseis") { carregar(); }

  window.addEventListener("resize", () => { mapaBrasil && mapaBrasil.invalidateSize(); mapaDsei && mapaDsei.invalidateSize(); });
}

// Chamado por filtros.js quando a aba é aberta: carrega sob demanda (base grande),
// garante os mapas (Leaflet precisa do container visível) e recalcula o tamanho.
export function renderMapaDseisAoMostrar() {
  if (!carregado && !carregando) carregar();
  else garantirMapas();
  setTimeout(() => { mapaBrasil && mapaBrasil.invalidateSize(); mapaDsei && mapaDsei.invalidateSize(); }, 120);
}
