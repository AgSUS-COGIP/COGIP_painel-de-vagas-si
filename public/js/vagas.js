import { filtrarRowsBase } from "./app.js";
import { CARGOS_FORA_PROCESSO_SELETIVO, VAGAS_TABELA_CONFIG } from "./constants.js";
import { getSelectedValues } from "./filtros.js";
import { calcularOciosas, calcularPreenchimento } from "./kpis.js";
import { pageLoadState } from "./runtime.js";
import { state } from "./state.js";
import { escapeAttr, escapeHtml, formatNumber, formatPercent, normalizarNomeCargo, setText, soma } from "./utils.js";

let configTabelaVagasInicializada = false;

export function renderVagasDaPagina() {
  const tbody = document.getElementById("vagasBody");
  const pagination = document.getElementById("vagasPagination");
  const distribuicaoBody = document.getElementById("distribuicaoOciosasBody");
  const processoSeletivoBody = document.getElementById("processoSeletivoBody");

  // Aplica título/subtítulo/aviso/export da tabela atual no primeiro render, já que
  // alterarTabelaVagas só roda ao clicar numa sub-aba. Sem isto, o aviso da tabela
  // padrão ("vagas") não aparece na primeira entrada na aba. Feito antes do retorno
  // de "carregando" para o aviso surgir mesmo enquanto os dados não chegaram.
  if (!configTabelaVagasInicializada) {
    configTabelaVagasInicializada = true;
    alterarTabelaVagas(state.vagasTabelaAtual);
  }

  if (!pageLoadState.vagas) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="9">Carregando dados da aba Vagas...</td></tr>';
    if (distribuicaoBody) distribuicaoBody.innerHTML = '<tr><td colspan="4">Carregando distribuição de vagas ociosas...</td></tr>';
    if (processoSeletivoBody) processoSeletivoBody.innerHTML = '<tr><td colspan="4">Carregando vagas para processo seletivo...</td></tr>';
    if (pagination) pagination.innerHTML = "";
    return;
  }

  state.vagasRows = montarVagas(filtrarRowsBase(state.vagasBaseRows));
  renderVagasTable(state.vagasRows);
  renderDistribuicaoVagasOciosas(state.vagasRows);
  renderProcessoSeletivo(state.vagasRows);
}

export function renderVagasErro(error) {
  const tbody = document.getElementById("vagasBody");
  if (tbody) tbody.innerHTML = `<tr><td colspan="9">Erro ao carregar Vagas: ${escapeHtml(error && error.message ? error.message : String(error))}</td></tr>`;
  const distribuicaoBody = document.getElementById("distribuicaoOciosasBody");
  if (distribuicaoBody) distribuicaoBody.innerHTML = `<tr><td colspan="4">Erro ao carregar distribuição: ${escapeHtml(error && error.message ? error.message : String(error))}</td></tr>`;
  const processoSeletivoBody = document.getElementById("processoSeletivoBody");
  if (processoSeletivoBody) processoSeletivoBody.innerHTML = `<tr><td colspan="4">Erro ao carregar processo seletivo: ${escapeHtml(error && error.message ? error.message : String(error))}</td></tr>`;
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

export function alterarVisualizacaoVagas(view) {
  state.vagasViewAtual = view || "dsei";
  state.vagasSortState = { key: state.vagasViewAtual === "detalhado" ? "dseiCasai" : "label", direction: "asc" };
  state.vagasCurrentPage = 1;
  renderVagasDaPagina();
}

export function alterarTabelaVagas(tabela) {
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
    state.vagasSortState = { key, direction: "asc" };
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

export function atualizarCabecalhoVagas() {
  const header = document.getElementById("vagasHeaderRow");
  const colgroup = document.getElementById("vagasColGroup");

  document.querySelectorAll(".vagasTab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.vagasView === state.vagasViewAtual);
  });

  if (!header || !colgroup) return;

  const th = (label, key) => {
    const ativo = state.vagasSortState.key === key;
    const classe = ativo ? (state.vagasSortState.direction === "asc" ? "sortAsc" : "sortDesc") : "";
    const extraClasse = key === "ociosas" ? " colOciosasHead" : "";
    return `<th class="sortable ${classe}${extraClasse}" data-click="ordenar-vagas" data-key="${escapeAttr(key)}">${label}</th>`;
  };

  if (state.vagasViewAtual === "detalhado") {
    colgroup.innerHTML = `
          <col style="width: 14%;">
          <col style="width: 18%;">
          <col style="width: 9%;">
          <col style="width: 10%;">
          <col style="width: 7%;">
          <col style="width: 11%;">
          <col style="width: 8%;">
          <col style="width: 9%;">
          <col style="width: 8%;">
          <col style="width: 6%;">
        `;

    header.innerHTML = `
          ${th("DSEI/CASAI", "dseiCasai")}
          ${th("Cargo", "cargo")}
          ${th("Vagas previstas", "quantitativoPlano")}
          ${th("Total de Trabalhadores", "totalTrabalhadores")}
          ${th("Afastados", "afastados")}
          ${th("Vagas Ociosas (Déficit Operacional)", "ociosas")}
          ${th("Normais", "contratadosNormal")}
          ${th("Substituições", "contratadosSubstituicao")}
          ${th("Temporárias", "contratadosTemporario")}
          ${th("% preenchimento", "preenchimento")}
        `;
    return;
  }

  const primeiraColuna = state.vagasViewAtual === "dsei" ? "DSEI/CASAI" : "Cargo";

  colgroup.innerHTML = `
        <col style="width: 22%;">
        <col style="width: 10%;">
        <col style="width: 12%;">
        <col style="width: 9%;">
        <col style="width: 13%;">
        <col style="width: 9%;">
        <col style="width: 9%;">
        <col style="width: 8%;">
        <col style="width: 8%;">
      `;

  header.innerHTML = `
        ${th(primeiraColuna, "label")}
        ${th("Vagas previstas", "quantitativoPlano")}
        ${th("Total de Trabalhadores", "totalTrabalhadores")}
        ${th("Afastados", "afastados")}
        ${th("Vagas Ociosas (Déficit Operacional)", "ociosas")}
        ${th("Normais", "contratadosNormal")}
        ${th("Substituições", "contratadosSubstituicao")}
        ${th("Temporárias", "contratadosTemporario")}
        ${th("% preenchimento", "preenchimento")}
      `;
}

export function renderVagasTable(rows) {
  const tbody = document.getElementById("vagasBody");
  const pagination = document.getElementById("vagasPagination");
  if (!tbody) return;

  atualizarCabecalhoVagas();

  const linhas = obterRowsVagasPorVisualizacao(rows);
  const totalColunas = state.vagasViewAtual === "detalhado" ? 10 : 9;

  if (!linhas.length) {
    tbody.innerHTML = `<tr><td colspan="${totalColunas}">Sem dados para os filtros selecionados.</td></tr>`;
    if (pagination) pagination.innerHTML = "";
    return;
  }

  const { linhasPagina, resumoPaginacao } = obterPaginaVagas(linhas);
  const totalRow = calcularTotalVagasTabela(linhasPagina);

  if (state.vagasViewAtual === "detalhado") {
    tbody.innerHTML = linhasPagina.map(row => `
          <tr>
            <td>${escapeHtml(row.dseiCasai)}</td>
            <td>${escapeHtml(row.cargo)}</td>
            <td>${formatNumber(row.quantitativoPlano)}</td>
            <td>${formatNumber(row.totalTrabalhadores)}</td>
            <td>${formatNumber(row.afastados)}</td>
            <td class="colOciosas ${Number(row.ociosas || 0) < 0 ? "negativo" : ""}">${formatNumber(row.ociosas)}</td>
            <td>${formatNumber(row.contratadosNormal)}</td>
            <td>${formatNumber(row.contratadosSubstituicao)}</td>
            <td>${formatNumber(row.contratadosTemporario)}</td>
            <td>${formatPercent(row.preenchimento)}</td>
          </tr>
        `).join("") + `
          <tr class="totalRow">
            <td>TOTAL</td>
            <td>${formatNumber(linhasPagina.length)} registro(s)</td>
            <td>${formatNumber(totalRow.quantitativoPlano)}</td>
            <td>${formatNumber(totalRow.totalTrabalhadores)}</td>
            <td>${formatNumber(totalRow.afastados)}</td>
            <td class="colOciosas ${Number(totalRow.ociosas || 0) < 0 ? "negativo" : ""}">${formatNumber(totalRow.ociosas)}</td>
            <td>${formatNumber(totalRow.contratadosNormal)}</td>
            <td>${formatNumber(totalRow.contratadosSubstituicao)}</td>
            <td>${formatNumber(totalRow.contratadosTemporario)}</td>
            <td>${formatPercent(totalRow.preenchimento)}</td>
          </tr>
        `;
  } else {
    tbody.innerHTML = linhasPagina.map(row => `
          <tr>
            <td>${escapeHtml(row.label)}</td>
            <td>${formatNumber(row.quantitativoPlano)}</td>
            <td>${formatNumber(row.totalTrabalhadores)}</td>
            <td>${formatNumber(row.afastados)}</td>
            <td class="colOciosas ${Number(row.ociosas || 0) < 0 ? "negativo" : ""}">${formatNumber(row.ociosas)}</td>
            <td>${formatNumber(row.contratadosNormal)}</td>
            <td>${formatNumber(row.contratadosSubstituicao)}</td>
            <td>${formatNumber(row.contratadosTemporario)}</td>
            <td>${formatPercent(row.preenchimento)}</td>
          </tr>
        `).join("") + `
          <tr class="totalRow">
            <td>TOTAL</td>
            <td>${formatNumber(totalRow.quantitativoPlano)}</td>
            <td>${formatNumber(totalRow.totalTrabalhadores)}</td>
            <td>${formatNumber(totalRow.afastados)}</td>
            <td class="colOciosas ${Number(totalRow.ociosas || 0) < 0 ? "negativo" : ""}">${formatNumber(totalRow.ociosas)}</td>
            <td>${formatNumber(totalRow.contratadosNormal)}</td>
            <td>${formatNumber(totalRow.contratadosSubstituicao)}</td>
            <td>${formatNumber(totalRow.contratadosTemporario)}</td>
            <td>${formatPercent(totalRow.preenchimento)}</td>
          </tr>
        `;
  }

  if (pagination) {
    pagination.innerHTML = resumoPaginacao;
  }
}

export function calcularTotalVagasTabela(linhas) {
  const total = linhas.reduce((acc, row) => {
    acc.quantitativoPlano += Number(row.quantitativoPlano || 0);
    acc.totalTrabalhadores += Number(row.totalTrabalhadores || 0);
    acc.afastados += Number(row.afastados || 0);
    acc.ociosas += Number(row.ociosas || 0);
    acc.contratadosNormal += Number(row.contratadosNormal || 0);
    acc.contratadosSubstituicao += Number(row.contratadosSubstituicao || 0);
    acc.contratadosTemporario += Number(row.contratadosTemporario || 0);
    return acc;
  }, {
    quantitativoPlano: 0,
    totalTrabalhadores: 0,
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

export function atualizarCabecalhoDistribuicaoVagasOciosas() {
  const header = document.getElementById("distribuicaoHeaderRow");
  const colgroup = document.getElementById("distribuicaoColGroup");
  const descricao = document.getElementById("distribuicaoDescricao");
  if (!header || !colgroup) return;

  if (state.vagasViewAtual === "detalhado") {
    colgroup.innerHTML = `
          <col style="width: 24%;">
          <col style="width: 28%;">
          <col style="width: 16%;">
          <col style="width: 16%;">
          <col style="width: 16%;">
        `;
    header.innerHTML = `
          <th>DSEI/CASAI</th>
          <th>Cargo</th>
          <th>Normais/Temporárias</th>
          <th>Afastamento sem substituição</th>
          <th>Vagas Ociosas</th>
        `;
    if (descricao) descricao.textContent = "Composição das vagas ociosas por DSEI/CASAI e cargo nos filtros selecionados.";
    return;
  }

  const primeiraColuna = state.vagasViewAtual === "cargo" ? "Cargo" : "DSEI/CASAI";
  colgroup.innerHTML = `
        <col style="width: 40%;">
        <col style="width: 20%;">
        <col style="width: 20%;">
        <col style="width: 20%;">
      `;
  header.innerHTML = `
        <th>${primeiraColuna}</th>
        <th>Normais/Temporárias</th>
        <th>Afastamento sem substituição</th>
        <th>Vagas Ociosas</th>
      `;
  if (descricao) {
    descricao.textContent = state.vagasViewAtual === "cargo"
      ? "Composição das vagas ociosas por cargo nos filtros selecionados."
      : "Composição das vagas ociosas por DSEI/CASAI nos filtros selecionados.";
  }
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
      ...valoresDistribuicao(row)
    }));
  }

  return linhasPagina.map(row => ({
    label: row.label || "Não informado",
    ...valoresDistribuicao(row)
  }));
}

export function renderDistribuicaoVagasOciosas(rows) {
  const tbody = document.getElementById("distribuicaoOciosasBody");
  if (!tbody) return;

  // Unifica os cargos (ART) com o cargo base antes de agrupar/paginar.
  rows = unificarCargosArt(rows);

  atualizarCabecalhoDistribuicaoVagasOciosas();
  renderPaginacaoTabela("distribuicaoPagination", rows);
  const linhas = montarDistribuicaoVagasOciosas(rows).filter(item => {
    return Number(item.vagasOciosas || 0) !== 0 ||
      Number(item.substituicaoTabela || 0) !== 0 ||
      Number(item.normalTemporario || 0) !== 0;
  });

  const totalColunas = state.vagasViewAtual === "detalhado" ? 5 : 4;
  if (!linhas.length) {
    tbody.innerHTML = `<tr><td colspan="${totalColunas}" class="remanejamentoEmpty">Sem dados para os filtros selecionados.</td></tr>`;
    return;
  }

  const total = linhas.reduce((acc, row) => {
    acc.vagasOciosas += Number(row.vagasOciosas || 0);
    acc.substituicaoTabela += Number(row.substituicaoTabela || 0);
    acc.normalTemporario += Number(row.normalTemporario || 0);
    return acc;
  }, { vagasOciosas: 0, substituicaoTabela: 0, normalTemporario: 0 });

  if (state.vagasViewAtual === "detalhado") {
    tbody.innerHTML = linhas.map(row => `
          <tr>
            <td>${escapeHtml(row.dseiCasai)}</td>
            <td>${escapeHtml(row.cargo)}</td>
            <td>${formatNumber(row.normalTemporario)}</td>
            <td>${formatNumber(row.substituicaoTabela)}</td>
            <td>${formatNumber(row.vagasOciosas)}</td>
          </tr>
        `).join("") + `
          <tr class="totalRow">
            <td colspan="2">TOTAL</td>
            <td>${formatNumber(total.normalTemporario)}</td>
            <td>${formatNumber(total.substituicaoTabela)}</td>
            <td>${formatNumber(total.vagasOciosas)}</td>
          </tr>
        `;
    return;
  }

  tbody.innerHTML = linhas.map(row => `
        <tr>
          <td>${escapeHtml(row.label)}</td>
          <td>${formatNumber(row.normalTemporario)}</td>
          <td>${formatNumber(row.substituicaoTabela)}</td>
          <td>${formatNumber(row.vagasOciosas)}</td>
        </tr>
      `).join("") + `
        <tr class="totalRow">
          <td>TOTAL</td>
          <td>${formatNumber(total.normalTemporario)}</td>
          <td>${formatNumber(total.substituicaoTabela)}</td>
          <td>${formatNumber(total.vagasOciosas)}</td>
        </tr>
      `;
}

export function atualizarCabecalhoProcessoSeletivo() {
  const header = document.getElementById("processoSeletivoHeaderRow");
  const colgroup = document.getElementById("processoSeletivoColGroup");
  const descricao = document.getElementById("processoSeletivoDescricao");
  if (!header || !colgroup) return;

  if (state.vagasViewAtual === "detalhado") {
    colgroup.innerHTML = `
          <col style="width: 24%;">
          <col style="width: 28%;">
          <col style="width: 16%;">
          <col style="width: 16%;">
          <col style="width: 16%;">
        `;
    header.innerHTML = `
          <th>DSEI/CASAI</th>
          <th>Cargo</th>
          <th>Normais</th>
          <th>Temporárias</th>
          <th>Total Processo Seletivo</th>
        `;
    if (descricao) descricao.textContent = "Vagas para processo seletivo por DSEI/CASAI e cargo nos filtros selecionados.";
    return;
  }

  const primeiraColuna = state.vagasViewAtual === "cargo" ? "Cargo" : "DSEI/CASAI";
  colgroup.innerHTML = `
        <col style="width: 40%;">
        <col style="width: 20%;">
        <col style="width: 20%;">
        <col style="width: 20%;">
      `;
  header.innerHTML = `
        <th>${primeiraColuna}</th>
        <th>Normais</th>
        <th>Temporárias</th>
        <th>Total Processo Seletivo</th>
      `;
  if (descricao) {
    descricao.textContent = state.vagasViewAtual === "cargo"
      ? "Normais somado às temporárias (total para processo seletivo) por cargo."
      : "Normais somado às temporárias (total para processo seletivo) por DSEI/CASAI.";
  }
}

export function renderProcessoSeletivo(rows) {
  const tbody = document.getElementById("processoSeletivoBody");
  if (!tbody) return;

  // Unifica os cargos (ART) com o cargo base antes de agrupar/paginar.
  rows = unificarCargosArt(rows);

  atualizarCabecalhoProcessoSeletivo();
  renderPaginacaoTabela("processoSeletivoPagination", rows);
  // Exclui os cargos que não passam por processo seletivo (antes da agregação).
  const linhas = montarDistribuicaoVagasOciosas(filtrarCargosProcessoSeletivo(rows)).filter(item => {
    return Number(item.normalTemporario || 0) !== 0 ||
      Number(item.contratadosTemporario || 0) !== 0 ||
      Number(item.processoSeletivo || 0) !== 0;
  });

  const totalColunas = state.vagasViewAtual === "detalhado" ? 5 : 4;
  if (!linhas.length) {
    tbody.innerHTML = `<tr><td colspan="${totalColunas}" class="remanejamentoEmpty">Sem dados para os filtros selecionados.</td></tr>`;
    return;
  }

  const total = linhas.reduce((acc, row) => {
    acc.normalTemporario += Number(row.normalTemporario || 0);
    acc.contratadosTemporario += Number(row.contratadosTemporario || 0);
    acc.processoSeletivo += Number(row.processoSeletivo || 0);
    return acc;
  }, { normalTemporario: 0, contratadosTemporario: 0, processoSeletivo: 0 });

  if (state.vagasViewAtual === "detalhado") {
    tbody.innerHTML = linhas.map(row => `
          <tr>
            <td>${escapeHtml(row.dseiCasai)}</td>
            <td>${escapeHtml(row.cargo)}</td>
            <td>${formatNumber(row.normalTemporario)}</td>
            <td>${formatNumber(row.contratadosTemporario)}</td>
            <td>${formatNumber(row.processoSeletivo)}</td>
          </tr>
        `).join("") + `
          <tr class="totalRow">
            <td colspan="2">TOTAL</td>
            <td>${formatNumber(total.normalTemporario)}</td>
            <td>${formatNumber(total.contratadosTemporario)}</td>
            <td>${formatNumber(total.processoSeletivo)}</td>
          </tr>
        `;
    return;
  }

  tbody.innerHTML = linhas.map(row => `
        <tr>
          <td>${escapeHtml(row.label)}</td>
          <td>${formatNumber(row.normalTemporario)}</td>
          <td>${formatNumber(row.contratadosTemporario)}</td>
          <td>${formatNumber(row.processoSeletivo)}</td>
        </tr>
      `).join("") + `
        <tr class="totalRow">
          <td>TOTAL</td>
          <td>${formatNumber(total.normalTemporario)}</td>
          <td>${formatNumber(total.contratadosTemporario)}</td>
          <td>${formatNumber(total.processoSeletivo)}</td>
        </tr>
      `;
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

  return {
    linhasPagina,
    resumoPaginacao: `
          <button type="button" data-click="mudar-pagina-vagas" data-delta="-1" ${state.vagasCurrentPage <= 1 ? "disabled" : ""}>Anterior</button>
          <span>Página ${formatNumber(state.vagasCurrentPage)} de ${formatNumber(totalPaginas)}${grupoAtual ? ` · ${escapeHtml(grupoAtual)}` : ""}</span>
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

export function montarComposicaoOciosas(row) {
  return `
        <div class="composicaoOciosas">
          <div><strong>Vagas normais:</strong> ${formatNumber(row.quantitativoPlano)}</div>
          <div><strong>Substituições:</strong> ${formatNumber(row.contratadosSubstituicao)}</div>
          <div><strong>Temporárias:</strong> ${formatNumber(row.contratadosTemporario)}</div>
          <div><strong>Afastados:</strong> ${formatNumber(row.afastados)}</div>
          <div><strong>Saldo atual:</strong> ${formatNumber(row.ociosas)}</div>
        </div>
      `;
}
