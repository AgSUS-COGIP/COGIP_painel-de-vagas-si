// =========================================================
// Escala de Trabalho — camada de APRESENTAÇÃO.
// Toda a informação vem do servidor (GET /api/escala; MySQL ->
// servidor -> aqui). Este módulo só renderiza o que o payload
// traz: profissionais (nome/cargo/DSEI/polo + escala/situação/
// dias/etc.) e as opções de filtro (filtros + polosPorDsei).
// As colunas de escala ainda são placeholder GERADO NO SERVIDOR
// (lib/escala.js) até existir a fonte real — o front não muda
// quando ela chegar.
//   - Filtros (DSEI/polo em cascata/UBSI/cargo/escala/situação
//     + busca), tabela paginada (modelo da aba de Crachás),
//     alerta de sem escala, detalhamentos e resumo (KPIs).
// Escrita (Nova Escala/editar/excluir) é só demonstração e
// exige Editor (nível >= 2). Registrada em
// configurarEscalaTrabalho(); busca sob demanda ao abrir a aba.
// =========================================================
import { escapeHtml, escapeAttr, debounce } from "./utils.js";
import { criarToast } from "./ui-utils.js";
import { nivelModulo } from "./permissoes.js";
import { criarTabelaArrastavel } from "./tabela-arrastavel.js";
import { criarMultiCombo } from "./multi-combo.js";
import { apiGet } from "./api.js";

const COMPETENCIA = "Mai/2024";
const NIVEL_EDITOR = 2;
function podeEditarEscala() { return nivelModulo("escalaTrabalho") >= NIVEL_EDITOR; }

// Máximo de linhas exibidas nos detalhamentos (amostra) — os dados de escala são
// mock; mostrar milhares não agrega. O total real vai no contador do cartão.
const DETALHE_MAX = 40;

// Paginação da tabela principal (mesmo modelo da aba Entrega de Crachá).
const PAGE_SIZE_OPCOES = [10, 25, 50, 100];

const $ = id => document.getElementById(id);
const etToast = criarToast("etToast", { className: "etToast" });

// ---------- Metadados das escalas ----------
const ESCALAS = {
  diarista:   { rotulo: "Diarista",            classe: "is-diarista" },
  diurno:     { rotulo: "Plantonista Diurno",  classe: "is-diurno" },
  noturno:    { rotulo: "Plantonista Noturno", classe: "is-noturno" },
  territorio: { rotulo: "Território",          classe: "is-territorio" }
};

const SITUACOES = {
  ativo:   { rotulo: "Ativo",         classe: "is-ativo" },
  terr:    { rotulo: "Em território", classe: "is-terr" },
  retorno: { rotulo: "Retorno hoje",  classe: "is-retorno" },
  inativo: { rotulo: "Inativo",       classe: "is-inativo" }
};

const DIAS_SEMANA = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
// Janela fixa de 7 dias do detalhamento de plantonistas (competência de exemplo).
// Semana em ordem Seg→Dom (06–12/mai/2024, cujo dia 06 caiu numa segunda), para
// os dias saírem na ordem natural e alinhados ao padrão semanal (índice 0 = Seg).
const DIAS_JANELA = [
  { data: "06", dow: "Seg" }, { data: "07", dow: "Ter" }, { data: "08", dow: "Qua" },
  { data: "09", dow: "Qui" }, { data: "10", dow: "Sex" }, { data: "11", dow: "Sáb" }, { data: "12", dow: "Dom" }
];

// ---------- Estado da aba ----------
// Cada filtro é um ARRAY de valores selecionados (multi-seleção). Vazio = todos.
const filtros = { dsei: [], polo: [], ubsi: [], cargo: [], escala: [], situacao: [], busca: "" };
let escalas = [];            // profissionais (payload do servidor, já prontos)
let estado = "idle";         // idle | carregando | ok | erro
let erroMsg = "";
let pageSize = 10;           // registros por página (ajustável pelo usuário)
let paginaAtual = 1;
// Opções de filtro vindas do servidor.
let opcoesFiltro = { dseis: [], cargos: [], polos: [] };
let polosPorDsei = {};       // { dsei: [polos] } — para a cascata
// Combos de multi-seleção (criados uma vez em configurarEscalaTrabalho).
const combos = {};
// Grades Tabulator (colunas/linhas arrastáveis) — criadas sob demanda ao mostrar.
let gradeMain = null;
let gradeTerritorio = null;
let gradePlantonistas = null;

// Lotações (Polo base / CASAI) dos DSEIs selecionados — em cascata (união). Sem
// DSEI selecionado => todas. Após repopular, sincroniza a seleção de polo (o combo
// descarta polos que saíram das opções).
function atualizarOpcoesPolo() {
  const dseis = filtros.dsei;
  let lista;
  if (dseis.length) {
    const set = new Set();
    dseis.forEach(d => (polosPorDsei[d] || []).forEach(p => set.add(p)));
    lista = [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
  } else {
    lista = opcoesFiltro.polos || [];
  }
  if (combos.polo) {
    combos.polo.setOptions(lista, "Todos");
    filtros.polo = combos.polo.getValues();
  }
}

function popularFiltros() {
  combos.dsei?.setOptions(opcoesFiltro.dseis || [], "Todos");
  combos.cargo?.setOptions(opcoesFiltro.cargos || [], "Todos");
  combos.escala?.setOptions(Object.keys(ESCALAS).map(k => ({ value: k, label: ESCALAS[k].rotulo })), "Todas as escalas");
  combos.situacao?.setOptions(Object.keys(SITUACOES).map(k => ({ value: k, label: SITUACOES[k].rotulo })), "Todos");
  combos.ubsi?.setOptions([], "Todos"); // UBSI ainda não tem fonte no banco
  // Sincroniza o estado dos filtros com o que sobrou selecionado após repopular.
  ["dsei", "cargo", "escala", "situacao", "ubsi"].forEach(k => { if (combos[k]) filtros[k] = combos[k].getValues(); });
  // Cascata de polo depende de filtros.dsei já sincronizado.
  atualizarOpcoesPolo();
}

// ---------- Filtragem da tabela principal ----------
// Filtro vazio (array []) = aceita tudo; senão exige pertencer à seleção.
function aplicaFiltros(rows) {
  const termo = filtros.busca.trim().toLowerCase();
  const casa = (sel, val) => !sel.length || sel.includes(val);
  return rows.filter(r => {
    if (!casa(filtros.dsei, r.dsei)) return false;
    if (!casa(filtros.polo, r.polo)) return false;
    if (!casa(filtros.ubsi, r.ubsi)) return false;
    if (!casa(filtros.cargo, r.cargo)) return false;
    if (!casa(filtros.escala, r.escala)) return false;
    if (!casa(filtros.situacao, r.situacao)) return false;
    if (termo && !r.nome.toLowerCase().includes(termo)
      && !String(r.cargo || "").toLowerCase().includes(termo)
      && !String(r.matricula || "").toLowerCase().includes(termo)) return false;
    return true;
  });
}

function rotuloEscala(r) { return r.escala && ESCALAS[r.escala] ? ESCALAS[r.escala].rotulo : ""; }

// ---------- Conteúdo das células ----------
function periodoCelula(r) {
  if (r.escala === "territorio") {
    return `<span class="etPeriodoTerr">Ida: <b>${escapeHtml(r.ida || "—")}</b> · Retorno: <b>${escapeHtml(r.retorno || "—")}</b></span>`;
  }
  if (!Array.isArray(r.dias)) return `<span class="etPeriodoVazio">—</span>`;
  const celulas = r.dias.map((on, i) =>
    `<span class="etDia"><span class="etDiaLabel">${DIAS_SEMANA[i]}</span>` +
    `<span class="etDiaBox${on ? " is-on" : ""}">${on ? '<i class="fa-solid fa-check"></i>' : ""}</span></span>`
  ).join("");
  return `<span class="etDias">${celulas}</span>`;
}

function badgeEscala(chave, tipoTerritorio) {
  if (!chave) return `<span class="etEscala is-pendente">A definir</span>`;
  const e = ESCALAS[chave] || { rotulo: chave, classe: "" };
  const rotulo = chave === "territorio" ? `Território ${tipoTerritorio || ""}`.trim() : e.rotulo;
  return `<span class="etEscala ${e.classe}">${escapeHtml(rotulo)}</span>`;
}

function badgeSituacao(chave) {
  if (!chave) return `<span class="etSituacao is-pendente">A definir</span>`;
  const s = SITUACOES[chave] || { rotulo: chave, classe: "" };
  return `<span class="etSituacao ${s.classe}">${escapeHtml(s.rotulo)}</span>`;
}

function acoesCelula(r) {
  if (!podeEditarEscala()) return "—";
  return `<button type="button" class="etAcao" data-et-editar="${escapeAttr(r.id)}" title="Editar escala" aria-label="Editar escala"><i class="fa-solid fa-pen"></i></button>` +
    `<button type="button" class="etAcao is-del" data-et-excluir="${escapeAttr(r.id)}" title="Excluir escala" aria-label="Excluir escala"><i class="fa-solid fa-trash-can"></i></button>`;
}

// ---------- Tabela principal (Tabulator arrastável) ----------
function colunasMain() {
  return [
    { title: "Nome do Profissional", field: "nome", widthGrow: 2, minWidth: 170,
      formatter: c => `<span class="etNomeProf">${escapeHtml(c.getData().nome)}</span>` },
    { title: "Cargo", field: "cargo", minWidth: 140 },
    { title: "DSEI", field: "dsei", minWidth: 150 },
    { title: "Polo base / CASAI", field: "polo", minWidth: 150 },
    { title: "UBSI (se houver)", field: "ubsi", minWidth: 120,
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

function garantirGradeMain() {
  if (gradeMain || !$("etTabelaBody")) return;
  gradeMain = criarTabelaArrastavel({
    elemento: "etTabelaBody", colunas: colunasMain(),
    persistID: "escalaProfissionais",
    // Paginação própria (rodapé), como na aba de Crachás: renderizamos só a página
    // atual na grade. Colunas continuam arrastáveis; linhas não.
    indexField: "id", movableRows: false,
    vazio: "Nenhum profissional encontrado com os filtros atuais.",
  });
}

function renderTabela() {
  garantirGradeMain();
  if (!gradeMain) return;
  const count = $("etTabelaCount");
  const registros = $("etRegistros");

  if ((estado === "carregando" && !escalas.length) || estado === "erro") {
    if (count) count.textContent = estado === "erro" ? "—" : "carregando…";
    if (registros) registros.textContent = "";
    gradeMain.render([], estado === "erro"
      ? escapeHtml(erroMsg || "Não foi possível carregar os profissionais.")
      : "Carregando profissionais…");
    renderPaginacao(1);
    return;
  }

  const lista = aplicaFiltros(escalas);
  const totalPaginas = Math.max(1, Math.ceil(lista.length / pageSize));
  if (paginaAtual > totalPaginas) paginaAtual = totalPaginas;
  const inicio = (paginaAtual - 1) * pageSize;
  const pagina = lista.slice(inicio, inicio + pageSize);

  if (count) count.textContent = `${lista.length} de ${escalas.length} profissionais`;
  if (registros) {
    registros.textContent = lista.length
      ? `Mostrando ${inicio + 1} a ${Math.min(inicio + pageSize, lista.length)} de ${lista.length} profissionais`
      : "Mostrando 0 profissionais";
  }

  gradeMain.render(pagina);
  renderPaginacao(totalPaginas);
}

// Controles de página (mesmo layout/lógica da aba Entrega de Crachá).
function renderPaginacao(totalPaginas) {
  const wrap = $("etPagination");
  if (!wrap) return;
  if (totalPaginas <= 1) { wrap.innerHTML = ""; return; }

  const janela = 2;
  let ini = Math.max(1, paginaAtual - janela);
  let fim = Math.min(totalPaginas, paginaAtual + janela);
  if (paginaAtual <= janela) fim = Math.min(totalPaginas, 1 + janela * 2);
  if (paginaAtual > totalPaginas - janela) ini = Math.max(1, totalPaginas - janela * 2);

  let html = `<button class="etPageBtn etPageNav" data-et-pagina="prev" ${paginaAtual === 1 ? "disabled" : ""} title="Anterior"><i class="fa-solid fa-angle-left"></i></button>`;
  if (ini > 1) {
    html += `<button class="etPageBtn" data-et-pagina="1">1</button>`;
    if (ini > 2) html += `<span class="etPageEllipsis">…</span>`;
  }
  for (let p = ini; p <= fim; p++) {
    html += `<button class="etPageBtn${p === paginaAtual ? " is-ativo" : ""}" data-et-pagina="${p}">${p}</button>`;
  }
  if (fim < totalPaginas) {
    if (fim < totalPaginas - 1) html += `<span class="etPageEllipsis">…</span>`;
    html += `<button class="etPageBtn" data-et-pagina="${totalPaginas}">${totalPaginas}</button>`;
  }
  html += `<button class="etPageBtn etPageNav" data-et-pagina="next" ${paginaAtual === totalPaginas ? "disabled" : ""} title="Próxima"><i class="fa-solid fa-angle-right"></i></button>`;
  wrap.innerHTML = html;
}

function irParaPagina(valor) {
  const totalPaginas = Math.max(1, Math.ceil(aplicaFiltros(escalas).length / pageSize));
  if (valor === "prev") paginaAtual = Math.max(1, paginaAtual - 1);
  else if (valor === "next") paginaAtual = Math.min(totalPaginas, paginaAtual + 1);
  else paginaAtual = Math.min(totalPaginas, Math.max(1, Number(valor) || 1));
  renderTabela();
}

// ---------- Alerta sem escala (mock) ----------
function renderAlerta() {
  const wrap = $("etAlerta");
  if (!wrap) return;
  const sem = escalas.filter(p => p.semEscala);
  if (!sem.length) { wrap.hidden = true; return; }
  wrap.hidden = false;
  const total = $("etAlertaTotal");
  if (total) total.textContent = String(sem.length);
  const chips = $("etAlertaChips");
  if (chips) {
    chips.innerHTML = sem.slice(0, 8).map(p => `
      <span class="etChip">
        <span class="etChipNome">${escapeHtml(p.nome)}</span>
        <span class="etChipCargo">${escapeHtml(p.cargo || "—")}</span>
      </span>
    `).join("");
  }
}

// ---------- Detalhamento plantonistas (amostra) ----------
function iconePlantao(p) {
  if (p === "dia") return '<i class="fa-solid fa-sun etIconDia" title="Diurno"></i>';
  if (p === "noite") return '<i class="fa-solid fa-moon etIconNoite" title="Noturno"></i>';
  return '<span class="etFolga" title="Folga">—</span>';
}

function colunasPlantonistas() {
  const cols = [
    { title: "Profissional", field: "nome", frozen: true, widthGrow: 2, minWidth: 170,
      formatter: c => {
        const p = c.getData();
        return `<span class="etPlantProfNome">${escapeHtml(p.nome)}</span>` +
               `<span class="etPlantProfEscala">${escapeHtml(rotuloEscala(p))}</span>`;
      } },
  ];
  DIAS_JANELA.forEach((d, i) => cols.push({
    title: d.data, field: `d${i}`, width: 62, hozAlign: "center", headerHozAlign: "center", headerSort: false,
    titleFormatter: () => `${escapeHtml(d.data)}<br><span class="etPlantDow">${escapeHtml(d.dow)}</span>`,
    formatter: c => {
      const p = c.getData();
      const trabalha = (p.dias || [])[i];
      return iconePlantao(trabalha ? (p.escala === "noturno" ? "noite" : "dia") : "folga");
    },
  }));
  cols.push({ title: "…", field: "_more", width: 50, hozAlign: "center", headerSort: false, formatter: () => "—" });
  return cols;
}

function renderPlantonistas() {
  if (!$("etPlantBody")) return;
  const comp = $("etCompPlant");
  if (comp) comp.textContent = `(${COMPETENCIA})`;
  const todos = escalas.filter(p => p.escala === "diurno" || p.escala === "noturno");
  const amostra = todos.slice(0, DETALHE_MAX);
  const cnt = $("etPlantCount");
  if (cnt) cnt.textContent = todos.length > amostra.length ? `amostra: ${amostra.length} de ${todos.length}` : `${todos.length} plantonistas`;

  if (!gradePlantonistas) {
    gradePlantonistas = criarTabelaArrastavel({
      elemento: "etPlantBody", colunas: colunasPlantonistas(), movableColumns: false,
      persistID: "escalaPlantonistas", ordemKey: "escalaPlantonistas:ordem",
      indexField: "id", altura: "280px", vazio: "Nenhum plantonista no período.",
    });
  }
  gradePlantonistas?.render(amostra);
}

// ---------- Detalhamento território (amostra) ----------
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
    { title: "Profissional", field: "nome", widthGrow: 2, minWidth: 140,
      formatter: c => {
        const r = c.getData();
        return `<span class="etNomeProf">${escapeHtml(r.nome)}</span>` +
               `<br><span class="etChipCargo">${escapeHtml(r.cargo || "—")}</span>`;
      } },
    { title: "Escala", field: "tipoTerritorio", hozAlign: "center", headerHozAlign: "center", minWidth: 100,
      formatter: c => badgeEscala("territorio", c.getData().tipoTerritorio) },
    { title: "Data de Ida", field: "ida", hozAlign: "center", headerHozAlign: "center", minWidth: 90 },
    { title: "Data de Retorno", field: "retorno", hozAlign: "center", headerHozAlign: "center", minWidth: 95 },
    { title: "Dias em Território", field: "_dias", hozAlign: "center", headerHozAlign: "center", minWidth: 95,
      formatter: c => escapeHtml(diasEntre(c.getData().ida, c.getData().retorno)) },
    { title: "Situação", field: "situacao", hozAlign: "center", headerHozAlign: "center", minWidth: 100,
      formatter: c => badgeSituacao(c.getData().situacao) },
  ];
}

function renderTerritorio() {
  if (!$("etTerritorioBody")) return;
  const todos = escalas.filter(p => p.escala === "territorio");
  const amostra = todos.slice(0, DETALHE_MAX);
  const cnt = $("etTerrCount");
  if (cnt) cnt.textContent = todos.length > amostra.length ? `amostra: ${amostra.length} de ${todos.length}` : `${todos.length} em território`;

  if (!gradeTerritorio) {
    gradeTerritorio = criarTabelaArrastavel({
      elemento: "etTerritorioBody", colunas: colunasTerritorio(), layout: "fitColumns",
      persistID: "escalaTerritorio", ordemKey: "escalaTerritorio:ordem",
      indexField: "id", altura: "300px", vazio: "Nenhuma escala de território no período.",
    });
  }
  gradeTerritorio?.render(amostra);
}

// ---------- Resumo (KPIs) ----------
function renderResumo() {
  const comp = $("etCompResumo");
  if (comp) comp.textContent = `(${COMPETENCIA})`;
  const total = escalas.length;
  const sem = escalas.filter(p => p.semEscala).length;
  const com = total - sem;
  const terr = escalas.filter(p => p.escala === "territorio" && (p.situacao === "terr" || p.situacao === "retorno")).length;
  const set = (id, v) => { const el = $(id); if (el) el.textContent = String(v); };
  set("etResTotal", total);
  set("etResCom", com);
  set("etResSem", sem);
  set("etResTerr", terr);
}

function renderTudo() {
  renderAlerta();
  renderTabela();
  renderPlantonistas();
  renderTerritorio();
  renderResumo();
  // Recalcula larguras caso alguma grade tenha sido montada com a aba oculta.
  [gradeMain, gradeTerritorio, gradePlantonistas].forEach(g => g?.redraw());
}

// ---------- Carregamento (sob demanda) ----------
async function carregarEscala(forcar) {
  if (estado === "carregando") return;
  if (estado === "ok" && !forcar) return;
  estado = "carregando";
  renderTabela();
  try {
    const payload = await apiGet("/api/escala");
    escalas = payload.profissionais || [];
    opcoesFiltro = payload.filtros || { dseis: [], cargos: [], polos: [] };
    polosPorDsei = payload.polosPorDsei || {};
    popularFiltros();
    estado = "ok";
  } catch (e) {
    estado = "erro";
    erroMsg = (e && e.message) ? e.message : "Não foi possível carregar os profissionais.";
  }
  renderTudo();
}

// ---------- Render ao mostrar ----------
export function renderEscalaTrabalhoAoMostrar() {
  const view = $("view-escalaTrabalho");
  // Modo somente-leitura (Leitor): o CSS (.et-readonly [data-et-*]) esconde os
  // botões de escrita em qualquer profundidade, mesmo que vazem no render.
  if (view) view.classList.toggle("et-readonly", !podeEditarEscala());
  const btnNova = document.querySelector("[data-et-nova]");
  if (btnNova) btnNova.hidden = !podeEditarEscala();

  if (estado === "idle") { carregarEscala(); return; }
  renderTudo();
}

// ---------- Eventos ----------
export function configurarEscalaTrabalho() {
  const view = $("view-escalaTrabalho");
  if (!view || view.dataset.bound) return;
  view.dataset.bound = "1";

  // Combos multi-seleção. Qualquer mudança volta para a 1ª página (como Crachás).
  const criarFiltro = (id, chave, placeholder, extra) => {
    combos[chave] = criarMultiCombo(id, {
      prefixo: "et", placeholder, ariaLabel: placeholder,
      onChange: () => {
        filtros[chave] = combos[chave].getValues();
        if (extra) extra();
        paginaAtual = 1;
        renderTabela();
      }
    });
  };
  // DSEI muda em cascata as opções de Lotação (e sincroniza a seleção de polo).
  criarFiltro("etFDsei", "dsei", "Todos", () => atualizarOpcoesPolo());
  criarFiltro("etFPolo", "polo", "Todos");
  criarFiltro("etFUbsi", "ubsi", "Todos");
  criarFiltro("etFCargo", "cargo", "Todos");
  criarFiltro("etFEscala", "escala", "Todas as escalas");
  criarFiltro("etFSituacao", "situacao", "Todos");

  const busca = $("etBusca");
  if (busca) {
    busca.addEventListener("input", debounce(() => { filtros.busca = busca.value || ""; paginaAtual = 1; renderTabela(); }, 200));
  }

  // "Mostrar N por página" — mesmas opções da aba de Crachás.
  const selPorPagina = $("etPorPagina");
  if (selPorPagina) {
    selPorPagina.innerHTML = PAGE_SIZE_OPCOES.map(n => `<option value="${n}">${n}</option>`).join("");
    selPorPagina.value = String(pageSize);
    selPorPagina.addEventListener("change", e => {
      const n = Number(e.target.value);
      pageSize = PAGE_SIZE_OPCOES.includes(n) ? n : 10;
      paginaAtual = 1;
      renderTabela();
    });
  }

  // Ações (demonstração): apenas feedback via toast, sem persistência.
  view.addEventListener("click", ev => {
    const pagina = ev.target.closest("[data-et-pagina]");
    if (pagina && !pagina.disabled) { irParaPagina(pagina.dataset.etPagina); return; }
    if (ev.target.closest("[data-et-nova]")) {
      if (!podeEditarEscala()) return;
      etToast("Cadastro de nova escala — demonstração (sem gravação no banco).");
      return;
    }
    if (ev.target.closest("[data-et-ver-sem-escala]")) {
      const sem = escalas.filter(p => p.semEscala).length;
      etToast(`${sem} profissionais sem escala registrada.`);
      return;
    }
    const editar = ev.target.closest("[data-et-editar]");
    if (editar) {
      if (!podeEditarEscala()) return;
      const r = escalas.find(x => x.id === editar.dataset.etEditar);
      etToast(`Editar escala de ${r ? r.nome : "profissional"} — demonstração.`);
      return;
    }
    const excluir = ev.target.closest("[data-et-excluir]");
    if (excluir) {
      if (!podeEditarEscala()) return;
      const r = escalas.find(x => x.id === excluir.dataset.etExcluir);
      etToast(`Excluir escala de ${r ? r.nome : "profissional"} — demonstração.`, "erro");
    }
  });
}
