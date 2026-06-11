import { renderBar, renderCardsOciosas, renderDoughnut, renderFunnelDsei, renderLegend, renderProgressBarResumo, renderTreemap } from "./charts.js";
import { COLORS } from "./constants.js";
import { deveUsarIndicadoresResumoBase } from "./filtros.js";
import { state } from "./state.js";
import { formatNumber, formatPercent, part, setText, soma } from "./utils.js";
import { montarLinhaDistribuicaoBase } from "./vagas.js";

export function calcularIndicadores(data) {
  const vagasPrevistas = soma(data, "quantitativoPlano");
  const contratadosCalculados = soma(data, "totalTrabalhadores");
  const afastados = soma(data, "afastados");
  const substituicoes = soma(data, "contratadosSubstituicao");
  const temporarios = soma(data, "contratadosTemporario");

  const contratados = deveUsarIndicadoresResumoBase() && state.indicadoresResumoBase
    ? Number(state.indicadoresResumoBase.contratados || 0)
    : contratadosCalculados;
  // Vagas ociosas (déficit operacional) = previstas - contratados + afastados.
  // Considera os negativos (excedente) abatendo — vale para todos os KPIs.
  const vagasOciosas = vagasPrevistas - contratados + afastados;
  // Vagas preenchidas = trabalhadores contratados (dado correto).
  const vagasPreenchidas = contratados;
  const vagasPreenchidasPerc = vagasPrevistas > 0
    ? (vagasPreenchidas / vagasPrevistas) * 100
    : 0;

  const coberturaAfastamentos = afastados > 0
    ? (substituicoes / afastados) * 100
    : 0;

  return {
    vagasPrevistas,
    contratados,
    afastados,
    substituicoes,
    temporarios,
    vagasOciosas,
    vagasPreenchidas,
    vagasPreenchidasPerc,
    coberturaAfastamentos,
    indigenas: soma(data, "contratadosIndigenas"),
    percentualIndigenas: part(soma(data, "contratadosIndigenas"), contratados)
  };
}

export function renderKpis(data) {
  const indicadores = calcularIndicadores(data);

  preencherKpiBloco("kpi", indicadores);
  preencherKpiBloco("vagasKpi", indicadores);
}

export function preencherKpiBloco(prefixo, indicadores) {
  setText(`${prefixo}VagasPrevistas`, formatNumber(indicadores.vagasPrevistas));
  setText(`${prefixo}Contratados`, formatNumber(indicadores.contratados));
  setText(`${prefixo}Ociosas`, formatNumber(indicadores.vagasOciosas));
  setText(`${prefixo}PreenchidasPerc`, formatPercent(indicadores.vagasPreenchidasPerc));
  setText(`${prefixo}PreenchidasSub`, `${formatNumber(indicadores.vagasPreenchidas)} de ${formatNumber(indicadores.vagasPrevistas)} vagas preenchidas`);
  setText(`${prefixo}Afastados`, formatNumber(indicadores.afastados));
  setText(`${prefixo}Substituicoes`, formatNumber(indicadores.substituicoes));
  setText(`${prefixo}Temporarios`, formatNumber(indicadores.temporarios));
  setText(`${prefixo}Cobertura`, formatPercent(indicadores.coberturaAfastamentos));
  setText(`${prefixo}CoberturaSub`, `${formatNumber(indicadores.substituicoes)} de ${formatNumber(indicadores.afastados)} afastamentos cobertos`);
}

export function renderGraficos(data) {
  const indicadores = calcularIndicadores(data);

  const topCategorias = topAgrupadoCalculado(data, "dseiCasai", row => Number(row.quantitativoPlano || 0), 5);
  renderFunnelDsei("funnelTopDsei", topCategorias.map(i => ({
    label: i.label,
    value: i.value
  })), "dsei");

  const preenchidas = Math.max(0, Number(indicadores.vagasPreenchidas || 0));
  const ociosas = Math.max(0, Number(indicadores.vagasOciosas || 0));
  renderProgressBarResumo({
    preenchidas,
    ociosas,
    vagasPrevistas: indicadores.vagasPrevistas,
    percentual: indicadores.vagasPreenchidasPerc
  });

  const indigenas = Number(indicadores.indigenas || 0);
  const totalTrabalhadores = Number(indicadores.contratados || 0);
  const demaisTrabalhadores = Math.max(0, totalTrabalhadores - indigenas);
  const percentualIndigenas = Number(indicadores.percentualIndigenas || 0);
  renderDoughnut("chartIndigenasGeral", {
    labels: ["Indígenas", "Demais"],
    values: [indigenas, demaisTrabalhadores],
    colors: [COLORS.green, COLORS.blue2],
    center: formatPercent(percentualIndigenas),
    centerSub: "INDÍGENAS",
    datalabelMin: 1,
    datalabelFontSize: 15,
    datalabelOffset: 12,
    cutout: "68%",
    radius: "90%",
    layoutPadding: { left: 18, right: 18, top: 18, bottom: 18 },
    centerFontSize: 19,
    centerSubFontSize: 12
  });
  renderLegend("legendIndigenasGeral", [
    ["Indígenas", indigenas, COLORS.green, part(indigenas, totalTrabalhadores)],
    ["Demais", demaisTrabalhadores, COLORS.blue2, part(demaisTrabalhadores, totalTrabalhadores)]
  ]);

  const normal = soma(data, "contratadosNormal");
  const substituicao = soma(data, "contratadosSubstituicao");
  const temporario = soma(data, "contratadosTemporario");
  const totalContratacao = normal + substituicao + temporario;
  renderDoughnut("chartTipo", {
    labels: ["Normal (Transição/PSS)", "Substituição", "Temporário"],
    values: [normal, substituicao, temporario],
    colors: [COLORS.blue, COLORS.orange, COLORS.green],
    center: formatNumber(totalContratacao),
    centerSub: "TOTAL",
    filterType: "tipo",
    filterValues: ["NORMAL", "SUBSTITUICAO", "TEMPORARIO"],
    datalabelMin: 0.4,
    datalabelFontSize: 15,
    datalabelOffset: function (context) {
      const index = context.dataIndex;
      if (index === 0) return 26;
      if (index === 1) return 16;
      return 14;
    },
    datalabelAlign: function (context) {
      const index = context.dataIndex;
      if (index === 0) return "left";
      if (index === 1) return "top";
      return "right";
    },
    datalabelAnchor: "end",
    cutout: "70%",
    radius: "84%",
    layoutPadding: { left: 78, right: 34, top: 28, bottom: 14 },
    centerFontSize: 20,
    centerSubFontSize: 12
  });
  renderLegend("legendTipo", [
    ["Normal (Transição/PSS)", normal, COLORS.blue, part(normal, totalContratacao)],
    ["Substituição", substituicao, COLORS.orange, part(substituicao, totalContratacao)],
    ["Temporário", temporario, COLORS.green, part(temporario, totalContratacao)]
  ]);

  const topDseiOciosas = topAgrupadoCalculado(data, "dseiCasai", row => calcularOciosas(row), 5);
  renderTreemap("chartTopDseiOciosas", {
    items: topDseiOciosas.map(i => ({ label: i.label, value: i.value })),
    filterType: "dsei"
  });

  const topCargoOciosas = topAgrupadoCalculado(data, "cargo", row => calcularOciosas(row), 5);
  renderBar("chartTopCargoOciosas", {
    labels: topCargoOciosas.map(i => i.label),
    values: topCargoOciosas.map(i => i.value),
    color: COLORS.purple,
    labelFontSize: 9.6,
    dataLabelFontSize: 10,
    xTickFontSize: 9.5,
    rightPadding: 44,
    wrapLabels: true,
    maxCharsPerLine: 24,
    maxLines: 5,
    yAxisWidth: 290
  });

  const cobertos = Math.min(Math.max(0, indicadores.substituicoes), Math.max(0, indicadores.afastados));
  const naoCobertos = Math.max(0, indicadores.afastados - cobertos);
  renderDoughnut("chartCoberturaAfastamentos", {
    labels: ["Cobertos", "Sem cobertura"],
    values: [cobertos, naoCobertos],
    colors: [COLORS.blue, COLORS.orange],
    center: formatPercent(indicadores.coberturaAfastamentos),
    centerSub: "COBERTURA",
    datalabelMin: 1,
    datalabelFontSize: 20,
    datalabelOffset: 12,
    cutout: "70%",
    radius: "90%",
    layoutPadding: { left: 34, right: 18, top: 20, bottom: 20 },
    centerFontSize: 18,
    centerSubFontSize: 12
  });
  renderLegend("legendCoberturaAfastamentos", [
    ["Cobertos", cobertos, COLORS.blue, part(cobertos, indicadores.afastados)],
    ["Sem cobertura", naoCobertos, COLORS.orange, part(naoCobertos, indicadores.afastados)]
  ]);

}

export function renderResumosExecutivos(data) {
  const indicadores = calcularIndicadores(data);
  setText("resumoCoberturaPercentual", formatPercent(indicadores.coberturaAfastamentos));
  setText("resumoCoberturaSubstituicoes", formatNumber(indicadores.substituicoes));
  setText("resumoCoberturaAfastados", formatNumber(indicadores.afastados));
  setText(
    "resumoCoberturaTexto",
    `${formatNumber(indicadores.substituicoes)} de ${formatNumber(indicadores.afastados)} afastamentos cobertos.`
  );
}

export function renderAlertasKpis(data) {
  const temporarios = soma(data, "qtdTemporarioAtivo");
  const afastamentos = soma(data, "afastados");
  const substituicoes = soma(data, "contratadosSubstituicao");
  const afastamentosSemSubstituto = Math.max(0, afastamentos - substituicoes);
  // Fonte de verdade: colunas já calculadas na view (consolidação RT incluída).
  const rtExcedente = soma(data, "qtdVagasArtExcedentes");
  const excedentes = soma(data, "qtdVagasExcedentes");

  setText("alertaKpiTemporarios", formatNumber(temporarios));
  setText("alertaKpiAfastamentos", formatNumber(afastamentos));
  setText("alertaKpiRtExcedente", formatNumber(rtExcedente));
  setText("alertaKpiExcedentes", formatNumber(excedentes));
  setText("alertaKpiAfastamentosSemSubstituto", formatNumber(afastamentosSemSubstituto));
  setText(`alertaKpiAfastamentosSemSubstitutoSub`, `${formatNumber(afastamentosSemSubstituto)} de ${formatNumber(afastamentos)} afastamentos totais`);
}

export function topAgrupadoCalculado(data, groupField, calcFn, limit, labelFn) {
  const map = {};

  data.forEach(row => {
    const rawKey = groupField === "chaveRisco"
      ? `${row.dseiCasai || "Não informado"}|||${row.cargo || "Não informado"}`
      : (row[groupField] || "Não informado");

    const key = String(rawKey);
    const value = Number(calcFn(row) || 0);

    if (!map[key]) {
      map[key] = {
        label: labelFn ? labelFn(row) : key,
        value: 0
      };
    }

    map[key].value += value;
  });

  return Object.keys(map)
    .map(key => ({
      label: map[key].label,
      value: map[key].value
    }))
    .filter(row => row.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

export function calcularOciosas(row) {
  // A coluna "Vagas Ociosas (Déficit Operacional)" da tabela de Vagas PODE ser
  // negativa (excedente). Os demais quadros (distribuição/processo seletivo) zeram
  // os negativos por conta própria em montarLinhaDistribuicaoBase.
  if (row && row.vagasOciosas !== null && row.vagasOciosas !== undefined && row.vagasOciosas !== "") {
    return Number(row.vagasOciosas || 0);
  }

  if (row && row.ociosas !== null && row.ociosas !== undefined && row.ociosas !== "") {
    return Number(row.ociosas || 0);
  }

  const vagas = Number(row.quantitativoPlano || 0);
  const contratados = Number(row.totalTrabalhadores || 0);
  const afastados = Number(row.afastados || 0);
  return vagas - contratados + afastados;
}

export function calcularPreenchimento(vagas, ociosas) {
  const totalVagas = Number(vagas || 0);
  if (!totalVagas) return 0;
  return ((totalVagas - Number(ociosas || 0)) / totalVagas) * 100;
}
