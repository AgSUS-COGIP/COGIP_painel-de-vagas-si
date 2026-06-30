// Limpeza única: remove permissões por módulo "órfãs" — linhas em
// PERMISSOES_MODULOS cujo EMAIL não corresponde a nenhum usuário em USUARIOS.
// Isso acontece com usuários excluídos ANTES da correção que passou a apagar as
// permissões junto. Sem isso, ao pedir acesso de novo com o mesmo e-mail, as
// permissões antigas reaparecem.
//
//   node scripts/limpar-permissoes-orfas.js
//
// É idempotente: rodar de novo não remove mais nada.
require("dotenv").config();
const { DASH_CONFIG } = require("../lib/config");
const { getMysqlConnection, fecharJdbc } = require("../lib/db");
const { garantirTabelaPermissoesModulos } = require("../lib/permissoes");

async function main() {
  await garantirTabelaPermissoesModulos();
  const tabPerm = `\`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.PERMISSOES_MODULOS_TABLE}\``;
  const tabU = `\`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.USUARIOS_TABLE}\``;

  const conn = await getMysqlConnection();
  try {
    const [res] = await conn.execute(
      `DELETE p FROM ${tabPerm} p
         LEFT JOIN ${tabU} u ON u.\`EMAIL\` = p.\`EMAIL\`
        WHERE u.\`EMAIL\` IS NULL`
    );
    const removidas = (res && res.affectedRows) || 0;
    console.log(`Limpeza concluída: ${removidas} permissão(ões) órfã(s) removida(s).`);
  } finally {
    await fecharJdbc(conn);
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error("Falhou:", err && err.message ? err.message : err);
  process.exit(1);
});
