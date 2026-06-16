// Domínio: dashboard/monitoramento (vagas, alertas, indicadores) + observações de alertas.
const { DASH_CONFIG } = require("./config");
const { DASH_SQL } = require("./sql");
const { getMysqlConnection, fecharJdbc, obterOuCarregarJsonCache, executarConsultaComConn } = require("./db");
const { limparValorDash, converterNumeroDash, normalizarChaveDash, formatarDataBancoDash, extrairCompetenciaDash, nomeMesDash, obterUltimaAtualizacaoDash, somaServidor, mesesAteFimDoAno, formatDateInTimeZone } = require("./utils");
const { obterRemanejamentoListaComCache, obterRemanejamentoCadastroComCache, montarOpcoesRemanejamentoAPartirDasRows } = require("./remanejamento");

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
  const observacoes = await getAlertasObservacoesMap();

  return {
    rows,
    observacoes,
    atualizadoEm: obterUltimaAtualizacaoDash(rows)
  };
}

async function garantirTabelaAlertasObservacoes() {
  const conn = await getMysqlConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.ALERTAS_OBSERVACOES_TABLE}\` (
        \`ID_ALERTA_OBSERVACAO\` BIGINT NOT NULL AUTO_INCREMENT,
        \`CHAVE_ALERTA\`         VARCHAR(255) NOT NULL,
        \`DSEI_CASAI\`           VARCHAR(255) NULL,
        \`CARGO\`                VARCHAR(255) NULL,
        \`TIPO_ALERTA\`          VARCHAR(64)  NULL,
        \`DETALHE\`              VARCHAR(500) NULL,
        \`OBSERVACAO\`           TEXT         NULL,
        \`USUARIO\`              VARCHAR(255) NULL,
        \`ATUALIZADO_EM\`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`ID_ALERTA_OBSERVACAO\`),
        UNIQUE KEY \`UQ_ALERTAS_OBSERVACOES_CHAVE\` (\`CHAVE_ALERTA\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } finally {
    await fecharJdbc(conn);
  }
}

async function getAlertasObservacoesMap() {
  let conn = null;
  try {
    conn = await getMysqlConnection();
    const [rows] = await conn.query(
      `SELECT
         \`CHAVE_ALERTA\`,
         \`OBSERVACAO\`,
         \`USUARIO\`,
         DATE_FORMAT(\`ATUALIZADO_EM\`, '%d/%m/%Y %H:%i:%s') AS \`ATUALIZADO_EM\`
       FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.ALERTAS_OBSERVACOES_TABLE}\``
    );

    const mapa = {};
    (rows || []).forEach(row => {
      const chave = limparValorDash(row.CHAVE_ALERTA);
      if (!chave) return;
      mapa[chave] = {
        observacao: limparValorDash(row.OBSERVACAO),
        usuario: limparValorDash(row.USUARIO),
        atualizadoEm: limparValorDash(row.ATUALIZADO_EM)
      };
    });

    return mapa;
  } catch (err) {
    // Se a tabela ainda não existir ou houver soluço de conexão, retorna mapa vazio
    // para não quebrar a aba Alertas (os dados de monitoramento continuam sendo exibidos).
    console.error("Falha ao carregar observações de alertas:", err && err.message ? err.message : err);
    return {};
  } finally {
    await fecharJdbc(conn);
  }
}

async function salvarObservacaoAlertaComConn(conn, body) {
  const chave = limparValorDash(body.chave);
  if (!chave) throw new Error("Não foi possível identificar o alerta.");

  const dsei = limparValorDash(body.dsei);
  const cargo = limparValorDash(body.cargo);
  const tipoValor = limparValorDash(body.tipoValor);
  const detalhe = limparValorDash(body.detalhe);
  const observacao = limparValorDash(body.observacao);
  const usuario = limparValorDash(body.usuario || body.criadoPor || "painel");

  await conn.execute(
    `INSERT INTO \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.ALERTAS_OBSERVACOES_TABLE}\`
       (\`CHAVE_ALERTA\`, \`DSEI_CASAI\`, \`CARGO\`, \`TIPO_ALERTA\`, \`DETALHE\`, \`OBSERVACAO\`, \`USUARIO\`)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       \`DSEI_CASAI\` = VALUES(\`DSEI_CASAI\`),
       \`CARGO\` = VALUES(\`CARGO\`),
       \`TIPO_ALERTA\` = VALUES(\`TIPO_ALERTA\`),
       \`DETALHE\` = VALUES(\`DETALHE\`),
       \`OBSERVACAO\` = VALUES(\`OBSERVACAO\`),
       \`USUARIO\` = VALUES(\`USUARIO\`)`,
    [chave, dsei || null, cargo || null, tipoValor || null, detalhe || null, observacao || null, usuario || null]
  );

  const [rows] = await conn.query(
    `SELECT \`USUARIO\`, DATE_FORMAT(\`ATUALIZADO_EM\`, '%d/%m/%Y %H:%i:%s') AS \`ATUALIZADO_EM\`
       FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.ALERTAS_OBSERVACOES_TABLE}\`
      WHERE \`CHAVE_ALERTA\` = ? LIMIT 1`,
    [chave]
  );

  const salvo = rows && rows[0] ? rows[0] : {};
  return {
    chave,
    observacao,
    usuario: limparValorDash(salvo.USUARIO) || usuario,
    atualizadoEm: limparValorDash(salvo.ATUALIZADO_EM)
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

function mapMonitoramentoRow(row) {
  const dsei = limparValorDash(row.dsei_casai);
  const cargo = limparValorDash(row.cargo);
  const quantitativoPlano = converterNumeroDash(row.quantitativo_plano_trabalho);
  const totalTrabalhadores = converterNumeroDash(row.total_contratados_geral);
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
    totalTrabalhadores,
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
    totalProfissionaisRaca: totalTrabalhadores,
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

function montarResumoDashboard(rows, totaisMonitoramento) {
  rows = rows || [];

  const indicadores = calcularIndicadoresServidor(rows, totaisMonitoramento);
  const topCargos = topAgrupadoServidor(rows, row => row.cargo, row => Number(row.quantitativoPlano || 0), 5);
  const topDseiVagas = topAgrupadoServidor(rows, row => row.dseiCasai, row => Number(row.quantitativoPlano || 0), 5);
  const topDseiOciosas = topAgrupadoServidor(rows, row => row.dseiCasai, row => calcularOciosasServidor(row), 5);
  const topCargoOciosas = topAgrupadoServidor(rows, row => row.cargo, row => calcularOciosasServidor(row), 5);
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
    : somaServidor(rows, "totalTrabalhadores");
  const afastados = somaServidor(rows, "afastados");
  const substituicoes = somaServidor(rows, "contratadosSubstituicao");
  const temporarios = somaServidor(rows, "contratadosTemporario");
  const indigenas = somaServidor(rows, "contratadosIndigenas");
  const contratadosNormal = somaServidor(rows, "contratadosNormal");
  // Vagas ociosas (déficit operacional) = previstas - contratados + afastados (com negativos).
  const vagasOciosas = vagasPrevistas - contratados + afastados;
  // Vagas preenchidas = trabalhadores contratados - afastados.
  const vagasPreenchidas = contratados - afastados;
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
  const trabalhadores = Number(row.totalTrabalhadores || 0);
  const afastados = Number(row.afastados || 0);

  return vagas - trabalhadores + afastados;
}

function montarFiltrosAPartirDasRows(rows) {
  const dseis = [...new Set((rows || []).map(r => r.dseiCasai).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "pt-BR"));

  const cargos = [...new Set((rows || []).map(r => r.cargo).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "pt-BR"));

  return { dseis, cargos };
}

module.exports = { getDashboardData, getDashboardResumoData, getDashboardApoioData, getVagasData, getAlertasData, getAlertasObservacoesMap, salvarObservacaoAlertaComConn, garantirTabelaAlertasObservacoes };
