// Combobox pesquisável genérico: transforma um <select> nativo num campo
// clicável e pesquisável (mesma ideia do combobox de trabalhador da Gestão
// Disciplinar), mantendo o <select> como FONTE DE VERDADE — o valor e o evento
// "change" continuam funcionando, então a delegação existente (data-change) não
// precisa mudar.
//
// A lista de opções é renderizada num portal no <body> com position: fixed, para
// não ser cortada por contêineres com overflow (ex.: as tabelas de cargos).
import { escapeHtml } from "./utils.js";

// Idempotente: enhancing duas vezes só re-sincroniza o texto exibido.
export function tornarSelectPesquisavel(select, opts = {}) {
  if (!select) return;
  if (select.dataset.ssEnhanced === "1") { sincronizarSelectPesquisavel(select); return; }
  select.dataset.ssEnhanced = "1";

  const wrap = document.createElement("div");
  wrap.className = "ssCombo";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "ssInput";
  input.autocomplete = "off";
  input.placeholder = opts.placeholder || "Selecione ou pesquise…";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "false");
  const caret = document.createElement("i");
  caret.className = "fa-solid fa-chevron-down ssCaret";
  caret.setAttribute("aria-hidden", "true");

  // Coloca o wrapper no lugar do select e move o select (escondido) pra dentro.
  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(select);
  wrap.appendChild(input);
  wrap.appendChild(caret);
  select.classList.add("ssNativo");
  select.setAttribute("aria-hidden", "true");
  select.tabIndex = -1;

  let lista = null;     // <ul> no portal (body); existe só enquanto aberto
  let idx = -1;         // item destacado pelo teclado
  let filtradas = [];

  const textoSel = () => select.options[select.selectedIndex]?.text || "";
  const opcoes = () => Array.from(select.options).map((o, i) => ({ value: o.value, text: o.text, i }));

  const posicionar = () => {
    if (!lista) return;
    const r = input.getBoundingClientRect();
    lista.style.left = `${Math.round(r.left)}px`;
    lista.style.top = `${Math.round(r.bottom + 4)}px`;
    lista.style.width = `${Math.round(r.width)}px`;
  };
  const onScroll = () => fechar();
  const onResize = () => posicionar();

  const render = () => {
    if (!lista) return;
    // Quando o texto é exatamente a opção selecionada, mostra TODAS (não filtra).
    const raw = input.value.trim();
    const termo = (raw && raw !== textoSel()) ? raw.toLowerCase() : "";
    const todas = opcoes();
    filtradas = termo ? todas.filter(o => o.text.toLowerCase().includes(termo)) : todas;
    if (!filtradas.length) { lista.innerHTML = `<li class="ssVazio">Nenhuma opção encontrada.</li>`; return; }
    lista.innerHTML = filtradas.map((o, k) =>
      `<li class="ssItem${k === idx ? " is-ativo" : ""}${o.value === select.value ? " is-sel" : ""}" role="option" data-i="${o.i}" title="${escapeHtml(o.text)}">${escapeHtml(o.text)}</li>`
    ).join("");
  };

  const abrir = () => {
    if (lista) { render(); return; }
    lista = document.createElement("ul");
    lista.className = "ssLista";
    lista.setAttribute("role", "listbox");
    document.body.appendChild(lista);
    lista.addEventListener("mousedown", e => {
      const li = e.target.closest("[data-i]");
      if (!li) return;
      e.preventDefault(); // mantém o foco no input (não fecha por blur)
      escolher(Number(li.dataset.i));
    });
    input.setAttribute("aria-expanded", "true");
    idx = -1;
    render();
    posicionar();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
  };

  const fechar = () => {
    if (lista) { lista.remove(); lista = null; }
    input.setAttribute("aria-expanded", "false");
    idx = -1;
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onResize);
  };

  const escolher = (optionIndex) => {
    if (optionIndex >= 0) select.selectedIndex = optionIndex;
    input.value = textoSel();
    fechar();
    // Dispara o change no select nativo p/ acionar a delegação existente.
    select.dispatchEvent(new Event("change", { bubbles: true }));
  };

  input.addEventListener("focus", () => { abrir(); input.select(); });
  caret.addEventListener("mousedown", e => {
    e.preventDefault();
    if (lista) { fechar(); } else { input.focus(); }
  });
  input.addEventListener("input", () => { idx = -1; abrir(); });
  input.addEventListener("keydown", e => {
    if (e.key === "Escape") { fechar(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!lista) { abrir(); }
      if (!filtradas.length) return;
      idx += e.key === "ArrowDown" ? 1 : -1;
      if (idx < 0) idx = filtradas.length - 1;
      if (idx >= filtradas.length) idx = 0;
      render();
      lista?.querySelector(".is-ativo")?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      if (idx >= 0 && filtradas[idx]) { e.preventDefault(); escolher(filtradas[idx].i); }
    }
  });
  // Fecha ao perder o foco (atraso curto para permitir o mousedown na lista).
  input.addEventListener("blur", () => setTimeout(fechar, 120));

  // Mantém o texto exibido em sincronia com o valor do select (inclusive quando
  // alterado por código — ex.: carregamento para edição).
  select._ssSync = () => { input.value = textoSel(); };
  select._ssSync();
}

export function sincronizarSelectPesquisavel(select) {
  if (select && typeof select._ssSync === "function") select._ssSync();
}
