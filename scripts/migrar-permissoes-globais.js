// Migração única: converte o antigo nível GLOBAL (NIVEL_AUTORIZACAO) em overrides
// explícitos por módulo na tabela de permissões. Rode UMA VEZ, antes (ou junto)
// de subir o código que remove o nível global, para que ninguém perca acesso.
//
//   node scripts/migrar-permissoes-globais.js
//
// É idempotente: só insere onde ainda não há override (INSERT IGNORE). Rodar de
// novo não altera nada. Usuários ativos sem e-mail são pulados e listados no fim
// (o nível por módulo é indexado por e-mail; trate-os manualmente se houver).
require("dotenv").config();
const { getMysqlConnection, fecharJdbc } = require("../lib/db");
const { garantirTabelaPermissoesModulos, backfillNivelGlobalComConn } = require("../lib/permissoes");

async function main() {
  await garantirTabelaPermissoesModulos();
  const conn = await getMysqlConnection();
  try {
    const { usuarios, inseridos, semEmail } = await backfillNivelGlobalComConn(conn);
    console.log(`Migração concluída: ${usuarios} usuário(s) ativo(s) analisado(s), ${inseridos} permissão(ões) por módulo inserida(s).`);
    if (semEmail.length) {
      console.warn(
        `[ATENÇÃO] ${semEmail.length} usuário(s) ativo(s) SEM e-mail foram pulados ` +
        `(o nível por módulo é por e-mail): ${semEmail.join(", ")}.`
      );
    }
  } finally {
    await fecharJdbc(conn);
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error("Falhou:", err && err.message ? err.message : err);
  process.exit(1);
});
