// Input de arquivo padronizado (design system): botão "Selecionar arquivos" +
// área de estado (placeholder, chips de arquivo com remover, overflow "+N",
// desabilitado, aviso/erro e barra de progresso).
//
// Mantém o <input type="file"> nativo como FONTE DE VERDADE: a seleção continua
// vindo do input (dispara 'change'); a remoção de um arquivo reconstrói o
// FileList via DataTransfer. Assim os handlers/formulários existentes não mudam.
//
// Opt-in: só enha inputs marcados com [data-file-input]. Personalização por
// data-attribute: data-fi-botao (texto do botão) e data-fi-placeholder.
import { escapeHtml, escapeAttr } from "./utils.js";

const MAX_CHIPS = 2; // chips visíveis antes de agrupar o restante em "+N"

export function tornarFileInput(input, opts = {}) {
  if (!input || input.dataset.fiEnhanced === "1") return;
  if ((input.type || "").toLowerCase() !== "file") return;
  input.dataset.fiEnhanced = "1";

  const textoBtn = opts.botao || input.dataset.fiBotao || "Selecionar arquivos";
  const placeholder = opts.placeholder || input.dataset.fiPlaceholder || "Nenhum arquivo selecionado";

  const wrap = document.createElement("div");
  wrap.className = "fiField";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "fiBtn";
  btn.innerHTML = `<i class="fa-solid fa-paperclip" aria-hidden="true"></i> <span>${escapeHtml(textoBtn)}</span>`;

  const area = document.createElement("div");
  area.className = "fiArea";

  // Insere o wrapper, move o input nativo pra dentro (oculto) e monta botão+área.
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(btn);
  wrap.appendChild(area);
  wrap.appendChild(input);
  input.classList.add("fiNativo");
  input.tabIndex = -1;
  input.setAttribute("aria-hidden", "true");

  const desabilitado = () => input.disabled;

  const render = () => {
    wrap.classList.toggle("is-disabled", desabilitado());
    btn.disabled = desabilitado();

    // Progresso (upload) tem prioridade visual quando ativo.
    if (wrap.dataset.fiProgresso != null) {
      const pct = Math.max(0, Math.min(100, Number(wrap.dataset.fiProgresso) || 0));
      area.innerHTML = `<span class="fiProgresso"><span style="width:${pct}%"></span></span>`;
      wrap.classList.remove("is-erro");
      return;
    }
    // Aviso / erro (controlado por setErro()).
    if (wrap.dataset.fiErro) {
      area.innerHTML = `<span class="fiErro">${escapeHtml(wrap.dataset.fiErro)}</span>`;
      wrap.classList.add("is-erro");
      return;
    }
    wrap.classList.remove("is-erro");

    const files = Array.from(input.files || []);
    if (!files.length) {
      area.innerHTML = `<span class="fiPlaceholder">${escapeHtml(placeholder)}</span>`;
      return;
    }
    const visiveis = files.slice(0, MAX_CHIPS);
    const resto = files.length - visiveis.length;
    const chips = visiveis.map((f, i) =>
      `<span class="fiChip" title="${escapeAttr(f.name)}">
         <span class="fiChipNome">${escapeHtml(f.name)}</span>
         <button type="button" class="fiChipX" data-fi-remove="${i}" aria-label="Remover ${escapeAttr(f.name)}">&times;</button>
       </span>`).join("");
    const mais = resto > 0 ? `<span class="fiMais" title="+${resto} arquivo(s)">+${resto}</span>` : "";
    area.innerHTML = chips + mais;
  };

  const abrir = () => { if (!desabilitado()) input.click(); };

  // Remove um arquivo reconstruindo o FileList (DataTransfer) e re-disparando change.
  const removerIndice = idx => {
    const dt = new DataTransfer();
    Array.from(input.files || []).forEach((f, i) => { if (i !== idx) dt.items.add(f); });
    input.files = dt.files;
    delete wrap.dataset.fiErro;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    render();
  };

  btn.addEventListener("click", abrir);
  area.addEventListener("click", e => {
    const rm = e.target.closest("[data-fi-remove]");
    if (rm) { e.preventDefault(); removerIndice(Number(rm.dataset.fiRemove)); }
  });
  // Seleção pelo usuário limpa erro/progresso e re-renderiza.
  input.addEventListener("change", () => {
    delete wrap.dataset.fiErro;
    delete wrap.dataset.fiProgresso;
    render();
  });

  // API programática (estados que dependem da lógica de cada tela).
  input._fi = {
    // Mostra estado de aviso/erro (texto laranja). null/"" volta ao normal.
    setErro(msg) { if (msg) { wrap.dataset.fiErro = String(msg); delete wrap.dataset.fiProgresso; } else { delete wrap.dataset.fiErro; } render(); },
    // Mostra barra de progresso (0–100). null encerra e volta ao estado de arquivos.
    setProgresso(pct) { if (pct == null) delete wrap.dataset.fiProgresso; else wrap.dataset.fiProgresso = String(pct); render(); },
    // Limpa a seleção.
    limpar() { input.value = ""; delete wrap.dataset.fiErro; delete wrap.dataset.fiProgresso; input.dispatchEvent(new Event("change", { bubbles: true })); render(); },
    render
  };

  render();
}

// Inputs de arquivo elegíveis: marcados com data-file-input e ainda não enhados.
const FI_SELETOR = 'input[type="file"][data-file-input]:not(.fiNativo)';

// Enha todos os inputs marcados de um container.
export function tornarFileInputs(raiz, opts = {}) {
  (raiz || document).querySelectorAll(FI_SELETOR).forEach(el => tornarFileInput(el, opts));
}

// Padroniza os inputs de arquivo marcados do app, inclusive os criados
// dinamicamente (observa o DOM). Basta chamar uma vez na inicialização.
let _fiObserver = null;
export function ativarFileInputsGlobal(opts = {}) {
  tornarFileInputs(document, opts);
  if (_fiObserver || typeof MutationObserver === "undefined") return;
  _fiObserver = new MutationObserver(muts => {
    for (const m of muts) {
      m.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        if (node.matches && node.matches(FI_SELETOR)) tornarFileInput(node, opts);
        if (node.querySelectorAll) node.querySelectorAll(FI_SELETOR).forEach(el => tornarFileInput(el, opts));
      });
    }
  });
  _fiObserver.observe(document.body, { childList: true, subtree: true });
}
