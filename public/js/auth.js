import { apiGet, apiPost } from "./api.js";
import { carregarDadosInicial, configurarAutoAtualizacao } from "./app.js";
import { state } from "./state.js";
import { mostrarAcessoPendente } from "./acesso.js";

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
  // A sessão vive num cookie HttpOnly enviado automaticamente. Tenta validar
  // direto no servidor: se o cookie existir e for válido, entra; senão, login.
  try {
    const payload = await apiGet("/api/sessao");
    state.painelLoginUsuario = payload.usuario || null;
    iniciarPainelAutenticado();
    return;
  } catch (e) {
    state.painelLoginUsuario = null;
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
    state.painelLoginUsuario = payload.usuario || null;

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
    state.painelLoginUsuario = payload.usuario || null;

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
  const loading = document.getElementById("loading");
  if (loading) loading.style.display = "none";
  const login = document.getElementById("loginScreen");
  if (login) login.style.display = "none";

  // Mantém a sessão sincronizada com o banco (vale para pendente e aprovado):
  // se o usuário for excluído -> logout; se for aprovado enquanto espera -> entra sozinho.
  iniciarHeartbeatSessao();

  // Usuário autenticado, porém SEM acesso aprovado: vai para a tela de
  // solicitação/acompanhamento de acesso, e não para o painel.
  const aprovado = !!(state.painelLoginUsuario && state.painelLoginUsuario.aprovado);
  if (!aprovado) {
    mostrarAcessoPendente();
    return;
  }

  const app = document.querySelector(".app");
  if (app) app.style.display = "";

  aplicarPermissoesUsuario();

  if (state.painelIniciado) return;
  state.painelIniciado = true;

  configurarAutoAtualizacao();
  carregarDadosInicial();
}

// Esconde/mostra um item de menu. Para ESCONDER usa display:none inline com
// !important — necessário porque há regras como `body.modoPainelFixo .navItem
// { display: grid !important }` (Visão Geral) que, de outra forma, reexibiriam o item.
function definirVisibilidadeNav(elemento, visivel) {
  if (!elemento) return;
  if (visivel) elemento.style.removeProperty("display");
  else elemento.style.setProperty("display", "none", "important");
}

export function aplicarPermissoesUsuario() {
  const nivel = state.painelLoginUsuario ? Number(state.painelLoginUsuario.nivelAutorizacao || 0) : 0;

  // Nível 0: sem acesso à página de Remanejamento (oculta o menu).
  definirVisibilidadeNav(document.querySelector('.navItem[data-view="remanejamento"]'), nivel >= 1);

  // Aba de gestão de solicitações de acesso: apenas administradores (nível >= 2).
  definirVisibilidadeNav(document.querySelector('.navItem[data-view="solicitacoes"]'), nivel >= 2);

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

// Heartbeat: revalida a sessão no servidor periodicamente.
// - Usuário excluído / sessão inválida  -> logout automático.
// - Mudança de aprovação (ex.: liberado enquanto esperava, ou desativado)
//   -> recarrega para re-rotear (entra no painel ou volta para a tela pendente).
let heartbeatTimer = null;
function iniciarHeartbeatSessao() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(verificarMudancaSessao, 10000);
}

async function verificarMudancaSessao() {
  let usuario = null;
  try {
    const resp = await apiGet("/api/sessao");
    usuario = resp && resp.usuario ? resp.usuario : null;
  } catch (e) {
    usuario = null; // 401 (excluído/sessão inválida) cai aqui
  }

  if (!usuario) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    logoutPainel();
    return;
  }

  const anterior = state.painelLoginUsuario || {};
  const mudouAprovacao = !!usuario.aprovado !== !!anterior.aprovado;
  const mudouNivel = Number(usuario.nivelAutorizacao || 0) !== Number(anterior.nivelAutorizacao || 0);
  if (mudouAprovacao || mudouNivel) {
    // Status ou privilégio mudou (ex.: aprovado enquanto esperava, virou/deixou de ser admin).
    state.painelLoginUsuario = usuario;
    window.location.reload();
  }
}

export async function logoutPainel() {
  state.painelLoginToken = "";
  state.painelLoginUsuario = null;
  // Limpa o cookie HttpOnly no servidor antes de recarregar.
  try { await apiPost("/api/logout", {}); } catch (e) { }
  try { localStorage.removeItem("painelLoginToken"); } catch (e) { } // limpa resíduo de versões antigas
  window.location.reload();
}
