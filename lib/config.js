// Configuração central do painel (env, conexão MySQL, porta).
// Sem dependências internas — é a base que os demais módulos consomem.
require("dotenv").config();

// Resolve e valida o segredo de assinatura do JWT. Em produção é obrigatório
// definir JWT_SECRET (>= 32 chars): sem isso, qualquer um que conheça o valor
// padrão poderia forjar tokens. Fora de produção, permite um fallback de
// desenvolvimento (com aviso) para não travar testes/ambiente local.
function resolverJwtSecret() {
  const secret = String(process.env.JWT_SECRET || "").trim();
  const ehProducao = process.env.NODE_ENV === "production";

  if (secret.length >= 32) return secret;

  if (ehProducao) {
    throw new Error(
      "JWT_SECRET ausente ou fraco. Defina a variável JWT_SECRET com pelo menos 32 caracteres " +
      "aleatórios em produção (ex.: `openssl rand -base64 48`)."
    );
  }

  console.warn(
    "[ATENÇÃO] JWT_SECRET não definido (ou com menos de 32 caracteres). " +
    "Usando um segredo de DESENVOLVIMENTO — nunca use isto em produção."
  );
  return secret || "painel-vagas-si-dev-secret-inseguro-trocar";
}

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
  // Controle de crachás da Saúde Indígena (aba Entrega de Crachá).
  // A base é recriada/truncada por um ETL diário; por isso os dados manuais
  // (status, datas, observação) ficam numa tabela-companheira ligada por MATRICULA.
  CRACHAS_TABLE: process.env.CRACHAS_TABLE || "UGP_CONTROLE_CRACHAS_SI",
  CRACHAS_CONTROLE_TABLE: process.env.CRACHAS_CONTROLE_TABLE || "UGP_CRACHAS_CONTROLE_MANUAL",
  TRABALHADOR_CONSOLIDADO_TABLE: process.env.TRABALHADOR_CONSOLIDADO_TABLE || "BD_TRABALHADOR_CONSOLIDADO",
  // Solicitações de acesso (fluxo de aprovação para usuários sem liberação).
  SOLICITACOES_ACESSO_TABLE: process.env.SOLICITACOES_ACESSO_TABLE || "SOLICITACOES_ACESSO",
  // Nível atribuído ao usuário quando uma solicitação é APROVADA (padrão).
  NIVEL_ACESSO_APROVADO: Number(process.env.NIVEL_ACESSO_APROVADO || 1),
  // Nível mínimo para gerenciar (aprovar/recusar) solicitações de acesso.
  NIVEL_ADMIN: Number(process.env.NIVEL_ADMIN || 2),
  // Nível mínimo para conceder/retirar privilégios e excluir usuários do sistema
  // (super administrador). Acima do administrador comum (NIVEL_ADMIN).
  NIVEL_SUPERADMIN: Number(process.env.NIVEL_SUPERADMIN || 3),
  JWT_SECRET: resolverJwtSecret(),
  JWT_EXPIRES: process.env.JWT_EXPIRES || "8h",
  // Nome do cookie HttpOnly que carrega o JWT da sessão (inacessível a JS/XSS).
  COOKIE_SESSAO: process.env.COOKIE_SESSAO || "painel_token",
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
  CACHE_CRACHAS_KEY: "DASH_CRACHAS_V1_MYSQL",
  CACHE_SAUDE_INDIGENA_KEY: "DASH_SAUDE_INDIGENA_V1_MYSQL",
  CACHE_SECONDS: Number(process.env.CACHE_SECONDS || 300)
};

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

module.exports = { DASH_CONFIG, getMysqlConfig, resolverPortaAplicacao, parseJdbcUrl };
