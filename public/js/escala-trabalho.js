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
import { escapeHtml, escapeAttr, debounce, valorCsv, baixarArquivoCsv } from "./utils.js";
import { criarToast } from "./ui-utils.js";
import { nivelModulo } from "./permissoes.js";
import { criarTabelaArrastavel } from "./tabela-arrastavel.js";
import { criarMultiCombo } from "./multi-combo.js";
import { abrirModal } from "./modal.js";
import { POLOS_POR_DSEI, ALIAS_DSEI } from "./escala-polos-dados.js";
import { apiGet } from "./api.js";

const COMPETENCIA = "Mai/2024";
const NIVEL_EDITOR = 2;
const NIVEL_ADMIN = 3;
function podeEditarEscala() { return nivelModulo("escalaTrabalho") >= NIVEL_EDITOR; }
// Administrador do módulo (nível 3): vê o alerta de inconformidade de escala.
function ehAdminEscala() { return nivelModulo("escalaTrabalho") >= NIVEL_ADMIN; }

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

// Situação é o valor REAL da view (SITUACAO_DETALHADA_DESC), ex.: "Normal",
// "Férias", "Auxilio doença". A cor do selo é derivada por heurística do texto.
function classeSituacao(desc) {
  const d = String(desc || "").toLowerCase();
  if (!d) return "is-pendente";
  if (d === "normal" || d.includes("ativ")) return "is-ativo";       // verde
  if (d.includes("féri") || d.includes("feri")) return "is-retorno"; // laranja
  return "is-inativo";                                               // afastamentos: vermelho
}

// Alternância do plantonista: trabalha nos dias PARES ou ÍMPARES do mês (12x36).
const ALTERNANCIAS = {
  par:   { rotulo: "Par",   classe: "is-par" },
  impar: { rotulo: "Ímpar", classe: "is-impar" }
};

// Categorias de afastamento no calendário do detalhamento. Derivadas da SITUAÇÃO
// REAL do empregado (SITUACAO_DETALHADA_DESC, mesma fonte da tabela principal):
// Férias, Atestado e "Afastamento" (bolo dos demais — auxílio doença, licença
// maternidade, acidente de trabalho, etc.).
const AFASTAMENTOS = {
  ferias:      { rotulo: "Férias",      abrev: "F",  classe: "is-ferias" },
  atestado:    { rotulo: "Atestado",    abrev: "AT", classe: "is-atestado" },
  afastamento: { rotulo: "Afastamento", abrev: "A",  classe: "is-afast" }
};

// Mapeia a situação real do empregado para uma categoria de afastamento (ou null
// se está trabalhando normalmente). Como é o status atual, cobre o mês todo.
function afastamentoDaSituacao(situacao) {
  const d = String(situacao || "").toLowerCase();
  if (!d || d === "normal" || d.includes("ativ")) return null;
  if (d.includes("féri") || d.includes("feri")) return "ferias";
  if (d.includes("atestado")) return "atestado";
  return "afastamento"; // demais situações (auxílio doença, licença maternidade, …)
}

// Tipos de escala de território oferecidos na edição.
const ET_TERRITORIOS = ["1x1", "2x1", "30x20x10", "20x10"];
// Dias úteis (Seg→Sex) — pré-preenchimento do diarista.
const DOW_UTEIS = ["Seg", "Ter", "Qua", "Qui", "Sex"];

const DOW_ABREV = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// Janela de 7 dias da coluna "Período / Dias" da tabela principal: centrada no
// DIA ATUAL (hoje ao centro) e rolando com a data real — não é mais fixa em 06–12.
const DIAS_JANELA = (() => {
  const base = new Date();
  const hojeDia = base.getDate();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base.getFullYear(), base.getMonth(), hojeDia - 3 + i);
    return { data: String(d.getDate()).padStart(2, "0"), dow: DOW_ABREV[d.getDay()], hoje: i === 3 };
  });
})();

// Todos os dias do mês da competência (Mai/2024 = 31 dias) para o detalhamento.
const DIAS_MES = Array.from({ length: 31 }, (_, i) => {
  const dia = i + 1;
  return { data: String(dia).padStart(2, "0"), dow: DOW_ABREV[new Date(2024, 4, dia).getDay()] };
});

// Dias-padrão (números do mês) para pré-preencher o calendário da edição:
// diarista → Seg a Sex; plantonista → dias pares/ímpares conforme a alternância.
function diasPadraoEscala(escala, alternancia) {
  const set = new Set();
  if (escala === "diarista") {
    DIAS_MES.forEach(d => { if (DOW_UTEIS.includes(d.dow)) set.add(Number(d.data)); });
  } else if (escala === "diurno" || escala === "noturno") {
    DIAS_MES.forEach(d => { if (diaTrabalhado(alternancia || "par", d.data)) set.add(Number(d.data)); });
  }
  return set;
}

// ---------- Estado da aba ----------
// Cada filtro é um ARRAY de valores selecionados (multi-seleção). Vazio = todos.
const filtros = { dsei: [], polo: [], ubsi: [], cargo: [], escala: [], situacao: [], busca: "" };
// Filtros próprios de cada detalhamento (nome + DSEI + cargo + local/tipo).
const filtrosPlant = { busca: "", dsei: [], cargo: [], local: [] };
const filtrosTerr = { busca: "", dsei: [], cargo: [], tipo: [] };
let escalas = [];            // profissionais (payload do servidor, já prontos)
let estado = "idle";         // idle | carregando | ok | erro
let erroMsg = "";
let pageSize = 10;           // registros por página (ajustável pelo usuário)
let paginaAtual = 1;
// Paginação própria de cada detalhamento (mesmo modelo do rodapé principal).
let pageSizePlant = 10, pagePlant = 1;
let pageSizeTerr = 10, pageTerr = 1;
// Opções de filtro vindas do servidor.
let opcoesFiltro = { dseis: [], cargos: [], polos: [], situacoes: [] };
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
  combos.situacao?.setOptions(opcoesFiltro.situacoes || [], "Todos");
  combos.ubsi?.setOptions([], "Todos"); // UBSI ainda não tem fonte no banco
  // Sincroniza o estado dos filtros com o que sobrou selecionado após repopular.
  ["dsei", "cargo", "escala", "situacao", "ubsi"].forEach(k => { if (combos[k]) filtros[k] = combos[k].getValues(); });
  // Cascata de polo depende de filtros.dsei já sincronizado.
  atualizarOpcoesPolo();

  // Opções dos filtros dos DETALHAMENTOS (a partir dos respectivos subconjuntos).
  const plant = escalas.filter(p => p.escala === "diurno" || p.escala === "noturno" || p.escala === "diarista");
  const terr = escalas.filter(p => p.escala === "territorio");
  combos.plantDsei?.setOptions(distintos(plant, "dsei"), "DSEI");
  combos.plantCargo?.setOptions(distintos(plant, "cargo"), "Cargo");
  combos.plantLocal?.setOptions(distintos(plant, "polo"), "Polo / CASAI");
  combos.terrDsei?.setOptions(distintos(terr, "dsei"), "DSEI");
  combos.terrCargo?.setOptions(distintos(terr, "cargo"), "Cargo");
  combos.terrTipo?.setOptions(distintos(terr, "tipoTerritorio"), "Território");
  filtrosPlant.dsei = combos.plantDsei?.getValues() || [];
  filtrosPlant.cargo = combos.plantCargo?.getValues() || [];
  filtrosPlant.local = combos.plantLocal?.getValues() || [];
  filtrosTerr.dsei = combos.terrDsei?.getValues() || [];
  filtrosTerr.cargo = combos.terrCargo?.getValues() || [];
  filtrosTerr.tipo = combos.terrTipo?.getValues() || [];
}

// Valores distintos de um campo num conjunto de linhas (ordenados pt-BR).
function distintos(rows, chave) {
  return [...new Set(rows.map(r => r[chave]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

// ---------- Catálogo de UBSIs por DSEI (para a edição) ----------
// Fonte: /data/rede_cnes.json (mesmo do Mapa dos DSEIs). Filtra os
// estabelecimentos classificados como UBSI e indexa pela CHAVE do DSEI
// (normalizada), para casar "DSEI ALTO RIO SOLIMOES" (escala) com
// "ALTO RIO SOLIMOES" (CNES). Assim a UBSI só pode ser do DSEI do empregado.
let _ubsisPorDsei = null;

// Normaliza o nome do DSEI: maiúsculas sem acento, sem o prefixo "DSEI",
// hífens/pontuação viram espaço. Iguala as grafias das duas fontes.
function chaveDsei(v) {
  return String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/^DSEI\s+/, "").replace(/\s+/g, " ").trim();
}

// Classifica o estabelecimento do CNES pelo nome (prioridade CASAI > apoio >
// polo > posto > UBSI). Só precisamos identificar UBSI aqui.
function ehUbsiCnes(nome) {
  const n = String(nome || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  if (/CASAI|CASA DE SAUDE|CASA DE APOIO/.test(n)) return false;
  if (/POLO ADMINISTRATIVO|DISTRITO SANITARIO|\bDSEI\b|SEDE|CENTRAL DE ABASTEC|EQUIPE|\bEMSI\b|AMBULATORIO/.test(n)) return false;
  if (/POLO BASE|POLO-BASE|POLOBASE|\bPOLO\b/.test(n)) return false;
  if (/POSTO|\bPS\b|\bPSI\b|\bPIN\b/.test(n)) return false;
  return /UBSI|\bUBS\b|UNIDADE|BASICA DE SAUDE|\bUSFI\b|\bUSF\b|\bUSI\b|CENTRO DE SAUDE|ESPACO SAUDE/.test(n);
}

async function garantirUbsis() {
  if (_ubsisPorDsei) return _ubsisPorDsei;
  const map = {};
  try {
    const resp = await fetch("/data/rede_cnes.json", { credentials: "same-origin" });
    if (resp.ok) {
      const brutos = await resp.json();
      for (const e of brutos || []) {
        if (!ehUbsiCnes(e.nome_estabelecimento)) continue;
        const k = chaveDsei(e.dsei);
        if (!k) continue;
        (map[k] = map[k] || new Set()).add(String(e.nome_estabelecimento || "").trim());
      }
    }
  } catch (e) { /* sem catálogo → UBSI fica vazia (só "não se aplica") */ }
  _ubsisPorDsei = {};
  Object.keys(map).forEach(k => { _ubsisPorDsei[k] = [...map[k]].sort((a, b) => a.localeCompare(b, "pt-BR")); });
  return _ubsisPorDsei;
}

function ubsisDoDsei(dseiNome) {
  return (_ubsisPorDsei || {})[chaveDsei(dseiNome)] || [];
}

// ---------- Lotações (polos) canônicas por DSEI (para a edição) ----------
// Referência de Polos.gs (escala-polos-dados.js), indexada pela chave normalizada
// do DSEI (+ aliases), para casar com o nome do DSEI vindo da view.
let _polosCanonIdx = null;
let _aliasIdx = null;
function garantirIndicePolos() {
  if (_polosCanonIdx) return;
  _polosCanonIdx = {};
  Object.keys(POLOS_POR_DSEI).forEach(k => { _polosCanonIdx[chaveDsei(k)] = POLOS_POR_DSEI[k]; });
  _aliasIdx = {};
  Object.keys(ALIAS_DSEI).forEach(nv => { _aliasIdx[chaveDsei(nv)] = chaveDsei(ALIAS_DSEI[nv]); });
}
function polosCanonicosDoDsei(dseiNome) {
  garantirIndicePolos();
  const chave = chaveDsei(dseiNome);
  return _polosCanonIdx[_aliasIdx[chave] || chave] || [];
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
// Plantonista 12x36: com alternância "par" trabalha nos dias pares do mês; com
// "impar", nos ímpares. Deriva se um dia (número) é escalado.
function diaTrabalhado(alternancia, dataStr) {
  if (!alternancia) return false;
  const par = Number(dataStr) % 2 === 0;
  return alternancia === "par" ? par : !par;
}

// Regra única de "trabalha neste dia": dias marcados (regime personalizado) têm
// prioridade; senão diarista trabalha todo dia; senão a alternância (12x36).
function trabalhaNoDia(r, dataStr) {
  if (Array.isArray(r.diasMarcados)) return r.diasMarcados.includes(Number(dataStr));
  if (r.escala === "diarista") return true;
  return diaTrabalhado(r.alternancia, dataStr);
}

// Dias efetivamente trabalhados no mês (números): os marcados na edição, ou o
// padrão da escala quando ainda não houve edição.
function diasTrabalhadosDoMes(r) {
  return Array.isArray(r.diasMarcados)
    ? r.diasMarcados.map(Number)
    : [...diasPadraoEscala(r.escala, r.alternancia)];
}

// Detecta inconformidade da escala registrada vs. a regra do tipo de escala.
// Retorna uma descrição do problema (para o alerta de administrador) ou null.
//  · Diarista → não deve trabalhar em fim de semana (Sáb/Dom).
//  · Plantonista PAR → só em dias pares (qualquer dia ímpar é inconformidade).
//  · Plantonista ÍMPAR → só em dias ímpares (qualquer dia par é inconformidade).
function inconformidadeEscala(r) {
  if (r.semEscala || !r.escala || r.escala === "territorio") return null;
  const dias = diasTrabalhadosDoMes(r);
  if (!dias.length) return null;
  if (r.escala === "diarista") {
    const fds = dias.filter(n => {
      const dow = DOW_ABREV[new Date(2024, 4, n).getDay()];
      return dow === "Sáb" || dow === "Dom";
    });
    if (fds.length) return `Diarista escalado em ${fds.length} dia(s) de fim de semana (Sáb/Dom).`;
  } else if (r.escala === "diurno" || r.escala === "noturno") {
    if (r.alternancia === "par") {
      const impares = dias.filter(n => n % 2 !== 0);
      if (impares.length) return `Alternância PAR, mas escalado em ${impares.length} dia(s) ímpar(es).`;
    } else if (r.alternancia === "impar") {
      const pares = dias.filter(n => n % 2 === 0);
      if (pares.length) return `Alternância ÍMPAR, mas escalado em ${pares.length} dia(s) par(es).`;
    }
  }
  return null;
}

function periodoCelula(r) {
  if (r.escala === "territorio") {
    return `<span class="etPeriodoTerr">Ida: <b>${escapeHtml(r.ida || "—")}</b> · Retorno: <b>${escapeHtml(r.retorno || "—")}</b></span>`;
  }
  // Sem info de dias (não é diarista, sem alternância nem marcação) → "—".
  if (!Array.isArray(r.diasMarcados) && !r.alternancia && r.escala !== "diarista") return `<span class="etPeriodoVazio">—</span>`;
  const celulas = DIAS_JANELA.map(d => {
    const on = trabalhaNoDia(r, d.data);
    return `<span class="etDia${d.hoje ? " is-hoje" : ""}"><span class="etDiaLabel">${escapeHtml(d.dow)}</span>` +
      `<span class="etDiaNum">${escapeHtml(d.data)}</span>` +
      `<span class="etDiaBox${on ? " is-on" : ""}">${on ? '<i class="fa-solid fa-check"></i>' : ""}</span></span>`;
  }).join("");
  return `<span class="etDias">${celulas}</span>`;
}

function badgeAlternancia(chave) {
  if (!chave) return `<span class="etAltNa">—</span>`;
  const a = ALTERNANCIAS[chave] || { rotulo: chave, classe: "" };
  return `<span class="etAlt ${a.classe}">${escapeHtml(a.rotulo)}</span>`;
}

function badgeEscala(chave, tipoTerritorio) {
  if (!chave) return `<span class="etEscala is-pendente">A definir</span>`;
  const e = ESCALAS[chave] || { rotulo: chave, classe: "" };
  const rotulo = chave === "territorio" ? `Território ${tipoTerritorio || ""}`.trim() : e.rotulo;
  return `<span class="etEscala ${e.classe}">${escapeHtml(rotulo)}</span>`;
}

function badgeSituacao(desc) {
  if (!desc) return `<span class="etSituacao is-pendente">—</span>`;
  return `<span class="etSituacao ${classeSituacao(desc)}">${escapeHtml(desc)}</span>`;
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
      formatter: c => {
        const d = c.getData();
        return badgeEscala(d.escala, d.tipoTerritorio) +
          (d.regime ? `<div class="etEscalaRegime">${escapeHtml(d.regime)}</div>` : "");
      } },
    { title: "Alternância de Escala", field: "alternancia", hozAlign: "center", headerHozAlign: "center", minWidth: 130,
      formatter: c => badgeAlternancia(c.getData().alternancia) },
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
    indexField: "id", movableRows: false, autoResize: false,
    vazio: "Nenhum profissional encontrado com os filtros atuais.",
  });
}

function renderTabela() {
  const cont = $("etTabelaBody");
  if (!cont) return;
  const count = $("etTabelaCount");
  const registros = $("etRegistros");

  // Carregando/erro: mostra uma mensagem simples e NÃO monta um Tabulator vazio
  // (um Tabulator vazio com placeholder pode entrar em laço no adjustTableSize —
  // "Maximum call stack size exceeded"). A grade só é criada quando há dados.
  if ((estado === "carregando" && !escalas.length) || estado === "erro") {
    if (count) count.textContent = estado === "erro" ? "—" : "carregando…";
    if (registros) registros.textContent = "";
    renderPaginacao(1);
    if (!gradeMain) {
      cont.innerHTML = `<div class="etGridMsg">${estado === "erro"
        ? escapeHtml(erroMsg || "Não foi possível carregar os profissionais.")
        : "Carregando profissionais…"}</div>`;
    }
    return;
  }

  garantirGradeMain();
  if (!gradeMain) return;
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

// Monta o HTML dos controles de página (mesmo layout/lógica da aba Entrega de
// Crachá). `attr` é o data-* usado nos botões (permite rodapés independentes).
function paginacaoHtml(pagina, totalPaginas, attr) {
  if (totalPaginas <= 1) return "";
  const janela = 2;
  let ini = Math.max(1, pagina - janela);
  let fim = Math.min(totalPaginas, pagina + janela);
  if (pagina <= janela) fim = Math.min(totalPaginas, 1 + janela * 2);
  if (pagina > totalPaginas - janela) ini = Math.max(1, totalPaginas - janela * 2);

  let html = `<button class="etPageBtn etPageNav" ${attr}="prev" ${pagina === 1 ? "disabled" : ""} title="Anterior"><i class="fa-solid fa-angle-left"></i></button>`;
  if (ini > 1) {
    html += `<button class="etPageBtn" ${attr}="1">1</button>`;
    if (ini > 2) html += `<span class="etPageEllipsis">…</span>`;
  }
  for (let p = ini; p <= fim; p++) {
    html += `<button class="etPageBtn${p === pagina ? " is-ativo" : ""}" ${attr}="${p}">${p}</button>`;
  }
  if (fim < totalPaginas) {
    if (fim < totalPaginas - 1) html += `<span class="etPageEllipsis">…</span>`;
    html += `<button class="etPageBtn" ${attr}="${totalPaginas}">${totalPaginas}</button>`;
  }
  html += `<button class="etPageBtn etPageNav" ${attr}="next" ${pagina === totalPaginas ? "disabled" : ""} title="Próxima"><i class="fa-solid fa-angle-right"></i></button>`;
  return html;
}

function renderPaginacao(totalPaginas) {
  const wrap = $("etPagination");
  if (wrap) wrap.innerHTML = paginacaoHtml(paginaAtual, totalPaginas, "data-et-pagina");
}

function irParaPagina(valor) {
  const totalPaginas = Math.max(1, Math.ceil(aplicaFiltros(escalas).length / pageSize));
  if (valor === "prev") paginaAtual = Math.max(1, paginaAtual - 1);
  else if (valor === "next") paginaAtual = Math.min(totalPaginas, paginaAtual + 1);
  else paginaAtual = Math.min(totalPaginas, Math.max(1, Number(valor) || 1));
  renderTabela();
}

// Nova página a partir de prev/next/número, respeitando os limites do conjunto.
function calcPagina(valor, atual, totalItens, tamanho) {
  const totalPaginas = Math.max(1, Math.ceil(totalItens / tamanho));
  if (valor === "prev") return Math.max(1, atual - 1);
  if (valor === "next") return Math.min(totalPaginas, atual + 1);
  return Math.min(totalPaginas, Math.max(1, Number(valor) || 1));
}

// ---------- Alerta sem escala (mock) ----------
function renderAlerta() {
  // Só o bloco do alerta (título + chips) some quando não há sem-escala; os
  // indicadores, no topo do mesmo card, ficam sempre visíveis.
  const bloco = $("etAlertaBloco");
  const sem = escalas.filter(p => p.semEscala);
  if (bloco) bloco.hidden = !sem.length;
  if (!sem.length) return;
  const total = $("etAlertaTotal");
  if (total) total.textContent = String(sem.length);
  const chips = $("etAlertaChips");
  if (chips) {
    const editor = podeEditarEscala();
    const chipsHtml = sem.slice(0, 8).map(p => `
      <button type="button" class="etChip${editor ? " etChipBtn" : ""}"${editor ? ` data-et-editar-alerta="${escapeAttr(p.id)}" title="Registrar escala de ${escapeAttr(p.nome)}"` : " disabled"}>
        <span class="etChipNome">${escapeHtml(p.nome)}</span>
        <span class="etChipCargo">${escapeHtml(p.cargo || "—")}</span>
      </button>
    `).join("");
    // "Ver todos" entra no MESMO fluxo dos chips (último item) — ocupa o espaço
    // livre na linha dos nomes e só quebra para a próxima linha se não couber.
    chips.innerHTML = chipsHtml +
      `<button type="button" class="etBtn etBtnVerTodos" data-et-ver-sem-escala>Ver todos <i class="fa-solid fa-arrow-right"></i></button>`;
  }
}

// Alerta EXCLUSIVO de administrador: profissionais cuja escala registrada
// contraria a regra do tipo (diarista em fim de semana; plantonista fora da
// alternância). Clicar num nome abre a edição para corrigir.
function renderConformidade() {
  const bloco = $("etConformidadeBloco");
  if (!bloco) return;
  if (!ehAdminEscala()) { bloco.hidden = true; return; }
  const problemas = escalas
    .map(p => ({ p, motivo: inconformidadeEscala(p) }))
    .filter(x => x.motivo);
  bloco.hidden = !problemas.length;
  if (!problemas.length) return;
  const total = $("etConfTotal");
  if (total) total.textContent = String(problemas.length);
  const chips = $("etConfChips");
  if (chips) {
    const vis = problemas.slice(0, 12);
    chips.innerHTML = vis.map(({ p, motivo }) => `
      <button type="button" class="etChip etChipConf etChipBtn" data-et-editar-alerta="${escapeAttr(p.id)}" title="${escapeAttr(motivo)} — clique para corrigir">
        <span class="etChipNome">${escapeHtml(p.nome)}</span>
        <span class="etChipMotivo">${escapeHtml(motivo)}</span>
      </button>
    `).join("") + (problemas.length > vis.length ? `<span class="etChipMais">+${problemas.length - vis.length} outros</span>` : "");
  }
}

// ---------- Preview "Ver todos" — profissionais sem escala (editar em linha) ----------
// Abre um modal com a tabela dos profissionais sem escala (mesmas colunas de
// Profissionais e Escalas) e um botão de editar por linha. Sem edição em lote:
// ao salvar a escala de um profissional, ele sai da lista automaticamente.
function abrirPreviewSemEscala() {
  if (!podeEditarEscala()) return;
  fecharPreviewSemEscala();
  const ov = document.createElement("div");
  ov.className = "etModalOverlay";
  ov.id = "etPreviewOverlay";
  ov.innerHTML = `
    <div class="etModalCard etModalCardLg" role="dialog" aria-modal="true" aria-label="Profissionais sem escala registrada">
      <div class="etModalHead">
        <div>
          <h3>Profissionais sem escala registrada</h3>
          <p>Clique em <b>Editar</b> para registrar a escala. Ao salvar, o profissional sai da lista.</p>
        </div>
        <button type="button" class="etModalClose" data-et-prev-fechar aria-label="Fechar"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="etModalBody">
        <div class="etPreviewWrap">
          <table class="etPreviewTabela">
            <thead><tr>
              <th>Profissional</th><th>Cargo</th><th>DSEI</th>
              <th>Polo base / CASAI</th><th>Situação</th><th class="etPreviewThAcao">Ações</th>
            </tr></thead>
            <tbody id="etPreviewTbody"></tbody>
          </table>
        </div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener("click", ev => {
    if (ev.target === ov || ev.target.closest("[data-et-prev-fechar]")) { fecharPreviewSemEscala(); return; }
    const editar = ev.target.closest("[data-et-prev-editar]");
    if (editar) {
      const r = escalas.find(x => x.id === editar.dataset.etPrevEditar);
      if (r) abrirEdicaoEscala(r); // o modal de edição sobe por cima; ao salvar, renderTudo atualiza este preview
    }
  });
  document.addEventListener("keydown", escFecharPreview);
  renderPreviewSemEscala();
}

// ESC fecha o preview, mas não quando o modal de edição está aberto por cima dele.
function escFecharPreview(ev) { if (ev.key === "Escape" && !$("etEdicaoOverlay")) fecharPreviewSemEscala(); }

function fecharPreviewSemEscala() {
  const ov = $("etPreviewOverlay");
  if (ov) ov.remove();
  document.removeEventListener("keydown", escFecharPreview);
}

function renderPreviewSemEscala() {
  const tb = $("etPreviewTbody");
  if (!tb) return;
  const rows = escalas.filter(p => p.semEscala);
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="6" class="etPreviewVazio"><i class="fa-solid fa-circle-check"></i> Todos os profissionais possuem escala registrada.</td></tr>`;
    return;
  }
  tb.innerHTML = rows.map(r => `
    <tr>
      <td class="etPreviewNome">${escapeHtml(r.nome)}</td>
      <td>${escapeHtml(r.cargo || "—")}</td>
      <td>${escapeHtml(r.dsei || "—")}</td>
      <td>${escapeHtml(r.polo || "—")}</td>
      <td class="etPreviewSit">${badgeSituacao(r.situacao)}</td>
      <td class="etPreviewAcao"><button type="button" class="etBtn etBtnMini" data-et-prev-editar="${escapeAttr(r.id)}"><i class="fa-solid fa-pen"></i> Editar</button></td>
    </tr>`).join("");
}

// ---------- Detalhamento plantonistas (mês inteiro) ----------
function iconePlantao(p) {
  if (p === "dia") return '<i class="fa-solid fa-sun etIconDia" title="Diurno"></i>';
  if (p === "noite") return '<i class="fa-solid fa-moon etIconNoite" title="Noturno"></i>';
  return '<span class="etFolga" title="Folga">—</span>';
}

// Conteúdo de um dia do calendário do plantonista: afastamento (férias/licença/
// afastamento) tem prioridade; senão, plantão (dia/noite) pela alternância; senão folga.
function celulaPlantao(p, dataStr) {
  // Afastamento (férias/atestado/afastamento) vem da situação real e cobre o mês.
  const af = afastamentoDaSituacao(p.situacao);
  if (af) {
    const meta = AFASTAMENTOS[af];
    return `<span class="etAfast ${meta.classe}" title="${escapeAttr(meta.rotulo)}">${meta.abrev}</span>`;
  }
  if (trabalhaNoDia(p, dataStr)) return iconePlantao(p.escala === "noturno" ? "noite" : "dia");
  return iconePlantao("folga");
}

function colunasPlantonistas() {
  const cols = [
    { title: "Profissional", field: "nome", frozen: true, widthGrow: 2, minWidth: 170,
      formatter: c => {
        const p = c.getData();
        return `<span class="etPlantProfNome">${escapeHtml(p.nome)}</span>` +
               `<span class="etPlantProfEscala">${escapeHtml(p.cargo || "—")}</span>`;
      } },
  ];
  // Uma coluna por dia do mês (01..31). Profissional fica fixo; os dias rolam na horizontal.
  DIAS_MES.forEach(d => cols.push({
    title: d.data, field: `d${d.data}`, width: 40, hozAlign: "center", headerHozAlign: "center", headerSort: false,
    titleFormatter: () => `${escapeHtml(d.data)}<br><span class="etPlantDow">${escapeHtml(d.dow)}</span>`,
    formatter: c => celulaPlantao(c.getData(), d.data),
  }));
  return cols;
}

// Plantonistas que passam pelos filtros do próprio detalhamento (nome/cargo/local).
function filtrarPlantonistas() {
  const termo = filtrosPlant.busca.trim().toLowerCase();
  const casa = (sel, val) => !sel.length || sel.includes(val);
  return escalas.filter(p =>
    (p.escala === "diurno" || p.escala === "noturno" || p.escala === "diarista") &&
    casa(filtrosPlant.dsei, p.dsei) &&
    casa(filtrosPlant.cargo, p.cargo) &&
    casa(filtrosPlant.local, p.polo) &&
    (!termo || p.nome.toLowerCase().includes(termo)));
}

function renderPlantonistas() {
  if (!$("etPlantBody")) return;
  const comp = $("etCompPlant");
  if (comp) comp.textContent = `(${COMPETENCIA})`;
  const todos = filtrarPlantonistas();
  const totalPaginas = Math.max(1, Math.ceil(todos.length / pageSizePlant));
  if (pagePlant > totalPaginas) pagePlant = totalPaginas;
  const inicio = (pagePlant - 1) * pageSizePlant;
  const pagina = todos.slice(inicio, inicio + pageSizePlant);
  const cnt = $("etPlantCount");
  if (cnt) cnt.textContent = `${todos.length} profissionais`;
  const reg = $("etPlantRegistros");
  if (reg) reg.textContent = todos.length
    ? `Mostrando ${inicio + 1} a ${Math.min(inicio + pageSizePlant, todos.length)} de ${todos.length} profissionais`
    : "Mostrando 0 profissionais";

  if (!gradePlantonistas) {
    gradePlantonistas = criarTabelaArrastavel({
      elemento: "etPlantBody", colunas: colunasPlantonistas(), movableColumns: false,
      persistID: "escalaPlantonistas", ordemKey: "escalaPlantonistas:ordem",
      indexField: "id", altura: "280px", autoResize: false, vazio: "Nenhum plantonista no período.",
    });
  }
  gradePlantonistas?.render(pagina);
  const wrap = $("etPlantPagination");
  if (wrap) wrap.innerHTML = paginacaoHtml(pagePlant, totalPaginas, "data-et-plant-pagina");
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

// Escalas de território que passam pelos filtros do detalhamento (nome/cargo/tipo).
function filtrarTerritorio() {
  const termo = filtrosTerr.busca.trim().toLowerCase();
  const casa = (sel, val) => !sel.length || sel.includes(val);
  return escalas.filter(p =>
    p.escala === "territorio" &&
    casa(filtrosTerr.dsei, p.dsei) &&
    casa(filtrosTerr.cargo, p.cargo) &&
    casa(filtrosTerr.tipo, p.tipoTerritorio) &&
    (!termo || p.nome.toLowerCase().includes(termo)));
}

function renderTerritorio() {
  if (!$("etTerritorioBody")) return;
  const todos = filtrarTerritorio();
  const totalPaginas = Math.max(1, Math.ceil(todos.length / pageSizeTerr));
  if (pageTerr > totalPaginas) pageTerr = totalPaginas;
  const inicio = (pageTerr - 1) * pageSizeTerr;
  const pagina = todos.slice(inicio, inicio + pageSizeTerr);
  const cnt = $("etTerrCount");
  if (cnt) cnt.textContent = `${todos.length} em território`;
  const reg = $("etTerrRegistros");
  if (reg) reg.textContent = todos.length
    ? `Mostrando ${inicio + 1} a ${Math.min(inicio + pageSizeTerr, todos.length)} de ${todos.length} em território`
    : "Mostrando 0 em território";

  if (!gradeTerritorio) {
    gradeTerritorio = criarTabelaArrastavel({
      elemento: "etTerritorioBody", colunas: colunasTerritorio(), layout: "fitColumns",
      persistID: "escalaTerritorio", ordemKey: "escalaTerritorio:ordem",
      indexField: "id", altura: "300px", autoResize: false, vazio: "Nenhuma escala de território no período.",
    });
  }
  gradeTerritorio?.render(pagina);
  const wrap = $("etTerrPagination");
  if (wrap) wrap.innerHTML = paginacaoHtml(pageTerr, totalPaginas, "data-et-terr-pagina");
}

// ---------- Resumo (KPIs) — renderiza no topo do card de alerta ----------
function renderResumo() {
  const total = escalas.length;
  const sem = escalas.filter(p => p.semEscala).length;
  const com = total - sem;
  const terr = escalas.filter(p => p.escala === "territorio").length;
  const set = (id, v) => { const el = $(id); if (el) el.textContent = String(v); };
  set("etResTotal", total);
  set("etResCom", com);
  set("etResSem", sem);
  set("etResTerr", terr);
}

// ---------- Exportação ----------
// Plantonistas → PDF (grade do mês, via janela de impressão). Território → CSV.
function exportarDetalhe(tipo) {
  if (tipo === "plantonistas") { exportarPlantonistasPdf(); return; }

  const rows = filtrarTerritorio();
  if (!rows.length) { etToast("Nada para exportar com os filtros atuais.", "erro"); return; }
  const linhas = [["Matrícula", "Profissional", "Cargo", "DSEI", "Polo/CASAI", "Escala", "Data de Ida", "Data de Retorno", "Dias em Território", "Situação"]];
  rows.forEach(p => linhas.push([
    p.matricula, p.nome, p.cargo, p.dsei, p.polo,
    `Território ${p.tipoTerritorio || ""}`.trim(), p.ida, p.retorno,
    diasEntre(p.ida, p.retorno), p.situacao || ""
  ]));
  const csv = "﻿" + linhas.map(l => l.map(valorCsv).join(";")).join("\n");
  baixarArquivoCsv(csv, "detalhamento_territorio");
}

// Código de um dia na grade impressa: F/L/A (afastamento) · D/N (plantão) · vazio (folga).
function codigoDia(p, dataStr) {
  const af = afastamentoDaSituacao(p.situacao);
  // Códigos do PDF: atestado = "AM" (Atestado Médico); diarista = "TD" (Trabalhador Diário).
  if (af) return af === "atestado" ? "AM" : ((AFASTAMENTOS[af] || {}).abrev || "");
  // Regime personalizado (dias marcados): D/N nos dias trabalhados, vazio na folga.
  if (Array.isArray(p.diasMarcados)) return p.diasMarcados.includes(Number(dataStr)) ? (p.escala === "noturno" ? "N" : "D") : "";
  if (p.escala === "diarista") return "TD";
  if (diaTrabalhado(p.alternancia, dataStr)) return p.escala === "noturno" ? "N" : "D";
  return "";
}

// Gera o PDF da escala de plantonistas (grade do mês) via janela de impressão —
// "Salvar como PDF". Sem biblioteca externa (só HTML + estilos inline, permitido
// pela CSP). Respeita os filtros do detalhamento.
async function exportarPlantonistasPdf() {
  const rows = filtrarPlantonistas();
  if (!rows.length) { etToast("Nada para exportar com os filtros atuais.", "erro"); return; }

  // Muitos registros geram um PDF enorme — sugere filtrar (ex.: por polo/CASAI).
  if (rows.length > 500) {
    const r = await abrirModal({
      titulo: "Exportar escala",
      msg: `São ${rows.length} plantonistas. O ideal é filtrar por Polo/CASAI ou cargo antes. Gerar o PDF mesmo assim?`,
      confirmarTexto: "Gerar PDF",
      perigo: true
    });
    if (!r || !r.ok) return;
  }

  // DSEI(s) do conjunto filtrado para o título (um só → nome; vários → resumo).
  const dseis = [...new Set(rows.map(r => r.dsei).filter(Boolean))];
  const dseiTitulo = dseis.length === 1 ? dseis[0] : (dseis.length ? `${dseis.length} DSEIs` : "—");

  const th = DIAS_MES.map(d => `<th class="d">${escapeHtml(d.data)}</th>`).join("");
  const thDow = DIAS_MES.map(d => `<th class="d dow">${escapeHtml(d.dow)}</th>`).join("");
  const corpo = rows.map(p => {
    const dias = DIAS_MES.map(d => `<td>${escapeHtml(codigoDia(p, d.data))}</td>`).join("");
    return `<tr><td class="nome">${escapeHtml(p.polo || "—")}</td><td class="nome">${escapeHtml(p.nome)}</td><td class="nome">${escapeHtml(p.cargo || "—")}</td>${dias}</tr>`;
  }).join("");

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <title>Escala Plantonista/Diarista — ${escapeHtml(dseiTitulo)} — ${escapeHtml(COMPETENCIA)}</title>
    <style>
      @page { size: A4 landscape; margin: 8mm; }
      * { box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; }
      h1 { font-size: 14px; text-align: center; margin: 0 0 2px; text-transform: uppercase; }
      h2 { font-size: 12px; text-align: center; margin: 0 0 4px; font-weight: 800; }
      .meta { font-size: 9px; color: #444; text-align: center; margin-bottom: 8px; }
      /* auto: cada coluna ocupa só o necessário — dias compactos, nomes numa linha. */
      table { border-collapse: collapse; table-layout: auto; }
      th, td { border: 1px solid #333; padding: 2px 3px; text-align: center; font-size: 8px; }
      th.d, td.d { width: 15px; }
      th.dow { font-weight: 600; color: #333; }
      /* nowrap: o nome nunca quebra; a coluna cresce apenas se o nome for grande. */
      th.nome, td.nome { text-align: left; white-space: nowrap; font-size: 8.5px; }
      thead th { background: #e9eef5; }
      tbody td { height: 16px; }
      .legenda { margin-top: 10px; font-size: 9px; }
      .legenda b { font-weight: 800; }
      .obs { margin-top: 8px; font-size: 9px; }
      .obs b { font-weight: 800; }
      .assinatura { margin-top: 46px; text-align: center; }
      .assinatura .linha { width: 320px; margin: 0 auto; border-top: 1px solid #333; }
      .assinatura .rotulo { font-size: 9.5px; font-weight: 700; margin-top: 4px; }
      .assinatura .cargo { font-size: 8.5px; color: #444; }
    </style></head>
    <body>
      <h1>Escala de Trabalho — Plantonista/Diarista</h1>
      <h2>${escapeHtml(dseiTitulo)}</h2>
      <div class="meta">Competência: ${escapeHtml(COMPETENCIA)} · ${rows.length} profissionais · exportado em ${new Date().toLocaleString("pt-BR")}</div>
      <table>
        <thead>
          <tr><th class="nome">Polo / CASAI</th><th class="nome">Profissional</th><th class="nome">Cargo</th>${th}</tr>
          <tr><th class="nome"></th><th class="nome"></th><th class="nome"></th>${thDow}</tr>
        </thead>
        <tbody>${corpo}</tbody>
      </table>
      <div class="legenda"><b>Legenda:</b> D = Plantão Diurno · N = Plantão Noturno · TD = Trabalhador Diário (diarista) · F = Férias · AM = Atestado Médico · A = Afastamento · (em branco) = Folga</div>
      <div class="obs"><b>Observação:</b> Só poderão ser realizadas duas trocas de plantões e com autorização da direção. Caso o profissional ultrapasse duas trocas sem justificativa, será punido e receberá falta.</div>
      <div class="assinatura">
        <div class="linha"></div>
        <div class="rotulo">Assinatura do(a) Chefe / Coordenação</div>
        <div class="cargo">Escala de Trabalho — ${escapeHtml(dseiTitulo)}</div>
      </div>
    </body></html>`;

  const w = window.open("", "_blank");
  if (!w) { etToast("Permita pop-ups para exportar o PDF.", "erro"); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  // Espera o layout assentar antes de abrir a caixa de impressão / salvar como PDF.
  setTimeout(() => { try { w.print(); } catch (e) { /* usuário fecha a janela */ } }, 400);
}

function renderTudo() {
  renderAlerta();
  renderConformidade();
  renderTabela();
  renderPlantonistas();
  renderTerritorio();
  renderResumo();
  // Recalcula larguras caso alguma grade tenha sido montada com a aba oculta.
  [gradeMain, gradeTerritorio, gradePlantonistas].forEach(g => g?.redraw());
  // Se o preview "Ver todos" estiver aberto, atualiza para refletir quem já saiu da lista.
  if ($("etPreviewOverlay")) renderPreviewSemEscala();
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

  // ---- Filtros dos DETALHAMENTOS (nome/DSEI/cargo/local · nome/DSEI/cargo/tipo) ----
  // Qualquer mudança de filtro do detalhamento volta para a 1ª página do próprio rodapé.
  combos.plantDsei = criarMultiCombo("etPlantFDsei", { prefixo: "et", placeholder: "DSEI", ariaLabel: "Filtrar plantonistas por DSEI", onChange: () => { filtrosPlant.dsei = combos.plantDsei.getValues(); pagePlant = 1; renderPlantonistas(); } });
  combos.plantCargo = criarMultiCombo("etPlantFCargo", { prefixo: "et", placeholder: "Cargo", ariaLabel: "Filtrar plantonistas por cargo", onChange: () => { filtrosPlant.cargo = combos.plantCargo.getValues(); pagePlant = 1; renderPlantonistas(); } });
  combos.plantLocal = criarMultiCombo("etPlantFLocal", { prefixo: "et", placeholder: "Polo / CASAI", ariaLabel: "Filtrar plantonistas por polo/CASAI", onChange: () => { filtrosPlant.local = combos.plantLocal.getValues(); pagePlant = 1; renderPlantonistas(); } });
  combos.terrDsei = criarMultiCombo("etTerrFDsei", { prefixo: "et", placeholder: "DSEI", ariaLabel: "Filtrar território por DSEI", onChange: () => { filtrosTerr.dsei = combos.terrDsei.getValues(); pageTerr = 1; renderTerritorio(); } });
  combos.terrCargo = criarMultiCombo("etTerrFCargo", { prefixo: "et", placeholder: "Cargo", ariaLabel: "Filtrar território por cargo", onChange: () => { filtrosTerr.cargo = combos.terrCargo.getValues(); pageTerr = 1; renderTerritorio(); } });
  combos.terrTipo = criarMultiCombo("etTerrFTipo", { prefixo: "et", placeholder: "Território", ariaLabel: "Filtrar por tipo de território", onChange: () => { filtrosTerr.tipo = combos.terrTipo.getValues(); pageTerr = 1; renderTerritorio(); } });

  const buscaPlant = $("etPlantBusca");
  if (buscaPlant) buscaPlant.addEventListener("input", debounce(() => { filtrosPlant.busca = buscaPlant.value || ""; pagePlant = 1; renderPlantonistas(); }, 200));
  const buscaTerr = $("etTerrBusca");
  if (buscaTerr) buscaTerr.addEventListener("input", debounce(() => { filtrosTerr.busca = buscaTerr.value || ""; pageTerr = 1; renderTerritorio(); }, 200));

  // "Mostrar N por página" dos detalhamentos (rodapés independentes).
  const ligarPorPagina = (id, setTam, reset, render) => {
    const sel = $(id);
    if (!sel) return;
    sel.innerHTML = PAGE_SIZE_OPCOES.map(n => `<option value="${n}">${n}</option>`).join("");
    sel.value = "10";
    sel.addEventListener("change", e => {
      const n = Number(e.target.value);
      setTam(PAGE_SIZE_OPCOES.includes(n) ? n : 10);
      reset();
      render();
    });
  };
  ligarPorPagina("etPlantPorPagina", n => { pageSizePlant = n; }, () => { pagePlant = 1; }, renderPlantonistas);
  ligarPorPagina("etTerrPorPagina", n => { pageSizeTerr = n; }, () => { pageTerr = 1; }, renderTerritorio);

  // Ações (demonstração): apenas feedback via toast, sem persistência.
  view.addEventListener("click", ev => {
    const pagina = ev.target.closest("[data-et-pagina]");
    if (pagina && !pagina.disabled) { irParaPagina(pagina.dataset.etPagina); return; }
    const pagPlant = ev.target.closest("[data-et-plant-pagina]");
    if (pagPlant && !pagPlant.disabled) { pagePlant = calcPagina(pagPlant.dataset.etPlantPagina, pagePlant, filtrarPlantonistas().length, pageSizePlant); renderPlantonistas(); return; }
    const pagTerr = ev.target.closest("[data-et-terr-pagina]");
    if (pagTerr && !pagTerr.disabled) { pageTerr = calcPagina(pagTerr.dataset.etTerrPagina, pageTerr, filtrarTerritorio().length, pageSizeTerr); renderTerritorio(); return; }
    const exportar = ev.target.closest("[data-et-exportar]");
    if (exportar) { exportarDetalhe(exportar.dataset.etExportar); return; }
    if (ev.target.closest("[data-et-ver-sem-escala]")) {
      abrirPreviewSemEscala();
      return;
    }
    // Clicar num nome do alerta abre a edição; ao registrar a escala ele sai da lista.
    const editarAlerta = ev.target.closest("[data-et-editar-alerta]");
    if (editarAlerta) {
      if (!podeEditarEscala()) return;
      const r = escalas.find(x => x.id === editarAlerta.dataset.etEditarAlerta);
      if (r) abrirEdicaoEscala(r);
      return;
    }
    const editar = ev.target.closest("[data-et-editar]");
    if (editar) {
      if (!podeEditarEscala()) return;
      const r = escalas.find(x => x.id === editar.dataset.etEditar);
      if (r) abrirEdicaoEscala(r);
      return;
    }
    const excluir = ev.target.closest("[data-et-excluir]");
    if (excluir) {
      if (!podeEditarEscala()) return;
      const r = escalas.find(x => x.id === excluir.dataset.etExcluir);
      if (r) limparEscalaProfissional(r);
      return;
    }
  });
}

// Remove APENAS a escala do profissional (UBSI, escala, alternância, período/dias),
// preservando a identidade (nome, cargo, DSEI, polo base) E a situação (status
// real). O profissional passa a contar como "sem escala registrada". Pede
// confirmação antes.
async function limparEscalaProfissional(r) {
  const resp = await abrirModal({
    titulo: "Remover escala",
    msg: `Remover a escala de ${r.nome}? Nome, cargo, DSEI, polo base e situação são mantidos; UBSI, escala, alternância e período/dias serão limpos.`,
    confirmarTexto: "Remover escala",
    perigo: true
  });
  if (!resp || !resp.ok) return;
  r.escala = null;
  r.alternancia = null;
  r.regime = null;
  r.diasMarcados = null;
  r.tipoTerritorio = null;
  r.ida = null;
  r.retorno = null;
  r.ubsi = "";
  // situacao NÃO é alterada: é o status real do empregado (SITUACAO_DETALHADA_DESC).
  r.semEscala = true;
  renderTudo();
  etToast(`Escala de ${r.nome} removida (identidade mantida).`);
}

// ---------- Edição da escala de um profissional (modal) ----------
function fecharEdicaoEscala() {
  const ov = $("etEdicaoOverlay");
  if (ov) ov.remove();
}

// Abre o formulário de edição. Nome/cargo/DSEI são só leitura; a Lotação (polo
// base) e a UBSI são restritas ao DSEI do empregado (polos da referência canônica
// Polos.gs; UBSI do catálogo CNES); alternância só para plantonista; regime
// (12x36/24x48/6x1/5x2/… ou personalizado) para plantonista/diarista; ida/retorno
// e tipo para território.
async function abrirEdicaoEscala(r) {
  if (!podeEditarEscala()) return;
  fecharEdicaoEscala();
  await garantirUbsis();
  const ubsis = ubsisDoDsei(r.dsei);

  // Lotação (polo base) mapeada para o DSEI do empregado (referência canônica).
  // Garante que o polo atual apareça mesmo se não estiver na lista canônica.
  const polosCanon = polosCanonicosDoDsei(r.dsei);
  const listaPolo = (r.polo && !polosCanon.includes(r.polo)) ? [r.polo, ...polosCanon] : polosCanon;
  const optPolo = `<option value="">Nenhuma / não se aplica</option>` +
    listaPolo.map(x => `<option value="${escapeAttr(x)}"${r.polo === x ? " selected" : ""}>${escapeHtml(x)}</option>`).join("");
  const optUbsi = `<option value="">Nenhuma / não se aplica</option>` +
    ubsis.map(u => `<option value="${escapeAttr(u)}"${r.ubsi === u ? " selected" : ""}>${escapeHtml(u)}</option>`).join("");
  // Default do campo escala = plantonista (diurno) quando não há escala definida.
  const escalaDefault = r.escala || "diurno";
  const optEscala = Object.keys(ESCALAS).map(k => `<option value="${k}"${escalaDefault === k ? " selected" : ""}>${escapeHtml(ESCALAS[k].rotulo)}</option>`).join("");
  const optAlt = `<option value=""${!r.alternancia ? " selected" : ""}>Selecione…</option>` +
    Object.keys(ALTERNANCIAS).map(k => `<option value="${k}"${r.alternancia === k ? " selected" : ""}>${escapeHtml(ALTERNANCIAS[k].rotulo)}</option>`).join("");
  const optTerr = ET_TERRITORIOS.map(x => `<option value="${escapeAttr(x)}"${r.tipoTerritorio === x ? " selected" : ""}>${escapeHtml(x)}</option>`).join("");

  // Calendário (checkbox por dia do mês). Abre pré-preenchido: dias já salvos, ou o
  // padrão da escala (plantonista → alternância; diarista → Seg a Sex).
  const marcados = (Array.isArray(r.diasMarcados) && r.diasMarcados.length)
    ? new Set(r.diasMarcados.map(Number))
    : diasPadraoEscala(r.escala, r.alternancia);
  // Grade mensal alinhada por dia da semana (Seg→Dom). Células vazias antes do dia 1.
  const offsetCal = (new Date(2024, 4, 1).getDay() + 6) % 7; // 0 = Seg
  const optCal = Array.from({ length: offsetCal }, () => `<span class="etEdCalVazio" aria-hidden="true"></span>`).join("") +
    DIAS_MES.map(d =>
      `<label class="etEdCalDia"><input type="checkbox" class="etEdCalCheck" value="${d.data}"${marcados.has(Number(d.data)) ? " checked" : ""}>` +
      `<span class="etEdCalNum">${Number(d.data)}</span></label>`).join("");

  const ov = document.createElement("div");
  ov.className = "etModalOverlay";
  ov.id = "etEdicaoOverlay";
  ov.innerHTML = `
    <div class="etModalCard" role="dialog" aria-modal="true" aria-label="Editar escala do profissional">
      <div class="etModalHead">
        <div>
          <h3>Editar escala</h3>
          <p>${escapeHtml(r.nome)}</p>
        </div>
        <button type="button" class="etModalClose" data-et-ed-fechar aria-label="Fechar"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="etModalBody">
        <div class="etEdIdentidade">
          <span><b>Cargo:</b> ${escapeHtml(r.cargo || "—")}</span>
          <span><b>DSEI:</b> ${escapeHtml(r.dsei || "—")}</span>
        </div>
        <div class="etEdGrid">
          <label class="etEdField">
            <span>Lotação (Polo base)</span>
            <select class="etSelect" id="etEdPolo" data-ss-skip>${optPolo}</select>
            ${polosCanon.length ? "" : `<small class="etEdHint">Sem lotações cadastradas para este DSEI.</small>`}
          </label>
          <label class="etEdField">
            <span>UBSI (do DSEI)</span>
            <select class="etSelect" id="etEdUbsi" data-ss-skip>${optUbsi}</select>
            ${ubsis.length ? "" : `<small class="etEdHint">Nenhuma UBSI cadastrada para este DSEI.</small>`}
          </label>
          <label class="etEdField">
            <span>Escala</span>
            <select class="etSelect" id="etEdEscala" data-ss-skip>${optEscala}</select>
          </label>
          <label class="etEdField" id="etEdAltWrap">
            <span>Alternância <small class="etEdHint">(pré-preenche o calendário)</small></span>
            <select class="etSelect" id="etEdAlt" data-ss-skip>${optAlt}</select>
          </label>
          <div class="etEdField etEdCalWrap" id="etEdCalendarioWrap">
            <div class="etEdCalTopo">
              <span class="etEdCalTitulo"><i class="fa-solid fa-calendar-days" aria-hidden="true"></i> Dias trabalhados no mês</span>
              <span class="etEdCalCount"><b id="etEdCalTotal">0</b> dia(s) selecionado(s)</span>
            </div>
            <div class="etEdCalSemana"><span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span><span>Dom</span></div>
            <div class="etEdCalGrid">${optCal}</div>
          </div>
          <label class="etEdField" id="etEdTerrTipoWrap">
            <span>Tipo de território</span>
            <select class="etSelect" id="etEdTerrTipo" data-ss-skip>${optTerr}</select>
          </label>
          <label class="etEdField" id="etEdIdaWrap">
            <span>Data de ida</span>
            <input class="etEdInput" id="etEdIda" type="text" placeholder="dd/mm/aaaa" value="${escapeAttr(r.ida || "")}">
          </label>
          <label class="etEdField" id="etEdRetornoWrap">
            <span>Data de retorno</span>
            <input class="etEdInput" id="etEdRetorno" type="text" placeholder="dd/mm/aaaa" value="${escapeAttr(r.retorno || "")}">
          </label>
        </div>
      </div>
      <div class="etModalFoot">
        <button type="button" class="etBtn etBtnGhost" data-et-ed-fechar>Cancelar</button>
        <button type="button" class="etBtn" data-et-ed-salvar><i class="fa-solid fa-check"></i> Salvar</button>
      </div>
    </div>`;
  document.body.appendChild(ov);

  const sel = id => ov.querySelector("#" + id);
  const mostrar = (el, on) => { if (el) el.style.display = on ? "" : "none"; };
  function atualizarCampos() {
    const esc = sel("etEdEscala").value;
    const plant = esc === "diurno" || esc === "noturno";
    const terr = esc === "territorio";
    const diar = esc === "diarista";
    const alt = sel("etEdAlt") ? sel("etEdAlt").value : "";
    // Alternância só para plantonista. O calendário só aparece depois de definida
    // a base do pré-preenchimento: escala diarista OU alternância no plantonista.
    mostrar(sel("etEdAltWrap"), plant);
    mostrar(sel("etEdCalendarioWrap"), diar || (plant && !!alt));
    mostrar(sel("etEdTerrTipoWrap"), terr);
    mostrar(sel("etEdIdaWrap"), terr);
    mostrar(sel("etEdRetornoWrap"), terr);
  }
  const atualizarTotalDias = () => {
    const el = sel("etEdCalTotal");
    if (el) el.textContent = String(ov.querySelectorAll(".etEdCalCheck:checked").length);
  };
  // Re-preenche o calendário conforme escala/alternância (ao trocar a seleção).
  const reprefill = () => {
    const esc = sel("etEdEscala").value;
    if (esc === "territorio") return;
    const alt = sel("etEdAlt") ? sel("etEdAlt").value : "";
    // Plantonista sem alternância escolhida: calendário oculto, nada a pré-preencher.
    if ((esc === "diurno" || esc === "noturno") && !alt) return;
    const set = diasPadraoEscala(esc, alt || "par");
    ov.querySelectorAll(".etEdCalCheck").forEach(c => { c.checked = set.has(Number(c.value)); });
    atualizarTotalDias();
  };
  atualizarCampos();
  atualizarTotalDias();
  sel("etEdEscala").addEventListener("change", () => { atualizarCampos(); reprefill(); });
  sel("etEdAlt").addEventListener("change", () => { atualizarCampos(); reprefill(); });
  ov.querySelector(".etEdCalGrid")?.addEventListener("change", atualizarTotalDias);

  ov.addEventListener("click", ev => {
    if (ev.target === ov || ev.target.closest("[data-et-ed-fechar]")) { fecharEdicaoEscala(); return; }
    if (ev.target.closest("[data-et-ed-salvar]")) salvarEdicaoEscala(r, ov);
  });
}

function salvarEdicaoEscala(r, ov) {
  const sel = id => ov.querySelector("#" + id);
  const esc = sel("etEdEscala").value;
  r.polo = sel("etEdPolo").value || "";
  r.ubsi = sel("etEdUbsi").value || "";
  r.escala = esc;
  r.semEscala = false;

  // situacao NÃO é editada aqui: é o status real do empregado (vem da view).
  if (esc === "territorio") {
    r.tipoTerritorio = sel("etEdTerrTipo").value || null;
    r.ida = sel("etEdIda").value.trim() || null;
    r.retorno = sel("etEdRetorno").value.trim() || null;
    r.alternancia = null;
    r.regime = null;
    r.diasMarcados = null;
  } else {
    // Diarista/plantonista: os dias trabalhados vêm SEMPRE do calendário.
    r.tipoTerritorio = null;
    r.ida = null;
    r.retorno = null;
    r.diasMarcados = [...ov.querySelectorAll(".etEdCalCheck:checked")].map(c => Number(c.value)).sort((a, b) => a - b);
    r.alternancia = (esc === "diurno" || esc === "noturno") ? (sel("etEdAlt").value || "par") : null;
    r.regime = null;
  }

  fecharEdicaoEscala();
  renderTudo();
  etToast(`Escala de ${r.nome} atualizada.`);
}
