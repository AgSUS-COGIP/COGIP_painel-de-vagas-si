require("dotenv").config();

const path = require("path");
const express = require("express");
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

// Pool de conexões MySQL (inicializado sob demanda). Declarado no topo para evitar TDZ,
// já que a criação de tabelas no startup pode acessá-lo antes da posição original.




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

app.get("/api/sessao", autenticarMiddleware, asyncHandler(async (req, res) => {
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
app.post("/api/acesso/solicitar", autenticarMiddleware, express.json(), asyncHandler(async (req, res) => {
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

app.get("/api/acesso/listas", autenticarMiddleware, asyncHandler(async (req, res) => {
  res.json(await obterListasAcesso());
}));

// Usuário acompanha a própria situação (status + histórico de recusas).
app.get("/api/acesso/minha-solicitacao", autenticarMiddleware, asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    const situacao = await obterSituacaoAcessoComConn(conn, req.usuario.email);
    res.json({ aprovado: !!req.usuario.aprovado, ...situacao });
  } finally {
    await fecharJdbc(conn);
  }
}));

// Admin: lista pendentes + histórico.
app.get("/api/acesso/solicitacoes", autenticarFrescoMiddleware, exigirNivelMiddleware(DASH_CONFIG.NIVEL_ADMIN), asyncHandler(async (req, res) => {
  const conn = await getMysqlConnection();
  try {
    res.json(await listarSolicitacoesComConn(conn));
  } finally {
    await fecharJdbc(conn);
  }
}));

// Admin: aprova (libera o acesso imediatamente).
app.post("/api/acesso/solicitacoes/:id/aprovar", autenticarFrescoMiddleware, exigirNivelMiddleware(DASH_CONFIG.NIVEL_ADMIN), express.json(), asyncHandler(async (req, res) => {
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
app.post("/api/acesso/solicitacoes/:id/recusar", autenticarFrescoMiddleware, exigirNivelMiddleware(DASH_CONFIG.NIVEL_ADMIN), express.json(), asyncHandler(async (req, res) => {
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

// Admin: exclui o usuário das duas tabelas (usuários + solicitações).
app.post("/api/acesso/usuario/excluir", autenticarFrescoMiddleware, exigirNivelMiddleware(DASH_CONFIG.NIVEL_ADMIN), express.json(), asyncHandler(async (req, res) => {
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

// Admin: define o privilégio (nível) de um usuário.
app.post("/api/acesso/usuario/nivel", autenticarFrescoMiddleware, exigirNivelMiddleware(DASH_CONFIG.NIVEL_ADMIN), express.json(), asyncHandler(async (req, res) => {
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

  garantirTabelaSolicitacoesAcesso().catch(err => {
    console.error("Não foi possível garantir a tabela de solicitações de acesso:", err && err.message ? err.message : err);
  });
}

module.exports = app;










// ===================== Autenticação e níveis de acesso =====================


// Orquestra o login por senha: se o LDAP estiver configurado, valida primeiro
// no diretório; usuários que não existem no LDAP caem no login local (ex.: o
// admin semente e contas locais avulsas). Senha errada no LDAP NÃO faz fallback.


// ---------- Login via LDAP / Active Directory ----------

// Carrega o cliente LDAP sob demanda para o servidor não quebrar quando o
// pacote não está instalado e o LDAP está desativado.

// Escapa valores usados dentro do filtro LDAP (evita injeção de filtro).

// Primeiro valor de um atributo (ldapts pode retornar string ou array).

// Resolve o nível de autorização a partir dos grupos (memberOf) do usuário.

// Auto-cadastro/sincronização de usuário externo (LDAP) na tabela do painel.
// Usuário NOVO é criado como PENDENTE (ATIVO=0): só vira ativo após aprovação de
// um administrador (mesmo fluxo do Google). Usuário existente mantém seu ATIVO/nível.

// Valida login/senha contra o LDAP em duas etapas (padrão "search + bind"):
//   1) bind com a conta de serviço e busca o usuário (resgata os dados);
//   2) bind com o DN do usuário + a senha digitada (valida a senha).


// Login via Google (OpenID Connect). Recebe o ID token do cliente, valida com o
// Google, confere o domínio permitido e reaproveita o mesmo JWT/permissões do painel.



// Middleware: exige que o usuário esteja com acesso aprovado (ATIVO/aprovado no token).

// Relê o usuário no banco a partir do token (fonte da verdade da sessão).
// Retorna null se o usuário não existe mais (excluído) -> a sessão deve cair.
// nível/aprovado vêm SEMPRE do banco (não do token), refletindo mudanças em tempo real.


// Autenticação com REVALIDAÇÃO no banco: além de validar o token, relê nível/ativo
// do usuário no banco e usa esses valores (frescos) em req.usuario. Assim, conceder
// ou revogar privilégio passa a valer no PRÓXIMO request, sem o usuário precisar
// relogar — e quem foi revogado não consegue mais agir com o token antigo.



// ===================== Solicitações de acesso (fluxo de aprovação) =====================




// Cria ou atualiza a solicitação de acesso do usuário.
// Mantém UMA linha por usuário (por e-mail): se já existe, atualiza a mesma linha
// e a reabre como PENDENTE (limpando a decisão anterior); senão, cria a linha.


// Situação de acesso do usuário: solicitação atual (mais recente) + histórico completo.

// Lista para a tela de administração: pendentes + decididas (histórico).
// Inclui (via JOIN) o nível e o status (ativo) atual do usuário, para o admin
// poder gerenciar privilégios direto na tela.

// Define o nível de autorização (privilégio) de um usuário existente.
// nível 0/1 = usuário comum; 2 = administrador (gerencia acessos).

// Aprova: marca APROVADO e libera o usuário (ATIVO=1 + nível) na mesma transação.

// Recusa: justificativa obrigatória. Marca RECUSADO e REVOGA o acesso (ATIVO=0),
// garantindo que um usuário aprovado anteriormente perca o acesso ao ser recusado.

// Exclui o usuário das DUAS tabelas (usuários do painel + solicitações de acesso),
// removendo todas as suas informações e justificativas. Após isso, a próxima
// revalidação de sessão derruba a sessão dele (ver /api/sessao).

// Ajusta o AUTO_INCREMENT da tabela para MAX(coluna)+1, reaproveitando ids livres
// no topo (ex.: após excluir o id mais alto, o próximo volta a reutilizá-lo).



















// Mapeia o ID_VAGA (cargo) para o mesmo agrupamento usado em vagas_previstas_agg da view,
// para casar a redução solicitada com a linha consolidada de vagas ociosas.

// Valida, contra a view de monitoramento, se cada cargo a ser reduzido possui vagas
// ociosas suficientes no DSEI/CASAI. A view já desconta os remanejamentos anteriores,
// portanto a verificação é cumulativa. Lança erro (bloqueando o salvamento) se faltar.

// Número de meses do mês atual até dezembro do ano corrente (ex.: junho => 7, dezembro => 1).




// Exclui um remanejamento: remove as movimentações (MOVIMENTACAO_REMANEJAMENTO) e o
// processo (PROCESSO_REMANEJAMENTO), em transação.

// CASE de nome de cargo (mesmo mapeamento usado nas demais consultas de remanejamento).

// Monta a consulta de detalhe para um tipo de movimentação (DECRESCIMO ou ACRESCIMO).



















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




// Obtém uma conexão do pool, com novas tentativas em falhas transitórias de rede
// (ex.: ETIMEDOUT no MySQL remoto), evitando que um soluço de conexão derrube a requisição.





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
  _converterNumeroDash: converterNumeroDash,
  _salvarSolicitacaoAcessoComConn: salvarSolicitacaoAcessoComConn,
  _aprovarSolicitacaoComConn: aprovarSolicitacaoComConn,
  _recusarSolicitacaoComConn: recusarSolicitacaoComConn,
  _excluirUsuarioComConn: excluirUsuarioComConn,
  _definirNivelUsuarioComConn: definirNivelUsuarioComConn
});
