import { apiGet, apiPost } from "./api.js";
import { carregarDadosInicial } from "./app.js";
import { state } from "./state.js";
import { mostrarAcessoPendente } from "./acesso.js";
import { atualizarPermissaoGestaoDisciplinar } from "./gestao-disciplinar.js";
import { aplicarPermissoesModulos, nivelModulo, podeVerPerfis, temAlgumModuloVisivel } from "./permissoes.js";
import { aplicarCamposMesesRemanejamento } from "./remanejamento.js";

export function configurarLogin() {
  // Login por usuário/senha (o botão do Google é renderizado à parte em
  // configurarLoginGoogle(), quando GOOGLE_CLIENT_ID está configurado).
  const formLogin = document.getElementById("loginSenhaForm");
  if (formLogin && !formLogin.dataset.bound) {
    formLogin.dataset.bound = "1";
    formLogin.addEventListener("submit", realizarLoginPainel);
  }
  // "Criar conta": usuário sem cadastro vai direto para a tela de solicitação de
  // acesso, onde informa seus dados e define a senha (cadastro fica pendente).
  const criar = document.getElementById("loginCriarConta");
  if (criar && !criar.dataset.bound) {
    criar.dataset.bound = "1";
    criar.addEventListener("click", (ev) => { ev.preventDefault(); mostrarAcessoPendente(true); });
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
      gid.renderButton(btn, {
        theme: "outline",
        size: "large",
        text: "signin_with",
        shape: "rectangular",
        logo_alignment: "left",
        locale: "pt-BR",
        width: 340
      });
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

export async function realizarLoginPainel(ev) {
  if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
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
  // Esconde as abas marcadas como "Sem acesso" na matriz de perfis e, se a aba
  // ativa ficou inacessível, redireciona para a primeira aba visível.
  aplicarPermissoesModulos();

  // Aba de Solicitações / Perfis de Acesso: definida pelo nível do módulo
  // "solicitacoes" (a própria matriz pode rebaixar/ocultar de um super admin).
  // É a regra mandatória de acesso à administração de permissões.
  definirVisibilidadeNav(document.querySelector('.navItem[data-view="solicitacoes"]'), podeVerPerfis());

  // Edição de remanejamento exige permissão de Editor (nível >= 2) NO MÓDULO.
  const nivelRemanejamento = nivelModulo("remanejamento");
  const podeSalvarRemanejamento = nivelRemanejamento >= 2;

  // Leitor não salva: o card "5. Documentação do Remanejamento" (Processo SEI,
  // observação, anexo e botão Salvar) fica oculto para ele. O backend também
  // bloqueia o POST /api/remanejamento/salvar por permissão de módulo.
  const docBox = document.getElementById("remDocBox");
  if (docBox) {
    docBox.style.display = podeSalvarRemanejamento ? "" : "none";
    // Sem o bloco 5, a grade de baixo passa a ser de coluna única para que o
    // bloco 4 ("4. Impacto") ocupe toda a largura, sem deixar o vão vazio.
    const remBottomGrid = docBox.parentElement;
    if (remBottomGrid) remBottomGrid.classList.toggle("remBottomGridSemDoc", !podeSalvarRemanejamento);
  }

  const btnSalvar = document.getElementById("remSaveBtn");
  if (btnSalvar) {
    btnSalvar.disabled = !podeSalvarRemanejamento;
    btnSalvar.title = podeSalvarRemanejamento ? "" : "Você não tem permissão para salvar remanejamentos.";
  }

  // "Mês do remanejamento" (e, no modo ajuste, o "Nº de meses") só aparecem para
  // Administrador do módulo (nível 3), mesmo nível que pode alterar remanejamentos
  // existentes. Qual dos dois aparece fica com aplicarCamposMesesRemanejamento, chamada
  // no fim deste bloco — depois de um eventual rebaixamento desligar o modo ajuste.
  state.remanejamentoPodeEscolherMeses = nivelRemanejamento >= 3;

  // Ajustes pontuais (movimentações sem processo) são exclusivos do Administrador
  // do módulo (nível 3). Os botões só aparecem para ele.
  const ehAdminRem = nivelRemanejamento >= 3;
  const btnAjuste = document.getElementById("remAjusteToggleBtn");
  const btnVerAjustes = document.getElementById("remVerAjustesBtn");
  if (btnAjuste) btnAjuste.style.display = ehAdminRem ? "" : "none";
  if (btnVerAjustes) btnVerAjustes.style.display = ehAdminRem ? "" : "none";
  // Rebaixado no meio da sessão: garante que o modo ajuste não fique preso ligado.
  if (!ehAdminRem && state.remanejamentoAjusteAtivo) {
    state.remanejamentoAjusteAtivo = false;
    document.getElementById("remEditArea")?.classList.remove("remAjusteModo");
    const banner = document.getElementById("remAjusteBanner");
    if (banner) banner.style.display = "none";
    document.getElementById("remDocBox")?.classList.remove("remDocBloqueado");
    ["remanejamentoProcessoSei", "remObservacao", "remAnexoArquivo"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = false;
    });
    const btnSalvar = document.getElementById("remSaveBtn");
    if (btnSalvar) btnSalvar.textContent = "Salvar Remanejamento";
  }
  aplicarCamposMesesRemanejamento();

  // Processos Seletivos: "Adicionar edital" exige Editor (>= 2). Leitor não vê o
  // botão (os botões Editar/Inserir anexo do detalhe são ocultados no render do
  // módulo; o backend bloqueia a extração de anexo por permissão).
  const btnAddEdital = document.getElementById("psBtnAddEdital");
  if (btnAddEdital) btnAddEdital.style.display = nivelModulo("processosSeletivos") >= 2 ? "" : "none";

  const wrap = document.getElementById("sidebarUsuario");
  const nome = document.getElementById("sidebarUsuarioNome");
  if (wrap) wrap.style.display = state.painelLoginUsuario ? "" : "none";
  if (nome && state.painelLoginUsuario) {
    nome.innerText = state.painelLoginUsuario.nome || state.painelLoginUsuario.login || "";
  }

  // O nível recém-carregado pode liberar a edição na Gestão Disciplinar: re-renderiza
  // o detalhamento para refletir a permissão (resolve o caso do 1º acesso).
  atualizarPermissaoGestaoDisciplinar();

  // Sem acesso a NENHUMA aba: mostra a tela de aviso no lugar do painel.
  const temAcesso = temAlgumModuloVisivel();
  const telaSemAcesso = document.getElementById("semAcessoScreen");
  const app = document.querySelector(".app");
  if (telaSemAcesso) telaSemAcesso.style.display = temAcesso ? "none" : "grid";
  if (app) app.style.display = temAcesso ? "" : "none";
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
  const mudouPermissoes = JSON.stringify(usuario.permissoes || {}) !== JSON.stringify(anterior.permissoes || {});
  // Escopo de DSEI (acesso por unidade) também deve refletir na hora, como as abas.
  const mudouEscopo = JSON.stringify(usuario.escopo || {}) !== JSON.stringify(anterior.escopo || {});
  if (mudouAprovacao || mudouPermissoes || mudouEscopo) {
    // Status, permissões de aba ou escopo de DSEI mudaram: recarrega para refletir.
    state.painelLoginUsuario = usuario;
    window.location.reload();
  }
}

export async function logoutPainel() {
  state.painelLoginUsuario = null;
  // Limpa o cookie HttpOnly no servidor antes de recarregar.
  try { await apiPost("/api/logout", {}); } catch (e) { }
  try { localStorage.removeItem("painelLoginToken"); } catch (e) { } // limpa resíduo de versões antigas
  window.location.reload();
}
