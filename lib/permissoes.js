// Domínio: permissões por módulo/aba (matriz de perfis de acesso).
// Cada usuário pode ter um nível específico (0..3) em cada módulo; quando não há
// linha gravada para (usuário, módulo), vale o NIVEL_AUTORIZACAO global do usuário.
//   0 = Sem acesso   1 = Leitor   2 = Editor   3 = Administrador
const { DASH_CONFIG } = require("./config");
const { getMysqlConnection, fecharJdbc } = require("./db");

// Módulos = abas reais do painel. A chave casa com o data-view do menu lateral
// (usada no front para esconder/bloquear a aba). O rótulo/ícone alimentam a matriz.
const MODULOS = [
  { chave: "visaoGeral", rotulo: "Visão Geral", icone: "fa-chart-pie" },
  { chave: "vagas", rotulo: "Vagas", icone: "fa-folder-open" },
  { chave: "remanejamento", rotulo: "Remanejamento", icone: "fa-folder-tree" },
  { chave: "alertas", rotulo: "Alertas", icone: "fa-circle-exclamation" },
  { chave: "painelSaudeIndigena", rotulo: "Dashboard SI", icone: "fa-chart-column" },
  { chave: "gestaoFerias", rotulo: "Gestão de Férias", icone: "fa-calendar-check" },
  { chave: "entregaCracha", rotulo: "Entrega de Crachá", icone: "fa-id-card" },
  { chave: "gestaoDisciplinar", rotulo: "Gestão Disciplinar", icone: "fa-gavel" },
  { chave: "processosSeletivos", rotulo: "Processos Seletivos", icone: "fa-clipboard-list" },
  // Aba de administração (Solicitações + esta matriz). Exclusiva de super admin;
  // 0 = não vê a aba · 1 = vê (somente leitura) · 2+ = pode administrar.
  { chave: "solicitacoes", rotulo: "Perfis de Acesso", icone: "fa-user-shield" }
];
const CHAVES_MODULOS = new Set(MODULOS.map(m => m.chave));
const NIVEIS_VALIDOS = new Set([0, 1, 2, 3]);

function tabelaPermissoes() {
  return `\`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.PERMISSOES_MODULOS_TABLE}\``;
}

async function garantirTabelaPermissoesModulos() {
  const conn = await getMysqlConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS ${tabelaPermissoes()} (
        \`ID_PERMISSAO\` BIGINT NOT NULL AUTO_INCREMENT,
        \`EMAIL\`        VARCHAR(255) NOT NULL,
        \`MODULO\`       VARCHAR(60)  NOT NULL,
        \`NIVEL\`        INT NOT NULL DEFAULT 0,
        \`ATUALIZADO_EM\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`ID_PERMISSAO\`),
        UNIQUE KEY \`UQ_${DASH_CONFIG.PERMISSOES_MODULOS_TABLE}_EMAIL_MODULO\` (\`EMAIL\`, \`MODULO\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } finally {
    await fecharJdbc(conn);
  }
}

function normalizarEmail(email) {
  return String(email || "").trim().toLowerCase();
}

// Mapa { modulo: nivel } com APENAS os overrides explícitos do usuário.
// O front aplica o fallback para o nível global quando a chave está ausente.
async function obterMapaPermissoesComConn(conn, email) {
  const e = normalizarEmail(email);
  if (!e) return {};
  const [rows] = await conn.query(
    `SELECT \`MODULO\`, \`NIVEL\` FROM ${tabelaPermissoes()} WHERE \`EMAIL\` = ?`,
    [e]
  );
  const mapa = {};
  for (const r of rows || []) {
    if (CHAVES_MODULOS.has(r.MODULO)) mapa[r.MODULO] = Number(r.NIVEL || 0);
  }
  return mapa;
}

// Lista usuários aprovados (ATIVO=1) com seus overrides de permissão por módulo.
async function listarPerfisAcessoComConn(conn) {
  const tabU = `\`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.USUARIOS_TABLE}\``;
  const [usuarios] = await conn.query(
    `SELECT \`LOGIN\`, \`NOME\`, \`EMAIL\`, \`NIVEL_AUTORIZACAO\`
       FROM ${tabU} WHERE \`ATIVO\` = 1 ORDER BY \`NOME\`, \`LOGIN\``
  );
  const [perms] = await conn.query(
    `SELECT \`EMAIL\`, \`MODULO\`, \`NIVEL\` FROM ${tabelaPermissoes()}`
  );

  const porEmail = new Map();
  for (const p of perms || []) {
    if (!CHAVES_MODULOS.has(p.MODULO)) continue;
    const e = normalizarEmail(p.EMAIL);
    if (!porEmail.has(e)) porEmail.set(e, {});
    porEmail.get(e)[p.MODULO] = Number(p.NIVEL || 0);
  }

  return (usuarios || []).map(u => {
    const email = normalizarEmail(u.EMAIL);
    return {
      login: u.LOGIN || "",
      nome: u.NOME || "",
      email: u.EMAIL || "",
      nivel: Number(u.NIVEL_AUTORIZACAO || 0),
      permissoes: porEmail.get(email) || {}
    };
  });
}

// Upsert de uma célula da matriz (usuário × módulo).
async function definirPermissaoModuloComConn(conn, email, modulo, nivel) {
  const e = normalizarEmail(email);
  if (!e) throw new Error("E-mail inválido.");
  if (!CHAVES_MODULOS.has(String(modulo))) throw new Error("Módulo inválido.");
  const n = Number(nivel);
  if (!NIVEIS_VALIDOS.has(n)) throw new Error("Nível inválido.");

  await conn.execute(
    `INSERT INTO ${tabelaPermissoes()} (\`EMAIL\`, \`MODULO\`, \`NIVEL\`)
       VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE \`NIVEL\` = VALUES(\`NIVEL\`)`,
    [e, String(modulo), n]
  );
  return { email: e, modulo: String(modulo), nivel: n };
}

// Remove todos os overrides de um usuário (volta a valer o nível global).
async function limparPermissoesUsuarioComConn(conn, email) {
  const e = normalizarEmail(email);
  if (!e) throw new Error("E-mail inválido.");
  const [res] = await conn.execute(
    `DELETE FROM ${tabelaPermissoes()} WHERE \`EMAIL\` = ?`,
    [e]
  );
  return { email: e, removidos: (res && res.affectedRows) || 0 };
}

module.exports = {
  MODULOS,
  garantirTabelaPermissoesModulos,
  obterMapaPermissoesComConn,
  listarPerfisAcessoComConn,
  definirPermissaoModuloComConn,
  limparPermissoesUsuarioComConn
};
