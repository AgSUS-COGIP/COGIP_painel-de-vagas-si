// Lista de DSEIs/CASAIs (com UF) a partir da base consolidada de trabalhadores.
// Alimenta o combobox "DSEI/CASAI" do cadastro de editais (Processos Seletivos).
//
// A consulta traz o local de trabalho já "limpo" (sem os termos "TERRITORIO" e
// "ESCRITORIO") e a UF correspondente. Resultado cacheado (30 min) — a fonte
// muda pouco e é lida em toda abertura do modal de edital.
const { DASH_CONFIG } = require("./config");
const { limparValorDash } = require("./utils");

const SCHEMA = DASH_CONFIG.DB_SCHEMA;
function tabelaTrabalhador() {
  return `\`${SCHEMA}\`.\`${DASH_CONFIG.TRABALHADOR_CONSOLIDADO_TABLE}\``;
}

let _cache = { expira: 0, data: null };

// Retorna [{ uf, nome }] ordenado por nome. Falha de consulta => lista vazia
// (o formulário continua utilizável, sem travar o cadastro).
async function listarDseisCasaiComConn(conn) {
  if (_cache.data && Date.now() < _cache.expira) return _cache.data;
  let rows = [];
  try {
    [rows] = await conn.query(
      `SELECT DISTINCT LOCAL_TRABALHO_UF AS uf,
              TRIM(REPLACE(REPLACE(LOCAL_TRABALHO_DESC, 'TERRITORIO', ''), 'ESCRITORIO', '')) AS nome
         FROM ${tabelaTrabalhador()}
        WHERE LOCAL_TRABALHO_DESC LIKE '%DSEI%' OR LOCAL_TRABALHO_DESC LIKE '%CASAI%'`
    );
  } catch (e) {
    console.error("[dsei-casai] falha na consulta:", e && e.message ? e.message : e);
    rows = [];
  }
  const vistos = new Set();
  const data = (rows || [])
    .map(r => ({
      uf: limparValorDash(r.uf).toUpperCase(),
      nome: limparValorDash(r.nome) // colapsa o espaço duplo deixado pelos REPLACE
    }))
    .filter(d => d.nome)
    .filter(d => { const k = d.nome.toLowerCase(); if (vistos.has(k)) return false; vistos.add(k); return true; })
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  // Só cacheia quando veio algo — assim uma falha transitória não fica presa 30 min.
  if (data.length) _cache = { expira: Date.now() + 30 * 60 * 1000, data };
  return data;
}

module.exports = { listarDseisCasaiComConn };
