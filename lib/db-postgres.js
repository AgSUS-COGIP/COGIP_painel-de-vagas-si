// Infraestrutura do segundo banco: pool PostgreSQL, obtenção/validação de
// conexão e helper de consulta. Espelha o lib/db.js (MySQL), mas usando o driver
// `pg`. Depende apenas de config e utils.
const { Pool } = require("pg");
const { getPostgresConfig } = require("./config");
const { aguardar } = require("./utils");

let pgPool = null;
const ERROS_CONEXAO_TRANSITORIOS = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  // Códigos SQLSTATE de conexão do Postgres (classe 08).
  "08000",
  "08003",
  "08006"
]);

function getPostgresPool() {
  if (!pgPool) {
    const config = getPostgresConfig();
    pgPool = new Pool({
      ...config,
      max: Number(process.env.PG_POOL_LIMIT || 5),
      idleTimeoutMillis: 60000,
      connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT || 20000)
    });
    // O pool do pg emite 'error' em clientes ociosos que o servidor derrubou.
    // Sem um listener, o processo cairia; aqui só registramos — a conexão morta
    // é descartada e a próxima obtenção pega uma nova.
    pgPool.on("error", (err) => {
      console.error("[postgres] erro em conexão ociosa do pool:", err && err.message ? err.message : err);
    });
  }
  return pgPool;
}

async function getPostgresConnection() {
  const pool = getPostgresPool();
  const tentativas = Number(process.env.PG_CONNECT_RETRIES || 2);
  let ultimoErro = null;

  for (let i = 0; i <= tentativas; i += 1) {
    try {
      const client = await pool.connect();
      try {
        // Valida ANTES de usar: numa conexão já fechada pelo servidor o SELECT 1
        // falha aqui, evitando que a query real estoure mais adiante.
        await client.query("SELECT 1");
        return client;
      } catch (pingErr) {
        ultimoErro = pingErr;
        // Devolve a conexão morta ao pool marcando-a para descarte.
        try { client.release(true); } catch (e) {}
        throw pingErr;
      }
    } catch (err) {
      ultimoErro = err;
      const code = err && err.code ? err.code : "";
      if (!ERROS_CONEXAO_TRANSITORIOS.has(code) || i === tentativas) {
        throw err;
      }
      await aguardar(400 * (i + 1));
    }
  }

  throw ultimoErro;
}

async function fecharPostgres(resource) {
  if (!resource) return;
  // Clientes obtidos do pool devem ser devolvidos (release), não encerrados.
  if (typeof resource.release === "function") {
    try { resource.release(); } catch (e) {}
    return;
  }
  if (typeof resource.end === "function") {
    await resource.end();
  }
}

async function executarConsultaPostgres(client, sql, params, mapper) {
  try {
    const { rows } = await client.query(sql, params || []);
    return typeof mapper === "function" ? rows.map(mapper) : rows;
  } catch (err) {
    throw new Error(`Erro ao consultar PostgreSQL: ${err && err.message ? err.message : err}`);
  }
}

module.exports = { getPostgresPool, getPostgresConnection, fecharPostgres, executarConsultaPostgres };
