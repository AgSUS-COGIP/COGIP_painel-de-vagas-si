require("dotenv").config();

const path = require("path");
const express = require("express");
const rateLimit = require("express-rate-limit");
const mysql = require("mysql2/promise");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const { DASH_CONFIG, getMysqlConfig, resolverPortaAplicacao, parseJdbcUrl } = require("./lib/config");
const { DASH_SQL, montarCaseCargoSql } = require("./lib/sql");
const { getRemanejamentoListaData, getRemanejamentoCadastroData, getRemanejamentoDetalheData, salvarRemanejamentoComConn, excluirRemanejamentoComConn, garantirTabelaMovimentacaoRemanejamento, obterRemanejamentoListaComCache, obterRemanejamentoCadastroComCache, montarOpcoesRemanejamentoAPartirDasRows, obterUltimaAtualizacaoRemanejamento, normalizarLinhasRemanejamentoServidor, calcularResumoLinhasServidor, mapearCargoParaPrevistas } = require("./lib/remanejamento");
const { getDashboardData, getDashboardResumoData, getDashboardApoioData, getVagasData, getAlertasData, getAlertasObservacoesMap, salvarObservacaoAlertaComConn, garantirTabelaAlertasObservacoes } = require("./lib/dashboard");
const { limparValorDash, converterNumeroDash, normalizarChaveDash, formatarDataBancoDash, extrairCompetenciaDash, nomeMesDash, obterUltimaAtualizacaoDash, somaServidor, mesesAteFimDoAno, formatDateInTimeZone, aguardar } = require("./lib/utils");
const { getMysqlPool, getMysqlConnection, fecharJdbc, obterOuCarregarJsonCache, limparCacheDashboard, executarConsultaComConn } = require("./lib/db");
const { garantirTabelaSolicitacoesAcesso, salvarSolicitacaoAcessoComConn, obterListasAcesso, obterSituacaoAcessoComConn, listarSolicitacoesComConn, definirNivelUsuarioComConn, aprovarSolicitacaoComConn, recusarSolicitacaoComConn, excluirUsuarioComConn } = require("./lib/acesso");
const { autenticarUsuario, autenticarUsuarioGoogle, obterUsuarioAtualComConn, autenticarMiddleware, autenticarFrescoMiddleware, autenticarOpcionalMiddleware, exigirNivelMiddleware, exigirAprovadoMiddleware, garantirTabelaUsuarios } = require("./lib/auth");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.set("trust proxy", Number(process.env.TRUST_PROXY || 1));

const apiLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60 * 1000),
  max: Number(process.env.RATE_LIMIT_MAX || 300),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas requisições. Tente novamente em instantes." }
});

// Limite mais rígido para o login (mitiga força bruta de senha).
const loginLimiter = rateLimit({
  windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX || 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas tentativas de login. Aguarde alguns minutos e tente novamente." }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/config", apiLimiter, (req, res) => {
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

app.get("/api/dashboard", apiLimiter, asyncHandler(async (req, res) => {
  res.json(await getDashboardData());
}));

app.get("/api/dashboard/resumo", apiLimiter, asyncHandler(async (req, res) => {
  res.json(await getDashboardResumoData());
}));

app.get("/api/dashboard/apoio", apiLimiter, asyncHandler(async (req, res) => {
  res.json(await getDashboardApoioData());
}));

app.get("/api/vagas", apiLimiter, asyncHandler(async (req, res) => {
  res.json(await getVagasData());
}));

app.get("/api/alertas", apiLimiter, asyncHandler(async (req, res) => {
  res.json(await getAlertasData());
}));

app.get("/api/alertas/observacoes", apiLimiter, asyncHandler(async (req, res) => {
  res.json({ observacoes: await getAlertasObservacoesMap() });
}));

app.post("/api/alertas/observacao", apiLimiter, express.json(), autenticarOpcionalMiddleware, asyncHandler(async (req, res) => {
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

app.get("/api/remanejamento/lista", apiLimiter, asyncHandler(async (req, res) => {
  res.json(await getRemanejamentoListaData());
}));

app.get("/api/remanejamento/cadastro", apiLimiter, asyncHandler(async (req, res) => {
  res.json(await getRemanejamentoCadastroData());
}));

app.get("/api/remanejamento/anexo/:id", apiLimiter, asyncHandler(async (req, res) => {
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

app.get("/api/remanejamento/detalhe/:id", apiLimiter, asyncHandler(async (req, res) => {
  res.json(await getRemanejamentoDetalheData(req.params.id));
}));

app.delete(
  "/api/remanejamento/:id",
  apiLimiter,
  autenticarFrescoMiddleware,
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

app.post("/api/login", loginLimiter, express.json(), asyncHandler(async (req, res) => {
  try {
    const resultado = await autenticarUsuario(req.body || {});
    res.json(resultado);
  } catch (err) {
    res.status(401).json({ error: err && err.message ? err.message : "Falha na autenticação." });
  }
}));

app.post("/api/login/google", loginLimiter, express.json(), asyncHandler(async (req, res) => {
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

app.get("/api/sessao", apiLimiter, autenticarMiddleware, asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const usuario = await obterUsuarioAtualComConn(conn, req.usuario);
    if (!usuario) {
      // Usuário foi excluído do banco -> encerra a sessão (cliente faz logout).
      res.status(401).json({ error: "Sessão encerrada. Faça login novamente." });
      return;
    }
    res.json({ usuario });
  } finally {
    await fecharJdbc(conn);
  }
}));

// ---- Fluxo de solicitação/aprovação de acesso ----

// Usuário (mesmo sem acesso aprovado) envia/edita sua solicitação.
app.post("/api/acesso/solicitar", apiLimiter, autenticarMiddleware, express.json(), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    // Se o acesso já foi aprovado nesse meio-tempo, não reabrir a solicitação:
    // sinaliza ao cliente para entrar no painel (evita reverter aprovação para pendente).
    const atual = await obterUsuarioAtualComConn(conn, req.usuario);
    if (atual && atual.aprovado) {
      res.json({ ok: true, jaAprovado: true });
      return;
    }
    const resultado = await salvarSolicitacaoAcessoComConn(conn, req.usuario.email, req.body || {});
    res.json({ ok: true, ...resultado });
  } catch (err) {
    res.status(400).json({ error: err && err.message ? err.message : "Falha ao enviar solicitação." });
  } finally {
    await fecharJdbc(conn);
  }
}));

app.get("/api/acesso/listas", apiLimiter, autenticarMiddleware, asyncHandler(async (req, res) => {
  res.json(await obterListasAcesso());
}));

// Usuário acompanha a própria situação (status + histórico de recusas).
app.get("/api/acesso/minha-solicitacao", apiLimiter, autenticarMiddleware, asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const situacao = await obterSituacaoAcessoComConn(conn, req.usuario.email);
    res.json({ aprovado: !!req.usuario.aprovado, ...situacao });
  } finally {
    await fecharJdbc(conn);
  }
}));

// Admin: lista pendentes + histórico.
app.get("/api/acesso/solicitacoes", apiLimiter, autenticarFrescoMiddleware, exigirNivelMiddleware(DASH_CONFIG.NIVEL_ADMIN), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    res.json(await listarSolicitacoesComConn(conn));
  } finally {
    await fecharJdbc(conn);
  }
}));

// Admin: aprova (libera o acesso imediatamente).
app.post("/api/acesso/solicitacoes/:id/aprovar", apiLimiter, autenticarFrescoMiddleware, exigirNivelMiddleware(DASH_CONFIG.NIVEL_ADMIN), express.json(), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const adminEmail = (req.usuario && (req.usuario.email || req.usuario.login)) || "admin";
    const resultado = await aprovarSolicitacaoComConn(conn, req.params.id, adminEmail, req.body || {});
    res.json({ ok: true, ...resultado });
  } catch (err) {
    res.status(400).json({ error: err && err.message ? err.message : "Falha ao aprovar a solicitação." });
  } finally {
    await fecharJdbc(conn);
  }
}));

// Admin: recusa (justificativa obrigatória).
app.post("/api/acesso/solicitacoes/:id/recusar", apiLimiter, autenticarFrescoMiddleware, exigirNivelMiddleware(DASH_CONFIG.NIVEL_ADMIN), express.json(), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const adminEmail = (req.usuario && (req.usuario.email || req.usuario.login)) || "admin";
    const resultado = await recusarSolicitacaoComConn(conn, req.params.id, adminEmail, (req.body || {}).observacao);
    res.json({ ok: true, ...resultado });
  } catch (err) {
    res.status(400).json({ error: err && err.message ? err.message : "Falha ao recusar a solicitação." });
  } finally {
    await fecharJdbc(conn);
  }
}));

// Super admin: exclui o usuário das duas tabelas (usuários + solicitações).
app.post("/api/acesso/usuario/excluir", apiLimiter, autenticarFrescoMiddleware, exigirNivelMiddleware(DASH_CONFIG.NIVEL_SUPERADMIN), express.json(), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const resultado = await excluirUsuarioComConn(conn, (req.body || {}).email);
    res.json({ ok: true, ...resultado });
  } catch (err) {
    res.status(400).json({ error: err && err.message ? err.message : "Falha ao excluir o usuário." });
  } finally {
    await fecharJdbc(conn);
  }
}));

// Super admin: define o privilégio (nível) de um usuário.
app.post("/api/acesso/usuario/nivel", apiLimiter, autenticarFrescoMiddleware, exigirNivelMiddleware(DASH_CONFIG.NIVEL_SUPERADMIN), express.json(), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const body = req.body || {};
    const resultado = await definirNivelUsuarioComConn(conn, body.email, body.nivel);
    res.json({ ok: true, ...resultado });
  } catch (err) {
    res.status(400).json({ error: err && err.message ? err.message : "Falha ao alterar o privilégio." });
  } finally {
    await fecharJdbc(conn);
  }
}));

app.post(
  "/api/remanejamento/salvar",
  apiLimiter,
  autenticarFrescoMiddleware,
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

app.post("/api/cache/clear", apiLimiter, asyncHandler(async (req, res) => {
  limparCacheDashboard();
  res.json({ ok: true });
}));

// Catch-all do SPA: serve o index.html. Faz acesso ao filesystem, então também
// passa pelo rate limiter geral (mitiga DoS por rajada de requisições).
app.get("*", apiLimiter, (req, res) => {
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

  garantirTabelaSolicitacoesAcesso().catch(err => {
    console.error("Não foi possível garantir a tabela de solicitações de acesso:", err && err.message ? err.message : err);
  });
}

module.exports = app;

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

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

Object.assign(module.exports, {
  _salvarObservacaoAlertaComConn: salvarObservacaoAlertaComConn,
  _salvarRemanejamentoComConn: salvarRemanejamentoComConn,
  _normalizarLinhasRemanejamentoServidor: normalizarLinhasRemanejamentoServidor,
  _calcularResumoLinhasServidor: calcularResumoLinhasServidor,
  _mapearCargoParaPrevistas: mapearCargoParaPrevistas,
  _mesesAteFimDoAno: mesesAteFimDoAno,
  _limparValorDash: limparValorDash,
  _converterNumeroDash: converterNumeroDash,
  _salvarSolicitacaoAcessoComConn: salvarSolicitacaoAcessoComConn,
  _aprovarSolicitacaoComConn: aprovarSolicitacaoComConn,
  _recusarSolicitacaoComConn: recusarSolicitacaoComConn,
  _excluirUsuarioComConn: excluirUsuarioComConn,
  _definirNivelUsuarioComConn: definirNivelUsuarioComConn
});
