// Date picker customizado (calendário com dropdowns de MÊS e ANO + setas), no
// lugar do calendário nativo do <input type="date"> (que só navega mês a mês).
//
// Mantém o <input type="date"> nativo como FONTE DE VERDADE (value em YYYY-MM-DD;
// dispara 'input' e 'change'), então a lógica de filtros existente não muda. O
// popup é um portal no <body> (position: fixed) para não ser cortado.
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const pad = n => String(n).padStart(2, "0");
function isoParts(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "").trim());
  return m ? { y: +m[1], mo: +m[2] - 1, d: +m[3] } : null;
}
function fmtBr(iso) { const p = isoParts(iso); return p ? `${pad(p.d)}/${pad(p.mo + 1)}/${p.y}` : ""; }

export function tornarDatePicker(input, opts = {}) {
  if (!input || input.dataset.dpEnhanced === "1") return;
  input.dataset.dpEnhanced = "1";

  const placeholder = opts.placeholder || input.getAttribute("aria-label") || "dd/mm/aaaa";

  const wrap = document.createElement("div");
  wrap.className = "dpField";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "dpTrigger";
  const valorEl = document.createElement("span");
  valorEl.className = "dpValor";
  const icon = document.createElement("i");
  icon.className = "fa-regular fa-calendar dpIcon";
  icon.setAttribute("aria-hidden", "true");
  trigger.append(valorEl, icon);

  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  wrap.appendChild(trigger);
  input.classList.add("dpNativo");
  input.tabIndex = -1;
  input.setAttribute("aria-hidden", "true");

  let pop = null, viewY = 0, viewMo = 0;

  const atualizar = () => {
    const v = input.value;
    valorEl.textContent = v ? fmtBr(v) : placeholder;
    wrap.classList.toggle("is-vazio", !v);
  };

  const posicionar = () => {
    if (!pop) return;
    const r = trigger.getBoundingClientRect();
    const w = Math.max(252, Math.round(r.width));
    let left = Math.round(r.left);
    if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - w);
    let top = Math.round(r.bottom + 6);
    // se não couber abaixo, abre acima
    if (top + 300 > window.innerHeight && r.top - 300 > 0) top = Math.round(r.top - 6 - 300);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    pop.style.width = `${w}px`;
  };
  const onScroll = e => { if (pop && e && e.target instanceof Node && pop.contains(e.target)) return; fechar(); };
  const onResize = () => posicionar();
  const onDocDown = e => { if (!wrap.contains(e.target) && (!pop || !pop.contains(e.target))) fechar(); };

  const listaAnos = () => {
    const atual = new Date().getFullYear();
    const arr = [];
    for (let y = atual + 5; y >= atual - 90; y--) arr.push(y);
    return arr;
  };

  const definir = (y, mo, d) => {
    input.value = `${y}-${pad(mo + 1)}-${pad(d)}`;
    atualizar();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    fechar();
    trigger.focus();
  };
  const limpar = () => {
    input.value = "";
    atualizar();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    fechar();
    trigger.focus();
  };

  const renderGrade = () => {
    if (!pop) return;
    const grade = pop.querySelector(".dpGrade");
    const sel = isoParts(input.value);
    const hoje = new Date();
    const inicioSemana = new Date(viewY, viewMo, 1).getDay();
    const diasNoMes = new Date(viewY, viewMo + 1, 0).getDate();
    let html = SEMANA.map(s => `<span class="dpDow">${s}</span>`).join("");
    for (let i = 0; i < inicioSemana; i++) html += `<span class="dpDia dpVazio"></span>`;
    for (let d = 1; d <= diasNoMes; d++) {
      const ehHoje = hoje.getFullYear() === viewY && hoje.getMonth() === viewMo && hoje.getDate() === d;
      const ehSel = sel && sel.y === viewY && sel.mo === viewMo && sel.d === d;
      html += `<button type="button" class="dpDia${ehHoje ? " is-hoje" : ""}${ehSel ? " is-sel" : ""}" data-d="${d}">${d}</button>`;
    }
    grade.innerHTML = html;
  };

  const abrir = () => {
    if (pop) return;
    const sel = isoParts(input.value), hoje = new Date();
    viewY = sel ? sel.y : hoje.getFullYear();
    viewMo = sel ? sel.mo : hoje.getMonth();
    wrap.classList.add("aberto");
    pop = document.createElement("div");
    pop.className = "dpPop";
    pop.innerHTML = `
      <div class="dpHead">
        <button type="button" class="dpNav" data-nav="-1" aria-label="Mês anterior"><i class="fa-solid fa-chevron-left"></i></button>
        <select class="dpMes" data-ss-skip aria-label="Mês">${MESES.map((m, i) => `<option value="${i}"${i === viewMo ? " selected" : ""}>${m}</option>`).join("")}</select>
        <select class="dpAno" data-ss-skip aria-label="Ano">${listaAnos().map(y => `<option value="${y}"${y === viewY ? " selected" : ""}>${y}</option>`).join("")}</select>
        <button type="button" class="dpNav" data-nav="1" aria-label="Próximo mês"><i class="fa-solid fa-chevron-right"></i></button>
      </div>
      <div class="dpGrade"></div>
      <div class="dpAcoes">
        <button type="button" class="dpHoje">Hoje</button>
        <button type="button" class="dpLimpar">Limpar</button>
      </div>`;
    document.body.appendChild(pop);
    renderGrade();
    posicionar();

    pop.querySelector(".dpMes").addEventListener("change", e => { viewMo = +e.target.value; renderGrade(); });
    pop.querySelector(".dpAno").addEventListener("change", e => { viewY = +e.target.value; renderGrade(); });
    pop.querySelectorAll(".dpNav").forEach(b => b.addEventListener("click", () => {
      viewMo += +b.dataset.nav;
      if (viewMo < 0) { viewMo = 11; viewY--; }
      if (viewMo > 11) { viewMo = 0; viewY++; }
      const mes = pop.querySelector(".dpMes"), ano = pop.querySelector(".dpAno");
      if (mes) mes.value = String(viewMo);
      if (ano) ano.value = String(viewY);
      renderGrade();
    }));
    pop.querySelector(".dpGrade").addEventListener("click", e => {
      const b = e.target.closest(".dpDia[data-d]");
      if (b) definir(viewY, viewMo, +b.dataset.d);
    });
    pop.querySelector(".dpHoje").addEventListener("click", () => { const h = new Date(); definir(h.getFullYear(), h.getMonth(), h.getDate()); });
    pop.querySelector(".dpLimpar").addEventListener("click", limpar);

    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    document.addEventListener("mousedown", onDocDown, true);
  };

  const fechar = () => {
    if (pop) { pop.remove(); pop = null; }
    wrap.classList.remove("aberto");
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onResize);
    document.removeEventListener("mousedown", onDocDown, true);
  };

  trigger.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); pop ? fechar() : abrir(); });
  trigger.addEventListener("keydown", e => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!pop) abrir(); }
  });

  // Re-sincroniza o gatilho quando o valor é setado por código (ex.: limpar filtros).
  interceptarValor(input, atualizar);
  input._dpSync = atualizar;
  atualizar();
}

// Encadeia um callback ao setter nativo de .value do <input> (sem quebrar leitura/escrita).
function interceptarValor(input, onSet) {
  if (Object.prototype.hasOwnProperty.call(input, "value")) return;
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  if (!desc || typeof desc.get !== "function" || typeof desc.set !== "function") return;
  Object.defineProperty(input, "value", {
    configurable: true,
    enumerable: false,
    get() { return desc.get.call(this); },
    set(v) { desc.set.call(this, v); onSet(); }
  });
}

// Inputs de data elegíveis: ignora os já convertidos (.dpNativo) e os marcados
// com data-dp-skip (caso algum precise continuar com o calendário nativo).
const DP_SELETOR = 'input[type="date"]:not([data-dp-skip]):not(.dpNativo)';

// Converte TODOS os <input type="date"> de um container de uma vez.
export function tornarDatePickers(raiz, opts = {}) {
  (raiz || document).querySelectorAll(DP_SELETOR).forEach(el => tornarDatePicker(el, opts));
}

// Padroniza TODOS os date pickers do app (filtros, formulários, ações em lote,
// modais), inclusive os criados dinamicamente — observa o DOM para cobri-los.
// Basta chamar uma vez na inicialização.
let _dpObserver = null;
export function ativarDatePickersGlobal(opts = {}) {
  tornarDatePickers(document, opts);
  if (_dpObserver || typeof MutationObserver === "undefined") return;
  _dpObserver = new MutationObserver(muts => {
    for (const m of muts) {
      m.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        if (node.matches && node.matches(DP_SELETOR)) tornarDatePicker(node, opts);
        if (node.querySelectorAll) node.querySelectorAll(DP_SELETOR).forEach(el => tornarDatePicker(el, opts));
      });
    }
  });
  _dpObserver.observe(document.body, { childList: true, subtree: true });
}
