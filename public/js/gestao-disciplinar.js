// =========================================================
// Gestão Disciplinar
// Renderiza a tabela de pedidos disciplinares a partir do backend
// (/api/disciplinar) e liga filtros/botões e o detalhamento do registro
// selecionado. Toda alteração (status, sanção, responsável, criação e exclusão)
// é persistida no banco via API e o registro afetado é recarregado.
// Obs.: por padrão do painel, as pessoas são sempre "trabalhadores".
// =========================================================
import { escapeHtml, escapeAttr, debounce, safeUrl } from "./utils.js";
import { criarToast, preencherSelect } from "./ui-utils.js";
import { state } from "./state.js";
import { apiGet, apiPost, authHeaders } from "./api.js";
import { nivelModulo } from "./permissoes.js";

// Pedidos carregados do backend (formato já pronto para a UI).
let REGISTROS = [];

// ---------- Mapas de classe das badges ----------
const BADGE_STATUS = {
  "Em análise": "is-analise",
  "Aguardando devolutiva do DSEI/Profissional": "is-aguardando",
  "Concluída": "is-concluida",
  "Pendente": "is-pendente",
  "Desligado antes da conclusão": "is-desligado",
  "Pedido fora do prazo": "is-foraprazo"
};
const BADGE_ATENDIMENTO = {
  "Totalmente": "is-total",
  "Parcialmente": "is-parcial",
  "Não atendido": "is-naoatendido"
};

// ---------- Fases do processo (funil linear, padrão da Entrega de Crachá) ----------
// As fases avançam uma a uma; não é possível pular etapas. "Desligado antes da
// conclusão" é um estado terminal alternativo (trabalhador desligado no meio).
const STATUS_FASES = ["Pendente", "Em análise", "Aguardando devolutiva do DSEI/Profissional", "Concluída"];
const STATUS_DESLIGADO = "Desligado antes da conclusão";
// "foraDoPrazo" é apenas um aviso (solicitação pelo DSEI fora do prazo): não
// bloqueia o processo, que segue normalmente pelo fluxo de fases.
const STATUS_FORA_PRAZO = "Pedido fora do prazo";
const STATUS_CONCLUIDA = "Concluída";
// Rótulo do botão que AVANÇA a partir de cada fase.
const AVANCO_LABEL = {
  "Pendente": "Assumir processo",
  "Em análise": "Enviar para devolutiva do DSEI/Profissional",
  "Aguardando devolutiva do DSEI/Profissional": "Concluir processo"
};

function pedidoConcluido(r) {
  return r?.statusAtual === STATUS_CONCLUIDA;
}

// Processo encerrado: não corre mais, então a contagem de dias pendentes congela.
function pedidoEncerrado(r) {
  return r?.statusAtual === STATUS_CONCLUIDA || r?.statusAtual === STATUS_DESLIGADO;
}

// Dias entre o início do pedido (data do pedido) e hoje. Para processos
// encerrados, conta até a data de encerramento (conclusão/desligamento),
// congelando o valor em vez de seguir crescendo.
function diasPendentes(r) {
  const ini = dataBr(r.dataPedido);
  if (!ini) return null;
  const fim = pedidoEncerrado(r)
    ? (dataBr(r.dataConclusao) || dataBr(r.ultimaAtualizacao) || new Date())
    : new Date();
  // Compara só a parte de data (dias civis), ignorando horas.
  const a = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate());
  const b = new Date(fim.getFullYear(), fim.getMonth(), fim.getDate());
  const dias = Math.round((b - a) / 86400000);
  return dias >= 0 ? dias : 0;
}

function diasPendentesLabel(r) {
  const d = diasPendentes(r);
  if (d == null) return "—";
  return `${d} dia${d === 1 ? "" : "s"}`;
}

// Data de conclusão de cada etapa do funil (índice em STATUS_FASES): Pendente é
// concluída ao iniciar a análise; Em análise, ao enviar ao DSEI; Aguardando, ao
// concluir. A etapa final ("Concluída") mostra a própria data de conclusão.
function dataConclusaoFase(r, i) {
  const datas = [r.dataInicioAnalise, r.dataEnvioDsei, r.dataConclusao, r.dataConclusao];
  const d = datas[i];
  return d && d !== "—" ? d : "";
}

// Rótulo de exibição do Tipo de Sanção: a suspensão mostra os dias junto.
function tipoSancaoDisplay(r) {
  if (r.tipoSancao === "Suspensão" && r.diasSuspensao) return `Suspensão (${r.diasSuspensao} dias)`;
  return r.tipoSancao || "—";
}

// Opções para edição em linha no detalhamento.
const STATUS_OPCOES = ["Em análise", "Aguardando devolutiva do DSEI/Profissional", "Concluída", "Pendente"];
const ATENDIMENTO_OPCOES = ["—", "Totalmente", "Parcialmente", "Não atendido"];

// Tipo de Sanção: somente as sanções aplicáveis. A quantidade de dias da
// "Suspensão" é informada num campo à parte (Dias de suspensão).
const SANCAO_OPCOES = ["—", "Advertência oral", "Advertência", "Suspensão",
  "Justa Causa", "Não Aplicada", "Em apuração"];

// Decisão: somente o artigo e as alíneas do Art. 482 da CLT (hipóteses de justa causa).
const DECISAO_OPCOES = [
  "—",
  "Art. 482, a) Ato de improbidade",
  "Art. 482, b) Incontinência de conduta ou mau procedimento",
  "Art. 482, c) Negociação habitual sem permissão ou concorrência à empresa",
  "Art. 482, d) Condenação criminal transitada em julgado",
  "Art. 482, e) Desídia no desempenho das funções",
  "Art. 482, f) Embriaguez habitual ou em serviço",
  "Art. 482, g) Violação de segredo da empresa",
  "Art. 482, h) Ato de indisciplina ou de insubordinação",
  "Art. 482, i) Abandono de emprego",
  "Art. 482, j) Ato lesivo da honra ou ofensas físicas (contra terceiros)",
  "Art. 482, k) Ato lesivo da honra ou ofensas físicas (contra empregador/superiores)",
  "Art. 482, l) Prática constante de jogos de azar",
  "Art. 482, m) Perda da habilitação por conduta dolosa"
];

// Campos editáveis em linha no detalhamento. Cada um define: rótulo na confirmação,
// chave(s) do registro a atualizar (a 1ª é a "fonte" do valor atual), o tipo de
// controle e o aviso de sucesso. "dataSancao" mantém dataSancao+dataAplicacao em sincronia.
const CAMPOS_EDITAVEIS = {
  status: { rotulo: "o status da demanda", chaves: ["statusAtual", "status"], tipo: "select", opcoes: STATUS_OPCOES, toast: "Status da demanda atualizado." },
  sancao: { rotulo: "a sanção aplicada", chaves: ["tipoSancao"], tipo: "select", opcoes: SANCAO_OPCOES, toast: "Sanção aplicada atualizada." },
  diasSuspensao: { rotulo: "os dias de suspensão", chaves: ["diasSuspensao"], tipo: "numero", toast: "Dias de suspensão atualizados." },
  atendimento: { rotulo: "o atendimento", chaves: ["atendimento"], tipo: "select", opcoes: ATENDIMENTO_OPCOES, toast: "Atendimento atualizado." },
  decisao: { rotulo: "o motivo", chaves: ["decisao"], tipo: "select", opcoes: DECISAO_OPCOES, toast: "Motivo atualizado." },
  dataSancao: { rotulo: "a data de aplicação da sanção", chaves: ["dataSancao", "dataAplicacao"], tipo: "data", toast: "Data de aplicação da sanção atualizada." },
  medidaParcial: { rotulo: "a medida adotada", chaves: ["medidaParcial"], tipo: "texto", toast: "Medida adotada atualizada." },
  motivoNaoAtendimento: { rotulo: "o motivo do não atendimento", chaves: ["motivoNaoAtendimento"], tipo: "texto", toast: "Motivo do não atendimento atualizado." },
  observacoesStatus: { rotulo: "as observações do status", chaves: ["observacoesStatus"], tipo: "texto", toast: "Observações do status atualizadas." },
  observacoesSancao: { rotulo: "a descrição da sanção aplicada", chaves: ["observacoesSancao"], tipo: "textarea", toast: "Descrição da sanção aplicada atualizada." }
};

// Campos da sanção viajam para /sancao; os demais para /demanda.
const CAMPOS_SANCAO = ["decisao", "sancao", "diasSuspensao", "dataSancao", "observacoesSancao"];

// É o responsável atual pelo pedido? (login do usuário == responsável gravado)
function ehResponsavel(r) {
  return !!r && !!r.responsavel && r.responsavel === loginResponsavel();
}

// Permissão para editar os campos do detalhamento do pedido. As edições do
// processo (status/fases, atendimento, sanção, observações, provas, etc.) são
// exclusivas do RESPONSÁVEL pelo pedido; o super administrador (nível >= 3) pode
// editar qualquer um. Os demais usuários apenas visualizam.
const NIVEL_SUPERADMIN_DISCIPLINAR = 3;
function podeEditarGestaoDisciplinar(r) {
  if (!r) return false;
  // Permissão efetiva no módulo (override por usuário ou nível global).
  const nivel = nivelModulo("gestaoDisciplinar");
  if (nivel < 2) return false;                               // Leitor: somente visualiza
  if (nivel >= NIVEL_SUPERADMIN_DISCIPLINAR) return true;    // Administrador: edita qualquer um
  return ehResponsavel(r);                                   // Editor: só os pedidos sob sua responsabilidade
}

// Quem pode anexar/remover anexos: o responsável pelo pedido (ou super admin).
function podeGerenciarAnexos(r) {
  return podeEditarGestaoDisciplinar(r);
}

// Rótulos amigáveis para o ENUM tipo_anexo da tabela PEDIDO_ANEXO.
const ANEXO_TIPO_LABEL = {
  PROVA: "Prova",
  OFICIO: "Ofício",
  MEMORANDO: "Memorando",
  RELATORIO: "Relatório",
  OUTRO: "Outro"
};

// Indicadores/ações restritos a administradores (nível >= 2, mesmo patamar das telas de admin).
const NIVEL_ADMIN_DISCIPLINAR = 2;
function ehAdminDisciplinar() {
  return nivelModulo("gestaoDisciplinar") >= NIVEL_ADMIN_DISCIPLINAR;
}

// Criar um novo pedido exige Editor (>= 2) no módulo — Leitor só visualiza.
function podeCriarPedidoDisciplinar() {
  return nivelModulo("gestaoDisciplinar") >= NIVEL_ADMIN_DISCIPLINAR;
}

// Ajusta a visão dos indicadores conforme o nível do usuário. "Tempo Médio p/
// Aplicação da Sanção" e o campo de delegação só aparecem para admin.
function aplicarVisibilidadeCardsDisciplinar() {
  const admin = ehAdminDisciplinar();

  // Criar pedido exige Editor (>= 2) no módulo; Leitor não vê o botão "Novo Pedido".
  const btnNovo = document.getElementById("gdBtnNovo");
  if (btnNovo) btnNovo.style.display = podeCriarPedidoDisciplinar() ? "" : "none";
  const cardTempo = document.getElementById("gdKpiTempoMedio")?.closest(".gfKpi");
  if (cardTempo) cardTempo.style.display = admin ? "" : "none";
  // Usa display (não o atributo hidden): .gfField tem `display: grid`, que
  // sobrescreveria o hidden e deixaria a caixa visível para o usuário comum.
  const campoResp = document.getElementById("gdFResponsavelField");
  if (campoResp) campoResp.style.display = admin ? "" : "none";
  if (admin) carregarAdminsDelegaveis();
}

// Login do usuário logado para vincular como responsável. Se for um e-mail,
// usa só a parte antes do "@".
function loginResponsavel() {
  const u = state.painelLoginUsuario || {};
  const base = String(u.login || u.email || u.nome || "").trim();
  return base.includes("@") ? base.split("@")[0] : base;
}

function badge(texto, mapa) {
  if (!texto || texto === "—") return "—";
  const cls = mapa[texto] || "is-pendente";
  return `<span class="gfBadge ${cls}">${escapeHtml(texto)}</span>`;
}

const $ = id => document.getElementById(id);

// ---------- Toast simples ----------
// Reaproveita a classe visual `gfToast`; controlador compartilhado em ui-utils.
const gdToast = criarToast("gdToast", { className: "gfToast" });

// ---------- Filtros ----------
function preencherFiltros() {
  const unicos = chave => [...new Set(REGISTROS.map(r => r[chave]).filter(v => v && v !== "—"))];
  preencherSelect("gdFiltroDsei", unicos("dsei"), "Todos os DSEIs/CASAIs");
  preencherSelect("gdFiltroStatus", unicos("status"), "Todos os Status");
}

// Popula a lista de autocompletar de DSEIs do formulário (a de trabalhadores é
// preenchida dinamicamente pela busca no backend — ver buscarTrabalhadores).
function preencherDatalists() {
  const dseis = $("gdListaDseis");
  if (dseis) {
    const lista = [...new Set(REGISTROS.map(r => r.dsei).filter(v => v && v !== "—"))];
    dseis.innerHTML = lista.map(v => `<option value="${escapeHtml(v)}">`).join("");
  }
}

// ---------- Delegação de responsável (somente administradores) ----------
// Lista de administradores ativos aptos a editar/assumir processos. É buscada
// do backend de controle de acesso e usada para popular a caixa de delegação.
let ADMINS_DELEGAVEIS = [];

// Deriva o login (parte antes do "@") a partir de um e-mail.
function loginDeEmail(email) {
  const base = String(email || "").trim();
  return base.includes("@") ? base.split("@")[0] : base;
}

// Busca os usuários ativos com nível de administrador (>= NIVEL_ADMIN_DISCIPLINAR).
// O endpoint exige nível de admin, então só roda para administradores.
async function carregarAdminsDelegaveis() {
  if (!ehAdminDisciplinar()) return;
  let dados;
  try { dados = await apiGet("/api/acesso/solicitacoes"); }
  catch (e) { return; }
  const linhas = [...(dados.pendentes || []), ...(dados.historico || [])];
  const porLogin = new Map();
  linhas.forEach(s => {
    const ativo = Number(s.USUARIO_ATIVO) === 1;
    const nivel = Number(s.USUARIO_NIVEL || 0);
    const login = loginDeEmail(s.EMAIL);
    if (!login || !ativo || nivel < NIVEL_ADMIN_DISCIPLINAR) return;
    if (!porLogin.has(login)) porLogin.set(login, { login, nome: String(s.NOME || "").trim() });
  });
  ADMINS_DELEGAVEIS = [...porLogin.values()].sort((a, b) => a.login.localeCompare(b.login));
  preencherSelectResponsavel();
}

// Reconstrói as opções da caixa de delegação a partir do cache de admins.
function preencherSelectResponsavel() {
  const sel = $("gdFResponsavel");
  if (!sel) return;
  const atual = sel.value;
  sel.innerHTML = `<option value="">Sem responsável</option>` +
    ADMINS_DELEGAVEIS.map(a =>
      `<option value="${escapeHtml(a.login)}">${escapeHtml(a.login)}${a.nome ? ` — ${escapeHtml(a.nome)}` : ""}</option>`
    ).join("");
  if (atual && ADMINS_DELEGAVEIS.some(a => a.login === atual)) sel.value = atual;
}

// Converte "dd/mm/aaaa" para Date (para comparar com os inputs de data).
function dataBr(str) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(str || "").trim());
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

// Filtro rápido "processos em que eu sou o responsável".
let filtroMeusProcessos = false;

function registrosFiltrados() {
  const dsei = $("gdFiltroDsei")?.value || "";
  const status = $("gdFiltroStatus")?.value || "";
  const buscaProcesso = ($("gdBuscaProcessoSei")?.value || "").trim().toLowerCase();
  const buscaNome = ($("gdBuscaNome")?.value || "").trim().toLowerCase();
  const buscaPedido = ($("gdBuscaPedido")?.value || "").trim().toLowerCase();
  const buscaResp = ($("gdBuscaResponsavel")?.value || "").trim().toLowerCase();
  const meuLogin = filtroMeusProcessos ? loginResponsavel() : "";

  return REGISTROS.filter(r => {
    if (filtroMeusProcessos && r.responsavel !== meuLogin) return false;
    if (dsei && r.dsei !== dsei) return false;
    if (status && r.status !== status) return false;
    if (buscaProcesso && !String(r.processo || "").toLowerCase().includes(buscaProcesso)) return false;
    if (buscaNome && !r.trabalhador.toLowerCase().includes(buscaNome)) return false;
    if (buscaResp && !String(r.responsavel || "").toLowerCase().includes(buscaResp)) return false;
    if (buscaPedido) {
      const alvo = `${r.processo} ${r.pedido} ${r.motivo}`.toLowerCase();
      if (!alvo.includes(buscaPedido)) return false;
    }
    return true;
  });
}

// ---------- Renderização da tabela ----------
let pedidoSelecionadoId = null; // id único do pedido selecionado (não o nº de processo, que pode repetir)
// Edição inline dos dados-base do pedido no próprio detalhamento (botão "Alterar").
let editandoDados = false;

function renderTabela() {
  const body = $("gdTableBody");
  const info = $("gdTableInfo");
  if (!body) return;
  const linhas = registrosFiltrados();

  body.innerHTML = linhas.map(r => `
    <tr class="gdRow${r.id === pedidoSelecionadoId ? " is-selected" : ""}" data-gd-id="${r.id}">
      <td class="gfTd-center">${diasPendentesLabel(r)}</td>
      <td>${r.foraDoPrazo ? `<i class="fa-solid fa-triangle-exclamation gdAvisoPrazo" title="Solicitação pelo DSEI fora do prazo"></i> ` : ""}${escapeHtml(r.processo)}</td>
      <td>${escapeHtml(r.dsei)}</td>
      <td>${escapeHtml(r.trabalhador)}</td>
      <td>${escapeHtml(r.cargo)}</td>
      <td>${escapeHtml(r.polo)}</td>
      <td>${escapeHtml(r.ocorrencia)}</td>
      <td>${escapeHtml(r.pedido)}</td>
      <td>${badge(r.status, BADGE_STATUS)}</td>
      <td>${badge(r.atendimento, BADGE_ATENDIMENTO)}</td>
      <td>${escapeHtml(tipoSancaoDisplay(r))}</td>
      <td>${escapeHtml(r.dataSancao)}</td>
      <td>${escapeHtml(r.dataPedido)}</td>
      <td>${escapeHtml(r.responsavel || "—")}</td>
    </tr>`).join("") ||
    `<tr><td colspan="14" class="gfTd-center">Nenhum registro para os filtros selecionados.</td></tr>`;

  if (info) info.textContent = `Mostrando ${linhas.length} de ${REGISTROS.length} pedidos`;
}

// ---------- Detalhamento do registro selecionado ----------
function kv(rotulo, valor) {
  return `<div class="gdKv"><span>${escapeHtml(rotulo)}</span><strong>${escapeHtml(valor || "—")}</strong></div>`;
}

// "dd/mm/aaaa" -> "aaaa-mm-dd" (para preencher <input type="date">). Vazio se não casar.
function brParaIso(valor) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(valor || "").trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

// <select> de edição em linha; garante que o valor atual esteja entre as opções.
function gdSelect(campo, valor, opcoes) {
  const lista = [...new Set([valor, ...opcoes].filter(v => v != null && v !== ""))];
  const opts = lista.map(o =>
    `<option value="${escapeHtml(o)}"${o === valor ? " selected" : ""}>${escapeHtml(o)}</option>`).join("");
  return `<select class="gdEditField" data-gd-campo="${campo}">${opts}</select>`;
}

// Opções do "Pedido de Medida" (mesmas do formulário de cadastro).
const PEDIDO_MEDIDA_OPCOES = ["Sem indicação", "Advertência", "Suspensão", "Justa Causa"];

// Campo de edição inline dos dados-base do pedido (marcado com data-gd-base). É
// gravado em lote pelo botão "Salvar alterações", separado da edição por campo da
// demanda/sanção (data-gd-campo, que grava na hora).
function baseEditField(rotulo, campo, valor, tipo) {
  const limpo = valor && valor !== "—" && valor !== "(sem nº SEI)" ? valor : "";
  let controle;
  if (tipo === "data") {
    controle = `<input type="date" class="gdEditField" data-gd-base="${campo}" value="${escapeHtml(brParaIso(valor))}">`;
  } else if (tipo === "textarea") {
    controle = `<textarea class="gdEditField gdEditTextarea" data-gd-base="${campo}" rows="4" placeholder="—">${escapeHtml(limpo)}</textarea>`;
  } else if (tipo === "selectPedido") {
    const atual = limpo || "Sem indicação";
    const opts = [...new Set([atual, ...PEDIDO_MEDIDA_OPCOES])].map(o =>
      `<option value="${escapeHtml(o)}"${o === atual ? " selected" : ""}>${escapeHtml(o)}</option>`).join("");
    controle = `<select class="gdEditField" data-gd-base="${campo}">${opts}</select>`;
  } else {
    controle = `<input type="text" class="gdEditField" data-gd-base="${campo}" value="${escapeHtml(limpo)}" placeholder="—">`;
  }
  return `<div class="gdKv gdKvEdit"><span>${escapeHtml(rotulo)}</span>${controle}</div>`;
}

// Renderiza um campo do detalhamento: editável (controle conforme o tipo) quando há
// permissão, ou somente leitura (kv) caso contrário.
function campoEditavel(rotulo, campo, valor, podeEditar) {
  if (!podeEditar) return kv(rotulo, valor);
  const cfg = CAMPOS_EDITAVEIS[campo];
  let controle;
  if (cfg.tipo === "select") {
    controle = gdSelect(campo, valor, cfg.opcoes);
  } else if (cfg.tipo === "data") {
    controle = `<input type="date" class="gdEditField" data-gd-campo="${campo}" value="${escapeHtml(brParaIso(valor))}">`;
  } else if (cfg.tipo === "numero") {
    const v = (valor || valor === 0) ? String(valor) : "";
    controle = `<input type="number" min="1" step="1" class="gdEditField" data-gd-campo="${campo}" value="${escapeHtml(v)}" placeholder="dias">`;
  } else if (cfg.tipo === "textarea") {
    const v = valor && valor !== "—" ? valor : "";
    controle = `<textarea class="gdEditField gdEditTextarea" data-gd-campo="${campo}" rows="3" placeholder="—">${escapeHtml(v)}</textarea>`;
  } else {
    const v = valor && valor !== "—" ? valor : "";
    controle = `<input type="text" class="gdEditField" data-gd-campo="${campo}" value="${escapeHtml(v)}" placeholder="—">`;
  }
  return `<div class="gdKv gdKvEdit"><span>${escapeHtml(rotulo)}</span>${controle}</div>`;
}

// Limpa o painel de detalhamento (lista vazia / nada selecionado).
function limparDetalhe(mensagem) {
  // Sem pedido selecionado, esconde o painel inteiro (evita o bloco vazio).
  const painel = $("gdDetPanel");
  if (painel) painel.style.display = "none";
  const titulo = $("gdDetTitulo");
  if (titulo) titulo.innerHTML = `<span class="gdDetTituloTxt">${escapeHtml(mensagem || "Nenhum pedido selecionado")}</span>`;
  ["gdDetDados", "gdDetStatus", "gdDetSancao", "gdDetAnexos"].forEach(id => { const el = $(id); if (el) el.innerHTML = ""; });
}

function renderDetalhe(id) {
  const r = REGISTROS.find(x => x.id === id) || REGISTROS[0];
  if (!r) { limparDetalhe(); return; }
  const painel = $("gdDetPanel");
  if (painel) painel.style.display = "";
  pedidoSelecionadoId = r.id;
  const podeEditar = podeEditarGestaoDisciplinar(r);
  const sancaoLiberada = podeEditar && pedidoConcluido(r);

  const titulo = $("gdDetTitulo");
  if (titulo) {
    const meuLogin = loginResponsavel();
    const ehResp = !!r.responsavel && r.responsavel === meuLogin;
    const respLabel = r.responsavel && !ehResp
      ? `<span class="gdRespAtual"><i class="fa-solid fa-user-check"></i> Resp.: ${escapeHtml(r.responsavel)}</span>`
      : "";
    // Corrigir os dados do pedido (erros de digitação) direto no detalhamento:
    // disponível para quem pode editar o pedido (responsável ou super admin).
    const botaoAlterar = podeEditar && !editandoDados
      ? `<button type="button" class="gfBtn gfBtnGhost gdAlterarBtn" data-gd-alterar="${r.id}">
          <i class="fa-solid fa-pen"></i> Alterar
        </button>`
      : "";
    // Assumir a responsabilidade e excluir são exclusivos de administradores.
    const botaoAssumir = ehAdminDisciplinar()
      ? `<button type="button" class="gfBtn gdAssumirBtn" data-gd-assumir="${r.id}"${ehResp ? " disabled" : ""}>
          <i class="fa-solid fa-user-shield"></i> ${ehResp ? "Você é o responsável" : "Assumir a responsabilidade"}
        </button>`
      : "";
    const botaoExcluir = ehAdminDisciplinar()
      ? `<button type="button" class="gfBtn gfBtnGhost gdExcluirBtn" data-gd-excluir="${r.id}">
          <i class="fa-solid fa-trash"></i> Excluir
        </button>`
      : "";
    titulo.innerHTML = `
      <span class="gdDetTituloTxt">${escapeHtml(r.processo)} — ${escapeHtml(r.trabalhador)} ${badge(r.statusAtual, BADGE_STATUS)}</span>
      <span class="gdDetTituloAcoes">
        ${respLabel}
        ${botaoAlterar}
        ${botaoAssumir}
        ${botaoExcluir}
      </span>`;
  }

  const dados = $("gdDetDados");
  if (dados) {
    const avisoPrazo = r.foraDoPrazo
      ? `<div class="gdKv"><span></span><strong><span class="gdTagPrazo"><i class="fa-solid fa-triangle-exclamation"></i> Solicitação pelo DSEI fora do prazo</span></strong></div>`
      : "";
    // Atendimento/medida/motivo seguem com a edição por campo (gravam na hora) nos
    // dois modos; os demais dados-base só viram campos no modo "Alterar".
    const demanda =
      campoEditavel("Atendimento", "atendimento", r.atendimento, podeEditar) +
      campoEditavel("Medida adotada (parcial)", "medidaParcial", r.medidaParcial, podeEditar) +
      campoEditavel("Motivo do não atendimento", "motivoNaoAtendimento", r.motivoNaoAtendimento, podeEditar);

    if (editandoDados && podeEditar) {
      dados.innerHTML =
        avisoPrazo +
        `<div class="gdEditAviso"><i class="fa-solid fa-pen"></i> Corrigindo os dados do pedido — as alterações só são gravadas ao clicar em “Salvar alterações”.</div>` +
        baseEditField("Trabalhador", "trabalhador", r.trabalhador, "texto") +
        baseEditField("Matrícula", "matricula", r.matricula, "texto") +
        baseEditField("Cargo", "cargo", r.cargo, "texto") +
        baseEditField("DSEI/CASAI", "dsei", r.dsei, "texto") +
        baseEditField("Polo Base", "polo", r.polo, "texto") +
        baseEditField("Pedido", "pedido", r.pedido, "selectPedido") +
        baseEditField("Data da Ocorrência", "ocorrencia", r.ocorrencia, "data") +
        baseEditField("Data do Pedido", "dataPedido", r.dataPedido, "data") +
        baseEditField("Nº do Processo SEI", "processo", r.processo, "texto") +
        demanda +
        baseEditField("Resumo do processo", "resumo", r.resumo, "textarea") +
        `<div class="gdEditAcoes">
           <button type="button" class="gfBtn gfBtnGhost" data-gd-edit-cancelar><i class="fa-solid fa-xmark"></i> Cancelar</button>
           <button type="button" class="gfBtn" data-gd-edit-salvar><i class="fa-solid fa-floppy-disk"></i> Salvar alterações</button>
         </div>`;
    } else {
      dados.innerHTML =
        avisoPrazo +
        kv("Trabalhador", r.trabalhador) +
        kv("Matrícula", r.matricula) +
        kv("Cargo", r.cargo) +
        kv("DSEI/CASAI", r.dsei) +
        kv("Polo Base", r.polo) +
        kv("Pedido", r.pedido) +
        kv("Data da Ocorrência", r.ocorrencia) +
        kv("Data do Pedido", r.dataPedido) +
        demanda +
        kv("Nº do Processo SEI", r.processo) +
        `<div class="gdResumo"><span>Resumo do processo</span><p>${escapeHtml(r.resumo)}</p></div>`;
    }
  }

  const statusBox = $("gdDetStatus");
  if (statusBox) {
    const idxFase = STATUS_FASES.indexOf(r.statusAtual);
    const desligado = r.statusAtual === STATUS_DESLIGADO;
    const concluido = r.statusAtual === "Concluída";

    const linhaStatus = `<div class="gdKv"><span>Status atual</span><strong>${badge(r.statusAtual, BADGE_STATUS)}</strong></div>`;

    let stepper = "";
    let acoes = "";

    // Linha do tempo das fases (não é possível pular etapas). O pedido fora do
    // prazo é apenas um aviso e não impede a movimentação do processo. Cada etapa
    // concluída exibe a data em que foi concluída (avançou para a seguinte).
    stepper = `<div class="gdStepper">` + STATUS_FASES.map((f, i) => {
      const cls = desligado ? "" : (i === idxFase ? "is-atual" : (idxFase > i ? "is-feito" : ""));
      const data = dataConclusaoFase(r, i);
      const ehFinal = i === STATUS_FASES.length - 1;
      const dataHtml = data ? `<small class="gdStepData"><i class="fa-solid fa-check"></i> ${escapeHtml(data)}</small>` : "";
      const titulo = data ? ` title="${ehFinal ? "Concluído" : "Etapa concluída"} em ${escapeAttr(data)}"` : "";
      return `<span class="gdStep ${cls}"${titulo}>${i + 1}. ${escapeHtml(f)}${dataHtml}</span>`;
    }).join("") + `</div>`;

    // Ações de fase (padrão da Entrega de Crachá: só a transição válida é habilitada).
    if (podeEditar) {
      if (desligado) {
        acoes = `<button type="button" class="gfBtn gfBtnGhost gdFaseBtn" data-gd-fase="reativar"><i class="fa-solid fa-rotate-left"></i> Reativar processo</button>`;
      } else {
        const proximo = idxFase >= 0 && idxFase < STATUS_FASES.length - 1 ? STATUS_FASES[idxFase + 1] : null;
        const btnAvancar = proximo
          ? `<button type="button" class="gfBtn gdFaseBtn" data-gd-fase="avancar"><i class="fa-solid fa-arrow-right"></i> ${escapeHtml(AVANCO_LABEL[r.statusAtual] || `Avançar para ${proximo}`)}</button>`
          : "";
        const btnVoltar = idxFase > 0
          ? `<button type="button" class="gfBtn gfBtnGhost gdFaseBtn" data-gd-fase="voltar"><i class="fa-solid fa-arrow-left"></i> Voltar fase</button>`
          : "";
        const btnDeslig = !concluido
          ? `<button type="button" class="gfBtn gdFaseBtn gdBtnDesligar" data-gd-fase="desligar"><i class="fa-solid fa-user-xmark"></i> Desligado antes da conclusão</button>`
          : "";
        acoes = btnAvancar + btnVoltar + btnDeslig;
      }
      acoes = `<div class="gdFaseAcoes">${acoes}</div>`;
    }

    statusBox.innerHTML =
      linhaStatus +
      stepper +
      acoes +
      kv("Última atualização", r.ultimaAtualizacao) +
      kv("Data do pedido", r.dataPedido) +
      campoEditavel("Observações", "observacoesStatus", r.observacoesStatus, podeEditar);
  }

  const sancao = $("gdDetSancao");
  if (sancao) {
    const comprovanteChip = r.comprovante
      ? `<div class="gfFileChip"><i class="fa-solid fa-file-pdf"></i><span>${escapeHtml(r.comprovante)}</span>${
          r.comprovanteUrl
            ? `<a class="gfIconBtn" href="${escapeAttr(safeUrl(r.comprovanteUrl))}" target="_blank" rel="noopener noreferrer" title="Abrir"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>`
            : `<button class="gfIconBtn" data-gd-baixar="${escapeHtml(r.comprovante)}" title="Baixar"><i class="fa-solid fa-download"></i></button>`
        }</div>`
      : `<div class="gdKv"><span>Comprovante (anexo)</span><strong>—</strong></div>`;
    const comprovanteUpload = sancaoLiberada
      ? `<label class="gdUploadTermo"><i class="fa-solid fa-upload"></i> ${r.comprovante ? "Substituir termo (PDF)" : "Enviar termo (PDF)"}<input type="file" accept="application/pdf" data-gd-upload="comprovante" hidden></label>`
      : "";
    const avisoSancao = sancaoLiberada
      ? ""
      : `<div class="gdKv"><span>Sanção</span><strong><span class="gdTagPrazo"><i class="fa-solid fa-lock"></i> Edição bloqueada até a conclusão do pedido</span></strong></div>`;
    sancao.innerHTML =
      avisoSancao +
      campoEditavel("Motivo", "decisao", r.decisao, sancaoLiberada) +
      campoEditavel("Tipo de Sanção", "sancao", r.tipoSancao, sancaoLiberada) +
      (r.tipoSancao === "Suspensão"
        ? campoEditavel("Dias de suspensão", "diasSuspensao", r.diasSuspensao, sancaoLiberada)
        : "") +
      campoEditavel("Data da Aplicação", "dataSancao", r.dataAplicacao, sancaoLiberada) +
      kv("Aplicada por", r.aplicadaPor) +
      kv("Documento Comprobatório", r.documento) +
      comprovanteChip +
      comprovanteUpload +
      campoEditavel("Descrição da sanção aplicada", "observacoesSancao", r.observacoesSancao, sancaoLiberada);
  }

  const anexos = $("gdDetAnexos");
  if (anexos) {
    const podeGerenciar = podeGerenciarAnexos(r);
    const lista = (r.anexos || []).map(a => {
      const icone = a.ehLink ? "fa-link" : "fa-file-pdf";
      const tag = `<span class="gdAnexoTag">${escapeHtml(ANEXO_TIPO_LABEL[a.tipo] || a.tipo || "Anexo")}</span>`;
      const acao = a.disponivel
        ? `<a class="gfIconBtn" href="${escapeAttr(safeUrl(a.url))}" target="_blank" rel="noopener noreferrer" title="${a.ehLink ? "Abrir" : "Baixar"}"><i class="fa-solid ${a.ehLink ? "fa-arrow-up-right-from-square" : "fa-download"}"></i></a>`
        : "";
      const remover = (podeGerenciar && a.id)
        ? `<button class="gfIconBtn" data-gd-anexo-excluir="${escapeAttr(a.id)}" title="Remover anexo"><i class="fa-solid fa-trash"></i></button>`
        : "";
      return `<div class="gfFileChip">
        <i class="fa-solid ${icone}"></i>
        <span>${escapeHtml(a.nome)}<small>${tag} · ${escapeHtml(a.info)}${a.data ? ` · ${escapeHtml(a.data)}` : ""}</small></span>
        ${acao}${remover}
      </div>`;
    }).join("");
    const addCtrl = podeGerenciar
      ? `<div class="gdAnexoAdd">
          <select class="gfSelect gdAnexoTipo" id="gdAnexoTipo" aria-label="Tipo de anexo">
            ${Object.entries(ANEXO_TIPO_LABEL).map(([v, l]) => `<option value="${v}">${escapeHtml(l)}</option>`).join("")}
          </select>
          <label class="gfBtn gfBtnGhost gdAddAnexos"><i class="fa-solid fa-paperclip"></i> Adicionar anexos<input type="file" multiple data-gd-anexo hidden></label>
        </div>`
      : "";
    anexos.innerHTML = (lista || `<div class="gdKv"><span>Anexos</span><strong>—</strong></div>`) + addCtrl;
  }

  // Reflete a seleção na tabela.
  document.querySelectorAll(".gdRow").forEach(tr => {
    tr.classList.toggle("is-selected", Number(tr.dataset.gdId) === r.id);
  });
}

// ---------- Carga e sincronização com o backend ----------
async function carregarPedidos() {
  try {
    const dados = await apiGet("/api/disciplinar");
    REGISTROS = Array.isArray(dados.pedidos) ? dados.pedidos : [];
  } catch (e) {
    REGISTROS = [];
    gdToast(e && e.message ? e.message : "Não foi possível carregar os pedidos disciplinares.", "erro");
  }
  if (!REGISTROS.some(r => r.id === pedidoSelecionadoId)) {
    pedidoSelecionadoId = REGISTROS[0] ? REGISTROS[0].id : null;
  }
  preencherFiltros();
  preencherDatalists();
  renderIndicadores();
  renderTabela();
  renderDetalhe(pedidoSelecionadoId);
}

// Substitui localmente o registro alterado pelo retorno da API e re-renderiza,
// preservando a seleção. Evita recarregar a lista inteira a cada edição.
function aplicarPedidoAtualizado(pedido) {
  if (!pedido) return;
  const i = REGISTROS.findIndex(r => r.id === pedido.id);
  if (i >= 0) REGISTROS[i] = pedido; else REGISTROS.unshift(pedido);
  pedidoSelecionadoId = pedido.id;
  preencherFiltros();
  preencherDatalists();
  renderIndicadores();
  renderTabela();
  renderDetalhe(pedido.id);
}

// Executa uma mutação, aplica o pedido retornado e mostra o toast; em erro,
// re-renderiza para reverter o controle ao valor anterior.
async function enviarMutacao(fn, msgOk) {
  try {
    const resp = await fn();
    if (resp && resp.pedido) aplicarPedidoAtualizado(resp.pedido);
    if (msgOk) gdToast(msgOk);
    return true;
  } catch (e) {
    gdToast(e && e.message ? e.message : "Falha ao salvar a alteração.", "erro");
    renderDetalhe(pedidoSelecionadoId);
    return false;
  }
}

// ---------- Edição em linha com confirmação ----------
// Caixa de diálogo de confirmação. Resolve para true (confirmar) ou false (cancelar).
function gdConfirmar(mensagem, opts = {}) {
  return new Promise(resolve => {
    const overlay = $("gdConfirmOverlay");
    if (!overlay) { resolve(window.confirm(mensagem)); return; }
    const card = overlay.querySelector(".gdConfirmCard");
    const titulo = $("gdConfirmTitulo");
    const msg = $("gdConfirmMsg");
    const btnOk = $("gdConfirmOk");
    const btnCancel = $("gdConfirmCancelar");
    if (msg) msg.textContent = mensagem;
    if (titulo) titulo.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(opts.titulo || "Confirmar alteração")}`;
    if (btnOk) btnOk.innerHTML = `<i class="fa-solid fa-check"></i> ${escapeHtml(opts.okTexto || "Confirmar alteração")}`;
    if (btnCancel) btnCancel.textContent = opts.cancelTexto || "Cancelar";
    if (card) card.classList.toggle("is-aviso", !!opts.amarelo);
    overlay.hidden = false;
    document.body.style.overflow = "hidden";

    const finalizar = valor => {
      overlay.hidden = true;
      document.body.style.overflow = "";
      btnOk.removeEventListener("click", onOk);
      btnCancel.removeEventListener("click", onCancel);
      overlay.removeEventListener("click", onOverlay);
      resolve(valor);
    };
    const onOk = () => finalizar(true);
    const onCancel = () => finalizar(false);
    const onOverlay = e => { if (e.target === overlay) finalizar(false); };
    btnOk.addEventListener("click", onOk);
    btnCancel.addEventListener("click", onCancel);
    overlay.addEventListener("click", onOverlay);
  });
}

// Aplica a alteração de um campo do detalhamento após confirmação; persiste no
// backend (demanda ou sanção conforme o campo).
async function aplicarAlteracao(campo, novoValor) {
  const r = REGISTROS.find(x => x.id === pedidoSelecionadoId);
  const cfg = CAMPOS_EDITAVEIS[campo];
  if (!r || !cfg) return;

  if (CAMPOS_SANCAO.includes(campo) && !pedidoConcluido(r)) {
    gdToast("A sanção só pode ser editada quando o pedido estiver concluído.", "erro");
    renderDetalhe(pedidoSelecionadoId);
    return;
  }

  let valor = String(novoValor ?? "").trim();
  if (cfg.tipo === "data") valor = valor ? dataParaBr(valor) : "—";
  else if ((cfg.tipo === "texto" || cfg.tipo === "textarea") && valor === "") valor = "—";

  const atual = r[cfg.chaves[0]] ?? "";
  if (valor === String(atual)) { renderDetalhe(pedidoSelecionadoId); return; }

  const ok = await gdConfirmar(`Deseja realmente alterar ${cfg.rotulo} de "${atual || "—"}" para "${valor || "—"}"?`);
  if (!ok) { renderDetalhe(pedidoSelecionadoId); return; }

  if (CAMPOS_SANCAO.includes(campo)) {
    const chave = campo === "sancao" ? "tipoSancao" : campo;
    await enviarMutacao(() => apiPost(`/api/disciplinar/${r.id}/sancao`, { [chave]: valor }), cfg.toast);
  } else {
    await enviarMutacao(() => apiPost(`/api/disciplinar/${r.id}/demanda`, { [campo]: valor }), cfg.toast);
  }
}

// ---------- Edição inline dos dados-base do pedido (botão "Alterar") ----------
function entrarEdicaoDados() {
  editandoDados = true;
  renderDetalhe(pedidoSelecionadoId);
}

function cancelarEdicaoDados() {
  editandoDados = false;
  renderDetalhe(pedidoSelecionadoId);
}

// Coleta os campos data-gd-base do detalhamento e grava todos de uma vez. As datas
// saem em ISO (input date); o backend aceita ISO e dd/mm/aaaa.
async function salvarEdicaoDados() {
  const r = REGISTROS.find(x => x.id === pedidoSelecionadoId);
  if (!r) return;
  const campos = {};
  document.querySelectorAll("#gdDetDados [data-gd-base]").forEach(el => {
    campos[el.dataset.gdBase] = (el.value || "").trim();
  });
  if (!campos.trabalhador || !campos.dsei) { gdToast("Informe ao menos o trabalhador e o DSEI/CASAI.", "erro"); return; }
  if (!campos.matricula) { gdToast("A matrícula é obrigatória.", "erro"); return; }
  if (!campos.processo) { gdToast("Informe o nº do Processo SEI.", "erro"); return; }

  const ok = await gdConfirmar(`Deseja salvar as alterações nos dados do pedido "${r.processo}"?`, {
    titulo: "Salvar alterações", okTexto: "Sim, salvar", cancelTexto: "Cancelar"
  });
  if (!ok) return;

  try {
    const resp = await apiPost(`/api/disciplinar/${r.id}/pedido`, campos);
    editandoDados = false;
    if (resp && resp.pedido) aplicarPedidoAtualizado(resp.pedido);
    gdToast("Dados do pedido atualizados.");
  } catch (e) {
    // Mantém o modo de edição (sem re-render) para o usuário corrigir sem perder o digitado.
    gdToast(e && e.message ? e.message : "Falha ao salvar as alterações.", "erro");
  }
}

// Upload do termo (comprovante) na Sanção Aplicada, com confirmação. O binário não
// é armazenado pelo backend (sem storage de arquivo): grava-se apenas o nome.
async function aplicarUploadTermo(arquivo) {
  if (!arquivo) return;
  const r = REGISTROS.find(x => x.id === pedidoSelecionadoId);
  if (!r) return;
  if (!pedidoConcluido(r)) {
    gdToast("O termo da sanção só pode ser enviado quando o pedido estiver concluído.", "erro");
    renderDetalhe(pedidoSelecionadoId);
    return;
  }
  const acao = r.comprovante ? "substituir" : "enviar";
  const ok = await gdConfirmar(`Deseja realmente ${acao} o termo (comprovante) por "${arquivo.name}"?`);
  if (!ok) { renderDetalhe(pedidoSelecionadoId); return; }
  // Upload multipart: os bytes são guardados no banco (SANCAO.documento_sancao).
  const fd = new FormData();
  fd.append("termo", arquivo);
  try {
    const resp = await fetch(`/api/disciplinar/${r.id}/sancao/termo`, { method: "POST", headers: authHeaders(), body: fd });
    if (!resp.ok) {
      let m = `Erro ${resp.status}`;
      try { const e = await resp.json(); if (e && e.error) m = e.error; } catch (_) {}
      throw new Error(m);
    }
    const data = await resp.json();
    if (data && data.pedido) aplicarPedidoAtualizado(data.pedido);
    gdToast("Termo (comprovante) enviado.");
  } catch (e) {
    gdToast(e && e.message ? e.message : "Falha ao enviar o termo.", "erro");
    renderDetalhe(pedidoSelecionadoId);
  }
}

// Assume a responsabilidade (admin) — o login é derivado do token no servidor.
async function assumirResponsabilidade(id) {
  if (!ehAdminDisciplinar()) { gdToast("Apenas administradores podem assumir processos.", "erro"); return; }
  const r = REGISTROS.find(x => x.id === Number(id));
  if (!r) return;
  const login = loginResponsavel();
  if (login && r.responsavel === login) { gdToast("Você já é o responsável por este processo."); return; }
  await enviarMutacao(() => apiPost(`/api/disciplinar/${r.id}/responsavel`, {}), `Você assumiu a responsabilidade${login ? ` (${login})` : ""}.`);
}

// Exclui o pedido (admin) — cascateia demanda/sanção/anexos/histórico no banco.
async function excluirPedido(id) {
  if (!ehAdminDisciplinar()) { gdToast("Apenas administradores podem excluir pedidos.", "erro"); return; }
  const r = REGISTROS.find(x => x.id === Number(id));
  if (!r) return;
  const ok = await gdConfirmar(`Deseja realmente excluir o pedido "${r.processo}" de ${r.trabalhador}? Esta ação não pode ser desfeita.`, {
    titulo: "Excluir pedido", okTexto: "Sim, excluir", cancelTexto: "Cancelar", amarelo: true
  });
  if (!ok) return;
  try {
    await apiPost(`/api/disciplinar/${r.id}/excluir`, {});
    REGISTROS = REGISTROS.filter(x => x.id !== r.id);
    pedidoSelecionadoId = REGISTROS[0] ? REGISTROS[0].id : null;
    preencherFiltros();
    renderIndicadores();
    renderTabela();
    renderDetalhe(pedidoSelecionadoId);
    gdToast("Pedido excluído.");
  } catch (e) {
    gdToast(e && e.message ? e.message : "Falha ao excluir o pedido.", "erro");
  }
}

// ---------- Anexos (PROVA / OFÍCIO / MEMORANDO / RELATÓRIO / OUTRO) ----------
// Anexa um ou mais arquivos do tipo escolhido (multipart). Só o responsável vê o
// botão. OFÍCIO é único por pedido (o backend substitui o anterior).
async function adicionarAnexos(files) {
  const r = REGISTROS.find(x => x.id === pedidoSelecionadoId);
  if (!r || !files || !files.length) return;
  const tipo = $("gdAnexoTipo")?.value || "PROVA";
  const fd = new FormData();
  fd.append("tipo", tipo);
  [...files].forEach(f => fd.append("anexos", f));
  try {
    // FormData define o Content-Type (com boundary) sozinho — não force JSON.
    const resp = await fetch(`/api/disciplinar/${r.id}/anexos`, { method: "POST", headers: authHeaders(), body: fd });
    if (!resp.ok) {
      let m = `Erro ${resp.status}`;
      try { const e = await resp.json(); if (e && e.error) m = e.error; } catch (_) {}
      throw new Error(m);
    }
    const data = await resp.json();
    if (data && data.pedido) aplicarPedidoAtualizado(data.pedido);
    gdToast(`${ANEXO_TIPO_LABEL[tipo] || "Anexo"}${files.length > 1 ? "s" : ""} anexado(s).`);
  } catch (e) {
    gdToast(e && e.message ? e.message : "Falha ao anexar arquivos.", "erro");
  }
}

async function excluirAnexo(idAnexo) {
  const ok = await gdConfirmar("Deseja remover este anexo?", { titulo: "Remover anexo", okTexto: "Sim, remover", cancelTexto: "Cancelar", amarelo: true });
  if (!ok) return;
  await enviarMutacao(() => apiPost(`/api/disciplinar/anexo/${idAnexo}/excluir`, {}), "Anexo removido.");
}

// ---------- Fases do processo (avançar/voltar/desligar) ----------
async function definirStatusDisc(r, novo, msg) {
  await enviarMutacao(() => apiPost(`/api/disciplinar/${r.id}/demanda`, { status: novo }), msg || `Status atualizado para "${novo}".`);
}

function avancarFaseDisc() {
  const r = REGISTROS.find(x => x.id === pedidoSelecionadoId);
  if (!r) return;
  const idx = STATUS_FASES.indexOf(r.statusAtual);
  if (idx < 0 || idx >= STATUS_FASES.length - 1) { gdToast("Não há próxima fase.", "erro"); return; }
  const novo = STATUS_FASES[idx + 1];
  definirStatusDisc(r, novo, `Processo avançado para "${novo}".`);
}

function voltarFaseDisc() {
  const r = REGISTROS.find(x => x.id === pedidoSelecionadoId);
  if (!r) return;
  const idx = STATUS_FASES.indexOf(r.statusAtual);
  if (idx <= 0) { gdToast("O processo já está na primeira fase.", "erro"); return; }
  const novo = STATUS_FASES[idx - 1];
  definirStatusDisc(r, novo, `Fase revertida para "${novo}".`);
}

function desligarProcessoDisc() {
  const r = REGISTROS.find(x => x.id === pedidoSelecionadoId);
  if (!r || r.statusAtual === STATUS_DESLIGADO) return;
  definirStatusDisc(r, STATUS_DESLIGADO, "Trabalhador marcado como desligado antes da conclusão.");
}

function reativarProcessoDisc() {
  const r = REGISTROS.find(x => x.id === pedidoSelecionadoId);
  if (!r) return;
  // Sem memória da fase anterior no banco: reativa em "Em análise".
  definirStatusDisc(r, "Em análise", `Processo reativado em "Em análise".`);
}

// ---------- Indicadores gerais ----------
function renderIndicadores() {
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  const cont = fn => REGISTROS.filter(fn).length;

  // Linha 1 — total de pedidos e desmembramento por resultado/sanção.
  // "Concluídas" engloba todos os cartões à sua direita, inclusive os pedidos
  // marcados como "Desligado antes da conclusão" (encerramento terminal).
  const total = REGISTROS.length;
  const concluidos = cont(r => r.statusAtual === STATUS_CONCLUIDA || r.statusAtual === STATUS_DESLIGADO);
  set("gdKpiTotal", total);
  set("gdKpiConcluidos", concluidos);
  // Total de processos = nº de Processo SEI distintos (ignora pedidos sem SEI).
  const processos = new Set(
    REGISTROS.map(r => (r.processo || "").trim()).filter(p => p && p !== "(sem nº SEI)")
  );
  set("gdKpiTotalProcessos", processos.size);
  // Barra de progresso do card "Total de Pedidos" (% de pedidos concluídos).
  const pct = total ? Math.round((concluidos / total) * 100) : 0;
  set("gdKpiPercentLabel", `${pct}%`);
  const progFill = $("gdKpiProgressoFill");
  if (progFill) progFill.style.width = `${pct}%`;
  set("gdKpiSancaoNaoAplicada", cont(r => r.statusAtual === STATUS_CONCLUIDA && r.tipoSancao === "Não Aplicada"));
  set("gdKpiAdvertenciasOrais", cont(r => r.statusAtual === STATUS_CONCLUIDA && /^advertência oral$/i.test(r.tipoSancao || "")));
  set("gdKpiAdvertencias", cont(r => r.statusAtual === STATUS_CONCLUIDA && /^advertência$/i.test(r.tipoSancao || "")));
  set("gdKpiSuspensoes", cont(r => r.statusAtual === STATUS_CONCLUIDA && /^suspens/i.test(r.tipoSancao || "")));
  set("gdKpiJustasCausas", cont(r => r.statusAtual === STATUS_CONCLUIDA && (r.tipoSancao || "").toLowerCase() === "justa causa"));

  // Linha 2 — não concluídos e desmembramento por status. Os desligados deixam
  // de contar aqui, pois passaram a integrar o total de "Concluídas".
  set("gdKpiNaoConcluidos", cont(r => r.statusAtual !== STATUS_CONCLUIDA && r.statusAtual !== STATUS_DESLIGADO));
  set("gdKpiPendentes", cont(r => r.statusAtual === "Pendente"));
  set("gdKpiEmAnalise", cont(r => r.statusAtual === "Em análise"));
  set("gdKpiAguardando", cont(r => r.statusAtual === "Aguardando devolutiva do DSEI/Profissional"));
  set("gdKpiDesligados", cont(r => r.statusAtual === STATUS_DESLIGADO));
  set("gdKpiForaPrazo", cont(r => !!r.foraDoPrazo));
  // Tempo médio: dias entre a data do pedido e a data de aplicação da sanção.
  const tempos = REGISTROS.map(r => {
    const p = dataBr(r.dataPedido);
    const a = dataBr(r.dataAplicacao);
    return (p && a) ? (a - p) / 86400000 : null;
  }).filter(d => d !== null && d >= 0);
  const media = tempos.length ? Math.round(tempos.reduce((s, d) => s + d, 0) / tempos.length) : 0;
  set("gdKpiTempoMedioValor", `${media} dia${media === 1 ? "" : "s"}`);
}

// ---------- Ações ----------
function limparFiltros() {
  ["gdFiltroDsei", "gdFiltroStatus"].forEach(id => { const el = $(id); if (el) el.value = ""; });
  ["gdBuscaProcessoSei", "gdBuscaNome", "gdBuscaPedido", "gdBuscaResponsavel"].forEach(id => { const el = $(id); if (el) el.value = ""; });
  filtroMeusProcessos = false;
  $("gdBtnMeusProcessos")?.classList.remove("is-ativo");
  renderTabela();
  gdToast("Filtros limpos.");
}

// ---------- Formulário de novo registro ----------
const CAMPOS_FORM = ["gdFProcesso", "gdFDsei", "gdFTrabalhador", "gdFCargo", "gdFMatricula",
  "gdFPolo", "gdFOcorrencia", "gdFDataPedido", "gdFResponsavel", "gdFResumo", "gdFLink", "gdFArquivo"];

// Documento do processo: alterna entre os campos de link e de anexo (PDF).
function atualizarDocTipoGd() {
  const tipo = document.querySelector('input[name="gdDocTipo"]:checked')?.value || "link";
  const link = $("gdFLink");
  const arquivo = $("gdFArquivo");
  if (link) link.hidden = tipo !== "link";
  // O input de arquivo vira o componente .fiField; alternamos o WRAPPER, não o
  // input nativo (que o componente mantém oculto).
  if (arquivo) {
    const alvo = arquivo.closest(".fiField") || arquivo;
    alvo.hidden = tipo !== "anexo";
  }
}

// Data de hoje no formato "aaaa-mm-dd" (para <input type="date">).
function hojeIso() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function abrirFormulario() {
  if (!podeCriarPedidoDisciplinar()) {
    gdToast("Você não tem permissão para criar pedidos disciplinares.", "erro");
    return;
  }
  const painel = $("gdFormPanel");
  if (!painel) return;
  painel.style.display = "";
  atualizarDocTipoGd();
  carregarAdminsDelegaveis();
  // Data do pedido começa na data atual, mas pode ser editada.
  const dPed = $("gdFDataPedido");
  if (dPed && !dPed.value) dPed.value = hojeIso();
  painel.scrollIntoView({ behavior: "smooth", block: "start" });
  $("gdTrabTrigger")?.focus();
}

function fecharFormulario(limpar) {
  const painel = $("gdFormPanel");
  if (!painel) return;
  painel.style.display = "none";
  if (limpar) {
    CAMPOS_FORM.forEach(id => { const el = $(id); if (el) el.value = ""; });
    // O input de arquivo foi zerado acima; re-sincroniza o componente (chips).
    $("gdFArquivo")?._fi?.render();
    const radioLink = document.querySelector('input[name="gdDocTipo"][value="link"]');
    if (radioLink) radioLink.checked = true;
    atualizarDocTipoGd();
    limparNovosAnexos();
    atualizarTrabTrigger(); // reflete o gdFTrabalhador zerado no gatilho
    trabalhadorSituacao = null; // some o aviso de desligado do trabalhador anterior
  }
}

// Reinicia e dispara a animação de auto-preenchimento num campo.
function animarCampo(el) {
  if (!el) return;
  el.classList.remove("gd-autofill");
  void el.offsetWidth; // força reflow para reiniciar a animação a cada seleção
  el.classList.add("gd-autofill");
}

// ---------- Combobox de trabalhador (gatilho + popup pesquisável) ----------
// Busca assíncrona no backend (a matrícula é FK obrigatória, então o trabalhador
// precisa existir no consolidado). Mesmo formato dos demais dropdowns do app: um
// gatilho (botão) que abre um popup (portal no <body>, position:fixed) com campo
// de busca interno + lista de resultados. O nome escolhido vive no input oculto
// gdFTrabalhador (lido pelo formulário); ao selecionar, auto-preenche os campos.
let trabalhadoresBusca = new Map(); // nome(lower) -> { matricula, cargo, dsei, polo, situacao, desligado }
let trabalhadoresLista = [];        // resultados atuais (para render + navegação)
// Situação do trabalhador escolhido no formulário (para o aviso de desligado ao salvar).
let trabalhadorSituacao = null;     // { desligado, situacao } | null
let buscaTrabTimer = null;
let trabIdx = -1;                   // item destacado pelo teclado
let trabMenu = null;                // popup (portal no body) — existe só aberto
let trabSearch = null;
let trabListaEl = null;

// Atualiza o texto do gatilho com o trabalhador selecionado (ou placeholder).
function atualizarTrabTrigger() {
  const combo = $("gdComboTrabalhador");
  if (!combo) return;
  const valorEl = combo.querySelector(".ssValor");
  const nome = ($("gdFTrabalhador")?.value || "").trim();
  if (valorEl) valorEl.textContent = nome || "Clique para buscar pelo nome ou matrícula";
  combo.classList.toggle("is-vazio", !nome);
}

function renderTrabLista() {
  if (!trabListaEl) return;
  const termo = (trabSearch?.value || "").trim();
  if (termo.length < 2) { trabListaEl.innerHTML = `<li class="ssVazio">Digite ao menos 2 letras para buscar…</li>`; return; }
  if (!trabalhadoresLista.length) { trabListaEl.innerHTML = `<li class="ssVazio">Nenhum trabalhador encontrado.</li>`; return; }
  trabListaEl.innerHTML = trabalhadoresLista.map((t, i) =>
    `<li class="ssItem gdTrabItem${i === trabIdx ? " is-ativo" : ""}" role="option" data-nome="${escapeAttr(t.nome)}">
      <span class="ssItemLabel">
        <span class="gdTrabNome">${escapeHtml(t.nome)}${t.desligado ? ` <span class="gdTrabDeslig">Desligado</span>` : ""}</span>
        <span class="gdTrabMeta">${escapeHtml(t.cargo)} · ${escapeHtml(t.dsei)} · mat. ${escapeHtml(t.matricula)}</span>
      </span>
    </li>`).join("");
}

async function buscarTrabalhadores() {
  const termo = (trabSearch?.value || "").trim();
  if (termo.length < 2) { trabalhadoresLista = []; trabIdx = -1; renderTrabLista(); return; }
  let dados;
  try { dados = await apiGet(`/api/disciplinar/trabalhadores?q=${encodeURIComponent(termo)}`); }
  catch (e) { trabalhadoresLista = []; trabIdx = -1; renderTrabLista(); return; }
  trabalhadoresLista = dados.trabalhadores || [];
  trabalhadoresBusca = new Map(trabalhadoresLista.map(t => [String(t.nome).toLowerCase(), t]));
  trabIdx = -1;
  renderTrabLista();
}

// Aplica a seleção: grava o nome no input oculto e auto-preenche matrícula/cargo/etc.
function selecionarTrabalhador(nome) {
  const hidden = $("gdFTrabalhador");
  if (hidden) hidden.value = nome;
  const d = trabalhadoresBusca.get(String(nome).toLowerCase());
  if (d) {
    const set = (id, v) => { const el = $(id); if (!el) return; el.value = v || ""; animarCampo(el); };
    set("gdFMatricula", d.matricula);
    set("gdFCargo", d.cargo);
    set("gdFPolo", d.polo);
    if (!$("gdFDsei")?.value) set("gdFDsei", d.dsei);
    trabalhadorSituacao = { desligado: !!d.desligado, situacao: d.situacao || "" };
  } else {
    trabalhadorSituacao = null;
  }
  atualizarTrabTrigger();
  fecharTrabCombo();
  $("gdTrabTrigger")?.focus();
}

function posicionarTrabMenu() {
  if (!trabMenu) return;
  const trigger = $("gdTrabTrigger");
  if (!trigger) return;
  const r = trigger.getBoundingClientRect();
  trabMenu.style.left = `${Math.round(r.left)}px`;
  trabMenu.style.top = `${Math.round(r.bottom + 6)}px`;
  trabMenu.style.width = `${Math.round(r.width)}px`;
}
const onTrabScroll = e => { if (trabMenu && e && e.target instanceof Node && trabMenu.contains(e.target)) return; fecharTrabCombo(); };
const onTrabResize = () => posicionarTrabMenu();
const onTrabDocDown = e => {
  const combo = $("gdComboTrabalhador");
  if (combo && !combo.contains(e.target) && (!trabMenu || !trabMenu.contains(e.target))) fecharTrabCombo();
};

function abrirTrabCombo() {
  if (trabMenu) return;
  const combo = $("gdComboTrabalhador");
  if (!combo) return;
  combo.classList.add("aberto");
  trabMenu = document.createElement("div");
  trabMenu.className = "ssMenu gdTrabMenu";
  trabMenu.innerHTML = `
    <div class="ssSearch">
      <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
      <input type="search" class="ssSearchInput" placeholder="Pesquisar trabalhador…" autocomplete="off" aria-label="Pesquisar trabalhador">
    </div>
    <ul class="ssLista" role="listbox"></ul>`;
  document.body.appendChild(trabMenu);
  trabSearch = trabMenu.querySelector(".ssSearchInput");
  trabListaEl = trabMenu.querySelector(".ssLista");

  trabMenu.addEventListener("mousedown", e => {
    const li = e.target.closest("[data-nome]");
    if (li) { e.preventDefault(); selecionarTrabalhador(li.dataset.nome); return; }
    if (e.target !== trabSearch) e.preventDefault(); // mantém o foco na busca
  });
  trabSearch.addEventListener("input", () => {
    trabIdx = -1;
    renderTrabLista(); // hint imediato
    clearTimeout(buscaTrabTimer);
    buscaTrabTimer = setTimeout(buscarTrabalhadores, 250);
  });
  trabSearch.addEventListener("keydown", onTrabKeydown);

  trabIdx = -1;
  trabalhadoresLista = [];
  renderTrabLista();
  posicionarTrabMenu();
  window.addEventListener("scroll", onTrabScroll, true);
  window.addEventListener("resize", onTrabResize);
  document.addEventListener("mousedown", onTrabDocDown, true);
  setTimeout(() => trabSearch && trabSearch.focus(), 10);
}

function fecharTrabCombo() {
  if (trabMenu) { trabMenu.remove(); trabMenu = null; trabSearch = null; trabListaEl = null; }
  $("gdComboTrabalhador")?.classList.remove("aberto");
  trabIdx = -1;
  window.removeEventListener("scroll", onTrabScroll, true);
  window.removeEventListener("resize", onTrabResize);
  document.removeEventListener("mousedown", onTrabDocDown, true);
}

function onTrabKeydown(e) {
  if (e.key === "Escape") { fecharTrabCombo(); $("gdTrabTrigger")?.focus(); return; }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!trabalhadoresLista.length) return;
    trabIdx += (e.key === "ArrowDown" ? 1 : -1);
    if (trabIdx < 0) trabIdx = trabalhadoresLista.length - 1;
    if (trabIdx >= trabalhadoresLista.length) trabIdx = 0;
    renderTrabLista();
    trabListaEl?.querySelector(".is-ativo")?.scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter" && trabIdx >= 0 && trabalhadoresLista[trabIdx]) {
    e.preventDefault();
    selecionarTrabalhador(trabalhadoresLista[trabIdx].nome);
  }
}

// Liga os eventos do gatilho (uma vez só, na inicialização).
function setupComboTrabalhador() {
  const trigger = $("gdTrabTrigger");
  if (!trigger) return;
  trigger.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); trabMenu ? fecharTrabCombo() : abrirTrabCombo(); });
  trigger.addEventListener("keydown", e => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!trabMenu) abrirTrabCombo(); }
  });
  atualizarTrabTrigger();
}

// Converte "aaaa-mm-dd" (input date) para "dd/mm/aaaa".
function dataParaBr(valor) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valor || "").trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}

// ---------- Anexos do novo pedido (preparados no formulário) ----------
// Como o pedido ainda não existe, os arquivos ficam "em espera" e são enviados
// junto com o cadastro (multipart). Cada item guarda o arquivo e o tipo escolhido.
let novosAnexos = [];

function renderNovosAnexos() {
  const ul = $("gdFAnexoLista");
  if (!ul) return;
  ul.innerHTML = novosAnexos.map((a, i) =>
    `<li class="gdNovoAnexoItem">
       <i class="fa-solid fa-file-lines"></i>
       <span>${escapeHtml(a.file.name)}<small>${escapeHtml(ANEXO_TIPO_LABEL[a.tipo] || a.tipo)} · ${Math.max(1, Math.round(a.file.size / 1024))} KB</small></span>
       <button type="button" class="gfIconBtn" data-gd-novo-anexo="${i}" title="Remover"><i class="fa-solid fa-xmark"></i></button>
     </li>`
  ).join("");
}

function adicionarNovoAnexoStage(files) {
  const tipo = $("gdFAnexoTipo")?.value || "PROVA";
  [...(files || [])].forEach(f => novosAnexos.push({ file: f, tipo }));
  renderNovosAnexos();
}

function limparNovosAnexos() {
  novosAnexos = [];
  renderNovosAnexos();
}

async function salvarRegistro() {
  const val = id => ($(id)?.value || "").trim();
  const trabalhador = val("gdFTrabalhador");
  const dsei = val("gdFDsei");
  const matricula = val("gdFMatricula");
  const processo = val("gdFProcesso");
  if (!trabalhador || !dsei) {
    gdToast("Informe ao menos o trabalhador e o DSEI/CASAI.", "erro");
    return;
  }
  if (!matricula) {
    gdToast("Selecione o trabalhador na busca para vincular a matrícula.", "erro");
    return;
  }
  if (!processo) {
    gdToast("Informe o nº do Processo SEI.", "erro");
    return;
  }

  // Prazo: o pedido cadastrado mais de 30 dias após a data da ocorrência está
  // fora do prazo. Nesse caso, pede confirmação antes de gravar.
  const ocorrenciaIso = val("gdFOcorrencia");
  const pedidoIso = val("gdFDataPedido");
  let foraDoPrazo = false;
  if (ocorrenciaIso && pedidoIso) {
    const dias = (new Date(pedidoIso) - new Date(ocorrenciaIso)) / 86400000;
    foraDoPrazo = Number.isFinite(dias) && dias > 30;
  }
  // Status inicial padrão. Para pedidos fora do prazo, o usuário escolhe entre já
  // concluir o pedido ou movimentar o processo normalmente pelo fluxo de fases.
  let statusInicial = "Pendente";
  if (foraDoPrazo) {
    const ok = await gdConfirmar("Pedido cadastrado fora do prazo, deseja prosseguir?", {
      titulo: "Pedido fora do prazo",
      okTexto: "Sim, prosseguir",
      cancelTexto: "Não",
      amarelo: true
    });
    if (!ok) return;

    const concluir = await gdConfirmar("Deseja marcar este pedido já como concluído ou movimentar o processo normalmente?", {
      titulo: "Pedido fora do prazo",
      okTexto: "Marcar como concluído",
      cancelTexto: "Movimentar normalmente",
      amarelo: true
    });
    if (concluir) statusInicial = STATUS_CONCLUIDA;
  }

  // Trabalhador desligado no consolidado: oferece já encerrar o pedido como
  // "Desligado antes da conclusão" (sobrepõe o status inicial se confirmado).
  if (trabalhadorSituacao?.desligado) {
    const marcar = await gdConfirmar(
      `O trabalhador está desligado${trabalhadorSituacao.situacao ? ` (${trabalhadorSituacao.situacao})` : ""}. Deseja marcar o pedido como "Desligado antes da conclusão"?`,
      { titulo: "Trabalhador desligado", okTexto: "Sim, marcar como desligado", cancelTexto: "Não, manter o fluxo", amarelo: true }
    );
    if (marcar) statusInicial = STATUS_DESLIGADO;
  }

  // Envio multipart: campos de texto + o ofício (link OU arquivo em PDF). Quando é
  // arquivo, os bytes são guardados no banco (1 ofício por pedido).
  const fd = new FormData();
  const add = (k, v) => fd.append(k, v == null ? "" : v);
  add("processo", processo);
  add("matricula", matricula);
  add("trabalhador", trabalhador);
  add("dsei", dsei);
  add("cargo", val("gdFCargo"));
  add("polo", val("gdFPolo"));
  add("ocorrencia", ocorrenciaIso);
  add("dataPedido", pedidoIso);
  add("pedido", $("gdFPedido")?.value || "Sem indicação");
  add("resumo", val("gdFResumo"));
  // Delegação de responsável só é aceita de administradores.
  add("responsavel", ehAdminDisciplinar() ? val("gdFResponsavel") : "");
  add("foraDoPrazo", foraDoPrazo ? "1" : "0");
  add("statusInicial", statusInicial);

  const tipoDoc = document.querySelector('input[name="gdDocTipo"]:checked')?.value || "link";
  if (tipoDoc === "link") {
    const link = val("gdFLink");
    if (link) { add("anexoUrl", link); add("anexoNome", link); }
  } else {
    const arquivo = $("gdFArquivo")?.files?.[0];
    if (arquivo) fd.append("oficio", arquivo);
  }

  // Anexos preparados na divisão "Anexos do processo" (vários, com tipo).
  const anexosTipos = [];
  novosAnexos.forEach(a => { fd.append("anexos", a.file); anexosTipos.push(a.tipo); });
  if (anexosTipos.length) fd.append("anexosTipos", JSON.stringify(anexosTipos));

  let resp;
  try {
    const r = await fetch("/api/disciplinar", { method: "POST", headers: authHeaders(), body: fd });
    if (!r.ok) {
      let m = `Erro ${r.status}`;
      try { const e = await r.json(); if (e && e.error) m = e.error; } catch (_) {}
      throw new Error(m);
    }
    resp = await r.json();
  } catch (e) {
    gdToast(e && e.message ? e.message : "Falha ao salvar o pedido.", "erro");
    return;
  }
  fecharFormulario(true);
  if (resp && resp.pedido) aplicarPedidoAtualizado(resp.pedido);
  else await carregarPedidos();
  gdToast(`Pedido disciplinar de "${trabalhador}" registrado.`);
}

// ---------- Inicialização ----------
let gestaoDisciplinarConfigurada = false;

// Re-renderiza quando a permissão do usuário muda (ex.: a sessão é carregada
// DEPOIS do primeiro render). Chamado por aplicarPermissoesUsuario() (auth.js).
export function atualizarPermissaoGestaoDisciplinar() {
  aplicarVisibilidadeCardsDisciplinar();
  if (gestaoDisciplinarConfigurada) renderDetalhe(pedidoSelecionadoId);
}

export function configurarGestaoDisciplinar() {
  if (gestaoDisciplinarConfigurada) return;
  const raiz = $("view-gestaoDisciplinar");
  if (!raiz) return;
  gestaoDisciplinarConfigurada = true;

  aplicarVisibilidadeCardsDisciplinar();
  carregarPedidos();

  // Filtros reagem na hora.
  ["gdFiltroDsei", "gdFiltroStatus"].forEach(id => $(id)?.addEventListener("change", renderTabela));
  const renderTabelaBusca = debounce(renderTabela, 250);
  ["gdBuscaProcessoSei", "gdBuscaNome", "gdBuscaPedido", "gdBuscaResponsavel"].forEach(id => $(id)?.addEventListener("input", renderTabelaBusca));

  $("gdBtnLimpar")?.addEventListener("click", limparFiltros);
  $("gdBtnNovo")?.addEventListener("click", abrirFormulario);

  // Recolher/expandir a barra de filtros.
  $("gdBtnToggleFiltros")?.addEventListener("click", () => {
    const toolbar = $("gdToolbar");
    const btn = $("gdBtnToggleFiltros");
    if (!toolbar || !btn) return;
    const recolhido = toolbar.classList.toggle("is-recolhido");
    btn.setAttribute("aria-expanded", String(!recolhido));
  });

  // Filtro rápido: só os processos em que o usuário logado é o responsável.
  $("gdBtnMeusProcessos")?.addEventListener("click", () => {
    filtroMeusProcessos = !filtroMeusProcessos;
    $("gdBtnMeusProcessos")?.classList.toggle("is-ativo", filtroMeusProcessos);
    renderTabela();
  });

  // Formulário de novo registro.
  $("gdBtnCancelar")?.addEventListener("click", () => fecharFormulario(true));
  $("gdBtnSalvarRegistro")?.addEventListener("click", salvarRegistro);
  setupComboTrabalhador();
  // Anexos do novo pedido: prepara os arquivos escolhidos e permite remover.
  $("gdFAnexoInput")?.addEventListener("change", event => {
    adicionarNovoAnexoStage(event.target.files);
    event.target.value = "";
  });
  $("gdFAnexoLista")?.addEventListener("click", event => {
    const rm = event.target.closest("[data-gd-novo-anexo]");
    if (!rm) return;
    novosAnexos.splice(Number(rm.dataset.gdNovoAnexo), 1);
    renderNovosAnexos();
  });
  document.querySelectorAll('input[name="gdDocTipo"]').forEach(radio =>
    radio.addEventListener("change", atualizarDocTipoGd));

  // Clique na linha abre o detalhamento; botões disparam suas ações.
  raiz.addEventListener("click", event => {
    const assumir = event.target.closest("[data-gd-assumir]");
    if (assumir) { assumirResponsabilidade(Number(assumir.dataset.gdAssumir)); return; }

    const alterar = event.target.closest("[data-gd-alterar]");
    if (alterar) { entrarEdicaoDados(); return; }

    if (event.target.closest("[data-gd-edit-cancelar]")) { cancelarEdicaoDados(); return; }
    if (event.target.closest("[data-gd-edit-salvar]")) { salvarEdicaoDados(); return; }

    const excluir = event.target.closest("[data-gd-excluir]");
    if (excluir) { excluirPedido(Number(excluir.dataset.gdExcluir)); return; }

    const fase = event.target.closest("[data-gd-fase]");
    if (fase) {
      const acao = fase.dataset.gdFase;
      if (acao === "avancar") avancarFaseDisc();
      else if (acao === "voltar") voltarFaseDisc();
      else if (acao === "desligar") desligarProcessoDisc();
      else if (acao === "reativar") reativarProcessoDisc();
      return;
    }

    const baixar = event.target.closest("[data-gd-baixar]");
    if (baixar) { gdToast(`Download de "${baixar.dataset.gdBaixar}" (maquete).`); return; }

    const anexoExcluir = event.target.closest("[data-gd-anexo-excluir]");
    if (anexoExcluir) { excluirAnexo(anexoExcluir.dataset.gdAnexoExcluir); return; }

    const linha = event.target.closest(".gdRow");
    if (linha && linha.dataset.gdId) {
      const id = Number(linha.dataset.gdId);
      // Trocar de pedido sai do modo de edição inline para não editar o errado.
      if (id !== pedidoSelecionadoId) editandoDados = false;
      renderDetalhe(id);
    }
  });

  // Campos de data: abre o seletor ao clicar em qualquer parte do campo (não só
  // no ícone). showPicker() exige gesto do usuário — o clique satisfaz.
  raiz.addEventListener("click", event => {
    const data = event.target.closest('input[type="date"]');
    if (data && typeof data.showPicker === "function") {
      try { data.showPicker(); } catch (e) { /* já aberto/não suportado */ }
    }
  });

  // Edição em linha do detalhamento: ao escolher um novo valor no Status/Sanção,
  // abre a confirmação antes de aplicar (campos só editáveis com permissão).
  raiz.addEventListener("change", event => {
    const up = event.target.closest("[data-gd-upload]");
    if (up) { aplicarUploadTermo(up.files?.[0]); return; }
    const anexo = event.target.closest("[data-gd-anexo]");
    if (anexo) { const fs = [...anexo.files]; anexo.value = ""; adicionarAnexos(fs); return; }
    const sel = event.target.closest("[data-gd-campo]");
    if (sel) { aplicarAlteracao(sel.dataset.gdCampo, sel.value); return; }
  });
}
