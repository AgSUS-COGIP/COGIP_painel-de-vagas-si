// =========================================================
// Entrega de Crachá
// Consome os dados reais da tabela UGP_CONTROLE_CRACHAS_SI via API
// (/api/cracha). Funil de status (6 etapas):
//   Foto Pendente de Envio -> Envio à Gráfica Pendente ->
//   Crachás em Confecção -> Crachá Confeccionado ->
//   Entregue ao Escritório -> Entregue ao Trabalhador
// CRUD persistido no banco (editar datas/observação, avançar/voltar status,
// mudança de status em lote), disponível apenas para administradores (nível >= 2).
// =========================================================
import { escapeHtml, escapeAttr, valorCsv } from "./utils.js";
import { apiGet, apiPost } from "./api.js";
import { state } from "./state.js";

const PAGE_SIZE_OPCOES = [10, 25, 50, 100];
let pageSize = 10; // registros por página (ajustável pelo usuário)
const NIVEL_ADMIN = 2;

// Funil de status (rótulos amigáveis; o de-para para o banco é feito no backend).
let STATUS_LISTA = [
  "Foto Pendente de Envio", "Envio à Gráfica Pendente", "Crachás em Confecção",
  "Crachá Confeccionado", "Entregue ao Escritório", "Entregue ao Trabalhador"
];

const STATUS_CLASSE = {
  "Foto Pendente de Envio": "is-foto",
  "Envio à Gráfica Pendente": "is-grafica",
  "Crachás em Confecção": "is-confeccao",
  "Crachá Confeccionado": "is-confeccionado",
  "Entregue ao Escritório": "is-entregue-esc",
  "Entregue ao Trabalhador": "is-entregue-trab"
};

// Transições de avanço (botões "Registrar ..."). A entrada do funil
// ("Foto Pendente de Envio" -> "Envio à Gráfica Pendente") é controlada pelo
// ETL (Impacto), por isso não há botão manual de "foto recebida".
const TRANSICOES = {
  grafica: { de: "Envio à Gráfica Pendente", para: "Crachás em Confecção", msg: "Envio à gráfica registrado." },
  confeccao: { de: "Crachás em Confecção", para: "Crachá Confeccionado", msg: "Confecção concluída." },
  escritorio: { de: "Crachá Confeccionado", para: "Entregue ao Escritório", msg: "Entrega ao escritório registrada." },
  trabalhador: { de: "Entregue ao Escritório", para: "Entregue ao Trabalhador", msg: "Entrega ao trabalhador registrada." }
};

function badgeStatus(status) {
  const cls = STATUS_CLASSE[status] || "is-foto";
  return `<span class="ecBadge ${cls}">${escapeHtml(status)}</span>`;
}

function statusIndex(status) {
  const i = STATUS_LISTA.indexOf(status);
  return i < 0 ? 0 : i;
}

function escritorioDoDsei(dsei) {
  return (dsei || "").replace(/^(DSEI|CASAI)\s+/, "Escritório ");
}

function podeEditar() {
  return Number((state.painelLoginUsuario || {}).nivelAutorizacao || 0) >= NIVEL_ADMIN;
}

// ---------- Estado da view ----------
let solicitacoes = [];
let carregado = false;
let carregando = false;
let erroCarregamento = "";

let filtros = { dsei: "", status: "", escritorio: "", dataIni: "", dataFim: "", nome: "", cargo: "" };
let paginaAtual = 1;
let detalheId = null;
const selecionados = new Set(); // matrículas marcadas para ação em lote

const $ = id => document.getElementById(id);

// ---------- Datas ----------
function brParaISO(br) {
  if (!br) return "";
  const [d, m, a] = br.split("/");
  if (!d || !m || !a) return "";
  return `${a}-${m}-${d}`;
}

function isoParaBR(iso) {
  if (!iso) return "";
  const [a, m, d] = iso.split("-");
  if (!a || !m || !d) return "";
  return `${d}/${m}/${a}`;
}

function brParaTime(br) {
  if (!br) return null;
  const [d, m, a] = br.split("/");
  if (!d || !m || !a) return null;
  return new Date(Number(a), Number(m) - 1, Number(d)).getTime();
}

// dd/mm/aaaa e calendário válido (rejeita 32/13, 30/02, etc.). Vazio = falso.
function dataBrValida(br) {
  const m = String(br || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return false;
  const d = +m[1], mes = +m[2], a = +m[3];
  if (mes < 1 || mes > 12 || d < 1 || d > 31) return false;
  const dt = new Date(a, mes - 1, d);
  return dt.getFullYear() === a && dt.getMonth() === mes - 1 && dt.getDate() === d;
}

// dd/mm/aaaa -> aaaa-mm-dd com zero à esquerda (formato exigido pelo input date).
function brParaISOInput(br) {
  if (!dataBrValida(br)) return "";
  const [d, m, a] = br.split("/");
  return `${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

// Status válido = está na lista do funil (sem diferenciar acento? só caixa). Vazio = ok.
function statusValido(val) {
  if (!val) return true;
  const v = String(val).trim().toLowerCase();
  return STATUS_LISTA.some(s => s.toLowerCase() === v);
}

// ---------- Toast ----------
let toastTimer = null;
function ecToast(mensagem, tipo) {
  let el = $("ecToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "ecToast";
    el.className = "ecToast";
    document.body.appendChild(el);
  }
  el.textContent = mensagem;
  el.classList.remove("is-erro", "is-ok");
  el.classList.add(tipo === "erro" ? "is-erro" : "is-ok", "show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

// ---------- KPIs (total, ativos e um por status do funil) ----------
function renderKpis(lista) {
  const porStatus = st => lista.filter(s => s.status === st).length;
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set("ecKpiTrabalhadores", lista.length);
  set("ecKpiFoto", porStatus("Foto Pendente de Envio"));
  set("ecKpiGrafica", porStatus("Envio à Gráfica Pendente"));
  set("ecKpiConfeccao", porStatus("Crachás em Confecção"));
  set("ecKpiConfeccionado", porStatus("Crachá Confeccionado"));
  set("ecKpiEntregueEsc", porStatus("Entregue ao Escritório"));
  set("ecKpiEntregueTrab", porStatus("Entregue ao Trabalhador"));
  set("ecKpiDevolvido", lista.filter(s => s.devolvido).length);
  set("ecKpiSegundaVia", lista.filter(s => s.segundaVia).length);
}

// ---------- Filtros ----------
function lerFiltros() {
  filtros = {
    dsei: $("ecFiltroDsei")?.value || "",
    status: $("ecFiltroStatus")?.value || "",
    escritorio: $("ecFiltroEscritorio")?.value || "",
    dataIni: $("ecFiltroDataInicial")?.value || "",
    dataFim: $("ecFiltroDataFinal")?.value || "",
    nome: ($("ecBuscaNome")?.value || "").trim().toLowerCase(),
    cargo: ($("ecBuscaCargo")?.value || "").trim().toLowerCase()
  };
}

// `ignorarStatus` é usado pelos KPIs: os cards de status já são a quebra por
// status, então o filtro de status não deve zerar os demais cards.
function aplicarFiltros(ignorarStatus) {
  const iniT = filtros.dataIni ? new Date(filtros.dataIni + "T00:00:00").getTime() : null;
  const fimT = filtros.dataFim ? new Date(filtros.dataFim + "T00:00:00").getTime() : null;

  return solicitacoes.filter(s => {
    if (filtros.dsei && s.dsei !== filtros.dsei) return false;
    if (!ignorarStatus && filtros.status && s.status !== filtros.status) return false;
    if (filtros.escritorio && escritorioDoDsei(s.dsei) !== filtros.escritorio) return false;
    if (filtros.nome && !(s.nome || "").toLowerCase().includes(filtros.nome) && !(s.matricula || "").toLowerCase().includes(filtros.nome)) return false;
    if (filtros.cargo && !(s.cargo || "").toLowerCase().includes(filtros.cargo)) return false;
    if (iniT !== null || fimT !== null) {
      const t = brParaTime(s.dataSolicitacao);
      if (t === null) return false;
      if (iniT !== null && t < iniT) return false;
      if (fimT !== null && t > fimT) return false;
    }
    return true;
  });
}

// ---------- Tabela + paginação ----------
function celulaData(valor) {
  return valor ? escapeHtml(valor) : "—";
}

function render() {
  // Reavalia a permissão a cada render: no init o usuário ainda não está
  // logado (nível 0); após o login/carregamento isto reflete o nível real.
  const raiz = $("view-entregaCracha");
  if (raiz) raiz.classList.toggle("ec-readonly", !podeEditar());

  renderKpis(aplicarFiltros(true));

  const lista = aplicarFiltros();
  const totalPaginas = Math.max(1, Math.ceil(lista.length / pageSize));
  if (paginaAtual > totalPaginas) paginaAtual = totalPaginas;
  const inicio = (paginaAtual - 1) * pageSize;
  const pagina = lista.slice(inicio, inicio + pageSize);
  const editar = podeEditar();

  const body = $("ecTabelaBody");
  if (body) {
    if (carregando && !carregado) {
      body.innerHTML = `<tr><td colspan="13" class="ecVazio">Carregando dados de crachás...</td></tr>`;
    } else if (erroCarregamento) {
      body.innerHTML = `<tr><td colspan="13" class="ecVazio">${escapeHtml(erroCarregamento)}</td></tr>`;
    } else {
      body.innerHTML = pagina.map(s => {
        const reverter = s.podeReverter
          ? `<button class="ecIconBtn ecIconBtnDanger" data-ec-reverter="${escapeHtml(s.id)}" title="Desfazer a última alteração"><i class="fa-solid fa-rotate-left"></i></button>`
          : "";
        const acoesEdicao = editar
          ? `<button class="ecIconBtn" data-ec-editar="${escapeHtml(s.id)}" title="Editar datas/indicadores"><i class="fa-solid fa-pen"></i></button>${reverter}`
          : "";
        const marcado = selecionados.has(s.id) ? " checked" : "";
        const selos = `${s.importado ? '<span class="ecSelo is-importado" title="Importado (fora da base do ETL)">Importado</span>' : ""}${s.segundaVia ? '<span class="ecSelo is-2via" title="Solicitação de 2ª via">2ª via</span>' : ""}${s.devolvido ? '<span class="ecSelo is-devolvido" title="Crachá devolvido">Devolvido</span>' : ""}`;
        return `
        <tr${s.id === detalheId ? ' class="ecLinhaAtiva"' : ""}>
          <td class="ecColSelect ecTd-center"><input type="checkbox" class="ecCheck" data-ec-sel="${escapeHtml(s.id)}"${marcado} aria-label="Selecionar ${escapeHtml(s.nome || s.matricula)}"></td>
          <td class="ecTd-center ecAcoesCol">
            <button class="ecIconBtn" data-ec-ver="${escapeHtml(s.id)}" title="Ver detalhes"><i class="fa-regular fa-eye"></i></button>
            ${acoesEdicao}
          </td>
          <td>${celulaData(s.matricula)}</td>
          <td>${escapeHtml(s.dsei || "—")}</td>
          <td>${escapeHtml(s.nome || "—")}</td>
          <td>${escapeHtml(s.cargo || "—")}</td>
          <td class="ecTd-center">${s.possuiFoto ? '<span class="ecFotoSim">Sim</span>' : '<span class="ecFotoNao">Não</span>'}</td>
          <td>${badgeStatus(s.status)}${selos}</td>
          <td>${celulaData(s.dataSolicitacao)}</td>
          <td>${celulaData(s.dataEnvio)}</td>
          <td>${celulaData(s.dataConfeccao)}</td>
          <td>${celulaData(s.dataRecebEscritorio)}</td>
          <td>${celulaData(s.dataRecebTrabalhador)}</td>
        </tr>`;
      }).join("") ||
        `<tr><td colspan="13" class="ecVazio">Nenhum registro encontrado para os filtros selecionados.</td></tr>`;
    }
  }

  sincronizarSelecaoUI(pagina);

  const registros = $("ecRegistros");
  if (registros) {
    if (!lista.length) {
      registros.textContent = carregado ? "Mostrando 0 registros" : "";
    } else {
      const fim = Math.min(inicio + pageSize, lista.length);
      registros.textContent = `Mostrando ${inicio + 1} a ${fim} de ${lista.length} registros`;
    }
  }

  renderPaginacao(totalPaginas);
}

function renderPaginacao(totalPaginas) {
  const wrap = $("ecPagination");
  if (!wrap) return;
  if (totalPaginas <= 1) { wrap.innerHTML = ""; return; }

  // Janela de páginas em torno da atual (a base é grande: até ~1879 páginas).
  const janela = 2;
  let ini = Math.max(1, paginaAtual - janela);
  let fim = Math.min(totalPaginas, paginaAtual + janela);
  if (paginaAtual <= janela) fim = Math.min(totalPaginas, 1 + janela * 2);
  if (paginaAtual > totalPaginas - janela) ini = Math.max(1, totalPaginas - janela * 2);

  let html = `<button class="ecPageBtn ecPageNav" data-ec-pagina="prev" ${paginaAtual === 1 ? "disabled" : ""} title="Anterior"><i class="fa-solid fa-angle-left"></i></button>`;
  if (ini > 1) {
    html += `<button class="ecPageBtn" data-ec-pagina="1">1</button>`;
    if (ini > 2) html += `<span class="ecPageEllipsis">…</span>`;
  }
  for (let p = ini; p <= fim; p++) {
    html += `<button class="ecPageBtn${p === paginaAtual ? " is-ativo" : ""}" data-ec-pagina="${p}">${p}</button>`;
  }
  if (fim < totalPaginas) {
    if (fim < totalPaginas - 1) html += `<span class="ecPageEllipsis">…</span>`;
    html += `<button class="ecPageBtn" data-ec-pagina="${totalPaginas}">${totalPaginas}</button>`;
  }
  html += `<button class="ecPageBtn ecPageNav" data-ec-pagina="next" ${paginaAtual === totalPaginas ? "disabled" : ""} title="Próxima"><i class="fa-solid fa-angle-right"></i></button>`;
  wrap.innerHTML = html;
}

function irParaPagina(valor) {
  const lista = aplicarFiltros();
  const totalPaginas = Math.max(1, Math.ceil(lista.length / pageSize));
  if (valor === "prev") paginaAtual = Math.max(1, paginaAtual - 1);
  else if (valor === "next") paginaAtual = Math.min(totalPaginas, paginaAtual + 1);
  else paginaAtual = Math.min(totalPaginas, Math.max(1, Number(valor) || 1));
  render();
}

// ---------- Seleção em lote (escritório altera vários status de uma vez) ----------
// Mantém o select-all coerente com a página visível e a barra de lote (qtd +
// visibilidade). Só faz sentido para administradores; em modo leitura a coluna
// e a barra ficam escondidas via CSS (.ec-readonly).
function sincronizarSelecaoUI(pagina) {
  const idsPagina = pagina.map(s => s.id);
  const marcadosNaPagina = idsPagina.filter(id => selecionados.has(id)).length;

  const selAll = $("ecSelecionarPagina");
  if (selAll) {
    selAll.checked = idsPagina.length > 0 && marcadosNaPagina === idsPagina.length;
    selAll.indeterminate = marcadosNaPagina > 0 && marcadosNaPagina < idsPagina.length;
  }

  const bar = $("ecLoteBar");
  const qtd = $("ecLoteQtd");
  if (qtd) qtd.textContent = selecionados.size;
  if (bar) bar.hidden = !(podeEditar() && selecionados.size > 0);
}

function alternarSelecao(id, marcado) {
  if (marcado) selecionados.add(id); else selecionados.delete(id);
  render();
}

function alternarSelecaoPagina(marcado) {
  const lista = aplicarFiltros();
  const inicio = (paginaAtual - 1) * pageSize;
  lista.slice(inicio, inicio + pageSize).forEach(s => {
    if (marcado) selecionados.add(s.id); else selecionados.delete(s.id);
  });
  render();
}

function limparSelecao() {
  selecionados.clear();
  render();
}

function popularStatusLote() {
  const el = $("ecLoteStatus");
  if (!el) return;
  const atual = el.value;
  el.innerHTML = `<option value="">— (manter)</option>` +
    STATUS_LISTA.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
  if (atual && STATUS_LISTA.includes(atual)) el.value = atual;
}

// IDs dos controles do painel de lote da tabela.
const LOTE_CONTROLES = [
  "ecLoteStatus", "ecLoteDevolvido", "ecLoteSegundaVia", "ecLoteMotivo", "ecLoteObservacao",
  "ecLoteDataSolic", "ecLoteDataEnvio", "ecLoteDataConfeccao", "ecLoteRecebEsc", "ecLoteRecebTrab"
];

function resetarPainelLote() {
  LOTE_CONTROLES.forEach(id => { const el = $(id); if (el) el.value = ""; });
}

// Aplica os campos preenchidos no painel a TODOS os selecionados de uma vez.
async function aplicarStatusLote() {
  if (!podeEditar()) return;
  const matriculas = [...selecionados];
  if (!matriculas.length) { ecToast("Nenhum trabalhador selecionado.", "erro"); return; }

  const campos = {};
  const status = $("ecLoteStatus")?.value || "";
  if (status) campos.statusManual = status;

  const dev = $("ecLoteDevolvido")?.value || "";
  if (dev) campos.devolvido = dev === "sim";

  const seg = $("ecLoteSegundaVia")?.value || "";
  const motivo = ($("ecLoteMotivo")?.value || "").trim();
  if (seg) {
    campos.segundaVia = seg === "sim";
    if (seg === "sim") {
      if (!motivo) { ecToast("Informe o motivo da 2ª via.", "erro"); return; }
      campos.motivoSegundaVia = motivo;
    } else {
      campos.motivoSegundaVia = ""; // 2ª via = Não limpa o motivo
    }
  } else if (motivo) {
    campos.motivoSegundaVia = motivo; // só o motivo, sem mexer no indicador
  }

  const obs = ($("ecLoteObservacao")?.value || "").trim();
  if (obs) campos.observacao = obs;

  const datas = {
    dataSolicitacao: "ecLoteDataSolic", dataEnvio: "ecLoteDataEnvio", dataConfeccao: "ecLoteDataConfeccao",
    dataRecebEscritorio: "ecLoteRecebEsc", dataRecebTrabalhador: "ecLoteRecebTrab"
  };
  Object.keys(datas).forEach(k => { const v = $(datas[k])?.value || ""; if (v) campos[k] = v; });

  if (!Object.keys(campos).length) { ecToast("Preencha ao menos um campo para aplicar.", "erro"); return; }
  if (!window.confirm(`Aplicar as alterações a ${matriculas.length} trabalhador(es) selecionado(s)?`)) return;

  try {
    const resp = await apiPost("/api/cracha/lote", { matriculas, campos });
    (resp.registros || []).forEach(aplicarRegistro);
    const falhas = (resp.erros || []).length;
    selecionados.clear();
    resetarPainelLote();
    render();
    if (detalheId && solicitacoes.some(r => r.id === detalheId)) abrirDetalhe(detalheId);
    ecToast(falhas
      ? `${(resp.registros || []).length} atualizado(s); ${falhas} falharam.`
      : `${(resp.registros || []).length} trabalhador(es) atualizado(s).`, falhas ? "erro" : "ok");
  } catch (e) {
    ecToast(e && e.message ? e.message : "Falha ao aplicar as alterações em lote.", "erro");
  }
}

// ---------- Painel de detalhe ----------
function timelineDe(s) {
  const atualIdx = statusIndex(s.status);
  // Chegou à última fase do funil: todas as etapas (inclusive a atual) ficam
  // verdes, indicando que o fluxo foi concluído.
  const concluido = atualIdx === STATUS_LISTA.length - 1;

  // Data de marco de cada etapa (carimbada ao avançar o status).
  const dataPorEtapa = {
    "Foto Pendente de Envio": s.dataSolicitacao,
    "Crachás em Confecção": s.dataEnvio,
    "Crachá Confeccionado": s.dataConfeccao,
    "Entregue ao Escritório": s.dataRecebEscritorio,
    "Entregue ao Trabalhador": s.dataRecebTrabalhador
  };

  return STATUS_LISTA.map((etapa, idx) => {
    const estado = idx < atualIdx ? "done" : (idx === atualIdx ? (concluido ? "done" : "atual") : "pendente");

    let data = dataPorEtapa[etapa] || "";
    let ator = "";
    if (idx === atualIdx) {                                  // marca quem fez a última atualização
      if (!data && s.atualizadoEm) data = s.atualizadoEm;
      ator = s.atualizadoPor || "";
    }

    return {
      estado,
      data,
      evento: idx === atualIdx ? `${etapa}${concluido ? " (concluído)" : " (atual)"}` : etapa,
      ator
    };
  });
}

function abrirDetalhe(id) {
  const s = solicitacoes.find(r => r.id === id);
  if (!s) return;
  detalheId = id;

  const set = (elId, v) => { const el = $(elId); if (el) el.textContent = v || "—"; };
  $("ecDetalheNome").textContent = s.nome || "—";
  $("ecDetalheBadge").innerHTML = badgeStatus(s.status);

  set("ecDetMatricula", s.matricula);
  set("ecDetDsei", s.dsei);
  set("ecDetCargo", s.cargo);
  set("ecDetSituacao", s.situacaoDetalhada);
  set("ecDetFoto", s.possuiFoto ? "Sim" : "Não");

  set("ecDetStatus", s.status);
  set("ecDetStatusSolic", s.dataSolicitacao);
  set("ecDetStatusEnvio", s.dataEnvio);
  set("ecDetDataConfeccao", s.dataConfeccao);
  set("ecDetDataRecebEsc", s.dataRecebEscritorio);
  set("ecDetDataRecebTrab", s.dataRecebTrabalhador);
  set("ecDetMotivo", s.motivo);
  set("ecDetAtualizado", s.atualizadoEm ? `${s.atualizadoEm}${s.atualizadoPor ? " · " + s.atualizadoPor : ""}` : "");

  set("ecDetDevolvido", s.devolvido ? "Sim" : "Não");
  set("ecDetSegundaVia", s.segundaVia ? "Sim" : "Não");
  set("ecDetMotivo2via", s.segundaVia ? s.motivoSegundaVia : "");

  const timeline = $("ecDetTimeline");
  if (timeline) {
    timeline.innerHTML = timelineDe(s).map(i => `
      <li class="ecTimelineItem is-${i.estado}">
        <div class="ecTimelineDot is-${i.estado}"></div>
        <div class="ecTimelineConteudo">
          <div class="ecTimelineQuando">${escapeHtml(i.data || "—")}</div>
          <div class="ecTimelineEvento">${escapeHtml(i.evento)}</div>
          ${i.ator ? `<div class="ecTimelineAtor">${escapeHtml(i.ator)}</div>` : ""}
        </div>
      </li>`).join("");
  }

  atualizarBotoesAcao(s);

  const obs = $("ecDetObs");
  if (obs) obs.value = s.observacao || "";
  atualizarContadorObs();

  const painel = $("ecDetalhe");
  if (painel) {
    painel.hidden = false;
    painel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  render();
}

// Habilita só o botão da próxima etapa válida; "voltar" enquanto não for a 1ª.
function atualizarBotoesAcao(s) {
  document.querySelectorAll("#ecDetalhe [data-ec-acao]").forEach(btn => {
    const tipo = btn.dataset.ecAcao;
    if (tipo === "voltar") {
      btn.disabled = statusIndex(s.status) <= 0;
      return;
    }
    const t = TRANSICOES[tipo];
    const habilitado = !!t && s.status === t.de;
    btn.disabled = !habilitado;
    btn.classList.toggle("is-proximo", habilitado); // destaca a próxima etapa válida
  });
}

function atualizarContadorObs() {
  const ta = $("ecDetObs");
  const cont = $("ecObsContador");
  if (ta && cont) cont.textContent = `${ta.value.length}/500`;
}

function recolherDetalhe() {
  detalheId = null;
  const painel = $("ecDetalhe");
  if (painel) painel.hidden = true;
  render();
}

// ---------- Persistência (API) ----------
function aplicarRegistro(reg) {
  if (!reg) return;
  const i = solicitacoes.findIndex(r => r.id === reg.id);
  if (i >= 0) solicitacoes[i] = reg;
  else solicitacoes.unshift(reg);
}

async function registrarEtapa(tipo) {
  const s = solicitacoes.find(r => r.id === detalheId);
  if (!s) return;
  const t = TRANSICOES[tipo];
  if (!t || s.status !== t.de) {
    ecToast("Esta ação não se aplica ao status atual.", "erro");
    return;
  }
  await mudarStatus(s.id, t.para, t.msg);
}

async function voltarEtapa() {
  const s = solicitacoes.find(r => r.id === detalheId);
  if (!s) return;
  const idx = statusIndex(s.status);
  if (idx <= 0) { ecToast("O crachá já está na primeira etapa.", "erro"); return; }
  const novo = STATUS_LISTA[idx - 1];
  await mudarStatus(s.id, novo, `Status revertido para "${novo}".`);
}

async function mudarStatus(matricula, status, msgOk) {
  try {
    const resp = await apiPost("/api/cracha/status", { matricula, status });
    aplicarRegistro(resp.registro);
    ecToast(msgOk);
    abrirDetalhe(matricula);
  } catch (e) {
    ecToast(e && e.message ? e.message : "Falha ao atualizar o status.", "erro");
  }
}

async function salvarObservacao() {
  const s = solicitacoes.find(r => r.id === detalheId);
  if (!s) return;
  try {
    const resp = await apiPost("/api/cracha/salvar", {
      matricula: s.matricula,
      observacao: $("ecDetObs")?.value || ""
    });
    aplicarRegistro(resp.registro);
    ecToast("Observação salva.");
    abrirDetalhe(s.id);
  } catch (e) {
    ecToast(e && e.message ? e.message : "Falha ao salvar a observação.", "erro");
  }
}

// ---------- Modal de edição do overlay (datas + indicadores) ----------
// A identidade (matrícula/nome/DSEI/cargo) vem do ETL e é só leitura; o status
// é gerido pelos botões de etapa. Aqui editamos as datas de controle e os
// indicadores (devolvido / 2ª via + motivo).
let modalEditId = null;

const MOTIVOS_2VIA = ["Perda", "Roubo", "Dano", "Extravio", "Outro"];

// Atualiza o contador do campo "Descreva o motivo".
function sincronizarMotivo2via() {
  const ta = $("ecFormMotivo2viaOutro");
  const cont = $("ecFormMotivoContador");
  if (ta && cont) cont.textContent = `${ta.value.length}/200`;
}

// Lê/define os grupos de rádio (Não/Sim) do modal de edição.
function lerRadioBool(name) {
  const el = document.querySelector(`#ecModal input[name="${name}"]:checked`);
  return el ? el.value === "sim" : false;
}
function setRadioBool(name, valor) {
  const alvo = valor ? "sim" : "nao";
  document.querySelectorAll(`#ecModal input[name="${name}"]`).forEach(r => { r.checked = r.value === alvo; });
}

function abrirModal(editId) {
  const s = solicitacoes.find(r => r.id === editId);
  if (!s) return;
  modalEditId = s.id;

  const erro = $("ecModalErro");
  if (erro) erro.textContent = "";
  const titulo = $("ecModalTitulo");
  if (titulo) titulo.textContent = "Editar Crachá";

  const matInput = $("ecFormMatricula");
  if (matInput) { matInput.value = s.matricula || ""; matInput.disabled = true; }
  const nomeInput = $("ecFormNome");
  if (nomeInput) { nomeInput.value = s.nome || ""; nomeInput.disabled = true; }
  const cargoInput = $("ecFormCargo");
  if (cargoInput) { cargoInput.value = s.cargo || ""; cargoInput.disabled = true; }
  const dseiInput = $("ecFormDsei");
  if (dseiInput) { dseiInput.value = s.dsei || ""; dseiInput.disabled = true; }

  $("ecFormDataSolic").value = brParaISO(s.dataSolicitacao);
  $("ecFormDataEnvio").value = brParaISO(s.dataEnvio);
  $("ecFormDataConfeccao").value = brParaISO(s.dataConfeccao);
  $("ecFormDataRecebEsc").value = brParaISO(s.dataRecebEscritorio);
  $("ecFormDataRecebTrab").value = brParaISO(s.dataRecebTrabalhador);

  setRadioBool("ecFormDevolvido", !!s.devolvido);
  setRadioBool("ecFormSegundaVia", !!s.segundaVia);

  // Motivo: se for um dos fixos, seleciona; senão "Outro" + texto livre.
  const motivo = s.motivoSegundaVia || "";
  const ehFixo = MOTIVOS_2VIA.includes(motivo) && motivo !== "Outro";
  $("ecFormMotivo2via").value = motivo ? (ehFixo ? motivo : "Outro") : "";
  $("ecFormMotivo2viaOutro").value = ehFixo ? "" : motivo;
  sincronizarMotivo2via();

  const modal = $("ecModal");
  if (modal) modal.hidden = false;
}

function fecharModal() {
  const modal = $("ecModal");
  if (modal) modal.hidden = true;
  modalEditId = null;
}

async function salvarModal() {
  const erro = $("ecModalErro");
  if (erro) erro.textContent = "";
  const s = solicitacoes.find(r => r.id === modalEditId);
  if (!s) return;

  const segundaVia = lerRadioBool("ecFormSegundaVia");
  const motivoSel = $("ecFormMotivo2via")?.value || "";
  const motivoFinal = !segundaVia ? "" : (motivoSel === "Outro" ? ($("ecFormMotivo2viaOutro")?.value || "").trim() : motivoSel);
  if (segundaVia && !motivoFinal) {
    if (erro) erro.textContent = "Informe o motivo da 2ª via.";
    return;
  }

  try {
    const resp = await apiPost("/api/cracha/salvar", {
      matricula: s.matricula,
      dataSolicitacao: $("ecFormDataSolic")?.value || "",
      dataEnvio: $("ecFormDataEnvio")?.value || "",
      dataConfeccao: $("ecFormDataConfeccao")?.value || "",
      dataRecebEscritorio: $("ecFormDataRecebEsc")?.value || "",
      dataRecebTrabalhador: $("ecFormDataRecebTrab")?.value || "",
      devolvido: lerRadioBool("ecFormDevolvido"),
      segundaVia,
      motivoSegundaVia: motivoFinal
    });
    aplicarRegistro(resp.registro);
    ecToast("Crachá atualizado.");
    fecharModal();
    render();
    if (detalheId === s.id) abrirDetalhe(s.id);
  } catch (e) {
    if (erro) erro.textContent = e && e.message ? e.message : "Falha ao salvar.";
  }
}

// "Reverter": desfaz apenas a última alteração (undo de 1 nível), restaurando o
// estado anterior. Mantém as alterações anteriores e não apaga importados.
async function reverterSolicitacao(matricula) {
  const s = solicitacoes.find(r => r.id === matricula);
  if (!s) return;
  if (!window.confirm(`Desfazer a última alteração de "${s.nome}" (matrícula ${s.matricula})?`)) return;
  try {
    const resp = await apiPost("/api/cracha/reverter", { matricula });
    aplicarRegistro(resp.registro);
    ecToast("Última alteração desfeita.");
    render();
    if (detalheId === matricula) abrirDetalhe(matricula);
  } catch (e) {
    ecToast(e && e.message ? e.message : "Falha ao desfazer.", "erro");
  }
}

// ---------- Selects (DSEIs vêm dos próprios dados) ----------
function preencherSelects() {
  const dseis = [...new Set(solicitacoes.map(s => s.dsei).filter(Boolean))].sort();
  const opcoes = (id, valores, rotuloTodos) => {
    const el = $(id);
    if (!el) return;
    const atual = el.value;
    el.innerHTML = `<option value="">${rotuloTodos}</option>` +
      valores.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
    if (atual && valores.includes(atual)) el.value = atual;
  };
  opcoes("ecFiltroDsei", dseis, "Todos os DSEIs");
  opcoes("ecFiltroStatus", STATUS_LISTA, "Todos os Status");
  opcoes("ecFiltroEscritorio", dseis.map(escritorioDoDsei), "Todos os Escritórios");
  popularStatusLote();

  const formDsei = $("ecFormDsei");
  if (formDsei) {
    const atual = formDsei.value;
    formDsei.innerHTML = `<option value="">Selecione…</option>` +
      dseis.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
    if (atual && dseis.includes(atual)) formDsei.value = atual;
  }
}

function limparFiltros() {
  ["ecFiltroDsei", "ecFiltroStatus", "ecFiltroEscritorio", "ecFiltroDataInicial", "ecFiltroDataFinal", "ecBuscaNome", "ecBuscaCargo"]
    .forEach(id => { const el = $(id); if (el) el.value = ""; });
  lerFiltros();
  paginaAtual = 1;
  render();
}

// ---------- Exportação (Excel / CSV) ----------
// Exporta a lista atualmente filtrada (todas as páginas, não só a visível).
// Gera CSV com BOM + separador ";" — abre direto no Excel, seguindo o padrão
// usado nas demais abas do painel (exportacao.js).
function exportarExcel() {
  const lista = aplicarFiltros();
  if (!lista.length) {
    ecToast("Nenhum registro para exportar com os filtros atuais.", "erro");
    return;
  }

  const rows = lista.map(s => ({
    "Matrícula": s.matricula || "",
    "DSEI": s.dsei || "",
    "Escritório": escritorioDoDsei(s.dsei),
    "Nome": s.nome || "",
    "Cargo": s.cargo || "",
    "Situação Funcional": s.situacaoDetalhada || "",
    "Possui Foto": s.possuiFoto ? "Sim" : "Não",
    "Status": s.status || "",
    "Crachá Devolvido": s.devolvido ? "Sim" : "Não",
    "Solicitação 2ª Via": s.segundaVia ? "Sim" : "Não",
    "Motivo da 2ª Via": s.segundaVia ? (s.motivoSegundaVia || "") : "",
    "Motivo (sem crachá)": s.motivo || "",
    "Observação": s.observacao || "",
    "Última atualização": s.atualizadoEm ? `${s.atualizadoEm}${s.atualizadoPor ? " · " + s.atualizadoPor : ""}` : "",
    "Data da Solicitação": s.dataSolicitacao || "",
    "Data de Envio à Gráfica": s.dataEnvio || "",
    "Data de Confecção": s.dataConfeccao || "",
    "Receb. Escritório": s.dataRecebEscritorio || "",
    "Receb. Trabalhador": s.dataRecebTrabalhador || ""
  }));

  const headers = Object.keys(rows[0]);
  const linhas = [headers, ...rows.map(r => headers.map(h => r[h]))];
  baixarCsv("\uFEFF" + linhas.map(l => l.map(valorCsv).join(";")).join("\r\n"), "entrega_crachas.csv");
}

function baixarCsv(conteudo, nomeArquivo) {
  const blob = new Blob([conteudo], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------- Importa\u00E7\u00E3o de planilha (CSV) ----------
// Colunas do modelo (cabe\u00E7alho amig\u00E1vel -> campo enviado \u00E0 API). `bool`: Sim/N\u00E3o.
const IMPORT_COLS = [
  { header: "Matr\u00EDcula", key: "matricula" },
  { header: "Nome", key: "nome" },
  { header: "DSEI", key: "dsei" },
  { header: "Cargo", key: "cargo" },
  { header: "Situa\u00E7\u00E3o Funcional", key: "situacaoDetalhada" },
  { header: "Status", key: "status" },
  { header: "Data da Solicita\u00E7\u00E3o", key: "dataSolicitacao" },
  { header: "Data de Envio \u00E0 Gr\u00E1fica", key: "dataEnvio" },
  { header: "Data de Confec\u00E7\u00E3o", key: "dataConfeccao" },
  { header: "Receb. Escrit\u00F3rio", key: "dataRecebEscritorio" },
  { header: "Receb. Trabalhador", key: "dataRecebTrabalhador" },
  { header: "Crach\u00E1 Devolvido", key: "devolvido", bool: true },
  { header: "Solicita\u00E7\u00E3o 2\u00AA Via", key: "segundaVia", bool: true },
  { header: "Motivo da 2\u00AA Via", key: "motivoSegundaVia" },
  { header: "Observa\u00E7\u00E3o", key: "observacao" }
];

const MARCA_EXEMPLO = "EXEMPLO - REMOVA ESTA LINHA";
const normalizarHeader = h => (h || "").normalize("NFD").replace(/[\u0300-\u036F]/g, "").trim().toLowerCase().replace(/\s+/g, " ");

// Gera e baixa o modelo (cabe\u00E7alho + 1 linha de exemplo, que deve ser removida).
function baixarModelo() {
  const exemplo = {
    matricula: "123456", nome: MARCA_EXEMPLO, dsei: "DSEI EXEMPLO", cargo: "Ex Enfermeiro",
    situacaoDetalhada: "Normal", status: "Status do cracha", dataSolicitacao: "ex 01/06/2026",
    dataEnvio: "ex 05/06/2026", dataConfeccao: "ex 05/06/2026", dataRecebEscritorio: "ex 05/06/2026", dataRecebTrabalhador: "ex 05/06/2026",
    devolvido: "Caso aplicavel, se nao deixe em branco", segundaVia: "Caso aplicavel, se nao deixe em branco", motivoSegundaVia: "Caso aplicavel, se nao deixe em branco", observacao: "Linha de exemplo \u2014 apague antes de importar"
  };
  const headers = IMPORT_COLS.map(c => c.header);
  const linhas = [headers, IMPORT_COLS.map(c => exemplo[c.key] || "")];
  baixarCsv("\uFEFF" + linhas.map(l => l.map(valorCsv).join(";")).join("\r\n"), "modelo_importacao_crachas.csv");
}

// Parser CSV tolerante (separador ";", aspas com "" escapado, \r\n ou \n, BOM).
function parseCsv(texto) {
  texto = String(texto || "").replace(/^\uFEFF/, "");
  const linhas = [];
  let campo = "", linha = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; }
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ";") { linha.push(campo); campo = ""; }
    else if (c === "\n") { linha.push(campo); linhas.push(linha); linha = []; campo = ""; }
    else if (c !== "\r") campo += c;
  }
  if (campo.length || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

// Bytes 0x80–0xFF do code page 850 ("CSV (MS-DOS)" do Excel) → Unicode.
// O TextDecoder do navegador não suporta CP850, então decodificamos à mão.
const CP850_ALTOS = [
  0x00C7, 0x00FC, 0x00E9, 0x00E2, 0x00E4, 0x00E0, 0x00E5, 0x00E7,
  0x00EA, 0x00EB, 0x00E8, 0x00EF, 0x00EE, 0x00EC, 0x00C4, 0x00C5,
  0x00C9, 0x00E6, 0x00C6, 0x00F4, 0x00F6, 0x00F2, 0x00FB, 0x00F9,
  0x00FF, 0x00D6, 0x00DC, 0x00F8, 0x00A3, 0x00D8, 0x00D7, 0x0192,
  0x00E1, 0x00ED, 0x00F3, 0x00FA, 0x00F1, 0x00D1, 0x00AA, 0x00BA,
  0x00BF, 0x00AE, 0x00AC, 0x00BD, 0x00BC, 0x00A1, 0x00AB, 0x00BB,
  0x2591, 0x2592, 0x2593, 0x2502, 0x2524, 0x00C1, 0x00C2, 0x00C0,
  0x00A9, 0x2563, 0x2551, 0x2557, 0x255D, 0x00A2, 0x00A5, 0x2510,
  0x2514, 0x2534, 0x252C, 0x251C, 0x2500, 0x253C, 0x00E3, 0x00C3,
  0x255A, 0x2554, 0x2569, 0x2566, 0x2560, 0x2550, 0x256C, 0x00A4,
  0x00F0, 0x00D0, 0x00CA, 0x00CB, 0x00C8, 0x0131, 0x00CD, 0x00CE,
  0x00CF, 0x2518, 0x250C, 0x2588, 0x2584, 0x00A6, 0x00CC, 0x2580,
  0x00D3, 0x00DF, 0x00D4, 0x00D2, 0x00F5, 0x00D5, 0x00B5, 0x00FE,
  0x00DE, 0x00DA, 0x00DB, 0x00D9, 0x00FD, 0x00DD, 0x00AF, 0x00B4,
  0x00AD, 0x00B1, 0x2017, 0x00BE, 0x00B6, 0x00A7, 0x00F7, 0x00B8,
  0x00B0, 0x00A8, 0x00B7, 0x00B9, 0x00B3, 0x00B2, 0x25A0, 0x00A0
];

function decodificarBytes(bytes, encoding) {
  if (encoding === "cp850") {
    let out = "";
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      out += String.fromCharCode(b < 0x80 ? b : CP850_ALTOS[b - 0x80]);
    }
    return out;
  }
  try { return new TextDecoder(encoding).decode(bytes); } catch (e) { return ""; }
}

// Decodifica os bytes no encoding informado e devolve as linhas não vazias do CSV.
function lerLinhasCsv(bytes, encoding) {
  const texto = decodificarBytes(bytes, encoding);
  return parseCsv(texto).filter(l => l.some(c => (c || "").trim() !== ""));
}

function mostrarResultadoImport(resp) {
  const info = $("ecImportInfo");
  const erros = resp.erros || [];
  const resumo = `${resp.criados || 0} criado(s), ${resp.atualizados || 0} atualizado(s) de ${resp.total || 0} linha(s).`;
  ecToast(erros.length ? `${resumo} ${erros.length} com erro.` : resumo, erros.length ? "erro" : "ok");
  if (!info) return;
  if (!erros.length) { info.hidden = true; info.innerHTML = ""; return; }
  const itens = erros.slice(0, 50).map(e => `<li>Linha ${escapeHtml(String(e.linha))}${e.matricula ? ` (mat. ${escapeHtml(e.matricula)})` : ""}: ${escapeHtml(e.erro)}</li>`).join("");
  info.hidden = false;
  info.innerHTML = `<strong>${resumo}</strong> ${erros.length} linha(s) com erro:<ul>${itens}</ul>${erros.length > 50 ? "<em>\u2026 e mais.</em>" : ""}`;
}

async function importarPlanilha(file) {
  if (!podeEditar() || !file) return;
  let buffer;
  try { buffer = await file.arrayBuffer(); } catch (e) { ecToast("N\u00E3o foi poss\u00EDvel ler o arquivo.", "erro"); return; }
  const bytes = new Uint8Array(buffer);

  // O Excel exporta CSV em v\u00E1rios encodings (UTF-8, ANSI/Windows-1252 ou
  // CP850 no "CSV (MS-DOS)"). Testamos cada um e ficamos com aquele cujo
  // cabe\u00E7alho reconhece a coluna "Matr\u00EDcula".
  const alvoMatricula = normalizarHeader("Matr\u00EDcula");
  let linhasCsv = null;
  for (const enc of ["utf-8", "windows-1252", "cp850"]) {
    const linhas = lerLinhasCsv(bytes, enc);
    if ((linhas[0] || []).map(normalizarHeader).includes(alvoMatricula)) { linhasCsv = linhas; break; }
  }
  if (!linhasCsv) linhasCsv = lerLinhasCsv(bytes, "utf-8"); // nenhum casou: reporta erro de cabe\u00E7alho

  if (linhasCsv.length < 2) { ecToast("Planilha vazia ou s\u00F3 com cabe\u00E7alho.", "erro"); return; }

  const cabecalho = linhasCsv[0].map(normalizarHeader);
  const idx = {};
  IMPORT_COLS.forEach(col => {
    const pos = cabecalho.indexOf(normalizarHeader(col.header));
    if (pos >= 0) idx[col.key] = { pos, bool: !!col.bool };
  });
  if (idx.matricula === undefined) { ecToast('Cabe\u00E7alho inv\u00E1lido: a coluna "Matr\u00EDcula" \u00E9 obrigat\u00F3ria.', "erro"); return; }

  const linhas = [];
  for (let i = 1; i < linhasCsv.length; i++) {
    const cells = linhasCsv[i];
    const obj = {};
    Object.keys(idx).forEach(key => {
      const { pos, bool } = idx[key];
      const v = (cells[pos] || "").trim();
      if (bool) {
        // Só Sim/Não. Vazio = não altera. Valor não reconhecido é mantido como
        // texto (pendência) para o usuário corrigir na pré-visualização.
        if (v === "") { /* não define */ }
        else if (/^(sim|s|1|true|verdadeiro|x)$/i.test(v)) obj[key] = true;
        else if (/^(n[aã]o|n|0|false|falso)$/i.test(v)) obj[key] = false;
        else obj[key] = v;
      }
      else if (v !== "") obj[key] = v;
    });
    if ((obj.nome || "").toUpperCase().startsWith("EXEMPLO - REMOVA")) continue; // ignora a linha-exemplo
    if (Object.keys(obj).length) linhas.push(obj);
  }
  if (!linhas.length) { ecToast("Nenhuma linha de dados para importar.", "erro"); return; }

  // Em vez de importar direto, abre a pr\u00E9-visualiza\u00E7\u00E3o do lote para o usu\u00E1rio
  // marcar/desmarcar quais linhas ser\u00E3o de fato enviadas.
  abrirPreviewImport(linhas);
}

// ---------- Pr\u00E9-visualiza\u00E7\u00E3o do lote de importa\u00E7\u00E3o ----------
let importLinhas = [];
const importSelecionadas = new Set(); // \u00EDndices marcados para importar

function abrirPreviewImport(linhas) {
  importLinhas = linhas;
  importSelecionadas.clear();
  linhas.forEach((_, i) => importSelecionadas.add(i)); // tudo marcado por padr\u00E3o
  const erro = $("ecImportErro");
  if (erro) erro.textContent = "";
  montarPainelLoteImport();
  renderPreviewImport();
  const modal = $("ecImportModal");
  if (modal) {
    posicionarPreviewAbaixoDoCabecalho(modal);
    modal.hidden = false;
  }
}

// Posiciona o modal abaixo do cabeçalho da página (que tem z-index acima do
// painel da aba), medindo a altura real do cabeçalho.
function posicionarPreviewAbaixoDoCabecalho(modal) {
  const header = document.querySelector(".top");
  const base = header ? Math.ceil(header.getBoundingClientRect().bottom) : 0;
  modal.style.setProperty("--ec-preview-top", `${Math.max(18, base + 10)}px`);
}

// IDs dos controles do painel "Aplicar aos selecionados".
const IMPORT_LOTE_CONTROLES = [
  "ecImpBulkStatus", "ecImpBulkDevolvido", "ecImpBulkSegundaVia", "ecImpBulkMotivo",
  "ecImpBulkObservacao", "ecImpBulkDataSolic", "ecImpBulkDataEnvio", "ecImpBulkDataConfeccao",
  "ecImpBulkRecebEsc", "ecImpBulkRecebTrab"
];

// Preenche o select de status do lote e zera todos os controles ao abrir o modal.
function montarPainelLoteImport() {
  const sel = $("ecImpBulkStatus");
  if (sel) {
    sel.innerHTML = `<option value="">\u2014 (manter)</option>`
      + STATUS_LISTA.map(s => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join("");
  }
  IMPORT_LOTE_CONTROLES.forEach(id => { const el = $(id); if (el) el.value = ""; });
}

// Aplica os campos preenchidos no painel de lote a TODAS as linhas selecionadas.
function aplicarLoteImport() {
  const erro = $("ecImportErro");
  if (!importSelecionadas.size) {
    if (erro) erro.textContent = "Selecione ao menos uma linha para aplicar em lote.";
    return;
  }

  const mudancas = {};
  const status = $("ecImpBulkStatus")?.value || "";
  if (status) mudancas.status = status;
  const dev = $("ecImpBulkDevolvido")?.value || "";
  if (dev) mudancas.devolvido = dev === "sim";
  const seg = $("ecImpBulkSegundaVia")?.value || "";
  if (seg) mudancas.segundaVia = seg === "sim";
  const motivo = ($("ecImpBulkMotivo")?.value || "").trim();
  if (motivo) mudancas.motivoSegundaVia = motivo;
  const obs = ($("ecImpBulkObservacao")?.value || "").trim();
  if (obs) mudancas.observacao = obs;
  const datas = {
    dataSolicitacao: "ecImpBulkDataSolic",
    dataEnvio: "ecImpBulkDataEnvio",
    dataConfeccao: "ecImpBulkDataConfeccao",
    dataRecebEscritorio: "ecImpBulkRecebEsc",
    dataRecebTrabalhador: "ecImpBulkRecebTrab"
  };
  Object.keys(datas).forEach(key => {
    const iso = $(datas[key])?.value || "";
    if (iso) { const br = isoParaBR(iso); if (br) mudancas[key] = br; }
  });

  if (!Object.keys(mudancas).length) {
    if (erro) erro.textContent = "Preencha ao menos um campo no painel de lote para aplicar.";
    return;
  }
  if (erro) erro.textContent = "";

  importLinhas.forEach((linha, i) => {
    if (!importSelecionadas.has(i)) return;
    Object.keys(mudancas).forEach(k => { linha[k] = mudancas[k]; });
  });

  renderPreviewImport(); // reflete nas c\u00E9lulas e recalcula pend\u00EAncias
  ecToast(`Lote aplicado a ${importSelecionadas.size} linha(s).`);
}

function fecharPreviewImport() {
  const modal = $("ecImportModal");
  if (modal) modal.hidden = true;
  importLinhas = [];
  importSelecionadas.clear();
}

// Campos edit\u00E1veis na pr\u00E9-visualiza\u00E7\u00E3o e o tipo de controle de cada um.
// Os demais (matr\u00EDcula, nome, DSEI, cargo) s\u00E3o identidade e ficam s\u00F3 leitura.
const IMPORT_EDIT = {
  situacaoDetalhada: "text",
  status: "status",
  dataSolicitacao: "date",
  dataEnvio: "date",
  dataConfeccao: "date",
  dataRecebEscritorio: "date",
  dataRecebTrabalhador: "date",
  devolvido: "bool",
  segundaVia: "bool",
  motivoSegundaVia: "text",
  observacao: "text"
};

function celulaPreview(linha, key, idx) {
  const tipo = IMPORT_EDIT[key];
  const val = linha[key];
  if (!tipo) return `<td>${val ? escapeHtml(String(val)) : "\u2014"}</td>`; // identidade (s\u00F3 leitura)

  const attr = `data-import-idx="${idx}" data-import-key="${key}"`;

  if (tipo === "date") {
    const invalida = val && !dataBrValida(val);
    const classe = "ecImportEdit ecImportEditDate" + (invalida ? " is-invalido" : "");
    const titulo = invalida ? ' title="Data inválida — selecione uma data válida (dd/mm/aaaa)"' : "";
    return `<td><input type="date" class="${classe}" ${attr} value="${escapeAttr(brParaISOInput(val || ""))}"${titulo}></td>`;
  }

  if (tipo === "bool") {
    const invalido = typeof val === "string" && val.trim() !== ""; // valor fora de Sim/N\u00E3o
    const sel = val === true ? "sim" : (val === false ? "nao" : (invalido ? "__inv" : ""));
    const classe = "ecImportEdit" + (invalido ? " is-invalido" : "");
    const titulo = invalido ? ` title="Valor inv\u00E1lido \u2014 selecione Sim ou N\u00E3o"` : "";
    const optInv = invalido ? `<option value="__inv" selected disabled>${escapeHtml(String(val))} (inv\u00E1lido)</option>` : "";
    return `<td><select class="${classe}" ${attr}${titulo}>
      ${optInv}
      <option value=""${sel === "" ? " selected" : ""}>\u2014</option>
      <option value="sim"${sel === "sim" ? " selected" : ""}>Sim</option>
      <option value="nao"${sel === "nao" ? " selected" : ""}>N\u00E3o</option>
    </select></td>`;
  }

  if (tipo === "status") {
    const match = val ? STATUS_LISTA.find(s => s.toLowerCase() === String(val).trim().toLowerCase()) : "";
    const invalido = !!val && !match;
    const classe = "ecImportEdit ecImportEditStatus" + (invalido ? " is-invalido" : "");
    const titulo = invalido ? ' title="Status inv\u00e1lido \u2014 selecione um status da lista"' : "";
    const optInv = invalido ? `<option value="__inv" selected disabled>${escapeHtml(String(val))} (inv\u00e1lido)</option>` : "";
    const opts = [optInv, `<option value=""${!val ? " selected" : ""}>\u2014</option>`]
      .concat(STATUS_LISTA.map(s => `<option value="${escapeAttr(s)}"${s === match ? " selected" : ""}>${escapeHtml(s)}</option>`));
    return `<td><select class="${classe}" ${attr}${titulo}>${opts.join("")}</select></td>`;
  }

  // text (situa\u00E7\u00E3o funcional, motivo da 2\u00AA via, observa\u00E7\u00E3o)
  return `<td><input type="text" class="ecImportEdit ecImportEditText" ${attr} value="${escapeAttr(val || "")}"></td>`;
}

function renderPreviewImport() {
  const thead = $("ecImportThead");
  const tbody = $("ecImportTbody");
  if (!thead || !tbody) return;

  thead.innerHTML = `<tr><th class="ecImportColCheck"></th><th>#</th>${IMPORT_COLS.map(c => `<th>${escapeHtml(c.header)}</th>`).join("")}</tr>`;

  tbody.innerHTML = importLinhas.map((linha, i) => {
    const marcado = importSelecionadas.has(i);
    const cels = IMPORT_COLS.map(c => celulaPreview(linha, c.key, i)).join("");
    return `<tr class="${marcado ? "" : "is-off"}">
      <td class="ecImportColCheck"><input type="checkbox" class="ecImportCheck" data-import-idx="${i}"${marcado ? " checked" : ""}></td>
      <td>${i + 1}</td>${cels}</tr>`;
  }).join("");

  atualizarPreviewContador();
}

// Atualiza o modelo do lote conforme o usu\u00E1rio edita uma c\u00E9lula (sem re-render,
// para n\u00E3o perder o foco). Campo vazio \u00E9 removido (= "n\u00E3o alterar" na importa\u00E7\u00E3o).
function editarCampoPreview(idx, key, el) {
  const linha = importLinhas[idx];
  if (!linha) return;
  const tipo = IMPORT_EDIT[key];

  if (tipo === "bool") {
    if (el.value === "sim") linha[key] = true;
    else if (el.value === "nao") linha[key] = false;
    else delete linha[key];
  } else if (tipo === "date") {
    const br = isoParaBR(el.value);
    if (br) linha[key] = br; else delete linha[key];
  } else {
    const v = (el.value || "").trim();
    if (v) linha[key] = v; else delete linha[key];
  }

  // Resolveu a pend\u00EAncia: tira o destaque e a op\u00E7\u00E3o de valor inv\u00E1lido (se houver).
  el.classList.remove("is-invalido");
  if (el.tagName === "SELECT") el.querySelector('option[value="__inv"]')?.remove();

  atualizarPreviewContador(); // recalcula pend\u00EAncias e libera/bloqueia o bot\u00E3o
}

// Pend\u00EAncias que impedem a importa\u00E7\u00E3o: data inv\u00E1lida, Sim/N\u00E3o inv\u00E1lido ou status inv\u00E1lido.
const IMPORT_DATE_KEYS = ["dataSolicitacao", "dataEnvio", "dataConfeccao", "dataRecebEscritorio", "dataRecebTrabalhador"];
const IMPORT_BOOL_KEYS = ["devolvido", "segundaVia"];

function linhaTemPendencia(linha) {
  if (IMPORT_DATE_KEYS.some(k => linha[k] && !dataBrValida(linha[k]))) return true;
  if (IMPORT_BOOL_KEYS.some(k => typeof linha[k] === "string" && linha[k].trim() !== "")) return true;
  if (linha.status && !statusValido(linha.status)) return true;
  return false;
}

function atualizarPreviewContador() {
  const total = importLinhas.length;
  const sel = importSelecionadas.size;

  // Conta pendências (data inválida / Sim-Não inválido) apenas entre as selecionadas.
  let pendentes = 0;
  importLinhas.forEach((linha, i) => {
    if (importSelecionadas.has(i) && linhaTemPendencia(linha)) pendentes++;
  });

  const cont = $("ecImportContador");
  if (cont) cont.textContent = `${sel} de ${total} selecionada(s)`;

  const selAll = $("ecImportSelAll");
  if (selAll) {
    selAll.checked = total > 0 && sel === total;
    selAll.indeterminate = sel > 0 && sel < total;
  }

  const aviso = $("ecImportAviso");
  if (aviso) {
    if (pendentes > 0) {
      aviso.textContent = `${pendentes} linha(s) com dados inválidos — corrija os campos em vermelho para liberar a importação.`;
      aviso.hidden = false;
    } else {
      aviso.textContent = "";
      aviso.hidden = true;
    }
  }

  const btn = $("ecImportConfirmar");
  if (btn) {
    btn.disabled = sel === 0 || pendentes > 0;
    btn.textContent = `Importar selecionadas (${sel})`;
  }

  const btnLote = $("ecImpBulkAplicar");
  if (btnLote) {
    btnLote.disabled = sel === 0;
    btnLote.textContent = `Aplicar aos selecionados (${sel})`;
  }
}

function alternarLinhaPreview(i, marcado) {
  if (marcado) importSelecionadas.add(i); else importSelecionadas.delete(i);
  const cb = $("ecImportTbody")?.querySelector(`input[data-import-idx="${i}"]`);
  const tr = cb ? cb.closest("tr") : null;
  if (tr) tr.classList.toggle("is-off", !marcado);
  atualizarPreviewContador();
}

function alternarTodasPreview(marcado) {
  importSelecionadas.clear();
  if (marcado) importLinhas.forEach((_, i) => importSelecionadas.add(i));
  renderPreviewImport();
}

async function confirmarImportacao() {
  const linhas = importLinhas.filter((_, i) => importSelecionadas.has(i));
  const erro = $("ecImportErro");
  if (!linhas.length) {
    if (erro) erro.textContent = "Selecione ao menos uma linha para importar.";
    return;
  }

  // Trava de segurança: nenhuma linha selecionada pode ter pendência.
  const linhasPendentes = [];
  importLinhas.forEach((linha, i) => {
    if (importSelecionadas.has(i) && linhaTemPendencia(linha)) linhasPendentes.push(i + 1);
  });
  if (linhasPendentes.length) {
    if (erro) erro.textContent = `Corrija os campos em vermelho nas linhas ${linhasPendentes.join(", ")} antes de importar.`;
    return;
  }
  if (erro) erro.textContent = "";

  const btn = $("ecImportConfirmar");
  if (btn) btn.disabled = true;
  try {
    const resp = await apiPost("/api/cracha/importar", { linhas });
    fecharPreviewImport();
    await carregarDados();             // re-busca: inclui trabalhadores rec\u00E9m-criados
    mostrarResultadoImport(resp);
  } catch (e) {
    if (erro) erro.textContent = e && e.message ? e.message : "Falha ao importar a planilha.";
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ---------- Carregamento dos dados reais ----------
// forcar=true ignora o cache do servidor (botão "Atualizar"): reflete na hora as
// mudanças vindas do ETL e da tabela manual feitas fora do app.
async function carregarDados(forcar = false) {
  if (carregando) return;
  carregando = true;
  erroCarregamento = "";
  render();
  try {
    const payload = await apiGet("/api/cracha" + (forcar ? "?atualizar=1" : ""));
    solicitacoes = payload.rows || [];
    if (Array.isArray(payload.statusFunil) && payload.statusFunil.length) {
      STATUS_LISTA = payload.statusFunil;
    }
    carregado = true;
    if (forcar) ecToast("Dados atualizados.");
  } catch (e) {
    erroCarregamento = e && e.message ? e.message : "Falha ao carregar os dados de crachás.";
  } finally {
    carregando = false;
    preencherSelects();
    render();
  }
}

// ---------- Inicialização ----------
let entregaCrachaConfigurada = false;

export function configurarEntregaCracha() {
  if (entregaCrachaConfigurada) return;
  const raiz = $("view-entregaCracha");
  if (!raiz) return;
  entregaCrachaConfigurada = true;

  raiz.classList.toggle("ec-readonly", !podeEditar());

  preencherSelects();
  render();

  // Carregamento sob demanda: a base tem ~18k linhas; só busca quando a aba é
  // aberta pela primeira vez (evita baixar tudo em todo load do painel).
  // Recarrega ao abrir a aba: reflete mudanças feitas fora desta sessão (outro
  // admin, ETL, banco). Em recargas seguintes a tabela atual fica na tela até os
  // dados novos chegarem (sem "piscar" o loading).
  const navItem = document.querySelector('.navItem[data-view="entregaCracha"]');
  if (navItem) navItem.addEventListener("click", () => { if (!carregando) carregarDados(); });
  if (state.activeView === "entregaCracha") carregarDados();

  // Filtros reagem na hora (change para selects/datas, input para buscas).
  raiz.querySelectorAll("[data-ec-filtro]").forEach(el => {
    const evento = el.tagName === "INPUT" && el.type === "search" ? "input" : "change";
    el.addEventListener(evento, () => { lerFiltros(); paginaAtual = 1; render(); });
  });

  // Seletor de "registros por página".
  const selPorPagina = $("ecPorPagina");
  if (selPorPagina) {
    selPorPagina.innerHTML = PAGE_SIZE_OPCOES.map(n => `<option value="${n}">${n}</option>`).join("");
    selPorPagina.value = String(pageSize);
    selPorPagina.addEventListener("change", e => {
      const n = Number(e.target.value);
      pageSize = PAGE_SIZE_OPCOES.includes(n) ? n : 10;
      paginaAtual = 1;
      render();
    });
  }

  $("ecBtnAtualizar")?.addEventListener("click", () => { if (!carregando) carregarDados(true); });
  $("ecBtnLimpar")?.addEventListener("click", limparFiltros);
  $("ecBtnExportar")?.addEventListener("click", exportarExcel);
  $("ecBtnImportar")?.addEventListener("click", () => $("ecInputImport")?.click());
  $("ecInputImport")?.addEventListener("change", e => {
    const file = e.target.files && e.target.files[0];
    importarPlanilha(file);
    e.target.value = ""; // permite reimportar o mesmo arquivo
  });

  // Pré-visualização do lote de importação (seleção de linhas).
  $("ecImportFechar")?.addEventListener("click", fecharPreviewImport);
  $("ecImportCancelar")?.addEventListener("click", fecharPreviewImport);
  $("ecImportConfirmar")?.addEventListener("click", confirmarImportacao);
  $("ecImportSelAll")?.addEventListener("change", e => alternarTodasPreview(e.target.checked));
  $("ecImpBulkAplicar")?.addEventListener("click", aplicarLoteImport);
  $("ecImportTbody")?.addEventListener("change", e => {
    const cb = e.target.closest(".ecImportCheck");
    if (cb) { alternarLinhaPreview(Number(cb.dataset.importIdx), cb.checked); return; }
    const edit = e.target.closest(".ecImportEdit");
    if (edit) editarCampoPreview(Number(edit.dataset.importIdx), edit.dataset.importKey, edit);
  });
  $("ecImportModal")?.addEventListener("click", event => {
    if (event.target === $("ecImportModal")) fecharPreviewImport();
  });
  $("ecBtnRecolher")?.addEventListener("click", recolherDetalhe);
  $("ecBtnSalvarObs")?.addEventListener("click", salvarObservacao);
  $("ecDetObs")?.addEventListener("input", atualizarContadorObs);

  // Seleção em lote.
  $("ecSelecionarPagina")?.addEventListener("change", e => alternarSelecaoPagina(e.target.checked));
  $("ecLoteAplicar")?.addEventListener("click", aplicarStatusLote);
  $("ecLoteLimpar")?.addEventListener("click", limparSelecao);
  $("ecLoteLimparCampos")?.addEventListener("click", resetarPainelLote);
  $("ecLoteToggle")?.addEventListener("click", () => $("ecLoteBar")?.classList.toggle("is-recolhido"));

  // Modal.
  $("ecModalFechar")?.addEventListener("click", fecharModal);
  $("ecModalCancelar")?.addEventListener("click", fecharModal);
  $("ecModalSalvar")?.addEventListener("click", salvarModal);
  $("ecFormMotivo2viaOutro")?.addEventListener("input", sincronizarMotivo2via);
  $("ecModal")?.addEventListener("click", event => {
    if (event.target === $("ecModal")) fecharModal();
  });

  // Seleção por linha (checkboxes gerados dinamicamente).
  raiz.addEventListener("change", event => {
    const sel = event.target.closest("[data-ec-sel]");
    if (sel) alternarSelecao(sel.dataset.ecSel, sel.checked);
  });

  // Delegação para elementos gerados dinamicamente.
  raiz.addEventListener("click", event => {
    const ver = event.target.closest("[data-ec-ver]");
    if (ver) { abrirDetalhe(ver.dataset.ecVer); return; }

    const editar = event.target.closest("[data-ec-editar]");
    if (editar) { abrirModal(editar.dataset.ecEditar); return; }

    const reverter = event.target.closest("[data-ec-reverter]");
    if (reverter) { reverterSolicitacao(reverter.dataset.ecReverter); return; }

    const pagina = event.target.closest("[data-ec-pagina]");
    if (pagina && !pagina.disabled) { irParaPagina(pagina.dataset.ecPagina); return; }

    const acao = event.target.closest("[data-ec-acao]");
    if (acao && !acao.disabled) {
      if (acao.dataset.ecAcao === "voltar") voltarEtapa();
      else registrarEtapa(acao.dataset.ecAcao);
      return;
    }
  });
}
