// Feedback do assistente virtual (robô flutuante do painel).
// De início o assistente apenas RECEBE feedback: cada mensagem enviada é
// registrada aqui, com a aba de origem e a identificação de quem enviou.
// Depende apenas de config e db (mesmo padrão de lib/dashboard.js).
const { DASH_CONFIG } = require("./config");
const { getMysqlConnection, fecharJdbc } = require("./db");

const MAX_MENSAGEM = 2000;

async function garantirTabelaFeedbackAssistente() {
  const conn = await getMysqlConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.FEEDBACK_ASSISTENTE_TABLE}\` (
        \`ID_FEEDBACK\`    BIGINT NOT NULL AUTO_INCREMENT,
        \`MENSAGEM\`       TEXT         NOT NULL,
        \`ORIGEM\`         VARCHAR(64)  NULL,
        \`USUARIO_EMAIL\`  VARCHAR(255) NULL,
        \`USUARIO_NOME\`   VARCHAR(255) NULL,
        \`CRIADO_EM\`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`ID_FEEDBACK\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } finally {
    await fecharJdbc(conn);
  }
}

// Grava um feedback. O autor é sempre derivado do token (nunca do corpo), no
// mesmo padrão de salvarObservacaoAlertaComConn.
async function salvarFeedbackComConn(conn, body, usuario) {
  const mensagem = String((body && body.mensagem) || "").trim();
  if (!mensagem) {
    const erro = new Error("Escreva uma mensagem antes de enviar.");
    erro.status = 400;
    erro.expose = true;
    throw erro;
  }

  const origem = String((body && body.origem) || "").trim().slice(0, 64) || null;

  await conn.execute(
    `INSERT INTO \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.FEEDBACK_ASSISTENTE_TABLE}\`
       (\`MENSAGEM\`, \`ORIGEM\`, \`USUARIO_EMAIL\`, \`USUARIO_NOME\`)
     VALUES (?, ?, ?, ?)`,
    [
      mensagem.slice(0, MAX_MENSAGEM),
      origem,
      (usuario && usuario.email) || null,
      (usuario && usuario.nome) || null
    ]
  );

  return { ok: true };
}

module.exports = { garantirTabelaFeedbackAssistente, salvarFeedbackComConn };
