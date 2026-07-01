// =========================================================
// Escala de Trabalho (maquete com dados de exemplo)
// Aba autocontida, no mesmo padrão de Gestão de Férias /
// Processos Seletivos: sem backend, estado em memória.
//   - Filtros (DSEI/polo/UBSI/cargo/escala/situação + busca)
//     filtram a tabela "Profissionais e Escalas".
//   - Alerta de profissionais sem escala (chips).
//   - Detalhamento de plantonistas (grade dia/noite/folga) e
//     de escalas de território (ida/retorno/dias).
//   - Resumo (KPIs) e legenda das escalas.
// Escrita (Nova Escala / editar / excluir) é só demonstração
// e exige Editor (nível >= 2) no módulo. Registrada em
// configurarEscalaTrabalho(), chamado no init do app.
// =========================================================
import { escapeHtml, escapeAttr, debounce } from "./utils.js";
import { preencherSelect, criarToast } from "./ui-utils.js";
import { nivelModulo } from "./permissoes.js";
import { criarTabelaArrastavel } from "./tabela-arrastavel.js";

const COMPETENCIA = "Mai/2024";
const NIVEL_EDITOR = 2;
function podeEditarEscala() { return nivelModulo("escalaTrabalho") >= NIVEL_EDITOR; }

const $ = id => document.getElementById(id);
const etToast = criarToast("etToast", { className: "etToast" });

// ---------- Metadados das escalas ----------
const ESCALAS = {
  diarista:   { rotulo: "Diarista",           classe: "is-diarista" },
  diurno:     { rotulo: "Plantonista Diurno", classe: "is-diurno" },
  noturno:    { rotulo: "Plantonista Noturno", classe: "is-noturno" },
  territorio: { rotulo: "Território",         classe: "is-territorio" }
};

const SITUACOES = {
  ativo:   { rotulo: "Ativo",         classe: "is-ativo" },
  terr:    { rotulo: "Em território", classe: "is-terr" },
  retorno: { rotulo: "Retorno hoje",  classe: "is-retorno" },
  inativo: { rotulo: "Inativo",       classe: "is-inativo" }
};

const DIAS_SEMANA = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

// ---------- Dados de exemplo (em memória) ----------
// Profissionais COM escala registrada (tabela principal).
const ESCALAS_DADOS = [
  {
    id: "e1", nome: "João da Silva", cargo: "Enfermeiro", dsei: "Yanomami",
    polo: "CASAI Boa Vista", ubsi: "UBSI Sucurucu", escala: "diarista", situacao: "ativo"
  },
  {
    id: "e2", nome: "Maria Oliveira", cargo: "Médica", dsei: "Médio Xingu",
    polo: "Polo Base Alta Floresta", ubsi: "UBSI Kayapó", escala: "diurno",
    dias: [1, 1, 1, 1, 1, 0, 0], situacao: "ativo"
  },
  {
    id: "e3", nome: "Carlos Mendes", cargo: "Téc. de Enfermagem", dsei: "Vale do Javari",
    polo: "CASAI Atalaia do Norte", ubsi: "", escala: "noturno",
    dias: [0, 0, 0, 0, 1, 1, 0], situacao: "ativo"
  },
  {
    id: "e4", nome: "Ana Paula", cargo: "Dentista", dsei: "Kayapó do Pará",
    polo: "Polo Base Redenção", ubsi: "UBSI Kokraimoro", escala: "territorio",
    tipoTerritorio: "1x1", ida: "20/05/2024", retorno: "21/05/2024", situacao: "terr"
  },
  {
    id: "e5", nome: "Lucas Pereira", cargo: "Psicólogo", dsei: "Alto Rio Negro",
    polo: "Polo Base São Gabriel", ubsi: "", escala: "territorio",
    tipoTerritorio: "2x1", ida: "19/05/2024", retorno: "21/05/2024", situacao: "terr"
  },
  {
    id: "e6", nome: "Beatriz Souza", cargo: "Assistente Social", dsei: "Potiguar",
    polo: "CASAI Mossoró", ubsi: "UBSI Apodi", escala: "territorio",
    tipoTerritorio: "30x20x10", ida: "01/05/2024", retorno: "20/05/2024", situacao: "retorno"
  },
  {
    id: "e7", nome: "Rafael Antunes", cargo: "Enfermeiro", dsei: "Yanomami",
    polo: "Polo Base Surucucu", ubsi: "UBSI Surucucu", escala: "diurno",
    dias: [0, 0, 1, 1, 1, 1, 1], situacao: "ativo"
  },
  {
    id: "e8", nome: "Fernanda Rocha", cargo: "Téc. de Enfermagem", dsei: "Médio Xingu",
    polo: "CASAI São Félix", ubsi: "", escala: "noturno",
    dias: [1, 1, 0, 0, 0, 1, 1], situacao: "ativo"
  }
];

// Profissionais SEM escala registrada (alerta / chips).
const SEM_ESCALA = [
  { nome: "Carlos Mendes", cargo: "Técnico de Enfermagem" },
  { nome: "Ana Paula", cargo: "Dentista" },
  { nome: "João Batista", cargo: "Enfermeiro" },
  { nome: "Maria Lima", cargo: "Médica" },
  { nome: "Lucas Pereira", cargo: "Psicólogo" },
  { nome: "Beatriz Souza", cargo: "Assistente Social" },
  { nome: "Paula Santos", cargo: "Nutricionista" }
];

// Detalhamento dos plantonistas: 7 dias (01..07) com período por dia.
// 'dia' = plantão diurno · 'noite' = plantão noturno · 'folga'.
const PLANTONISTAS_DET = [
  {
    id: "p1", nome: "Maria Oliveira", escala: "Plantonista Diurno",
    dias: [
      { data: "01", dow: "Qua" }, { data: "02", dow: "Qui" }, { data: "03", dow: "Sex" },
      { data: "04", dow: "Sáb" }, { data: "05", dow: "Dom" }, { data: "06", dow: "Seg" }, { data: "07", dow: "Ter" }
    ],
    periodos: ["dia", "dia", "dia", "dia", "dia", "dia", "dia"]
  },
  {
    id: "p2", nome: "Carlos Mendes", escala: "Plantonista Noturno",
    dias: [
      { data: "01", dow: "Qua" }, { data: "02", dow: "Qui" }, { data: "03", dow: "Sex" },
      { data: "04", dow: "Sáb" }, { data: "05", dow: "Dom" }, { data: "06", dow: "Seg" }, { data: "07", dow: "Ter" }
    ],
    periodos: ["noite", "noite", "noite", "noite", "folga", "folga", "folga"]
  }
];

// ---------- Estado da aba ----------
const filtros = { dsei: "", polo: "", ubsi: "", cargo: "", escala: "", situacao: "", busca: "" };
let filtrosPopulados = false;
// Grades Tabulator (colunas/linhas arrastáveis) — criadas sob demanda ao mostrar.
let gradeMain = null;
let gradeTerritorio = null;
let gradePlantonistas = null;

// ---------- Helpers de opções dos filtros ----------
function unicos(chave) {
  return [...new Set(ESCALAS_DADOS.map(r => r[chave]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function popularFiltros() {
  if (filtrosPopulados) return;
  preencherSelect("etFDsei", unicos("dsei"), "Todos");
  preencherSelect("etFPolo", unicos("polo"), "Todos");
  preencherSelect("etFUbsi", unicos("ubsi"), "Todos");
  preencherSelect("etFCargo", unicos("cargo"), "Todos");
  preencherSelect("etFEscala", Object.keys(ESCALAS).map(k => ESCALAS[k].rotulo), "Todas as escalas");
  preencherSelect("etFSituacao", Object.keys(SITUACOES).map(k => SITUACOES[k].rotulo), "Todos");
  filtrosPopulados = true;
}

// ---------- Filtragem da tabela principal ----------
function aplicaFiltros(rows) {
  const termo = filtros.busca.trim().toLowerCase();
  return rows.filter(r => {
    if (filtros.dsei && r.dsei !== filtros.dsei) return false;
    if (filtros.polo && r.polo !== filtros.polo) return false;
    if (filtros.ubsi && r.ubsi !== filtros.ubsi) return false;
    if (filtros.cargo && r.cargo !== filtros.cargo) return false;
    if (filtros.escala && ESCALAS[r.escala].rotulo !== filtros.escala) return false;
    if (filtros.situacao && SITUACOES[r.situacao].rotulo !== filtros.situacao) return false;
    if (termo && !r.nome.toLowerCase().includes(termo) && !r.cargo.toLowerCase().includes(termo)) return false;
    return true;
  });
}

// ---------- Renderização: célula de período/dias ----------
function periodoCelula(r) {
  if (r.escala === "territorio") {
    return `<span class="etPeriodoTerr">Ida: <b>${escapeHtml(r.ida || "—")}</b> · Retorno: <b>${escapeHtml(r.retorno || "—")}</b></span>`;
  }
  if (r.escala === "diarista" || !Array.isArray(r.dias)) {
    return `<span class="etPeriodoVazio">—</span>`;
  }
  const celulas = r.dias.map((on, i) =>
    `<span class="etDia"><span class="etDiaLabel">${DIAS_SEMANA[i]}</span>` +
    `<span class="etDiaBox${on ? " is-on" : ""}">${on ? '<i class="fa-solid fa-check"></i>' : ""}</span></span>`
  ).join("");
  return `<span class="etDias">${celulas}</span>`;
}

function badgeEscala(chave, tipoTerritorio) {
  const e = ESCALAS[chave] || { rotulo: chave, classe: "" };
  const rotulo = chave === "territorio" ? `Território ${tipoTerritorio || ""}`.trim() : e.rotulo;
  return `<span class="etEscala ${e.classe}">${escapeHtml(rotulo)}</span>`;
}

function badgeSituacao(chave) {
  const s = SITUACOES[chave] || { rotulo: chave, classe: "" };
  return `<span class="etSituacao ${s.classe}">${escapeHtml(s.rotulo)}</span>`;
}

function acoesCelula(r) {
  if (!podeEditarEscala()) return "—";
  return `<button type="button" class="etAcao" data-et-editar="${escapeAttr(r.id)}" title="Editar escala" aria-label="Editar escala"><i class="fa-solid fa-pen"></i></button>` +
    `<button type="button" class="etAcao is-del" data-et-excluir="${escapeAttr(r.id)}" title="Excluir escala" aria-label="Excluir escala"><i class="fa-solid fa-trash-can"></i></button>`;
}

// ---------- Renderização: tabela principal (Tabulator arrastável) ----------
function colunasMain() {
  return [
    { title: "Nome do Profissional", field: "nome", widthGrow: 2, minWidth: 160,
      formatter: c => `<span class="etNomeProf">${escapeHtml(c.getData().nome)}</span>` },
    { title: "Cargo", field: "cargo", minWidth: 120 },
    { title: "DSEI", field: "dsei", minWidth: 120 },
    { title: "Polo base / CASAI", field: "polo", minWidth: 150 },
    { title: "UBSI (se houver)", field: "ubsi", minWidth: 130,
      formatter: c => escapeHtml(c.getData().ubsi || "—") },
    { title: "Escala", field: "escala", hozAlign: "center", headerHozAlign: "center", minWidth: 140,
      formatter: c => badgeEscala(c.getData().escala, c.getData().tipoTerritorio) },
    { title: "Período / Dias", field: "_periodo", minWidth: 210, headerSort: false,
      formatter: c => periodoCelula(c.getData()) },
    { title: "Situação", field: "situacao", hozAlign: "center", headerHozAlign: "center", minWidth: 110,
      formatter: c => badgeSituacao(c.getData().situacao) },
    { title: "Ações", field: "_acoes", hozAlign: "center", headerHozAlign: "center", width: 90, headerSort: false,
      formatter: c => acoesCelula(c.getData()) },
  ];
}

function renderTabela() {
  if (!$("etTabelaBody")) return;
  const rows = aplicaFiltros(ESCALAS_DADOS);
  const count = $("etTabelaCount");
  if (count) count.textContent = `${rows.length} de ${ESCALAS_DADOS.length} profissionais`;

  if (!gradeMain) {
    gradeMain = criarTabelaArrastavel({
      elemento: "etTabelaBody", colunas: colunasMain(),
      persistID: "escalaProfissionais", ordemKey: "escalaProfissionais:ordem",
      indexField: "id", altura: "440px",
      vazio: "Nenhum profissional encontrado com os filtros atuais.",
    });
  }
  gradeMain?.render(rows);
}

// ---------- Renderização: alerta sem escala ----------
function renderAlerta() {
  const wrap = $("etAlerta");
  if (!wrap) return;
  if (!SEM_ESCALA.length) { wrap.hidden = true; return; }
  wrap.hidden = false;
  const total = $("etAlertaTotal");
  if (total) total.textContent = String(SEM_ESCALA.length);
  const chips = $("etAlertaChips");
  if (chips) {
    chips.innerHTML = SEM_ESCALA.map(p => `
      <span class="etChip">
        <span class="etChipNome">${escapeHtml(p.nome)}</span>
        <span class="etChipCargo">${escapeHtml(p.cargo)}</span>
      </span>
    `).join("");
  }
}

// ---------- Renderização: detalhamento plantonistas (Tabulator arrastável) ----------
function iconePlantao(p) {
  if (p === "dia") return '<i class="fa-solid fa-sun etIconDia" title="Diurno"></i>';
  if (p === "noite") return '<i class="fa-solid fa-moon etIconNoite" title="Noturno"></i>';
  return '<span class="etFolga" title="Folga">—</span>';
}

function colunasPlantonistas() {
  const modelo = PLANTONISTAS_DET[0];
  const cols = [
    { title: "Profissional", field: "nome", frozen: true, widthGrow: 2, minWidth: 160,
      formatter: c => {
        const p = c.getData();
        return `<span class="etPlantProfNome">${escapeHtml(p.nome)}</span>` +
               `<span class="etPlantProfEscala">${escapeHtml(p.escala)}</span>`;
      } },
  ];
  modelo.dias.forEach((d, i) => cols.push({
    title: d.data, field: `d${i}`, width: 62, hozAlign: "center", headerHozAlign: "center", headerSort: false,
    titleFormatter: () => `${escapeHtml(d.data)}<br><span class="etPlantDow">${escapeHtml(d.dow)}</span>`,
    formatter: c => iconePlantao((c.getData().periodos || [])[i]),
  }));
  cols.push({ title: "…", field: "_more", width: 50, hozAlign: "center", headerSort: false, formatter: () => "—" });
  return cols;
}

function renderPlantonistas() {
  if (!$("etPlantBody")) return;
  const comp = $("etCompPlant");
  if (comp) comp.textContent = `(${COMPETENCIA})`;

  // Dias reordenáveis não fazem sentido num calendário: só as LINHAS arrastam.
  if (!gradePlantonistas) {
    gradePlantonistas = criarTabelaArrastavel({
      elemento: "etPlantBody", colunas: colunasPlantonistas(), movableColumns: false,
      persistID: "escalaPlantonistas", ordemKey: "escalaPlantonistas:ordem",
      indexField: "id", altura: "260px", vazio: "Nenhum plantonista no período.",
    });
  }
  gradePlantonistas?.render(PLANTONISTAS_DET);
}

// ---------- Renderização: detalhamento território ----------
function diasEntre(ida, retorno) {
  const parse = s => {
    const [d, m, a] = String(s || "").split("/").map(Number);
    return (d && m && a) ? new Date(a, m - 1, d) : null;
  };
  const di = parse(ida);
  const dr = parse(retorno);
  if (!di || !dr) return "—";
  const n = Math.max(0, Math.round((dr - di) / 86400000));
  return `${n} ${n === 1 ? "dia" : "dias"}`;
}

function colunasTerritorio() {
  return [
    { title: "Profissional", field: "nome", widthGrow: 2, minWidth: 150,
      formatter: c => {
        const r = c.getData();
        return `<span class="etNomeProf">${escapeHtml(r.nome)}</span>` +
               `<br><span class="etChipCargo">${escapeHtml(r.cargo)}</span>`;
      } },
    { title: "Escala", field: "tipoTerritorio", hozAlign: "center", headerHozAlign: "center", minWidth: 120,
      formatter: c => badgeEscala("territorio", c.getData().tipoTerritorio) },
    { title: "Data de Ida", field: "ida", hozAlign: "center", headerHozAlign: "center", minWidth: 110 },
    { title: "Data de Retorno", field: "retorno", hozAlign: "center", headerHozAlign: "center", minWidth: 120 },
    { title: "Dias em Território", field: "_dias", hozAlign: "center", headerHozAlign: "center", minWidth: 120,
      formatter: c => escapeHtml(diasEntre(c.getData().ida, c.getData().retorno)) },
    { title: "Situação", field: "situacao", hozAlign: "center", headerHozAlign: "center", minWidth: 110,
      formatter: c => badgeSituacao(c.getData().situacao) },
  ];
}

function renderTerritorio() {
  if (!$("etTerritorioBody")) return;
  const rows = ESCALAS_DADOS.filter(r => r.escala === "territorio");
  if (!gradeTerritorio) {
    gradeTerritorio = criarTabelaArrastavel({
      elemento: "etTerritorioBody", colunas: colunasTerritorio(),
      persistID: "escalaTerritorio", ordemKey: "escalaTerritorio:ordem",
      indexField: "id", altura: "300px", vazio: "Nenhuma escala de território no período.",
    });
  }
  gradeTerritorio?.render(rows);
}

// ---------- Renderização: resumo (KPIs) ----------
function renderResumo() {
  const comp = $("etCompResumo");
  if (comp) comp.textContent = `(${COMPETENCIA})`;
  const com = ESCALAS_DADOS.length;
  const sem = SEM_ESCALA.length;
  const terr = ESCALAS_DADOS.filter(r => r.escala === "territorio" && (r.situacao === "terr" || r.situacao === "retorno")).length;
  const set = (id, v) => { const el = $(id); if (el) el.textContent = String(v); };
  set("etResTotal", com + sem);
  set("etResCom", com);
  set("etResSem", sem);
  set("etResTerr", terr);
}

// ---------- Render completo ----------
export function renderEscalaTrabalhoAoMostrar() {
  popularFiltros();
  // Modo somente-leitura (Leitor): o CSS (.et-readonly [data-et-*]) esconde os
  // botões de escrita em qualquer profundidade, mesmo que vazem no render.
  const view = $("view-escalaTrabalho");
  if (view) view.classList.toggle("et-readonly", !podeEditarEscala());
  const btnNova = document.querySelector("[data-et-nova]");
  if (btnNova) btnNova.hidden = !podeEditarEscala();
  renderAlerta();
  renderTabela();
  renderPlantonistas();
  renderTerritorio();
  renderResumo();
  // Recalcula larguras caso alguma grade tenha sido montada com a aba oculta.
  [gradeMain, gradeTerritorio, gradePlantonistas].forEach(g => g?.redraw());
}

// ---------- Eventos ----------
export function configurarEscalaTrabalho() {
  const view = $("view-escalaTrabalho");
  if (!view || view.dataset.bound) return;
  view.dataset.bound = "1";

  const bindSelect = (id, chave) => {
    const el = $(id);
    if (el) el.addEventListener("change", () => { filtros[chave] = el.value || ""; renderTabela(); });
  };
  bindSelect("etFDsei", "dsei");
  bindSelect("etFPolo", "polo");
  bindSelect("etFUbsi", "ubsi");
  bindSelect("etFCargo", "cargo");
  bindSelect("etFEscala", "escala");
  bindSelect("etFSituacao", "situacao");

  const busca = $("etBusca");
  if (busca) {
    busca.addEventListener("input", debounce(() => { filtros.busca = busca.value || ""; renderTabela(); }, 200));
  }

  // Ações (maquete): apenas feedback via toast, sem persistência.
  view.addEventListener("click", ev => {
    if (ev.target.closest("[data-et-nova]")) {
      if (!podeEditarEscala()) return; // defesa em profundidade: leitor não escreve
      etToast("Cadastro de nova escala — demonstração (sem gravação no banco).");
      return;
    }
    if (ev.target.closest("[data-et-ver-sem-escala]")) {
      etToast(`${SEM_ESCALA.length} profissionais sem escala registrada.`);
      return;
    }
    const editar = ev.target.closest("[data-et-editar]");
    if (editar) {
      if (!podeEditarEscala()) return; // defesa em profundidade: leitor não escreve
      const r = ESCALAS_DADOS.find(x => x.id === editar.dataset.etEditar);
      etToast(`Editar escala de ${r ? r.nome : "profissional"} — demonstração.`);
      return;
    }
    const excluir = ev.target.closest("[data-et-excluir]");
    if (excluir) {
      if (!podeEditarEscala()) return; // defesa em profundidade: leitor não escreve
      const r = ESCALAS_DADOS.find(x => x.id === excluir.dataset.etExcluir);
      etToast(`Excluir escala de ${r ? r.nome : "profissional"} — demonstração.`, "erro");
    }
  });
}
