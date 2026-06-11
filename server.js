require("dotenv").config();

const path = require("path");
const express = require("express");
const mysql = require("mysql2/promise");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Pool de conexões MySQL (inicializado sob demanda). Declarado no topo para evitar TDZ,
// já que a criação de tabelas no startup pode acessá-lo antes da posição original.
let mysqlPool = null;

const DASH_CONFIG = {
  TIMEZONE: "America/Sao_Paulo",
  LOGO_AGSUS_FILE: "/assets/images/Logo%20AgSUS%20sem%20fundo.png",
  BACKGROUND_FILE: "/assets/images/planodefundo.png",
  LOGO_COORDENACAO_FILE: "/assets/images/Logo%20COGIP.png",
  IMAGEM_INDIGENA_PAINEL_FILE: "/assets/images/upscalemedia-transformed.png",
  DASHBOARD_SAUDE_INDIGENA_URL: process.env.DASHBOARD_SAUDE_INDIGENA_URL || "",
  DASHBOARD_FERIAS_URL: process.env.DASHBOARD_FERIAS_URL || "",
  DB_SCHEMA: process.env.DB_SCHEMA || "u226895969_ugp",
  MONITORAMENTO_VIEW: process.env.MONITORAMENTO_VIEW || "VW_MONITORAMENTO_VAGAS_SAUDE_INDIGENA",
  ALERTAS_OBSERVACOES_TABLE: process.env.ALERTAS_OBSERVACOES_TABLE || "ALERTAS_OBSERVACOES",
  CUSTO_GERAL_VAGA_TABLE: process.env.CUSTO_GERAL_VAGA_TABLE || "CUSTO_GERAL_VAGA",
  // Modelo de remanejamento (1 processo SEI central + N movimentações tipadas).
  // Cada movimentação indica a vaga e o tipo: ACRESCIMO ou DECRESCIMO.
  PROCESSO_REMANEJAMENTO_TABLE: process.env.PROCESSO_REMANEJAMENTO_TABLE || "PROCESSO_REMANEJAMENTO",
  MOVIMENTACAO_REMANEJAMENTO_TABLE: process.env.MOVIMENTACAO_REMANEJAMENTO_TABLE || "MOVIMENTACAO_REMANEJAMENTO",
  USUARIOS_TABLE: process.env.USUARIOS_TABLE || "USUARIOS_PAINEL",
  JWT_SECRET: process.env.JWT_SECRET || "painel-vagas-si-dev-secret-trocar",
  JWT_EXPIRES: process.env.JWT_EXPIRES || "8h",
  // Login com Google (OAuth 2.0 / OpenID Connect). Sem CLIENT_ID, o botão Google fica oculto.
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "",
  // Domínios permitidos para login via Google (lista separada por vírgula). Vazio = qualquer domínio.
  GOOGLE_ALLOWED_DOMAIN: process.env.GOOGLE_ALLOWED_DOMAIN || "agenciasus.org.br",
  // E-mails liberados individualmente (lista separada por vírgula), independente do domínio.
  GOOGLE_ALLOWED_EMAILS: process.env.GOOGLE_ALLOWED_EMAILS || "",
  // Nível de autorização atribuído a um usuário Google novo (auto-cadastro).
  GOOGLE_NIVEL_PADRAO: Number(process.env.GOOGLE_NIVEL_PADRAO || 0),
  // Nível mínimo de autorização exigido por ação. Centraliza a regra de acesso;
  // novos níveis/páginas podem ser definidos futuramente.
  NIVEL_REMANEJAMENTO_SALVAR: Number(process.env.NIVEL_REMANEJAMENTO_SALVAR || 2),
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
    custo_dim AS (
      SELECT
        c.ID_DSEI_CASAI,
        c.ID_VAGA,
        (COALESCE(c.SALARIO_BASE,0) + COALESCE(c.INSALUBRIDADE_PERICULOSIDADE,0) + COALESCE(c.GRATIFICACAO_RT,0)
          + COALESCE(c.NOTURNO,0) + COALESCE(c.ENCARGOS,0) + COALESCE(c.PROVISOES,0)) AS mensal_unitario
      FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.CUSTO_GERAL_VAGA_TABLE}\` c
      JOIN (
        SELECT ID_DSEI_CASAI, ID_VAGA, MAX(ID_CUSTO_GERAL_VAGA) AS max_id
        FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.CUSTO_GERAL_VAGA_TABLE}\`
        GROUP BY ID_DSEI_CASAI, ID_VAGA
      ) ult ON ult.max_id = c.ID_CUSTO_GERAL_VAGA
    ),
    -- Movimentações de decréscimo (vagas reduzidas) agregadas por processo.
    red AS (
      SELECT
        m.ID_PROCESSO_REMANEJAMENTO AS id_processo,
        MAX(m.ID_DSEI_CASAI) AS id_dsei_casai,
        SUM(COALESCE(custo.mensal_unitario, 0) * m.QTD) AS total_mensal,
        GROUP_CONCAT(CONCAT(${montarCaseCargoSql("m.ID_VAGA", "cd")}, ' x', m.QTD) ORDER BY cd.cargo SEPARATOR ' | ') AS cargos
      FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.MOVIMENTACAO_REMANEJAMENTO_TABLE}\` m
      LEFT JOIN cargo_dim cd ON cd.id_cargo_funcao = m.ID_VAGA
      LEFT JOIN custo_dim custo ON custo.ID_DSEI_CASAI = m.ID_DSEI_CASAI AND custo.ID_VAGA = m.ID_VAGA
      WHERE m.TIPO_MOVIMENTACAO = 'DECRESCIMO'
      GROUP BY m.ID_PROCESSO_REMANEJAMENTO
    ),
    -- Movimentações de acréscimo (vagas acrescidas) agregadas por processo.
    acr AS (
      SELECT
        m.ID_PROCESSO_REMANEJAMENTO AS id_processo,
        MAX(m.ID_DSEI_CASAI) AS id_dsei_casai,
        SUM(COALESCE(custo.mensal_unitario, 0) * m.QTD) AS total_mensal,
        GROUP_CONCAT(CONCAT(${montarCaseCargoSql("m.ID_VAGA", "cd")}, ' x', m.QTD) ORDER BY cd.cargo SEPARATOR ' | ') AS cargos
      FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.MOVIMENTACAO_REMANEJAMENTO_TABLE}\` m
      LEFT JOIN cargo_dim cd ON cd.id_cargo_funcao = m.ID_VAGA
      LEFT JOIN custo_dim custo ON custo.ID_DSEI_CASAI = m.ID_DSEI_CASAI AND custo.ID_VAGA = m.ID_VAGA
      WHERE m.TIPO_MOVIMENTACAO = 'ACRESCIMO'
      GROUP BY m.ID_PROCESSO_REMANEJAMENTO
    )
    SELECT
      p.ID_PROCESSO_REMANEJAMENTO AS id_processo,
      p.DATA_INSERCAO AS data_inclusao,
      DATE_FORMAT(p.DATA_INSERCAO, '%d/%m/%Y %H:%i:%s') AS data_inclusao_formatada,
      DATE_FORMAT(p.DATA_INSERCAO, '%m/%Y') AS competencia,
      p.N_PROCESSO AS numero_processo_sei,
      p.OBSERVACAO AS observacao,
      p.CRIADO_POR AS criado_por,
      p.ANEXO_NOME_ARQUIVO AS anexo_nome_arquivo,
      p.ANEXO_MIME_TYPE AS anexo_mime_type,
      p.ANEXO_TAMANHO_BYTES AS anexo_tamanho_bytes,
      CASE WHEN p.ANEXO_PROCESSO IS NULL THEN 0 ELSE 1 END AS tem_anexo,
      COALESCE(red.id_dsei_casai, acr.id_dsei_casai) AS id_dsei_casai,
      CASE WHEN COALESCE(red.id_dsei_casai, acr.id_dsei_casai) = 9610501 THEN 'SAMU INDÍGENA'
           ELSE COALESCE(dd.dsei_casai, CONCAT('DSEI/CASAI ID ', COALESCE(red.id_dsei_casai, acr.id_dsei_casai))) END AS dsei_casai,
      red.cargos AS cargos_reduzidos,
      acr.cargos AS cargos_acrescentados,
      COALESCE(red.total_mensal, 0) AS total_reduzido_mensal,
      COALESCE(acr.total_mensal, 0) AS total_acrescentado_mensal,
      (COALESCE(acr.total_mensal, 0) - COALESCE(red.total_mensal, 0)) AS impacto_mensal,
      (COALESCE(red.total_mensal, 0) * (13 - MONTH(p.DATA_INSERCAO))) AS total_reduzido_periodo,
      (COALESCE(acr.total_mensal, 0) * (13 - MONTH(p.DATA_INSERCAO))) AS total_acrescentado_periodo,
      ((COALESCE(acr.total_mensal, 0) - COALESCE(red.total_mensal, 0)) * (13 - MONTH(p.DATA_INSERCAO))) AS impacto_periodo,
      'Registrado' AS situacao
    FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.PROCESSO_REMANEJAMENTO_TABLE}\` p
    LEFT JOIN red ON red.id_processo = p.ID_PROCESSO_REMANEJAMENTO
    LEFT JOIN acr ON acr.id_processo = p.ID_PROCESSO_REMANEJAMENTO
    LEFT JOIN dsei_dim dd ON dd.id_dsei_casai = COALESCE(red.id_dsei_casai, acr.id_dsei_casai)
    ORDER BY p.DATA_INSERCAO DESC
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
    ),
    custo_dim AS (
      SELECT
        c.ID_DSEI_CASAI,
        c.ID_VAGA,
        c.SALARIO_BASE,
        c.INSALUBRIDADE_PERICULOSIDADE,
        c.GRATIFICACAO_RT,
        c.NOTURNO,
        c.ENCARGOS,
        c.PROVISOES
      FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.CUSTO_GERAL_VAGA_TABLE}\` c
      JOIN (
        SELECT ID_DSEI_CASAI, ID_VAGA, MAX(ID_CUSTO_GERAL_VAGA) AS max_id
        FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.CUSTO_GERAL_VAGA_TABLE}\`
        GROUP BY ID_DSEI_CASAI, ID_VAGA
      ) ult ON ult.max_id = c.ID_CUSTO_GERAL_VAGA
    )
    SELECT
      vp.id_dsei_casai,
      CASE WHEN vp.id_dsei_casai = 9610501 THEN 'SAMU INDÍGENA'
           ELSE COALESCE(dd.dsei_casai, CONCAT('DSEI/CASAI ID ', vp.id_dsei_casai)) END AS dsei_casai,
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
      COALESCE(cgv.SALARIO_BASE, 0) AS salario_base,
      COALESCE(cgv.INSALUBRIDADE_PERICULOSIDADE, 0) AS insalubridade_periculosidade,
      COALESCE(cgv.GRATIFICACAO_RT, 0) AS gratificacao_rt,
      COALESCE(cgv.NOTURNO, 0) AS adicional_noturno,
      COALESCE(cgv.ENCARGOS, 0) AS encargos,
      COALESCE(cgv.PROVISOES, 0) AS provisoes,
      (
        COALESCE(cgv.SALARIO_BASE, 0) +
        COALESCE(cgv.INSALUBRIDADE_PERICULOSIDADE, 0) +
        COALESCE(cgv.GRATIFICACAO_RT, 0) +
        COALESCE(cgv.NOTURNO, 0) +
        COALESCE(cgv.ENCARGOS, 0) +
        COALESCE(cgv.PROVISOES, 0)
      ) AS valor_mensal,
      COALESCE(oci.vagas_ociosas, 0) AS vagas_ociosas
    FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`VAGAS_PREVISTAS\` vp
    LEFT JOIN dsei_dim dd
      ON dd.id_dsei_casai = vp.id_dsei_casai
    LEFT JOIN cargo_dim cd
      ON cd.id_cargo_funcao = vp.id_cargo_funcao
    LEFT JOIN custo_dim cgv
      ON cgv.ID_DSEI_CASAI = vp.id_dsei_casai AND cgv.ID_VAGA = vp.id_cargo_funcao
    LEFT JOIN \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.MONITORAMENTO_VIEW}\` oci
      ON oci.id_dsei_casai = vp.id_dsei_casai
     AND oci.id_cargo_funcao = (
       CASE
         WHEN vp.id_cargo_funcao IN (28, 29, 30, 104) THEN 104
         WHEN vp.id_cargo_funcao IN (77, 78, 79, 80, 81) THEN 81
         WHEN vp.id_cargo_funcao IN (102, 45) THEN 45
         ELSE vp.id_cargo_funcao
       END
     )
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
    dashboardSaudeIndigenaUrl: process.env.DASHBOARD_SAUDE_INDIGENA_URL || DASH_CONFIG.DASHBOARD_SAUDE_INDIGENA_URL,
    dashboardFeriasUrl: process.env.DASHBOARD_FERIAS_URL || DASH_CONFIG.DASHBOARD_FERIAS_URL,
    googleClientId: DASH_CONFIG.GOOGLE_CLIENT_ID
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

app.get("/api/alertas/observacoes", asyncHandler(async (req, res) => {
  res.json({ observacoes: await getAlertasObservacoesMap() });
}));

app.post("/api/alertas/observacao", express.json(), autenticarOpcionalMiddleware, asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const body = { ...(req.body || {}) };
    if (req.usuario) body.usuario = req.usuario.email || req.usuario.login || body.usuario;
    const resultado = await salvarObservacaoAlertaComConn(conn, body);
    res.json({ ok: true, ...resultado });
  } finally {
    await fecharJdbc(conn);
  }
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
      `SELECT ANEXO_PROCESSO, ANEXO_NOME_ARQUIVO, ANEXO_MIME_TYPE FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`PROCESSO_REMANEJAMENTO\` WHERE ID_PROCESSO_REMANEJAMENTO = ? LIMIT 1`,
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

app.get("/api/remanejamento/detalhe/:id", asyncHandler(async (req, res) => {
  res.json(await getRemanejamentoDetalheData(req.params.id));
}));

app.delete(
  "/api/remanejamento/:id",
  autenticarMiddleware,
  exigirNivelMiddleware(DASH_CONFIG.NIVEL_REMANEJAMENTO_SALVAR),
  asyncHandler(async (req, res) => {
    const conn = await getMysqlConnection();
    try {
      await excluirRemanejamentoComConn(conn, req.params.id);
      limparCacheDashboard();
      res.json({ ok: true });
    } finally {
      await fecharJdbc(conn);
    }
  })
);

app.post("/api/login", express.json(), asyncHandler(async (req, res) => {
  try {
    const resultado = await autenticarUsuario(req.body || {});
    res.json(resultado);
  } catch (err) {
    res.status(401).json({ error: err && err.message ? err.message : "Falha na autenticação." });
  }
}));

app.post("/api/login/google", express.json(), asyncHandler(async (req, res) => {
  try {
    const resultado = await autenticarUsuarioGoogle(req.body || {});
    res.json(resultado);
  } catch (err) {
    res.status(401).json({ error: err && err.message ? err.message : "Falha na autenticação Google." });
  }
}));

app.post("/api/logout", (req, res) => {
  // Autenticação é stateless (JWT). O cliente apenas descarta o token.
  res.json({ ok: true });
});

app.get("/api/sessao", autenticarMiddleware, (req, res) => {
  res.json({ usuario: req.usuario });
});

app.post(
  "/api/remanejamento/salvar",
  autenticarMiddleware,
  exigirNivelMiddleware(DASH_CONFIG.NIVEL_REMANEJAMENTO_SALVAR),
  upload.single("anexo"),
  asyncHandler(async (req, res) => {
    const conn = await getMysqlConnection();
    try {
      const body = { ...(req.body || {}), criadoPor: (req.usuario && (req.usuario.email || req.usuario.login)) || "painel" };
      const resultado = await salvarRemanejamentoComConn(conn, body, req.file || null);
      limparCacheDashboard();
      res.json({ ok: true, ...resultado });
    } finally {
      await fecharJdbc(conn);
    }
  })
);

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

  garantirTabelaAlertasObservacoes().catch(err => {
    console.error("Não foi possível garantir a tabela de observações de alertas:", err && err.message ? err.message : err);
  });

  garantirTabelaUsuarios().catch(err => {
    console.error("Não foi possível garantir a tabela de usuários do painel:", err && err.message ? err.message : err);
  });

  garantirTabelaMovimentacaoRemanejamento().catch(err => {
    console.error("Não foi possível garantir a tabela de movimentações de remanejamento:", err && err.message ? err.message : err);
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
  const observacoes = await getAlertasObservacoesMap();

  return {
    rows,
    observacoes,
    atualizadoEm: obterUltimaAtualizacaoDash(rows)
  };
}

async function garantirTabelaMovimentacaoRemanejamento() {
  const conn = await getMysqlConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.MOVIMENTACAO_REMANEJAMENTO_TABLE}\` (
        \`ID_MOVIMENTACAO_REMANEJAMENTO\` INT(11) NOT NULL AUTO_INCREMENT,
        \`ID_PROCESSO_REMANEJAMENTO\`     INT(11) NOT NULL,
        \`ID_DSEI_CASAI\`                 INT(11) NOT NULL,
        \`ID_VAGA\`                       INT(11) NOT NULL,
        \`TIPO_MOVIMENTACAO\`             ENUM('ACRESCIMO','DECRESCIMO') NOT NULL,
        \`QTD\`                           INT(11) NOT NULL DEFAULT 1,
        \`DATA_INSERCAO\`                 DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`ID_MOVIMENTACAO_REMANEJAMENTO\`),
        KEY \`IDX_MOV_PROCESSO\` (\`ID_PROCESSO_REMANEJAMENTO\`),
        KEY \`IDX_MOV_DSEI_VAGA\` (\`ID_DSEI_CASAI\`, \`ID_VAGA\`),
        CONSTRAINT \`FK_MOV_PROCESSO\` FOREIGN KEY (\`ID_PROCESSO_REMANEJAMENTO\`)
          REFERENCES \`${DASH_CONFIG.PROCESSO_REMANEJAMENTO_TABLE}\` (\`ID_PROCESSO_REMANEJAMENTO\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } finally {
    await fecharJdbc(conn);
  }
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

// ===================== Autenticação e níveis de acesso =====================

async function garantirTabelaUsuarios() {
  const conn = await getMysqlConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.USUARIOS_TABLE}\` (
        \`ID_USUARIO\`         BIGINT NOT NULL AUTO_INCREMENT,
        \`LOGIN\`              VARCHAR(120) NOT NULL,
        \`SENHA_HASH\`         VARCHAR(255) NOT NULL,
        \`NOME\`               VARCHAR(255) NULL,
        \`EMAIL\`              VARCHAR(255) NULL,
        \`NIVEL_AUTORIZACAO\`  INT NOT NULL DEFAULT 0,
        \`ATIVO\`              TINYINT NOT NULL DEFAULT 1,
        \`CRIADO_EM\`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`ATUALIZADO_EM\`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`ID_USUARIO\`),
        UNIQUE KEY \`UQ_${DASH_CONFIG.USUARIOS_TABLE}_LOGIN\` (\`LOGIN\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Seed de um usuário administrador inicial somente quando a tabela está vazia.
    const [rows] = await conn.query(
      `SELECT COUNT(*) AS total FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.USUARIOS_TABLE}\``
    );
    const total = rows && rows[0] ? Number(rows[0].total) : 0;

    if (total === 0) {
      const login = process.env.SEED_ADMIN_LOGIN || "admin";
      const senha = process.env.SEED_ADMIN_SENHA || "AgSUS@2026";
      const nome = process.env.SEED_ADMIN_NOME || "Administrador";
      const email = process.env.SEED_ADMIN_EMAIL || "";
      const hash = await bcrypt.hash(senha, 10);

      await conn.execute(
        `INSERT INTO \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.USUARIOS_TABLE}\`
           (\`LOGIN\`, \`SENHA_HASH\`, \`NOME\`, \`EMAIL\`, \`NIVEL_AUTORIZACAO\`, \`ATIVO\`)
         VALUES (?, ?, ?, ?, 2, 1)`,
        [login, hash, nome, email || null]
      );

      console.warn(
        `[ATENÇÃO] Usuário administrador inicial criado (login: "${login}"). ` +
        "Defina SEED_ADMIN_LOGIN/SEED_ADMIN_SENHA no .env e troque a senha padrão assim que possível."
      );
    }
  } finally {
    await fecharJdbc(conn);
  }
}

async function autenticarUsuario(body) {
  const login = limparValorDash(body.login || body.usuario);
  const senha = String(body.senha || "");

  if (!login || !senha) throw new Error("Informe usuário e senha.");

  const conn = await getMysqlConnection();
  try {
    const [rows] = await conn.query(
      `SELECT \`ID_USUARIO\`, \`LOGIN\`, \`SENHA_HASH\`, \`NOME\`, \`EMAIL\`, \`NIVEL_AUTORIZACAO\`, \`ATIVO\`
         FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.USUARIOS_TABLE}\`
        WHERE \`LOGIN\` = ? LIMIT 1`,
      [login]
    );

    const registro = rows && rows[0] ? rows[0] : null;
    if (!registro || Number(registro.ATIVO) !== 1) {
      throw new Error("Usuário ou senha inválidos.");
    }

    const senhaConfere = await bcrypt.compare(senha, String(registro.SENHA_HASH || ""));
    if (!senhaConfere) {
      throw new Error("Usuário ou senha inválidos.");
    }

    const usuario = {
      id: Number(registro.ID_USUARIO),
      login: limparValorDash(registro.LOGIN),
      nome: limparValorDash(registro.NOME),
      email: limparValorDash(registro.EMAIL),
      nivelAutorizacao: Number(registro.NIVEL_AUTORIZACAO || 0)
    };

    const token = jwt.sign(usuario, DASH_CONFIG.JWT_SECRET, { expiresIn: DASH_CONFIG.JWT_EXPIRES });
    return { token, usuario };
  } finally {
    await fecharJdbc(conn);
  }
}

let googleOAuthClient = null;
function getGoogleClient() {
  if (!DASH_CONFIG.GOOGLE_CLIENT_ID) return null;
  if (!googleOAuthClient) googleOAuthClient = new OAuth2Client(DASH_CONFIG.GOOGLE_CLIENT_ID);
  return googleOAuthClient;
}

// Login via Google (OpenID Connect). Recebe o ID token do cliente, valida com o
// Google, confere o domínio permitido e reaproveita o mesmo JWT/permissões do painel.
async function autenticarUsuarioGoogle(body) {
  const credential = String((body && body.credential) || "");
  if (!credential) throw new Error("Token do Google ausente.");

  const client = getGoogleClient();
  if (!client) throw new Error("Login com Google não está configurado no servidor.");

  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: DASH_CONFIG.GOOGLE_CLIENT_ID
    });
    payload = ticket.getPayload();
  } catch (e) {
    throw new Error("Não foi possível validar o login do Google.");
  }

  const email = String((payload && payload.email) || "").trim().toLowerCase();
  const emailVerificado = !!(payload && payload.email_verified);
  const nome = String((payload && payload.name) || email);

  if (!email || !emailVerificado) {
    throw new Error("Conta Google sem e-mail verificado.");
  }

  // E-mails liberados individualmente (lista separada por vírgula). Útil para pessoas
  // externas pontuais (ex.: usuários de teste) sem precisar liberar o domínio inteiro.
  const emailsPermitidos = String(DASH_CONFIG.GOOGLE_ALLOWED_EMAILS || "")
    .toLowerCase()
    .split(",")
    .map(e => e.trim())
    .filter(Boolean);
  const emailLiberadoIndividualmente = emailsPermitidos.includes(email);

  // Domínios permitidos: lista separada por vírgula (ex.: "agenciasus.org.br, outro.com").
  // Vazio = qualquer domínio. Mantém o acesso restrito mesmo com a tela de consentimento "External".
  const dominiosPermitidos = String(DASH_CONFIG.GOOGLE_ALLOWED_DOMAIN || "")
    .toLowerCase()
    .split(",")
    .map(d => d.trim())
    .filter(Boolean);

  // Se o e-mail está na allowlist individual, libera direto (ignora a checagem de domínio).
  if (!emailLiberadoIndividualmente && dominiosPermitidos.length) {
    const dominioConta = String((payload && payload.hd) || email.split("@")[1] || "").toLowerCase();
    if (!dominiosPermitidos.includes(dominioConta)) {
      throw new Error(`Seu domínio (@${dominioConta}) não tem acesso a este painel.`);
    }
  }

  const tabela = `\`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.USUARIOS_TABLE}\``;
  const selectPorEmail =
    `SELECT \`ID_USUARIO\`, \`LOGIN\`, \`NOME\`, \`EMAIL\`, \`NIVEL_AUTORIZACAO\`, \`ATIVO\`
       FROM ${tabela} WHERE \`EMAIL\` = ? LIMIT 1`;

  const conn = await getMysqlConnection();
  try {
    let [rows] = await conn.query(selectPorEmail, [email]);
    let registro = rows && rows[0] ? rows[0] : null;

    if (registro && Number(registro.ATIVO) !== 1) {
      throw new Error("Usuário inativo. Procure o administrador.");
    }

    // Auto-cadastro: usuário do domínio ainda não existe -> cria com nível padrão.
    if (!registro) {
      // Guarda apenas a parte do e-mail antes do "@" como LOGIN (descarta o domínio).
      const loginCurto = email.split("@")[0];
      await conn.execute(
        `INSERT INTO ${tabela}
           (\`LOGIN\`, \`SENHA_HASH\`, \`NOME\`, \`EMAIL\`, \`NIVEL_AUTORIZACAO\`, \`ATIVO\`)
         VALUES (?, '', ?, ?, ?, 1)`,
        [loginCurto, nome, email, DASH_CONFIG.GOOGLE_NIVEL_PADRAO]
      );
      [rows] = await conn.query(selectPorEmail, [email]);
      registro = rows && rows[0] ? rows[0] : null;
    }

    if (!registro) throw new Error("Falha ao registrar o usuário do Google.");

    const usuario = {
      id: Number(registro.ID_USUARIO),
      login: limparValorDash(registro.LOGIN),
      nome: limparValorDash(registro.NOME),
      email: limparValorDash(registro.EMAIL),
      nivelAutorizacao: Number(registro.NIVEL_AUTORIZACAO || 0)
    };

    const token = jwt.sign(usuario, DASH_CONFIG.JWT_SECRET, { expiresIn: DASH_CONFIG.JWT_EXPIRES });
    return { token, usuario };
  } finally {
    await fecharJdbc(conn);
  }
}

function lerTokenDaRequisicao(req) {
  const header = String(req.headers.authorization || req.headers.Authorization || "");
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  return "";
}

function verificarToken(token) {
  try {
    const payload = jwt.verify(token, DASH_CONFIG.JWT_SECRET);
    return {
      id: payload.id,
      login: payload.login,
      nome: payload.nome,
      email: payload.email,
      nivelAutorizacao: Number(payload.nivelAutorizacao || 0)
    };
  } catch (err) {
    return null;
  }
}

function autenticarMiddleware(req, res, next) {
  const usuario = verificarToken(lerTokenDaRequisicao(req));
  if (!usuario) {
    res.status(401).json({ error: "Sessão expirada ou inválida. Faça login novamente." });
    return;
  }
  req.usuario = usuario;
  next();
}

function autenticarOpcionalMiddleware(req, res, next) {
  const usuario = verificarToken(lerTokenDaRequisicao(req));
  if (usuario) req.usuario = usuario;
  next();
}

function exigirNivelMiddleware(nivelMinimo) {
  return function (req, res, next) {
    const nivel = req.usuario ? Number(req.usuario.nivelAutorizacao || 0) : 0;
    if (nivel < nivelMinimo) {
      res.status(403).json({ error: "Você não tem permissão para esta ação." });
      return;
    }
    next();
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
    valorMensal,
    vagasOciosas: converterNumeroDash(row.vagas_ociosas)
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

  // N_MESES derivado: do mês atual (criação) até o fim do ano (dezembro).
  const meses = mesesAteFimDoAno();

  // Custos sempre recalculados no servidor a partir de CUSTO_GERAL_VAGA (por DSEI + vaga),
  // ignorando os valores enviados pelo cliente, que servem apenas para visualização.
  const custos = await buscarCustosVagaPorDseiComConn(conn, idDseiCasai);
  const resumoReduzido = calcularResumoLinhasServidor(linhasReduzido, custos, meses);
  const resumoAcrescentado = calcularResumoLinhasServidor(linhasAcrescentado, custos, meses);
  const impactoMensal = resumoAcrescentado.mensal - resumoReduzido.mensal;
  const impactoPeriodo = resumoAcrescentado.periodo - resumoReduzido.periodo;

  // Espelha a regra do Apps Script: o remanejamento não pode aumentar o custo.
  if (impactoMensal > 0 || impactoPeriodo > 0) {
    throw new Error(
      "Remanejamento bloqueado: o impacto financeiro está positivo, indicando aumento de custo. " +
      "Ajuste os cargos para que o impacto mensal e do período fiquem zerados ou negativos."
    );
  }

  // Só é possível reduzir cargos que possuem vagas ociosas suficientes no DSEI/CASAI.
  await validarVagasOciosasReduzidoComConn(conn, idDseiCasai, linhasReduzido);

  await conn.beginTransaction();

  try {
    // 1) Processo (PROCESSO_REMANEJAMENTO, com anexo em BLOB).
    const [procResult] = await conn.execute(
      `INSERT INTO \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.PROCESSO_REMANEJAMENTO_TABLE}\` (
        N_PROCESSO,
        OBSERVACAO,
        CRIADO_POR,
        ANEXO_PROCESSO,
        ANEXO_NOME_ARQUIVO,
        ANEXO_MIME_TYPE,
        ANEXO_TAMANHO_BYTES
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        processoSei,
        observacao || null,
        criadoPor || null,
        file ? file.buffer : null,
        file ? file.originalname : null,
        file ? file.mimetype : null,
        file ? file.size : null
      ]
    );

    const idProcesso = procResult.insertId;

    // 2) Modelo 1 processo -> N movimentações tipadas. Cada cargo vira uma linha em
    // MOVIMENTACAO_REMANEJAMENTO, com TIPO_MOVIMENTACAO indicando se é DECRESCIMO ou ACRESCIMO.
    const inserirMovimentacao = (linha, tipo) => conn.execute(
      `INSERT INTO \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.MOVIMENTACAO_REMANEJAMENTO_TABLE}\` (
        ID_PROCESSO_REMANEJAMENTO, ID_DSEI_CASAI, ID_VAGA, TIPO_MOVIMENTACAO, QTD
      ) VALUES (?, ?, ?, ?, ?)`,
      [idProcesso, idDseiCasai, linha.idCargoFuncao, tipo, linha.quantidade]
    );

    for (const linha of linhasReduzido) {
      await inserirMovimentacao(linha, "DECRESCIMO");
    }

    for (const linha of linhasAcrescentado) {
      await inserirMovimentacao(linha, "ACRESCIMO");
    }

    await conn.commit();
    return { idProcesso, impactoMensal, impactoPeriodo };
  } catch (err) {
    await conn.rollback();
    throw err;
  }
}

// Mapeia o ID_VAGA (cargo) para o mesmo agrupamento usado em vagas_previstas_agg da view,
// para casar a redução solicitada com a linha consolidada de vagas ociosas.
function mapearCargoParaPrevistas(idCargo) {
  const id = Number(idCargo);
  if ([28, 29, 30, 104].includes(id)) return 104;
  if ([77, 78, 79, 80, 81].includes(id)) return 81;
  if ([102, 45].includes(id)) return 45;
  return id;
}

// Valida, contra a view de monitoramento, se cada cargo a ser reduzido possui vagas
// ociosas suficientes no DSEI/CASAI. A view já desconta os remanejamentos anteriores,
// portanto a verificação é cumulativa. Lança erro (bloqueando o salvamento) se faltar.
async function validarVagasOciosasReduzidoComConn(conn, idDseiCasai, linhasReduzido) {
  const [rows] = await conn.query(
    `SELECT \`id_cargo_funcao\`, \`cargo\`, COALESCE(\`vagas_ociosas\`, 0) AS vagas_ociosas
     FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.MONITORAMENTO_VIEW}\`
     WHERE \`id_dsei_casai\` = ?`,
    [idDseiCasai]
  );

  const ociosasPorCargo = {};
  (rows || []).forEach(r => {
    ociosasPorCargo[Number(r.id_cargo_funcao)] = {
      cargo: r.cargo,
      ociosas: Number(r.vagas_ociosas) || 0
    };
  });

  // Agrega a redução solicitada por cargo consolidado (vários ID_VAGA podem cair na mesma linha).
  const reducaoPorCargo = {};
  linhasReduzido.forEach(linha => {
    const idMapeado = mapearCargoParaPrevistas(linha.idCargoFuncao);
    reducaoPorCargo[idMapeado] = (reducaoPorCargo[idMapeado] || 0) + (Number(linha.quantidade) || 0);
  });

  const erros = [];
  Object.keys(reducaoPorCargo).forEach(idCargo => {
    const solicitado = reducaoPorCargo[idCargo];
    const info = ociosasPorCargo[Number(idCargo)] || { cargo: `cargo ${idCargo}`, ociosas: 0 };
    const disponivel = Math.max(0, Math.floor(info.ociosas));
    if (solicitado > disponivel) {
      erros.push(
        `${info.cargo}: ${disponivel} vaga(s) ociosa(s) disponível(is), mas foram solicitadas ${solicitado} para redução`
      );
    }
  });

  if (erros.length) {
    throw new Error(
      "Remanejamento bloqueado: não há vagas ociosas suficientes para reduzir os seguintes cargos neste DSEI/CASAI — " +
      erros.join("; ") + "."
    );
  }
}

// Número de meses do mês atual até dezembro do ano corrente (ex.: junho => 7, dezembro => 1).
function mesesAteFimDoAno() {
  const mes = new Date().getMonth() + 1; // 1..12
  return Math.max(1, 13 - mes);
}

async function buscarCustosVagaPorDseiComConn(conn, idDseiCasai) {
  const [rows] = await conn.query(
    `SELECT
       c.ID_VAGA,
       c.SALARIO_BASE,
       c.INSALUBRIDADE_PERICULOSIDADE,
       c.GRATIFICACAO_RT,
       c.NOTURNO,
       c.ENCARGOS,
       c.PROVISOES
     FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.CUSTO_GERAL_VAGA_TABLE}\` c
     JOIN (
       SELECT ID_VAGA, MAX(ID_CUSTO_GERAL_VAGA) AS max_id
       FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.CUSTO_GERAL_VAGA_TABLE}\`
       WHERE ID_DSEI_CASAI = ?
       GROUP BY ID_VAGA
     ) ult ON ult.max_id = c.ID_CUSTO_GERAL_VAGA
     WHERE c.ID_DSEI_CASAI = ?`,
    [idDseiCasai, idDseiCasai]
  );

  const mapa = {};
  (rows || []).forEach(row => {
    const mensal =
      converterNumeroDash(row.SALARIO_BASE) +
      converterNumeroDash(row.INSALUBRIDADE_PERICULOSIDADE) +
      converterNumeroDash(row.GRATIFICACAO_RT) +
      converterNumeroDash(row.NOTURNO) +
      converterNumeroDash(row.ENCARGOS) +
      converterNumeroDash(row.PROVISOES);
    mapa[String(converterNumeroDash(row.ID_VAGA))] = mensal;
  });

  return mapa;
}

function calcularResumoLinhasServidor(linhas, custos, meses) {
  const mesesEfetivo = Math.max(1, Number(meses || 1));
  return (linhas || []).reduce((acc, linha) => {
    const mensalUnitario = Number(custos[String(linha.idCargoFuncao)] || 0);
    const mensal = mensalUnitario * Number(linha.quantidade || 0);
    acc.mensal += mensal;
    acc.periodo += mensal * mesesEfetivo;
    return acc;
  }, { mensal: 0, periodo: 0 });
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

// Exclui um remanejamento: remove as movimentações (MOVIMENTACAO_REMANEJAMENTO) e o
// processo (PROCESSO_REMANEJAMENTO), em transação.
async function excluirRemanejamentoComConn(conn, idProcesso) {
  const id = converterNumeroDash(idProcesso);
  if (!id) throw new Error("Remanejamento inválido.");

  await conn.beginTransaction();
  try {
    // 1) Remove as movimentações do processo.
    await conn.execute(
      `DELETE FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.MOVIMENTACAO_REMANEJAMENTO_TABLE}\`
        WHERE ID_PROCESSO_REMANEJAMENTO = ?`,
      [id]
    );

    // 2) Remove o processo.
    await conn.execute(
      `DELETE FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.PROCESSO_REMANEJAMENTO_TABLE}\` WHERE ID_PROCESSO_REMANEJAMENTO = ?`,
      [id]
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  }
}

// CASE de nome de cargo (mesmo mapeamento usado nas demais consultas de remanejamento).
function montarCaseCargoSql(coluna, cargoDimAlias) {
  return `COALESCE(
    CASE ${coluna}
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
    ${cargoDimAlias}.cargo,
    CONCAT('CARGO ID ', ${coluna})
  )`;
}

// Monta a consulta de detalhe para um tipo de movimentação (DECRESCIMO ou ACRESCIMO).
function montarSqlDetalheMovimentacao() {
  return `
    WITH
    cargo_dim AS (
      SELECT CAST(CARGO_ATUAL_ID AS UNSIGNED) AS id_cargo_funcao, MAX(CARGO_ATUAL_DESC) AS cargo
      FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`VW_SAUDE_INDIGENA\`
      GROUP BY CAST(CARGO_ATUAL_ID AS UNSIGNED)
    ),
    custo_dim AS (
      SELECT c.ID_DSEI_CASAI, c.ID_VAGA, c.SALARIO_BASE, c.INSALUBRIDADE_PERICULOSIDADE,
             c.GRATIFICACAO_RT, c.NOTURNO, c.ENCARGOS, c.PROVISOES
      FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.CUSTO_GERAL_VAGA_TABLE}\` c
      JOIN (
        SELECT ID_DSEI_CASAI, ID_VAGA, MAX(ID_CUSTO_GERAL_VAGA) AS max_id
        FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.CUSTO_GERAL_VAGA_TABLE}\`
        GROUP BY ID_DSEI_CASAI, ID_VAGA
      ) ult ON ult.max_id = c.ID_CUSTO_GERAL_VAGA
    )
    SELECT
      (13 - MONTH(p.DATA_INSERCAO)) AS n_meses,
      ${montarCaseCargoSql("m.ID_VAGA", "cd")} AS cargo,
      m.QTD AS qtd,
      COALESCE(cu.SALARIO_BASE, 0) AS salario,
      COALESCE(cu.INSALUBRIDADE_PERICULOSIDADE, 0) AS insal,
      COALESCE(cu.GRATIFICACAO_RT, 0) AS grat,
      COALESCE(cu.NOTURNO, 0) AS noturno,
      COALESCE(cu.ENCARGOS, 0) AS encargos,
      COALESCE(cu.PROVISOES, 0) AS provisoes
    FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.MOVIMENTACAO_REMANEJAMENTO_TABLE}\` m
    JOIN \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.PROCESSO_REMANEJAMENTO_TABLE}\` p
      ON p.ID_PROCESSO_REMANEJAMENTO = m.ID_PROCESSO_REMANEJAMENTO
    LEFT JOIN cargo_dim cd ON cd.id_cargo_funcao = m.ID_VAGA
    LEFT JOIN custo_dim cu ON cu.ID_DSEI_CASAI = m.ID_DSEI_CASAI AND cu.ID_VAGA = m.ID_VAGA
    WHERE m.ID_PROCESSO_REMANEJAMENTO = ? AND m.TIPO_MOVIMENTACAO = ?
  `;
}

async function getRemanejamentoDetalheData(idProcesso) {
  const id = converterNumeroDash(idProcesso);
  if (!id) throw new Error("Remanejamento inválido.");

  const sqlDetalhe = montarSqlDetalheMovimentacao();

  const conn = await getMysqlConnection();
  try {
    const [linhasRed] = await conn.query(sqlDetalhe, [id, "DECRESCIMO"]);
    const [linhasAcr] = await conn.query(sqlDetalhe, [id, "ACRESCIMO"]);

    const meses = Math.max(1, Number((linhasRed[0] || linhasAcr[0] || {}).n_meses || mesesAteFimDoAno()));

    const reduzidos = (linhasRed || []).map(l => montarItemDetalheRemanejamento(l, meses));
    const acrescentados = (linhasAcr || []).map(l => montarItemDetalheRemanejamento(l, meses));

    const totalReduzidoMensal = reduzidos.reduce((s, i) => s + i.mensal, 0);
    const totalAcrescentadoMensal = acrescentados.reduce((s, i) => s + i.mensal, 0);

    return {
      idProcesso: id,
      meses,
      reduzidos,
      acrescentados,
      totalReduzidoMensal,
      totalAcrescentadoMensal,
      totalReduzidoPeriodo: totalReduzidoMensal * meses,
      totalAcrescentadoPeriodo: totalAcrescentadoMensal * meses,
      impactoMensal: totalAcrescentadoMensal - totalReduzidoMensal,
      impactoPeriodo: (totalAcrescentadoMensal - totalReduzidoMensal) * meses
    };
  } finally {
    await fecharJdbc(conn);
  }
}

function montarItemDetalheRemanejamento(linha, meses) {
  const quantidade = converterNumeroDash(linha.qtd);
  const salario = converterNumeroDash(linha.salario) * quantidade;
  const insalubridade = converterNumeroDash(linha.insal) * quantidade;
  const gratificacaoRt = converterNumeroDash(linha.grat) * quantidade;
  const noturno = converterNumeroDash(linha.noturno) * quantidade;
  const encargos = converterNumeroDash(linha.encargos) * quantidade;
  const provisoes = converterNumeroDash(linha.provisoes) * quantidade;
  const mensal = salario + insalubridade + gratificacaoRt + noturno + encargos + provisoes;

  return {
    cargo: limparValorDash(linha.cargo),
    quantidade,
    meses,
    salario,
    insalubridade,
    gratificacaoRt,
    noturno,
    encargos,
    provisoes,
    mensal,
    periodo: mensal * meses
  };
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
  // Vagas preenchidas = trabalhadores contratados (dado correto).
  const vagasPreenchidas = contratados;
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
  if (!resource) return;
  // Conexões obtidas do pool devem ser devolvidas (release), não encerradas (end).
  if (typeof resource.release === "function") {
    try { resource.release(); } catch (e) {}
    return;
  }
  if (typeof resource.end === "function") {
    await resource.end();
  }
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

function getMysqlPool() {
  if (!mysqlPool) {
    const config = getMysqlConfig();
    mysqlPool = mysql.createPool({
      ...config,
      waitForConnections: true,
      connectionLimit: Number(process.env.MYSQL_POOL_LIMIT || 5),
      maxIdle: Number(process.env.MYSQL_POOL_LIMIT || 5),
      idleTimeout: 60000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
      connectTimeout: Number(process.env.MYSQL_CONNECT_TIMEOUT || 20000)
    });
  }
  return mysqlPool;
}

const ERROS_CONEXAO_TRANSITORIOS = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "PROTOCOL_CONNECTION_LOST",
  "EPIPE"
]);

function aguardar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Obtém uma conexão do pool, com novas tentativas em falhas transitórias de rede
// (ex.: ETIMEDOUT no MySQL remoto), evitando que um soluço de conexão derrube a requisição.
async function getMysqlConnection() {
  const pool = getMysqlPool();
  const tentativas = Number(process.env.MYSQL_CONNECT_RETRIES || 2);
  let ultimoErro = null;

  for (let i = 0; i <= tentativas; i += 1) {
    try {
      return await pool.getConnection();
    } catch (err) {
      ultimoErro = err;
      const code = err && err.code ? err.code : "";
      if (!ERROS_CONEXAO_TRANSITORIOS.has(code) || i === tentativas) {
        throw err;
      }
      await aguardar(400 * (i + 1));
    }
  }

  throw ultimoErro;
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

// Exporta funções internas para os testes automatizados (test/*.test.js).
// Não altera o uso de server.js como app Express (module.exports = app, acima);
// apenas anexa referências para podermos testar a gravação de dados isoladamente.
Object.assign(module.exports, {
  _salvarObservacaoAlertaComConn: salvarObservacaoAlertaComConn,
  _salvarRemanejamentoComConn: salvarRemanejamentoComConn,
  _normalizarLinhasRemanejamentoServidor: normalizarLinhasRemanejamentoServidor,
  _calcularResumoLinhasServidor: calcularResumoLinhasServidor,
  _mapearCargoParaPrevistas: mapearCargoParaPrevistas,
  _mesesAteFimDoAno: mesesAteFimDoAno,
  _limparValorDash: limparValorDash,
  _converterNumeroDash: converterNumeroDash
});
