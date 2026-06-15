// Fluxo de solicitação e aprovação de acesso.
// - Usuário sem acesso aprovado: envia/acompanha a solicitação (formulário <-> tela pendente).
// - Administradores (nível >= 2): gerenciam solicitações (aprovar via modal, recusar via caixa inline).
import { apiGet, apiPost } from "./api.js";
import { state } from "./state.js";
import { escapeHtml } from "./utils.js";

function el(id) { return document.getElementById(id); }
function val(id) { const e = el(id); return e ? e.value : ""; }
function setVal(id, v) { const e = el(id); if (e) e.value = v == null ? "" : v; }
function fmtData(v) {
  if (!v) return "—";
  const s = String(v).replace("T", " ").slice(0, 16);
  return s || "—";
}

// Popula um <select> com as opções vindas do banco, preservando o valor atual.
function preencherSelectAcesso(id, placeholder, valores) {
  const sel = el(id);
  if (!sel || sel.tagName !== "SELECT") return;
  const atual = sel.value;
  const opts = (valores || []).map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
  sel.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` + opts;
  if (atual) sel.value = atual;
}

// Carrega DSEI/CASAI/coordenações/cargos do servidor (auto-sync com o banco).
let listasAcessoCarregadas = false;
async function carregarListasAcesso() {
  if (listasAcessoCarregadas) return;
  let listas;
  try { listas = await apiGet("/api/acesso/listas"); } catch (e) { return; }
  preencherSelectAcesso("acDsei", "Selecione o DSEI", listas.dsei);
  preencherSelectAcesso("acCasai", "Selecione a CASAI", listas.casai);
  preencherSelectAcesso("acCoordenacao", "Selecione a coordenação", listas.coordenacoes);
  preencherSelectAcesso("acCargo", "Selecione o cargo / função", listas.cargos);
  listasAcessoCarregadas = true;
}

// ----------------------------------------------------------------------------
// Tela do usuário: formulário <-> solicitação pendente
// ----------------------------------------------------------------------------
let ultimoStatusAcesso = null;
let pollAcessoTimer = null;

// Verifica periodicamente a própria solicitação para refletir decisões do admin
// (ex.: recusa) sem o usuário precisar recarregar a página.
function iniciarPollAcesso() {
  if (pollAcessoTimer) return;
  pollAcessoTimer = setInterval(() => { carregarMinhaSolicitacao(false); }, 12000);
}

export async function mostrarAcessoPendente() {
  if (el("loading")) el("loading").style.display = "none";
  if (el("loginScreen")) el("loginScreen").style.display = "none";
  const app = document.querySelector(".app");
  if (app) app.style.display = "none";

  const tela = el("acessoPendenteScreen");
  if (tela) tela.style.display = "grid";

  await carregarListasAcesso();        // popula os dropdowns antes de preencher os valores
  await carregarMinhaSolicitacao(true);
  iniciarPollAcesso();
}

function preencherForm(atual) {
  const u = state.painelLoginUsuario || {};
  setVal("acNome", (atual && atual.NOME) || u.nome || "");
  setVal("acEmail", u.email || (atual && atual.EMAIL) || "");
  setVal("acCargo", (atual && atual.CARGO) || "");
  setVal("acCoordenacao", (atual && atual.COORDENACAO) || "");
  setVal("acDsei", (atual && atual.DSEI) || "");
  setVal("acCasai", (atual && atual.CASAI) || "");
  setVal("acJustificativa", (atual && atual.JUSTIFICATIVA) || "");
}

function resumoSolicitacao(s) {
  return [
    ["Nome", s.NOME], ["E-mail", s.EMAIL], ["Cargo/Função", s.CARGO],
    ["Coordenação", s.COORDENACAO], ["DSEI", s.DSEI], ["CASAI", s.CASAI],
    ["Justificativa", s.JUSTIFICATIVA]
  ].filter(([, v]) => v)
    .map(([k, v]) => `<div><span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></div>`)
    .join("");
}

function mostrarEstadoFormulario() {
  if (el("acessoPendenteWrap")) el("acessoPendenteWrap").style.display = "none";
  if (el("acessoForm")) el("acessoForm").style.display = "";
}

async function carregarMinhaSolicitacao(forcar) {
  let dados = null;
  try { dados = await apiGet("/api/acesso/minha-solicitacao"); } catch (e) { dados = null; }
  const atual = dados && dados.atual ? dados.atual : null;
  const status = atual ? String(atual.STATUS) : "NOVO";

  // Não re-renderiza se o status não mudou (evita apagar o que o usuário está digitando).
  if (!forcar && status === ultimoStatusAcesso) return;
  ultimoStatusAcesso = status;

  // Preenche o formulário sempre (serve para "Editar solicitação").
  preencherForm(atual);

  if (status === "PENDENTE") {
    // Estado pendente: esconde o formulário, mostra o acompanhamento.
    if (el("acessoForm")) el("acessoForm").style.display = "none";
    if (el("acessoPendenteWrap")) el("acessoPendenteWrap").style.display = "";
    const banner = el("acPendBanner");
    if (banner) {
      banner.innerHTML = `Sua solicitação foi enviada em <b>${escapeHtml(fmtData(atual.CRIADO_EM))}</b> e está <b>aguardando aprovação</b> de um administrador.`;
    }
    const info = el("acPendInfo");
    if (info) info.innerHTML = resumoSolicitacao(atual);
    return;
  }

  // Estado formulário: novo pedido ou reenvio após recusa.
  mostrarEstadoFormulario();
  const banner = el("acessoStatusBanner");
  const recusaBox = el("acessoRecusaMotivo");
  const submitBtn = el("acSubmitBtn");
  const erro = el("acErro");
  if (erro) erro.innerText = "";
  if (recusaBox) recusaBox.style.display = "none";

  if (status === "RECUSADO") {
    if (banner) {
      banner.className = "acessoStatusBanner statusRecusado";
      banner.innerHTML = `<strong>Solicitação recusada.</strong> Revise as informações e envie novamente.`;
    }
    if (recusaBox) {
      recusaBox.style.display = "";
      recusaBox.innerHTML = `<strong>Motivo da recusa:</strong> ${escapeHtml(atual.OBSERVACAO_DECISAO || "Não informado.")}`;
    }
    if (submitBtn) submitBtn.innerText = "Reenviar solicitação";
  } else {
    if (banner) {
      banner.className = "acessoStatusBanner statusNovo";
      banner.innerHTML = `Seu acesso ainda não foi liberado. Preencha o formulário abaixo para solicitar acesso.`;
    }
    if (submitBtn) submitBtn.innerText = "Enviar solicitação";
  }
}

async function enviarSolicitacao(ev) {
  ev.preventDefault();
  const erro = el("acErro");
  if (erro) erro.innerText = "";
  const btn = el("acSubmitBtn");

  const body = {
    nome: val("acNome"), cargo: val("acCargo"), coordenacao: val("acCoordenacao"),
    dsei: val("acDsei"), casai: val("acCasai"), justificativa: val("acJustificativa")
  };
  if (!body.justificativa.trim()) {
    if (erro) erro.innerText = "Informe a justificativa da necessidade de acesso.";
    return;
  }

  if (btn) btn.disabled = true;
  try {
    const resp = await apiPost("/api/acesso/solicitar", body);
    // Se o acesso já tinha sido aprovado nesse meio-tempo, entra direto no painel.
    if (resp && resp.jaAprovado) { window.location.reload(); return; }
    // Após enviar, vai para a tela de "solicitação pendente".
    await carregarMinhaSolicitacao(true);
  } catch (e) {
    if (erro) erro.innerText = (e && e.message) ? e.message : "Falha ao enviar a solicitação.";
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ----------------------------------------------------------------------------
// Modal de confirmação central (sobrepõe a tela) — usado na aprovação
// ----------------------------------------------------------------------------
let modalResolver = null;
let modalExigeInput = false;

// Abre o modal central. Com `comInput`, mostra um campo de texto (ex.: motivo da recusa).
// Resolve { ok: true, valor } ao confirmar, ou { ok: false } ao cancelar.
function abrirModal(opts) {
  const o = opts || {};
  modalExigeInput = !!o.comInput;
  return new Promise(resolve => {
    modalResolver = resolve;
    if (el("acessoModalTitulo")) el("acessoModalTitulo").innerText = o.titulo || "Confirmar";
    if (el("acessoModalMsg")) el("acessoModalMsg").innerText = o.msg || "";
    if (el("acessoModalErro")) el("acessoModalErro").innerText = "";

    const wrap = el("acessoModalInputWrap");
    const input = el("acessoModalInput");
    if (wrap) wrap.style.display = o.comInput ? "" : "none";
    if (el("acessoModalInputLabel")) el("acessoModalInputLabel").innerText = o.inputLabel || "";
    if (input) { input.value = ""; input.placeholder = o.placeholder || ""; }

    const conf = el("acessoModalConfirmar");
    if (conf) {
      conf.innerText = o.confirmarTexto || "Confirmar";
      conf.classList.toggle("solRecusar", !!o.perigo);
      conf.classList.toggle("solAprovar", !o.perigo);
    }

    const ov = el("acessoModal");
    if (ov) ov.style.display = "flex";
    if (o.comInput && input) setTimeout(() => input.focus(), 50);
  });
}

function confirmarModalClick() {
  if (modalExigeInput) {
    const input = el("acessoModalInput");
    const valor = input ? input.value.trim() : "";
    if (!valor) {
      if (el("acessoModalErro")) el("acessoModalErro").innerText = "Este campo é obrigatório.";
      if (input) input.focus();
      return;
    }
    fecharModal({ ok: true, valor });
    return;
  }
  fecharModal({ ok: true });
}

function fecharModal(resultado) {
  const ov = el("acessoModal");
  if (ov) ov.style.display = "none";
  const r = modalResolver;
  modalResolver = null;
  modalExigeInput = false;
  if (r) r(resultado || { ok: false });
}

// ----------------------------------------------------------------------------
// Tela do administrador: gestão de solicitações
// ----------------------------------------------------------------------------
function cardSolicitacao(s, comAcoes) {
  const id = escapeHtml(String(s.ID_SOLICITACAO));
  const linhas = [
    ["Nome", s.NOME], ["E-mail", s.EMAIL], ["Cargo/Função", s.CARGO],
    ["Coordenação", s.COORDENACAO], ["DSEI", s.DSEI], ["CASAI", s.CASAI]
  ].filter(([, v]) => v)
    .map(([k, v]) => `<div><span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></div>`)
    .join("");

  const statusClasse = s.STATUS === "APROVADO" ? "tagAprovado" : (s.STATUS === "RECUSADO" ? "tagRecusado" : "tagPendente");
  const decisao = s.STATUS !== "PENDENTE"
    ? `<div class="solDecisao">Decidido por ${escapeHtml(s.DECIDIDO_POR || "—")} em ${escapeHtml(fmtData(s.DECIDIDO_EM))}${s.OBSERVACAO_DECISAO ? ` · <em>${escapeHtml(s.OBSERVACAO_DECISAO)}</em>` : ""}</div>`
    : "";

  const email = escapeHtml(String(s.EMAIL || ""));

  const acoes = comAcoes
    ? `<div class="solAcoes">
         <button type="button" class="solBtn solAprovar" data-acesso-aprovar="${id}">Aprovar</button>
         <button type="button" class="solBtn solRecusar" data-acesso-recusar="${id}">Recusar</button>
       </div>`
    : "";

  // Privilégio: só para usuários ATIVOS (aprovados). Permite conceder/retirar admin.
  const ativo = Number(s.USUARIO_ATIVO) === 1;
  const nivelAtual = Number(s.USUARIO_NIVEL || 0);
  const privilegio = ativo
    ? `<div class="solPrivilegio">
         <label>Privilégio</label>
         <select class="solNivelSelect" data-acesso-nivel="${email}">
           <option value="1"${nivelAtual < 2 ? " selected" : ""}>Usuário comum</option>
           <option value="2"${nivelAtual >= 2 ? " selected" : ""}>Administrador</option>
         </select>
       </div>`
    : "";

  return `
    <div class="solCard">
      <div class="solHead">
        <span class="solTag ${statusClasse}">${escapeHtml(s.STATUS)}</span>
        <span class="solHeadDir">
          <span class="solData">${escapeHtml(fmtData(s.CRIADO_EM))}</span>
          <button type="button" class="solExcluirBtn" title="Excluir usuário e suas solicitações" data-acesso-excluir="${email}"><i class="fa-solid fa-trash"></i></button>
        </span>
      </div>
      <div class="solGrid">${linhas}</div>
      <div class="solJustificativa"><span>Justificativa</span><p>${escapeHtml(s.JUSTIFICATIVA || "—")}</p></div>
      ${decisao}
      ${privilegio}
      ${acoes}
    </div>`;
}

export async function carregarSolicitacoesAdmin() {
  const boxPend = el("solicitacoesPendentes");
  const boxHist = el("solicitacoesHistorico");
  if (!boxPend || !boxHist) return;

  boxPend.innerHTML = '<div class="solVazio">Carregando…</div>';
  boxHist.innerHTML = "";

  let dados;
  try {
    dados = await apiGet("/api/acesso/solicitacoes");
  } catch (e) {
    boxPend.innerHTML = '<div class="solVazio">Não foi possível carregar as solicitações.</div>';
    return;
  }

  const pendentes = dados.pendentes || [];
  const historico = dados.historico || [];
  boxPend.innerHTML = pendentes.length
    ? pendentes.map(s => cardSolicitacao(s, true)).join("")
    : '<div class="solVazio">Nenhuma solicitação pendente.</div>';
  boxHist.innerHTML = historico.length
    ? historico.map(s => cardSolicitacao(s, false)).join("")
    : '<div class="solVazio">Sem histórico de decisões.</div>';
}

async function decidir(acao, id, observacao) {
  await apiPost(`/api/acesso/solicitacoes/${encodeURIComponent(id)}/${acao}`, { observacao });
  await carregarSolicitacoesAdmin();
}

async function onClickAdmin(ev) {
  const aprovar = ev.target.closest("[data-acesso-aprovar]");
  const recusar = ev.target.closest("[data-acesso-recusar]");
  const excluir = ev.target.closest("[data-acesso-excluir]");

  if (excluir) {
    const email = excluir.dataset.acessoExcluir;
    const r = await abrirModal({
      titulo: "Excluir usuário",
      msg: `Excluir "${email}" e TODAS as suas informações e solicitações? Esta ação não pode ser desfeita.`,
      confirmarTexto: "Excluir", perigo: true
    });
    if (!r.ok) return;
    try {
      await apiPost("/api/acesso/usuario/excluir", { email });
      await carregarSolicitacoesAdmin();
    } catch (e) { alert(e && e.message ? e.message : "Falha ao excluir o usuário."); }
    return;
  }

  if (aprovar) {
    const id = aprovar.dataset.acessoAprovar;
    const r = await abrirModal({
      titulo: "Aprovar acesso",
      msg: "Tem certeza que deseja liberar o acesso deste usuário ao painel?",
      confirmarTexto: "Aprovar"
    });
    if (!r.ok) return;
    try { await decidir("aprovar", id, ""); } catch (e) { alert(e && e.message ? e.message : "Falha ao aprovar."); }
    return;
  }

  if (recusar) {
    const id = recusar.dataset.acessoRecusar;
    const r = await abrirModal({
      titulo: "Recusar acesso",
      msg: "Informe o motivo da recusa. Ele ficará visível para o solicitante.",
      comInput: true,
      inputLabel: "Justificativa da recusa",
      placeholder: "Ex.: cargo não compatível com o acesso solicitado.",
      confirmarTexto: "Recusar", perigo: true
    });
    if (!r.ok) return;
    try { await decidir("recusar", id, r.valor); } catch (e) { alert(e && e.message ? e.message : "Falha ao recusar."); }
  }
}

// Alteração de privilégio (select) — evento 'change' no painel.
async function onChangeAdmin(ev) {
  const sel = ev.target.closest("[data-acesso-nivel]");
  if (!sel) return;
  const email = sel.dataset.acessoNivel;
  const nivel = Number(sel.value);
  const nomeNivel = nivel >= 2 ? "Administrador" : "Usuário comum";
  const r = await abrirModal({
    titulo: "Alterar privilégio",
    msg: `Definir "${email}" como ${nomeNivel}?`,
    confirmarTexto: "Confirmar"
  });
  if (!r.ok) { await carregarSolicitacoesAdmin(); return; } // cancelou -> recarrega p/ reverter o select
  try {
    await apiPost("/api/acesso/usuario/nivel", { email, nivel });
    await carregarSolicitacoesAdmin();
  } catch (e) { alert(e && e.message ? e.message : "Falha ao alterar o privilégio."); await carregarSolicitacoesAdmin(); }
}

// ----------------------------------------------------------------------------
// Inicialização (chamada no init do app)
// ----------------------------------------------------------------------------
function sair() {
  try { localStorage.removeItem("painelLoginToken"); } catch (e) {}
  window.location.reload();
}

export function configurarAcesso() {
  const form = el("acessoForm");
  if (form && !form.dataset.bound) {
    form.dataset.bound = "1";
    form.addEventListener("submit", enviarSolicitacao);
  }
  ["acLogoutBtn", "acLogoutBtn2"].forEach(idBtn => {
    const b = el(idBtn);
    if (b && !b.dataset.bound) { b.dataset.bound = "1"; b.addEventListener("click", sair); }
  });
  const editar = el("acEditarBtn");
  if (editar && !editar.dataset.bound) {
    editar.dataset.bound = "1";
    editar.addEventListener("click", mostrarEstadoFormulario);
  }

  // Modal de confirmação (aprovação / recusa / exclusão / privilégio).
  const mConf = el("acessoModalConfirmar");
  if (mConf && !mConf.dataset.bound) { mConf.dataset.bound = "1"; mConf.addEventListener("click", confirmarModalClick); }
  const mCanc = el("acessoModalCancelar");
  if (mCanc && !mCanc.dataset.bound) { mCanc.dataset.bound = "1"; mCanc.addEventListener("click", () => fecharModal({ ok: false })); }
  const ov = el("acessoModal");
  if (ov && !ov.dataset.bound) {
    ov.dataset.bound = "1";
    ov.addEventListener("click", (e) => { if (e.target === ov) fecharModal({ ok: false }); });
  }

  // Painel admin: delega cliques e mudanças (privilégio) e carrega ao abrir a aba.
  const painel = el("view-solicitacoes");
  if (painel && !painel.dataset.bound) {
    painel.dataset.bound = "1";
    painel.addEventListener("click", onClickAdmin);
    painel.addEventListener("change", onChangeAdmin);
  }
  const navItem = document.querySelector('.navItem[data-view="solicitacoes"]');
  if (navItem && !navItem.dataset.boundAcesso) {
    navItem.dataset.boundAcesso = "1";
    navItem.addEventListener("click", () => { carregarSolicitacoesAdmin(); });
  }
}
