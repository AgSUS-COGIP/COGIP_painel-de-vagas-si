require("dotenv").config();

const path = require("path");
const express = require("express");
const mysql = require("mysql2/promise");

const app = express();

const DASH_CONFIG = {
  TIMEZONE: "America/Sao_Paulo",
  LOGO_AGSUS_FILE: "/assets/images/Logo%20AgSUS%20sem%20fundo.png",
  BACKGROUND_FILE: "/assets/images/planodefundo.png",
  LOGO_COORDENACAO_FILE: "/assets/images/Logo%20COGIP.png",
  IMAGEM_INDIGENA_PAINEL_FILE: "/assets/images/upscalemedia-transformed.png",
  DASHBOARD_SAUDE_INDIGENA_URL: "https://datastudio.google.com/embed/reporting/19d10a18-1ed1-4e5f-87bf-6bb87c21b234/page/p_d9w2owdmfd",
  DB_SCHEMA: process.env.DB_SCHEMA || "u226895969_ugp",
  MONITORAMENTO_VIEW: process.env.MONITORAMENTO_VIEW || "VW_MONITORAMENTO_VAGAS_SAUDE_INDIGENA",
  REMANEJAMENTO_CADASTRO_VIEW: process.env.REMANEJAMENTO_CADASTRO_VIEW || "vw_remanejamento_vagas_cadastro",
  CACHE_MONITORAMENTO_KEY: "DASH_MONITORAMENTO_V1_MYSQL",
  CACHE_MONITORAMENTO_TOTAIS_KEY: "DASH_MONITORAMENTO_TOTAIS_V1_MYSQL",
  CACHE_REMANEJAMENTO_LISTA_KEY: "DASH_REMANEJAMENTO_LISTA_V1_MYSQL",
  CACHE_REMANEJAMENTO_CADASTRO_KEY: "DASH_REMANEJAMENTO_CADASTRO_V1_MYSQL",
  CACHE_SECONDS: Number(process.env.CACHE_SECONDS || 300)
};

const DASH_SQL = {
  MONITORAMENTO: `
    SELECT
      \`dsei_casai\`,
      \`cargo\`,
      \`quantitativo_plano_trabalho\`,
      \`total_contratados_geral\`,
      \`contratados_substituicao\`,
      \`contratados_temporario\`,
      \`contratados_normal\`,
      \`afastados\`,
      \`trabalhadores_situacao_normal\`,
      \`vagas_ociosas\`,
      \`alerta_afastamento_sem_substituto\`,
      \`qtd_afastamento_sem_substituto\`,
      \`alerta_temporario_ativo\`,
      \`qtd_temporario_ativo\`,
      \`alerta_vagas_excedentes\`,
      \`qtd_vagas_excedentes\`,
      \`alerta_vagas_art_excedentes\`,
      \`qtd_vagas_art_excedentes\`,
      \`contratados_indigenas\`
    FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.MONITORAMENTO_VIEW}\`
    ORDER BY \`dsei_casai\`, \`cargo\`
  `,
  MONITORAMENTO_TOTAIS: `
    SELECT
      SUM(\`total_contratados_geral\`) AS \`total_contratados_geral\`
    FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.MONITORAMENTO_VIEW}\`
  `,
  REMANEJAMENTO_LISTA: `
    SELECT
      \`id_remanejamento\`,
      DATE_FORMAT(\`criado_em\`, '%d/%m/%Y %H:%i:%s') AS \`data_criacao_formatada\`,
      \`origem_vaga\`,
      \`vaga_remanejada\`,
      \`destino_vaga\`,
      \`vaga_adicionada\`,
      \`quantidade_vaga_adicionada\`,
      \`numero_processo_sei\`,
      \`anexo_oficio_url\`,
      \`anexo_oficio_nome\`,
      \`inserido_por_email\`,
      \`atualizado_em_formatado\`
    FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.REMANEJAMENTO_CADASTRO_VIEW}\`
    ORDER BY \`criado_em\` DESC
  `,
  REMANEJAMENTO_CADASTRO: `
    SELECT
      \`origem_vaga\`,
      \`vaga_remanejada\`,
      \`destino_vaga\`,
      \`vaga_adicionada\`,
      \`quantidade_vaga_adicionada\`,
      \`numero_processo_sei\`,
      \`anexo_oficio_url\`,
      \`anexo_oficio_nome\`,
      \`anexo_oficio_tipo\`,
      \`inserido_por_email\`
    FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.REMANEJAMENTO_CADASTRO_VIEW}\`
    ORDER BY \`origem_vaga\`, \`vaga_remanejada\`, \`destino_vaga\`, \`vaga_adicionada\`
  `
};

const cacheStore = new Map();
const pendingCacheLoads = new Map();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/config", (req, res) => {
  res.json({
    logoAgsusUrl: getLogoAgsusUrl(),
    backgroundPainelUrl: getBackgroundPainelUrl(),
    logoCoordenacaoUrl: getLogoCoordenacaoUrl(),
    imagemIndigenaPainelUrl: getImagemIndigenaPainelUrl(),
    dashboardSaudeIndigenaUrl: process.env.DASHBOARD_SAUDE_INDIGENA_URL || DASH_CONFIG.DASHBOARD_SAUDE_INDIGENA_URL
  });
});

app.get("/api/dashboard", asyncHandler(async (req, res) => {
  res.json(await getDashboardData());
}));

app.get("/api/dashboard/resumo", asyncHandler(async (req, res) => {
  res.json(await getDashboardResumoData());
}));

app.get("/api/dashboard/apoio", asyncHandler(async (req, res) => {
  res.json(await getDashboardApoioData());
}));

app.get("/api/vagas", asyncHandler(async (req, res) => {
  res.json(await getVagasData());
}));

app.get("/api/alertas", asyncHandler(async (req, res) => {
  res.json(await getAlertasData());
}));

app.get("/api/remanejamento/lista", asyncHandler(async (req, res) => {
  res.json(await getRemanejamentoListaData());
}));

app.get("/api/remanejamento/cadastro", asyncHandler(async (req, res) => {
  res.json(await getRemanejamentoCadastroData());
}));

app.post("/api/cache/clear", asyncHandler(async (req, res) => {
  limparCacheDashboard();
  res.json({ ok: true });
}));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((err, req, res, next) => {
  const message = err && err.message ? err.message : "Erro interno.";
  console.error(err);
  res.status(500).json({ error: message });
});

if (require.main === module) {
  const port = resolverPortaAplicacao();
  app.listen(port, () => {
    console.log(`Painel disponível em http://localhost:${port}`);
  });
}

module.exports = app;

async function getDashboardData() {
  const rows = await obterMonitoramentoRowsComCache();
  const totaisMonitoramento = await obterMonitoramentoTotaisComCache();
  const remanejamentos = await obterRemanejamentoListaComCache();
  const remanejamentoCadastro = await obterRemanejamentoCadastroComCache();

  return {
    modo: "completo",
    completo: true,
    rows,
    indicadores: calcularIndicadoresServidor(rows, totaisMonitoramento),
    filtros: montarFiltrosAPartirDasRows(rows),
    remanejamentos,
    remanejamentoLista: remanejamentos,
    remanejamentoCadastro,
    remanejamentoOptions: montarOpcoesRemanejamentoAPartirDasRows(rows),
    atualizadoEm: obterUltimaAtualizacaoDash(rows)
  };
}

async function getDashboardResumoData() {
  const rows = await obterMonitoramentoRowsComCache();
  const totaisMonitoramento = await obterMonitoramentoTotaisComCache();
  const resumo = montarResumoDashboard(rows, totaisMonitoramento);

  return {
    modo: "resumo",
    completo: false,
    filtros: montarFiltrosAPartirDasRows(rows),
    atualizadoEm: obterUltimaAtualizacaoDash(rows),
    ...resumo
  };
}

async function getDashboardApoioData() {
  const rows = await obterMonitoramentoRowsComCache();
  const remanejamentos = await obterRemanejamentoListaComCache();
  const remanejamentoCadastro = await obterRemanejamentoCadastroComCache();

  return {
    filtros: montarFiltrosAPartirDasRows(rows),
    remanejamentos,
    remanejamentoLista: remanejamentos,
    remanejamentoCadastro,
    remanejamentoOptions: montarOpcoesRemanejamentoAPartirDasRows(rows),
    atualizadoEm: obterUltimaAtualizacaoDash(rows)
  };
}

async function getVagasData() {
  const rows = await obterMonitoramentoRowsComCache();
  const totaisMonitoramento = await obterMonitoramentoTotaisComCache();

  return {
    rows,
    indicadores: calcularIndicadoresServidor(rows, totaisMonitoramento),
    filtros: montarFiltrosAPartirDasRows(rows),
    atualizadoEm: obterUltimaAtualizacaoDash(rows)
  };
}

async function getAlertasData() {
  const rows = await obterMonitoramentoRowsComCache();

  return {
    rows,
    atualizadoEm: obterUltimaAtualizacaoDash(rows)
  };
}

async function getRemanejamentoListaData() {
  const rows = await obterRemanejamentoListaComCache();

  return {
    rows,
    atualizadoEm: obterUltimaAtualizacaoRemanejamento(rows)
  };
}

async function getRemanejamentoCadastroData() {
  const rows = await obterRemanejamentoCadastroComCache();

  return {
    rows,
    atualizadoEm: ""
  };
}

async function obterMonitoramentoRowsComCache() {
  return obterOuCarregarJsonCache(DASH_CONFIG.CACHE_MONITORAMENTO_KEY, DASH_CONFIG.CACHE_SECONDS, async () => {
    const conn = await getMysqlConnection();
    try {
      return await buscarMonitoramentoVagasComConn(conn);
    } finally {
      await fecharJdbc(conn);
    }
  });
}

async function obterMonitoramentoTotaisComCache() {
  return obterOuCarregarJsonCache(DASH_CONFIG.CACHE_MONITORAMENTO_TOTAIS_KEY, DASH_CONFIG.CACHE_SECONDS, async () => {
    const conn = await getMysqlConnection();
    try {
      return await buscarMonitoramentoTotaisComConn(conn);
    } finally {
      await fecharJdbc(conn);
    }
  });
}

async function obterRemanejamentoListaComCache() {
  return obterOuCarregarJsonCache(DASH_CONFIG.CACHE_REMANEJAMENTO_LISTA_KEY, DASH_CONFIG.CACHE_SECONDS, async () => {
    const conn = await getMysqlConnection();
    try {
      return await buscarRemanejamentosComConn(conn);
    } finally {
      await fecharJdbc(conn);
    }
  });
}

async function obterRemanejamentoCadastroComCache() {
  return obterOuCarregarJsonCache(DASH_CONFIG.CACHE_REMANEJAMENTO_CADASTRO_KEY, DASH_CONFIG.CACHE_SECONDS, async () => {
    const conn = await getMysqlConnection();
    try {
      return await buscarRemanejamentoCadastroComConn(conn);
    } finally {
      await fecharJdbc(conn);
    }
  });
}

async function obterOuCarregarJsonCache(baseKey, seconds, loaderFn) {
  const cached = cacheStore.get(baseKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.payload;
  }

  if (pendingCacheLoads.has(baseKey)) {
    return pendingCacheLoads.get(baseKey);
  }

  const promise = (async () => {
    const payload = await loaderFn();
    cacheStore.set(baseKey, {
      expiresAt: Date.now() + (seconds * 1000),
      payload
    });
    return payload;
  })().finally(() => {
    pendingCacheLoads.delete(baseKey);
  });

  pendingCacheLoads.set(baseKey, promise);
  return promise;
}

function limparCacheDashboard() {
  [
    DASH_CONFIG.CACHE_MONITORAMENTO_KEY,
    DASH_CONFIG.CACHE_MONITORAMENTO_TOTAIS_KEY,
    DASH_CONFIG.CACHE_REMANEJAMENTO_LISTA_KEY,
    DASH_CONFIG.CACHE_REMANEJAMENTO_CADASTRO_KEY
  ].forEach(key => cacheStore.delete(key));
}

async function buscarMonitoramentoVagasComConn(conn) {
  return executarConsultaComConn(conn, DASH_SQL.MONITORAMENTO, mapMonitoramentoRow);
}

async function buscarMonitoramentoTotaisComConn(conn) {
  try {
    const [rows] = await conn.query(DASH_SQL.MONITORAMENTO_TOTAIS);
    const row = rows && rows[0] ? rows[0] : {};
    return {
      totalContratadosGeral: converterNumeroDash(row.total_contratados_geral)
    };
  } catch (err) {
    throw new Error(`Erro ao consultar MySQL: ${err && err.message ? err.message : err}`);
  }
}

async function buscarRemanejamentosComConn(conn) {
  return executarConsultaComConn(conn, DASH_SQL.REMANEJAMENTO_LISTA, mapRemanejamentoListaRow);
}

async function buscarRemanejamentoCadastroComConn(conn) {
  return executarConsultaComConn(conn, DASH_SQL.REMANEJAMENTO_CADASTRO, mapRemanejamentoCadastroRow);
}

async function executarConsultaComConn(conn, sql, mapper) {
  try {
    const [rows] = await conn.query(sql);
    return rows.map(mapper);
  } catch (err) {
    throw new Error(`Erro ao consultar MySQL: ${err && err.message ? err.message : err}`);
  }
}

function mapMonitoramentoRow(row) {
  const dsei = limparValorDash(row.dsei_casai);
  const cargo = limparValorDash(row.cargo);
  const quantitativoPlano = converterNumeroDash(row.quantitativo_plano_trabalho);
  const totalContratados = converterNumeroDash(row.total_contratados_geral);
  const contratadosSubstituicao = converterNumeroDash(row.contratados_substituicao);
  const contratadosTemporario = converterNumeroDash(row.contratados_temporario);
  const contratadosNormal = converterNumeroDash(row.contratados_normal);
  const afastados = converterNumeroDash(row.afastados);
  const trabalhadoresSituacaoNormal = converterNumeroDash(row.trabalhadores_situacao_normal);
  const vagasOciosas = converterNumeroDash(row.vagas_ociosas);
  const qtdAfastamentoSemSubstituto = converterNumeroDash(row.qtd_afastamento_sem_substituto);
  const qtdTemporarioAtivo = converterNumeroDash(row.qtd_temporario_ativo);
  const qtdVagasExcedentes = converterNumeroDash(row.qtd_vagas_excedentes);
  const qtdVagasArtExcedentes = converterNumeroDash(row.qtd_vagas_art_excedentes);
  const contratadosIndigenas = converterNumeroDash(row.contratados_indigenas);
  const alertaAfastamentoSemSubstituto = limparValorDash(row.alerta_afastamento_sem_substituto);
  const alertaTemporarioAtivo = limparValorDash(row.alerta_temporario_ativo);
  const alertaVagasExcedentes = limparValorDash(row.alerta_vagas_excedentes);
  const alertaVagasArtExcedentes = limparValorDash(row.alerta_vagas_art_excedentes);
  const detalheAlertas = montarDetalheAlertasMonitoramento({
    qtdAfastamentoSemSubstituto,
    qtdTemporarioAtivo,
    qtdVagasExcedentes,
    qtdVagasArtExcedentes
  });
  const temAlerta = [
    qtdAfastamentoSemSubstituto,
    qtdTemporarioAtivo,
    qtdVagasExcedentes,
    qtdVagasArtExcedentes
  ].some(valor => Number(valor || 0) > 0) ? "SIM" : "NÃO";
  const atualizacao = formatDateInTimeZone(new Date(), DASH_CONFIG.TIMEZONE);

  return {
    id: `${normalizarChaveDash(dsei)}::${normalizarChaveDash(cargo)}`,
    dseiCasai: dsei,
    dseiKey: normalizarChaveDash(dsei),
    unidade: dsei,
    cargo,
    quantitativoPlano,
    totalContratados,
    contratadosSubstituicao,
    contratadosTemporario,
    contratadosNormal,
    afastados,
    trabalhadoresSituacaoNormal,
    vagasOciosasOriginal: vagasOciosas,
    vagasOciosas,
    vagaRemanejada: "",
    profissionaisIndigenasCargo: contratadosIndigenas,
    contratadosIndigenas,
    profissionaisIndigenas: contratadosIndigenas,
    totalProfissionaisRaca: totalContratados,
    emProcessoSeletivo: 0,
    temAlerta,
    alertaAfastamentoSemSubstituto,
    qtdAfastamentoSemSubstituto,
    alertaTemporarioAtivo,
    qtdTemporarioAtivo,
    alertaVagasExcedentes,
    qtdVagasExcedentes,
    alertaVagasArtExcedentes,
    qtdVagasArtExcedentes,
    detalheAlertas,
    quantitativoPlanoOriginal: quantitativoPlano,
    vagasOciosasOriginalAntesRemanejamento: vagasOciosas,
    vagasRemanejadasSaida: 0,
    vagasRemanejadasEntrada: 0,
    qtdRemanejamentos: 0,
    processosSei: "",
    ultimoRemanejamentoEm: "",
    linhaSinteticaRemanejamento: "",
    atualizacaoDados: atualizacao,
    competencia: extrairCompetenciaDash(atualizacao)
  };
}

function montarDetalheAlertasMonitoramento(alertas) {
  const detalhes = [];

  if (Number(alertas.qtdAfastamentoSemSubstituto || 0) > 0) {
    detalhes.push(`${alertas.qtdAfastamentoSemSubstituto} afastamento(s) sem substituto`);
  }

  if (Number(alertas.qtdTemporarioAtivo || 0) > 0) {
    detalhes.push(`${alertas.qtdTemporarioAtivo} temporário(s) ativo(s)`);
  }

  if (Number(alertas.qtdVagasExcedentes || 0) > 0) {
    detalhes.push(`${alertas.qtdVagasExcedentes} vaga(s) excedente(s)`);
  }

  if (Number(alertas.qtdVagasArtExcedentes || 0) > 0) {
    detalhes.push(`${alertas.qtdVagasArtExcedentes} RT(s) excedente(s)`);
  }

  return detalhes.join(" | ");
}

function mapRemanejamentoListaRow(row) {
  const dataCriacaoFormatada = limparValorDash(row.data_criacao_formatada ?? row[1]);
  const atualizadoEmFormatado = limparValorDash(row.atualizado_em_formatado ?? row[10]);

  return {
    idRemanejamento: limparValorDash(row.id_remanejamento ?? row[0]),
    dataCriacao: dataCriacaoFormatada,
    dataCriacaoFormatada,
    origemVaga: limparValorDash(row.origem_vaga ?? row[2]),
    vagaRemanejada: limparValorDash(row.vaga_remanejada ?? row[3]),
    destinoVaga: limparValorDash(row.destino_vaga ?? row[4]),
    vagaAdicionada: limparValorDash(row.vaga_adicionada ?? row[5]),
    quantidadeVagaAdicionada: converterNumeroDash(row.quantidade_vaga_adicionada ?? row[6]),
    numeroProcessoSei: limparValorDash(row.numero_processo_sei ?? row[7]),
    anexoOficioUrl: limparValorDash(row.anexo_oficio_url ?? row[8]),
    anexoOficioNome: limparValorDash(row.anexo_oficio_nome ?? row[9]),
    anexoOficioTipo: "",
    inseridoPorEmail: limparValorDash(row.inserido_por_email ?? row[10]),
    atualizadoEm: atualizadoEmFormatado,
    atualizadoEmFormatado
  };
}

function mapRemanejamentoCadastroRow(row) {
  return {
    origemVaga: limparValorDash(row.origem_vaga ?? row[0]),
    vagaRemanejada: limparValorDash(row.vaga_remanejada ?? row[1]),
    destinoVaga: limparValorDash(row.destino_vaga ?? row[2]),
    vagaAdicionada: limparValorDash(row.vaga_adicionada ?? row[3]),
    quantidadeVagaAdicionada: converterNumeroDash(row.quantidade_vaga_adicionada ?? row[4]),
    numeroProcessoSei: limparValorDash(row.numero_processo_sei ?? row[5]),
    anexoOficioUrl: limparValorDash(row.anexo_oficio_url ?? row[6]),
    anexoOficioNome: limparValorDash(row.anexo_oficio_nome ?? row[7]),
    anexoOficioTipo: limparValorDash(row.anexo_oficio_tipo ?? row[8]),
    inseridoPorEmail: limparValorDash(row.inserido_por_email ?? row[9])
  };
}

function montarResumoDashboard(rows, totaisMonitoramento) {
  rows = rows || [];

  const indicadores = calcularIndicadoresServidor(rows, totaisMonitoramento);
  const topCargos = topAgrupadoServidor(rows, row => row.cargo, row => Number(row.quantitativoPlano || 0), 5);
  const topDseiVagas = topAgrupadoServidor(rows, row => row.dseiCasai, row => Number(row.quantitativoPlano || 0), 5);
  const topDseiOciosas = topAgrupadoServidor(rows, row => row.dseiCasai, row => Math.max(0, calcularOciosasServidor(row)), 5);
  const topCargoOciosas = topAgrupadoServidor(rows, row => row.cargo, row => Math.max(0, calcularOciosasServidor(row)), 5);
  const topIndigenasCargo = topAgrupadoServidor(rows, row => row.cargo, row => Number(row.profissionaisIndigenasCargo || row.contratadosIndigenas || 0), 8);

  return {
    indicadores,
    topCargos,
    topDseiVagas,
    topCategorias: topCargos,
    topDseiOciosas,
    topCargoOciosas,
    topIndigenasCargo,
    topDsei: topAgrupadoServidor(rows, row => row.dseiCasai, row => Number(row.quantitativoPlano || 0), 1)[0] || null,
    topCargo: topAgrupadoServidor(rows, row => row.cargo, row => Number(row.quantitativoPlano || 0), 1)[0] || null,
    topAfastados: topAgrupadoServidor(rows, row => row.cargo, row => Number(row.afastados || 0), 1)[0] || null,
    maiorRisco: topAgrupadoServidor(
      rows,
      row => `${row.dseiCasai || "Não informado"} - ${row.cargo || "Não informado"}`,
      row => Number(row.qtdAfastamentoSemSubstituto || 0) + Number(row.qtdTemporarioAtivo || 0),
      1
    )[0] || null
  };
}

function calcularIndicadoresServidor(rows, totaisMonitoramento) {
  const vagasPrevistas = somaServidor(rows, "quantitativoPlano");
  const contratados = totaisMonitoramento && totaisMonitoramento.totalContratadosGeral !== undefined
    ? Number(totaisMonitoramento.totalContratadosGeral || 0)
    : somaServidor(rows, "totalContratados");
  const afastados = somaServidor(rows, "afastados");
  const substituicoes = somaServidor(rows, "contratadosSubstituicao");
  const temporarios = somaServidor(rows, "contratadosTemporario");
  const indigenas = somaServidor(rows, "contratadosIndigenas");
  const contratadosNormal = somaServidor(rows, "contratadosNormal");
  const vagasOciosas = vagasPrevistas - contratados + afastados;
  const vagasPreenchidas = vagasPrevistas - vagasOciosas;
  const vagasPreenchidasPerc = vagasPrevistas > 0 ? (vagasPreenchidas / vagasPrevistas) * 100 : 0;
  const coberturaAfastamentos = afastados > 0 ? (substituicoes / afastados) * 100 : 0;
  const percentualIndigenas = contratados > 0 ? (indigenas / contratados) * 100 : 0;
  const riscoAfastamento = somaServidor(rows, "qtdAfastamentoSemSubstituto");
  const riscoTemporario = somaServidor(rows, "qtdTemporarioAtivo");

  return {
    vagasPrevistas,
    contratados,
    afastados,
    substituicoes,
    temporarios,
    indigenas,
    percentualIndigenas,
    contratadosNormal,
    vagasOciosas,
    vagasPreenchidas,
    vagasPreenchidasPerc,
    coberturaAfastamentos,
    riscoAfastamento,
    riscoTemporario,
    atualizacaoDados: obterUltimaAtualizacaoDash(rows)
  };
}

function topAgrupadoServidor(rows, keyFn, valueFn, limit) {
  const map = {};

  (rows || []).forEach(row => {
    const label = limparValorDash(keyFn(row)) || "Não informado";
    const value = Number(valueFn(row) || 0);

    if (!map[label]) {
      map[label] = { label, value: 0 };
    }

    map[label].value += value;
  });

  return Object.keys(map)
    .map(key => map[key])
    .filter(item => Number(item.value || 0) > 0)
    .sort((a, b) => Number(b.value || 0) - Number(a.value || 0))
    .slice(0, limit || 5);
}

function calcularOciosasServidor(row) {
  if (row && row.vagasOciosas !== null && row.vagasOciosas !== undefined && row.vagasOciosas !== "") {
    return Number(row.vagasOciosas || 0);
  }

  const vagas = Number(row.quantitativoPlano || 0);
  const contratados = Number(row.totalContratados || 0);
  const afastados = Number(row.afastados || 0);

  return vagas - contratados + afastados;
}

function somaServidor(rows, field) {
  return (rows || []).reduce((acc, row) => acc + Number(row[field] || 0), 0);
}

function montarFiltrosAPartirDasRows(rows) {
  const dseis = [...new Set((rows || []).map(r => r.dseiCasai).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "pt-BR"));

  const cargos = [...new Set((rows || []).map(r => r.cargo).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "pt-BR"));

  return { dseis, cargos };
}

function montarOpcoesRemanejamentoAPartirDasRows(rows) {
  const mapaDseiOrigem = {};
  const mapaDseiDestino = {};
  const mapaVagasOrigem = {};
  const mapaVagasDestino = {};

  (rows || []).forEach(row => {
    const dsei = limparValorDash(row.dseiCasai);
    const cargo = limparValorDash(row.cargo);

    if (!dsei || !cargo) return;

    const dseiId = normalizarChaveDash(dsei);
    const cargoId = normalizarChaveDash(cargo);
    const parId = `${dseiId}||${cargoId}`;
    const vagasOciosas = calcularOciosasServidor(row);

    if (!mapaDseiDestino[dseiId]) {
      mapaDseiDestino[dseiId] = { id: dseiId, nome: dsei };
    }

    if (!mapaVagasDestino[parId]) {
      mapaVagasDestino[parId] = {
        id: parId,
        dseiId,
        dseiCasai: dsei,
        nome: cargo,
        valor: 0
      };
    }

    if (vagasOciosas <= 0) return;

    if (!mapaDseiOrigem[dseiId]) {
      mapaDseiOrigem[dseiId] = {
        id: dseiId,
        nome: dsei,
        vagasOciosas: 0
      };
    }

    mapaDseiOrigem[dseiId].vagasOciosas += vagasOciosas;

    if (!mapaVagasOrigem[parId]) {
      mapaVagasOrigem[parId] = {
        id: parId,
        dseiId,
        dseiCasai: dsei,
        nome: cargo,
        vagasOciosas: 0,
        valor: 0
      };
    }

    mapaVagasOrigem[parId].vagasOciosas += vagasOciosas;
  });

  return {
    dseis: Object.keys(mapaDseiOrigem)
      .map(key => mapaDseiOrigem[key])
      .filter(item => item.vagasOciosas > 0)
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    dseisDestino: Object.keys(mapaDseiDestino)
      .map(key => mapaDseiDestino[key])
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    vagasOrigem: Object.keys(mapaVagasOrigem)
      .map(key => mapaVagasOrigem[key])
      .filter(item => item.vagasOciosas > 0)
      .sort((a, b) => {
        const d = a.dseiCasai.localeCompare(b.dseiCasai, "pt-BR");
        return d !== 0 ? d : a.nome.localeCompare(b.nome, "pt-BR");
      }),
    vagasDestino: Object.keys(mapaVagasDestino)
      .map(key => mapaVagasDestino[key])
      .sort((a, b) => {
        const d = a.dseiCasai.localeCompare(b.dseiCasai, "pt-BR");
        return d !== 0 ? d : a.nome.localeCompare(b.nome, "pt-BR");
      })
  };
}

function obterUltimaAtualizacaoRemanejamento(rows) {
  const valores = (rows || [])
    .map(row => row.atualizadoEmFormatado || row.atualizadoEm || row.dataCriacaoFormatada || row.dataCriacao)
    .filter(Boolean);

  return valores[0] || "";
}

function normalizarChaveDash(valor) {
  return limparValorDash(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function limparValorDash(valor) {
  if (valor === null || valor === undefined) return "";

  return String(valor)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function converterNumeroDash(valor) {
  if (valor === null || valor === undefined || valor === "") return 0;
  if (typeof valor === "number") return valor;

  let texto = String(valor).trim();
  if (!texto) return 0;

  texto = texto.replace(/[^\d,.-]/g, "");

  const lastComma = texto.lastIndexOf(",");
  const lastDot = texto.lastIndexOf(".");

  if (lastComma >= 0 && lastDot >= 0) {
    texto = lastComma > lastDot
      ? texto.replace(/\./g, "").replace(",", ".")
      : texto.replace(/,/g, "");
  } else if (lastComma >= 0) {
    texto = texto.replace(/\./g, "").replace(",", ".");
  } else {
    texto = texto.replace(/,/g, "");
  }

  const numero = Number(texto);
  return Number.isNaN(numero) ? 0 : numero;
}

function formatarDataBancoDash(valor) {
  if (!valor) return "";

  if (valor instanceof Date) {
    return formatDateInTimeZone(valor, DASH_CONFIG.TIMEZONE);
  }

  const texto = limparValorDash(valor);
  const matchMySql = texto.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/);
  if (matchMySql) {
    const [, ano, mes, dia, hora = "00", minuto = "00", segundo = "00"] = matchMySql;
    return `${dia}/${mes}/${ano} ${hora}:${minuto}:${segundo}`;
  }

  const data = new Date(texto);
  if (!Number.isNaN(data.getTime())) {
    return formatDateInTimeZone(data, DASH_CONFIG.TIMEZONE);
  }

  return texto;
}

function extrairCompetenciaDash(atualizacao) {
  if (!atualizacao) return "";

  const texto = String(atualizacao).trim();
  const matchBR = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (matchBR) {
    return `${nomeMesDash(Number(matchBR[2]))}/${Number(matchBR[3])}`;
  }

  const matchISO = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (matchISO) {
    return `${nomeMesDash(Number(matchISO[2]))}/${Number(matchISO[1])}`;
  }

  return "";
}

function nomeMesDash(mes) {
  const nomes = [
    "",
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro"
  ];

  return nomes[mes] || "";
}

function obterUltimaAtualizacaoDash(rows) {
  const atualizacoes = (rows || []).map(r => r.atualizacaoDados).filter(Boolean);
  return atualizacoes[0] || formatDateInTimeZone(new Date(), DASH_CONFIG.TIMEZONE);
}

async function fecharJdbc(resource) {
  if (!resource || typeof resource.end !== "function") return;
  await resource.end();
}

function getBackgroundPainelUrl() {
  return DASH_CONFIG.BACKGROUND_FILE;
}

function getImagemIndigenaPainelUrl() {
  return DASH_CONFIG.IMAGEM_INDIGENA_PAINEL_FILE;
}

function getLogoCoordenacaoUrl() {
  return DASH_CONFIG.LOGO_COORDENACAO_FILE;
}

function getLogoAgsusUrl() {
  return DASH_CONFIG.LOGO_AGSUS_FILE;
}

async function getMysqlConnection() {
  const config = getMysqlConfig();
  return mysql.createConnection(config);
}

function getMysqlConfig() {
  const jdbcUrl = String(process.env.MYSQL_JDBC_URL || "").trim();
  const user = String(process.env.MYSQL_USER || "").trim();
  const password = String(process.env.MYSQL_PASSWORD || "").trim();

  if (!user || !password || (!jdbcUrl && !process.env.MYSQL_HOST)) {
    throw new Error(
      "Configuração MySQL ausente. Defina MYSQL_JDBC_URL, MYSQL_USER e MYSQL_PASSWORD " +
      "ou MYSQL_HOST, MYSQL_PORT, MYSQL_DATABASE, MYSQL_USER e MYSQL_PASSWORD."
    );
  }

  if (jdbcUrl) {
    const parsed = parseJdbcUrl(jdbcUrl);
    return {
      host: parsed.hostname,
      port: Number(parsed.port || 3306),
      user,
      password,
      database: String(process.env.MYSQL_DATABASE || parsed.pathname.replace(/^\//, "") || ""),
      charset: "utf8mb4",
      dateStrings: true
    };
  }

  return {
    host: String(process.env.MYSQL_HOST || "").trim(),
    port: Number(process.env.MYSQL_PORT || 3306),
    user,
    password,
    database: String(process.env.MYSQL_DATABASE || "").trim(),
    charset: "utf8mb4",
    dateStrings: true
  };
}

function resolverPortaAplicacao() {
  const appPort = Number(process.env.APP_PORT || 0);
  if (appPort > 0) return appPort;

  const port = Number(process.env.PORT || 3000);
  const mysqlPort = Number(process.env.MYSQL_PORT || 3306);

  if (port === mysqlPort) {
    return 3000;
  }

  return port > 0 ? port : 3000;
}

function parseJdbcUrl(jdbcUrl) {
  const sanitized = jdbcUrl.replace(/^jdbc:/i, "");
  return new URL(sanitized);
}

function formatDateInTimeZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  const parts = formatter.formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value || "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
