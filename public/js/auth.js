import { apiGet, apiPost } from "./api.js";
import { carregarDadosInicial, configurarAutoAtualizacao } from "./app.js";
import { state } from "./state.js";

export function configurarLogin() {
  const form = document.getElementById("loginForm");
  if (form && !form.dataset.bound) {
    form.dataset.bound = "1";
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      realizarLoginPainel();
    });
  }
}

export async function verificarSessaoInicial() {
  try {
    state.painelLoginToken = localStorage.getItem("painelLoginToken") || "";
  } catch (e) {
    state.painelLoginToken = "";
  }

  if (state.painelLoginToken) {
    try {
      const payload = await apiGet("/api/sessao");
      state.painelLoginUsuario = payload.usuario || null;
      iniciarPainelAutenticado();
      return;
    } catch (e) {
      state.painelLoginToken = "";
      state.painelLoginUsuario = null;
    }
  }

  mostrarLoginOverlay();
}

export function mostrarLoginOverlay() {
  const loading = document.getElementById("loading");
  if (loading) loading.style.display = "none";
  const login = document.getElementById("loginScreen");
  if (login) login.style.display = "grid";
  const app = document.querySelector(".app");
  if (app) app.style.display = "none";
  const usuarioInput = document.getElementById("loginUsuario");
  if (usuarioInput) setTimeout(() => usuarioInput.focus(), 0);
  configurarLoginGoogle();
}

// Inicializa o Google Identity Services e renderiza o botão "Entrar com Google".
// Só aparece quando o servidor expõe um googleClientId (GOOGLE_CLIENT_ID no .env).
function configurarLoginGoogle() {
  const clientId = state.googleClientId;
  const wrap = document.getElementById("loginGoogleWrap");
  if (!clientId || !wrap || wrap.dataset.bound) return;

  const tentar = () => {
    const gid = window.google && window.google.accounts && window.google.accounts.id;
    if (!gid) { setTimeout(tentar, 200); return; } // GIS carrega async; aguarda ficar pronto
    gid.initialize({ client_id: clientId, callback: onGoogleCredential });
    const btn = document.getElementById("googleBtn");
    if (btn) {
      gid.renderButton(btn, { theme: "outline", size: "large", text: "signin_with", locale: "pt-BR" });
    }
    wrap.dataset.bound = "1";
    wrap.style.display = "";
  };
  tentar();
}

async function onGoogleCredential(resposta) {
  const erro = document.getElementById("loginErro");
  if (erro) erro.innerText = "";
  try {
    const payload = await apiPost("/api/login/google", { credential: resposta && resposta.credential });
    state.painelLoginToken = payload.token || "";
    state.painelLoginUsuario = payload.usuario || null;
    try { localStorage.setItem("painelLoginToken", state.painelLoginToken); } catch (e) { }

    const login = document.getElementById("loginScreen");
    if (login) login.style.display = "none";
    const app = document.querySelector(".app");
    if (app) app.style.display = "";

    iniciarPainelAutenticado();
  } catch (error) {
    if (erro) erro.innerText = error && error.message ? error.message : "Falha ao entrar com Google.";
  }
}

export async function realizarLoginPainel() {
  const usuario = document.getElementById("loginUsuario")?.value || "";
  const senha = document.getElementById("loginSenha")?.value || "";
  const btn = document.getElementById("loginBtn");
  const erro = document.getElementById("loginErro");

  if (erro) erro.innerText = "";
  if (!usuario.trim() || !senha) {
    if (erro) erro.innerText = "Informe usuário e senha.";
    return;
  }

  if (btn) btn.disabled = true;

  try {
    const payload = await apiPost("/api/login", { login: usuario, senha });
    state.painelLoginToken = payload.token || "";
    state.painelLoginUsuario = payload.usuario || null;
    try { localStorage.setItem("painelLoginToken", state.painelLoginToken); } catch (e) { }

    const senhaInput = document.getElementById("loginSenha");
    if (senhaInput) senhaInput.value = "";

    const login = document.getElementById("loginScreen");
    if (login) login.style.display = "none";
    const app = document.querySelector(".app");
    if (app) app.style.display = "";

    iniciarPainelAutenticado();
  } catch (error) {
    if (erro) erro.innerText = error && error.message ? error.message : "Falha ao entrar.";
  } finally {
    if (btn) btn.disabled = false;
  }
}

export function iniciarPainelAutenticado() {
  // Garante que o painel fique visível em qualquer fluxo de entrada
  // (login por senha, login Google ou sessão restaurada por token).
  const loading = document.getElementById("loading");
  if (loading) loading.style.display = "none";
  const login = document.getElementById("loginScreen");
  if (login) login.style.display = "none";
  const app = document.querySelector(".app");
  if (app) app.style.display = "";

  aplicarPermissoesUsuario();

  if (state.painelIniciado) return;
  state.painelIniciado = true;

  configurarAutoAtualizacao();
  carregarDadosInicial();
}

export function aplicarPermissoesUsuario() {
  const nivel = state.painelLoginUsuario ? Number(state.painelLoginUsuario.nivelAutorizacao || 0) : 0;

  // Nível 0: sem acesso à página de Remanejamento (oculta o menu).
  const navRemanejamento = document.querySelector('.navItem[data-view="remanejamento"]');
  if (navRemanejamento) navRemanejamento.style.display = nivel >= 1 ? "" : "none";

  // Nível 1: pode visualizar, mas o botão salvar fica desabilitado. Nível 2: libera tudo.
  const btnSalvar = document.getElementById("remSaveBtn");
  if (btnSalvar) {
    const podeSalvar = nivel >= 2;
    btnSalvar.disabled = !podeSalvar;
    btnSalvar.title = podeSalvar ? "" : "Você não tem permissão para salvar remanejamentos.";
  }

  // Se o usuário sem acesso estiver na aba de remanejamento, volta para a Visão Geral.
  if (nivel < 1 && state.activeView === "remanejamento") {
    const navVisao = document.querySelector('.navItem[data-view="visaoGeral"]');
    if (navVisao) navVisao.click();
  }

  const wrap = document.getElementById("sidebarUsuario");
  const nome = document.getElementById("sidebarUsuarioNome");
  if (wrap) wrap.style.display = state.painelLoginUsuario ? "" : "none";
  if (nome && state.painelLoginUsuario) {
    nome.innerText = state.painelLoginUsuario.nome || state.painelLoginUsuario.login || "";
  }
}

export function logoutPainel() {
  state.painelLoginToken = "";
  state.painelLoginUsuario = null;
  try { localStorage.removeItem("painelLoginToken"); } catch (e) { }
  window.location.reload();
}
