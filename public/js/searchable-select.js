// Combobox pesquisável de SELEÇÃO ÚNICA, no mesmo formato visual do filtro
// multi-seleção do topo (.multiSelect): um "gatilho" (botão com o valor + seta)
// que abre um popup com campo de busca interno e a lista de opções.
//
// Mantém o <select> nativo como FONTE DE VERDADE (o valor e o evento "change"
// continuam funcionando, então a delegação/handlers existentes não mudam).
//
// O popup é renderizado num portal no <body> com position: fixed, para não ser
// cortado por contêineres com overflow (ex.: tabelas com rolagem).
import { escapeHtml } from "./utils.js";

// Idempotente: enhancing duas vezes só re-sincroniza o texto exibido.
export function tornarSelectPesquisavel(select, opts = {}) {
  if (!select) return;
  if (select.dataset.ssEnhanced === "1") { sincronizarSelectPesquisavel(select); return; }
  select.dataset.ssEnhanced = "1";

  const placeholder = opts.placeholder || "Selecione…";

  // Gatilho (botão) com o valor selecionado + seta — igual ao .multiSelectTrigger.
  const wrap = document.createElement("div");
  wrap.className = "ssCombo";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "ssTrigger";
  const valorEl = document.createElement("span");
  valorEl.className = "ssValor";
  const caret = document.createElement("i");
  caret.className = "fa-solid fa-chevron-down ssCaret";
  caret.setAttribute("aria-hidden", "true");
  trigger.appendChild(valorEl);
  trigger.appendChild(caret);

  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(select);
  wrap.appendChild(trigger);
  select.classList.add("ssNativo");
  select.setAttribute("aria-hidden", "true");
  select.tabIndex = -1;

  let menu = null;       // popup (no body) — existe só enquanto aberto
  let searchEl = null;
  let listaEl = null;
  let idx = -1;          // item destacado pelo teclado
  let filtradas = [];

  const opcoes = () => Array.from(select.options).map((o, i) => ({ value: o.value, text: o.text, i }));
  const textoSel = () => { const o = select.options[select.selectedIndex]; return o ? o.text : ""; };

  const atualizarValor = () => {
    const t = textoSel();
    valorEl.textContent = t || placeholder;
    wrap.classList.toggle("is-vazio", !t);
  };

  const posicionar = () => {
    if (!menu) return;
    const r = trigger.getBoundingClientRect();
    menu.style.left = `${Math.round(r.left)}px`;
    menu.style.top = `${Math.round(r.bottom + 6)}px`;
    menu.style.width = `${Math.round(r.width)}px`;
  };
  // Fecha ao rolar o fundo (o popup é fixed); ignora rolagem dentro do popup.
  const onScroll = e => { if (menu && e && e.target instanceof Node && menu.contains(e.target)) return; fechar(); };
  const onResize = () => posicionar();
  const onDocDown = e => { if (!wrap.contains(e.target) && (!menu || !menu.contains(e.target))) fechar(); };

  const render = () => {
    if (!listaEl) return;
    const termo = (searchEl.value || "").trim().toLowerCase();
    const todas = opcoes();
    filtradas = termo ? todas.filter(o => o.text.toLowerCase().includes(termo)) : todas;
    if (!filtradas.length) { listaEl.innerHTML = `<li class="ssVazio">Nenhuma opção encontrada.</li>`; return; }
    listaEl.innerHTML = filtradas.map((o, k) =>
      `<li class="ssItem${k === idx ? " is-ativo" : ""}${o.value === select.value ? " is-sel" : ""}" role="option" data-i="${o.i}" title="${escapeHtml(o.text)}">
        <span class="ssItemCheck"><i class="fa-solid fa-check"></i></span>
        <span class="ssItemLabel">${escapeHtml(o.text)}</span>
      </li>`).join("");
  };

  const abrir = () => {
    if (menu) return;
    wrap.classList.add("aberto");
    menu = document.createElement("div");
    menu.className = "ssMenu";
    menu.innerHTML = `
      <div class="ssSearch">
        <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
        <input type="search" class="ssSearchInput" placeholder="Pesquisar neste filtro" autocomplete="off" aria-label="Pesquisar">
      </div>
      <ul class="ssLista" role="listbox"></ul>`;
    document.body.appendChild(menu);
    searchEl = menu.querySelector(".ssSearchInput");
    listaEl = menu.querySelector(".ssLista");

    // mousedown (não click) para selecionar antes de o blur fechar o popup.
    menu.addEventListener("mousedown", e => {
      const li = e.target.closest("[data-i]");
      if (li) { e.preventDefault(); escolher(Number(li.dataset.i)); return; }
      if (e.target !== searchEl) e.preventDefault(); // mantém o foco na busca
    });
    searchEl.addEventListener("input", () => { idx = -1; render(); });
    searchEl.addEventListener("keydown", onKeydown);

    idx = -1;
    render();
    posicionar();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    document.addEventListener("mousedown", onDocDown, true);
    setTimeout(() => searchEl && searchEl.focus(), 10);
  };

  const fechar = () => {
    if (menu) { menu.remove(); menu = null; searchEl = null; listaEl = null; }
    wrap.classList.remove("aberto");
    idx = -1;
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onResize);
    document.removeEventListener("mousedown", onDocDown, true);
  };

  const escolher = optionIndex => {
    if (optionIndex >= 0) select.selectedIndex = optionIndex;
    atualizarValor();
    fechar();
    trigger.focus();
    // Dispara o change no select nativo p/ acionar a lógica existente.
    select.dispatchEvent(new Event("change", { bubbles: true }));
  };

  function onKeydown(e) {
    if (e.key === "Escape") { fechar(); trigger.focus(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!filtradas.length) return;
      idx += e.key === "ArrowDown" ? 1 : -1;
      if (idx < 0) idx = filtradas.length - 1;
      if (idx >= filtradas.length) idx = 0;
      render();
      listaEl && listaEl.querySelector(".is-ativo")?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      if (idx >= 0 && filtradas[idx]) { e.preventDefault(); escolher(filtradas[idx].i); }
    }
  }

  trigger.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); menu ? fechar() : abrir(); });
  trigger.addEventListener("keydown", e => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!menu) abrir(); }
  });

  // Mantém o texto exibido em sincronia com o valor do select (inclusive quando
  // alterado por código — ex.: carregamento para edição, repopulação de opções).
  // Atribuições puras de .value/.selectedIndex não geram mutação de DOM, então
  // interceptamos os setters para re-sincronizar o gatilho automaticamente —
  // assim limpar filtros, carregar para edição e reset de formulário funcionam
  // sem que cada módulo precise chamar sincronizarSelectPesquisavel().
  interceptarSetter(select, "value", atualizarValor);
  interceptarSetter(select, "selectedIndex", atualizarValor);

  select._ssSync = atualizarValor;
  atualizarValor();
}

// Encadeia um callback ao setter nativo de uma propriedade do <select>, sem
// quebrar a leitura/escrita normal (delega ao descritor do protótipo).
function interceptarSetter(select, prop, onSet) {
  if (Object.prototype.hasOwnProperty.call(select, prop)) return; // já interceptado
  const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
  if (!desc || typeof desc.get !== "function" || typeof desc.set !== "function") return;
  Object.defineProperty(select, prop, {
    configurable: true,
    enumerable: false,
    get() { return desc.get.call(this); },
    set(v) { desc.set.call(this, v); onSet(); }
  });
}

export function sincronizarSelectPesquisavel(select) {
  if (select && typeof select._ssSync === "function") select._ssSync();
}

// Selects elegíveis: ignora os já enhados (.ssNativo), os multi-seleção e os
// marcados com data-ss-skip (caso algum precise continuar nativo).
const SS_SELETOR = "select:not([data-ss-skip]):not([multiple]):not(.ssNativo)";

// Enha (ou re-sincroniza) TODOS os <select> de um container de uma vez.
export function tornarSelectsPesquisaveis(raiz, opts = {}) {
  (raiz || document).querySelectorAll(SS_SELETOR).forEach(sel => tornarSelectPesquisavel(sel, opts));
}

// Padroniza TODOS os <select> do app como dropdown pesquisável, de uma vez:
//  1) enha os que já existem; 2) observa o DOM para enhar selects criados depois
//  e re-sincronizar o texto quando as opções de um select forem repopuladas.
// Basta chamar uma vez na inicialização do app.
let _ssObserver = null;
export function ativarSelectsPesquisaveisGlobal(opts = {}) {
  document.querySelectorAll(SS_SELETOR).forEach(sel => tornarSelectPesquisavel(sel, opts));
  if (_ssObserver || typeof MutationObserver === "undefined") return;
  _ssObserver = new MutationObserver(muts => {
    for (const m of muts) {
      const t = m.target;
      if (t && t.tagName === "SELECT" && t.dataset.ssEnhanced === "1") sincronizarSelectPesquisavel(t);
      m.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        if (node.matches && node.matches(SS_SELETOR)) tornarSelectPesquisavel(node, opts);
        if (node.querySelectorAll) node.querySelectorAll(SS_SELETOR).forEach(s => tornarSelectPesquisavel(s, opts));
      });
    }
  });
  _ssObserver.observe(document.body, { childList: true, subtree: true });
}
