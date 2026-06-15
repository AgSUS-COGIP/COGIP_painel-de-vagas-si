// =========================================================
// Gestão de Férias (maquete interativa)
// Renderiza as tabelas a partir de dados de exemplo e liga os
// botões/filtros da aba. É autocontido: registra os próprios
// ouvintes em configurarGestaoFerias(), chamado no init do app.
// Não há backend — as ações operam sobre os dados em memória.
// =========================================================
import { escapeHtml } from "./utils.js";

// ---------- Dados de exemplo ----------
// Profissionais do lote em edição (dirigem o "Resumo do Lote").
let loteProfissionais = [
  {
    nome: "João da Silva", cargo: "Enfermeiro", matricula: "125478",
    aquisitivo: "01/01/2024 a 31/12/2024", prazo: "31/12/2025",
    p1: "01/03/2025 a 15/03/2025", p2: "01/07/2025 a 10/07/2025", p3: "01/11/2025 a 05/11/2025",
    abono: true, diasAbono: 10, situacao: "Em elaboração"
  },
  {
    nome: "Maria Oliveira", cargo: "Médico Clínico Geral", matricula: "154789",
    aquisitivo: "01/02/2024 a 31/01/2025", prazo: "31/01/2027",
    p1: "15/04/2025 a 29/04/2025", p2: "—", p3: "—",
    abono: false, diasAbono: 0, situacao: "Em elaboração"
  }
];

// Pool usado pelo botão "Adicionar Colaborador" (apenas demonstração).
const POOL_COLABORADORES = [
  {
    nome: "Antônio Lima", cargo: "Téc. de Enfermagem", matricula: "167203",
    aquisitivo: "01/03/2024 a 28/02/2025", prazo: "28/02/2027",
    p1: "01/06/2025 a 30/06/2025", p2: "—", p3: "—",
    abono: false, diasAbono: 0, situacao: "Em elaboração"
  },
  {
    nome: "Paula Santos", cargo: "Dentista", matricula: "178412",
    aquisitivo: "01/04/2024 a 31/03/2025", prazo: "31/03/2027",
    p1: "01/08/2025 a 15/08/2025", p2: "01/12/2025 a 11/12/2025", p3: "—",
    abono: true, diasAbono: 10, situacao: "Em elaboração"
  },
  {
    nome: "Carlos Mendes", cargo: "Psicólogo", matricula: "189550",
    aquisitivo: "01/05/2024 a 30/04/2025", prazo: "30/04/2027",
    p1: "10/09/2025 a 24/09/2025", p2: "—", p3: "—",
    abono: false, diasAbono: 0, situacao: "Em elaboração"
  }
];
let proximoDoPool = 0;

// Consulta geral (filtrável).
const CONSULTA = [
  { prof: "João da Silva", cargo: "Enfermeiro", dsei: "DSEI Yanomami", situacao: "Em Gozo", periodo: "01/03 a 30/03/2025", pagamento: "Pago", comp: "Mar/2025" },
  { prof: "Maria Oliveira", cargo: "Médico Clínico Geral", dsei: "DSEI Leste de Roraima", situacao: "Programado", periodo: "15/08 a 13/09/2025", pagamento: "Não Pago", comp: "Ago/2025" },
  { prof: "Antônio Lima", cargo: "Téc. de Enfermagem", dsei: "DSEI Alto Rio Negro", situacao: "Programado", periodo: "01/06 a 30/06/2025", pagamento: "Pago", comp: "Jun/2025" },
  { prof: "Paula Santos", cargo: "Dentista", dsei: "DSEI Kayapó do Pará", situacao: "Sem Programação", periodo: "—", pagamento: "—", comp: "—" },
  { prof: "Carlos Mendes", cargo: "Psicólogo", dsei: "DSEI Maranhão", situacao: "Aguard. Aprovação", periodo: "10/09 a 24/09/2025", pagamento: "Não Pago", comp: "Set/2025" },
  { prof: "Beatriz Rocha", cargo: "Enfermeiro", dsei: "CASAI Boa Vista", situacao: "Em Gozo", periodo: "05/04 a 04/05/2025", pagamento: "Pago", comp: "Abr/2025" },
  { prof: "Rafael Souza", cargo: "Médico Clínico Geral", dsei: "DSEI Yanomami", situacao: "Programado", periodo: "01/10 a 30/10/2025", pagamento: "Não Pago", comp: "Out/2025" },
  { prof: "Juliana Castro", cargo: "Téc. de Enfermagem", dsei: "CASAI Manaus", situacao: "Aguard. Aprovação", periodo: "12/07 a 26/07/2025", pagamento: "Não Pago", comp: "Jul/2025" }
];

// Histórico de lotes + detalhamento de cada lote.
const HISTORICO = [
  { data: "20/05/2024", dsei: "DSEI Yanomami", lote: "LT-2024-005", qtd: 18, responsavel: "João da Silva", status: "Em Aprovação" },
  { data: "15/05/2024", dsei: "DSEI Alto Rio Negro", lote: "LT-2024-004", qtd: 22, responsavel: "Maria Oliveira", status: "Aprovado" },
  { data: "10/05/2024", dsei: "DSEI Leste de Roraima", lote: "LT-2024-003", qtd: 15, responsavel: "Carlos Mendes", status: "Aprovado" },
  { data: "05/05/2024", dsei: "DSEI Kayapó do Pará", lote: "LT-2024-002", qtd: 19, responsavel: "Ana Paula", status: "Rejeitado" },
  { data: "01/05/2024", dsei: "DSEI Maranhão", lote: "LT-2024-001", qtd: 12, responsavel: "Paulo Santos", status: "Aprovado" }
];

const DETALHE_LOTE = {
  "LT-2024-005": [
    { nome: "João da Silva", cargo: "Enfermeiro", periodo: "01/03 a 15/03", abono: "Sim (10 dias)", status: "Em análise" },
    { nome: "Maria Oliveira", cargo: "Médico Clínico Geral", periodo: "15/04 a 29/04", abono: "Não", status: "Em análise" },
    { nome: "Antônio Lima", cargo: "Téc. de Enfermagem", periodo: "01/06 a 30/06", abono: "Não", status: "Aprovado" },
    { nome: "Paula Santos", cargo: "Dentista", periodo: "01/08 a 15/08", abono: "Sim (10 dias)", status: "Em análise" },
    { nome: "Carlos Mendes", cargo: "Psicólogo", periodo: "10/09 a 24/09", abono: "Não", status: "Aprovado" }
  ],
  "LT-2024-004": [
    { nome: "Fernanda Dias", cargo: "Enfermeiro", periodo: "02/05 a 31/05", abono: "Não", status: "Aprovado" },
    { nome: "Marcelo Reis", cargo: "Médico Clínico Geral", periodo: "10/06 a 09/07", abono: "Sim (10 dias)", status: "Aprovado" }
  ],
  "LT-2024-003": [
    { nome: "Sandra Melo", cargo: "Téc. de Enfermagem", periodo: "01/07 a 30/07", abono: "Não", status: "Aprovado" },
    { nome: "Bruno Alves", cargo: "Dentista", periodo: "05/08 a 19/08", abono: "Não", status: "Aprovado" }
  ],
  "LT-2024-002": [
    { nome: "Ana Paula", cargo: "Dentista", periodo: "01/09 a 30/09", abono: "Sim (10 dias)", status: "Rejeitado" },
    { nome: "Diego Nunes", cargo: "Psicólogo", periodo: "12/09 a 26/09", abono: "Não", status: "Rejeitado" }
  ],
  "LT-2024-001": [
    { nome: "Paulo Santos", cargo: "Enfermeiro", periodo: "03/10 a 01/11", abono: "Não", status: "Aprovado" },
    { nome: "Larissa Gomes", cargo: "Médico Clínico Geral", periodo: "15/10 a 13/11", abono: "Sim (10 dias)", status: "Aprovado" }
  ]
};

// ---------- Mapas de classe das badges ----------
const BADGE_SITUACAO = {
  "Em elaboração": "is-elaboracao",
  "Em aprovação": "is-aprovacao",
  "Aprovada": "is-aprovado",
  "Rejeitada": "is-rejeitado",
  "Em Gozo": "is-gozo",
  "Programado": "is-programado",
  "Sem Programação": "is-elaboracao",
  "Aguard. Aprovação": "is-aprovacao",
  "Em análise": "is-aprovacao",
  "Aprovado": "is-aprovado",
  "Rejeitado": "is-rejeitado",
  "Em Aprovação": "is-aprovacao"
};
const BADGE_PAGAMENTO = { "Pago": "is-pago", "Não Pago": "is-naopago" };

function badge(texto, mapa) {
  if (!texto || texto === "—") return "—";
  const cls = mapa[texto] || "is-elaboracao";
  return `<span class="gfBadge ${cls}">${escapeHtml(texto)}</span>`;
}

const $ = id => document.getElementById(id);

// ---------- Toast simples ----------
let toastTimer = null;
function gfToast(mensagem, tipo) {
  let el = $("gfToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "gfToast";
    el.className = "gfToast";
    document.body.appendChild(el);
  }
  el.textContent = mensagem;
  el.classList.remove("is-erro", "is-ok");
  el.classList.add(tipo === "erro" ? "is-erro" : "is-ok", "show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

// ---------- Renderização: lote (prof. incluídos + detalhamento + resumo) ----------
function renderLote() {
  const profBody = $("gfProfBody");
  const detBody = $("gfDetBody");
  if (profBody) {
    profBody.innerHTML = loteProfissionais.map((p, i) => `
      <tr>
        <td>${escapeHtml(p.nome)}</td>
        <td>${escapeHtml(p.cargo)}</td>
        <td>${escapeHtml(p.matricula)}</td>
        <td>${escapeHtml(p.aquisitivo)}</td>
        <td>${escapeHtml(p.prazo)}</td>
        <td class="gfTd-center">
          <button class="gfIconBtn" data-gf-remover="${i}" title="Remover"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>`).join("") || `<tr><td colspan="6" class="gfTd-center">Nenhum colaborador incluído.</td></tr>`;
  }
  if (detBody) {
    detBody.innerHTML = loteProfissionais.map(p => `
      <tr>
        <td>${escapeHtml(p.nome)}</td>
        <td>${escapeHtml(p.cargo)}</td>
        <td>${escapeHtml(p.aquisitivo)}</td>
        <td>${escapeHtml(p.p1)}</td>
        <td>${escapeHtml(p.p2)}</td>
        <td>${escapeHtml(p.p3)}</td>
        <td class="gfTd-center">${p.abono ? "Sim" : "Não"}</td>
        <td class="gfTd-center">${p.diasAbono} dias</td>
        <td>${badge(p.situacao, BADGE_SITUACAO)}</td>
      </tr>`).join("") || `<tr><td colspan="9" class="gfTd-center">Sem solicitações.</td></tr>`;
  }
  renderResumo();
}

function renderResumo() {
  const total = loteProfissionais.length;
  const fracionadas = loteProfissionais.filter(p => p.p2 !== "—" || p.p3 !== "—").length;
  const integrais = total - fracionadas;
  const comAbono = loteProfissionais.filter(p => p.abono).length;
  const emAprovacao = loteProfissionais.filter(p => p.situacao === "Em aprovação").length;
  const aprovadas = loteProfissionais.filter(p => p.situacao === "Aprovada").length;
  const rejeitadas = loteProfissionais.filter(p => p.situacao === "Rejeitada").length;

  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set("gfResTotal", total);
  set("gfResIntegrais", integrais);
  set("gfResFracionadas", fracionadas);
  set("gfResAbono", comAbono);
  set("gfResAprovacao", emAprovacao);
  set("gfResAprovadas", aprovadas);
  set("gfResRejeitadas", rejeitadas);
}

// ---------- Renderização: histórico + detalhamento do lote ----------
function renderHistorico() {
  const body = $("gfHistBody");
  if (!body) return;
  body.innerHTML = HISTORICO.map(h => `
    <tr>
      <td>${escapeHtml(h.data)}</td>
      <td>${escapeHtml(h.dsei)}</td>
      <td>${escapeHtml(h.lote)}</td>
      <td class="gfTd-center">${h.qtd}</td>
      <td>${escapeHtml(h.responsavel)}</td>
      <td>${badge(h.status, BADGE_SITUACAO)}</td>
      <td class="gfTd-center">
        <button class="gfIconBtn gfView" data-gf-lote="${escapeHtml(h.lote)}" title="Ver detalhamento">
          <i class="fa-solid fa-eye"></i>
        </button>
      </td>
    </tr>`).join("");
}

function renderDetalheLote(lote) {
  const titulo = $("gfLoteTitulo");
  const body = $("gfLoteBody");
  if (titulo) titulo.textContent = `Detalhamento do lote ${lote}`;
  if (!body) return;
  const linhas = DETALHE_LOTE[lote] || [];
  body.innerHTML = linhas.map(l => `
    <tr>
      <td>${escapeHtml(l.nome)}</td>
      <td>${escapeHtml(l.cargo)}</td>
      <td>${escapeHtml(l.periodo)}</td>
      <td class="gfTd-center">${escapeHtml(l.abono)}</td>
      <td>${badge(l.status, BADGE_SITUACAO)}</td>
    </tr>`).join("") || `<tr><td colspan="5" class="gfTd-center">Sem detalhamento para este lote.</td></tr>`;
}

// ---------- Consulta geral (filtros) ----------
function preencherFiltrosConsulta() {
  const opcoes = (sel, valores, rotuloTodos) => {
    const el = $(sel);
    if (!el) return;
    el.innerHTML = `<option value="">${rotuloTodos}</option>` +
      valores.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
  };
  const unicos = chave => [...new Set(CONSULTA.map(r => r[chave]).filter(v => v && v !== "—"))];
  opcoes("gfConsDsei", unicos("dsei"), "Todos");
  opcoes("gfConsCargo", unicos("cargo"), "Todos");
  opcoes("gfConsStatus", unicos("situacao"), "Todos");
  opcoes("gfConsComp", unicos("comp"), "Todas");
}

function filtrosConsultaAtuais() {
  return {
    dsei: $("gfConsDsei")?.value || "",
    cargo: $("gfConsCargo")?.value || "",
    status: $("gfConsStatus")?.value || "",
    comp: $("gfConsComp")?.value || ""
  };
}

function consultaFiltrada() {
  const f = filtrosConsultaAtuais();
  return CONSULTA.filter(r =>
    (!f.dsei || r.dsei === f.dsei) &&
    (!f.cargo || r.cargo === f.cargo) &&
    (!f.status || r.situacao === f.status) &&
    (!f.comp || r.comp === f.comp));
}

function renderConsulta() {
  const body = $("gfConsBody");
  if (!body) return;
  const linhas = consultaFiltrada();
  body.innerHTML = linhas.map(r => `
    <tr>
      <td>${escapeHtml(r.prof)}</td>
      <td>${escapeHtml(r.cargo)}</td>
      <td>${escapeHtml(r.dsei)}</td>
      <td>${badge(r.situacao, BADGE_SITUACAO)}</td>
      <td>${escapeHtml(r.periodo)}</td>
      <td>${badge(r.pagamento, BADGE_PAGAMENTO)}</td>
    </tr>`).join("") ||
    `<tr><td colspan="6" class="gfTd-center">Nenhum resultado para os filtros selecionados.</td></tr>`;
}

// ---------- Ações dos botões ----------
function adicionarColaborador() {
  if (proximoDoPool >= POOL_COLABORADORES.length) {
    gfToast("Não há mais colaboradores de exemplo para adicionar.", "erro");
    return;
  }
  loteProfissionais.push({ ...POOL_COLABORADORES[proximoDoPool] });
  proximoDoPool += 1;
  renderLote();
  gfToast("Colaborador adicionado ao pedido.");
}

function removerColaborador(indice) {
  if (indice < 0 || indice >= loteProfissionais.length) return;
  const removido = loteProfissionais.splice(indice, 1)[0];
  // Devolve ao pool para poder readicionar.
  const ehDoPool = POOL_COLABORADORES.some(p => p.matricula === removido.matricula);
  if (ehDoPool && proximoDoPool > 0) proximoDoPool -= 1;
  renderLote();
  gfToast(`"${removido.nome}" removido do pedido.`);
}

function salvarLote() {
  if (!loteProfissionais.length) {
    gfToast("Inclua ao menos um colaborador antes de salvar.", "erro");
    return;
  }
  const dsei = $("gfRegDsei")?.value || "—";
  gfToast(`Lote salvo (${loteProfissionais.length} prof. · ${dsei}).`);
}

function encaminharAprovacao() {
  if (!loteProfissionais.length) {
    gfToast("Inclua ao menos um colaborador antes de encaminhar.", "erro");
    return;
  }
  loteProfissionais.forEach(p => {
    if (p.situacao === "Em elaboração") p.situacao = "Em aprovação";
  });
  renderLote();
  gfToast("Lote encaminhado para aprovação.");
}

function exportarRelatorio() {
  const linhas = consultaFiltrada();
  if (!linhas.length) {
    gfToast("Não há dados para exportar com os filtros atuais.", "erro");
    return;
  }
  const cab = ["Profissional", "Cargo", "DSEI/CASAI", "Situação", "Período de Férias", "Pagamento"];
  const csv = [cab.join(";")]
    .concat(linhas.map(r => [r.prof, r.cargo, r.dsei, r.situacao, r.periodo, r.pagamento]
      .map(c => `"${String(c).replace(/"/g, '""')}"`).join(";")))
    .join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "consulta_ferias.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  gfToast(`Relatório exportado (${linhas.length} registro(s)).`);
}

// ---------- Inicialização ----------
let gestaoFeriasConfigurada = false;

export function configurarGestaoFerias() {
  if (gestaoFeriasConfigurada) return;
  const raiz = $("view-gestaoFerias");
  if (!raiz) return;
  gestaoFeriasConfigurada = true;

  // Render inicial.
  renderLote();
  renderHistorico();
  renderDetalheLote("LT-2024-005");
  preencherFiltrosConsulta();
  renderConsulta();

  // Botões principais.
  $("gfBtnAddColab")?.addEventListener("click", adicionarColaborador);
  $("gfBtnSalvar")?.addEventListener("click", salvarLote);
  $("gfBtnEncaminhar")?.addEventListener("click", encaminharAprovacao);
  $("gfBtnExportar")?.addEventListener("click", exportarRelatorio);
  $("gfBtnBuscar")?.addEventListener("click", renderConsulta);

  // Filtros da consulta reagem na hora.
  ["gfConsDsei", "gfConsCargo", "gfConsStatus", "gfConsComp"].forEach(id => {
    $(id)?.addEventListener("change", renderConsulta);
  });

  // Delegação para botões gerados dinamicamente (remover / ver lote).
  raiz.addEventListener("click", event => {
    const remover = event.target.closest("[data-gf-remover]");
    if (remover) {
      removerColaborador(Number(remover.dataset.gfRemover));
      return;
    }
    const verLote = event.target.closest("[data-gf-lote]");
    if (verLote) {
      renderDetalheLote(verLote.dataset.gfLote);
    }
  });
}
