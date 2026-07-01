// =========================================================
// Assistente Virtual (robô flutuante)
// - Aparece em TODAS as abas (fica no <body>, fora de .app,
//   que é escalado no modo painel fixo). A visibilidade
//   espelha a de .app: some no login/pendente/sem acesso.
// - Arrastável para qualquer ponto da tela; a posição é
//   persistida em localStorage.
// - De início apenas RECEBE feedback (POST /api/feedback).
//   O painel de conversa já está preparado para, no futuro,
//   ajudar o usuário e responder perguntas.
// Registrado no init do app via configurarAssistente().
// =========================================================
import { apiPost } from "./api.js";
import { escapeHtml } from "./utils.js";
import { state } from "./state.js";

const POS_KEY = "assistente:pos";
const LIMITE_BORDA = 8; // respiro mínimo entre o robô e as bordas da janela

const $ = id => document.getElementById(id);

let enviando = false;

// ---------- Persistência da posição ----------
function salvarPosicao(left, top) {
  try { localStorage.setItem(POS_KEY, JSON.stringify({ left, top })); } catch (e) { }
}

function lerPosicao() {
  try {
    const bruto = localStorage.getItem(POS_KEY);
    if (!bruto) return null;
    const p = JSON.parse(bruto);
    if (p && Number.isFinite(p.left) && Number.isFinite(p.top)) return p;
  } catch (e) { }
  return null;
}

// Mantém o robô dentro da área visível (ex.: após redimensionar a janela).
function limitar(left, top, root) {
  const largura = root.offsetWidth || 60;
  const altura = root.offsetHeight || 60;
  const maxLeft = window.innerWidth - largura - LIMITE_BORDA;
  const maxTop = window.innerHeight - altura - LIMITE_BORDA;
  return {
    left: Math.max(LIMITE_BORDA, Math.min(left, maxLeft)),
    top: Math.max(LIMITE_BORDA, Math.min(top, maxTop))
  };
}

function aplicarPosicao(root, left, top) {
  const { left: l, top: t } = limitar(left, top, root);
  root.style.left = `${l}px`;
  root.style.top = `${t}px`;
  root.style.right = "auto";
  root.style.bottom = "auto";
}

function restaurarPosicao(root) {
  const pos = lerPosicao();
  if (pos) aplicarPosicao(root, pos.left, pos.top);
}

// ---------- Arrasto (Pointer Events) ----------
// Move o container inteiro. Diferencia clique de arrasto: um deslocamento
// pequeno é tratado como clique (abre/fecha o painel a partir do robô).
function configurarArrasto(root, alcaHandles, aoClicar) {
  let arrastando = false;
  let moveu = false;
  let startX = 0, startY = 0;
  let baseLeft = 0, baseTop = 0;

  function onDown(ev) {
    // Não inicia arrasto ao clicar em botões internos (minimizar, enviar, etc.).
    if (ev.target.closest("button") && !ev.target.closest("[data-arrasto-alca]")) return;
    if (ev.button != null && ev.button !== 0) return;

    arrastando = true;
    moveu = false;
    const rect = root.getBoundingClientRect();
    baseLeft = rect.left;
    baseTop = rect.top;
    startX = ev.clientX;
    startY = ev.clientY;
    try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch (e) { }
  }

  function onMove(ev) {
    if (!arrastando) return;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (!moveu && Math.hypot(dx, dy) > 6) {
      moveu = true;
      root.classList.add("is-arrastando");
    }
    if (moveu) {
      ev.preventDefault();
      aplicarPosicao(root, baseLeft + dx, baseTop + dy);
    }
  }

  function onUp(ev, alca) {
    if (!arrastando) return;
    arrastando = false;
    root.classList.remove("is-arrastando");
    try { ev.currentTarget.releasePointerCapture(ev.pointerId); } catch (e) { }

    if (moveu) {
      const rect = root.getBoundingClientRect();
      salvarPosicao(rect.left, rect.top);
    } else if (alca === "fab" && typeof aoClicar === "function") {
      aoClicar();
    }
  }

  alcaHandles.forEach(({ el, alca }) => {
    if (!el) return;
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", ev => onUp(ev, alca));
    el.addEventListener("pointercancel", ev => onUp(ev, alca));
  });

  // Reposiciona para dentro da janela ao redimensionar.
  window.addEventListener("resize", () => {
    const rect = root.getBoundingClientRect();
    aplicarPosicao(root, rect.left, rect.top);
  });
}

// ---------- Painel ----------
// Define de que lado o painel abre para nunca sair da janela: acima/abaixo e
// alinhado à esquerda/direita, conforme a posição do robô na tela.
function definirDirecaoAbertura(root) {
  const rect = root.getBoundingClientRect();
  const centroY = rect.top + rect.height / 2;
  const centroX = rect.left + rect.width / 2;
  root.classList.toggle("abre-baixo", centroY < window.innerHeight / 2);
  root.classList.toggle("abre-cima", centroY >= window.innerHeight / 2);
  root.classList.toggle("abre-dir", centroX < window.innerWidth / 2);
  root.classList.toggle("abre-esq", centroX >= window.innerWidth / 2);
}

function alternarPainel(root, painel, fab) {
  if (!painel) return;
  const abrir = painel.hidden;
  if (abrir) definirDirecaoAbertura(root);
  painel.hidden = !abrir;
  if (fab) fab.setAttribute("aria-expanded", String(abrir));
  if (abrir) {
    const corpo = $("assistenteCorpo");
    if (corpo) corpo.scrollTop = corpo.scrollHeight;
    const input = $("assistenteInput");
    if (input) setTimeout(() => input.focus(), 60);
  }
}

// ---------- Mensagens ----------
function adicionarMensagem(texto, autor) {
  const corpo = $("assistenteCorpo");
  if (!corpo) return;
  const div = document.createElement("div");
  div.className = `assistenteMsg ${autor === "user" ? "is-user" : "is-bot"}`;
  div.innerHTML = escapeHtml(texto);
  corpo.appendChild(div);
  corpo.scrollTop = corpo.scrollHeight;
}

function mensagemBoasVindas() {
  const corpo = $("assistenteCorpo");
  if (!corpo || corpo.childElementCount) return;
  adicionarMensagem(
    "Olá! Sou o assistente virtual do painel. 👋\n\nPor enquanto estou aqui para ouvir você: escreva abaixo sua sugestão, crítica ou dúvida sobre o sistema e envie. Em breve poderei ajudar a usar o sistema e responder perguntas.",
    "bot"
  );
}

// ---------- Envio de feedback ----------
async function enviarFeedback(ev) {
  if (ev) ev.preventDefault();
  if (enviando) return;

  const input = $("assistenteInput");
  const botao = $("assistenteEnviar");
  const mensagem = (input && input.value ? input.value : "").trim();
  if (!mensagem) return;

  adicionarMensagem(mensagem, "user");
  if (input) { input.value = ""; input.style.height = "auto"; }

  enviando = true;
  if (botao) botao.disabled = true;

  try {
    await apiPost("/api/feedback", { mensagem, origem: state.activeView || "" });
    adicionarMensagem("Recebi seu feedback, obrigado! Ele foi registrado e ajuda a melhorar o painel. 🙌", "bot");
  } catch (erro) {
    adicionarMensagem(
      `Não consegui registrar agora (${erro && erro.message ? erro.message : "falha de conexão"}). Tente novamente em instantes.`,
      "bot"
    );
  } finally {
    enviando = false;
    if (botao) botao.disabled = false;
    if (input) input.focus();
  }
}

// Textarea que cresce com o conteúdo (até o teto definido no CSS).
function autoAjustarAltura(input) {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 110)}px`;
}

// A visibilidade do assistente acompanha a de .app (some no login / tela de
// pendente / sem acesso, aparece no painel). Espelhar por MutationObserver
// mantém o módulo desacoplado do fluxo de autenticação.
function acompanharVisibilidadeApp(root) {
  const app = document.querySelector(".app");
  if (!app) { root.hidden = false; return; }
  const sincronizar = () => {
    root.hidden = getComputedStyle(app).display === "none";
  };
  sincronizar();
  new MutationObserver(sincronizar).observe(app, { attributes: true, attributeFilter: ["style", "class"] });
}

export function configurarAssistente() {
  const root = $("assistenteVirtual");
  if (!root || root.dataset.bound) return;
  root.dataset.bound = "1";

  const fab = $("assistenteFab");
  const painel = $("assistentePainel");
  const header = $("assistenteHeader");
  const minimizar = $("assistenteMinimizar");
  const form = $("assistenteForm");
  const input = $("assistenteInput");

  restaurarPosicao(root);
  acompanharVisibilidadeApp(root);

  configurarArrasto(
    root,
    [{ el: fab, alca: "fab" }, { el: header, alca: "header" }],
    () => alternarPainel(root, painel, fab)
  );

  if (minimizar) minimizar.addEventListener("click", () => alternarPainel(root, painel, fab));
  if (form) form.addEventListener("submit", enviarFeedback);

  if (input) {
    input.addEventListener("input", () => autoAjustarAltura(input));
    input.addEventListener("keydown", ev => {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        enviarFeedback();
      }
    });
  }

  mensagemBoasVindas();
}
