// =========================================================
// Controle de Estabilidade (maquete — dados fictícios)
// Aba no visual/identidade do painel: KPIs, filtros, tabela e painel de detalhe.
// Sem backend: os dados vivem na constante DADOS abaixo (trocar por API depois).
// =========================================================
import { escapeHtml, escapeAttr, formatNumber } from "./utils.js";

const $ = id => document.getElementById(id);

// Cores/rotulos de status (identidade do sistema).
const STATUS = {
  "Ativa": { cor: "#1f8a53", bg: "rgba(31,138,83,.14)" },
  "A vencer": { cor: "#b7791f", bg: "rgba(231,185,61,.20)" },
  "Vencida": { cor: "#c0392b", bg: "rgba(192,57,43,.14)" },
  "Encerrada": { cor: "#64748b", bg: "rgba(100,116,139,.16)" }
};

// ---------- Dados fictícios ----------
const DADOS = [
  { dsei: "DSEI Yanomami", nome: "Maria Silva da Costa", cargo: "Enfermeiro", tipo: "CIPAA", motivo: "Membro da CIPAA", inicio: "2024-04-15", fim: "2025-04-15", dias: 330, status: "Ativa", nova: false, doc: "Portaria_CIPAA_2024_MariaSilva.pdf", admissao: "2020-04-10", matricula: "123456", lotacao: "Polo Base Maturacá", unidade: "CASAI Boa Vista" },
  { dsei: "DSEI Alto Rio Negro", nome: "João Pereira Lima", cargo: "Técnico de Enfermagem", tipo: "Acidente de Trabalho", motivo: "Acidente durante atividade laboral", inicio: "2024-04-12", fim: "2024-10-12", dias: 146, status: "Ativa", nova: true, doc: "CAT_JoaoPereira_2024.pdf", admissao: "2019-08-01", matricula: "223344", lotacao: "Polo Base Iauaretê", unidade: "CASAI São Gabriel" },
  { dsei: "DSEI Kayapó do Pará", nome: "Carlos Mendes dos Santos", cargo: "Agente Indígena de Saúde", tipo: "Judicial", motivo: "Decisão Judicial", inicio: "2024-03-01", fim: "2026-03-01", dias: 650, status: "Ativa", nova: false, doc: "Decisao_Judicial_CarlosMendes.pdf", admissao: "2018-02-20", matricula: "334455", lotacao: "Polo Base Tucumã", unidade: "CASAI Redenção" },
  { dsei: "DSEI Leste de Roraima", nome: "Ana Beatriz Souza", cargo: "Enfermeiro", tipo: "Gestante", motivo: "Estabilidade Gestante", inicio: "2024-02-20", fim: "2024-11-20", dias: 185, status: "Ativa", nova: true, doc: "Atestado_Gestacao_AnaBeatriz.pdf", admissao: "2021-06-15", matricula: "445566", lotacao: "Polo Base Normandia", unidade: "CASAI Boa Vista" },
  { dsei: "DSEI Maranhão", nome: "Rafael Oliveira", cargo: "Técnico de Enfermagem", tipo: "CIPAA", motivo: "Membro da CIPAA", inicio: "2024-01-10", fim: "2025-01-10", dias: 239, status: "Ativa", nova: false, doc: "Portaria_CIPAA_RafaelOliveira.pdf", admissao: "2017-11-03", matricula: "556677", lotacao: "Polo Base Amarante", unidade: "CASAI São Luís" },
  { dsei: "DSEI Parintins", nome: "Luana Ferreira", cargo: "Enfermeiro", tipo: "Acidente de Trabalho", motivo: "Acidente durante deslocamento", inicio: "2023-12-05", fim: "2024-06-05", dias: 16, status: "A vencer", nova: false, doc: "CAT_LuanaFerreira.pdf", admissao: "2020-09-12", matricula: "667788", lotacao: "Polo Base Vila Amazônia", unidade: "CASAI Parintins" },
  { dsei: "DSEI Xingu", nome: "Paulo Henrique Dias", cargo: "Agente Indígena de Saúde", tipo: "Judicial", motivo: "Reintegração Judicial", inicio: "2023-10-18", fim: "2024-04-18", dias: -28, status: "Vencida", nova: false, doc: "Decisao_Reintegracao_PauloDias.pdf", admissao: "2016-05-30", matricula: "778899", lotacao: "Polo Base Pavuru", unidade: "CASAI Canarana" },
  { dsei: "DSEI Cuiabá", nome: "Fernanda Alves Rocha", cargo: "Cirurgião Dentista", tipo: "Gestante", motivo: "Estabilidade Gestante", inicio: "2024-05-02", fim: "2025-02-02", dias: 258, status: "Ativa", nova: true, doc: "Atestado_Gestacao_FernandaRocha.pdf", admissao: "2022-01-18", matricula: "889900", lotacao: "Polo Base Rondonópolis", unidade: "CASAI Cuiabá" },
  { dsei: "DSEI Alto Rio Solimões", nome: "Ricardo Nunes", cargo: "Médico", tipo: "CIPAA", motivo: "Suplente da CIPAA", inicio: "2023-05-01", fim: "2024-05-01", dias: 0, status: "Encerrada", nova: false, doc: "Portaria_CIPAA_RicardoNunes.pdf", admissao: "2015-03-22", matricula: "990011", lotacao: "Polo Base Tabatinga", unidade: "CASAI Tabatinga" },
  { dsei: "DSEI Manaus", nome: "Beatriz Carvalho", cargo: "Técnico de Enfermagem", tipo: "Acidente de Trabalho", motivo: "Acidente laboral com afastamento", inicio: "2023-03-15", fim: "2024-03-15", dias: 0, status: "Encerrada", nova: false, doc: "CAT_BeatrizCarvalho.pdf", admissao: "2019-07-09", matricula: "101112", lotacao: "Polo Base Manaus", unidade: "CASAI Manaus" }
];

let selecionado = 0;
let configurado = false;

// ---------- Helpers ----------
function fData(iso) {
  if (!iso) return "—";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return (a && m && d) ? `${d}/${m}/${a}` : "—";
}
const distintos = chave => [...new Set(DADOS.map(r => r[chave]))].sort((a, b) => String(a).localeCompare(String(b), "pt-BR"));

function lerFiltros() {
  return {
    dsei: $("ceFiltroDsei")?.value || "",
    status: $("ceFiltroStatus")?.value || "",
    tipo: $("ceFiltroTipo")?.value || "",
    ini: $("ceDataIni")?.value || "",
    fim: $("ceDataFim")?.value || "",
    nome: ($("ceBuscaNome")?.value || "").trim().toLowerCase(),
    motivo: ($("ceBuscaMotivo")?.value || "").trim().toLowerCase()
  };
}
function aplicarFiltros() {
  const f = lerFiltros();
  return DADOS.filter(r => {
    if (f.dsei && r.dsei !== f.dsei) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.tipo && r.tipo !== f.tipo) return false;
    if (f.ini && r.inicio < f.ini) return false;
    if (f.fim && r.inicio > f.fim) return false;
    if (f.nome && !r.nome.toLowerCase().includes(f.nome)) return false;
    if (f.motivo && !r.motivo.toLowerCase().includes(f.motivo)) return false;
    return true;
  });
}

// ---------- KPIs (mesmo visual da Gestão de Férias — classes gfKpi) ----------
function kpiCard(cls, icone, valor, rotulo) {
  return `<article class="gfKpi ${cls}"><div class="gfKpiIcon"><i class="fa-solid ${icone}"></i></div><div class="gfKpiInfo"><span class="gfKpiLabel">${escapeHtml(rotulo)}</span><span class="gfKpiValue">${formatNumber(valor)}</span></div></article>`;
}
function renderKpis() {
  const ativas = DADOS.filter(r => r.status === "Ativa").length;
  const aVencer = DADOS.filter(r => r.status === "A vencer").length;
  const vencidas = DADOS.filter(r => r.status === "Vencida").length;
  const encerradas = DADOS.filter(r => r.status === "Encerrada").length;
  const novas = DADOS.filter(r => r.nova).length;
  const estaveis = ativas + aVencer;
  $("ceKpis").innerHTML =
    kpiCard("gf-k-ativos", "fa-user-shield", estaveis, "Estáveis atualmente") +
    kpiCard("gf-k-prog", "fa-user-plus", novas, "Novas estabilidades (30 dias)") +
    kpiCard("gf-k-a90", "fa-hourglass-half", aVencer, "Estabilidades a vencer (30 dias)") +
    kpiCard("gf-k-a30", "fa-triangle-exclamation", vencidas, "Estabilidades vencidas") +
    kpiCard("gf-k-gozo", "fa-shield-halved", ativas, "Total de estabilidades ativas") +
    kpiCard("gf-k-sem", "fa-box-archive", encerradas, "Total de estabilidades encerradas");
}

// ---------- Tabela ----------
function badge(status) {
  const s = STATUS[status] || STATUS["Encerrada"];
  return `<span class="ceBadge" style="color:${s.cor};background:${s.bg}">${escapeHtml(status)}</span>`;
}
function celDias(r) {
  const cls = r.dias < 0 ? "is-neg" : r.dias <= 30 ? "is-warn" : "";
  const txt = r.status === "Encerrada" ? "—" : formatNumber(r.dias);
  return `<span class="ceDias ${cls}">${txt}</span>`;
}
function renderTabela() {
  const linhas = aplicarFiltros();
  const body = $("ceTabelaBody");
  const resumo = $("ceResumo");
  if (resumo) resumo.textContent = `${formatNumber(linhas.length)} de ${formatNumber(DADOS.length)} estabilidades`;
  if (!body) return;
  if (!linhas.length) {
    body.innerHTML = `<tr><td colspan="11" class="ceVazio">Nenhuma estabilidade para os filtros selecionados.</td></tr>`;
    $("ceTabelaInfo").textContent = "Mostrando 0 registros";
    return;
  }
  body.innerHTML = linhas.map(r => {
    const i = DADOS.indexOf(r);
    return `
      <tr class="ceRow${i === selecionado ? " is-sel" : ""}" data-ce-idx="${i}">
        <td>${escapeHtml(r.dsei)}</td>
        <td class="ceTdNome">${escapeHtml(r.nome)}</td>
        <td>${escapeHtml(r.cargo)}</td>
        <td>${escapeHtml(r.tipo)}</td>
        <td>${escapeHtml(r.motivo)}</td>
        <td>${fData(r.inicio)}</td>
        <td>${fData(r.fim)}</td>
        <td>${celDias(r)}</td>
        <td>${badge(r.status)}</td>
        <td class="ceTdDoc"><a class="ceDocIcon" title="${escapeAttr(r.doc)}" data-ce-doc="${i}"><i class="fa-regular fa-file-lines"></i></a></td>
        <td class="ceTdAcoes">
          <button type="button" class="ceAcao" title="Ver" data-ce-ver="${i}"><i class="fa-solid fa-eye"></i></button>
          <button type="button" class="ceAcao" title="Editar" data-ce-editar="${i}"><i class="fa-solid fa-pen"></i></button>
          <button type="button" class="ceAcao ceAcaoDel" title="Excluir" data-ce-excluir="${i}"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>`;
  }).join("");
  $("ceTabelaInfo").textContent = `Mostrando ${formatNumber(linhas.length)} de ${formatNumber(DADOS.length)} registros`;
}

// ---------- Detalhe ----------
function bloco(titulo, linhas) {
  return `
    <div class="ceDetBloco">
      <h4 class="ceDetTitulo">${escapeHtml(titulo)}</h4>
      <dl class="ceDetLista">${linhas}</dl>
    </div>`;
}
function item(rot, val) { return `<div class="ceDetItem"><dt>${escapeHtml(rot)}</dt><dd>${escapeHtml(val || "—")}</dd></div>`; }

function renderDetalhe() {
  const r = DADOS[selecionado];
  const el = $("ceDetalhe");
  if (!el || !r) return;
  el.innerHTML = `
    <div class="ceDetHead">
      <div class="ceDetNome">${escapeHtml(r.nome)} ${badge(r.status)}</div>
      <button type="button" class="ceBtnHist"><i class="fa-solid fa-clock-rotate-left"></i> Histórico de Alterações</button>
    </div>
    <div class="ceDetGrid">
      ${bloco("Dados do Profissional",
        item("DSEI", r.dsei) + item("Cargo", r.cargo) + item("Data de Admissão", fData(r.admissao)) +
        item("Matrícula", r.matricula) + item("Lotação", r.lotacao) + item("Unidade", r.unidade))}
      ${bloco("Dados da Estabilidade",
        item("Tipo de Estabilidade", r.tipo) + item("Motivo", r.motivo) + item("Data Início", fData(r.inicio)) +
        item("Data Fim", fData(r.fim)) + item("Dias Restantes", r.status === "Encerrada" ? "—" : `${formatNumber(r.dias)} dias`) + item("Status", r.status))}
      <div class="ceDetBloco">
        <h4 class="ceDetTitulo">Documento da Estabilidade</h4>
        <div class="ceDocCard">
          <i class="fa-regular fa-file-pdf ceDocPdf"></i>
          <div class="ceDocInfo"><strong>${escapeHtml(r.doc)}</strong><span>Enviado por ADMIN</span></div>
          <button type="button" class="ceDocBtn"><i class="fa-solid fa-download"></i> Download</button>
        </div>
      </div>
      <div class="ceDetBloco">
        <h4 class="ceDetTitulo">Ações</h4>
        <div class="ceDetAcoes">
          <button type="button" class="ceDetBtn"><i class="fa-solid fa-pen"></i> Editar Estabilidade</button>
          <button type="button" class="ceDetBtn"><i class="fa-solid fa-flag-checkered"></i> Encerrar Estabilidade</button>
          <button type="button" class="ceDetBtn"><i class="fa-solid fa-calendar-plus"></i> Registrar Prorrogação</button>
          <button type="button" class="ceDetBtn"><i class="fa-solid fa-file-arrow-up"></i> Registrar Documento</button>
        </div>
        <label class="ceObsLabel">Observações</label>
        <textarea class="ceObs" placeholder="Adicionar observação…"></textarea>
        <button type="button" class="ceObsBtn">Salvar observação</button>
      </div>
    </div>`;
}

function render() {
  renderKpis();
  renderTabela();
  renderDetalhe();
}

// ---------- Inicialização ----------
export function configurarControleEstabilidade() {
  if (configurado) return;
  const raiz = $("view-controleEstabilidade");
  if (!raiz) return;
  configurado = true;

  // Popula selects de DSEI e Tipo a partir dos dados.
  const selDsei = $("ceFiltroDsei");
  if (selDsei) selDsei.innerHTML = `<option value="">Todos os DSEIs</option>` + distintos("dsei").map(v => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`).join("");
  const selTipo = $("ceFiltroTipo");
  if (selTipo) selTipo.innerHTML = `<option value="">Todos os Tipos</option>` + distintos("tipo").map(v => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`).join("");

  // Filtros reagem a mudança/digitação.
  ["ceFiltroDsei", "ceFiltroStatus", "ceFiltroTipo", "ceDataIni", "ceDataFim"].forEach(id => $(id)?.addEventListener("change", renderTabela));
  ["ceBuscaNome", "ceBuscaMotivo"].forEach(id => $(id)?.addEventListener("input", renderTabela));

  $("ceLimpar")?.addEventListener("click", () => {
    ["ceFiltroDsei", "ceFiltroStatus", "ceFiltroTipo", "ceDataIni", "ceDataFim", "ceBuscaNome", "ceBuscaMotivo"].forEach(id => { const el = $(id); if (el) el.value = ""; });
    renderTabela();
  });

  // Clique na tabela: selecionar linha (ver detalhe).
  $("ceTabelaBody")?.addEventListener("click", e => {
    const alvo = e.target.closest("[data-ce-idx], [data-ce-ver], [data-ce-doc]");
    if (!alvo) return;
    const idx = Number(alvo.dataset.ceIdx ?? alvo.dataset.ceVer ?? alvo.dataset.ceDoc);
    if (Number.isInteger(idx)) { selecionado = idx; renderTabela(); renderDetalhe(); }
  });

  render();
}
