// =========================================================
// Combobox de MULTI-SELEÇÃO pesquisável, genérico e autocontido.
// Um gatilho (botão com o resumo da seleção) abre um popup com
// busca e uma lista de opções com checkbox — várias podem ser
// marcadas. Sem estado global: cada instância mantém o próprio
// conjunto selecionado e avisa via callback onChange.
//
// As classes usam um PREFIXO configurável (`opts.prefixo`, padrão
// "mc") para o CSS: <prefixo>Combo, <prefixo>ComboBtn, etc. Assim
// cada aba estiliza com a própria paleta sem acoplar CSS.
//
//   const c = criarMultiCombo("meuDiv", {
//     prefixo: "et", placeholder: "Todos",
//     onChange: () => { const vals = c.getValues(); ... }
//   });
//   c.setOptions(["A","B"] | [{value,label}], "Todos");
//   c.getValues() -> string[]   c.clear()   c.setValues([...])
// =========================================================
import { escapeHtml, escapeAttr } from "./utils.js";

// Registro global só para fechar todos os popups abertos ao clicar fora
// (os cliques DENTRO do combo dão stopPropagation, então não fecham).
const registro = new Set();
function fecharTodos(exceto) {
  registro.forEach(c => { if (c.root !== exceto) c.fechar(); });
}
if (typeof document !== "undefined") {
  document.addEventListener("click", () => fecharTodos(null));
}

export function criarMultiCombo(elementoOuId, opts = {}) {
  const root = typeof elementoOuId === "string" ? document.getElementById(elementoOuId) : elementoOuId;
  if (!root) return null;

  const p = opts.prefixo || "mc";
  const maxRender = opts.maxRender || 200;
  const ph = opts.searchPlaceholder || "Buscar…";
  const onChange = typeof opts.onChange === "function" ? opts.onChange : null;
  let rotuloAll = opts.placeholder || "Todos";

  root.classList.add(`${p}Combo`);
  root.innerHTML = `
    <button type="button" class="${p}ComboBtn" aria-haspopup="listbox" aria-expanded="false">
      <span class="${p}ComboValor"></span><i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
    </button>
    <div class="${p}ComboPop" hidden>
      <div class="${p}ComboSearch">
        <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
        <input type="text" class="${p}ComboInput" placeholder="${escapeAttr(ph)}" autocomplete="off" aria-label="${escapeAttr(ph)}">
        <button type="button" class="${p}ComboClear" hidden>Limpar</button>
      </div>
      <ul class="${p}ComboList" role="listbox" aria-multiselectable="true"></ul>
    </div>`;
  if (opts.ariaLabel) root.querySelector(`.${p}ComboBtn`).setAttribute("aria-label", opts.ariaLabel);

  const btn = root.querySelector(`.${p}ComboBtn`);
  const valorEl = root.querySelector(`.${p}ComboValor`);
  const pop = root.querySelector(`.${p}ComboPop`);
  const input = root.querySelector(`.${p}ComboInput`);
  const clearBtn = root.querySelector(`.${p}ComboClear`);
  const list = root.querySelector(`.${p}ComboList`);
  let opcoes = [];
  const sel = new Set();

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
    let html = mostra.map(o =>
      `<li class="${p}ComboOpt${sel.has(o.value) ? " is-sel" : ""}" data-v="${escapeAttr(o.value)}" title="${escapeHtml(o.label)}" role="option" aria-selected="${sel.has(o.value)}"><span class="${p}ComboCheck"><i class="fa-solid fa-check"></i></span><span class="${p}ComboOptLabel">${escapeHtml(o.label)}</span></li>`
    ).join("");
    if (!vis.length) html = `<li class="${p}ComboVazio">Nenhuma opção</li>`;
    else if (vis.length > maxRender) html += `<li class="${p}ComboMais">+${vis.length - maxRender} — digite para refinar…</li>`;
    list.innerHTML = html;
  }
  function abrir() { fecharTodos(root); pop.hidden = false; root.classList.add("aberto"); btn.setAttribute("aria-expanded", "true"); input.value = ""; renderLista(""); setTimeout(() => input.focus(), 10); }
  function fechar() { pop.hidden = true; root.classList.remove("aberto"); btn.setAttribute("aria-expanded", "false"); }
  function toggle(v) { if (sel.has(v)) sel.delete(v); else sel.add(v); atualizarBotao(); renderLista(input.value); if (onChange) onChange(); }

  btn.addEventListener("click", e => { e.stopPropagation(); pop.hidden ? abrir() : fechar(); });
  pop.addEventListener("click", e => e.stopPropagation());
  input.addEventListener("input", () => renderLista(input.value));
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") { const o = list.querySelector(`.${p}ComboOpt`); if (o) toggle(o.dataset.v); e.preventDefault(); }
    else if (e.key === "Escape") fechar();
  });
  list.addEventListener("click", e => { const li = e.target.closest(`.${p}ComboOpt`); if (li) toggle(li.dataset.v); });
  clearBtn.addEventListener("click", e => { e.stopPropagation(); sel.clear(); atualizarBotao(); renderLista(input.value); if (onChange) onChange(); });

  const inst = {
    root,
    setOptions(valores, rotulo) {
      if (rotulo) rotuloAll = rotulo;
      opcoes = (valores || []).map(v => (v && typeof v === "object")
        ? { value: String(v.value), label: String(v.label) }
        : { value: String(v), label: String(v) });
      // Descarta seleções que não existem mais entre as novas opções (ex.: cascata).
      [...sel].forEach(v => { if (!opcoes.some(o => o.value === v)) sel.delete(v); });
      atualizarBotao();
      if (!pop.hidden) renderLista(input.value);
    },
    getValues() { return [...sel]; },
    setValues(vals) { sel.clear(); (vals || []).forEach(v => sel.add(String(v))); atualizarBotao(); },
    clear() { sel.clear(); atualizarBotao(); if (!pop.hidden) renderLista(input.value); },
    fechar
  };
  registro.add(inst);
  atualizarBotao();
  return inst;
}
