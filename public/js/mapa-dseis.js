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
import { formatNumber, escapeHtml, escapeAttr } from "./utils.js";
import { criarTabelaArrastavel } from "./tabela-arrastavel.js";

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

// ---- Base territorial indígena (mock/dados_indigenas.json, via API) ----
// Índice por chave normalizada do DSEI (mesma chaveGeo dos mapas): permite
// cruzar UNIDADE_ORCAMENTARIA_DESC ("DSEI CEARA") com o campo DSEI do arquivo
// ("CEARA"). Regra 5/6 do pedido: vínculo por DSEI, com nomes normalizados.
let territorioIndex = {};
function construirTerritorio(lista) {
  territorioIndex = {};
  (lista || []).forEach(t => {
    const k = chaveGeo(t.dsei);
    if (k) territorioIndex[k] = t;
  });
}
// Território de um UNIDADE_ORCAMENTARIA_DESC, com inclusão parcial (CASAI cai no
// DSEI de mesmo nome). Retorna o registro territorial ou null.
function territorioDoDsei(desc) {
  const k = chaveGeo(desc);
  if (!k) return null;
  if (territorioIndex[k]) return territorioIndex[k];
  let best = null;
  for (const key of Object.keys(territorioIndex)) {
    if ((k.includes(key) || key.includes(k)) && (!best || key.length > best.length)) best = key;
  }
  return best ? territorioIndex[best] : null;
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
let poloSelecionado = "";  // lotação (unidade/polo) em detalhe, via clique
let polosVerTodas = false;  // "Ver todas" na lista de polos
let ultimasRows = [];      // últimas linhas renderizadas (p/ os toggles)

const combos = {};
let filtros = vazio();
function vazio() {
  return { dsei: [], lotacao: [] };
}

// Regra 1/2 do pedido: em TODA a aba (mapas, cards, listas, contadores) só
// entram trabalhadores ativos. Aplicado na base, antes de qualquer cálculo.
const ehAtivo = r => r.vinculo === "Ativo";

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
    const [payload, rede, territorio] = await Promise.all([
      apiGet("/api/mapa-dseis"),
      apiGet("/api/mapa-dseis/rede").catch(() => []),
      apiGet("/api/mapa-dseis/territorio").catch(() => [])
    ]);
    dados = decodificar(payload);
    construirGeo(rede);
    construirTerritorio(territorio);
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
// Só linhas ativas alimentam filtros/contagens (a aba é 100% "ativos").
const linhasAtivas = () => dados.rows.filter(ehAtivo);
function contagem(chave) {
  const m = new Map();
  linhasAtivas().forEach(r => { const k = r[chave]; m.set(k, (m.get(k) || 0) + 1); });
  return m;
}
function comTotal(valores, mapa) {
  return ordenar(valores).map(v => ({ value: v, label: `${v} (${formatNumber(mapa.get(v) || 0)})` }));
}
function preencherFiltros() {
  const distintos = ch => [...new Set(linhasAtivas().map(r => r[ch]).filter(Boolean))];
  combos.mdFiltroDsei?.setOptions(comTotal(distintos("dsei"), contagem("dsei")));
  combos.mdFiltroLotacao?.setOptions(comTotal(distintos("lotacao"), contagem("lotacao")));
}
function lerFiltros() {
  const cv = id => combos[id] ? combos[id].getValues() : [];
  filtros = {
    dsei: cv("mdFiltroDsei"), lotacao: cv("mdFiltroLotacao")
  };
}
// Base de render: SEMPRE só ativos (regra 1/2), depois os filtros do usuário.
function aplicarFiltrosBase() {
  const f = filtros;
  return dados.rows.filter(r => {
    if (!ehAtivo(r)) return false;
    if (f.lotacao.length && !f.lotacao.includes(r.lotacao)) return false;
    if (f.dsei.length && !f.dsei.includes(r.dsei)) return false;
    return true;
  });
}
function limparFiltros() {
  Object.values(combos).forEach(c => c.clear());
  filtros = vazio();
  poloSelecionado = "";
  render();
}

// ---------- Render ----------
function render() {
  if (!carregado || !dados) return;
  // Um novo render (mudança de filtro/seleção) recolhe as listas "Ver todas".
  polosVerTodas = false;
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
  // 1 DSEI no filtro => detalhe dele; senão, se os filtros resolverem para um
  // único DSEI, foca nele também; caso contrário, "Brasil".
  dseiSelecionado = filtros.dsei.length === 1 ? filtros.dsei[0]
    : (listaDseis.length === 1 ? listaDseis[0].nome : "");
  // Polo em detalhe só faz sentido se ainda estiver entre as lotações filtradas.
  if (poloSelecionado && filtros.lotacao.length && !filtros.lotacao.includes(poloSelecionado)) {
    poloSelecionado = "";
  }

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
  // Trocar de DSEI zera o polo em detalhe e seu filtro de lotação (evita
  // interseção vazia entre um polo antigo e o novo DSEI).
  poloSelecionado = "";
  combos.mdFiltroLotacao?.definir([]);
  lerFiltros();
  render();
}

function renderResumoFiltro(totalPessoas, totalDseis) {
  const p = [];
  const arr = (nome, lista) => { if (lista.length) p.push(lista.length <= 2 ? lista.join(", ") : `${lista.length} ${nome}`); };
  arr("DSEIs", filtros.dsei); arr("unidades", filtros.lotacao);
  const resumo = p.length ? p.join(" · ") : "Todos os ativos";
  const el = $("mdResumoFiltro");
  if (el) el.textContent = `${formatNumber(totalPessoas)} trabalhadores ativos · ${formatNumber(totalDseis)} DSEIs/CASAIs · ${resumo}`;
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
// ---------- Rede de saúde indígena (rede_cnes) ----------
// Categoriza cada estabelecimento pelo nome (o campo `grupo` só separa CASAI de
// "u"). Cada categoria tem cor/ícone da identidade SI, usados nos contadores,
// na lista e nos pinos do mapa do DSEI.
const CAT_ESTAB = [
  { chave: "casai", rotulo: "CASAI", cor: "#C8472B", icone: "fa-house-medical", re: /casai|casa de saude|casa de apoio/ },
  { chave: "polo", rotulo: "Polo Base", cor: "#E2872E", icone: "fa-house-chimney", re: /polo base/ },
  { chave: "ubsi", rotulo: "UBSI", cor: "#2E8B57", icone: "fa-hospital", re: /unidade basica|ubsi/ },
  { chave: "usi", rotulo: "Unidade de Saúde", cor: "#1F7A8C", icone: "fa-briefcase-medical", re: /unidade de saude|unidade indigena|usfi|posto de saude|saude indigena|saude do indio/ },
  { chave: "outro", rotulo: "Outros", cor: "#64748b", icone: "fa-location-dot", re: /.*/ }
];
function catEstab(nome) {
  const s = (nome || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return CAT_ESTAB.find(c => c.re.test(s)) || CAT_ESTAB[CAT_ESTAB.length - 1];
}

// Estabelecimentos do DSEI selecionado, ou de todos (Brasil).
function estabsDoContexto() {
  if (dseiSelecionado) {
    const g = geoDoDsei(dseiSelecionado);
    return g ? g.estabs : [];
  }
  const todos = [];
  Object.values(dseiGeo).forEach(g => todos.push(...g.estabs));
  return todos;
}

function renderDetalhe(rowsBase) {
  // Sem DSEI selecionado: mostra o agregado de TODOS os dados (filtrados).
  // `rowsBase` já é só ativos (aplicarFiltrosBase), então total == ativos.
  const rows = dseiSelecionado ? rowsBase.filter(r => r.dsei === dseiSelecionado) : rowsBase;
  ultimasRows = rows;
  $("mdDseiNome").textContent = dseiSelecionado || "Todos os DSEIs / CASAIs";
  $("mdMapaDseiNome").textContent = dseiSelecionado || "Brasil";

  const total = rows.length;
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
    kpiCard("fa-user-check", "Trabalhadores ativos", formatNumber(total)) +
    kpiCard("fa-sitemap", "Unidades / Polos", formatNumber(lotacoes)) +
    kpiCard("fa-city", "Municípios", formatNumber(municipios)) +
    kpiCard("fa-hospital", "Estabelecimentos", formatNumber(estabs));

  renderResumoTerritorial();
  renderMapaUnidades(rows);
  renderPoloDetalhe(rowsBase);
  renderRede();
  renderMapaDsei(rows);
}

// ---------- Resumo territorial (base indígena por DSEI) ----------
// Regra 5/6: cruza por DSEI normalizado. Só os campos existentes na base atual
// (população indígena, terras indígenas, aldeias). Os demais campos pedidos
// (etnias, extensão, modais, população atendida) não constam na fonte.
function renderResumoTerritorial() {
  const grid = $("mdTerritorioGrid");
  if (!grid) return;
  const nomeEl = $("mdTerritorioNome");
  if (nomeEl) nomeEl.textContent = dseiSelecionado || "Brasil";
  let popInd = 0, terras = 0, aldeias = 0;
  let semDado = false;
  if (dseiSelecionado) {
    const t = territorioDoDsei(dseiSelecionado);
    if (t) { popInd = t.populacaoIndigena; terras = t.qtdTerrasIndigenas; aldeias = t.qtdAldeias; }
    else semDado = true;
  } else {
    Object.values(territorioIndex).forEach(t => {
      popInd += t.populacaoIndigena || 0; terras += t.qtdTerrasIndigenas || 0; aldeias += t.qtdAldeias || 0;
    });
  }
  grid.innerHTML =
    kpiCard("fa-people-group", "População indígena", formatNumber(popInd)) +
    kpiCard("fa-mountain-sun", "Terras indígenas", formatNumber(terras)) +
    kpiCard("fa-house-chimney", "Aldeias", formatNumber(aldeias));
  const nota = $("mdTerritorioNota");
  if (nota) {
    nota.textContent = semDado
      ? `Sem dados territoriais para ${dseiSelecionado}.`
      : "Etnias, extensão territorial, modais de transporte e população atendida não constam na base territorial atual.";
  }
}

// ---------- Rede de saúde indígena (contadores por categoria + tabela) ----------
// Traz TODOS os campos do rede_cnes que os mapas não usavam: categoria (do
// grupo/nome), município/UF e CNES. Contadores sempre; a tabela (Tabulator)
// lista os estabelecimentos do DSEI selecionado — ou de todos (Brasil).

// Colunas da grade de Unidades (padrão Tabulator do painel: cabeçalho azul,
// ordenável, colunas arrastáveis).
const uniCel = v => (v || v === 0) ? escapeHtml(String(v)) : "—";
const UNI_COLS = [
  { title: "Tipo", field: "tipo", minWidth: 150, formatter: c => {
      const d = c.getRow().getData();
      return `<span class="mdUniTipo"><span class="mdCatDot" style="background:${d.cor}"></span><span class="mdCatNome" style="color:${d.cor}">${uniCel(d.tipo)}</span></span>`;
    } },
  { title: "Unidade", field: "unidade", minWidth: 240, formatter: c => uniCel(c.getValue()) },
  { title: "Localização", field: "localizacao", minWidth: 160, formatter: c => uniCel(c.getValue()) },
  { title: "CNES", field: "cnes", minWidth: 110, formatter: c => uniCel(c.getValue()) },
];
let gradeUnidades = null;

function renderRede() {
  const cont = $("mdRedeContadores");
  if (!cont) return;
  const nomeEl = $("mdRedeNome");
  if (nomeEl) nomeEl.textContent = dseiSelecionado || "Brasil";

  const estabs = estabsDoContexto();
  const porCat = new Map(CAT_ESTAB.map(c => [c.chave, 0]));
  estabs.forEach(e => { const c = catEstab(e.nome); porCat.set(c.chave, (porCat.get(c.chave) || 0) + 1); });

  cont.innerHTML = CAT_ESTAB
    .filter(c => (porCat.get(c.chave) || 0) > 0)
    .map(c => `
      <div class="mdContador" style="--md-c:${c.cor}">
        <div class="mdContadorIcon"><i class="fa-solid ${c.icone}"></i></div>
        <span class="mdContadorValor">${formatNumber(porCat.get(c.chave))}</span>
        <span class="mdContadorRotulo">${escapeHtml(c.rotulo)}</span>
      </div>`).join("") +
    `<div class="mdContador mdContadorTotal" style="--md-c:var(--si-azul, #007de0)">
        <div class="mdContadorIcon"><i class="fa-solid fa-hospital"></i></div>
        <span class="mdContadorValor">${formatNumber(estabs.length)}</span>
        <span class="mdContadorRotulo">Total</span>
      </div>`;

  const countEl = $("mdUnidadesCount");
  if (countEl) countEl.textContent = `${formatNumber(estabs.length)} unidades`;

  // Dados da grade (ordenados por categoria e nome).
  const dados = [...estabs].sort((a, b) => {
    const ia = CAT_ESTAB.findIndex(c => c.chave === catEstab(a.nome).chave);
    const ib = CAT_ESTAB.findIndex(c => c.chave === catEstab(b.nome).chave);
    return ia !== ib ? ia - ib : String(a.nome).localeCompare(String(b.nome), "pt-BR");
  }).map((e, i) => {
    const c = catEstab(e.nome);
    return {
      id: `${e.cnes || e.nome}#${i}`,
      tipo: c.rotulo, cor: c.cor,
      unidade: e.nome,
      localizacao: e.municipio ? `${e.municipio}${e.uf ? ` – ${e.uf}` : ""}` : "",
      cnes: e.cnes || ""
    };
  });

  if (!$("mdRedeLista")) return;
  if (!gradeUnidades) {
    gradeUnidades = criarTabelaArrastavel({
      elemento: "mdRedeLista",
      colunas: UNI_COLS,
      persistID: "mdUnidadesRede",
      indexField: "id",
      movableRows: false,   // tabela de consulta (ordena por cabeçalho)
      headerSort: true,
      alturaFixa: true,
      altura: "460px",
      vazio: "Nenhuma unidade da rede para os filtros selecionados."
    });
  }
  gradeUnidades?.render(dados);
}

// Categoria inferida do nome da lotação (a base não tem coluna de categoria).
function categoriaPolo(nome) {
  const s = norm(nome);
  if (/casai/.test(s)) return "CASAI";
  if (/ubsi|unidade b[aá]sica/.test(s)) return "UBSI";
  if (/polo/.test(s)) return "Polo Base";
  if (/sede|escrit[oó]rio/.test(s)) return "Sede / Escritório";
  if (/dsei|distrito/.test(s)) return "DSEI";
  if (/sem lota/.test(s)) return "Sem lotação";
  return "Unidade";
}

// Detalhe do Polo Base selecionado (clique na lista de unidades). Regra 5.
function renderPoloDetalhe(rowsBase) {
  const el = $("mdPoloDetalhe");
  if (!el) return;
  if (!poloSelecionado) { el.hidden = true; el.innerHTML = ""; return; }
  const doPolo = rowsBase.filter(r => r.lotacao === poloSelecionado);
  const ativos = doPolo.length; // rowsBase já é só ativos
  const dseis = [...new Set(doPolo.map(r => r.dsei).filter(Boolean))];
  const dseiRel = dseis.length === 1 ? dseis[0]
    : (dseiSelecionado || (dseis.length ? `${dseis.length} DSEIs` : "—"));
  el.hidden = false;
  el.innerHTML = `
    <div class="mdPoloHead">
      <i class="fa-solid fa-location-dot"></i>
      <span class="mdPoloNome" title="${escapeAttr(poloSelecionado)}">${escapeHtml(poloSelecionado)}</span>
      <button type="button" class="mdPoloClose" id="mdPoloClose" title="Fechar detalhe" aria-label="Fechar">&times;</button>
    </div>
    <ul class="mdPoloLista">
      <li><span>Categoria</span><strong>${escapeHtml(categoriaPolo(poloSelecionado))}</strong></li>
      <li><span>DSEI relacionado</span><strong>${escapeHtml(dseiRel)}</strong></li>
      <li><span>Trabalhadores ativos vinculados</span><strong>${formatNumber(ativos)}</strong></li>
      <li><span>População atendida</span><strong class="mdNd">Não disponível na base</strong></li>
    </ul>`;
  $("mdPoloClose")?.addEventListener("click", () => selecionarPoloPorClique(poloSelecionado));
}

// Clique num Polo Base: filtra a aba por aquela lotação e abre o detalhe.
// Clicar de novo no mesmo polo desmarca (toggle).
function selecionarPoloPorClique(nome) {
  const desmarcar = poloSelecionado === nome;
  poloSelecionado = desmarcar ? "" : nome;
  const c = combos.mdFiltroLotacao;
  if (c) c.definir(desmarcar ? [] : [nome]);
  lerFiltros();
  render();
}

// Painel lateral do mapa do DSEI: lotações (unidade/polo) com contagem.
const POLOS_CAP = 16;  // quantos polos antes do "Ver todas"
function renderMapaUnidades(rows) {
  const m = new Map();
  rows.forEach(r => { const k = r.lotacao || "SEM LOTAÇÃO"; m.set(k, (m.get(k) || 0) + 1); });
  const lista = [...m.entries()].sort((a, b) => b[1] - a[1]);
  const el = $("mdMapaUnidades");
  if (!el) return;
  const titulo = `<div class="mdUniTitulo"><i class="fa-solid fa-people-roof"></i> Polos e unidades <span>${formatNumber(lista.length)}</span></div>`;
  if (!lista.length) { el.innerHTML = titulo + `<div class="mdVazio">Sem lotações para os filtros.</div>`; return; }
  const cap = polosVerTodas ? lista.length : POLOS_CAP;
  const itens = lista.slice(0, cap).map(([nome, val]) => `
    <div class="mdUniRow${nome === poloSelecionado ? " is-ativo" : ""}" data-md-lotacao="${escapeAttr(nome)}" role="button" tabindex="0" title="Ver detalhe de ${escapeAttr(nome)}">
      <span class="mdUniIcon"><i class="fa-solid fa-location-dot"></i></span>
      <span class="mdUniText">
        <span class="mdUniLabel">${escapeHtml(nome)}</span>
        <span class="mdUniCat">${escapeHtml(categoriaPolo(nome))}</span>
      </span>
      <span class="mdUniValor">${formatNumber(val)}<small>ativos</small></span>
    </div>`).join("");
  const mais = lista.length > cap
    ? `<button type="button" class="mdVerTodas mdVerTodasPolos" data-alvo="polos">Ver todas <i class="fa-solid fa-chevron-right"></i></button>`
    : "";
  el.innerHTML = titulo + itens + mais;
}

// ---------- Mapas (Leaflet) ----------
function tileLayer() {
  return L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap" });
}
// Pino de estabelecimento colorido pela categoria (CASAI/Polo/UBSI/…).
function pinEstabCat(cat) {
  return L.divIcon({
    className: "",
    html: `<span class="mdEstabPin" style="background:${cat.cor}"><i class="fa-solid ${cat.icone}"></i></span>`,
    iconSize: [22, 28], iconAnchor: [11, 26], popupAnchor: [0, -24]
  });
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
// Tooltip do pino de um DSEI: trabalhadores ativos + dados territoriais
// (população indígena, terras indígenas, aldeias), quando houver.
function tooltipDsei(nome, ativos) {
  const t = territorioDoDsei(nome);
  const linha = (lbl, val) => `<div class="mdTipRow"><span>${escapeHtml(lbl)}</span><b>${escapeHtml(formatNumber(val))}</b></div>`;
  let html = `<div class="mdTip"><div class="mdTipTitulo">${escapeHtml(nome)}</div>`;
  html += linha("Trabalhadores ativos", ativos);
  if (t) {
    html += `<div class="mdTipSep">Território</div>`;
    html += linha("População indígena", t.populacaoIndigena);
    html += linha("Terras indígenas", t.qtdTerrasIndigenas);
    html += linha("Aldeias", t.qtdAldeias);
  }
  return html + `</div>`;
}
function renderMapaBrasil(listaDseis) {
  if (!mapaBrasil || !camadaBrasil) return;
  camadaBrasil.clearLayers();
  listaDseis.forEach(d => {
    const [lat, lng] = coordDsei(d.nome, d.uf);
    // DSEIs ao norte (topo do mapa) abrem o balão para BAIXO, senão ele é cortado
    // pela borda superior do mapa; os demais abrem para cima (padrão).
    const paraBaixo = lat > -8;
    L.marker([lat, lng], { icon: marcadorContagem(d.total, d.nome === dseiSelecionado) })
      .addTo(camadaBrasil)
      .bindTooltip(tooltipDsei(d.nome, d.total), {
        className: "mdTipWrap",
        direction: paraBaixo ? "bottom" : "top",
        offset: paraBaixo ? [0, 12] : [0, -12]
      })
      .on("click", () => selecionarDseiPorClique(d.nome));
  });
  // Com um DSEI selecionado, delimita a área das unidades dele também no Brasil.
  if (dseiSelecionado) desenharAreaDsei(pontosEstabsDoDsei(dseiSelecionado), camadaBrasil);
  // Recalcula o tamanho e reenquadra no Brasil — sem isto, quando o container
  // muda de largura (layout em grade), o Leaflet mantém um zoom errado e o mapa
  // "abre" para o mundo inteiro.
  setTimeout(() => {
    if (!mapaBrasil) return;
    mapaBrasil.invalidateSize();
    const bounds = brasilGeo ? L.geoJSON(brasilGeo).getBounds() : L.latLngBounds([[5.8, -74.5], [-34.0, -33.5]]);
    mapaBrasil.fitBounds(bounds);
  }, 80);
}
// Envoltório convexo (monotone chain) de pontos [lat,lng] — usado para desenhar
// o contorno da área coberta pelas unidades do DSEI. Retorna os vértices na borda.
function envoltorioConvexo(pontos) {
  const p = pontos.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const baixo = [];
  for (const pt of p) {
    while (baixo.length >= 2 && cross(baixo[baixo.length - 2], baixo[baixo.length - 1], pt) <= 0) baixo.pop();
    baixo.push(pt);
  }
  const cima = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const pt = p[i];
    while (cima.length >= 2 && cross(cima[cima.length - 2], cima[cima.length - 1], pt) <= 0) cima.pop();
    cima.push(pt);
  }
  baixo.pop(); cima.pop();
  return baixo.concat(cima);
}

// Desenha o contorno (linha) da área coberta pelas unidades do DSEI selecionado,
// na camada informada (mapa do DSEI ou mapa do Brasil).
function desenharAreaDsei(pts, camada) {
  if (!pts.length || !camada) return;
  const estilo = { color: "#0a66b0", weight: 2, dashArray: "6 5", fillColor: "#007de0", fillOpacity: 0.07, interactive: false };
  if (pts.length >= 3) {
    const hull = envoltorioConvexo(pts);
    if (hull.length >= 3) L.polygon(hull, estilo).addTo(camada);
  } else if (pts.length === 2) {
    L.polyline(pts, { color: "#0a66b0", weight: 2, dashArray: "6 5", interactive: false }).addTo(camada);
  }
}
// Pontos [lat,lng] dos estabelecimentos de um DSEI (para o contorno).
function pontosEstabsDoDsei(nome) {
  const g = geoDoDsei(nome);
  return g && g.estabs ? g.estabs.map(e => [e.lat, e.lng]) : [];
}

function renderMapaDsei(rows) {
  if (!mapaDsei || !camadaDsei) return;
  camadaDsei.clearLayers();
  // Sem DSEI selecionado: enquadra o Brasil (máscara cobre o entorno).
  if (!dseiSelecionado) { mapaDsei.fitBounds(L.latLngBounds([[5.8, -74.5], [-34.0, -33.5]])); return; }

  const g = geoDoDsei(dseiSelecionado);
  if (g && g.estabs.length) {
    // Plota os estabelecimentos (CNES) do DSEI, com pino colorido por categoria.
    const pts = [];
    g.estabs.forEach(e => {
      const cat = catEstab(e.nome);
      L.marker([e.lat, e.lng], { icon: pinEstabCat(cat) }).addTo(camadaDsei)
        .bindTooltip(`<strong>${escapeHtml(e.nome)}</strong><br><span style="color:${cat.cor}">${escapeHtml(cat.rotulo)}</span>${e.municipio ? ` · ${escapeHtml(e.municipio)}` : ""}${e.cnes ? `<br>CNES ${escapeHtml(e.cnes)}` : ""}`);
      pts.push([e.lat, e.lng]);
    });
    // Contorno delimitando a área coberta pelas unidades (CASAI, Polo Base, UBSI…).
    desenharAreaDsei(pts, camadaDsei);
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

  document.addEventListener("click", () => fecharTodosCombos(null));
  $("mdBtnLimpar")?.addEventListener("click", limparFiltros);

  // Clique na lista de DSEIs seleciona o detalhe.
  $("mdListaDseis")?.addEventListener("click", e => {
    const li = e.target.closest("[data-md-dsei]");
    if (li) selecionarDseiPorClique(li.dataset.mdDsei);
  });

  // Clique (ou Enter/Espaço) num Polo Base abre o detalhe e filtra a aba.
  // "Ver todas" expande a lista de polos sem recarregar o resto.
  const uni = $("mdMapaUnidades");
  uni?.addEventListener("click", e => {
    if (e.target.closest(".mdVerTodas")) { polosVerTodas = true; renderMapaUnidades(ultimasRows); return; }
    const row = e.target.closest("[data-md-lotacao]");
    if (row) selecionarPoloPorClique(row.dataset.mdLotacao);
  });
  uni?.addEventListener("keydown", e => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const row = e.target.closest("[data-md-lotacao]");
    if (row) { e.preventDefault(); selecionarPoloPorClique(row.dataset.mdLotacao); }
  });

  if (state.activeView === "mapaDseis") { carregar(); }

  window.addEventListener("resize", () => { mapaBrasil && mapaBrasil.invalidateSize(); mapaDsei && mapaDsei.invalidateSize(); });
}

// Chamado por filtros.js quando a aba é aberta: carrega sob demanda (base grande),
// garante os mapas (Leaflet precisa do container visível) e recalcula o tamanho.
export function renderMapaDseisAoMostrar() {
  if (!carregado && !carregando) carregar();
  else garantirMapas();
  // Recalcula o tamanho dos mapas do Leaflet e redesenha a grade de unidades ao
  // reexibir a aba (montados ocultos medem 0 e ficam cinza/errados sem isto).
  setTimeout(() => { mapaBrasil && mapaBrasil.invalidateSize(); mapaDsei && mapaDsei.invalidateSize(); gradeUnidades?.redraw(); }, 120);
}
