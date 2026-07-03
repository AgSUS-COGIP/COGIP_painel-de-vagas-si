require("dotenv").config();

const path = require("path");
const zlib = require("zlib");
const { spawn } = require("child_process");
const express = require("express");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const { DASH_CONFIG, resolverPortaAplicacao } = require("./lib/config");
const { getRemanejamentoListaData, getRemanejamentoCadastroData, getRemanejamentoDetalheData, getRemanejamentoEdicaoData, salvarRemanejamentoComConn, atualizarRemanejamentoComConn, excluirRemanejamentoComConn, garantirEscopoProcessoComConn, garantirTabelaMovimentacaoRemanejamento, garantirColunaMesesRemanejamento, normalizarLinhasRemanejamentoServidor, calcularResumoLinhasServidor, mapearCargoParaPrevistas } = require("./lib/remanejamento");
const { getDashboardData, getDashboardResumoData, getDashboardApoioData, getVagasData, getAlertasData, getAlertasObservacoesMap, salvarObservacaoAlertaComConn, garantirTabelaAlertasObservacoes } = require("./lib/dashboard");
const { getCrachaData, garantirEscopoMatriculaComConn, garantirEscopoMatriculasComConn, salvarControleComConn, atualizarStatusCrachaComConn, atualizarStatusLoteComConn, atualizarLoteComConn, importarCrachasComConn, reverterControleComConn, garantirTabelaCrachasControle, decodificarImagemDataUrl, salvarFotoCrachaComConn, obterFotoCrachaComConn, removerFotoCrachaComConn } = require("./lib/cracha");
const { limparValorDash, converterNumeroDash, mesesAteFimDoAno } = require("./lib/utils");
const { getMysqlConnection, fecharJdbc, limparCacheDashboard } = require("./lib/db");
const { garantirTabelaSolicitacoesAcesso, salvarSolicitacaoAcessoComConn, obterListasAcesso, obterSituacaoAcessoComConn, listarSolicitacoesComConn, aprovarSolicitacaoComConn, recusarSolicitacaoComConn, excluirUsuarioComConn } = require("./lib/acesso");
const { listarPedidosComConn, listarCategoriasComConn, buscarTrabalhadoresComConn, criarPedidoComConn, atualizarPedidoBaseComConn, atualizarDemandaComConn, atualizarSancaoComConn, definirResponsavelComConn, excluirPedidoComConn, garantirColunaConteudoProva, garantirColunasDatasFasesDemanda, garantirColunaDseiPedidoSancao, garantirEscopoPedidoComConn, garantirEscopoAnexoComConn, obterResponsavelPedidoComConn, responsavelDoAnexoComConn, adicionarAnexosComConn, obterProvaComConn, excluirProvaComConn, definirTermoSancaoComConn, obterTermoSancaoComConn } = require("./lib/disciplinar");
const { MODULOS: MODULOS_PERMISSAO, garantirTabelaPermissoesModulos, obterMapaPermissoesComConn, listarPerfisAcessoComConn, definirPermissaoModuloComConn, limparPermissoesUsuarioComConn } = require("./lib/permissoes");
const { garantirEstruturaEscopoDsei, listarDseisComConn, obterEscoposMapaComConn, definirEscopoUsuarioComConn, obterEscopoUsuarioComConn } = require("./lib/escopo");
const { autenticarUsuario, autenticarUsuarioGoogle, registrarUsuarioLocal, obterUsuarioAtualComConn, autenticarMiddleware, autenticarFrescoMiddleware, autenticarOpcionalMiddleware, garantirTabelaUsuarios } = require("./lib/auth");
const { getSaudeIndigenaData } = require("./lib/saude-indigena");
const { listarDseisCasaiComConn } = require("./lib/dsei-casai");
const {
  listarEditaisComConn, criarEditalComConn, atualizarEditalComConn, excluirEditalComConn,
  substituirAnexoComConn, removerAnexoComConn, criarAprovadoComConn, atualizarAprovadoComConn, excluirAprovadoComConn
} = require("./lib/processos-seletivos");
const { getMapaDseisData, getRedeCnes } = require("./lib/mapa-dseis");
const { getFeriasData } = require("./lib/ferias");
const { getEscalaData } = require("./lib/escala");
const { garantirTabelaFeedbackAssistente, salvarFeedbackComConn } = require("./lib/feedback");
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

function anexoFileFilter(req, file, cb) {
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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: anexoFileFilter
});

// Anexos do edital (quadro de vagas + cronograma) costumam ser PDFs ESCANEADOS,
// bem maiores que os demais uploads — usam um limite próprio (30MB) só na rota de
// extração, para que o OCR consiga processá-los. (Nota: em produção na Vercel, o
// corpo da função serverless é limitado a ~4,5MB; este limite maior vale sobretudo
// no ambiente local, onde o extrator roda via CLI.)
const uploadEditalAnexo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: anexoFileFilter
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
  // jsdelivr/cdnjs liberados aqui (além de script/style/font-src) só para o fetch
  // dos sourcemaps (.map) de Chart.js e FontAwesome — evita o aviso de CSP no
  // DevTools. São os mesmos CDNs já confiáveis usados para os próprios assets.
  "connect-src 'self' https://accounts.google.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
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
  res.json(await getDashboardData(req.usuario.escopo));
}));

app.get("/api/dashboard/resumo", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("visaoGeral", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  res.json(await getDashboardResumoData(req.usuario.escopo));
}));

app.get("/api/dashboard/apoio", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("visaoGeral", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  res.json(await getDashboardApoioData(req.usuario.escopo));
}));

app.get("/api/vagas", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("vagas", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  res.json(await getVagasData(req.usuario.escopo));
}));

app.get("/api/alertas", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("alertas", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  res.json(await getAlertasData(req.usuario.escopo));
}));

app.get("/api/alertas/observacoes", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("alertas", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  res.json({ observacoes: await getAlertasObservacoesMap(req.usuario.escopo) });
}));

// Escrita de observação: apenas administradores (nível >= 2) editam; demais
// usuários só visualizam. O autor é sempre derivado do token (nunca do corpo).
app.post("/api/alertas/observacao", apiLimiter, express.json(), autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("alertas", DASH_CONFIG.NIVEL_ADMIN), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const body = { ...(req.body || {}) };
    body.usuario = req.usuario.email || req.usuario.login || "painel";
    const resultado = await salvarObservacaoAlertaComConn(conn, body, req.usuario.escopo);
    res.json({ ok: true, ...resultado });
  } catch (err) {
    res.status((err && err.status) || 400).json({ error: err && err.message ? err.message : "Falha ao salvar a observação." });
  } finally {
    await fecharJdbc(conn);
  }
}));

// Feedback do assistente virtual (robô flutuante). Disponível para qualquer
// usuário autenticado (mesmo ainda sem acesso aprovado a abas): o assistente
// aparece em todas as telas e, de início, apenas recebe feedback. O autor é
// sempre derivado do token — nunca do corpo da requisição.
app.post("/api/feedback", apiLimiter, express.json(), autenticarMiddleware, asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const usuario = {
      email: req.usuario.email || req.usuario.login || "",
      nome: req.usuario.nome || ""
    };
    const resultado = await salvarFeedbackComConn(conn, req.body || {}, usuario);
    res.json(resultado);
  } catch (err) {
    res.status((err && err.status) || 400).json({ error: err && err.message ? err.message : "Falha ao registrar o feedback." });
  } finally {
    await fecharJdbc(conn);
  }
}));

// ---- Dashboard Saúde Indígena (nativo) ----
app.get("/api/saude-indigena", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("painelSaudeIndigena", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  res.json(await getSaudeIndigenaData(req.usuario.escopo));
}));

// ---- Mapa dos DSEIs (VW_SAUDE_INDIGENA + TB_LOTACAO_OVERRIDE) ----
// Mesma base/permissão do Painel da Força de Trabalho (painelSaudeIndigena).
app.get("/api/mapa-dseis", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("painelSaudeIndigena", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  res.json(await getMapaDseisData(req.usuario.escopo));
}));

// Rede CNES (estabelecimentos por DSEI: lat/lng + município), para os mapas.
app.get("/api/mapa-dseis/rede", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("painelSaudeIndigena", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  res.json(getRedeCnes());
}));

// ---- Gestão de Férias (análise — somente leitura) ----
app.get("/api/ferias", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("gestaoFerias", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  res.json(await getFeriasData(req.usuario.escopo));
}));

// ---- Escala de Trabalho (roster: identidade + polo base por matrícula) ----
// Payload grande (~16k linhas): comprime com gzip quando o cliente aceita, para
// não trafegar ~2MB por request (a leitura da view é cacheada em lib/escala.js).
app.get("/api/escala", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("escalaTrabalho", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  responderJsonTalvezComprimido(req, res, await getEscalaData(req.usuario.escopo));
}));

// ---- Entrega de Crachá ----
app.get("/api/cracha", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("entregaCracha", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  const forcar = String((req.query || {}).atualizar || "") === "1"; // botão "Atualizar": ignora cache
  res.set("Cache-Control", "no-store"); // evita o navegador servir dados antigos após alterações
  res.json(await getCrachaData(forcar, req.usuario.escopo));
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
    await garantirEscopoMatriculaComConn(conn, body.matricula, req.usuario.escopo);
    const registro = await salvarControleComConn(conn, body.matricula, campos, usuario);
    limparCacheDashboard();
    res.json({ ok: true, registro });
  } catch (err) {
    res.status((err && err.status) || 400).json({ error: err && err.message ? err.message : "Falha ao salvar o crachá." });
  } finally {
    await fecharJdbc(conn);
  }
}));

// Atualizar somente o status (avançar/voltar etapa) — grava no overlay.
app.post("/api/cracha/status", apiLimiter, express.json(), autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("entregaCracha", DASH_CONFIG.NIVEL_ADMIN), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const usuario = (req.usuario && (req.usuario.email || req.usuario.login)) || "painel";
    await garantirEscopoMatriculaComConn(conn, (req.body || {}).matricula, req.usuario.escopo);
    const registro = await atualizarStatusCrachaComConn(conn, (req.body || {}).matricula, (req.body || {}).status, usuario);
    limparCacheDashboard();
    res.json({ ok: true, registro });
  } catch (err) {
    res.status((err && err.status) || 400).json({ error: err && err.message ? err.message : "Falha ao atualizar o status." });
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
    await garantirEscopoMatriculasComConn(conn, matriculas, req.usuario.escopo);
    const { registros, erros } = await atualizarStatusLoteComConn(conn, matriculas, status, usuario);
    limparCacheDashboard();
    res.json({ ok: true, registros, erros });
  } catch (err) {
    res.status((err && err.status) || 400).json({ error: err && err.message ? err.message : "Falha ao atualizar os status em lote." });
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
    await garantirEscopoMatriculasComConn(conn, matriculas, req.usuario.escopo);
    const { registros, erros } = await atualizarLoteComConn(conn, matriculas, campos, usuario);
    limparCacheDashboard();
    res.json({ ok: true, registros, erros });
  } catch (err) {
    res.status((err && err.status) || 400).json({ error: err && err.message ? err.message : "Falha ao aplicar as alterações em lote." });
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
    const linhas = (req.body || {}).linhas;
    await garantirEscopoMatriculasComConn(conn, (Array.isArray(linhas) ? linhas : []).map(l => l && l.matricula), req.usuario.escopo);
    const resultado = await importarCrachasComConn(conn, linhas, usuario);
    limparCacheDashboard();
    res.json({ ok: true, ...resultado });
  } catch (err) {
    res.status((err && err.status) || 400).json({ error: err && err.message ? err.message : "Falha ao importar a planilha." });
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
    await garantirEscopoMatriculaComConn(conn, body.matricula, req.usuario.escopo);
    const { buffer, mime } = decodificarImagemDataUrl(body.dataUrl);
    const registro = await salvarFotoCrachaComConn(conn, body.matricula, buffer, mime, usuario);
    limparCacheDashboard();
    res.json({ ok: true, registro });
  } catch (err) {
    res.status((err && err.status) || 400).json({ error: err && err.message ? err.message : "Falha ao salvar a foto." });
  } finally {
    await fecharJdbc(conn);
  }
}));

// Foto do crachá — remover: administradores.
app.delete("/api/cracha/foto/:matricula", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("entregaCracha", DASH_CONFIG.NIVEL_ADMIN), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const usuario = (req.usuario && (req.usuario.email || req.usuario.login)) || "painel";
    await garantirEscopoMatriculaComConn(conn, req.params.matricula, req.usuario.escopo);
    const registro = await removerFotoCrachaComConn(conn, req.params.matricula, usuario);
    limparCacheDashboard();
    res.json({ ok: true, registro });
  } catch (err) {
    res.status((err && err.status) || 400).json({ error: err && err.message ? err.message : "Falha ao remover a foto." });
  } finally {
    await fecharJdbc(conn);
  }
}));

// Foto do crachá — servir a imagem: mesmo nível de leitura do GET /api/cracha.
app.get("/api/cracha/foto/:matricula", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("entregaCracha", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    await garantirEscopoMatriculaComConn(conn, req.params.matricula, req.usuario.escopo); // escopo por DSEI
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
    await garantirEscopoMatriculaComConn(conn, (req.body || {}).matricula, req.usuario.escopo);
    const registro = await reverterControleComConn(conn, (req.body || {}).matricula);
    limparCacheDashboard();
    res.json({ ok: true, registro });
  } catch (err) {
    res.status((err && err.status) || 400).json({ error: err && err.message ? err.message : "Falha ao reverter o crachá." });
  } finally {
    await fecharJdbc(conn);
  }
}));

app.get("/api/remanejamento/lista", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("remanejamento", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  res.json(await getRemanejamentoListaData(req.usuario.escopo));
}));

app.get("/api/remanejamento/cadastro", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("remanejamento", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  res.json(await getRemanejamentoCadastroData(req.usuario.escopo));
}));

app.get("/api/remanejamento/anexo/:id", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("remanejamento", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    await garantirEscopoProcessoComConn(conn, req.params.id, req.usuario.escopo); // escopo por DSEI
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
  res.json(await getRemanejamentoDetalheData(req.params.id, req.usuario.escopo));
}));

app.get("/api/remanejamento/edicao/:id", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("remanejamento", DASH_CONFIG.NIVEL_ACESSO_APROVADO), asyncHandler(async (req, res) => {
  res.json(await getRemanejamentoEdicaoData(req.params.id, req.usuario.escopo));
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
      const resultado = await atualizarRemanejamentoComConn(conn, req.params.id, req.body || {}, req.file || null, req.usuario.escopo);
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
      await excluirRemanejamentoComConn(conn, req.params.id, req.usuario.escopo);
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

// Auto-cadastro por usuário/senha: cria a conta como pendente (ATIVO=0) e já
// abre a sessão limitada, levando o usuário à tela de solicitação de acesso.
app.post("/api/registrar", loginLimiter, express.json(), asyncHandler(async (req, res) => {
  try {
    const resultado = await registrarUsuarioLocal(req.body || {});
    definirCookieSessao(req, res, resultado.token);
    await anexarPermissoesUsuario(resultado.usuario);
    res.status(201).json({ usuario: resultado.usuario, aprovado: resultado.aprovado });
  } catch (err) {
    res.status(400).json({ error: err && err.message ? err.message : "Falha ao criar a conta." });
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
    // Permissões por módulo (sem mais nível global: módulo sem linha = sem acesso).
    usuario.permissoes = usuario.aprovado ? await obterMapaPermissoesComConn(conn, usuario.email) : {};
    // Escopo de DSEI: enviado para o front detectar mudança e recarregar (o
    // heartbeat compara com o snapshot anterior, igual às permissões de aba).
    usuario.escopo = usuario.aprovado ? await obterEscopoUsuarioComConn(conn, usuario.email) : { todos: true, dseis: [] };
    res.json({ usuario });
  } finally {
    await fecharJdbc(conn);
  }
}));

// Gate da aba de administração de perfis (regra mandatória = matriz). O acesso é
// definido exclusivamente pelo nível do ator no módulo "solicitacoes" (sem mais
// fallback para um nível global). Super admin = nível 3 nesse módulo.
//   minNivel 1 = ver a aba (somente leitura)   2 = administrar (aprovar/editar)
function nivelAdminEfetivo(mapa) {
  return Number((mapa && mapa.solicitacoes) || 0);
}

function exigirAdminPerfisMiddleware(minNivel) {
  return function (req, res, next) {
    getMysqlConnection()
      .then(async (conn) => {
        try {
          const mapa = await obterMapaPermissoesComConn(conn, req.usuario.email);
          req.permissoesMapa = mapa;
          if (nivelAdminEfetivo(mapa) < minNivel) {
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
// do ator no módulo informado. Sem linha gravada para (usuário, módulo) = 0 (Sem
// acesso). Anexa o mapa completo em req.permissoesMapa para os handlers reusarem.
//   minNivel 1 = leitor · 2 = editor · 3 = administrador do módulo
function exigirPermissaoModuloMiddleware(modulo, minNivel) {
  return function (req, res, next) {
    getMysqlConnection()
      .then(async (conn) => {
        try {
          const mapa = await obterMapaPermissoesComConn(conn, req.usuario.email);
          req.permissoesMapa = mapa;
          const efetivo = Number(mapa[modulo] || 0);
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

// Listas de referência (DSEI/CASAI/coordenações/cargos) para os dropdowns do
// formulário de solicitação. Auth opcional: o usuário novo (ainda sem conta)
// precisa preencher o cadastro antes de existir, então não exige sessão.
app.get("/api/acesso/listas", apiLimiter, autenticarOpcionalMiddleware, asyncHandler(async (req, res) => {
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
    res.setHeader("Cache-Control", "no-store"); // dados de acesso: sempre frescos
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

// (Removido) /api/acesso/usuario/nivel — o "nível global" do usuário deixou de
// existir. Todo acesso é definido por módulo na matriz (/api/acesso/perfis/permissao).

// Enriquece o objeto de usuário (devolvido no login) com os overrides de
// permissão por módulo E o escopo de DSEI. Assim o snapshot inicial casa com o
// que o /api/sessao devolve, evitando um recarregamento espúrio no 1º heartbeat.
// Best-effort: uma falha aqui não impede o login.
async function anexarPermissoesUsuario(usuario) {
  if (!usuario || !usuario.aprovado) {
    if (usuario) { usuario.permissoes = {}; usuario.escopo = { todos: true, dseis: [] }; }
    return;
  }
  const conn = await getMysqlConnection();
  try {
    usuario.permissoes = await obterMapaPermissoesComConn(conn, usuario.email);
  } catch (e) {
    usuario.permissoes = {};
  }
  try {
    usuario.escopo = await obterEscopoUsuarioComConn(conn, usuario.email);
  } catch (e) {
    usuario.escopo = { todos: true, dseis: [] };
  } finally {
    await fecharJdbc(conn);
  }
}

// ---- Perfis de acesso (matriz de permissões por módulo) ----

// Super admin: lista os módulos e os usuários aprovados com seus overrides.
app.get("/api/acesso/perfis", apiLimiter, autenticarFrescoMiddleware, exigirAdminPerfisMiddleware(1), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    res.setHeader("Cache-Control", "no-store"); // dados de permissão: sempre frescos
    const usuarios = await listarPerfisAcessoComConn(conn);
    // Anexa o escopo de DSEI de cada usuário + a lista de DSEIs disponíveis, para
    // a matriz exibir/editar o acesso por unidade (sede = todos; restrito = lista).
    const escopos = await obterEscoposMapaComConn(conn);
    for (const u of usuarios) {
      u.escopo = escopos[String(u.email || "").trim().toLowerCase()] || { todos: true, dseis: [] };
    }
    const dseisDisponiveis = await listarDseisComConn(conn);
    res.json({ modulos: MODULOS_PERMISSAO, usuarios, dseisDisponiveis });
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

// Super admin: remove todas as permissões de um usuário (fica sem acesso a tudo).
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

// Super admin: define o escopo de DSEI de um usuário (acesso total ou restrito a
// um conjunto de DSEIs). É um atributo da pessoa (vale para todos os módulos).
app.post("/api/acesso/perfis/escopo", apiLimiter, autenticarFrescoMiddleware, exigirAdminPerfisMiddleware(2), express.json(), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const body = req.body || {};
    const resultado = await definirEscopoUsuarioComConn(conn, body.email, body.todos, body.dseis);
    res.json({ ok: true, ...resultado });
  } catch (err) {
    res.status(400).json({ error: err && err.message ? err.message : "Falha ao definir o escopo de DSEI." });
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

// Super admin = nível 3 no módulo de administração ("solicitacoes"). Lê o mapa de
// permissões anexado em req.permissoesMapa pelo exigirPermissaoModuloMiddleware
// (todas as rotas que chamam isto passam antes por aquele middleware).
function ehSuperAdmin(req) {
  return Number((req.permissoesMapa || {}).solicitacoes || 0) >= DASH_CONFIG.NIVEL_SUPERADMIN;
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
    res.json({ pedidos: await listarPedidosComConn(conn, req.usuario.escopo) });
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
    res.json({ trabalhadores: await buscarTrabalhadoresComConn(conn, (req.query || {}).q, req.usuario.escopo) });
  } finally {
    await fecharJdbc(conn);
  }
}));

app.post("/api/disciplinar", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("gestaoDisciplinar", DASH_CONFIG.NIVEL_ADMIN), upload.fields([{ name: "oficio", maxCount: 1 }, { name: "anexos", maxCount: 20 }]), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const body = { ...(req.body || {}) };
    // Delegação de responsável na criação é exclusiva de administradores do
    // módulo (gestaoDisciplinar >= 2). req.permissoesMapa vem do middleware acima.
    const ehAdmin = Number((req.permissoesMapa || {}).gestaoDisciplinar || 0) >= DASH_CONFIG.NIVEL_ADMIN;
    if (!ehAdmin) body.responsavel = "";
    const oficio = (req.files && req.files.oficio && req.files.oficio[0]) || null;
    const anexos = (req.files && req.files.anexos) || [];
    let tipos = [];
    try { tipos = JSON.parse(body.anexosTipos || "[]"); } catch (e) { tipos = []; }
    const pedido = await criarPedidoComConn(conn, body, loginDoToken(req), oficio, anexos, tipos, req.usuario.escopo);
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
    await garantirEscopoPedidoComConn(conn, req.params.id, req.usuario.escopo); // escopo por DSEI
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
    await garantirEscopoPedidoComConn(conn, req.params.id, req.usuario.escopo); // escopo por DSEI
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
    await garantirEscopoPedidoComConn(conn, req.params.id, req.usuario.escopo); // escopo por DSEI
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
    await garantirEscopoPedidoComConn(conn, req.params.id, req.usuario.escopo); // escopo por DSEI
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
    await garantirEscopoPedidoComConn(conn, req.params.id, req.usuario.escopo); // escopo por DSEI
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
    await garantirEscopoPedidoComConn(conn, req.params.id, req.usuario.escopo); // escopo por DSEI
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
    await garantirEscopoPedidoComConn(conn, req.params.id, req.usuario.escopo); // escopo por DSEI
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
    await garantirEscopoPedidoComConn(conn, req.params.id, req.usuario.escopo); // escopo por DSEI
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
    await garantirEscopoAnexoComConn(conn, req.params.idAnexo, req.usuario.escopo); // escopo por DSEI
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
    await garantirEscopoAnexoComConn(conn, req.params.idAnexo, req.usuario.escopo); // escopo por DSEI
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
      const resultado = await salvarRemanejamentoComConn(conn, body, req.file || null, req.usuario.escopo);
      limparCacheDashboard();
      res.json({ ok: true, ...resultado });
    } catch (err) {
      res.status(400).json({ error: err && err.message ? err.message : "Falha ao salvar o remanejamento." });
    } finally {
      await fecharJdbc(conn);
    }
  })
);

// Ação de sistema (não pertence a um módulo): exige administrador de perfis.
app.post("/api/cache/clear", apiLimiter, autenticarFrescoMiddleware, exigirAdminPerfisMiddleware(2), asyncHandler(async (req, res) => {
  limparCacheDashboard();
  res.json({ ok: true });
}));

// Extrai o quadro de vagas e o cronograma de um PDF de anexo enviado pelo usuário
// (aba Processos Seletivos). O arquivo é processado em memória e NÃO é gravado.
//
// A extração roda em Python (pdfplumber). Como o runtime Node serverless da
// Vercel não tem Python, há dois caminhos:
//   • Vercel  -> chama a Função Python (api/extrair_anexo.py) por HTTP.
//   • Local   -> executa o CLI scripts/extrair_anexo_local.py via `spawn`.
// Ambos usam a MESMA lógica (o CLI importa de api/extrair_anexo.py).
const PYTHON_BIN = process.env.PYTHON_BIN || "python";
const EXTRATOR_ANEXO = path.join(__dirname, "scripts", "extrair_anexo_local.py");

// Usa a função HTTP quando: estamos na Vercel, ou uma URL foi configurada.
function usarExtratorHttp() {
  return !!(process.env.VERCEL || process.env.EXTRATOR_ANEXO_URL);
}

// Vercel: POST dos bytes do PDF para a Função Python, no mesmo domínio.
async function extrairAnexoViaHttp(buffer, req) {
  const url = process.env.EXTRATOR_ANEXO_URL
    || `https://${req.headers.host}/api/extrair_anexo`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/pdf",
        // Segredo opcional: se EXTRATOR_ANEXO_TOKEN existir, a função o exige.
        ...(process.env.EXTRATOR_ANEXO_TOKEN ? { "x-extrator-token": process.env.EXTRATOR_ANEXO_TOKEN } : {})
      },
      body: buffer,
      signal: controller.signal
    });
    const dados = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(dados.erro || dados.error || "Falha ao extrair os dados do PDF.");
    return dados;
  } catch (e) {
    if (e && e.name === "AbortError") {
      throw new Error("Tempo excedido ao ler o PDF (o arquivo pode ser muito grande).");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Local (dev): pipe do PDF pelo stdin do CLI Python e lê o JSON no stdout.
function extrairAnexoViaPython(buffer) {
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

function extrairAnexoPdf(buffer, req) {
  return usarExtratorHttp() ? extrairAnexoViaHttp(buffer, req) : extrairAnexoViaPython(buffer);
}

// Lista de DSEIs/CASAIs (com UF) para o combobox do cadastro de editais.
// Nível de leitura basta (a lista alimenta o formulário, visível a quem já
// acessa o módulo). Cacheada na camada lib.
app.get(
  "/api/processos-seletivos/dseis",
  apiLimiter,
  autenticarFrescoMiddleware,
  exigirPermissaoModuloMiddleware("processosSeletivos", DASH_CONFIG.NIVEL_ACESSO_APROVADO),
  asyncHandler(async (req, res) => {
    const conn = await getMysqlConnection();
    try {
      res.json({ dseis: await listarDseisCasaiComConn(conn) });
    } finally {
      await fecharJdbc(conn);
    }
  })
);

// ---- Editais: persistência (EDITAL + CRONOGRAMA + VAGA + APROVADO) ----
const psLeitura = [apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("processosSeletivos", DASH_CONFIG.NIVEL_ACESSO_APROVADO)];
const psEscrita = [apiLimiter, express.json({ limit: "2mb" }), autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("processosSeletivos", DASH_CONFIG.NIVEL_ADMIN)];

app.get("/api/processos-seletivos/editais", ...psLeitura, asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try { res.json({ editais: await listarEditaisComConn(conn) }); }
  finally { await fecharJdbc(conn); }
}));

app.post("/api/processos-seletivos/editais", ...psEscrita, asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try { res.json({ ok: true, id: String(await criarEditalComConn(conn, req.body || {})) }); }
  finally { await fecharJdbc(conn); }
}));

app.put("/api/processos-seletivos/editais/:id", ...psEscrita, asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try { await atualizarEditalComConn(conn, Number(req.params.id), req.body || {}); res.json({ ok: true }); }
  finally { await fecharJdbc(conn); }
}));

app.delete("/api/processos-seletivos/editais/:id", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("processosSeletivos", DASH_CONFIG.NIVEL_ADMIN), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try { await excluirEditalComConn(conn, Number(req.params.id)); res.json({ ok: true }); }
  finally { await fecharJdbc(conn); }
}));

// (Re)insere o anexo extraído (cronograma + quadro de vagas) de um edital.
app.post("/api/processos-seletivos/editais/:id/anexo", ...psEscrita, asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try { await substituirAnexoComConn(conn, Number(req.params.id), req.body || {}); res.json({ ok: true }); }
  finally { await fecharJdbc(conn); }
}));

// Remove o anexo do edital (cronograma, quadro de vagas e aprovados). Destrutivo:
// exige nível admin, como as demais exclusões do módulo.
app.delete("/api/processos-seletivos/editais/:id/anexo", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("processosSeletivos", DASH_CONFIG.NIVEL_ADMIN), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try { await removerAnexoComConn(conn, Number(req.params.id)); res.json({ ok: true }); }
  finally { await fecharJdbc(conn); }
}));

app.post("/api/processos-seletivos/vagas/:vagaId/aprovados", ...psEscrita, asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try { res.json({ ok: true, id: String(await criarAprovadoComConn(conn, Number(req.params.vagaId), req.body || {})) }); }
  finally { await fecharJdbc(conn); }
}));

app.put("/api/processos-seletivos/aprovados/:id", ...psEscrita, asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try { await atualizarAprovadoComConn(conn, Number(req.params.id), req.body || {}); res.json({ ok: true }); }
  finally { await fecharJdbc(conn); }
}));

app.delete("/api/processos-seletivos/aprovados/:id", apiLimiter, autenticarFrescoMiddleware, exigirPermissaoModuloMiddleware("processosSeletivos", DASH_CONFIG.NIVEL_ADMIN), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try { await excluirAprovadoComConn(conn, Number(req.params.id)); res.json({ ok: true }); }
  finally { await fecharJdbc(conn); }
}));

app.post(
  "/api/processos-seletivos/extrair-anexo",
  apiLimiter,
  autenticarFrescoMiddleware,
  exigirPermissaoModuloMiddleware("processosSeletivos", DASH_CONFIG.NIVEL_ADMIN),
  comNomesUtf8(uploadEditalAnexo.single("anexo")),
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
      const dados = await extrairAnexoPdf(req.file.buffer, req);
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
  let message = podeExpor && err && err.message ? err.message : "Erro interno. Tente novamente mais tarde.";
  // Mensagens do multer vêm em inglês (ex.: "File too large") — traduz p/ o usuário.
  if (ehMulter) {
    const msgsMulter = {
      LIMIT_FILE_SIZE: "Arquivo muito grande. Envie um PDF menor.",
      LIMIT_FILE_COUNT: "Foram enviados arquivos demais.",
      LIMIT_UNEXPECTED_FILE: "Campo de arquivo inesperado."
    };
    message = msgsMulter[err.code] || "Não foi possível processar o arquivo enviado.";
  }
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

  garantirTabelaFeedbackAssistente().catch(err => {
    console.error("Não foi possível garantir a tabela de feedback do assistente:", err && err.message ? err.message : err);
  });

  garantirTabelaPermissoesModulos().catch(err => {
    console.error("Não foi possível garantir a tabela de permissões por módulo:", err && err.message ? err.message : err);
  });

  garantirEstruturaEscopoDsei().catch(err => {
    console.error("Não foi possível garantir a estrutura de escopo de DSEI:", err && err.message ? err.message : err);
  });

  garantirColunaConteudoProva().catch(err => {
    console.error("Não foi possível garantir a coluna de conteúdo das provas disciplinares:", err && err.message ? err.message : err);
  });

  garantirColunasDatasFasesDemanda().catch(err => {
    console.error("Não foi possível garantir as colunas de datas das etapas disciplinares:", err && err.message ? err.message : err);
  });

  garantirColunaDseiPedidoSancao().catch(err => {
    console.error("Não foi possível garantir a coluna id_dsei_casai em PEDIDO_SANCAO:", err && err.message ? err.message : err);
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

// Envia um objeto como JSON, comprimindo com gzip quando o cliente aceita e o
// corpo é grande o suficiente para compensar (o app não usa middleware global de
// compressão). Fallback para JSON puro em erro/corpo pequeno.
function responderJsonTalvezComprimido(req, res, obj) {
  const json = JSON.stringify(obj);
  res.type("application/json");
  res.setHeader("Vary", "Accept-Encoding");
  const aceitaGzip = /\bgzip\b/i.test(String(req.headers["accept-encoding"] || ""));
  if (!aceitaGzip || Buffer.byteLength(json) < 2048) {
    res.send(json);
    return;
  }
  zlib.gzip(json, (err, buf) => {
    if (err || res.headersSent) { res.send(json); return; }
    res.setHeader("Content-Encoding", "gzip");
    res.send(buf);
  });
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
  _excluirUsuarioComConn: excluirUsuarioComConn
});
