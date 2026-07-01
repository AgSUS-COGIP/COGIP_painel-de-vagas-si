// Matriz de perfis de acesso (aba Solicitações) + enforcement por módulo.
//
// Cada usuário aprovado tem um nível por módulo/aba:
//   0 = Sem acesso   1 = Leitor   2 = Editor   3 = Administrador
// Não há mais nível global: sem linha gravada para um módulo, o nível é 0 (Sem
// acesso). O backend reaplica a regra a cada requisição; aqui é só UI e
// ocultação/bloqueio de abas. Super admin = nível 3 no módulo "solicitacoes".
import { apiGet, apiPost } from "./api.js";
import { state } from "./state.js";
import { escapeHtml } from "./utils.js";
import { NIVEL } from "./constants.js";
import { abrirModal } from "./modal.js";
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
  { chave: "escalaTrabalho", rotulo: "Escala de Trabalho", icone: "fa-calendar-days" },
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

// Nível do usuário logado em um módulo. Sem mais nível global: ausência de
// override = 0 (Sem acesso). Usado para esconder/bloquear abas e travar edição.
export function nivelModulo(modulo) {
  const u = state.painelLoginUsuario || {};
  return Number((u.permissoes || {})[modulo] || 0);
}

export function podeVerModulo(modulo) { return nivelModulo(modulo) >= NIVEL.APROVADO; }

// Acesso à aba de administração de perfis (regra mandatória = matriz). É definido
// exclusivamente pelo nível do usuário no módulo "solicitacoes". Super admin = 3.
//   ver = nível >= 1 (somente leitura)   administrar = nível >= 2
function nivelAdminLogado() {
  const u = state.painelLoginUsuario || {};
  return Number((u.permissoes || {})[MODULO_ADMIN] || 0);
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
    // A aba de administração é especial: sua visibilidade (módulo "solicitacoes")
    // é resolvida em aplicarPermissoesUsuario() (auth.js).
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
// DSEIs disponíveis para o seletor de escopo (vêm do GET /api/acesso/perfis).
let dseisDisponiveis = [];

function mesmoUsuarioLogado(email) {
  const meu = String((state.painelLoginUsuario || {}).email || "").trim().toLowerCase();
  return !!meu && meu === String(email || "").trim().toLowerCase();
}

// Nível de um usuário da lista em um módulo. Sem mais nível global: ausência de
// override = 0 (Sem acesso).
function nivelEfetivo(usuario, modulo) {
  const v = usuario.permissoes ? usuario.permissoes[modulo] : undefined;
  return (v !== undefined && v !== null) ? Number(v) : 0;
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
    : (personalizado ? "Permissão definida" : "Sem acesso (defina o nível)");
  const opcoes = niveis.map(n =>
    `<option value="${n.valor}"${n.valor === atual ? " selected" : ""}>${n.rotulo}</option>`
  ).join("");
  // data-ss-skip mantém o <select> nativo (não vira combo pesquisável).
  return `<select class="permSel ${classeNivel(atual)}${personalizado ? " permCustom" : ""}"
            data-perm-email="${email}" data-perm-modulo="${escapeHtml(modulo)}"
            data-ss-skip${desabilita} title="${escapeHtml(titulo)}">${opcoes}</select>`;
}

// Resumo textual do escopo de DSEI do usuário ("Todos os DSEIs" ou "N DSEI(s)").
function resumoEscopo(usuario) {
  const esc = usuario.escopo || { todos: true, dseis: [] };
  if (esc.todos !== false) return "Todos os DSEIs";
  const n = (esc.dseis || []).length;
  return n ? `${n} DSEI(s)` : "Nenhum DSEI";
}

// Conteúdo da célula "Escopo (DSEI)" (sem <td>: vai num formatter do Tabulator).
// Editor+ vê o botão que abre o modal (data-perm-escopo → onClickPerfis); o leitor
// vê só o chip. O escopo é por pessoa (vale para todos os módulos).
function escopoCelulaHtml(usuario) {
  const email = escapeHtml(usuario.email || "");
  const resumo = escapeHtml(resumoEscopo(usuario));
  const restrito = usuario.escopo && usuario.escopo.todos === false;
  const classe = restrito ? "permEscopoRestrito" : "permEscopoTodos";
  if (!podeEditarPerfis() || !usuario.email) {
    return `<span class="permEscopoChip ${classe}">${resumo}</span>`;
  }
  return `<button type="button" class="permEscopoBtn ${classe}" data-perm-escopo="${email}" title="Definir os DSEIs que este usuário pode acessar"><i class="fa-solid fa-location-dot" aria-hidden="true"></i> ${resumo}</button>`;
}

// Grade Tabulator (modo SÓ-ESTILO: sem arrastar colunas/linhas). 1ª coluna
// (Usuário) fixa e azul; cabeçalhos de módulo com ícone branco; selects e botões
// inline preservam os data-* para a delegação (salvar/restaurar/escopo) valer.
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
    // Escopo (DSEI): por pessoa, vale para todos os módulos. O botão (Editor+) abre
    // o modal via delegação data-perm-escopo (ver onClickPerfis).
    {
      title: "Escopo (DSEI)", field: "_escopo", width: 150, hozAlign: "center", headerHozAlign: "center", cssClass: "permEscopoCell",
      titleFormatter: () => `<span class="permHeadIcon"><i class="fa-solid fa-location-dot" aria-hidden="true"></i></span><span class="permHeadTxt">Escopo (DSEI)</span>`,
      formatter: c => escopoCelulaHtml(c.getData()),
    },
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
  // Modo somente-visualização (nível 1 no módulo "solicitacoes"): o CSS
  // (.perfis-readonly) esconde os botões de ação/escrita em qualquer profundidade,
  // além dos <select> da matriz já ficarem desabilitados. Os <select> NÃO são
  // escondidos — eles são a própria visualização dos níveis atuais.
  const raizPerfis = el("view-solicitacoes");
  if (raizPerfis) raizPerfis.classList.toggle("perfis-readonly", !podeEditarPerfis());
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
  dseisDisponiveis = dados.dseisDisponiveis || [];
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
    sel.title = "Permissão definida";
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
  const escopoBtn = ev.target.closest("[data-perm-escopo]");
  if (escopoBtn) { abrirEscopoDsei(escopoBtn.dataset.permEscopo); return; }
  const limpar = ev.target.closest("[data-perm-limpar]");
  if (!limpar) return;
  const email = limpar.dataset.permLimpar;
  if (!confirm(`Remover TODAS as permissões de "${email}"? O usuário ficará sem acesso a nenhuma aba até você definir novos níveis na matriz.`)) return;
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
    // Padrão = Sem acesso (0): o admin concede explicitamente cada aba. Sem mais
    // nível global, módulo não definido = sem acesso após a aprovação.
    const atual = Math.min(ov === undefined || ov === null ? 0 : Number(ov), max);
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
          <p>Defina o acesso de <b>${escapeHtml(nome || e)}</b> por módulo. O padrão é "Sem acesso" — libere as abas desejadas. Ao clicar em <b>Concluir</b>, TODOS os níveis mostrados são gravados; valem assim que a solicitação for aprovada.</p>
        </div>
        <button type="button" class="permPendClose" data-perm-pend-fechar aria-label="Fechar"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
      </div>
      <div class="permPendGrid">${itens}</div>
      <div class="permPendFoot">
        <span class="permPendStatus" id="permPendStatus"></span>
        <button type="button" class="permPendOk" data-perm-pend-concluir>Concluir</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const status = overlay.querySelector("#permPendStatus");
  // Há alterações ainda não gravadas? Salvar é SÓ no Concluir.
  let sujo = false;

  // Grava TODOS os módulos no nível atualmente mostrado, em SEQUÊNCIA (um POST por
  // vez). É o único ponto de salvamento — determinístico, sem corridas.
  async function gravarTodos() {
    const sels = Array.from(overlay.querySelectorAll("[data-perm-pend-modulo]"));
    if (status) { status.textContent = "Salvando..."; status.className = "permPendStatus"; }
    for (const sel of sels) {
      const modulo = sel.dataset.permPendModulo;
      const nivel = Number(sel.value);
      await apiPost("/api/acesso/perfis/permissao", { email: e, modulo, nivel });
      overrides[modulo] = nivel; // mantém o cache do pendente em sincronia
    }
    sujo = false;
    if (status) { status.textContent = "Permissões salvas."; status.className = "permPendStatus is-ok"; }
  }

  async function fecharComGuarda() {
    if (sujo) {
      const r = await abrirModal({
        titulo: "Alterações não salvas",
        msg: "Há alterações de permissão que ainda não foram gravadas. Deseja descartá-las?",
        confirmarTexto: "Descartar",
        perigo: true
      });
      if (!r || !r.ok) return;
    }
    fecharPermissoesPendente();
  }

  overlay.addEventListener("click", async ev => {
    if (ev.target.closest("[data-perm-pend-concluir]")) {
      const btn = ev.target.closest("[data-perm-pend-concluir]");
      btn.disabled = true;
      try {
        await gravarTodos();
        fecharPermissoesPendente();
      } catch (err) {
        btn.disabled = false;
        if (status) { status.textContent = (err && err.message) ? err.message : "Falha ao salvar as permissões."; status.className = "permPendStatus is-erro"; }
      }
      return;
    }
    if (ev.target === overlay || ev.target.closest("[data-perm-pend-fechar]")) await fecharComGuarda();
  });

  // Mexer num dropdown NÃO salva sozinho — só atualiza o visual e marca como
  // pendente. A gravação é toda no Concluir (sequencial), o que evita corridas
  // de várias requisições simultâneas quando se edita rápido.
  overlay.addEventListener("change", ev => {
    const sel = ev.target.closest("[data-perm-pend-modulo]");
    if (!sel) return;
    sel.className = `permSel ${classeNivel(Number(sel.value))}`;
    sujo = true;
    if (status) { status.textContent = "Alterações não salvas — clique em Concluir para gravar."; status.className = "permPendStatus"; }
  });
}

// ----------------------------------------------------------------------------
// Editor de ESCOPO de DSEI de um usuário (modal)
// Define se o usuário vê TODOS os DSEIs (sede) ou fica restrito a um conjunto.
// ----------------------------------------------------------------------------
function fecharEscopoDsei() {
  const ov = document.getElementById("escDseiOverlay");
  if (ov) ov.remove();
}

function abrirEscopoDsei(email) {
  const e = String(email || "").trim();
  if (!e) return;
  const usuario = perfisCache.find(x => String(x.email || "").toLowerCase() === e.toLowerCase());
  if (!usuario) return;
  fecharEscopoDsei();

  const escAtual = usuario.escopo || { todos: true, dseis: [] };
  const selecionados = new Set((escAtual.dseis || []).map(Number));
  const todosInicial = escAtual.todos !== false;

  const opcoesDsei = dseisDisponiveis.length
    ? dseisDisponiveis.map(d =>
        `<label class="escDseiItem">
          <input type="checkbox" class="escDseiCheck" value="${Number(d.id)}"${selecionados.has(Number(d.id)) ? " checked" : ""}>
          <span>${escapeHtml(d.nome)}</span>
        </label>`
      ).join("")
    : `<p class="escDseiVazio">Nenhum DSEI disponível para seleção.</p>`;

  const overlay = document.createElement("div");
  overlay.className = "permPendOverlay";
  overlay.id = "escDseiOverlay";
  overlay.innerHTML = `
    <div class="permPendBox" role="dialog" aria-modal="true" aria-label="Acesso por DSEI">
      <div class="permPendHead">
        <div>
          <h3>Acesso por DSEI</h3>
          <p>Defina quais DSEIs <b>${escapeHtml(usuario.nome || e)}</b> pode acessar. "Todos" libera todas as unidades (sede); "Apenas os selecionados" restringe aos marcados.</p>
        </div>
        <button type="button" class="permPendClose" data-esc-fechar aria-label="Fechar"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
      </div>
      <div class="escDseiModo">
        <label><input type="radio" name="escModo" value="todos"${todosInicial ? " checked" : ""}> Todos os DSEIs (sede)</label>
        <label><input type="radio" name="escModo" value="restrito"${todosInicial ? "" : " checked"}> Apenas os DSEIs selecionados</label>
      </div>
      <div class="escDseiLista${todosInicial ? " is-desabilitado" : ""}" id="escDseiLista">${opcoesDsei}</div>
      <div class="permPendFoot">
        <span class="permPendStatus" id="escDseiStatus"></span>
        <button type="button" class="permPendOk" data-esc-concluir>Salvar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const lista = overlay.querySelector("#escDseiLista");
  const status = overlay.querySelector("#escDseiStatus");
  const modoEhTodos = () => overlay.querySelector('input[name="escModo"]:checked')?.value === "todos";

  function sincronizarLista() {
    const todos = modoEhTodos();
    lista.classList.toggle("is-desabilitado", todos);
    lista.querySelectorAll(".escDseiCheck").forEach(c => { c.disabled = todos; });
  }
  sincronizarLista();

  overlay.addEventListener("change", ev => {
    if (ev.target && ev.target.name === "escModo") sincronizarLista();
  });

  overlay.addEventListener("click", async ev => {
    if (ev.target === overlay || ev.target.closest("[data-esc-fechar]")) { fecharEscopoDsei(); return; }
    const btn = ev.target.closest("[data-esc-concluir]");
    if (!btn) return;
    const todos = modoEhTodos();
    const dseis = todos ? [] : Array.from(overlay.querySelectorAll(".escDseiCheck:checked")).map(c => Number(c.value));
    if (!todos && !dseis.length) {
      if (status) { status.textContent = "Selecione ao menos um DSEI ou escolha \"Todos\"."; status.className = "permPendStatus is-erro"; }
      return;
    }
    btn.disabled = true;
    if (status) { status.textContent = "Salvando..."; status.className = "permPendStatus"; }
    try {
      await apiPost("/api/acesso/perfis/escopo", { email: e, todos, dseis });
      usuario.escopo = { todos, dseis };
      renderMatriz();
      fecharEscopoDsei();
    } catch (err) {
      btn.disabled = false;
      if (status) { status.textContent = (err && err.message) ? err.message : "Falha ao salvar o escopo."; status.className = "permPendStatus is-erro"; }
    }
  });
}
