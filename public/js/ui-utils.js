// =========================================================
// Utilitários de UI compartilhados entre as abas de feature.
// Reúne padrões que estavam duplicados quase idênticos em
// vários módulos (toast, preenchimento de <select> de filtro).
// Sem estado global: cada chamada opera sobre o elemento passado.
// =========================================================
import { escapeHtml, escapeAttr } from "./utils.js";

export const byId = id => document.getElementById(id);

// Cria um controlador de toast reutilizável. Cada aba tem seu próprio elemento
// (#gdToast / #ecToast / #gfToast) e classe CSS, mas o comportamento é o mesmo:
// mostra a mensagem, alterna is-ok/is-erro e remove a classe `show` depois de
// `duracaoMs`. O elemento é criado sob demanda no <body> se ainda não existir.
export function criarToast(id, { className = id, duracaoMs = 3200 } = {}) {
  let timer = null;
  return function toast(mensagem, tipo) {
    let el = byId(id);
    if (!el) {
      el = document.createElement("div");
      el.id = id;
      el.className = className;
      document.body.appendChild(el);
    }
    el.textContent = mensagem;
    el.classList.remove("is-erro", "is-ok");
    el.classList.add(tipo === "erro" ? "is-erro" : "is-ok", "show");
    clearTimeout(timer);
    timer = setTimeout(() => el.classList.remove("show"), duracaoMs);
  };
}

// Preenche um <select> de filtro preservando a seleção atual quando ela ainda
// existir entre as novas opções. A primeira opção é sempre o rótulo "todos/
// placeholder" (value vazio). Aceita o elemento ou o id. Os valores recebem
// escapeAttr no atributo e escapeHtml no texto.
export function preencherSelect(elOuId, valores, rotuloTodos) {
  const node = typeof elOuId === "string" ? byId(elOuId) : elOuId;
  if (!node || node.tagName !== "SELECT") return;
  const atual = node.value;
  const lista = valores || [];
  node.innerHTML = `<option value="">${escapeHtml(rotuloTodos)}</option>` +
    lista.map(v => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`).join("");
  if (atual && lista.some(v => String(v) === atual)) node.value = atual;
}
