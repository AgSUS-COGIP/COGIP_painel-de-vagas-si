// Fluxo de solicitação e aprovação de acesso.
// - Usuário sem acesso aprovado: envia/acompanha a solicitação (formulário <-> tela pendente).
// - Administradores (nível >= 2): gerenciam solicitações (aprovar via modal, recusar via caixa inline).
import { apiGet, apiPost } from "./api.js";
import { configurarGlassDropdowns } from "./dropdown.js";
import { abrirModal } from "./modal.js";
import { state } from "./state.js";
import { escapeHtml } from "./utils.js";
import { preencherSelect } from "./ui-utils.js";
import { NIVEL } from "./constants.js";

function el(id) { return document.getElementById(id); }
function val(id) { const e = el(id); return e ? e.value : ""; }
function setVal(id, v) { const e = el(id); if (e) e.value = v == null ? "" : v; }

// ----------------------------------------------------------------------------
// Tipo de unidade: define quais campos do formulário ficam visíveis.
// ----------------------------------------------------------------------------
const VALOR_OUTRO = "__outro__";
const CAMPOS_POR_TIPO = {
  dsei:      ["nome", "email", "cargo", "unidade", "justificativa"],
  sede:      ["nome", "email", "cargo", "coordenacao", "justificativa"],
  distrital: ["nome", "email", "cargo", "unidade", "justificativa"],
};
let tipoAcessoAtual = "dsei";

// Cargos/funções exibidos na aba "Escritórios Distritais" (lista fixa, não vem do banco).
const CARGOS_DISTRITAL = [
  "AGENTE DE REGIAO/DISTRITO",
  "ANALISTA DE GESTAO",
  "ASSESSOR DE REGIAO/DISTRITO",
  "ASSISTENTE DE REGIAO/DISTRITO",
  "AUXILIAR DE GESTAO",
  "CHEFE DE DISTRITO",
  "COORDENADOR DE REGIONAL",
];

// Escritórios exibidos na aba "Escritórios Distritais" (lista fixa, não vem do banco).
const ESCRITORIOS_DISTRITAL = [
  "ESCRITORIO ATALAIA DO NORTE/AM (VALE DO JAVARI)",
  "ESCRITORIO BOA VISTA/RR (YANOMAMI)",
  "ESCRITORIO CAMPO GRANDE/MS (MATO GROSSO DO SUL)",
  "ESCRITORIO CUIABA/MT (CUIABA) - REGIONAL",
  "ESCRITORIO DISTRITAL ALTAMIRA/PA (ALTAMIRA)",
  "ESCRITORIO DISTRITAL ATALAIA DO NORTE/AM (VALE DO JAVARI)",
  "ESCRITORIO DISTRITAL BARRA DO GARCAS/MT (XAVANTE)",
  "ESCRITORIO DISTRITAL BELEM/PA (GUAMA-TOCANTINS)",
  "ESCRITORIO DISTRITAL BOA VISTA/RR (YANOMAMI)",
  "ESCRITORIO DISTRITAL CACOAL/RO (VILHENA)",
  "ESCRITORIO DISTRITAL CAMPO GRANDE/MS (MATO GROSSO DO SUL)",
  "ESCRITORIO DISTRITAL CANARANA/MT (XINGU)",
  "ESCRITORIO DISTRITAL COLIDER/MT (KAIAPO DO MATO GROSSO)",
  "ESCRITORIO DISTRITAL CRUZEIRO DO SUL/AC (ALTO RIO JURUA)",
  "ESCRITORIO DISTRITAL CUIABA/MT (CUIABA)",
  "ESCRITORIO DISTRITAL CURITIBA/PR (LITORAL SUL)",
  "ESCRITORIO DISTRITAL FLORIANOPOLIS/SC (INTERIOR SUL)",
  "ESCRITORIO DISTRITAL FORTALEZA/CE (CEARA)",
  "ESCRITORIO DISTRITAL GOVERNADOR VALADARES/MG (MG e ES)",
  "ESCRITORIO DISTRITAL ITAITUBA/PA (RIO TAPAJOS)",
  "ESCRITORIO DISTRITAL JOAO PESSOA/PB (POTIGUARA)",
  "ESCRITORIO DISTRITAL LABREA/AM (MEDIO RIO PURUS)",
  "ESCRITORIO DISTRITAL LESTE DE RORAIMA/RR (LESTE DE RORAIMA)",
  "ESCRITORIO DISTRITAL MACAPA/AP (AMAPA E NORTE DO PARA)",
  "ESCRITORIO DISTRITAL MACEIO/AL (ALAGOAS E SERGIPE)",
  "ESCRITORIO DISTRITAL MANAUS/AM (MANAUS)",
  "ESCRITORIO DISTRITAL PALMAS/TO (TOCANTINS)",
  "ESCRITORIO DISTRITAL PARINTINS/AM (PARINTINS)",
  "ESCRITORIO DISTRITAL PORTO VELHO/RO (PORTO VELHO)",
  "ESCRITORIO DISTRITAL RECIFE/PE (PERNAMBUCO)",
  "ESCRITORIO DISTRITAL REDENCAO/PA (KAIAPO DO PARA)",
  "ESCRITORIO DISTRITAL RIO BRANCO/AC (ALTO RIO PURUS)",
  "ESCRITORIO DISTRITAL SALVADOR/BA (BAHIA)",
  "ESCRITORIO DISTRITAL SAO FELIX DO ARAGUAIA/MT (ARAGUAIA)",
  "ESCRITORIO DISTRITAL SAO GABRIEL DA CACHOEIRA/AM (RIO NEGRO)",
  "ESCRITORIO DISTRITAL SAO LUIS/MA (MARANHAO)",
  "ESCRITORIO DISTRITAL TABATINGA/AM (ALTO RIO SOLIMOES)",
  "ESCRITORIO DISTRITAL TEFE/AM (MEDIO RIO SOLIMOES)",
  "ESCRITORIO PARINTINS/AM (PARINTINS)",
  "ESCRITORIO RECIFE/PE (PERNAMBUCO)",
  "ESCRITORIO REGIONAL DA BAHIA",
  "ESCRITORIO REGIONAL DE PERNAMBUCO",
  "ESCRITORIO REGIONAL DE RORAIMA",
  "ESCRITORIO REGIONAL DE SAO PAULO",
  "ESCRITORIO REGIONAL DO AMAZONAS",
  "ESCRITORIO REGIONAL DO CENTRO-OESTE",
  "ESCRITORIO REGIONAL DO PARA",
  "ESCRITORIO REGIONAL DO PARANA",
  "ESCRITORIO TABATINGA/AM (ALTO RIO SOLIMOES)",
];

// Cargos e unidades vindos do banco (usados nas abas DSEI/SESAI e Sede AgSUS).
let cargosServidor = [];
let unidadesServidor = [];

// Preenche o <select> de cargo conforme o tipo de unidade:
// "distrital" usa a lista fixa CARGOS_DISTRITAL; os demais usam a lista do banco.
function popularCargos(tipo) {
  const valores = tipo === "distrital" ? CARGOS_DISTRITAL : cargosServidor;
  preencherSelectAcesso("acCargo", "Selecione o cargo / função", valores);
  adicionarOpcaoOutro("acCargo");
}

// Preenche o <select> de unidade conforme o tipo:
// "distrital" usa a lista fixa de escritórios; os demais usam DSEI/CASAI do banco.
// Também ajusta o rótulo do campo (Escritório x DSEI / CASAI).
function popularUnidade(tipo) {
  const ehDistrital = tipo === "distrital";
  const placeholder = ehDistrital ? "Selecione o escritório" : "Selecione o DSEI / CASAI";
  preencherSelectAcesso("acUnidade", placeholder, ehDistrital ? ESCRITORIOS_DISTRITAL : unidadesServidor);
  const lbl = document.querySelector('label[for="acUnidade"]');
  if (lbl) lbl.textContent = ehDistrital ? "Escritório" : "DSEI / CASAI";
}

// Exibe o campo "Informe o cargo" quando o cargo selecionado é "Outro".
function atualizarCargoOutro() {
  const wrap = document.querySelector('.acField[data-acfield="cargoOutro"]');
  if (!wrap) return;
  const campos = CAMPOS_POR_TIPO[tipoAcessoAtual] || CAMPOS_POR_TIPO.dsei;
  const ehOutro = val("acCargo") === VALOR_OUTRO;
  wrap.hidden = !(campos.includes("cargo") && ehOutro);
}

// Marca o botão ativo e mostra/oculta os campos conforme o tipo escolhido.
function aplicarTipoAcesso(tipo) {
  if (!CAMPOS_POR_TIPO[tipo]) tipo = "dsei";
  tipoAcessoAtual = tipo;
  document.querySelectorAll(".acTipoTab").forEach(b => {
    b.classList.toggle("active", b.dataset.actipo === tipo);
  });
  const visiveis = CAMPOS_POR_TIPO[tipo];
  document.querySelectorAll(".acField").forEach(div => {
    const campo = div.dataset.acfield;
    if (campo === "cargoOutro") return; // controlado por atualizarCargoOutro()
    div.hidden = !visiveis.includes(campo);
  });
  popularCargos(tipo);  // cargos dependem da aba (distrital = lista fixa)
  popularUnidade(tipo); // unidade: escritórios (distrital) ou DSEI/CASAI; ajusta o rótulo
  atualizarCargoOutro();
}

// Acrescenta a opção "Outro" ao <select> de cargo (uma única vez).
function adicionarOpcaoOutro(id) {
  const sel = el(id);
  if (!sel || sel.querySelector(`option[value="${VALOR_OUTRO}"]`)) return;
  const opt = document.createElement("option");
  opt.value = VALOR_OUTRO;
  opt.textContent = "Outro (não listado)";
  sel.appendChild(opt);
}

// Define o cargo no select; se o valor não existir na lista, usa "Outro" + texto livre.
function setCargo(valor) {
  const sel = el("acCargo");
  setVal("acCargoOutro", "");
  if (!sel) return;
  if (!valor) { sel.value = ""; return; }
  const existe = Array.from(sel.options).some(o => o.value === valor);
  if (existe) {
    sel.value = valor;
  } else {
    sel.value = VALOR_OUTRO;
    setVal("acCargoOutro", valor);
  }
}

// Deduz o tipo a partir dos campos preenchidos (ao editar uma solicitação existente).
function inferirTipo(atual) {
  if (!atual) return tipoAcessoAtual || "dsei";
  const unidade = atual.DSEI || atual.CASAI || "";
  const temDsei = !!unidade;
  const temCoord = !!atual.COORDENACAO;
  // Escritórios distritais são gravados no campo DSEI com prefixo "ESCRITORIO".
  if (/^ESCRITORIO/i.test(unidade)) return "distrital";
  if (temDsei && temCoord) return "distrital";
  if (temCoord) return "sede";
  if (temDsei) return "dsei";
  return tipoAcessoAtual || "dsei";
}
function fmtData(v) {
  if (!v) return "—";
  const s = String(v).replace("T", " ").slice(0, 16);
  return s || "—";
}

// Popula um <select> com as opções vindas do banco, preservando o valor atual.
// Wrapper sobre o preencherSelect compartilhado (apenas reordena os argumentos
// para a assinatura usada nesta tela: id, placeholder, valores).
function preencherSelectAcesso(id, placeholder, valores) {
  preencherSelect(id, valores, placeholder);
}

// Carrega DSEI/CASAI/coordenações/cargos do servidor (auto-sync com o banco).
let listasAcessoCarregadas = false;
async function carregarListasAcesso() {
  if (listasAcessoCarregadas) return;
  let listas;
  try { listas = await apiGet("/api/acesso/listas"); } catch (e) { return; }
  preencherSelectAcesso("acCoordenacao", "Selecione a coordenação", listas.coordenacoes);
  // DSEI e CASAI num único dropdown — as CASAIs vêm antes dos DSEIs.
  unidadesServidor = [].concat(listas.casai || [], listas.dsei || []);
  // Cargos/unidades do banco; a aba "Escritórios Distritais" usa listas fixas.
  cargosServidor = listas.cargos || [];
  popularCargos(tipoAcessoAtual);
  popularUnidade(tipoAcessoAtual);
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
  setVal("acCoordenacao", (atual && atual.COORDENACAO) || "");
  setVal("acJustificativa", (atual && atual.JUSTIFICATIVA) || "");
  // Aplica o tipo primeiro (popula cargos e unidades da aba) e só então define
  // cargo/unidade, para que as listas corretas já existam ao restaurar o valor salvo.
  aplicarTipoAcesso(inferirTipo(atual));
  setCargo((atual && atual.CARGO) || "");
  setVal("acUnidade", (atual && (atual.CASAI || atual.DSEI)) || "");
  atualizarCargoOutro();
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

  const campos = CAMPOS_POR_TIPO[tipoAcessoAtual] || CAMPOS_POR_TIPO.dsei;

  // Resolve o cargo, considerando o caso "Outro" (texto livre).
  let cargo = val("acCargo");
  if (cargo === VALOR_OUTRO) cargo = val("acCargoOutro").trim();

  // Campo unificado DSEI/CASAI: separa pelo prefixo da opção escolhida.
  const unidade = campos.includes("unidade") ? val("acUnidade") : "";
  const ehCasai = /^CASAI/i.test(unidade);

  // Envia apenas os campos pertinentes ao tipo escolhido (os demais vão vazios).
  const body = {
    tipo: tipoAcessoAtual,
    nome: val("acNome"),
    cargo: campos.includes("cargo") ? cargo : "",
    coordenacao: campos.includes("coordenacao") ? val("acCoordenacao") : "",
    dsei: ehCasai ? "" : unidade,
    casai: ehCasai ? unidade : "",
    justificativa: val("acJustificativa")
  };
  if (!body.justificativa.trim()) {
    if (erro) erro.innerText = "Informe a justificativa da necessidade de acesso.";
    return;
  }
  if (campos.includes("cargo") && val("acCargo") === VALOR_OUTRO && !cargo) {
    if (erro) erro.innerText = "Informe o cargo / função.";
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

  // Conceder privilégios e excluir usuários são ações exclusivas do super
  // administrador (nível >= 3). Esconde os controles para os demais.
  const souSuperAdmin = Number((state.painelLoginUsuario || {}).nivelAutorizacao || 0) >= NIVEL.SUPERADMIN;

  const acoes = comAcoes
    ? `<div class="solAcoes">
         <button type="button" class="solBtn solAprovar" data-acesso-aprovar="${id}">Aprovar</button>
         <button type="button" class="solBtn solRecusar" data-acesso-recusar="${id}">Recusar</button>
       </div>`
    : "";

  const botaoExcluir = souSuperAdmin
    ? `<button type="button" class="solExcluirBtn" title="Excluir usuário e suas solicitações" data-acesso-excluir="${email}"><i class="fa-solid fa-trash"></i></button>`
    : "";

  // Privilégio: só para usuários ATIVOS (aprovados) e gerenciável por super admin.
  const ativo = Number(s.USUARIO_ATIVO) === 1;
  const nivelAtual = Number(s.USUARIO_NIVEL || 0);
  const privilegio = (ativo && souSuperAdmin)
    ? `<div class="solPrivilegio">
         <label>Privilégio</label>
         <select class="solNivelSelect" data-acesso-nivel="${email}">
           <option value="1"${nivelAtual <= 1 ? " selected" : ""}>Usuário comum</option>
           <option value="2"${nivelAtual === 2 ? " selected" : ""}>Administrador</option>
           <option value="3"${nivelAtual >= 3 ? " selected" : ""}>Super administrador</option>
         </select>
       </div>`
    : "";

  return `
    <div class="solCard">
      <div class="solHead">
        <span class="solTag ${statusClasse}">${escapeHtml(s.STATUS)}</span>
        <span class="solHeadDir">
          <span class="solData">${escapeHtml(fmtData(s.CRIADO_EM))}</span>
          ${botaoExcluir}
        </span>
      </div>
      <div class="solGrid">${linhas}</div>
      <div class="solJustificativa"><span>Justificativa</span><p>${escapeHtml(s.JUSTIFICATIVA || "—")}</p></div>
      ${decisao}
      ${privilegio}
      ${acoes}
    </div>`;
}

export async function carregarSolicitacoesAdmin(silencioso) {
  const boxPend = el("solicitacoesPendentes");
  const boxHist = el("solicitacoesHistorico");
  if (!boxPend || !boxHist) return;

  // No polling (silencioso) não mostramos "Carregando…" para não piscar a tela.
  if (!silencioso) {
    boxPend.innerHTML = '<div class="solVazio">Carregando…</div>';
    boxHist.innerHTML = "";
  }

  let dados;
  try {
    dados = await apiGet("/api/acesso/solicitacoes");
  } catch (e) {
    if (!silencioso) boxPend.innerHTML = '<div class="solVazio">Não foi possível carregar as solicitações.</div>';
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
  const nomeNivel = nivel >= 3 ? "Super administrador" : (nivel === 2 ? "Administrador" : "Usuário comum");
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

// Polling do painel admin: atualiza a lista enquanto a aba está aberta,
// sem piscar a tela e sem atrapalhar uma ação em andamento.
let pollSolicitacoesTimer = null;
function podeAtualizarSolicitacoes() {
  const painel = el("view-solicitacoes");
  if (!painel || !painel.classList.contains("active")) return false; // só com a aba aberta
  const modal = el("acessoModal");
  if (modal && modal.style.display === "flex") return false;          // modal aberto
  // Admin mexendo num dropdown: os <select> viram combo pesquisável (.ssCombo),
  // cujo popup é um portal no <body>. Não re-renderizar (destruiria o combo).
  if (document.querySelector(".ssMenu")) return false;                // algum combo aberto
  const ae = document.activeElement;
  if (ae && (ae.classList.contains("ssTrigger") || ae.classList.contains("ssSearchInput")
      || (painel.contains(ae) && ae.tagName === "SELECT"))) return false;
  return true;
}
function iniciarPollSolicitacoes() {
  if (pollSolicitacoesTimer) return;
  pollSolicitacoesTimer = setInterval(() => {
    if (podeAtualizarSolicitacoes()) carregarSolicitacoesAdmin(true);
  }, 15000);
}

// ----------------------------------------------------------------------------
// Inicialização (chamada no init do app)
// ----------------------------------------------------------------------------
async function sair() {
  try { await apiPost("/api/logout", {}); } catch (e) {} // limpa o cookie HttpOnly no servidor
  try { localStorage.removeItem("painelLoginToken"); } catch (e) {} // resíduo de versões antigas
  window.location.reload();
}

export function configurarAcesso() {
  const form = el("acessoForm");
  if (form && !form.dataset.bound) {
    form.dataset.bound = "1";
    form.addEventListener("submit", enviarSolicitacao);
  }

  // Botões de tipo de unidade (DSEI/SESAI · Sede AgSUS · Escritórios Distritais).
  document.querySelectorAll(".acTipoTab").forEach(btn => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => aplicarTipoAcesso(btn.dataset.actipo));
  });
  // Mostra/oculta o campo de cargo livre quando "Outro" é selecionado.
  const cargoSel = el("acCargo");
  if (cargoSel && !cargoSel.dataset.bound) {
    cargoSel.dataset.bound = "1";
    cargoSel.addEventListener("change", atualizarCargoOutro);
  }
  aplicarTipoAcesso(tipoAcessoAtual);

  // Substitui os <select> da tela de acesso por dropdowns customizados
  // (glassmorphism no menu de opções). O <select> nativo segue como fonte de dados.
  configurarGlassDropdowns();
  ["acLogoutBtn", "acLogoutBtn2"].forEach(idBtn => {
    const b = el(idBtn);
    if (b && !b.dataset.bound) { b.dataset.bound = "1"; b.addEventListener("click", sair); }
  });
  const editar = el("acEditarBtn");
  if (editar && !editar.dataset.bound) {
    editar.dataset.bound = "1";
    editar.addEventListener("click", mostrarEstadoFormulario);
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

  iniciarPollSolicitacoes();
}
