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
  // Polo base mapeado por matrícula (aba Escala de Trabalho). Cruzada com a
  // VW_SAUDE_INDIGENA pela MATRICULA para trazer nome/cargo/DSEI + o polo (LOTACAO).
  LOTACAO_OVERRIDE_TABLE: process.env.LOTACAO_OVERRIDE_TABLE || "TB_LOTACAO_OVERRIDE",
  // Escala de trabalho gravada por matrícula (aba Escala de Trabalho). Tabela-
  // companheira: guarda a escala real editada (tipo, alternância, dias marcados,
  // UBSI, polo, território) sem tocar na identidade (view) nem no polo base (override).
  ESCALA_TABLE: process.env.ESCALA_TABLE || "TB_ESCALA_TRABALHO",
  // Solicitações de acesso (fluxo de aprovação para usuários sem liberação).
  SOLICITACOES_ACESSO_TABLE: process.env.SOLICITACOES_ACESSO_TABLE || "SOLICITACOES_ACESSO",
  // Feedback do assistente virtual (robô flutuante). Cada linha guarda a mensagem
  // enviada pelo usuário, a aba de origem e a identificação de quem enviou.
  FEEDBACK_ASSISTENTE_TABLE: process.env.FEEDBACK_ASSISTENTE_TABLE || "FEEDBACK_ASSISTENTE",
  // Permissões por módulo/aba (matriz de perfis de acesso). Cada linha guarda o
  // nível de um usuário (por e-mail) em um módulo específico. Não há mais nível
  // global: sem linha para (usuário, módulo), o nível é 0 (Sem acesso). A coluna
  // NIVEL_AUTORIZACAO na tabela de usuários é OBSOLETA (mantida só por histórico).
  PERMISSOES_MODULOS_TABLE: process.env.PERMISSOES_MODULOS_TABLE || "PERMISSOES_MODULOS",
  // Escopo de dados por DSEI/CASAI: DSEIs liberados a um usuário restrito (quando
  // USUARIOS_PAINEL.ACESSO_TODOS_DSEIS = 0). Sede/escritório = acesso total.
  USUARIO_DSEI_TABLE: process.env.USUARIO_DSEI_TABLE || "USUARIO_DSEI",
  // Nível MÍNIMO (por módulo) para visualizar uma aba — 1 = Leitor. Usado como
  // piso nas rotas GET de cada módulo. (Não é mais o "nível de aprovação": a conta
  // aprovada nasce sem acesso e o admin concede cada aba na matriz de perfis.)
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
  // Nível inicial concedido em TODOS os módulos funcionais a um e-mail da allowlist
  // individual do Google que entra direto (sem aprovação). 0 = entra sem acesso.
  GOOGLE_NIVEL_PADRAO: Number(process.env.GOOGLE_NIVEL_PADRAO || 1),
  // Nível mínimo de autorização exigido por ação. Centraliza a regra de acesso;
  // novos níveis/páginas podem ser definidos futuramente.
  NIVEL_REMANEJAMENTO_SALVAR: Number(process.env.NIVEL_REMANEJAMENTO_SALVAR || 2),
  // Ajustes pontuais (movimentações sem processo) são exclusivos do administrador
  // do módulo (nível 3), o mesmo que pode alterar remanejamentos existentes.
  NIVEL_REMANEJAMENTO_AJUSTE: Number(process.env.NIVEL_REMANEJAMENTO_AJUSTE || 3),
  REMANEJAMENTO_CADASTRO_VIEW: process.env.REMANEJAMENTO_CADASTRO_VIEW || "vw_remanejamento_vagas_cadastro",
  CACHE_MONITORAMENTO_KEY: "DASH_MONITORAMENTO_V1_MYSQL",
  CACHE_MONITORAMENTO_TOTAIS_KEY: "DASH_MONITORAMENTO_TOTAIS_V1_MYSQL",
  CACHE_REMANEJAMENTO_LISTA_KEY: "DASH_REMANEJAMENTO_LISTA_V1_MYSQL",
  CACHE_REMANEJAMENTO_CADASTRO_KEY: "DASH_REMANEJAMENTO_CADASTRO_V1_MYSQL",
  CACHE_CRACHAS_KEY: "DASH_CRACHAS_V1_MYSQL",
  CACHE_SAUDE_INDIGENA_KEY: "DASH_SAUDE_INDIGENA_V1_MYSQL",
  CACHE_MAPA_DSEIS_KEY: "DASH_MAPA_DSEIS_V1_MYSQL",
  CACHE_FERIAS_KEY: "DASH_FERIAS_V1_MYSQL",
  CACHE_ESCALA_KEY: "DASH_ESCALA_V1_MYSQL",
  CACHE_SECONDS: Number(process.env.CACHE_SECONDS || 300)
};

// Identificadores SQL (schema, tabelas, views) são interpolados diretamente nas
// queries como nomes — não podem usar placeholders `?`. Embora venham de env (não
// de input do usuário), um env malformado interpolado num identificador abriria
// porta para injeção. Validamos contra uma allowlist estrita no boot e abortamos
// se algum vier fora do padrão, em vez de confiar cegamente na configuração.
function validarIdentificadoresSql(cfg) {
  const PADRAO = /^[A-Za-z0-9_]+$/;
  const chaves = [
    "DB_SCHEMA", "MONITORAMENTO_VIEW", "ALERTAS_OBSERVACOES_TABLE",
    "CUSTO_GERAL_VAGA_TABLE", "PROCESSO_REMANEJAMENTO_TABLE",
    "MOVIMENTACAO_REMANEJAMENTO_TABLE", "USUARIOS_TABLE", "CRACHAS_TABLE",
    "CRACHAS_CONTROLE_TABLE", "TRABALHADOR_CONSOLIDADO_TABLE",
    "LOTACAO_OVERRIDE_TABLE", "ESCALA_TABLE",
    "SOLICITACOES_ACESSO_TABLE", "PERMISSOES_MODULOS_TABLE",
    "USUARIO_DSEI_TABLE", "REMANEJAMENTO_CADASTRO_VIEW",
    "FEEDBACK_ASSISTENTE_TABLE"
  ];
  const invalidos = chaves.filter((k) => !PADRAO.test(String(cfg[k] || "")));
  if (invalidos.length) {
    throw new Error(
      "Identificador(es) SQL inválido(s) na configuração: " + invalidos.join(", ") +
      ". Use apenas letras, números e underscore (regex ^[A-Za-z0-9_]+$) nas variáveis " +
      "de schema/tabela/view — caracteres fora disso são rejeitados por segurança."
    );
  }
}

validarIdentificadoresSql(DASH_CONFIG);

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
