// Recria/reativa o usuário administrador a partir das variáveis SEED_ADMIN_* do .env.
// Use quando o admin foi removido mas a tabela de usuários NÃO está vazia (o seed
// automático só roda com a tabela vazia). Idempotente: se o LOGIN já existir,
// atualiza a senha, reativa (ATIVO=1) e garante o nível de super administrador.
//
//   node scripts/recriar-admin.js
//
require("dotenv").config();
const bcrypt = require("bcryptjs");
const { DASH_CONFIG } = require("../lib/config");
const { getMysqlConnection, fecharJdbc } = require("../lib/db");
const { garantirTabelaPermissoesModulos, garantirSuperAdminComConn } = require("../lib/permissoes");

async function main() {
  const login = process.env.SEED_ADMIN_LOGIN || "admin";
  const senha = String(process.env.SEED_ADMIN_SENHA || "");
  const nome = process.env.SEED_ADMIN_NOME || "Administrador";
  // O acesso é por módulo, indexado por e-mail. Sem SEED_ADMIN_EMAIL, usa um
  // sintético "<login>@local" (o login local é por LOGIN, não por e-mail).
  const email = String(process.env.SEED_ADMIN_EMAIL || "").trim().toLowerCase() || `${login}@local`;

  if (!senha) {
    console.error("Defina SEED_ADMIN_SENHA no .env antes de rodar este script.");
    process.exit(1);
  }

  const tab = `\`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.USUARIOS_TABLE}\``;
  const hash = await bcrypt.hash(senha, 10);

  await garantirTabelaPermissoesModulos();
  const conn = await getMysqlConnection();
  try {
    const [rows] = await conn.query(
      `SELECT \`ID_USUARIO\` FROM ${tab} WHERE \`LOGIN\` = ? LIMIT 1`,
      [login]
    );

    if (rows && rows[0]) {
      await conn.execute(
        `UPDATE ${tab}
            SET \`SENHA_HASH\` = ?, \`ATIVO\` = 1, \`EMAIL\` = ?
          WHERE \`LOGIN\` = ?`,
        [hash, email, login]
      );
      console.log(`Admin "${login}" já existia: senha redefinida, reativado e promovido a super admin.`);
    } else {
      await conn.execute(
        `INSERT INTO ${tab}
           (\`LOGIN\`, \`SENHA_HASH\`, \`NOME\`, \`EMAIL\`, \`NIVEL_AUTORIZACAO\`, \`ATIVO\`)
         VALUES (?, ?, ?, ?, 0, 1)`,
        [login, hash, nome, email]
      );
      console.log(`Admin "${login}" criado como super administrador.`);
    }
    // Super admin no novo modelo = nível 3 em todos os módulos (indexado por e-mail).
    await garantirSuperAdminComConn(conn, email);
    console.log(`Pronto. Faça login com login="${login}" e a senha de SEED_ADMIN_SENHA.`);
  } finally {
    await fecharJdbc(conn);
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error("Falhou:", err && err.message ? err.message : err);
  process.exit(1);
});
