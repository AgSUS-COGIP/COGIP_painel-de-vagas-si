// Infraestrutura de banco: pool MySQL, obtenção/validação de conexão, cache e
// helper de consulta. Depende apenas de config e utils.
const mysql = require("mysql2/promise");
const { DASH_CONFIG, getMysqlConfig } = require("./config");
const { aguardar } = require("./utils");

let mysqlPool = null;
const cacheStore = new Map();
const pendingCacheLoads = new Map();
const ERROS_CONEXAO_TRANSITORIOS = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "PROTOCOL_CONNECTION_LOST",
  "EPIPE"
]);

function getMysqlPool() {
  if (!mysqlPool) {
    const config = getMysqlConfig();
    mysqlPool = mysql.createPool({
      ...config,
      waitForConnections: true,
      connectionLimit: Number(process.env.MYSQL_POOL_LIMIT || 5),
      maxIdle: Number(process.env.MYSQL_POOL_LIMIT || 5),
      idleTimeout: 60000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
      connectTimeout: Number(process.env.MYSQL_CONNECT_TIMEOUT || 20000)
    });
  }
  return mysqlPool;
}

async function getMysqlConnection() {
  const pool = getMysqlPool();
  const tentativas = Number(process.env.MYSQL_CONNECT_RETRIES || 2);
  // O banco/firewall pode fechar conexões ociosas que continuam no pool. Drenamos
  // (destruímos) as conexões mortas até pegar uma viva — daí o teto pelo tamanho do pool.
  const maxDrenagem = Number(process.env.MYSQL_POOL_LIMIT || 5) + 2;
  let ultimoErro = null;

  for (let i = 0; i <= tentativas; i += 1) {
    try {
      for (let v = 0; v < maxDrenagem; v += 1) {
        const conn = await pool.getConnection();
        try {
          // Valida ANTES de usar: o ping falha (ECONNRESET) numa conexão já fechada
          // pelo servidor, evitando que a query estoure mais adiante.
          await conn.ping();
          return conn;
        } catch (pingErr) {
          ultimoErro = pingErr;
          try { conn.destroy(); } catch (e) {} // remove a conexão morta do pool
        }
      }
      throw ultimoErro || new Error("Conexão MySQL indisponível.");
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

async function fecharJdbc(resource) {
  if (!resource) return;
  // Conexões obtidas do pool devem ser devolvidas (release), não encerradas (end).
  if (typeof resource.release === "function") {
    try { resource.release(); } catch (e) {}
    return;
  }
  if (typeof resource.end === "function") {
    await resource.end();
  }
}

async function obterOuCarregarJsonCache(baseKey, seconds, loaderFn) {
  const cached = cacheStore.get(baseKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.payload;
  }

  if (pendingCacheLoads.has(baseKey)) {
    return pendingCacheLoads.get(baseKey);
  }

  const promise = (async () => {
    const payload = await loaderFn();
    cacheStore.set(baseKey, {
      expiresAt: Date.now() + (seconds * 1000),
      payload
    });
    return payload;
  })().finally(() => {
    pendingCacheLoads.delete(baseKey);
  });

  pendingCacheLoads.set(baseKey, promise);
  return promise;
}

function limparCacheDashboard() {
  [
    DASH_CONFIG.CACHE_MONITORAMENTO_KEY,
    DASH_CONFIG.CACHE_MONITORAMENTO_TOTAIS_KEY,
    DASH_CONFIG.CACHE_REMANEJAMENTO_LISTA_KEY,
    DASH_CONFIG.CACHE_REMANEJAMENTO_CADASTRO_KEY,
    DASH_CONFIG.CACHE_CRACHAS_KEY
  ].forEach(key => cacheStore.delete(key));
}

async function executarConsultaComConn(conn, sql, mapper) {
  try {
    const [rows] = await conn.query(sql);
    return rows.map(mapper);
  } catch (err) {
    throw new Error(`Erro ao consultar MySQL: ${err && err.message ? err.message : err}`);
  }
}

module.exports = { getMysqlPool, getMysqlConnection, fecharJdbc, obterOuCarregarJsonCache, limparCacheDashboard, executarConsultaComConn };
