// Domínio: permissões por módulo/aba (matriz de perfis de acesso).
// Cada usuário tem um nível (0..3) em cada módulo. Não há mais "nível global":
// quando não existe linha gravada para (usuário, módulo), o nível é 0 (Sem acesso).
//   0 = Sem acesso   1 = Leitor   2 = Editor   3 = Administrador
// Super administrador = nível 3 no módulo "solicitacoes" (administra esta matriz).
const { DASH_CONFIG } = require("./config");
const { getMysqlConnection, fecharJdbc } = require("./db");

// Módulos = abas reais do painel. A chave casa com o data-view do menu lateral
// (usada no front para esconder/bloquear a aba). O rótulo/ícone alimentam a matriz.
const MODULOS = [
  { chave: "visaoGeral", rotulo: "Visão Geral", icone: "fa-chart-pie" },
  { chave: "vagas", rotulo: "Vagas", icone: "fa-folder-open" },
  { chave: "remanejamento", rotulo: "Remanejamento", icone: "fa-folder-tree" },
  { chave: "alertas", rotulo: "Alertas", icone: "fa-circle-exclamation" },
  { chave: "painelSaudeIndigena", rotulo: "Força de Trabalho", icone: "fa-chart-column" },
  { chave: "gestaoFerias", rotulo: "Gestão de Férias", icone: "fa-calendar-check" },
  { chave: "entregaCracha", rotulo: "Entrega de Crachá", icone: "fa-id-card" },
  { chave: "gestaoDisciplinar", rotulo: "Gestão Disciplinar", icone: "fa-gavel" },
  { chave: "processosSeletivos", rotulo: "Processos Seletivos", icone: "fa-clipboard-list" },
  { chave: "escalaTrabalho", rotulo: "Escala de Trabalho", icone: "fa-calendar-days" },
  { chave: "mapaDseis", rotulo: "Mapa dos DSEIs", icone: "fa-map-location-dot" },
  { chave: "controleEstabilidade", rotulo: "Controle de Estabilidade", icone: "fa-shield-halved" },
  // Ao criar uma aba nova, adicione o módulo AQUI (antes de "solicitacoes"), para
  // que sua coluna apareça na matriz antes das 3 últimas (Perfis de Acesso, Escopo, Ações).
  // Aba de administração (Solicitações + esta matriz). Exclusiva de super admin;
  // 0 = não vê a aba · 1 = vê (somente leitura) · 2+ = pode administrar.
  { chave: "solicitacoes", rotulo: "Perfis de Acesso", icone: "fa-user-shield" }
];
const CHAVES_MODULOS = new Set(MODULOS.map(m => m.chave));
const NIVEIS_VALIDOS = new Set([0, 1, 2, 3]);

// Módulo da aba de administração. Nível 3 nele = super administrador.
const MODULO_ADMIN = "solicitacoes";

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
// Módulo ausente do mapa = nível 0 (Sem acesso): não há mais fallback global.
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

// Remove todas as permissões de um usuário (fica sem acesso a todas as abas).
async function limparPermissoesUsuarioComConn(conn, email) {
  const e = normalizarEmail(email);
  if (!e) throw new Error("E-mail inválido.");
  const [res] = await conn.execute(
    `DELETE FROM ${tabelaPermissoes()} WHERE \`EMAIL\` = ?`,
    [e]
  );
  return { email: e, removidos: (res && res.affectedRows) || 0 };
}

// Conta quantos usuários são super administradores (nível 3 no módulo de
// administração). Usado no bootstrap para evitar lockout (nunca zero super admins).
async function contarSuperAdminsComConn(conn) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS total FROM ${tabelaPermissoes()} WHERE \`MODULO\` = ? AND \`NIVEL\` >= ?`,
    [MODULO_ADMIN, DASH_CONFIG.NIVEL_SUPERADMIN]
  );
  return rows && rows[0] ? Number(rows[0].total) : 0;
}

// Garante que um e-mail seja super administrador pleno: nível 3 em TODOS os
// módulos. Nunca rebaixa (GREATEST). Usado no seed/recriar-admin e no bootstrap.
async function garantirSuperAdminComConn(conn, email) {
  const e = normalizarEmail(email);
  if (!e) throw new Error("E-mail inválido para super admin.");
  for (const m of MODULOS) {
    await conn.execute(
      `INSERT INTO ${tabelaPermissoes()} (\`EMAIL\`, \`MODULO\`, \`NIVEL\`)
         VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE \`NIVEL\` = GREATEST(\`NIVEL\`, VALUES(\`NIVEL\`))`,
      [e, m.chave, DASH_CONFIG.NIVEL_SUPERADMIN]
    );
  }
  return { email: e };
}

// Define um mesmo nível para o usuário em TODOS os módulos funcionais (exclui a
// aba de administração por padrão). Usado para conceder um acesso inicial uniforme
// (ex.: e-mail Google da allowlist que entra direto com nível de leitor).
async function semearNivelTodosModulosComConn(conn, email, nivel, opcoes = {}) {
  const e = normalizarEmail(email);
  if (!e) return;
  const n = Number(nivel);
  if (!NIVEIS_VALIDOS.has(n)) return;
  const incluirAdmin = !!opcoes.incluirAdmin;
  for (const m of MODULOS) {
    if (!incluirAdmin && m.chave === MODULO_ADMIN) continue;
    await definirPermissaoModuloComConn(conn, e, m.chave, n);
  }
}

// Migração (idempotente): converte o antigo NIVEL_AUTORIZACAO global em overrides
// explícitos por módulo, para que ninguém perca acesso ao remover o nível global.
// Só INSERE onde ainda não há linha (INSERT IGNORE) — nunca sobrescreve um override
// já definido na matriz. O módulo de administração recebe 3 apenas para ex-super
// admins (global >= 3); os demais módulos recebem o próprio nível global.
async function backfillNivelGlobalComConn(conn) {
  const tabU = `\`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.USUARIOS_TABLE}\``;
  const [usuarios] = await conn.query(
    `SELECT \`LOGIN\`, \`EMAIL\`, \`NIVEL_AUTORIZACAO\` FROM ${tabU} WHERE \`ATIVO\` = 1`
  );
  let inseridos = 0;
  const semEmail = [];
  for (const u of usuarios || []) {
    const email = normalizarEmail(u.EMAIL);
    if (!email) { semEmail.push(u.LOGIN || "(sem login)"); continue; }
    const global = Number(u.NIVEL_AUTORIZACAO || 0);
    for (const m of MODULOS) {
      const nivel = m.chave === MODULO_ADMIN
        ? (global >= DASH_CONFIG.NIVEL_SUPERADMIN ? DASH_CONFIG.NIVEL_SUPERADMIN : 0)
        : global;
      const [res] = await conn.execute(
        `INSERT IGNORE INTO ${tabelaPermissoes()} (\`EMAIL\`, \`MODULO\`, \`NIVEL\`) VALUES (?, ?, ?)`,
        [email, m.chave, nivel]
      );
      inseridos += (res && res.affectedRows) || 0;
    }
  }
  return { usuarios: (usuarios || []).length, inseridos, semEmail };
}

module.exports = {
  MODULOS,
  MODULO_ADMIN,
  garantirTabelaPermissoesModulos,
  obterMapaPermissoesComConn,
  listarPerfisAcessoComConn,
  definirPermissaoModuloComConn,
  limparPermissoesUsuarioComConn,
  contarSuperAdminsComConn,
  garantirSuperAdminComConn,
  semearNivelTodosModulosComConn,
  backfillNivelGlobalComConn
};
