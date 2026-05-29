require("dotenv").config();

const path = require("path");
const express = require("express");
const mysql = require("mysql2/promise");
const multer = require("multer");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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
    WITH
    dsei_dim AS (
      SELECT
        UNIDADE_ORCAMENTARIA_ID AS id_dsei_casai,
        MAX(UNIDADE_ORCAMENTARIA_DESC) AS dsei_casai
      FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`VW_SAUDE_INDIGENA\`
      GROUP BY UNIDADE_ORCAMENTARIA_ID
    ),
    cargo_dim AS (
      SELECT
        CAST(CARGO_ATUAL_ID AS UNSIGNED) AS id_cargo_funcao,
        MAX(CARGO_ATUAL_DESC) AS cargo
      FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`VW_SAUDE_INDIGENA\`
      GROUP BY CAST(CARGO_ATUAL_ID AS UNSIGNED)
    ),
    itens AS (
      SELECT
        p.ID_VAGAS_REMANEJADAS_PROCESSO AS id_processo,
        p.DATA_INCLUSAO AS data_inclusao,
        DATE_FORMAT(p.DATA_INCLUSAO, '%d/%m/%Y %H:%i:%s') AS data_inclusao_formatada,
        DATE_FORMAT(p.DATA_INCLUSAO, '%m/%Y') AS competencia,
        p.N_PROCESSO AS numero_processo_sei,
        p.OBSERVACAO AS observacao,
        p.CRIADO_POR AS criado_por,
        p.ANEXO_NOME_ARQUIVO AS anexo_nome_arquivo,
        p.ANEXO_MIME_TYPE AS anexo_mime_type,
        p.ANEXO_TAMANHO_BYTES AS anexo_tamanho_bytes,
        CASE WHEN p.ANEXO_PROCESSO IS NULL THEN 0 ELSE 1 END AS tem_anexo,

        r.ID_DSEI_CASAI AS id_dsei_casai,
        COALESCE(dd.dsei_casai, CONCAT('DSEI/CASAI ID ', r.ID_DSEI_CASAI)) AS dsei_casai,

        r.ID_CARGO_ORIGEM AS id_cargo_origem,
        COALESCE(
          CASE r.ID_CARGO_ORIGEM
            WHEN 9999 THEN 'ANALISTA TECNICO'
            WHEN 9998 THEN 'ASSESSOR REGIONAL INDIGENA'
            WHEN 9997 THEN 'AUXILIAR SI'
            WHEN 9996 THEN 'ENFERMEIRO (ART)'
            WHEN 9995 THEN 'FARMACEUTICO (ART)'
            WHEN 9994 THEN 'ANALISTA SI'
            WHEN 104 THEN 'ANALISTA ADMINISTRATIVO'
            WHEN 81 THEN 'MEDICO ESPECIALIDADES'
            WHEN 45 THEN 'ASSISTENTE ADMINISTRATIVO'
            WHEN 46 THEN 'ASSISTENTE DE COMUNICACAO'
            WHEN 50 THEN 'AUXILIAR DE PROTESE DENTARIA'
            WHEN 54 THEN 'BIOQUIMICO'
            ELSE NULL
          END,
          co.cargo,
          CONCAT('CARGO ID ', r.ID_CARGO_ORIGEM)
        ) AS cargo_origem,

        r.QTD_CARGO_ORIGEM AS qtd_cargo_origem,
        r.ID_CARGO_DESTINO AS id_cargo_destino,
        COALESCE(
          CASE r.ID_CARGO_DESTINO
            WHEN 9999 THEN 'ANALISTA TECNICO'
            WHEN 9998 THEN 'ASSESSOR REGIONAL INDIGENA'
            WHEN 9997 THEN 'AUXILIAR SI'
            WHEN 9996 THEN 'ENFERMEIRO (ART)'
            WHEN 9995 THEN 'FARMACEUTICO (ART)'
            WHEN 9994 THEN 'ANALISTA SI'
            WHEN 104 THEN 'ANALISTA ADMINISTRATIVO'
            WHEN 81 THEN 'MEDICO ESPECIALIDADES'
            WHEN 45 THEN 'ASSISTENTE ADMINISTRATIVO'
            WHEN 46 THEN 'ASSISTENTE DE COMUNICACAO'
            WHEN 50 THEN 'AUXILIAR DE PROTESE DENTARIA'
            WHEN 54 THEN 'BIOQUIMICO'
            ELSE NULL
          END,
          cd.cargo,
          CONCAT('CARGO ID ', r.ID_CARGO_DESTINO)
        ) AS cargo_destino,
        r.QTD_CARGO_DESTINO AS qtd_cargo_destino,
        r.N_MESES AS n_meses,

        (
          COALESCE(vo.SALARIO_BASE, 0) +
          COALESCE(vo.INSALUBRIDADE_PERICULOSIDADE, 0) +
          COALESCE(vo.GRATIFICACAO_RT, 0) +
          COALESCE(vo.ADICIONAL_NOTURNO, 0) +
          COALESCE(vo.ENCARGOS, 0) +
          COALESCE(vo.PROVISOES, 0)
        ) * COALESCE(r.QTD_CARGO_ORIGEM, 0) AS total_reduzido_mensal,

        (
          COALESCE(vd.SALARIO_BASE, 0) +
          COALESCE(vd.INSALUBRIDADE_PERICULOSIDADE, 0) +
          COALESCE(vd.GRATIFICACAO_RT, 0) +
          COALESCE(vd.ADICIONAL_NOTURNO, 0) +
          COALESCE(vd.ENCARGOS, 0) +
          COALESCE(vd.PROVISOES, 0)
        ) * COALESCE(r.QTD_CARGO_DESTINO, 0) AS total_acrescentado_mensal

      FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`VAGAS_REMANEJADAS_PROCESSO\` p
      JOIN \`${DASH_CONFIG.DB_SCHEMA}\`.\`VAGAS_REMANEJADAS\` r
        ON r.ID_VAGAS_REMANEJADAS_PROCESSO = p.ID_VAGAS_REMANEJADAS_PROCESSO
      LEFT JOIN dsei_dim dd
        ON dd.id_dsei_casai = r.ID_DSEI_CASAI
      LEFT JOIN cargo_dim co
        ON co.id_cargo_funcao = r.ID_CARGO_ORIGEM
      LEFT JOIN cargo_dim cd
        ON cd.id_cargo_funcao = r.ID_CARGO_DESTINO
      LEFT JOIN \`${DASH_CONFIG.DB_SCHEMA}\`.\`VALOR_VAGA_MENSAL\` vo
        ON vo.ID_VAGA = r.ID_CARGO_ORIGEM
      LEFT JOIN \`${DASH_CONFIG.DB_SCHEMA}\`.\`VALOR_VAGA_MENSAL\` vd
        ON vd.ID_VAGA = r.ID_CARGO_DESTINO
    )
    SELECT
      id_processo,
      data_inclusao,
      data_inclusao_formatada,
      competencia,
      numero_processo_sei,
      observacao,
      criado_por,
      anexo_nome_arquivo,
      anexo_mime_type,
      anexo_tamanho_bytes,
      tem_anexo,
      MAX(id_dsei_casai) AS id_dsei_casai,
      MAX(dsei_casai) AS dsei_casai,
      GROUP_CONCAT(DISTINCT CONCAT(cargo_origem, ' x', qtd_cargo_origem) ORDER BY cargo_origem SEPARATOR ' | ') AS cargos_reduzidos,
      GROUP_CONCAT(DISTINCT CONCAT(cargo_destino, ' x', qtd_cargo_destino) ORDER BY cargo_destino SEPARATOR ' | ') AS cargos_acrescentados,
      SUM(total_reduzido_mensal) AS total_reduzido_mensal,
      SUM(total_acrescentado_mensal) AS total_acrescentado_mensal,
      SUM(total_acrescentado_mensal) - SUM(total_reduzido_mensal) AS impacto_mensal,
      SUM(total_reduzido_mensal * COALESCE(n_meses, 1)) AS total_reduzido_periodo,
      SUM(total_acrescentado_mensal * COALESCE(n_meses, 1)) AS total_acrescentado_periodo,
      SUM((total_acrescentado_mensal - total_reduzido_mensal) * COALESCE(n_meses, 1)) AS impacto_periodo,
      'Registrado' AS situacao
    FROM itens
    GROUP BY
      id_processo,
      data_inclusao,
      data_inclusao_formatada,
      competencia,
      numero_processo_sei,
      observacao,
      criado_por,
      anexo_nome_arquivo,
      anexo_mime_type,
      anexo_tamanho_bytes,
      tem_anexo
    ORDER BY data_inclusao DESC
  `,
  REMANEJAMENTO_CADASTRO: `
    WITH
    dsei_dim AS (
      SELECT
        UNIDADE_ORCAMENTARIA_ID AS id_dsei_casai,
        MAX(UNIDADE_ORCAMENTARIA_DESC) AS dsei_casai
      FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`VW_SAUDE_INDIGENA\`
      GROUP BY UNIDADE_ORCAMENTARIA_ID
    ),
    cargo_dim AS (
      SELECT
        CAST(CARGO_ATUAL_ID AS UNSIGNED) AS id_cargo_funcao,
        MAX(CARGO_ATUAL_DESC) AS cargo
      FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`VW_SAUDE_INDIGENA\`
      GROUP BY CAST(CARGO_ATUAL_ID AS UNSIGNED)
    )
    SELECT
      vp.id_dsei_casai,
      COALESCE(dd.dsei_casai, CONCAT('DSEI/CASAI ID ', vp.id_dsei_casai)) AS dsei_casai,
      vp.id_cargo_funcao,
      COALESCE(
        CASE vp.id_cargo_funcao
          WHEN 9999 THEN 'ANALISTA TECNICO'
          WHEN 9998 THEN 'ASSESSOR REGIONAL INDIGENA'
          WHEN 9997 THEN 'AUXILIAR SI'
          WHEN 9996 THEN 'ENFERMEIRO (ART)'
          WHEN 9995 THEN 'FARMACEUTICO (ART)'
          WHEN 9994 THEN 'ANALISTA SI'
          WHEN 104 THEN 'ANALISTA ADMINISTRATIVO'
          WHEN 81 THEN 'MEDICO ESPECIALIDADES'
          WHEN 45 THEN 'ASSISTENTE ADMINISTRATIVO'
          WHEN 46 THEN 'ASSISTENTE DE COMUNICACAO'
          WHEN 50 THEN 'AUXILIAR DE PROTESE DENTARIA'
          WHEN 54 THEN 'BIOQUIMICO'
          ELSE NULL
        END,
        cd.cargo,
        CONCAT('CARGO ID ', vp.id_cargo_funcao)
      ) AS cargo,
      COALESCE(vp.QTD, 0) AS quantitativo_plano_trabalho,
      COALESCE(vp.CARGA_HORARIA, '') AS carga_horaria,
      COALESCE(vvm.SALARIO_BASE, 0) AS salario_base,
      COALESCE(vvm.INSALUBRIDADE_PERICULOSIDADE, 0) AS insalubridade_periculosidade,
      COALESCE(vvm.GRATIFICACAO_RT, 0) AS gratificacao_rt,
      COALESCE(vvm.ADICIONAL_NOTURNO, 0) AS adicional_noturno,
      COALESCE(vvm.ENCARGOS, 0) AS encargos,
      COALESCE(vvm.PROVISOES, 0) AS provisoes,
      (
        COALESCE(vvm.SALARIO_BASE, 0) +
        COALESCE(vvm.INSALUBRIDADE_PERICULOSIDADE, 0) +
        COALESCE(vvm.GRATIFICACAO_RT, 0) +
        COALESCE(vvm.ADICIONAL_NOTURNO, 0) +
        COALESCE(vvm.ENCARGOS, 0) +
        COALESCE(vvm.PROVISOES, 0)
      ) AS valor_mensal
    FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`VAGAS_PREVISTAS\` vp
    LEFT JOIN dsei_dim dd
      ON dd.id_dsei_casai = vp.id_dsei_casai
    LEFT JOIN cargo_dim cd
      ON cd.id_cargo_funcao = vp.id_cargo_funcao
    LEFT JOIN \`${DASH_CONFIG.DB_SCHEMA}\`.\`VALOR_VAGA_MENSAL\` vvm
      ON vvm.ID_VAGA = vp.id_cargo_funcao
    ORDER BY dsei_casai, cargo
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

app.get("/api/remanejamento/anexo/:id", asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const [rows] = await conn.query(
      `SELECT ANEXO_PROCESSO, ANEXO_NOME_ARQUIVO, ANEXO_MIME_TYPE FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`VAGAS_REMANEJADAS_PROCESSO\` WHERE ID_VAGAS_REMANEJADAS_PROCESSO = ? LIMIT 1`,
      [req.params.id]
    );

    const row = rows && rows[0] ? rows[0] : null;
    if (!row || !row.ANEXO_PROCESSO) {
      res.status(404).json({ error: "Anexo não encontrado." });
      return;
    }

    res.setHeader("Content-Type", row.ANEXO_MIME_TYPE || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(row.ANEXO_NOME_ARQUIVO || "anexo_remanejamento")}"`);
    res.send(row.ANEXO_PROCESSO);
  } finally {
    await fecharJdbc(conn);
  }
}));

app.post("/api/remanejamento/salvar", upload.single("anexo"), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const resultado = await salvarRemanejamentoComConn(conn, req.body || {}, req.file || null);
    limparCacheDashboard();
    res.json({ ok: true, ...resultado });
  } finally {
    await fecharJdbc(conn);
  }
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
  const idProcesso = limparValorDash(row.id_processo ?? row[0]);
  const temAnexo = Number(row.tem_anexo || 0) > 0;

  return {
    idProcesso,
    idRemanejamento: idProcesso,
    dataCriacao: limparValorDash(row.data_inclusao_formatada),
    dataCriacaoFormatada: limparValorDash(row.data_inclusao_formatada),
    competencia: limparValorDash(row.competencia),
    idDseiCasai: limparValorDash(row.id_dsei_casai),
    dseiCasai: limparValorDash(row.dsei_casai),
    cargosReduzidos: limparValorDash(row.cargos_reduzidos),
    cargosAcrescentados: limparValorDash(row.cargos_acrescentados),
    totalReduzidoMensal: converterNumeroDash(row.total_reduzido_mensal),
    totalAcrescentadoMensal: converterNumeroDash(row.total_acrescentado_mensal),
    impactoMensal: converterNumeroDash(row.impacto_mensal),
    totalReduzidoPeriodo: converterNumeroDash(row.total_reduzido_periodo),
    totalAcrescentadoPeriodo: converterNumeroDash(row.total_acrescentado_periodo),
    impactoPeriodo: converterNumeroDash(row.impacto_periodo),
    numeroProcessoSei: limparValorDash(row.numero_processo_sei),
    observacao: limparValorDash(row.observacao),
    inseridoPorEmail: limparValorDash(row.criado_por),
    criadoPor: limparValorDash(row.criado_por),
    situacao: limparValorDash(row.situacao || "Registrado"),
    temAnexo,
    anexoOficioUrl: temAnexo ? `/api/remanejamento/anexo/${encodeURIComponent(idProcesso)}` : "",
    anexoOficioNome: limparValorDash(row.anexo_nome_arquivo),
    anexoOficioTipo: limparValorDash(row.anexo_mime_type),
    atualizadoEm: limparValorDash(row.data_inclusao_formatada),
    atualizadoEmFormatado: limparValorDash(row.data_inclusao_formatada)
  };
}

function mapRemanejamentoCadastroRow(row) {
  const salarioBase = converterNumeroDash(row.salario_base);
  const insalubridadePericulosidade = converterNumeroDash(row.insalubridade_periculosidade);
  const gratificacaoRt = converterNumeroDash(row.gratificacao_rt);
  const adicionalNoturno = converterNumeroDash(row.adicional_noturno);
  const encargos = converterNumeroDash(row.encargos);
  const provisoes = converterNumeroDash(row.provisoes);
  const valorMensal = converterNumeroDash(row.valor_mensal)
    || salarioBase + insalubridadePericulosidade + gratificacaoRt + adicionalNoturno + encargos + provisoes;

  return {
    idDseiCasai: converterNumeroDash(row.id_dsei_casai),
    dseiCasai: limparValorDash(row.dsei_casai),
    idCargoFuncao: converterNumeroDash(row.id_cargo_funcao),
    cargo: limparValorDash(row.cargo),
    quantitativoPlano: converterNumeroDash(row.quantitativo_plano_trabalho),
    cargaHoraria: limparValorDash(row.carga_horaria),
    salarioBase,
    insalubridadePericulosidade,
    gratificacaoRt,
    adicionalNoturno,
    encargos,
    provisoes,
    valorMensal
  };
}

async function salvarRemanejamentoComConn(conn, body, file) {
  const idDseiCasai = converterNumeroDash(body.idDseiCasai);
  const processoSei = limparValorDash(body.processoSei);
  const observacao = limparValorDash(body.observacao);
  const criadoPor = limparValorDash(body.criadoPor || body.usuario || "painel");

  let linhasReduzido = [];
  let linhasAcrescentado = [];

  try {
    linhasReduzido = JSON.parse(body.linhasReduzido || "[]");
    linhasAcrescentado = JSON.parse(body.linhasAcrescentado || "[]");
  } catch (err) {
    throw new Error("Linhas de remanejamento inválidas.");
  }

  linhasReduzido = normalizarLinhasRemanejamentoServidor(linhasReduzido);
  linhasAcrescentado = normalizarLinhasRemanejamentoServidor(linhasAcrescentado);

  if (!idDseiCasai) throw new Error("Selecione o DSEI/CASAI.");
  if (!processoSei) throw new Error("Informe o número do Processo SEI.");
  if (!linhasReduzido.length) throw new Error("Informe ao menos um cargo reduzido.");
  if (!linhasAcrescentado.length) throw new Error("Informe ao menos um cargo acrescentado.");

  await conn.beginTransaction();

  try {
    const [procResult] = await conn.execute(
      `INSERT INTO \`${DASH_CONFIG.DB_SCHEMA}\`.\`VAGAS_REMANEJADAS_PROCESSO\` (
        OBSERVACAO,
        N_PROCESSO,
        ANEXO_PROCESSO,
        ANEXO_NOME_ARQUIVO,
        ANEXO_MIME_TYPE,
        ANEXO_TAMANHO_BYTES,
        CRIADO_POR
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        observacao || null,
        processoSei,
        file ? file.buffer : null,
        file ? file.originalname : null,
        file ? file.mimetype : null,
        file ? file.size : null,
        criadoPor || null
      ]
    );

    const idProcesso = procResult.insertId;
    const totalPares = Math.max(linhasReduzido.length, linhasAcrescentado.length);

    for (let i = 0; i < totalPares; i += 1) {
      const origem = linhasReduzido[i] || linhasReduzido[linhasReduzido.length - 1];
      const destino = linhasAcrescentado[i] || linhasAcrescentado[linhasAcrescentado.length - 1];
      const meses = Math.max(1, Number(origem.meses || destino.meses || 1));

      await conn.execute(
        `INSERT INTO \`${DASH_CONFIG.DB_SCHEMA}\`.\`VAGAS_REMANEJADAS\` (
          ID_VAGAS_REMANEJADAS_PROCESSO,
          ID_DSEI_CASAI,
          ID_CARGO_ORIGEM,
          N_MESES,
          QTD_CARGO_ORIGEM,
          ID_CARGO_DESTINO,
          QTD_CARGO_DESTINO
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          idProcesso,
          idDseiCasai,
          origem.idCargoFuncao,
          meses,
          origem.quantidade,
          destino.idCargoFuncao,
          destino.quantidade
        ]
      );
    }

    await conn.commit();
    return { idProcesso };
  } catch (err) {
    await conn.rollback();
    throw err;
  }
}

function normalizarLinhasRemanejamentoServidor(linhas) {
  return (Array.isArray(linhas) ? linhas : [])
    .map(item => ({
      idCargoFuncao: converterNumeroDash(item.idCargoFuncao),
      quantidade: Math.max(0, converterNumeroDash(item.quantidade)),
      meses: Math.max(1, converterNumeroDash(item.meses) || 1)
    }))
    .filter(item => item.idCargoFuncao && item.quantidade > 0);
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
