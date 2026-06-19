// =========================================================
// Ordenação de tabelas por clique no cabeçalho
// -----------------------------------------------------------------
// Dois modos:
//   1) Por DADOS (recomendado p/ tabelas com paginação/render próprio):
//      - cabeçalho com thOrdenavel(id, rótulo, chave) OU <th> estático
//        marcado com class="sortable" data-ordenar="id" data-key="chave";
//      - a função de render ordena a lista com ordenarLista(id, lista, getters)
//        ANTES de paginar e registra um reRender com registrarOrdenacao(id, fn).
//   2) Por DOM (tabelas estáticas/maquete): marcarTabelasDOM(seletor) torna os
//      cabeçalhos clicáveis e reordena as linhas renderizadas no próprio DOM.
//
// Comportamento do clique (definido pelo usuário): 1º clique = MAIOR → MENOR
// (decrescente); o 2º clique inverte para crescente. Valores vazios ("", "-",
// "—") vão sempre para o fim, independente da direção.
// =========================================================
import { escapeAttr } from "./utils.js";

// ---------- Comparação genérica (número pt-BR, data, texto) ----------
const VALORES_VAZIOS = new Set(["", "-", "—", "–"]);

function ehVazio(v) {
  return v === null || v === undefined || VALORES_VAZIOS.has(String(v).trim());
}

// "1.234,56", "R$ 1.234,56", "85%", "12", "01 + CR" -> primeiro número (ou null).
function paraNumero(v) {
  if (typeof v === "number") return Number.isNaN(v) ? null : v;
  const s = String(v).replace(/\s+/g, "");
  if (!s) return null;
  const m = s.match(/-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:,\d+)?|-?\d+(?:\.\d+)?/);
  if (!m) return null;
  let num = m[0];
  if (num.includes(",")) num = num.replace(/\./g, "").replace(",", ".");
  const n = Number(num);
  return Number.isNaN(n) ? null : n;
}

// dd/mm/aaaa ou aaaa-mm-dd -> timestamp (ou null).
function paraData(v) {
  const s = String(v).trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return Date.parse(`${m[3]}-${m[2]}-${m[1]}`);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return Date.parse(s);
  return null;
}

function compararNaoVazio(a, b) {
  const da = paraData(a);
  const db = paraData(b);
  if (da !== null && db !== null && !Number.isNaN(da) && !Number.isNaN(db)) return da - db;

  const na = paraNumero(a);
  const nb = paraNumero(b);
  if (na !== null && nb !== null) return na - nb;

  return String(a).localeCompare(String(b), "pt-BR", { numeric: true, sensitivity: "base" });
}

// Retorna o comparador para a direção pedida, com vazios sempre por último.
function comparador(dir) {
  const fator = dir === "asc" ? 1 : -1;
  return (a, b) => {
    const va = ehVazio(a);
    const vb = ehVazio(b);
    if (va && vb) return 0;
    if (va) return 1;
    if (vb) return -1;
    return fator * compararNaoVazio(a, b);
  };
}

// ---------- Registro de estado por tabela (modo DADOS) ----------
const estados = new Map();    // id -> { key, dir }
const reRenders = new Map();  // id -> função de re-render

export function registrarOrdenacao(id, reRender) {
  if (typeof reRender === "function") reRenders.set(id, reRender);
}

export function estadoOrdenacao(id) {
  return estados.get(id) || null;
}

// <th> ordenável montado dinamicamente (cabeçalhos gerados em JS).
export function thOrdenavel(id, rotulo, key, opts = {}) {
  const st = estados.get(id);
  const ativo = st && st.key === key;
  const classes = ["sortable"];
  if (ativo) classes.push(st.dir === "asc" ? "sortAsc" : "sortDesc");
  if (opts.classe) classes.push(opts.classe);
  return `<th class="${classes.join(" ")}" data-ordenar="${escapeAttr(id)}" data-key="${escapeAttr(String(key))}">${rotulo}</th>`;
}

// Ordena uma lista conforme o estado atual da tabela. `getters` mapeia a chave
// da coluna para uma função (row) => valor, quando o campo não é direto.
export function ordenarLista(id, lista, getters = {}) {
  const arr = Array.isArray(lista) ? lista.slice() : [];
  const st = estados.get(id);
  if (!st || !st.key) return arr;
  const getter = getters[st.key] || (row => row[st.key]);
  const cmp = comparador(st.dir);
  return arr.sort((a, b) => cmp(getter(a), getter(b)));
}

// Atualiza as setas (↑/↓) nos <th> estáticos de uma tabela (modo DADOS).
function aplicarIndicadores(id) {
  const st = estados.get(id);
  document.querySelectorAll(`th.sortable[data-ordenar="${CSS.escape(id)}"]`).forEach(th => {
    th.classList.remove("sortAsc", "sortDesc");
    if (st && st.key === th.getAttribute("data-key")) {
      th.classList.add(st.dir === "asc" ? "sortAsc" : "sortDesc");
    }
  });
}

function aoClicarDados(id, key) {
  const st = estados.get(id);
  if (st && st.key === key) {
    st.dir = st.dir === "asc" ? "desc" : "asc";
  } else {
    estados.set(id, { key, dir: "desc" }); // 1º clique = maior → menor
  }
  aplicarIndicadores(id);
  const fn = reRenders.get(id);
  if (fn) fn();
}

// ---------- Modo DOM (tabelas estáticas / maquete) ----------
function ehLinhaFixada(tr) {
  return /total|resumo/i.test(tr.className) || tr.hasAttribute("data-pin");
}

function ordenarDOM(th) {
  const tabela = th.closest("table");
  const tbody = tabela && tabela.tBodies[0];
  if (!tbody) return;

  const col = Number(th.getAttribute("data-col") || 0);
  const dirAtual = th.getAttribute("data-dir");
  const dir = dirAtual === "desc" ? "asc" : "desc"; // 1º clique = desc

  // Indicadores no cabeçalho.
  th.parentElement.querySelectorAll("th.sortable").forEach(outro => {
    outro.classList.remove("sortAsc", "sortDesc");
    outro.removeAttribute("data-dir");
  });
  th.setAttribute("data-dir", dir);
  th.classList.add(dir === "asc" ? "sortAsc" : "sortDesc");

  const linhas = Array.from(tbody.rows);
  const fixas = linhas.filter(ehLinhaFixada);
  const ordenaveis = linhas.filter(tr => !ehLinhaFixada(tr));
  const cmp = comparador(dir);
  const valor = tr => {
    const cel = tr.cells[col];
    return cel ? cel.textContent.trim() : "";
  };
  ordenaveis.sort((a, b) => cmp(valor(a), valor(b)));

  const frag = document.createDocumentFragment();
  ordenaveis.forEach(tr => frag.appendChild(tr));
  fixas.forEach(tr => frag.appendChild(tr));
  tbody.appendChild(frag);
}

// Marca os cabeçalhos das tabelas alvo como ordenáveis em DOM.
export function marcarTabelasDOM(seletor) {
  document.querySelectorAll(seletor).forEach(tabela => {
    const linhaCab = tabela.tHead && tabela.tHead.rows[0];
    if (!linhaCab) return;
    Array.from(linhaCab.cells).forEach((th, idx) => {
      if (th.dataset.ordenarDom === "1") return;
      if (!th.textContent.trim()) return; // pula coluna de ações sem rótulo
      th.dataset.ordenarDom = "1";
      th.dataset.col = String(idx);
      th.classList.add("sortable");
    });
  });
}

// ---------- Inicialização (um único listener global) ----------
let inicializado = false;

export function inicializarOrdenacao() {
  if (inicializado) return;
  inicializado = true;
  document.addEventListener("click", event => {
    const th = event.target.closest("th.sortable");
    if (!th) return;
    if (th.hasAttribute("data-ordenar") && th.hasAttribute("data-key")) {
      aoClicarDados(th.getAttribute("data-ordenar"), th.getAttribute("data-key"));
    } else if (th.dataset.ordenarDom === "1") {
      ordenarDOM(th);
    }
  });
}
