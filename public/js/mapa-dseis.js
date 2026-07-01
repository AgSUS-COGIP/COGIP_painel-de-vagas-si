// =========================================================
// Mapa dos DSEIs (MVP)
// Aba autocontida que plota a rede de estabelecimentos (CNES) sobre o contorno
// dos estados do Brasil, usando latitude/longitude. Sem biblioteca de mapa e
// sem tiles externos: um SVG desenhado à mão a partir de um GeoJSON local
// (public/data/br-uf.geojson) e dos pontos de public/data/rede_cnes.json.
//
// Interação primária: clicar num ESTADO (UF) — o mapa dá ZOOM naquele estado e
// destaca os pontos dele (CASAI, UBSI/polos etc.); um painel lateral resume o
// estado (contagens, DSEIs presentes) e lista os estabelecimentos. Clicar num
// ponto seleciona o estado dele; clicar no fundo volta à visão nacional.
//
// Projeção: equiretangular (lon×cos(lat0), lat) calibrada pelo bounding box do
// GeoJSON — contorno e pontos usam a MESMA projeção, então ficam alinhados. O
// zoom é feito trocando o `viewBox` do SVG para o retângulo do estado.
// =========================================================
import { escapeHtml, escapeAttr } from "./utils.js";

// Tipo do estabelecimento DERIVADO do nome (o campo `grupo` só separa CASAI de
// "o resto"; Polo Base, UBSI e Posto de Saúde ficam todos no grupo "u" com nomes
// não padronizados). A ordem abaixo também define a prioridade de exibição.
const TIPO_INFO = {
  "Polo Base": { cor: "#2f6fd0" },
  "UBSI": { cor: "#2f9e6b" },
  "Posto de Saúde": { cor: "#b3559e" },
  "CASAI": { cor: "#e8833a" },
  "Administrativo/Apoio": { cor: "#6b7d96" },
  "Outros": { cor: "#9aa7b8" }
};
const TIPOS = Object.keys(TIPO_INFO);
const infoTipo = t => TIPO_INFO[t] || TIPO_INFO["Outros"];
const ordemTipo = t => { const i = TIPOS.indexOf(t); return i < 0 ? 99 : i; };

// Normaliza o nome (sem acento, maiúsculas, só alfanumérico) para classificar.
function normNome(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

// Classifica um registro do CNES no tipo real, tratando as várias grafias.
// Prioridade: CASAI > Administrativo/Apoio > Polo Base > Posto > UBSI > Outros.
function classificarTipo(rec) {
  const g = String(rec.grupo || "").toLowerCase();
  const n = normNome(rec.nome_estabelecimento);
  if (g === "c" || n.includes("CASAI") || n.includes("CASA DE SAUDE") || n.includes("CASA DE APOIO")) return "CASAI";
  if (n.includes("POLO ADMINISTRATIVO") || n.includes("DISTRITO SANITARIO") || /\bDSEI\b/.test(n) ||
      n.includes("SEDE") || n.includes("CENTRAL DE ABASTEC") || n.includes("EQUIPE") || /\bEMSI\b/.test(n) || n.includes("AMBULATORIO")) return "Administrativo/Apoio";
  if (n.includes("POLO BASE") || n.includes("POLO-BASE") || n.includes("POLOBASE") || /\bPOLO\b/.test(n)) return "Polo Base";
  if (n.includes("POSTO") || /\bPS\b/.test(n) || /\bPSI\b/.test(n) || /\bPIN\b/.test(n)) return "Posto de Saúde";
  if (n.includes("UBSI") || n.includes("UBS") || n.includes("UNIDADE") || n.includes("BASICA DE SAUDE") ||
      n.includes("USFI") || n.includes("USF") || n.includes("USI") || n.includes("CENTRO DE SAUDE") || n.includes("ESPACO SAUDE")) return "UBSI";
  return "Outros";
}

// Código IBGE da UF (2 dígitos) -> sigla, para casar pontos com estados.
const UF_SIGLA = {
  "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO",
  "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL",
  "28": "SE", "29": "BA", "31": "MG", "32": "ES", "33": "RJ", "35": "SP", "41": "PR",
  "42": "SC", "43": "RS", "50": "MS", "51": "MT", "52": "GO", "53": "DF"
};

const $ = id => document.getElementById(id);
const numFmt = n => Number(n || 0).toLocaleString("pt-BR");

// ---------- Estado do módulo ----------
let carregado = false;
let carregando = false;
let montado = false;
let geo = null;               // GeoJSON dos estados
let estabelecimentos = [];    // [{ dsei, grupo, nome, cnes, municipio, uf, lat, lon }]
let ufSelecionada = "";        // "" = visão nacional (define o zoom)
let dseiSelecionado = "";      // "" = todos os DSEIs do estado (destaque fino)
let proj = null;              // projeção
let svgEl = null;             // <svg> montado
let vistaCheia = null;        // viewBox nacional { x, y, w, h }
let vistaAtual = null;        // viewBox corrente (para dimensionar os pontos)
const ufBbox = {};            // sigla -> { x, y, w, h } (retângulo projetado, com folga)
const ufNome = {};            // sigla -> nome do estado

// ---------- Carregamento ----------
async function carregarDados() {
  if (carregado || carregando) return;
  carregando = true;
  try {
    const [rGeo, rDados] = await Promise.all([
      fetch("/data/br-uf.geojson", { credentials: "same-origin" }),
      fetch("/data/rede_cnes.json", { credentials: "same-origin" })
    ]);
    if (!rGeo.ok || !rDados.ok) throw new Error("Falha ao baixar mapa/dados.");
    geo = await rGeo.json();
    const brutos = await rDados.json();
    estabelecimentos = (brutos || []).map(e => ({
      dsei: (e.dsei || "—").trim(),
      tipo: classificarTipo(e),
      nome: e.nome_estabelecimento || "—",
      cnes: e.cnes || "",
      municipio: e.municipio || "—",
      uf: UF_SIGLA[String(e.uf_codigo || "").trim()] || "",
      lat: Number(e.latitude),
      lon: Number(e.longitude)
    })).filter(e => Number.isFinite(e.lat) && Number.isFinite(e.lon));
    carregado = true;
  } finally {
    carregando = false;
  }
}

// ---------- Projeção (equiretangular calibrada pelo GeoJSON) ----------
function calcularProjecao(g) {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  const varrer = anel => {
    for (const [lon, lat] of anel) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  };
  const percorrer = geom => {
    if (!geom) return;
    if (geom.type === "Polygon") geom.coordinates.forEach(varrer);
    else if (geom.type === "MultiPolygon") geom.coordinates.forEach(p => p.forEach(varrer));
  };
  g.features.forEach(f => percorrer(f.geometry));

  const mLon = (maxLon - minLon) * 0.02, mLat = (maxLat - minLat) * 0.02;
  minLon -= mLon; maxLon += mLon; minLat -= mLat; maxLat += mLat;

  const lat0 = (minLat + maxLat) / 2;
  const kx = Math.cos(lat0 * Math.PI / 180);
  const S = 100;
  return {
    w: (maxLon - minLon) * kx * S,
    h: (maxLat - minLat) * S,
    x: lon => (lon - minLon) * kx * S,
    y: lat => (maxLat - lat) * S
  };
}

// ---------- Geometria -> SVG path e bounding box projetado ----------
function anelParaPath(anel) {
  let d = "";
  for (let i = 0; i < anel.length; i++) {
    d += (i === 0 ? "M" : "L") + proj.x(anel[i][0]).toFixed(1) + " " + proj.y(anel[i][1]).toFixed(1) + " ";
  }
  return d + "Z";
}
function geometriaParaPath(geom) {
  let d = "";
  if (geom.type === "Polygon") geom.coordinates.forEach(a => { d += anelParaPath(a); });
  else if (geom.type === "MultiPolygon") geom.coordinates.forEach(p => p.forEach(a => { d += anelParaPath(a); }));
  return d;
}
function bboxProjetado(geom) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const varrer = anel => {
    for (const [lon, lat] of anel) {
      const x = proj.x(lon), y = proj.y(lat);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  };
  if (geom.type === "Polygon") geom.coordinates.forEach(varrer);
  else if (geom.type === "MultiPolygon") geom.coordinates.forEach(p => p.forEach(varrer));
  // Folga para o estado não colar nas bordas ao dar zoom.
  const pad = Math.max(maxX - minX, maxY - minY) * 0.12;
  return { x: minX - pad, y: minY - pad, w: (maxX - minX) + 2 * pad, h: (maxY - minY) + 2 * pad };
}

// ---------- Pontos ----------
// Raio proporcional ao viewBox corrente -> tamanho na tela ~constante em qualquer zoom.
function raioBase() {
  const v = vistaAtual || vistaCheia;
  return Math.max(1.2, Math.min(v.w, v.h) * 0.007);
}
function pontosSvg() {
  const r = raioBase();
  const selecao = temSelecao();
  // data-i = índice no array; o tooltip e o clique fazem o lookup por ele
  // (evita atributos longos por ponto e problemas de escape).
  return estabelecimentos.map((e, i) => {
    const cx = proj.x(e.lon).toFixed(1), cy = proj.y(e.lat).toFixed(1);
    let cls = "mapaPonto", raio = r;
    if (selecao) {
      if (noEscopo(e)) { cls += " is-hl"; raio = r * 1.25; }
      else { cls += " is-dim"; raio = r * 0.8; }
    }
    return `<circle class="${cls}" cx="${cx}" cy="${cy}" r="${raio.toFixed(1)}" fill="${infoTipo(e.tipo).cor}" data-i="${i}"></circle>`;
  }).join("");
}

// HTML do tooltip de um estabelecimento.
function tooltipHtml(e) {
  const linha = (rot, val) => `<div class="mapaTipLinha"><span>${rot}</span><b>${escapeHtml(String(val ?? "").trim() || "—")}</b></div>`;
  const coord = (Number.isFinite(e.lat) && Number.isFinite(e.lon)) ? `${e.lat.toFixed(4)}, ${e.lon.toFixed(4)}` : "—";
  return `<div class="mapaTipNome"><span class="mapaTipDot" style="background:${infoTipo(e.tipo).cor}"></span>${escapeHtml(e.nome)}</div>` +
    `<div class="mapaTipTipo">${escapeHtml(e.tipo)}</div>` +
    linha("CNES", e.cnes) +
    linha("DSEI", e.dsei) +
    linha("Município", e.municipio + (e.uf ? "/" + e.uf : "")) +
    linha("Coordenadas", coord);
}

// ---------- Escopos ----------
// escopo(): destaque atual = estado ∩ DSEI (o que fica realçado / conta nos KPIs).
function escopo() {
  return estabelecimentos.filter(e =>
    (!ufSelecionada || e.uf === ufSelecionada) &&
    (!dseiSelecionado || e.dsei === dseiSelecionado));
}
// listaEstado(): todos do estado (independe do DSEI) — base das tags de DSEI.
function listaEstado() {
  return ufSelecionada ? estabelecimentos.filter(e => e.uf === ufSelecionada) : estabelecimentos;
}
function temSelecao() { return !!(ufSelecionada || dseiSelecionado); }
function noEscopo(e) {
  return (!ufSelecionada || e.uf === ufSelecionada) && (!dseiSelecionado || e.dsei === dseiSelecionado);
}

// ---------- Render base ----------
function montarMapa() {
  const wrap = $("mapaDseisMapa");
  if (!wrap || !geo) return;
  proj = calcularProjecao(geo);
  vistaCheia = { x: 0, y: 0, w: proj.w, h: proj.h };
  vistaAtual = vistaCheia;

  const estados = geo.features.map(f => {
    const sigla = f.properties?.sigla || "";
    const nome = f.properties?.name || sigla;
    if (sigla) { ufNome[sigla] = nome; ufBbox[sigla] = bboxProjetado(f.geometry); }
    return `<path class="mapaUf" data-uf="${escapeAttr(sigla)}" d="${geometriaParaPath(f.geometry)}"><title>${escapeHtml(nome)}</title></path>`;
  }).join("");

  wrap.innerHTML =
    `<svg viewBox="0 0 ${proj.w.toFixed(0)} ${proj.h.toFixed(0)}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Mapa dos DSEIs do Brasil">
       <g class="mapaEstados">${estados}</g>
       <g class="mapaPontos" id="mapaDseisPontos">${pontosSvg()}</g>
     </svg>`;
  // Tooltip flutuante (fora do SVG, posicionado sobre o wrap no hover).
  wrap.insertAdjacentHTML("beforeend", `<div class="mapaTooltip" id="mapaTooltip" hidden></div>`);
  svgEl = wrap.querySelector("svg");
  montado = true;
}

function aplicarVista(v) {
  vistaAtual = v;
  if (svgEl) svgEl.setAttribute("viewBox", `${v.x.toFixed(1)} ${v.y.toFixed(1)} ${v.w.toFixed(1)} ${v.h.toFixed(1)}`);
}
function atualizarPontos() {
  const g = $("mapaDseisPontos");
  if (g) g.innerHTML = pontosSvg();
}
function realcarEstado() {
  if (!svgEl) return;
  svgEl.querySelectorAll(".mapaUf.is-sel").forEach(p => p.classList.remove("is-sel"));
  if (ufSelecionada) {
    const p = svgEl.querySelector(`.mapaUf[data-uf="${ufSelecionada}"]`);
    if (p) p.classList.add("is-sel");
  }
}
function atualizarKpis() {
  const box = $("mapaKpis");
  if (!box) return;
  const vis = escopo();
  const cards = [`<div class="mapaKpi"><div class="mapaKpiValor">${numFmt(vis.length)}</div><div class="mapaKpiLabel">Estabelecimentos</div></div>`];
  TIPOS.forEach(t => {
    const q = vis.filter(e => e.tipo === t).length;
    if (!q) return; // só mostra tipos presentes no escopo atual
    cards.push(`<div class="mapaKpi"><div class="mapaKpiValor" style="color:${TIPO_INFO[t].cor}">${numFmt(q)}</div><div class="mapaKpiLabel">${escapeHtml(t)}</div></div>`);
  });
  box.innerHTML = cards.join("");
}

function renderLegenda() {
  const box = $("mapaLegenda");
  if (!box) return;
  const presentes = new Set(estabelecimentos.map(e => e.tipo));
  box.innerHTML = TIPOS.filter(t => presentes.has(t)).map(t =>
    `<span class="mapaLegItem"><span class="mapaDot" style="background:${TIPO_INFO[t].cor}"></span> ${escapeHtml(t)}</span>`
  ).join("");
}
function preencherFiltroUfs() {
  const sel = $("mapaDseisFiltro");
  if (!sel) return;
  const ufs = [...new Set(estabelecimentos.map(e => e.uf).filter(Boolean))].sort();
  sel.innerHTML = `<option value="">Todos os estados</option>` +
    ufs.map(u => `<option value="${escapeAttr(u)}">${escapeHtml(u)}${ufNome[u] ? " — " + escapeHtml(ufNome[u]) : ""}</option>`).join("");
}

// ---------- Painel lateral ----------
function renderDetalhe() {
  const box = $("mapaDetalhe");
  if (!box) return;

  if (!ufSelecionada) {
    box.innerHTML = `<div class="mapaDetalheVazio">
      <i class="fa-solid fa-hand-pointer" aria-hidden="true"></i>
      <p>Clique num estado do mapa (ou escolha no filtro) para dar zoom e ver os estabelecimentos: CASAI, UBSI e os DSEIs presentes.</p>
    </div>`;
    return;
  }

  // Destaque atual (estado ∩ DSEI) para KPIs e lista; as tags de DSEI vêm de
  // TODO o estado, para que dê para alternar entre os DSEIs.
  const lista = escopo();
  const municipios = new Set(lista.map(e => e.municipio)).size;
  const tiposPresentes = TIPOS.filter(t => lista.some(e => e.tipo === t));
  const dseisEstado = [...new Set(listaEstado().map(e => e.dsei))].sort((a, b) => a.localeCompare(b, "pt-BR"));

  const itens = [...lista].sort((a, b) =>
    ordemTipo(a.tipo) - ordemTipo(b.tipo) ||
    a.municipio.localeCompare(b.municipio, "pt-BR") ||
    a.nome.localeCompare(b.nome, "pt-BR")
  ).map(e => `<li class="mapaItem">
      <span class="mapaItemDot" style="background:${infoTipo(e.tipo).cor}"></span>
      <span class="mapaItemTxt">
        <span class="mapaItemNome">${escapeHtml(e.nome)}</span>
        <span class="mapaItemMun">${escapeHtml(e.municipio)} · DSEI ${escapeHtml(e.dsei)} · ${escapeHtml(e.tipo)}</span>
      </span>
    </li>`).join("");

  const titulo = ufNome[ufSelecionada] ? `${ufNome[ufSelecionada]} (${ufSelecionada})` : ufSelecionada;
  const mini = [`<div class="mapaMiniKpi"><b>${numFmt(lista.length)}</b><span>Total</span></div>`]
    .concat(tiposPresentes.map(t =>
      `<div class="mapaMiniKpi"><b style="color:${TIPO_INFO[t].cor}">${numFmt(lista.filter(e => e.tipo === t).length)}</b><span>${escapeHtml(t)}</span></div>`))
    .join("");
  const tags = dseisEstado.map(d =>
    `<button type="button" class="mapaTag${d === dseiSelecionado ? " is-sel" : ""}" data-dsei-tag="${escapeAttr(d)}">${escapeHtml(d)}</button>`
  ).join("");

  box.innerHTML = `
    <div class="mapaDetalheHead">
      <div>
        <div class="mapaDetalheRotulo">Estado</div>
        <h3 class="mapaDetalheTitulo">${escapeHtml(titulo)}</h3>
      </div>
      <button type="button" class="mapaDetalheFechar" id="mapaDetalheFechar" title="Voltar ao Brasil" aria-label="Voltar à visão nacional">
        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
      </button>
    </div>
    <div class="mapaDetalheKpis">${mini}</div>
    <div class="mapaDetalheMun">${numFmt(municipios)} município(s)${dseiSelecionado ? ` · destacando DSEI <b>${escapeHtml(dseiSelecionado)}</b>` : ""}</div>
    ${dseisEstado.length ? `<div class="mapaTags"><span class="mapaTagsLabel">DSEIs — clique para destacar no mapa:</span><div class="mapaTagsLista">${tags}</div></div>` : ""}
    ${itens ? `<ul class="mapaLista">${itens}</ul>` : `<p class="mapaListaVazia">Nenhum estabelecimento localizado neste estado.</p>`}`;
}

// ---------- Seleção de estado (com zoom) ----------
function selecionarUf(uf) {
  ufSelecionada = (uf && ufBbox[uf]) ? uf : "";
  dseiSelecionado = "";  // novo estado zera o DSEI destacado
  aplicarVista(ufSelecionada ? ufBbox[ufSelecionada] : vistaCheia);
  atualizarPontos();     // recalcula raio conforme o novo zoom + destaque
  realcarEstado();
  const sel = $("mapaDseisFiltro");
  if (sel && sel.value !== ufSelecionada) sel.value = ufSelecionada;
  atualizarKpis();
  renderDetalhe();
}

// ---------- Seleção de DSEI (destaque fino, sem mudar o zoom) ----------
function selecionarDsei(dsei) {
  dseiSelecionado = (dseiSelecionado === dsei) ? "" : (dsei || ""); // clicar de novo limpa
  atualizarPontos();
  atualizarKpis();
  renderDetalhe();
}

// ---------- API pública ----------
export function configurarMapaDseis() {
  const sel = $("mapaDseisFiltro");
  if (sel) sel.addEventListener("change", () => selecionarUf(sel.value || ""));

  const wrap = $("mapaDseisMapa");
  if (wrap) {
    wrap.addEventListener("click", ev => {
      const ponto = ev.target.closest("circle.mapaPonto");
      if (ponto) { const e = estabelecimentos[+ponto.dataset.i]; selecionarUf(e ? e.uf : ""); return; }
      const estado = ev.target.closest("path.mapaUf");
      if (estado) { selecionarUf(estado.dataset.uf || ""); return; }
      if (ev.target.closest("svg")) selecionarUf(""); // fundo -> volta ao Brasil
    });

    // Tooltip: segue o cursor enquanto está sobre um ponto.
    wrap.addEventListener("mousemove", ev => {
      const tip = $("mapaTooltip");
      if (!tip) return;
      const c = ev.target.closest("circle.mapaPonto");
      const e = c ? estabelecimentos[+c.dataset.i] : null;
      if (!e) { tip.hidden = true; return; }
      if (tip.dataset.i !== c.dataset.i) { tip.innerHTML = tooltipHtml(e); tip.dataset.i = c.dataset.i; }
      tip.hidden = false;
      const rect = wrap.getBoundingClientRect();
      let x = ev.clientX - rect.left + 14;
      let y = ev.clientY - rect.top + 14;
      if (x + tip.offsetWidth > rect.width) x = ev.clientX - rect.left - tip.offsetWidth - 14;
      if (y + tip.offsetHeight > rect.height) y = ev.clientY - rect.top - tip.offsetHeight - 14;
      tip.style.left = Math.max(0, x) + "px";
      tip.style.top = Math.max(0, y) + "px";
    });
    wrap.addEventListener("mouseleave", () => { const tip = $("mapaTooltip"); if (tip) tip.hidden = true; });
  }

  // Painel: fechar (volta ao Brasil) e tags de DSEI (destaque fino). Delegação
  // uma vez só — o conteúdo do painel é recriado a cada render.
  const det = $("mapaDetalhe");
  if (det) {
    det.addEventListener("click", e => {
      if (e.target.closest("#mapaDetalheFechar")) { selecionarUf(""); return; }
      const tag = e.target.closest("[data-dsei-tag]");
      if (tag) selecionarDsei(tag.dataset.dseiTag || "");
    });
  }
}

// Chamado ao abrir a aba: carrega (uma vez) e desenha o mapa.
export async function renderMapaDseisAoMostrar() {
  const wrap = $("mapaDseisMapa");
  if (!wrap) return;
  if (!carregado) {
    wrap.innerHTML = `<div class="mapaVazio">Carregando mapa…</div>`;
    try {
      await carregarDados();
    } catch {
      wrap.innerHTML = `<div class="mapaVazio">Não foi possível carregar o mapa dos DSEIs.</div>`;
      return;
    }
    preencherFiltroUfs();
    renderLegenda();
  }
  if (!montado) montarMapa();
  atualizarKpis();
  renderDetalhe();
}
