require("dotenv").config();

const path = require("path");
const { spawn } = require("child_process");
const express = require("express");
const rateLimit = require("express-rate-limit");
const mysql = require("mysql2/promise");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const { DASH_CONFIG, getMysqlConfig, resolverPortaAplicacao, parseJdbcUrl } = require("./lib/config");
const { DASH_SQL, montarCaseCargoSql } = require("./lib/sql");
const { getRemanejamentoListaData, getRemanejamentoCadastroData, getRemanejamentoDetalheData, getRemanejamentoEdicaoData, salvarRemanejamentoComConn, atualizarRemanejamentoComConn, excluirRemanejamentoComConn, garantirTabelaMovimentacaoRemanejamento, garantirColunaMesesRemanejamento, obterRemanejamentoListaComCache, obterRemanejamentoCadastroComCache, montarOpcoesRemanejamentoAPartirDasRows, obterUltimaAtualizacaoRemanejamento, normalizarLinhasRemanejamentoServidor, calcularResumoLinhasServidor, mapearCargoParaPrevistas } = require("./lib/remanejamento");
const { getDashboardData, getDashboardResumoData, getDashboardApoioData, getVagasData, getAlertasData, getAlertasObservacoesMap, salvarObservacaoAlertaComConn, garantirTabelaAlertasObservacoes } = require("./lib/dashboard");
const { getCrachaData, salvarControleComConn, atualizarStatusCrachaComConn, atualizarStatusLoteComConn, atualizarLoteComConn, importarCrachasComConn, reverterControleComConn, garantirTabelaCrachasControle, decodificarImagemDataUrl, salvarFotoCrachaComConn, obterFotoCrachaComConn, removerFotoCrachaComConn } = require("./lib/cracha");
const { limparValorDash, converterNumeroDash, normalizarChaveDash, formatarDataBancoDash, extrairCompetenciaDash, nomeMesDash, obterUltimaAtualizacaoDash, somaServidor, mesesAteFimDoAno, formatDateInTimeZone, aguardar } = require("./lib/utils");
const { getMysqlPool, getMysqlConnection, fecharJdbc, obterOuCarregarJsonCache, limparCacheDashboard, executarConsultaComConn } = require("./lib/db");
const { garantirTabelaSolicitacoesAcesso, salvarSolicitacaoAcessoComConn, obterListasAcesso, obterSituacaoAcessoComConn, listarSolicitacoesComConn, definirNivelUsuarioComConn, aprovarSolicitacaoComConn, recusarSolicitacaoComConn, excluirUsuarioComConn } = require("./lib/acesso");
const { listarPedidosComConn, listarCategoriasComConn, buscarTrabalhadoresComConn, criarPedidoComConn, atualizarPedidoBaseComConn, atualizarDemandaComConn, atualizarSancaoComConn, definirResponsavelComConn, excluirPedidoComConn, garantirColunaConteudoProva, garantirColunasDatasFasesDemanda, obterResponsavelPedidoComConn, responsavelDoAnexoComConn, adicionarAnexosComConn, obterProvaComConn, excluirProvaComConn, definirTermoSancaoComConn, obterTermoSancaoComConn } = require("./lib/disciplinar");
const { MODULOS: MODULOS_PERMISSAO, garantirTabelaPermissoesModulos, obterMapaPermissoesComConn, listarPerfisAcessoComConn, definirPermissaoModuloComConn, limparPermissoesUsuarioComConn } = require("./lib/permissoes");
const { autenticarUsuario, autenticarUsuarioGoogle, obterUsuarioAtualComConn, autenticarMiddleware, autenticarFrescoMiddleware, autenticarOpcionalMiddleware, exigirNivelMiddleware, exigirAprovadoMiddleware, garantirTabelaUsuarios } = require("./lib/auth");
const { getSaudeIndigenaData } = require("./lib/saude-indigena");
const { getFeriasData } = require("./lib/ferias");
const app = express();
app.disable("x-powered-by"); // não revela o framework/versão

// Tipos que o navegador renderiza na própria origem e poderiam executar script
// (HTML/SVG/XML). Bloqueados no upload como defesa em profundidade — além disso o
// download é sempre forçado como anexo (ver rota do anexo).
const MIME_ANEXO_BLOQUEADOS = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "application/xml",
  "text/xml"
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const mime = String(file.mimetype || "").toLowerCase();
    if (MIME_ANEXO_BLOQUEADOS.has(mime)) {
      const erro = new Error("Tipo de arquivo não permitido para anexo.");
      erro.status = 400;
      erro.expose = true;
      cb(erro);
      return;
    }
    cb(null, true);
  }
});

// O multer (via busboy) decodifica o nome do arquivo do multipart como latin1, o
// que corrompe acentos (ã, í, ú aparecem como "?"/�) antes mesmo de chegar ao
// banco. Recuperamos os bytes originais e reinterpretamos como UTF-8.
function corrigirNomeArquivoUpload(nome) {
  if (typeof nome !== "string" || !nome) return nome;
  try {
    return Buffer.from(nome, "latin1").toString("utf8");
  } catch (e) {
    return nome;
  }
}

// Monta o cabeçalho Content-Disposition de download preservando acentos no nome:
// usa RFC 5987 (filename*=UTF-8'') e mantém um fallback ASCII para clientes antigos.
// Evita que nomes acentuados baixem como texto percent-encoded ilegível.
function dispositionAnexo(nome) {
  const limpo = String(nome || "arquivo").replace(/[\r\n"]/g, "");
  const ascii = limpo.replace(/[^\x20-\x7E]/g, "_") || "arquivo";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(limpo)}`;
}

// Envolve um middleware do multer e normaliza para UTF-8 os nomes dos arquivos
// (single/array/fields), de forma central — qualquer rota de upload herda a correção.
function comNomesUtf8(middleware) {
  return (req, res, next) => middleware(req, res, err => {
    if (err) return next(err);
    const fix = f => { if (f && typeof f.originalname === "string") f.originalname = corrigirNomeArquivoUpload(f.originalname); };
    if (req.file) fix(req.file);
    if (Array.isArray(req.files)) req.files.forEach(fix);
    else if (req.files && typeof req.files === "object") Object.values(req.files).forEach(arr => (arr || []).forEach(fix));
    next();
  });
}

app.set("trust proxy", Number(process.env.TRUST_PROXY || 1));

// Cabeçalhos de segurança aplicados a todas as respostas (inclui estáticos).
// A CSP libera explicitamente os CDNs usados pelo painel (Google Identity,
// Chart.js via jsDelivr e Font Awesome via cdnjs) e bloqueia o resto.
function origemDeUrl(valor) {
  try { return new URL(String(valor || "").trim()).origin; } catch (e) { return ""; }
}

// frame-src: o painel embute em <iframe> o login do Google e os dashboards
// externos configurados (Saúde Indígena / Férias). Liberamos exatamente essas
// origens — trocar a URL de um dashboard exige reiniciar o servidor.
const FRAME_SRC = [...new Set([
  "'self'",
  "https://accounts.google.com",
  origemDeUrl(DASH_CONFIG.DASHBOARD_SAUDE_INDIGENA_URL),
  origemDeUrl(DASH_CONFIG.DASHBOARD_FERIAS_URL)
].filter(Boolean))];

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com https://cdnjs.cloudflare.com",
  "img-src 'self' data: https:",
  "font-src 'self' data: https://cdnjs.cloudflare.com",
  "connect-src 'self' https://accounts.google.com",
  `frame-src ${FRAME_SRC.join(" ")}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'"
].join("; ");

function definirCabecalhosSeguranca(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  // Respostas de API nunca devem ser cacheadas: um 200 antigo no cache do
  // navegador poderia mascarar um 403 após a permissão ser revogada.
  if (req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store");
  }
  // HSTS apenas sob HTTPS/produção (não enviar em http evita travar dev local).
  if (req.secure || String(req.headers["x-forwarded-proto"] || "").toLowerCase().includes("https") || process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  next();
}
app.use(definirCabecalhosSeguranca);

// ---- Cookie de sessão (JWT em cookie HttpOnly) ----
// O token vai num cookie HttpOnly (não acessível a JS, mitiga roubo via XSS) com
// SameSite=Lax (o cookie não acompanha requisições POST/DELETE de outros sites,
// bloqueando CSRF nas mutações). Secure é ativado sob HTTPS/produção.
const COOKIE_MAX_AGE_S = 8 * 60 * 60; // alinhado ao JWT_EXPIRES padrão (8h)

function conexaoSegura(req) {
  return req.secure
    || String(req.headers["x-forwarded-proto"] || "").toLowerCase().includes("https")
    || process.env.NODE_ENV === "production";
}

function definirCookieSessao(req, res, token) {
  const partes = [
    `${DASH_CONFIG.COOKIE_SESSAO}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${COOKIE_MAX_AGE_S}`
  ];
  if (conexaoSegura(req)) partes.push("Secure");
  res.setHeader("Set-Cookie", partes.join("; "));
}

function limparCookieSessao(req, res) {
  const partes = [
    `${DASH_CONFIG.COOKIE_SESSAO}=`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=0"
  ];
  if (conexaoSegura(req)) partes.push("Secure");
  res.setHeader("Set-Cookie", partes.join("; "));
}

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

app.use(express.json({ limit: "256kb" })); // limita o corpo JSON (mitiga DoS por payload grande)
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

// Dados do painel: exigem sessão fresca (lê o banco) E acesso aprovado, para que
// usuários autenticados porém ainda pendentes/desativados não leiam os dados.
app.get("/api/dashboard", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("visaoGeral", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  res.json(await getDashboardData());
}));

app.get("/api/dashboard/resumo", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("visaoGeral", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  res.json(await getDashboardResumoData());
}));

app.get("/api/dashboard/apoio", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("visaoGeral", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  res.json(await getDashboardApoioData());
}));

app.get("/api/vagas", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("vagas", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  res.json(await getVagasData());
}));

app.get("/api/alertas", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("alertas", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  res.json(await getAlertasData());
}));

app.get("/api/alertas/observacoes", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("alertas", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  res.json({ observacoes: await getAlertasObservacoesMap() });
}));

// Escrita de observação: apenas administradores (nível >= 2) editam; demais
// usuários só visualizam. O autor é sempre derivado do token (nunca do corpo).
app.post("/api/alertas/observacao", apiLimiter, express.json(), autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("alertas", DASH_CONFIG.NIVEL_ADMIN), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const body = { ...(req.body || {}) };
    body.usuario = req.usuario.email || req.usuario.login || "painel";
    const resultado = await salvarObservacaoAlertaComConn(conn, body);
    res.json({ ok: true, ...resultado });
  } catch (err) {
    res.status(400).json({ error: err && err.message ? err.message : "Falha ao salvar a observação." });
  } finally {
    await fecharJdbc(conn);
  }
}));

// ---- Dashboard Saúde Indígena (nativo) ----
app.get("/api/saude-indigena", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("painelSaudeIndigena", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  res.json(await getSaudeIndigenaData());
}));

// ---- Gestão de Férias (análise — somente leitura) ----
app.get("/api/ferias", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("gestaoFerias", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  res.json(await getFeriasData());
}));

// ---- Entrega de Crachá ----
app.get("/api/cracha", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("entregaCracha", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  const forcar = String((req.query || {}).atualizar || "") === "1"; // botão "Atualizar": ignora cache
  res.json(await getCrachaData(forcar));
}));

// Editar overlay manual (datas / observação) — escrita: administradores.
// Grava só os campos presentes no corpo, na tabela-companheira (por matrícula).
app.post("/api/cracha/salvar", apiLimiter, express.json(), autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("entregaCracha", DASH_CONFIG.NIVEL_ADMIN), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const body = req.body || {};
    const usuario = (req.usuario && (req.usuario.email || req.usuario.login)) || "painel";
    const campos = {};
    if (body.status !== undefined) campos.statusManual = body.status;
    if (body.dataSolicitacao !== undefined) campos.dataSolicitacao = body.dataSolicitacao;
    if (body.dataEnvio !== undefined) campos.dataEnvio = body.dataEnvio;
    if (body.dataConfeccao !== undefined) campos.dataConfeccao = body.dataConfeccao;
    if (body.dataRecebEscritorio !== undefined) campos.dataRecebEscritorio = body.dataRecebEscritorio;
    if (body.dataRecebTrabalhador !== undefined) campos.dataRecebTrabalhador = body.dataRecebTrabalhador;
    if (body.devolvido !== undefined) campos.devolvido = body.devolvido;
    if (body.segundaVia !== undefined) campos.segundaVia = body.segundaVia;
    if (body.motivoSegundaVia !== undefined) campos.motivoSegundaVia = body.motivoSegundaVia;
    if (body.observacao !== undefined) campos.observacao = body.observacao;
    const registro = await salvarControleComConn(conn, body.matricula, campos, usuario);
    limparCacheDashboard();
    res.json({ ok: true, registro });
  } catch (err) {
    res.status(400).json({ error: err && err.message ? err.message : "Falha ao salvar o crachá." });
  } finally {
    await fecharJdbc(conn);
  }
}));

// Atualizar somente o status (avançar/voltar etapa) — grava no overlay.
app.post("/api/cracha/status", apiLimiter, express.json(), autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("entregaCracha", DASH_CONFIG.NIVEL_ADMIN), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const usuario = (req.usuario && (req.usuario.email || req.usuario.login)) || "painel";
    const registro = await atualizarStatusCrachaComConn(conn, (req.body || {}).matricula, (req.body || {}).status, usuario);
    limparCacheDashboard();
    res.json({ ok: true, registro });
  } catch (err) {
    res.status(400).json({ error: err && err.message ? err.message : "Falha ao atualizar o status." });
  } finally {
    await fecharJdbc(conn);
  }
}));

// Atualizar o status de várias matrículas de uma vez (ação em lote) — overlay.
app.post("/api/cracha/status-lote", apiLimiter, express.json(), autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("entregaCracha", DASH_CONFIG.NIVEL_ADMIN), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const usuario = (req.usuario && (req.usuario.email || req.usuario.login)) || "painel";
    const { matriculas, status } = req.body || {};
    const { registros, erros } = await atualizarStatusLoteComConn(conn, matriculas, status, usuario);
    limparCacheDashboard();
    res.json({ ok: true, registros, erros });
  } catch (err) {
    res.status(400).json({ error: err && err.message ? err.message : "Falha ao atualizar os status em lote." });
  } finally {
    await fecharJdbc(conn);
  }
}));

// Aplicar vários campos (status/datas/devolvido/2ª via/motivo/observação) a um
// lote de matrículas de uma vez — overlay. Escrita: administradores.
app.post("/api/cracha/lote", apiLimiter, express.json(), autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("entregaCracha", DASH_CONFIG.NIVEL_ADMIN), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const usuario = (req.usuario && (req.usuario.email || req.usuario.login)) || "painel";
    const { matriculas, campos } = req.body || {};
    const { registros, erros } = await atualizarLoteComConn(conn, matriculas, campos, usuario);
    limparCacheDashboard();
    res.json({ ok: true, registros, erros });
  } catch (err) {
    res.status(400).json({ error: err && err.message ? err.message : "Falha ao aplicar as alterações em lote." });
  } finally {
    await fecharJdbc(conn);
  }
}));

// Importar planilha (JSON com linhas já parseadas no cliente). Atualiza quem
// existe na base e cria quem não existe (no overlay). Escrita: administradores.
app.post("/api/cracha/importar", apiLimiter, express.json({ limit: "8mb" }), autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("entregaCracha", DASH_CONFIG.NIVEL_ADMIN), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const usuario = (req.usuario && (req.usuario.email || req.usuario.login)) || "painel";
    const resultado = await importarCrachasComConn(conn, (req.body || {}).linhas, usuario);
    limparCacheDashboard();
    res.json({ ok: true, ...resultado });
  } catch (err) {
    res.status(400).json({ error: err && err.message ? err.message : "Falha ao importar a planilha." });
  } finally {
    await fecharJdbc(conn);
  }
}));

// Foto do crachá — upload (data URL base64): administradores.
app.post("/api/cracha/foto", apiLimiter, express.json({ limit: "8mb" }), autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("entregaCracha", DASH_CONFIG.NIVEL_ADMIN), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const body = req.body || {};
    const usuario = (req.usuario && (req.usuario.email || req.usuario.login)) || "painel";
    const { buffer, mime } = decodificarImagemDataUrl(body.dataUrl);
    const registro = await salvarFotoCrachaComConn(conn, body.matricula, buffer, mime, usuario);
    limparCacheDashboard();
    res.json({ ok: true, registro });
  } catch (err) {
    res.status(400).json({ error: err && err.message ? err.message : "Falha ao salvar a foto." });
  } finally {
    await fecharJdbc(conn);
  }
}));

// Foto do crachá — remover: administradores.
app.delete("/api/cracha/foto/:matricula", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("entregaCracha", DASH_CONFIG.NIVEL_ADMIN), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const usuario = (req.usuario && (req.usuario.email || req.usuario.login)) || "painel";
    const registro = await removerFotoCrachaComConn(conn, req.params.matricula, usuario);
    limparCacheDashboard();
    res.json({ ok: true, registro });
  } catch (err) {
    res.status(400).json({ error: err && err.message ? err.message : "Falha ao remover a foto." });
  } finally {
    await fecharJdbc(conn);
  }
}));

// Foto do crachá — servir a imagem: mesmo nível de leitura do GET /api/cracha.
app.get("/api/cracha/foto/:matricula", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("entregaCracha", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const foto = await obterFotoCrachaComConn(conn, req.params.matricula);
    if (!foto) return res.status(404).end();
    res.set("Content-Type", foto.mime);
    res.set("Cache-Control", "private, no-cache");
    res.send(foto.dados);
  } finally {
    await fecharJdbc(conn);
  }
}));

// Reverter: desfaz apenas a última alteração (undo de 1 nível), restaurando o estado anterior.
app.post("/api/cracha/reverter", apiLimiter, express.json(), autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("entregaCracha", DASH_CONFIG.NIVEL_ADMIN), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const registro = await reverterControleComConn(conn, (req.body || {}).matricula);
    limparCacheDashboard();
    res.json({ ok: true, registro });
  } catch (err) {
    res.status(400).json({ error: err && err.message ? err.message : "Falha ao reverter o crachá." });
  } finally {
    await fecharJdbc(conn);
  }
}));

app.get("/api/remanejamento/lista", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("remanejamento", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  res.json(await getRemanejamentoListaData());
}));

app.get("/api/remanejamento/cadastro", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("remanejamento", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  res.json(await getRemanejamentoCadastroData());
}));

app.get("/api/remanejamento/anexo/:id", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("remanejamento", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
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

    // Download forçado (attachment) + nosniff: o navegador nunca renderiza o
    // anexo na origem do painel, neutralizando XSS via arquivo malicioso.
    const nomeArquivo = String(row.ANEXO_NOME_ARQUIVO || "anexo_remanejamento").replace(/[\r\n"]/g, "");
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store"); // documento sensível: não cachear
    res.setHeader("Content-Disposition", dispositionAnexo(nomeArquivo));
    res.send(row.ANEXO_PROCESSO);
  } finally {
    await fecharJdbc(conn);
  }
}));

app.get("/api/remanejamento/detalhe/:id", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("remanejamento", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  res.json(await getRemanejamentoDetalheData(req.params.id));
}));

app.get("/api/remanejamento/edicao/:id", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("remanejamento", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  res.json(await getRemanejamentoEdicaoData(req.params.id));
}));

app.put(
  "/api/remanejamento/:id",
  apiLimiter,
  autenticarFrescoMiddleware,
  exigirPermissaoModuloMiddleware("remanejamento", DASH_CONFIG.NIVEL_REMANEJAMENTO_SALVAR),
  upload.single("anexo"),

  asyncHandler(async (req, res) => {
    const conn = await getMysqlConnection();
    try {
      const resultado = await atualizarRemanejamentoComConn(conn, req.params.id, req.body || {}, req.file || null);
      limparCacheDashboard();
      res.json({ ok: true, ...resultado });
    } finally {
      await fecharJdbc(conn);
    }
  })
);

app.delete(
  "/api/remanejamento/:id",
  apiLimiter,
  autenticarFrescoMiddleware,
  exigirPermissaoModuloMiddleware("remanejamento", DASH_CONFIG.NIVEL_REMANEJAMENTO_SALVAR),
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
    definirCookieSessao(req, res, resultado.token);
    await anexarPermissoesUsuario(resultado.usuario);
    // O token não é devolvido no corpo: vive só no cookie HttpOnly.
    res.json({ usuario: resultado.usuario, aprovado: resultado.aprovado });
  } catch (err) {
    res.status(401).json({ error: err && err.message ? err.message : "Falha na autenticação." });
  }
}));

app.post("/api/login/google", loginLimiter, express.json(), asyncHandler(async (req, res) => {
  try {
    const resultado = await autenticarUsuarioGoogle(req.body || {});
    definirCookieSessao(req, res, resultado.token);
    await anexarPermissoesUsuario(resultado.usuario);
    res.json({ usuario: resultado.usuario, aprovado: resultado.aprovado });
  } catch (err) {
    res.status(401).json({ error: err && err.message ? err.message : "Falha na autenticação Google." });
  }
}));

app.post("/api/logout", (req, res) => {
  // Autenticação é stateless (JWT). Encerra a sessão limpando o cookie.
  limparCookieSessao(req, res);
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
    // Overrides de permissão por módulo (o front aplica o fallback p/ o nível global).
    usuario.permissoes = usuario.aprovado ? await obterMapaPermissoesComConn(conn, usuario.email) : {};
    res.json({ usuario });
  } finally {
    await fecharJdbc(conn);
  }
}));

// Gate da aba de administração de perfis (regra mandatória = matriz). O acesso é
// definido pelo nível do ator no módulo "solicitacoes": override na matriz ou,
// na ausência, o padrão — super admin global tem acesso pleno; os demais, nenhum.
//   minNivel 1 = ver a aba (somente leitura)   2 = administrar (aprovar/editar)
function nivelAdminEfetivo(mapa, nivelGlobal) {
  const v = mapa ? mapa.solicitacoes : undefined;
  if (v === undefined || v === null) {
    return Number(nivelGlobal) >= DASH_CONFIG.NIVEL_SUPERADMIN ? DASH_CONFIG.NIVEL_SUPERADMIN : 0;
  }
  return Number(v);
}

function exigirAdminPerfisMiddleware(minNivel) {
  return function (req, res, next) {
    getMysqlConnection()
      .then(async (conn) => {
        try {
          const mapa = await obterMapaPermissoesComConn(conn, req.usuario.email);
          const global = Number((req.usuario && req.usuario.nivelAutorizacao) || 0);
          if (nivelAdminEfetivo(mapa, global) < minNivel) {
            res.status(403).json({ error: "Você não tem permissão para administrar os perfis de acesso." });
            return;
          }
          next();
        } finally {
          await fecharJdbc(conn);
        }
      })
      .catch(next);
  };
}

// Gate de uma aba comum pela matriz de perfis (regra mandatória): exige o nível
// efetivo do ator no módulo informado — override da matriz ou, na ausência, o
// nível global. Substitui as checagens por nível global nas rotas de mutação,
// para que rebaixar alguém na matriz realmente bloqueie a edição no servidor.
//   minNivel 1 = leitor · 2 = editor · 3 = administrador do módulo
function exigirPermissaoModuloMiddleware(modulo, minNivel) {
  return function (req, res, next) {
    getMysqlConnection()
      .then(async (conn) => {
        try {
          const mapa = await obterMapaPermissoesComConn(conn, req.usuario.email);
          const global = Number((req.usuario && req.usuario.nivelAutorizacao) || 0);
          const v = mapa[modulo];
          const efetivo = (v === undefined || v === null) ? global : Number(v);
          if (efetivo < minNivel) {
            res.status(403).json({ error: "Você não tem permissão de edição neste módulo." });
            return;
          }
          next();
        } finally {
          await fecharJdbc(conn);
        }
      })
      .catch(next);
  };
}

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

// Super admin: lista pendentes + histórico (aba exclusiva de super administradores).
app.get("/api/acesso/solicitacoes", apiLimiter, autenticarFrescoMiddleware, exigirAdminPerfisMiddleware(1), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const dados = await listarSolicitacoesComConn(conn);
    // Anexa os overrides de permissão por módulo de cada pendente, para o admin
    // poder pré-definir o acesso (por e-mail) antes mesmo de aprovar a solicitação.
    for (const p of dados.pendentes || []) {
      p.permissoes = await obterMapaPermissoesComConn(conn, p.EMAIL);
    }
    res.json(dados);
  } finally {
    await fecharJdbc(conn);
  }
}));

// Super admin: aprova (libera o acesso imediatamente).
app.post("/api/acesso/solicitacoes/:id/aprovar", apiLimiter, autenticarFrescoMiddleware, exigirAdminPerfisMiddleware(2), express.json(), asyncHandler(async (req, res) => {
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

// Super admin: recusa (justificativa obrigatória).
app.post("/api/acesso/solicitacoes/:id/recusar", apiLimiter, autenticarFrescoMiddleware, exigirAdminPerfisMiddleware(2), express.json(), asyncHandler(async (req, res) => {
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
app.post("/api/acesso/usuario/excluir", apiLimiter, autenticarFrescoMiddleware, exigirAdminPerfisMiddleware(2), express.json(), asyncHandler(async (req, res) => {
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
app.post("/api/acesso/usuario/nivel", apiLimiter, autenticarFrescoMiddleware, exigirAdminPerfisMiddleware(2), express.json(), asyncHandler(async (req, res) => {
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

// Enriquece o objeto de usuário (devolvido no login) com os overrides de
// permissão por módulo. Best-effort: uma falha aqui não impede o login.
async function anexarPermissoesUsuario(usuario) {
  if (!usuario || !usuario.aprovado) { if (usuario) usuario.permissoes = {}; return; }
  const conn = await getMysqlConnection();
  try {
    usuario.permissoes = await obterMapaPermissoesComConn(conn, usuario.email);
  } catch (e) {
    usuario.permissoes = {};
  } finally {
    await fecharJdbc(conn);
  }
}

// ---- Perfis de acesso (matriz de permissões por módulo) ----

// Super admin: lista os módulos e os usuários aprovados com seus overrides.
app.get("/api/acesso/perfis", apiLimiter, autenticarFrescoMiddleware, exigirAdminPerfisMiddleware(1), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const usuarios = await listarPerfisAcessoComConn(conn);
    res.json({ modulos: MODULOS_PERMISSAO, usuarios });
  } finally {
    await fecharJdbc(conn);
  }
}));

// Super admin: define o nível de um usuário em um módulo (uma célula da matriz).
app.post("/api/acesso/perfis/permissao", apiLimiter, autenticarFrescoMiddleware, exigirAdminPerfisMiddleware(2), express.json(), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const body = req.body || {};
    // Trava de auto-bloqueio: ninguém pode reduzir o próprio acesso à aba de
    // administração (módulo "solicitacoes") abaixo de Editor — evita se trancar
    // do fora. Para rebaixar a si mesmo, peça a outro super administrador.
    const alvo = String(body.email || "").trim().toLowerCase();
    const ator = String((req.usuario && req.usuario.email) || "").trim().toLowerCase();
    if (alvo && alvo === ator && String(body.modulo) === "solicitacoes" && Number(body.nivel) < 2) {
      res.status(400).json({ error: "Você não pode remover o seu próprio acesso à administração de perfis." });
      return;
    }
    const resultado = await definirPermissaoModuloComConn(conn, body.email, body.modulo, body.nivel);
    res.json({ ok: true, ...resultado });
  } catch (err) {
    res.status(400).json({ error: err && err.message ? err.message : "Falha ao definir a permissão." });
  } finally {
    await fecharJdbc(conn);
  }
}));

// Super admin: remove todos os overrides de um usuário (volta ao nível global).
app.post("/api/acesso/perfis/limpar", apiLimiter, autenticarFrescoMiddleware, exigirAdminPerfisMiddleware(2), express.json(), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const resultado = await limparPermissoesUsuarioComConn(conn, (req.body || {}).email);
    res.json({ ok: true, ...resultado });
  } catch (err) {
    res.status(400).json({ error: err && err.message ? err.message : "Falha ao limpar as permissões." });
  } finally {
    await fecharJdbc(conn);
  }
}));

// ---- Gestão Disciplinar (pedidos de sanção) ----
// Edição liberada a usuários aprovados (nível >= 1); assumir/delegar responsável e
// excluir são exclusivos de administradores (nível >= 2). O autor/login é sempre
// derivado do token (nunca do corpo).
function loginDoToken(req) {
  const base = String((req.usuario && (req.usuario.email || req.usuario.login)) || "").trim();
  return base.includes("@") ? base.split("@")[0] : base;
}

function ehSuperAdmin(req) {
  return Number((req.usuario && req.usuario.nivelAutorizacao) || 0) >= DASH_CONFIG.NIVEL_SUPERADMIN;
}

// Edição/anexos de um pedido são exclusivos do responsável atual (super admin
// pode tudo). Lança 403 caso contrário. Sem responsável definido, só super admin.
function exigirResponsavel(req, responsavel) {
  const resp = String(responsavel || "").trim();
  if (ehSuperAdmin(req)) return;
  if (!resp || resp !== loginDoToken(req)) {
    const err = new Error("Apenas o responsável pelo pedido pode realizar esta ação.");
    err.status = 403;
    err.expose = true;
    throw err;
  }
}

app.get("/api/disciplinar", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("gestaoDisciplinar", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    res.json({ pedidos: await listarPedidosComConn(conn) });
  } finally {
    await fecharJdbc(conn);
  }
}));

app.get("/api/disciplinar/categorias", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("gestaoDisciplinar", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    res.json({ categorias: await listarCategoriasComConn(conn) });
  } finally {
    await fecharJdbc(conn);
  }
}));

app.get("/api/disciplinar/trabalhadores", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("gestaoDisciplinar", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    res.json({ trabalhadores: await buscarTrabalhadoresComConn(conn, (req.query || {}).q) });
  } finally {
    await fecharJdbc(conn);
  }
}));

app.post("/api/disciplinar", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("gestaoDisciplinar", DASH_CONFIG.NIVEL_ADMIN), upload.fields([{ name: "oficio", maxCount: 1 }, { name: "anexos", maxCount: 20 }]), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const body = { ...(req.body || {}) };
    // Delegação de responsável na criação é exclusiva de administradores.
    const ehAdmin = Number((req.usuario && req.usuario.nivelAutorizacao) || 0) >= DASH_CONFIG.NIVEL_ADMIN;
    if (!ehAdmin) body.responsavel = "";
    const oficio = (req.files && req.files.oficio && req.files.oficio[0]) || null;
    const anexos = (req.files && req.files.anexos) || [];
    let tipos = [];
    try { tipos = JSON.parse(body.anexosTipos || "[]"); } catch (e) { tipos = []; }
    const pedido = await criarPedidoComConn(conn, body, loginDoToken(req), oficio, anexos, tipos);
    res.json({ ok: true, pedido });
  } catch (err) {
    res.status(400).json({ error: err && err.message ? err.message : "Falha ao salvar o pedido." });
  } finally {
    await fecharJdbc(conn);
  }
}));

app.post("/api/disciplinar/:id/pedido", apiLimiter, express.json(), autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("gestaoDisciplinar", DASH_CONFIG.NIVEL_ADMIN), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    exigirResponsavel(req, await obterResponsavelPedidoComConn(conn, req.params.id));
    const pedido = await atualizarPedidoBaseComConn(conn, req.params.id, req.body || {});
    res.json({ ok: true, pedido });
  } catch (err) {
    res.status((err && err.status) || 400).json({ error: err && err.message ? err.message : "Falha ao atualizar o pedido." });
  } finally {
    await fecharJdbc(conn);
  }
}));

app.post("/api/disciplinar/:id/demanda", apiLimiter, express.json(), autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("gestaoDisciplinar", DASH_CONFIG.NIVEL_ADMIN), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    exigirResponsavel(req, await obterResponsavelPedidoComConn(conn, req.params.id));
    const pedido = await atualizarDemandaComConn(conn, req.params.id, req.body || {});
    res.json({ ok: true, pedido });
  } catch (err) {
    res.status((err && err.status) || 400).json({ error: err && err.message ? err.message : "Falha ao atualizar a demanda." });
  } finally {
    await fecharJdbc(conn);
  }
}));

app.post("/api/disciplinar/:id/sancao", apiLimiter, express.json(), autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("gestaoDisciplinar", DASH_CONFIG.NIVEL_ADMIN), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    exigirResponsavel(req, await obterResponsavelPedidoComConn(conn, req.params.id));
    const pedido = await atualizarSancaoComConn(conn, req.params.id, req.body || {}, loginDoToken(req));
    res.json({ ok: true, pedido });
  } catch (err) {
    res.status((err && err.status) || 400).json({ error: err && err.message ? err.message : "Falha ao atualizar a sanção." });
  } finally {
    await fecharJdbc(conn);
  }
}));

// Upload do termo/documento comprobatório da sanção (guardado em BLOB) — exclusivo do responsável.

app.post("/api/disciplinar/:id/sancao/termo", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("gestaoDisciplinar", DASH_CONFIG.NIVEL_ADMIN), upload.single("termo"), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    exigirResponsavel(req, await obterResponsavelPedidoComConn(conn, req.params.id));
    const pedido = await definirTermoSancaoComConn(conn, req.params.id, req.file || null, loginDoToken(req));
    res.json({ ok: true, pedido });
  } catch (err) {
    res.status((err && err.status) || 400).json({ error: err && err.message ? err.message : "Falha ao enviar o termo da sanção." });
  } finally {
    await fecharJdbc(conn);
  }
}));

// Download do termo da sanção (qualquer usuário aprovado pode baixar).
app.get("/api/disciplinar/:id/sancao/termo", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("gestaoDisciplinar", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const termo = await obterTermoSancaoComConn(conn, req.params.id);
    if (!termo || !termo.documento_sancao) {
      res.status(404).json({ error: "Termo não encontrado." });
      return;
    }
    const nomeArquivo = String(termo.nome_documento || "termo_sancao").replace(/[\r\n"]/g, "");
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", dispositionAnexo(nomeArquivo));
    res.send(termo.documento_sancao);
  } finally {
    await fecharJdbc(conn);
  }
}));

// Assumir/delegar responsável — exclusivo de administradores.
app.post("/api/disciplinar/:id/responsavel", apiLimiter, express.json(), autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("gestaoDisciplinar", DASH_CONFIG.NIVEL_ADMIN), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const body = req.body || {};
    // Sem "responsavel" no corpo => o admin está assumindo para si (login do token).
    const novo = String(body.responsavel || "").trim() || loginDoToken(req);
    const acao = String(body.responsavel || "").trim() ? "TRANSFERIU" : "ASSUMIU";
    const pedido = await definirResponsavelComConn(conn, req.params.id, novo, acao);
    res.json({ ok: true, pedido });
  } catch (err) {
    res.status(400).json({ error: err && err.message ? err.message : "Falha ao definir o responsável." });
  } finally {
    await fecharJdbc(conn);
  }
}));

// Excluir pedido (cascade) — exclusivo de administradores.
app.post("/api/disciplinar/:id/excluir", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("gestaoDisciplinar", DASH_CONFIG.NIVEL_ADMIN), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const resultado = await excluirPedidoComConn(conn, req.params.id);
    res.json({ ok: true, ...resultado });
  } catch (err) {
    res.status(400).json({ error: err && err.message ? err.message : "Falha ao excluir o pedido." });
  } finally {
    await fecharJdbc(conn);
  }
}));

// Anexar arquivos (vários, de um tipo) a um pedido — exclusivo do responsável atual.
app.post("/api/disciplinar/:id/anexos", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("gestaoDisciplinar", DASH_CONFIG.NIVEL_ADMIN), upload.array("anexos", 10), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    exigirResponsavel(req, await obterResponsavelPedidoComConn(conn, req.params.id));
    const tipo = (req.body || {}).tipo;
    const pedido = await adicionarAnexosComConn(conn, req.params.id, req.files || [], tipo, loginDoToken(req));
    res.json({ ok: true, pedido });
  } catch (err) {
    res.status((err && err.status) || 400).json({ error: err && err.message ? err.message : "Falha ao anexar arquivos." });
  } finally {
    await fecharJdbc(conn);
  }
}));

// Download de uma prova (qualquer usuário aprovado pode visualizar/baixar).
app.get("/api/disciplinar/anexo/:idAnexo", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("gestaoDisciplinar", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const prova = await obterProvaComConn(conn, req.params.idAnexo);
    if (!prova || !prova.conteudo) {
      res.status(404).json({ error: "Prova não encontrada." });
      return;
    }
    // Download forçado (attachment) + nosniff: o navegador nunca renderiza o
    // arquivo na origem do painel, neutralizando XSS via arquivo malicioso.
    const nomeArquivo = String(prova.nome_arquivo || "prova").replace(/[\r\n"]/g, "");
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", dispositionAnexo(nomeArquivo));
    res.send(prova.conteudo);
  } finally {
    await fecharJdbc(conn);
  }
}));

// Remover uma prova — exclusivo do responsável atual do pedido.
app.post("/api/disciplinar/anexo/:idAnexo/excluir", apiLimiter, express.json(), autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("gestaoDisciplinar", DASH_CONFIG.NIVEL_ADMIN), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    exigirResponsavel(req, await responsavelDoAnexoComConn(conn, req.params.idAnexo));
    const pedido = await excluirProvaComConn(conn, req.params.idAnexo);
    res.json({ ok: true, pedido });
  } catch (err) {
    res.status((err && err.status) || 400).json({ error: err && err.message ? err.message : "Falha ao remover a prova." });
  } finally {
    await fecharJdbc(conn);
  }
}));

app.post(
  "/api/remanejamento/salvar",
  apiLimiter,
  autenticarFrescoMiddleware,
  exigirPermissaoModuloMiddleware("remanejamento", DASH_CONFIG.NIVEL_REMANEJAMENTO_SALVAR),
  upload.single("anexo"),
  asyncHandler(async (req, res) => {
    const conn = await getMysqlConnection();
    try {
      const body = { ...(req.body || {}), criadoPor: (req.usuario && (req.usuario.email || req.usuario.login)) || "painel" };
      const resultado = await salvarRemanejamentoComConn(conn, body, req.file || null);
      limparCacheDashboard();
      res.json({ ok: true, ...resultado });
    } catch (err) {
      res.status(400).json({ error: err && err.message ? err.message : "Falha ao salvar o remanejamento." });
    } finally {
      await fecharJdbc(conn);
    }
  })
);

app.post("/api/cache/clear", apiLimiter, autenticarFrescoMiddleware, exigirNivelMiddleware(DASH_CONFIG.NIVEL_ADMIN), asyncHandler(async (req, res) => {
  limparCacheDashboard();
  res.json({ ok: true });
}));

// Extrai o quadro de vagas e o cronograma de um PDF de anexo enviado pelo usuário
// (aba Processos Seletivos). Reaproveita o extrator Python (mock/script/
// extrair_anexo_local.py), que recebe o PDF por stdin e devolve JSON. O arquivo é
// processado em memória e NÃO é gravado em lugar nenhum.
const PYTHON_BIN = process.env.PYTHON_BIN || "python";
const EXTRATOR_ANEXO = path.join(__dirname, "mock", "script", "extrair_anexo_local.py");

function extrairAnexoPdf(buffer) {
  return new Promise((resolve, reject) => {
    const py = spawn(PYTHON_BIN, [EXTRATOR_ANEXO], { windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      py.kill("SIGKILL");
      reject(new Error("Tempo excedido ao ler o PDF (o arquivo pode ser muito grande)."));
    }, 90000);

    py.stdout.on("data", d => { out += d.toString("utf8"); });
    py.stderr.on("data", d => { err += d.toString("utf8"); });
    py.on("error", e => {
      clearTimeout(timer);
      reject(new Error(e && e.code === "ENOENT"
        ? "Python não encontrado no servidor (defina PYTHON_BIN ou instale o Python)."
        : "Não foi possível iniciar o extrator de PDF."));
    });
    py.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(err.trim() || `O extrator encerrou com código ${code}.`));
        return;
      }
      try {
        resolve(JSON.parse(out.trim() || "{}"));
      } catch (e) {
        reject(new Error("Saída inválida do extrator de PDF."));
      }
    });

    py.stdin.on("error", () => {}); // ignora EPIPE caso o processo feche antes
    py.stdin.write(buffer);
    py.stdin.end();
  });
}

app.post(
  "/api/processos-seletivos/extrair-anexo",
  apiLimiter,
  autenticarFrescoMiddleware,
  exigirPermissaoModuloMiddleware("processosSeletivos", DASH_CONFIG.NIVEL_ADMIN),
  comNomesUtf8(upload.single("anexo")),
  asyncHandler(async (req, res) => {
    if (!req.file || !req.file.buffer || !req.file.buffer.length) {
      res.status(400).json({ error: "Envie um arquivo PDF no campo 'anexo'." });
      return;
    }
    const mime = String(req.file.mimetype || "").toLowerCase();
    if (!mime.includes("pdf")) {
      res.status(400).json({ error: "O anexo precisa ser um arquivo PDF." });
      return;
    }
    try {
      const dados = await extrairAnexoPdf(req.file.buffer);
      res.json({ ok: true, ...dados });
    } catch (e) {
      res.status(422).json({ error: e && e.message ? e.message : "Não foi possível ler o PDF." });
    }
  })
);

// Rotas de API inexistentes retornam 404 JSON (não caem no SPA). Evita devolver
// o index.html para um /api/... errado — o que confundia testes (HTML 200) e
// mascarava a distinção entre "rota não existe" e "sem permissão" (403).
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Rota de API não encontrada." });
});

// Catch-all do SPA: serve o index.html. Faz acesso ao filesystem, então também
// passa pelo rate limiter geral (mitiga DoS por rajada de requisições).
app.get("*", apiLimiter, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((err, req, res, next) => {
  console.error(err && err.code ? `[${err.code}]` : "[erro]", err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err);

  // Erros do multer (ex.: arquivo acima do limite) viram 400 amigável.
  const ehMulter = err && err.name === "MulterError";
  const status = (err && Number(err.status)) || (ehMulter ? 400 : 500);

  // Só devolve a mensagem real quando for um erro "seguro" (validação/operacional);
  // erros internos (500) retornam mensagem genérica para não vazar detalhes.
  const podeExpor = !!(err && err.expose) || status < 500 || ehMulter;
  const message = podeExpor && err && err.message ? err.message : "Erro interno. Tente novamente mais tarde.";
  res.status(status).json({ error: message });
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

  garantirTabelaCrachasControle().catch(err => {
    console.error("Não foi possível garantir a tabela de controle de crachás:", err && err.message ? err.message : err);
  });

  garantirColunaMesesRemanejamento().catch(err => {
    console.error("Não foi possível garantir a coluna N_MESES do remanejamento:", err && err.message ? err.message : err);
  });

  garantirTabelaSolicitacoesAcesso().catch(err => {
    console.error("Não foi possível garantir a tabela de solicitações de acesso:", err && err.message ? err.message : err);
  });

  garantirTabelaPermissoesModulos().catch(err => {
    console.error("Não foi possível garantir a tabela de permissões por módulo:", err && err.message ? err.message : err);
  });

  garantirColunaConteudoProva().catch(err => {
    console.error("Não foi possível garantir a coluna de conteúdo das provas disciplinares:", err && err.message ? err.message : err);
  });

  garantirColunasDatasFasesDemanda().catch(err => {
    console.error("Não foi possível garantir as colunas de datas das etapas disciplinares:", err && err.message ? err.message : err);
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
