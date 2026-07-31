import { CARGOS_FORA_PROCESSO_SELETIVO, VAGAS_TABELA_CONFIG } from "./constants.js";
import { filtrarRowsBase, getSelectedValues } from "./filtros.js";
import { calcularOciosas, calcularPreenchimento } from "./kpis.js";
import { pageLoadState } from "./runtime.js";
import { state } from "./state.js";
import { escapeAttr, escapeHtml, formatNumber, formatPercent, normalizarNomeCargo, setText, soma } from "./utils.js";
import { criarTabelaArrastavel } from "./tabela-arrastavel.js";

let configTabelaVagasInicializada = false;

// =========================================================
// Grades Tabulator das tabelas de Vagas (só colunas)
// =========================================================
// As 3 tabelas mantêm o pipeline existente (filtro → modo → busca → ordenação →
// paginação → TOTAL); só a RENDERIZAÇÃO virou Tabulator com colunas arrastáveis.
// Como o CONJUNTO de colunas muda conforme o modo (detalhado × agregado), a grade
// é recriada ao trocar de modo — assim a persistência de largura/ordem é por modo.
// Ordenação e paginação seguem EXTERNAS (clique no cabeçalho → ordenarTabelaVagas;
// botões → mudarPaginaVagas): só damos à grade a página atual + a linha TOTAL.
const gradesVagas = {}; // id -> { grade, modo }

// Marca a coluna ordenada no cabeçalho. O sortKey de cada coluna vem do mapa
// field→sortKey guardado por grade (não fica na def do Tabulator, que o rejeitaria).
// A seta é puramente visual; o sort é externo.
function marcarOrdenacaoVagas(grade) {
  const tabela = grade && grade.tabela;
  if (!tabela) return;
  const entrada = Object.values(gradesVagas).find(g => g.grade === grade);
  const sortKeys = (entrada && entrada.sortKeys) || {};
  const { key, direction } = state.vagasSortState || {};
  try {
    tabela.getColumns().forEach(col => {
      const sortKey = sortKeys[col.getField()];
      const el = col.getElement();
      if (!el) return;
      const ativo = !!sortKey && sortKey === key;
      el.classList.toggle("vagasOrdAsc", ativo && direction === "asc");
      el.classList.toggle("vagasOrdDesc", ativo && direction === "desc");
    });
  } catch { /* ainda construindo */ }
}

// Coluna ordenável: clique no cabeçalho ordena (externo). `sortKey` (custom) é a
// chave usada por ordenarTabelaVagas — pode diferir do field exibido (ex.: a
// distribuição mostra `normalTemporario` mas ordena por `distNormalTemp`).
function colVagas(title, field, sortKey, formatter, extra) {
  return { title, field, sortKey, headerClick: () => ordenarTabelaVagas(sortKey), formatter, ...(extra || {}) };
}

const fmtNumCel = c => formatNumber(c.getValue());
// Coluna "Total de Trabalhadores": mostra o total cheio (inclui admissões
// programadas) e, quando houver admissão programada na linha, um selo laranja no
// canto da célula com a QUANTIDADE. O card "Trabalhadores Contratados" já desconta
// essas admissões; o selo (+ tooltip, ver tooltipAdmProg) avisa que elas seguem
// contadas AQUI, no total.
const fmtTotalTrabCel = c => {
  const valor = formatNumber(c.getValue());
  const prog = Number((c.getRow().getData() || {}).admissaoProgramada || 0);
  if (prog <= 0) return valor;
  return `<span class="celTotalTrab">${valor}` +
    `<span class="celAdmProgBadge" aria-label="Admissão programada: ${prog}">${formatNumber(prog)}</span></span>`;
};

// Tooltip (balão do Tabulator, anexado ao body — não é cortado pela tabela) da
// coluna Total de Trabalhadores: só aparece quando há admissão programada na linha.
// Monta via DOM (sem HTML cru) para deixar o número em destaque.
function tooltipAdmProg(e, cell) {
  const prog = Number((cell.getRow().getData() || {}).admissaoProgramada || 0);
  if (prog <= 0) return false; // sem admissão programada → sem tooltip
  const box = document.createElement("div");
  box.className = "admProgTip";
  const titulo = document.createElement("strong");
  titulo.textContent = `Admissão Programada: ${formatNumber(prog)}`;
  const nota = document.createElement("span");
  nota.textContent = "Já contam neste Total de Trabalhadores, mas ficam de fora do card “Trabalhadores Contratados” (ainda não iniciaram).";
  box.append(titulo, nota);
  return box;
}
const fmtPctCel = c => formatPercent(c.getValue());
const fmtTextoCel = c => escapeHtml(c.getValue() == null ? "" : String(c.getValue()));
// Vagas Ociosas pode ser negativa (déficit) → realce vermelho como antes.
const fmtOciosasCel = c => {
  const v = Number(c.getValue() || 0);
  return `<span${v < 0 ? ' class="negativo"' : ""}>${formatNumber(v)}</span>`;
};

// Linha é "Cadastro Reserva" (CR): previsão >= 1, mas sem vaga p/ processo seletivo.
function ehCadastroReservaRow(row) {
  return Number(row.quantitativoPlano || 0) >= 1 &&
    Number(row.normalTemporario || 0) === 0 &&
    Number(row.contratadosTemporario || 0) === 0 &&
    Number(row.processoSeletivo || 0) === 0;
}

// Título da 1ª coluna no modo agregado.
const tituloPrimeira = () => (state.vagasViewAtual === "cargo" ? "Cargo" : "DSEI/CASAI");

function colunasVagasMain(view) {
  const num = (t, f) => colVagas(t, f, f, fmtNumCel, { hozAlign: "center", minWidth: 90 });
  const cols = [];
  if (view === "detalhado") {
    cols.push(colVagas("DSEI/CASAI", "dseiCasai", "dseiCasai", fmtTextoCel, { cssClass: "vagasTextoCol", minWidth: 140 }));
    cols.push(colVagas("Cargo", "cargo", "cargo", fmtTextoCel, { cssClass: "vagasTextoCol", minWidth: 160 }));
  } else {
    cols.push(colVagas(tituloPrimeira(), "label", "label", fmtTextoCel, { cssClass: "vagasTextoCol", minWidth: 180 }));
  }
  cols.push(num("Vagas previstas", "quantitativoPlano"));
  cols.push(colVagas("Total de Trabalhadores", "totalTrabalhadores", "totalTrabalhadores", fmtTotalTrabCel, { hozAlign: "center", minWidth: 90, cssClass: "colTotalTrab", tooltip: tooltipAdmProg }));
  cols.push(num("Afastados", "afastados"));
  cols.push(colVagas("Vagas Ociosas (Déficit Operacional)", "ociosas", "ociosas", fmtOciosasCel, { hozAlign: "center", minWidth: 120, cssClass: "colOciosas" }));
  cols.push(num("Trabalhadores Normais", "contratadosNormal"));
  cols.push(num("Substituições", "contratadosSubstituicao"));
  cols.push(num("Temporárias", "contratadosTemporario"));
  cols.push(colVagas("% preenchimento", "preenchimento", "preenchimento", fmtPctCel, { hozAlign: "center", minWidth: 90 }));
  return cols;
}

function colunasDistribuicao(view) {
  const cols = [];
  if (view === "detalhado") {
    cols.push(colVagas("DSEI/CASAI", "dseiCasai", "dseiCasai", fmtTextoCel, { cssClass: "vagasTextoCol", minWidth: 140 }));
    cols.push(colVagas("Cargo", "cargo", "cargo", fmtTextoCel, { cssClass: "vagasTextoCol", minWidth: 160 }));
  } else {
    cols.push(colVagas(tituloPrimeira(), "label", "label", fmtTextoCel, { cssClass: "vagasTextoCol", minWidth: 200 }));
  }
  cols.push(colVagas("Normais/Temporárias", "normalTemporario", "distNormalTemp", fmtNumCel, { hozAlign: "center", minWidth: 120 }));
  cols.push(colVagas("Afastamento sem substituição", "substituicaoTabela", "distSubstituicao", fmtNumCel, { hozAlign: "center", minWidth: 140 }));
  cols.push(colVagas("Vagas Ociosas", "vagasOciosas", "distOciosas", fmtNumCel, { hozAlign: "center", minWidth: 110 }));
  return cols;
}

function colunasProcesso(view) {
  const cols = [];
  if (view === "detalhado") {
    cols.push(colVagas("DSEI/CASAI", "dseiCasai", "dseiCasai", fmtTextoCel, { cssClass: "vagasTextoCol", minWidth: 140 }));
    cols.push(colVagas("Cargo", "cargo", "cargo", fmtTextoCel, { cssClass: "vagasTextoCol", minWidth: 160 }));
  } else {
    cols.push(colVagas(tituloPrimeira(), "label", "label", fmtTextoCel, { cssClass: "vagasTextoCol", minWidth: 200 }));
  }
  cols.push(colVagas("Vagas ociosas", "normalTemporario", "distNormalTemp", fmtNumCel, { hozAlign: "center", minWidth: 110 }));
  cols.push(colVagas("Temporárias", "contratadosTemporario", "distTemporario", fmtNumCel, { hozAlign: "center", minWidth: 110 }));
  cols.push(colVagas("Total Processo Seletivo", "processoSeletivo", "distProcessoSeletivo",
    c => { const r = c.getRow().getData(); return (!r._total && ehCadastroReservaRow(r)) ? "CR" : formatNumber(c.getValue()); },
    { hozAlign: "center", minWidth: 120 }));
  return cols;
}

// Recria a grade ao trocar de modo; senão reaproveita a existente.
function obterGradeVagas(id, modo, colunas, persistBase) {
  // Remove o sortKey (uso interno) das defs antes de entregar ao Tabulator — ele
  // avisaria "Invalid column definition option: sortKey". O clique no cabeçalho não
  // depende disso (o headerClick já captura o sortKey por closure); guardamos o mapa
  // field→sortKey só para o indicador de seta (marcarOrdenacaoVagas).
  const sortKeys = {};
  const colsLimpas = colunas.map(({ sortKey, ...resto }) => {
    if (sortKey != null && resto.field != null) sortKeys[resto.field] = sortKey;
    return resto;
  });

  let g = gradesVagas[id];
  if (g && g.modo !== modo) { g.grade.destruir(); g = null; }
  if (!g) {
    const grade = criarTabelaArrastavel({
      elemento: id,
      colunas: colsLimpas,
      persistID: `${persistBase}_${modo}`,
      indexField: "_key",
      // Arraste de linhas habilitado (reordenação ad-hoc p/ comparar lado a lado).
      // SEM ordemKey: a ordem é transitória — some ao filtrar/ordenar/paginar/trocar
      // modo, pois os dados são recalculados (ordenação é por coluna). Persistir a
      // ordem brigaria com o sort por cabeçalho, então fica só visual.
      movableRows: true,
      // Só linhas: mover COLUNAS fica desativado (a ordem das colunas é fixa).
      movableColumns: false,
      // Layout padrão do helper (fitDataStretch) + equalização: no 1º acesso as
      // colunas dividem a largura do container por IGUAL (cabem todas na tela, sem
      // sobrar vão à direita); se o usuário redimensionar e a soma ficar menor que o
      // container, a última coluna estica p/ preencher; se passar, rola na horizontal.
      // (Antes usava fitColumns, mas a largura persistida anulava o preenchimento e
      // deixava o enorme espaço vazio à direita.)
      vazio: "Sem dados para os filtros selecionados.",
      // Esqueleto ao trocar a visualização: mantém a "moldura" da tabela enquanto
      // remonta, dando a sensação de que só os dados mudaram (não a tabela inteira).
      esqueleto: true,
      aoFormatarLinha: row => { if (row.getData()._total) row.getElement().classList.add("vagasTotalRow"); }
    });
    g = gradesVagas[id] = { grade, modo, sortKeys };
  } else {
    g.sortKeys = sortKeys; // mesmo modo: mantém o mapa atualizado para as setas
  }
  return g.grade;
}

// Chave única por linha (Tabulator usa como index). TOTAL tem chave fixa.
function chaveLinhaVagas(row) {
  if (row._total) return "__total__";
  if (row.label != null) return `L:${row.label}`;
  return `D:${row.dseiCasai || ""}||${row.cargo || ""}`;
}
const comChave = linhas => linhas.map(r => ({ ...r, _key: chaveLinhaVagas(r) }));

// Mensagem de estado (carregando/erro) nas 3 grades. Só a tabela visível tem
// largura para montar e exibir o placeholder; as ocultas montam ao serem abertas.
function placeholderVagas(msg) {
  const view = state.vagasViewAtual;
  obterGradeVagas("vagasBody", view, colunasVagasMain(view), "vagasMainV3").render([], msg);
  obterGradeVagas("distribuicaoOciosasBody", view, colunasDistribuicao(view), "vagasDistV3").render([], msg);
  obterGradeVagas("processoSeletivoBody", view, colunasProcesso(view), "vagasProcV3").render([], msg);
}

export function renderVagasDaPagina() {
  if (!document.getElementById("vagasBody")) return;

  // Aplica título/subtítulo/aviso/export da tabela atual no primeiro render, já que
  // alterarTabelaVagas só roda ao clicar numa sub-aba. Sem isto, o aviso da tabela
  // padrão ("vagas") não aparece na primeira entrada na aba. Feito antes do retorno
  // de "carregando" para o aviso surgir mesmo enquanto os dados não chegaram.
  if (!configTabelaVagasInicializada) {
    configTabelaVagasInicializada = true;
    alterarTabelaVagas(state.vagasTabelaAtual);
  }

  if (!pageLoadState.vagas) {
    placeholderVagas("Carregando dados da aba Vagas...");
    const pagination = document.getElementById("vagasPagination");
    if (pagination) pagination.innerHTML = "";
    return;
  }

  state.vagasRows = montarVagas(filtrarRowsBase(state.vagasBaseRows));
  renderVagasTable(state.vagasRows);
  renderDistribuicaoVagasOciosas(state.vagasRows);
  renderProcessoSeletivo(state.vagasRows);
}

export function renderVagasErro(error) {
  if (!document.getElementById("vagasBody")) return;
  placeholderVagas(`Erro ao carregar Vagas: ${escapeHtml(error && error.message ? error.message : String(error))}`);
}

export function montarVagas(data) {
  return [...data]
    .map(row => {
      const ociosas = calcularOciosas(row);
      const preenchimento = calcularPreenchimento(row.quantitativoPlano, ociosas);
      // Valores das tabelas de distribuição/processo seletivo calculados POR LINHA
      // (negativos já zerados). São somados na agregação, então o total independe
      // de a visão ser por DSEI ou por Cargo.
      const dist = montarLinhaDistribuicaoBase({ ...row, ociosas });
      return {
        ...row,
        ociosas,
        preenchimento,
        distOciosas: dist.vagasOciosas,
        distSubstituicao: dist.substituicaoTabela,
        distNormalTemp: dist.normalTemporario,
        distTemporario: dist.contratadosTemporario,
        distProcessoSeletivo: dist.processoSeletivo
      };
    })
    .filter(row => !linhaVagasZerada(row))
    .sort((a, b) => {
      const d = String(a.dseiCasai || "").localeCompare(String(b.dseiCasai || ""));
      if (d !== 0) return d;

      return String(a.cargo || "").localeCompare(String(b.cargo || ""));
    });
}

// Preserva a rolagem da PÁGINA ao trocar a visualização/tabela de Vagas. A troca
// DESTRÓI e reconstrói a grade (o conjunto de colunas muda → build assíncrono do
// Tabulator): por um instante o container fica com altura ~0, o documento encolhe e
// o navegador "puxa" a rolagem pro topo. Fixamos a altura atual do cartão até a grade
// reassentar (2 frames) e reaplicamos o scrollY — mesma ideia usada em Processos
// Seletivos (renderDetalheMantendoScroll), para a tela ficar onde estava.
function renderVagasMantendoScroll(reRender) {
  const card = document.querySelector("#view-vagas .vagasInfoCard");
  const y = window.scrollY || window.pageYOffset || 0;
  const altura = card ? card.offsetHeight : 0;
  if (card && altura) card.style.minHeight = `${altura}px`;
  reRender();
  window.scrollTo(0, y);
  if (typeof requestAnimationFrame !== "function") { if (card) card.style.minHeight = ""; return; }
  requestAnimationFrame(() => {
    window.scrollTo(0, y);
    requestAnimationFrame(() => { if (card) card.style.minHeight = ""; window.scrollTo(0, y); });
  });
}

export function alterarVisualizacaoVagas(view) {
  state.vagasViewAtual = view || "dsei";
  state.vagasSortState = { key: state.vagasViewAtual === "detalhado" ? "dseiCasai" : "label", direction: "asc" };
  state.vagasCurrentPage = 1;
  renderVagasMantendoScroll(renderVagasDaPagina);
}

export function alterarTabelaVagas(tabela) {
  // Trocar de sub-tabela troca o bloco visível e re-renderiza a grade — preserva a
  // rolagem da página (mesma ideia da troca de visualização).
  renderVagasMantendoScroll(() => {
    state.vagasTabelaAtual = VAGAS_TABELA_CONFIG[tabela] ? tabela : "vagas";
    const cfg = VAGAS_TABELA_CONFIG[state.vagasTabelaAtual];

    document.querySelectorAll(".vagasTabelaTab").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.vagasTabela === state.vagasTabelaAtual);
    });

    Object.keys(VAGAS_TABELA_CONFIG).forEach(chave => {
      const el = document.getElementById(VAGAS_TABELA_CONFIG[chave].bloco);
      if (el) el.hidden = chave !== state.vagasTabelaAtual;
    });

    setText("vagasTituloDinamico", cfg.titulo);
    setText("vagasSubtituloDinamico", cfg.subtitulo);
    const exp = document.getElementById("vagasExportActions");
    if (exp) exp.innerHTML = cfg.exportHtml;
    const aviso = document.getElementById("vagasAvisoDinamico");
    if (aviso) aviso.innerHTML = cfg.avisoHtml;

    // A grade da tabela recém-exibida pode não ter montado enquanto o bloco estava
    // oculto (Tabulator precisa de largura). Re-renderiza a tabela ativa agora que
    // ficou visível. (Na 1ª chamada, em renderVagasDaPagina, os dados ainda não
    // chegaram e o guard abaixo evita render sem dados.)
    if (pageLoadState.vagas && state.vagasRows) {
      if (state.vagasTabelaAtual === "vagas") renderVagasTable(state.vagasRows);
      else if (state.vagasTabelaAtual === "ociosas") renderDistribuicaoVagasOciosas(state.vagasRows);
      else if (state.vagasTabelaAtual === "processo") renderProcessoSeletivo(state.vagasRows);
    }
  });
}

export function atualizarPesquisaVagas(valor) {
  state.vagasSearchTerm = String(valor || "").trim().toUpperCase();
  state.vagasCurrentPage = 1;
  renderVagasDaPagina();
}

export function ordenarTabelaVagas(key) {
  if (!key) return;
  if (state.vagasSortState.key === key) {
    state.vagasSortState.direction = state.vagasSortState.direction === "asc" ? "desc" : "asc";
  } else {
    // 1º clique numa coluna: maior → menor (decrescente).
    state.vagasSortState = { key, direction: "desc" };
  }
  renderVagasDaPagina();
}

export function obterRowsVagasPorVisualizacao(rows) {
  let linhas;

  if (state.vagasViewAtual === "dsei") {
    linhas = montarVagasAgrupadas(rows, "dseiCasai", "DSEI/CASAI");
  } else if (state.vagasViewAtual === "cargo") {
    linhas = montarVagasAgrupadas(rows, "cargo", "Cargo");
  } else {
    linhas = rows;
  }

  linhas = filtrarPesquisaVagas(linhas);
  return ordenarLinhasVagas(linhas);
}

export function montarVagasAgrupadas(rows, campo, labelCampo) {
  const mapa = new Map();

  rows.forEach(row => {
    const label = row[campo] || "Não informado";

    if (!mapa.has(label)) {
      mapa.set(label, {
        label,
        labelCampo,
        quantitativoPlano: 0,
        totalTrabalhadores: 0,
        admissaoProgramada: 0,
        afastados: 0,
        ociosas: 0,
        contratadosNormal: 0,
        contratadosSubstituicao: 0,
        contratadosTemporario: 0,
        preenchimento: 0,
        distOciosas: 0,
        distSubstituicao: 0,
        distNormalTemp: 0,
        distTemporario: 0,
        distProcessoSeletivo: 0
      });
    }

    const item = mapa.get(label);
    item.quantitativoPlano += Number(row.quantitativoPlano || 0);
    item.totalTrabalhadores += Number(row.totalTrabalhadores || 0);
    item.admissaoProgramada += Number(row.admissaoProgramada || 0);
    item.afastados += Number(row.afastados || 0);
    item.ociosas += Number(row.ociosas || 0);
    item.contratadosNormal += Number(row.contratadosNormal || 0);
    item.contratadosSubstituicao += Number(row.contratadosSubstituicao || 0);
    item.contratadosTemporario += Number(row.contratadosTemporario || 0);
    // Soma dos valores derivados por linha (já clampados) — total independe da visão.
    item.distOciosas += Number(row.distOciosas || 0);
    item.distSubstituicao += Number(row.distSubstituicao || 0);
    item.distNormalTemp += Number(row.distNormalTemp || 0);
    item.distTemporario += Number(row.distTemporario || 0);
    item.distProcessoSeletivo += Number(row.distProcessoSeletivo || 0);
  });

  return [...mapa.values()]
    .map(item => ({
      ...item,
      preenchimento: calcularPreenchimento(item.quantitativoPlano, item.ociosas)
    }))
    .sort((a, b) => String(a.label || "").localeCompare(String(b.label || "")));
}

// As colunas agora vivem no Tabulator (colunasVagasMain); aqui só mantemos o
// realce da aba de visualização ativa (DSEI / Cargo / Detalhado).
export function atualizarCabecalhoVagas() {
  document.querySelectorAll(".vagasTab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.vagasView === state.vagasViewAtual);
  });
}

export function renderVagasTable(rows) {
  if (!document.getElementById("vagasBody")) return;
  atualizarCabecalhoVagas();

  const pagination = document.getElementById("vagasPagination");
  const view = state.vagasViewAtual;
  const grade = obterGradeVagas("vagasBody", view, colunasVagasMain(view), "vagasMainV3");
  const linhas = obterRowsVagasPorVisualizacao(rows);

  if (!linhas.length) {
    grade.render([], "Sem dados para os filtros selecionados.");
    marcarOrdenacaoVagas(grade);
    if (pagination) pagination.innerHTML = "";
    return;
  }

  const { linhasPagina, resumoPaginacao } = obterPaginaVagas(linhas);
  const totalRow = calcularTotalVagasTabela(linhasPagina);

  // Linha TOTAL como dado (flag _total): formatters renderizam; a classe
  // vagasTotalRow (via aoFormatarLinha) dá o visual da linha de total.
  const totalLinha = { _total: true };
  if (view === "detalhado") {
    totalLinha.dseiCasai = "TOTAL";
    totalLinha.cargo = `${formatNumber(linhasPagina.length)} registro(s)`;
  } else {
    totalLinha.label = "TOTAL";
  }
  Object.assign(totalLinha, {
    quantitativoPlano: totalRow.quantitativoPlano,
    totalTrabalhadores: totalRow.totalTrabalhadores,
    admissaoProgramada: totalRow.admissaoProgramada,
    afastados: totalRow.afastados,
    ociosas: totalRow.ociosas,
    contratadosNormal: totalRow.contratadosNormal,
    contratadosSubstituicao: totalRow.contratadosSubstituicao,
    contratadosTemporario: totalRow.contratadosTemporario,
    preenchimento: totalRow.preenchimento
  });

  grade.render(comChave([...linhasPagina, totalLinha]));
  marcarOrdenacaoVagas(grade);
  if (pagination) pagination.innerHTML = resumoPaginacao;
}

export function calcularTotalVagasTabela(linhas) {
  const total = linhas.reduce((acc, row) => {
    acc.quantitativoPlano += Number(row.quantitativoPlano || 0);
    acc.totalTrabalhadores += Number(row.totalTrabalhadores || 0);
    acc.admissaoProgramada += Number(row.admissaoProgramada || 0);
    acc.afastados += Number(row.afastados || 0);
    acc.ociosas += Number(row.ociosas || 0);
    acc.contratadosNormal += Number(row.contratadosNormal || 0);
    acc.contratadosSubstituicao += Number(row.contratadosSubstituicao || 0);
    acc.contratadosTemporario += Number(row.contratadosTemporario || 0);
    return acc;
  }, {
    quantitativoPlano: 0,
    totalTrabalhadores: 0,
    admissaoProgramada: 0,
    afastados: 0,
    ociosas: 0,
    contratadosNormal: 0,
    contratadosSubstituicao: 0,
    contratadosTemporario: 0,
    preenchimento: 0
  });

  total.preenchimento = calcularPreenchimento(total.quantitativoPlano, total.ociosas);
  return total;
}

// Colunas no Tabulator (colunasDistribuicao); aqui só atualizamos a descrição.
export function atualizarCabecalhoDistribuicaoVagasOciosas() {
  const descricao = document.getElementById("distribuicaoDescricao");
  if (!descricao) return;
  descricao.textContent = state.vagasViewAtual === "detalhado"
    ? "Composição das vagas ociosas por DSEI/CASAI e cargo nos filtros selecionados."
    : state.vagasViewAtual === "cargo"
      ? "Composição das vagas ociosas por cargo nos filtros selecionados."
      : "Composição das vagas ociosas por DSEI/CASAI nos filtros selecionados.";
}

export function filtrarCargosProcessoSeletivo(rows) {
  return (rows || []).filter(row => !CARGOS_FORA_PROCESSO_SELETIVO.has(normalizarNomeCargo(row.cargo)));
}

// Unifica os cargos (ART) com seus equivalentes base para que sejam somados
// em uma única linha na tabela de Vagas para Processo Seletivo.
const CARGOS_UNIFICAR_ART = ["ENFERMEIRO", "FARMACEUTICO"];

export function unificarCargosArt(rows) {
  const ehCargoUnificado = cargo => {
    const normalizado = normalizarNomeCargo(cargo);
    return CARGOS_UNIFICAR_ART.some(nome => normalizado.startsWith(nome));
  };

  const renomeadas = (rows || []).map(row => {
    const normalizado = normalizarNomeCargo(row.cargo);
    const base = CARGOS_UNIFICAR_ART.find(nome => normalizado.startsWith(nome));
    return base ? { ...row, cargo: base } : row;
  });

  // Após renomear, soma linhas que passaram a ter o mesmo DSEI/CASAI + cargo
  // (ex.: ENFERMEIRO e ENFERMEIRO (ART) no mesmo DSEI) em uma só.
  const mapa = new Map();
  renomeadas.forEach(row => {
    const chave = `${row.dseiCasai || ""}||${row.cargo || ""}`;
    if (!mapa.has(chave)) {
      mapa.set(chave, { ...row });
      return;
    }
    const acumulado = mapa.get(chave);
    Object.keys(row).forEach(campo => {
      if (typeof row[campo] === "number") {
        acumulado[campo] = Number(acumulado[campo] || 0) + Number(row[campo] || 0);
      }
    });
  });

  // Para os cargos unificados (normal + ART são o MESMO cargo), recalcula a
  // distribuição a partir dos quantitativos brutos somados. Assim os excedentes
  // (negativos) de uma variante abatem as vagas da outra, em vez de cada linha
  // ser zerada isoladamente antes da soma.
  return [...mapa.values()].map(row => {
    if (!ehCargoUnificado(row.cargo)) return row;
    const dist = montarLinhaDistribuicaoBase(row);
    return {
      ...row,
      distOciosas: dist.vagasOciosas,
      distSubstituicao: dist.substituicaoTabela,
      distNormalTemp: dist.normalTemporario,
      distTemporario: dist.contratadosTemporario,
      distProcessoSeletivo: dist.processoSeletivo
    };
  });
}

export function montarLinhaDistribuicaoBase(row) {
  // Zera negativos por linha: um excedente (valor negativo) nunca abate os positivos.
  const afastados = Math.max(0, Number(row.afastados || 0));
  const substituicoesContratadas = Math.max(0, Number(row.contratadosSubstituicao || 0));
  const contratadosTemporario = Math.max(0, Number(row.contratadosTemporario || 0));
  const contratadosNormal = Math.max(0, Number(row.contratadosNormal || 0));
  const quantitativoPlano = Math.max(0, Number(row.quantitativoPlano || 0));

  // Vagas não ocupadas = vagas previstas - (contratados normais + contratados temporários).
  const normalTemporario = Math.max(0, quantitativoPlano - (contratadosNormal + contratadosTemporario));

  // Substituição = afastados ainda não cobertos por substitutos.
  const substituicaoTabela = Math.max(0, afastados - substituicoesContratadas);

  // Vagas Ociosas = soma das duas colunas anteriores (sem negativos abatendo positivos).
  const vagasOciosas = normalTemporario + substituicaoTabela;

  // Total para processo seletivo = Vagas não ocupadas + Temporárias.
  const processoSeletivo = normalTemporario + contratadosTemporario;

  return {
    vagasOciosas,
    substituicaoTabela,
    normalTemporario,
    substituicoesContratadas,
    contratadosTemporario,
    processoSeletivo
  };
}

export function valoresDistribuicao(row) {
  return {
    vagasOciosas: Number(row.distOciosas || 0),
    substituicaoTabela: Number(row.distSubstituicao || 0),
    normalTemporario: Number(row.distNormalTemp || 0),
    contratadosTemporario: Number(row.distTemporario || 0),
    processoSeletivo: Number(row.distProcessoSeletivo || 0)
  };
}

export function montarDistribuicaoVagasOciosas(rows) {
  const linhasBase = obterRowsVagasPorVisualizacao(rows);
  const { linhasPagina } = obterPaginaVagas(linhasBase);

  if (state.vagasViewAtual === "detalhado") {
    return linhasPagina.map(row => ({
      dseiCasai: row.dseiCasai || "Não informado",
      cargo: row.cargo || "Não informado",
      quantitativoPlano: Number(row.quantitativoPlano || 0),
      ...valoresDistribuicao(row)
    }));
  }

  return linhasPagina.map(row => ({
    label: row.label || "Não informado",
    quantitativoPlano: Number(row.quantitativoPlano || 0),
    ...valoresDistribuicao(row)
  }));
}

export function renderDistribuicaoVagasOciosas(rows) {
  if (!document.getElementById("distribuicaoOciosasBody")) return;

  // Unifica os cargos (ART) com o cargo base antes de agrupar/paginar.
  rows = unificarCargosArt(rows);

  atualizarCabecalhoDistribuicaoVagasOciosas();
  renderPaginacaoTabela("distribuicaoPagination", rows);

  const view = state.vagasViewAtual;
  const grade = obterGradeVagas("distribuicaoOciosasBody", view, colunasDistribuicao(view), "vagasDistV3");
  const linhas = montarDistribuicaoVagasOciosas(rows).filter(item => {
    return Number(item.vagasOciosas || 0) !== 0 ||
      Number(item.substituicaoTabela || 0) !== 0 ||
      Number(item.normalTemporario || 0) !== 0;
  });

  if (!linhas.length) {
    grade.render([], "Sem dados para os filtros selecionados.");
    marcarOrdenacaoVagas(grade);
    return;
  }

  const total = linhas.reduce((acc, row) => {
    acc.vagasOciosas += Number(row.vagasOciosas || 0);
    acc.substituicaoTabela += Number(row.substituicaoTabela || 0);
    acc.normalTemporario += Number(row.normalTemporario || 0);
    return acc;
  }, { vagasOciosas: 0, substituicaoTabela: 0, normalTemporario: 0 });

  const totalLinha = { _total: true, ...total };
  if (view === "detalhado") { totalLinha.dseiCasai = "TOTAL"; totalLinha.cargo = ""; }
  else totalLinha.label = "TOTAL";

  grade.render(comChave([...linhas, totalLinha]));
  marcarOrdenacaoVagas(grade);
}

// Colunas no Tabulator (colunasProcesso); aqui só atualizamos a descrição.
export function atualizarCabecalhoProcessoSeletivo() {
  const descricao = document.getElementById("processoSeletivoDescricao");
  if (!descricao) return;
  descricao.textContent = state.vagasViewAtual === "detalhado"
    ? "Vagas para processo seletivo por DSEI/CASAI e cargo nos filtros selecionados."
    : state.vagasViewAtual === "cargo"
      ? "Vagas ociosas somadas às temporárias (total para processo seletivo) por cargo."
      : "Vagas ociosas somadas às temporárias (total para processo seletivo) por DSEI/CASAI.";
}

export function renderProcessoSeletivo(rows) {
  if (!document.getElementById("processoSeletivoBody")) return;

  // Unifica os cargos (ART) com o cargo base antes de agrupar/paginar.
  rows = unificarCargosArt(rows);

  atualizarCabecalhoProcessoSeletivo();
  renderPaginacaoTabela("processoSeletivoPagination", rows);

  const view = state.vagasViewAtual;
  const grade = obterGradeVagas("processoSeletivoBody", view, colunasProcesso(view), "vagasProcV3");
  // Mantém as linhas com movimento de processo seletivo E, também, as que têm
  // previsão de pelo menos 1 vaga no DSEI mas sem vaga ociosa (cargo totalmente
  // preenchido). Estas últimas entram com 0 nas colunas e "CR" (Cadastro Reserva)
  // na coluna "Total Processo Seletivo" (formatter da coluna trata o "CR").
  const linhas = montarDistribuicaoVagasOciosas(filtrarCargosProcessoSeletivo(rows)).filter(item => {
    return Number(item.normalTemporario || 0) !== 0 ||
      Number(item.contratadosTemporario || 0) !== 0 ||
      Number(item.processoSeletivo || 0) !== 0 ||
      Number(item.quantitativoPlano || 0) >= 1;
  });

  if (!linhas.length) {
    grade.render([], "Sem dados para os filtros selecionados.");
    marcarOrdenacaoVagas(grade);
    return;
  }

  const total = linhas.reduce((acc, row) => {
    acc.normalTemporario += Number(row.normalTemporario || 0);
    acc.contratadosTemporario += Number(row.contratadosTemporario || 0);
    acc.processoSeletivo += Number(row.processoSeletivo || 0);
    return acc;
  }, { normalTemporario: 0, contratadosTemporario: 0, processoSeletivo: 0 });

  const totalLinha = { _total: true, ...total };
  if (view === "detalhado") { totalLinha.dseiCasai = "TOTAL"; totalLinha.cargo = ""; }
  else totalLinha.label = "TOTAL";

  grade.render(comChave([...linhas, totalLinha]));
  marcarOrdenacaoVagas(grade);
}

export function mudarPaginaVagas(delta) {
  state.vagasCurrentPage = Math.max(1, state.vagasCurrentPage + Number(delta || 0));
  // As três tabelas compartilham a mesma página (mesmo grupo de DSEI),
  // então navegam juntas.
  renderVagasTable(state.vagasRows);
  renderDistribuicaoVagasOciosas(state.vagasRows);
  renderProcessoSeletivo(state.vagasRows);
}

// Há pesquisa ou filtro (DSEI/cargo/gráfico) ativo? Usado para, no detalhamento
// completo, mostrar todos os DSEIs juntos em vez de paginar um DSEI por página.
export function vagasComFiltroOuPesquisaAtivos() {
  if (state.vagasSearchTerm) return true;
  if (getSelectedValues("fDsei").length) return true;
  if (getSelectedValues("fCargo").length) return true;
  if (state.activeChartFilter) return true;
  return false;
}

export function obterPaginaVagas(linhas) {
  // Sem detalhamento, ou com pesquisa/filtro ativo: lista completa com rolagem.
  if (state.vagasViewAtual !== "detalhado" || vagasComFiltroOuPesquisaAtivos()) {
    return {
      linhasPagina: linhas,
      resumoPaginacao: `<span>Exibindo ${formatNumber(linhas.length)} registro(s) com rolagem.</span>`
    };
  }

  const grupos = [...new Set(linhas.map(row => row.dseiCasai).filter(Boolean))];
  const totalPaginas = Math.max(1, grupos.length);
  state.vagasCurrentPage = Math.min(Math.max(1, state.vagasCurrentPage), totalPaginas);
  const grupoAtual = grupos[state.vagasCurrentPage - 1] || "";
  const linhasPagina = linhas.filter(row => String(row.dseiCasai || "") === String(grupoAtual || ""));

  // Texto do indicador central. Vai num span de largura fixa com reticências,
  // para o nome variável do DSEI não empurrar os botões (Anterior/Próxima ficam parados).
  const infoTexto = `Página ${formatNumber(state.vagasCurrentPage)} de ${formatNumber(totalPaginas)}${grupoAtual ? ` · ${grupoAtual}` : ""}`;

  return {
    linhasPagina,
    resumoPaginacao: `
          <button type="button" data-click="mudar-pagina-vagas" data-delta="-1" ${state.vagasCurrentPage <= 1 ? "disabled" : ""}>Anterior</button>
          <span class="tablePaginationInfo" title="${escapeAttr(infoTexto)}">${escapeHtml(infoTexto)}</span>
          <button type="button" data-click="mudar-pagina-vagas" data-delta="1" ${state.vagasCurrentPage >= totalPaginas ? "disabled" : ""}>Próxima</button>
        `
  };
}

export function renderPaginacaoTabela(elementId, rows) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const linhasBase = obterRowsVagasPorVisualizacao(rows);
  const { resumoPaginacao } = obterPaginaVagas(linhasBase);
  el.innerHTML = resumoPaginacao;
}

export function filtrarPesquisaVagas(linhas) {
  if (!state.vagasSearchTerm) return linhas;
  return linhas.filter(row => {
    const texto = [
      row.dseiCasai,
      row.cargo,
      row.label,
      row.quantitativoPlano,
      row.totalTrabalhadores,
      row.afastados,
      row.ociosas,
      row.contratadosSubstituicao,
      row.contratadosTemporario,
      formatPercent(row.preenchimento)
    ].join(" ").toUpperCase();
    return texto.includes(state.vagasSearchTerm);
  });
}

export function ordenarLinhasVagas(linhas) {
  const key = state.vagasSortState.key || (state.vagasViewAtual === "detalhado" ? "dseiCasai" : "label");
  const direction = state.vagasSortState.direction === "desc" ? -1 : 1;

  return [...linhas].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    const an = Number(av);
    const bn = Number(bv);

    if (!isNaN(an) && !isNaN(bn) && String(av).trim() !== "" && String(bv).trim() !== "") {
      return (an - bn) * direction;
    }

    return String(av || "").localeCompare(String(bv || ""), "pt-BR") * direction;
  });
}

export function linhaVagasZerada(row) {
  return [
    row.quantitativoPlano,
    row.totalTrabalhadores,
    row.afastados,
    row.ociosas,
    row.contratadosSubstituicao,
    row.contratadosTemporario
  ].every(valor => Number(valor || 0) === 0);
}
