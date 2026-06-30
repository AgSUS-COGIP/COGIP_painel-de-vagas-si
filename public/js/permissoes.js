// Matriz de perfis de acesso (aba Solicitações) + enforcement por módulo.
//
// Cada usuário aprovado tem um nível por módulo/aba:
//   0 = Sem acesso   1 = Leitor   2 = Editor   3 = Administrador
// Quando não há override gravado para um módulo, vale o nível global do usuário
// (state.painelLoginUsuario.nivelAutorizacao). O backend reaplica a regra a cada
// requisição; aqui é só UI e ocultação/bloqueio de abas.
import { apiGet, apiPost } from "./api.js";
import { state } from "./state.js";
import { escapeHtml } from "./utils.js";
import { NIVEL } from "./constants.js";
import { criarTabelaArrastavel } from "./tabela-arrastavel.js";

// Módulos (abas) na ordem da matriz. As chaves casam com o data-view do menu.
// Espelha lib/permissoes.js (o backend é a fonte de verdade ao salvar/validar).
export const MODULOS_PERMISSAO = [
  { chave: "visaoGeral", rotulo: "Visão Geral", icone: "fa-chart-pie" },
  { chave: "vagas", rotulo: "Vagas", icone: "fa-folder-open" },
  { chave: "remanejamento", rotulo: "Remanejamento", icone: "fa-folder-tree" },
  { chave: "alertas", rotulo: "Alertas", icone: "fa-circle-exclamation" },
  { chave: "painelSaudeIndigena", rotulo: "Dashboard SI", icone: "fa-chart-column" },
  { chave: "gestaoFerias", rotulo: "Gestão de Férias", icone: "fa-calendar-check" },
  { chave: "entregaCracha", rotulo: "Entrega de Crachá", icone: "fa-id-card" },
  { chave: "gestaoDisciplinar", rotulo: "Gestão Disciplinar", icone: "fa-gavel" },
  { chave: "processosSeletivos", rotulo: "Processos Seletivos", icone: "fa-clipboard-list" },
  // Aba de administração (Solicitações + esta matriz). Exclusiva de super admin;
  // 0 = não vê a aba · 1 = vê (somente leitura) · 2+ = pode administrar.
  { chave: "solicitacoes", rotulo: "Perfis de Acesso", icone: "fa-user-shield" }
];

// Chave do módulo da própria aba de administração.
const MODULO_ADMIN = "solicitacoes";

const NIVEIS = [
  { valor: 0, rotulo: "Sem acesso", classe: "permNivel0" },
  { valor: 1, rotulo: "Leitor", classe: "permNivel1" },
  { valor: 2, rotulo: "Editor", classe: "permNivel2" },
  { valor: 3, rotulo: "Administrador", classe: "permNivel3" }
];

function el(id) { return document.getElementById(id); }

// ----------------------------------------------------------------------------
// Enforcement — permissão efetiva do usuário logado
// ----------------------------------------------------------------------------

// Nível efetivo do usuário logado em um módulo: override explícito ou, na
// ausência, o nível global. Usado para esconder/bloquear abas e travar edição.
export function nivelModulo(modulo) {
  const u = state.painelLoginUsuario || {};
  const global = Number(u.nivelAutorizacao || 0);
  const overrides = u.permissoes || {};
  const v = overrides[modulo];
  return (v === undefined || v === null) ? global : Number(v);
}

export function podeVerModulo(modulo) { return nivelModulo(modulo) >= NIVEL.APROVADO; }
export function podeEditarModulo(modulo) { return nivelModulo(modulo) >= NIVEL.ADMIN; }

// Acesso à aba de administração de perfis (regra mandatória = matriz). É definido
// pelo nível do módulo "solicitacoes": override na matriz ou, na ausência, o
// padrão — super admin global tem acesso pleno; os demais, nenhum. Assim um super
// admin pode CONCEDER a aba a outro usuário ou REBAIXAR outro super admin.
//   ver = nível >= 1 (somente leitura)   administrar = nível >= 2
function nivelAdminLogado() {
  const u = state.painelLoginUsuario || {};
  const ov = (u.permissoes || {})[MODULO_ADMIN];
  if (ov === undefined || ov === null) {
    return Number(u.nivelAutorizacao || 0) >= NIVEL.SUPERADMIN ? NIVEL.SUPERADMIN : 0;
  }
  return Number(ov);
}
export function podeVerPerfis() { return nivelAdminLogado() >= NIVEL.APROVADO; }
export function podeEditarPerfis() { return nivelAdminLogado() >= NIVEL.ADMIN; }

// true se o usuário logado vê AO MENOS UMA aba (qualquer módulo funcional ou a
// aba de administração de perfis). Quando false, o painel não tem nada a mostrar.
export function temAlgumModuloVisivel() {
  const algumModulo = MODULOS_PERMISSAO.some(m => m.chave !== MODULO_ADMIN && podeVerModulo(m.chave));
  return algumModulo || podeVerPerfis();
}

// Esconde as abas sem acesso (nível 0) e, se a aba ativa ficou inacessível,
// redireciona para a primeira aba visível. Chamado por aplicarPermissoesUsuario().
export function aplicarPermissoesModulos() {
  if (!state.painelLoginUsuario) return;
  let atualEscondida = false;

  MODULOS_PERMISSAO.forEach(m => {
    // A aba de administração é especial: sua visibilidade combina super admin
    // global + módulo, e é resolvida em aplicarPermissoesUsuario() (auth.js).
    if (m.chave === MODULO_ADMIN) return;
    const item = document.querySelector(`.navItem[data-view="${m.chave}"]`);
    if (!item) return;
    const visivel = podeVerModulo(m.chave);
    if (visivel) {
      // Não força exibição: outras regras (ex.: painel fixo) podem reusar o item.
      if (item.dataset.permHidden === "1") {
        item.style.removeProperty("display");
        delete item.dataset.permHidden;
      }
    } else {
      item.style.setProperty("display", "none", "important");
      item.dataset.permHidden = "1";
      if (state.activeView === m.chave) atualEscondida = true;
    }
  });

  if (atualEscondida) {
    const visivel = Array.from(document.querySelectorAll(".navItem[data-view]"))
      .find(i => i.dataset.permHidden !== "1" && i.style.display !== "none");
    if (visivel) visivel.click();
  }
}

// ----------------------------------------------------------------------------
// Matriz (tela do admin)
// ----------------------------------------------------------------------------
let perfisCache = [];
let filtroBusca = "";

function mesmoUsuarioLogado(email) {
  const meu = String((state.painelLoginUsuario || {}).email || "").trim().toLowerCase();
  return !!meu && meu === String(email || "").trim().toLowerCase();
}

// Nível efetivo de um usuário da lista em um módulo (override ou padrão).
// Módulos comuns herdam o nível global; o módulo de administração tem padrão
// próprio: super admin global = acesso pleno, demais = sem acesso.
function nivelEfetivo(usuario, modulo) {
  const v = usuario.permissoes ? usuario.permissoes[modulo] : undefined;
  if (v !== undefined && v !== null) return Number(v);
  if (modulo === MODULO_ADMIN) {
    return Number(usuario.nivel || 0) >= NIVEL.SUPERADMIN ? NIVEL.SUPERADMIN : 0;
  }
  return Number(usuario.nivel || 0);
}

function classeNivel(valor) {
  const n = NIVEIS.find(x => x.valor === Number(valor));
  return n ? n.classe : "permNivel0";
}

// Módulos somente-leitura (não têm nenhuma edição/gravação): na matriz só fazem
// sentido os níveis Sem acesso (0) e Leitor (1) — Editor/Administrador não mudam
// nada. O dropdown desses módulos mostra apenas essas duas opções.
const MODULOS_SOMENTE_LEITURA = new Set(["visaoGeral", "vagas", "painelSaudeIndigena"]);

function niveisDisponiveis(modulo) {
  return MODULOS_SOMENTE_LEITURA.has(modulo) ? NIVEIS.filter(n => n.valor <= NIVEL.APROVADO) : NIVEIS;
}

// HTML do <select> de permissão de uma célula (sem <td>: vai num formatter do
// Tabulator). Mantém os data-* (perm-email/perm-modulo) para a delegação existente.
function selectPermHtml(usuario, modulo) {
  const email = escapeHtml(usuario.email || "");
  const niveis = niveisDisponiveis(modulo);
  const maxNivel = niveis[niveis.length - 1].valor;
  // Em módulo somente-leitura, qualquer acesso (>=1) é exibido como "Leitor"
  // (limita ao maior nível ofertado), para casar com uma das opções do dropdown.
  const atual = Math.min(nivelEfetivo(usuario, modulo), maxNivel);
  const personalizado = usuario.permissoes && usuario.permissoes[modulo] !== undefined;
  // Trava de auto-bloqueio: o super admin não pode rebaixar o PRÓPRIO acesso à
  // aba de administração (módulo "solicitacoes").
  const ehProprioAdmin = modulo === MODULO_ADMIN && mesmoUsuarioLogado(usuario.email);
  const desabilita = (!podeEditarPerfis() || !usuario.email || ehProprioAdmin) ? " disabled" : "";
  const titulo = ehProprioAdmin
    ? "Você não pode alterar o seu próprio acesso a esta aba"
    : (personalizado ? "Permissão personalizada" : "Herdado do nível global");
  const opcoes = niveis.map(n =>
    `<option value="${n.valor}"${n.valor === atual ? " selected" : ""}>${n.rotulo}</option>`
  ).join("");
  // data-ss-skip mantém o <select> nativo (não vira combo pesquisável).
  return `<select class="permSel ${classeNivel(atual)}${personalizado ? " permCustom" : ""}"
            data-perm-email="${email}" data-perm-modulo="${escapeHtml(modulo)}"
            data-ss-skip${desabilita} title="${escapeHtml(titulo)}">${opcoes}</select>`;
}

// Grade Tabulator (modo SÓ-ESTILO: sem arrastar colunas/linhas). 1ª coluna
// (Usuário) fixa e azul; cabeçalhos de módulo com ícone branco; selects inline
// preservam os data-* para a delegação de salvar/restaurar continuar valendo.
let gradePerfis = null;

function colsPerfis() {
  const cols = [
    {
      title: "Usuário", field: "login", frozen: true, width: 220, cssClass: "permUserCol",
      formatter: c => {
        const u = c.getData();
        return `<span class="permLogin">${escapeHtml(u.login || u.email || "—")}</span>` +
               `<span class="permNome">${escapeHtml(u.nome || "—")}</span>`;
      },
    },
    ...MODULOS_PERMISSAO.map(m => ({
      title: m.rotulo, field: m.chave, width: 132, hozAlign: "center", headerHozAlign: "center",
      titleFormatter: () => `<span class="permHeadIcon"><i class="fa-solid ${escapeHtml(m.icone)}" aria-hidden="true"></i></span><span class="permHeadTxt">${escapeHtml(m.rotulo)}</span>`,
      formatter: c => selectPermHtml(c.getData(), m.chave),
    })),
  ];
  if (podeEditarPerfis()) cols.push({
    title: "Ações", field: "_acoes", width: 84, hozAlign: "center", headerHozAlign: "center",
    formatter: c => {
      const u = c.getData();
      const email = escapeHtml(u.email || "");
      const temOverride = u.permissoes && Object.keys(u.permissoes).length > 0;
      return u.email
        ? `<button type="button" class="permAcaoBtn" data-perm-limpar="${email}" title="Restaurar tudo para o nível global"${temOverride ? "" : " disabled"}><i class="fa-solid fa-rotate-left"></i></button>`
        : "";
    },
  });
  return cols;
}

function usuariosFiltrados() {
  const termo = filtroBusca.trim().toLowerCase();
  if (!termo) return perfisCache;
  return perfisCache.filter(u =>
    String(u.login || "").toLowerCase().includes(termo) ||
    String(u.nome || "").toLowerCase().includes(termo) ||
    String(u.email || "").toLowerCase().includes(termo)
  );
}

function renderMatriz() {
  if (!el("perfisMatrizTab")) return;
  const lista = usuariosFiltrados();
  if (!gradePerfis) gradePerfis = criarTabelaArrastavel({
    elemento: "perfisMatrizTab", colunas: colsPerfis(),
    persistID: "perfisMatriz", indexField: "email",
    movableColumns: false, movableRows: false, // só o estilo do Tabulator
    layout: "fitData",                          // colunas no tamanho do conteúdo (rola na horizontal; 1ª fixa)
    altura: "560px", vazio: "Nenhum usuário encontrado.",
  });
  gradePerfis?.render(lista);
  const rodape = el("perfisRodape");
  if (rodape) rodape.textContent = `Mostrando ${lista.length} de ${perfisCache.length} usuários`;
}

export async function carregarPerfisAcesso(silencioso) {
  if (!el("perfisMatrizTab")) return;
  let dados;
  try {
    dados = await apiGet("/api/acesso/perfis");
  } catch (e) {
    if (!silencioso) {
      const rodape = el("perfisRodape");
      if (rodape) rodape.textContent = "Não foi possível carregar os perfis.";
    }
    return;
  }
  perfisCache = dados.usuarios || [];
  renderMatriz();
}

// Atualiza o cache local após uma mudança, sem refazer o fetch.
function aplicarMudancaLocal(email, modulo, nivel) {
  const u = perfisCache.find(x => String(x.email || "").toLowerCase() === String(email).toLowerCase());
  if (!u) return;
  if (!u.permissoes) u.permissoes = {};
  u.permissoes[modulo] = Number(nivel);
}

async function onChangePerfis(ev) {
  const sel = ev.target.closest("[data-perm-modulo]");
  if (!sel) return;
  const email = sel.dataset.permEmail;
  const modulo = sel.dataset.permModulo;
  const nivel = Number(sel.value);
  const anterior = sel.dataset.permAnterior;

  sel.disabled = true;
  try {
    await apiPost("/api/acesso/perfis/permissao", { email, modulo, nivel });
    aplicarMudancaLocal(email, modulo, nivel);
    // Recolore o select e marca como personalizado.
    sel.className = `permSel ${classeNivel(nivel)} permCustom`;
    sel.title = "Permissão personalizada";
    // Reabilita o botão "restaurar" da linha.
    const btn = sel.closest(".tabulator-row")?.querySelector("[data-perm-limpar]");
    if (btn) btn.disabled = false;
  } catch (e) {
    if (anterior !== undefined) sel.value = anterior; // reverte em caso de erro
    alert(e && e.message ? e.message : "Falha ao salvar a permissão.");
  } finally {
    sel.disabled = false;
    sel.dataset.permAnterior = sel.value;
  }
}

async function onClickPerfis(ev) {
  const limpar = ev.target.closest("[data-perm-limpar]");
  if (!limpar) return;
  const email = limpar.dataset.permLimpar;
  if (!confirm(`Restaurar todas as permissões de "${email}" para o nível global do usuário?`)) return;
  limpar.disabled = true;
  try {
    await apiPost("/api/acesso/perfis/limpar", { email });
    const u = perfisCache.find(x => String(x.email || "").toLowerCase() === String(email).toLowerCase());
    if (u) u.permissoes = {};
    renderMatriz();
  } catch (e) {
    limpar.disabled = false;
    alert(e && e.message ? e.message : "Falha ao restaurar as permissões.");
  }
}

export function configurarPerfisAcesso() {
  const secao = el("perfisAcessoSecao");
  if (secao && !secao.dataset.bound) {
    secao.dataset.bound = "1";
    // Guarda o valor anterior de cada select ao focar, para reverter em erro.
    secao.addEventListener("focusin", ev => {
      const sel = ev.target.closest("[data-perm-modulo]");
      if (sel) sel.dataset.permAnterior = sel.value;
    });
    secao.addEventListener("change", onChangePerfis);
    secao.addEventListener("click", onClickPerfis);
  }
  const busca = el("perfisBusca");
  if (busca && !busca.dataset.bound) {
    busca.dataset.bound = "1";
    busca.addEventListener("input", () => { filtroBusca = busca.value || ""; renderMatriz(); });
  }
}

// ----------------------------------------------------------------------------
// Editor de permissões de um solicitante PENDENTE (modal)
// Permite pré-definir o acesso por módulo (gravado por e-mail) antes da aprovação.
// ----------------------------------------------------------------------------
function fecharPermissoesPendente() {
  const ov = document.getElementById("permPendOverlay");
  if (ov) ov.remove();
}

export function abrirPermissoesPendente(email, nome, permissoesAtuais) {
  const e = String(email || "").trim();
  if (!e) return;
  fecharPermissoesPendente();
  const overrides = permissoesAtuais || {};

  // Mostra os módulos funcionais (a aba de administração não se concede a um
  // solicitante novo por aqui — isso é feito pela matriz, depois de aprovado).
  const itens = MODULOS_PERMISSAO.filter(m => m.chave !== MODULO_ADMIN).map(m => {
    const niveis = niveisDisponiveis(m.chave);
    const max = niveis[niveis.length - 1].valor;
    const ov = overrides[m.chave];
    // Padrão = Leitor (o que vale após a aprovação quando não há override).
    const atual = Math.min(ov === undefined || ov === null ? NIVEL.APROVADO : Number(ov), max);
    const opcoes = niveis.map(n => `<option value="${n.valor}"${n.valor === atual ? " selected" : ""}>${n.rotulo}</option>`).join("");
    return `<div class="permPendItem">
      <span class="permPendLabel"><i class="fa-solid ${escapeHtml(m.icone)}" aria-hidden="true"></i> ${escapeHtml(m.rotulo)}</span>
      <select class="permSel ${classeNivel(atual)}" data-perm-pend-modulo="${escapeHtml(m.chave)}" data-ss-skip>${opcoes}</select>
    </div>`;
  }).join("");

  const overlay = document.createElement("div");
  overlay.className = "permPendOverlay";
  overlay.id = "permPendOverlay";
  overlay.innerHTML = `
    <div class="permPendBox" role="dialog" aria-modal="true" aria-label="Permissões de acesso">
      <div class="permPendHead">
        <div>
          <h3>Permissões de acesso</h3>
          <p>Defina o acesso de <b>${escapeHtml(nome || e)}</b> por módulo. As permissões valem assim que a solicitação for aprovada.</p>
        </div>
        <button type="button" class="permPendClose" data-perm-pend-fechar aria-label="Fechar"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
      </div>
      <div class="permPendGrid">${itens}</div>
      <div class="permPendFoot">
        <span class="permPendStatus" id="permPendStatus"></span>
        <button type="button" class="permPendOk" data-perm-pend-fechar>Concluir</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const status = overlay.querySelector("#permPendStatus");
  overlay.addEventListener("click", ev => {
    if (ev.target === overlay || ev.target.closest("[data-perm-pend-fechar]")) fecharPermissoesPendente();
  });
  overlay.addEventListener("change", async ev => {
    const sel = ev.target.closest("[data-perm-pend-modulo]");
    if (!sel) return;
    const modulo = sel.dataset.permPendModulo;
    const nivel = Number(sel.value);
    sel.disabled = true;
    try {
      await apiPost("/api/acesso/perfis/permissao", { email: e, modulo, nivel });
      sel.className = `permSel ${classeNivel(nivel)}`;
      if (status) { status.textContent = "Permissões salvas."; status.className = "permPendStatus is-ok"; }
    } catch (err) {
      if (status) { status.textContent = (err && err.message) ? err.message : "Falha ao salvar a permissão."; status.className = "permPendStatus is-erro"; }
    } finally {
      sel.disabled = false;
    }
  });
}
