// Dropdown customizado com glassmorphism para os <select> da tela de acesso.
//
// O <select> nativo permanece no DOM como única fonte de dados: a lógica de
// acesso.js continua lendo `.value`, escutando 'change' e repopulando <option>s
// normalmente. Este módulo apenas oculta o <select> e desenha, por cima, um
// gatilho (campo fechado) + um menu de opções translúcido (vidro/blur), que a
// lista nativa do navegador não permite estilizar.

// Conjunto de menus abertos para podermos fechar todos ao clicar fora.
const aprimorados = [];

function fecharTodos(exceto) {
  aprimorados.forEach(w => { if (w !== exceto && w._glassFechar) w._glassFechar(); });
}

function montarGlassSelect(select) {
  if (select.dataset.glass === "1") return;
  select.dataset.glass = "1";

  // Estrutura: .glassSelect > (select nativo oculto + trigger + menu)
  const wrap = document.createElement("div");
  wrap.className = "glassSelect";
  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(select);
  select.classList.add("glassSelectNative");
  select.setAttribute("tabindex", "-1");
  select.setAttribute("aria-hidden", "true");
  aprimorados.push(wrap);

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "glassSelectTrigger loginInput";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.innerHTML =
    '<span class="glassSelectLabel"></span>' +
    '<i class="fa-solid fa-chevron-down glassSelectArrow" aria-hidden="true"></i>';
  wrap.appendChild(trigger);

  const menu = document.createElement("div");
  menu.className = "glassSelectMenu";
  menu.setAttribute("role", "listbox");
  // Portal: o menu vive no <body>, fora do card, para não ser recortado pelo
  // overflow/backdrop-filter do .acessoCard. É posicionado via JS (position:fixed).
  document.body.appendChild(menu);

  const label = trigger.querySelector(".glassSelectLabel");

  function opcaoAtual() { return select.options[select.selectedIndex] || null; }

  // Reflete o valor atual do <select> no gatilho (rótulo + estado placeholder).
  function sincronizar() {
    const opt = opcaoAtual();
    label.textContent = opt ? opt.textContent : "";
    if (!opt || opt.value === "") trigger.setAttribute("data-placeholder", "");
    else trigger.removeAttribute("data-placeholder");
  }

  // (Re)constrói o menu a partir das <option>s atuais do <select> — assim
  // captura listas carregadas de forma assíncrona e a opção "Outro".
  function construirMenu() {
    menu.innerHTML = "";
    Array.from(select.options).forEach((opt, i) => {
      const item = document.createElement("div");
      item.className = "glassSelectOption";
      item.setAttribute("role", "option");
      item.textContent = opt.textContent;
      item.dataset.value = opt.value;
      if (opt.value === "") item.classList.add("isPlaceholder");
      if (i === select.selectedIndex) {
        item.classList.add("isSelected");
        item.setAttribute("aria-selected", "true");
      }
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        if (select.value !== opt.value) {
          select.value = opt.value;
          // Dispara 'change' para que a lógica existente reaja (ex.: campo "Outro").
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
        sincronizar();
        fechar();
      });
      menu.appendChild(item);
    });
  }

  // Posiciona o menu como `position: fixed` ancorado ao gatilho, para que ele
  // escape do recorte (overflow) do card. Abre para cima quando falta espaço abaixo.
  const ALTURA_MAX = 244;
  function posicionarMenu() {
    const r = trigger.getBoundingClientRect();
    const vh = window.innerHeight;
    const espacoAbaixo = vh - r.bottom;
    const espacoAcima = r.top;
    menu.style.position = "fixed";
    menu.style.left = r.left + "px";
    menu.style.width = r.width + "px";
    menu.style.right = "auto";
    const abrirAcima = espacoAbaixo < Math.min(ALTURA_MAX, 180) && espacoAcima > espacoAbaixo;
    if (abrirAcima) {
      menu.style.maxHeight = Math.min(ALTURA_MAX, espacoAcima - 12) + "px";
      menu.style.top = "auto";
      menu.style.bottom = (vh - r.top + 6) + "px";
      menu.style.transformOrigin = "bottom";
    } else {
      menu.style.maxHeight = Math.min(ALTURA_MAX, espacoAbaixo - 12) + "px";
      menu.style.bottom = "auto";
      menu.style.top = (r.bottom + 6) + "px";
      menu.style.transformOrigin = "top";
    }
  }

  function reposicionar() { if (wrap.classList.contains("open")) posicionarMenu(); }

  function abrir() {
    fecharTodos(wrap);
    construirMenu();
    wrap.classList.add("open");   // arrow girada / foco no gatilho
    menu.classList.add("open");   // visibilidade do menu (no body)
    posicionarMenu();
    // Mantém o menu colado ao gatilho enquanto o card/janela rolam ou redimensionam.
    window.addEventListener("scroll", reposicionar, true);
    window.addEventListener("resize", reposicionar);
    const sel = menu.querySelector(".isSelected");
    if (sel) sel.scrollIntoView({ block: "nearest" });
  }

  function fechar() {
    wrap.classList.remove("open");
    menu.classList.remove("open");
    window.removeEventListener("scroll", reposicionar, true);
    window.removeEventListener("resize", reposicionar);
  }
  wrap._glassFechar = fechar;

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (wrap.classList.contains("open")) fechar();
    else abrir();
  });
  trigger.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); trigger.click(); }
    else if (e.key === "Escape") fechar();
  });

  // Mudanças de valor (usuário ou programáticas que disparem 'change') atualizam o rótulo.
  select.addEventListener("change", sincronizar);

  // Guarda o sincronizador no wrap para re-sync em massa (ver observador abaixo).
  wrap._glassSync = sincronizar;

  sincronizar();
}

// Re-sincroniza todos os rótulos. Necessário porque preencherForm()/setVal() em
// acesso.js definem `select.value` SEM disparar 'change'.
let pendenteSync = false;
function agendarSyncTodos() {
  if (pendenteSync) return;
  pendenteSync = true;
  Promise.resolve().then(() => {
    pendenteSync = false;
    aprimorados.forEach(w => { if (w._glassSync) w._glassSync(); });
  });
}

let observador = null;
let fechamentoExterno = false;

export function configurarGlassDropdowns(raiz) {
  const card = raiz || document.querySelector(".acessoCard");
  if (!card) return;

  card.querySelectorAll("select.loginInput").forEach(montarGlassSelect);

  // Fecha qualquer menu ao clicar fora dos dropdowns.
  if (!fechamentoExterno) {
    fechamentoExterno = true;
    document.addEventListener("click", () => fecharTodos());
  }

  // Valores definidos por código (preencherForm/setVal) não emitem 'change'. Mas
  // o preenchimento vem sempre seguido de aplicarTipoAcesso(), que alterna
  // [hidden] nos .acField e .active nas abas — mutações de atributo no card.
  // Observamos só atributos (não childList, que entraria em loop com a
  // reconstrução do menu) e re-sincronizamos os rótulos de forma debounced.
  if (!observador) {
    observador = new MutationObserver(agendarSyncTodos);
    observador.observe(card, {
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "class", "style"],
    });
  }
}
