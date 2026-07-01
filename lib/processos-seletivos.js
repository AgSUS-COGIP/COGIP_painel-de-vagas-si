// Domínio: Processos Seletivos (editais) — persistência no banco.
// Tabelas: EDITAL, CRONOGRAMA_EDITAL, VAGA_EDITAL, APROVADO_VAGA_EDITAL.
//
// Ajustes de schema assumidos (ALTERs feitos pelo usuário):
//   • CRONOGRAMA_EDITAL.DATA_ATIVIDADE -> VARCHAR (guarda a data como veio do PDF).
//   • EDITAL + LINK_EDITAL VARCHAR, + VAGAS_IMEDIATAS INT, + CADASTRO_RESERVA INT.
// Blobs (ANEXO_EDITAL, ANEXO_DESISTENCIA) ficam para depois — não são gravados aqui.
//
// Todas as funções recebem uma conexão (getMysqlConnection) e devolvem/gravam
// dados já no formato usado pelo front (labels de status, etc.).
const { DASH_CONFIG } = require("./config");

const SCHEMA = DASH_CONFIG.DB_SCHEMA;
const T_EDITAL = `\`${SCHEMA}\`.\`EDITAL\``;
const T_CRONO = `\`${SCHEMA}\`.\`CRONOGRAMA_EDITAL\``;
const T_VAGA = `\`${SCHEMA}\`.\`VAGA_EDITAL\``;
const T_APROVADO = `\`${SCHEMA}\`.\`APROVADO_VAGA_EDITAL\``;

// ---------- Mapeamentos app <-> enums do banco ----------
const STATUS_APP_TO_DB = {
  "Andamento": "EM_ANDAMENTO",
  "Aguardando Convocação": "AGUARDANDO_CONVOCACAO",
  "Concluído": "CONCLUIDO",
  "Vencido": "VENCIDO",
  "Cancelado": "CANCELADO"
};
const STATUS_DB_TO_APP = Object.fromEntries(Object.entries(STATUS_APP_TO_DB).map(([k, v]) => [v, k]));
const statusParaDb = s => STATUS_APP_TO_DB[s] || "EM_ANDAMENTO";
const statusParaApp = s => STATUS_DB_TO_APP[s] || "Andamento";

// Tipo do aprovado: o front passou a usar os mesmos valores do enum do banco.
const TIPOS_APROVADO = new Set(["AMPLA_CONCORRENCIA", "PCD", "PRETO_PARDO", "INDIGENA", "QUILOMBOLA"]);
const tipoAprovado = t => TIPOS_APROVADO.has(t) ? t : "AMPLA_CONCORRENCIA";
const STATUS_APROVADO = new Set(["AGUARDANDO", "CONVOCADO", "CONTRATADO", "DESISTIU"]);
// O front usa rótulos ("Aguardando"...); mapeamos para o enum e de volta.
const STATUS_APR_APP_TO_DB = { "Aguardando": "AGUARDANDO", "Convocado": "CONVOCADO", "Contratado": "CONTRATADO", "Desistiu": "DESISTIU" };
const STATUS_APR_DB_TO_APP = Object.fromEntries(Object.entries(STATUS_APR_APP_TO_DB).map(([k, v]) => [v, k]));
const statusAprParaDb = s => STATUS_APR_APP_TO_DB[s] || "AGUARDANDO";
const statusAprParaApp = s => STATUS_APR_DB_TO_APP[s] || "Aguardando";

// ---------- Helpers ----------
function toInt(v) { const n = parseInt(String(v ?? "").replace(/\D+/g, ""), 10); return Number.isFinite(n) && n > 0 ? n : 0; }
function toNota(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
// DATE do MySQL vem como Date (sem dateStrings): normaliza para "YYYY-MM-DD".
function fmtData(v) {
  if (!v) return "";
  if (v instanceof Date) {
    const p = n => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v).slice(0, 10);
}
// "YYYY-MM-DD" para o INSERT (ou null se vazio/ inválido).
function dataParaDb(v) {
  const s = String(v || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// ---------- Leitura ----------
// Retorna todos os editais com cronograma, vagas (cargos) e aprovados aninhados,
// já no formato consumido pelo front.
async function listarEditaisComConn(conn) {
  const [editais] = await conn.query(
    `SELECT ID, DSEI_CASAI, UF, NUMERO_EDITAL, DATA_INICIO, DATA_FIM, STATUS, OBSERVACAO,
            LINK_EDITAL, VAGAS_PREVISTAS, CADASTRO_RESERVA
       FROM ${T_EDITAL} ORDER BY CRIADO_EM DESC, ID DESC`
  );
  if (!editais.length) return [];
  const ids = editais.map(e => e.ID);
  const [cronos] = await conn.query(`SELECT ID, ID_EDITAL, ATIVIDADE, DATA_ATIVIDADE FROM ${T_CRONO} WHERE ID_EDITAL IN (?) ORDER BY ID_EDITAL, ID`, [ids]);
  const [vagas] = await conn.query(`SELECT ID, ID_EDITAL, CARGO, AC, PCD, PRETO_PARDO, INDIGENA, QUILOMBOLA FROM ${T_VAGA} WHERE ID_EDITAL IN (?) ORDER BY ID_EDITAL, ID`, [ids]);
  const vagaIds = vagas.map(v => v.ID);
  let aprovados = [];
  if (vagaIds.length) {
    [aprovados] = await conn.query(`SELECT ID, ID_VAGA, NOME, NOTA, TIPO, STATUS FROM ${T_APROVADO} WHERE ID_VAGA IN (?) ORDER BY ID_VAGA, ID`, [vagaIds]);
  }

  const cronoPorEdital = agrupar(cronos, "ID_EDITAL");
  const vagasPorEdital = agrupar(vagas, "ID_EDITAL");
  const aprovadosPorVaga = agrupar(aprovados, "ID_VAGA");

  return editais.map(e => {
    const cargos = (vagasPorEdital.get(e.ID) || []).map(v => ({
      vagaId: Number(v.ID),
      cargo: v.CARGO,
      ampla: v.AC, pcd: v.PCD, pretosPardos: v.PRETO_PARDO, indigenas: v.INDIGENA, quilombolas: v.QUILOMBOLA
    }));
    const aprovados = [];
    (vagasPorEdital.get(e.ID) || []).forEach(v => {
      (aprovadosPorVaga.get(v.ID) || []).forEach(a => aprovados.push({
        id: String(a.ID),
        cargo: v.CARGO,
        nome: a.NOME,
        nota: a.NOTA === null ? null : Number(a.NOTA),
        tipo: a.TIPO,
        status: statusAprParaApp(a.STATUS)
      }));
    });
    // Vagas imediatas = total do quadro de vagas (soma das cotas de cada cargo).
    const imediatas = cargos.reduce((s, c) =>
      s + Number(c.ampla || 0) + Number(c.pcd || 0) + Number(c.pretosPardos || 0) + Number(c.indigenas || 0) + Number(c.quilombolas || 0), 0);
    return {
      id: String(e.ID),
      unidade: e.DSEI_CASAI,
      uf: e.UF,
      edital: e.NUMERO_EDITAL,
      dataInicio: fmtData(e.DATA_INICIO),
      dataEncerramento: fmtData(e.DATA_FIM),
      status: statusParaApp(e.STATUS),
      observacoes: e.OBSERVACAO || "",
      linkEdital: e.LINK_EDITAL || "",
      vagasImediatas: imediatas,                  // derivado do quadro de vagas
      temCadastroReserva: !!Number(e.CADASTRO_RESERVA || 0), // "+ CR" (booleano)
      vagasPrevistas: Number(e.VAGAS_PREVISTAS || 0),        // número escolhido pelo usuário
      etapa: "",
      cargos,
      cronograma: (cronoPorEdital.get(e.ID) || []).map((c, i) => ({ ordem: i + 1, atividade: c.ATIVIDADE, data: c.DATA_ATIVIDADE || "" })),
      aprovados
    };
  });
}
function agrupar(rows, chave) {
  const m = new Map();
  (rows || []).forEach(r => { if (!m.has(r[chave])) m.set(r[chave], []); m.get(r[chave]).push(r); });
  return m;
}

// ---------- Cronograma / Vagas (auxiliares) ----------
async function inserirCronogramaComConn(conn, editalId, cronograma) {
  for (const c of (cronograma || [])) {
    const atividade = String(c.atividade || "").trim();
    if (!atividade) continue;
    await conn.query(`INSERT INTO ${T_CRONO} (ID_EDITAL, ATIVIDADE, DATA_ATIVIDADE) VALUES (?, ?, ?)`,
      [editalId, atividade.slice(0, 255), String(c.data || "").trim().slice(0, 120) || null]);
  }
}
// Upsert de vagas por CARGO (preserva a linha da vaga — e os aprovados dela — quando
// o cargo já existe; atualiza as cotas). Cargos ausentes na nova extração são mantidos.
async function upsertVagasComConn(conn, editalId, cargos) {
  const [existentes] = await conn.query(`SELECT ID, CARGO FROM ${T_VAGA} WHERE ID_EDITAL = ?`, [editalId]);
  const porCargo = new Map(existentes.map(v => [String(v.CARGO || "").trim().toLowerCase(), v.ID]));
  for (const c of (cargos || [])) {
    const cargo = String(c.cargo || "").trim();
    if (!cargo) continue;
    const vals = [toInt(c.ampla), toInt(c.pcd), toInt(c.pretosPardos), toInt(c.indigenas), toInt(c.quilombolas)];
    const existenteId = porCargo.get(cargo.toLowerCase());
    if (existenteId) {
      await conn.query(`UPDATE ${T_VAGA} SET AC=?, PCD=?, PRETO_PARDO=?, INDIGENA=?, QUILOMBOLA=? WHERE ID=?`, [...vals, existenteId]);
    } else {
      await conn.query(`INSERT INTO ${T_VAGA} (ID_EDITAL, CARGO, AC, PCD, PRETO_PARDO, INDIGENA, QUILOMBOLA) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [editalId, cargo.slice(0, 150), ...vals]);
    }
  }
}

// Substitui o cronograma e faz upsert das vagas (usado ao (re)inserir o anexo).
async function substituirAnexoComConn(conn, editalId, dados) {
  await conn.query(`DELETE FROM ${T_CRONO} WHERE ID_EDITAL = ?`, [editalId]);
  await inserirCronogramaComConn(conn, editalId, dados && dados.cronograma);
  await upsertVagasComConn(conn, editalId, dados && dados.cargos);
}

// ---------- Edital: CRUD ----------
async function criarEditalComConn(conn, d) {
  const [r] = await conn.query(
    `INSERT INTO ${T_EDITAL} (DSEI_CASAI, UF, NUMERO_EDITAL, DATA_INICIO, DATA_FIM, STATUS, OBSERVACAO, LINK_EDITAL, VAGAS_PREVISTAS, CADASTRO_RESERVA)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      String(d.unidade || "").slice(0, 150),
      String(d.uf || "").slice(0, 2).toUpperCase(),
      String(d.edital || "").slice(0, 20),
      dataParaDb(d.dataInicio),
      dataParaDb(d.dataEncerramento),
      statusParaDb(d.status),
      d.observacoes ? String(d.observacoes) : null,
      d.linkEdital ? String(d.linkEdital).slice(0, 1000) : null,
      toInt(d.vagasPrevistas),          // número escolhido pelo usuário
      d.temCadastroReserva ? 1 : 0      // flag "+ CR"
    ]
  );
  const id = r.insertId;
  if (d.anexo) await substituirAnexoComConn(conn, id, d.anexo);
  return id;
}

async function atualizarEditalComConn(conn, id, d) {
  await conn.query(
    `UPDATE ${T_EDITAL} SET DSEI_CASAI=?, UF=?, NUMERO_EDITAL=?, DATA_INICIO=?, DATA_FIM=?, STATUS=?, OBSERVACAO=?, LINK_EDITAL=?, VAGAS_PREVISTAS=?, CADASTRO_RESERVA=? WHERE ID=?`,
    [
      String(d.unidade || "").slice(0, 150),
      String(d.uf || "").slice(0, 2).toUpperCase(),
      String(d.edital || "").slice(0, 20),
      dataParaDb(d.dataInicio),
      dataParaDb(d.dataEncerramento),
      statusParaDb(d.status),
      d.observacoes ? String(d.observacoes) : null,
      d.linkEdital ? String(d.linkEdital).slice(0, 1000) : null,
      toInt(d.vagasPrevistas),
      d.temCadastroReserva ? 1 : 0,
      id
    ]
  );
  if (d.anexo) await substituirAnexoComConn(conn, id, d.anexo);
}

async function excluirEditalComConn(conn, id) {
  // ON DELETE CASCADE remove cronograma, vagas e aprovados.
  await conn.query(`DELETE FROM ${T_EDITAL} WHERE ID = ?`, [id]);
}

// ---------- Aprovado: CRUD ----------
async function criarAprovadoComConn(conn, vagaId, d) {
  const [r] = await conn.query(
    `INSERT INTO ${T_APROVADO} (ID_VAGA, NOME, NOTA, TIPO, STATUS) VALUES (?, ?, ?, ?, ?)`,
    [vagaId, String(d.nome || "").slice(0, 200), toNota(d.nota), tipoAprovado(d.tipo), statusAprParaDb(d.status)]
  );
  return r.insertId;
}
async function atualizarAprovadoComConn(conn, id, d) {
  await conn.query(
    `UPDATE ${T_APROVADO} SET NOME=?, NOTA=?, TIPO=?, STATUS=? WHERE ID=?`,
    [String(d.nome || "").slice(0, 200), toNota(d.nota), tipoAprovado(d.tipo), statusAprParaDb(d.status), id]
  );
}
async function excluirAprovadoComConn(conn, id) {
  await conn.query(`DELETE FROM ${T_APROVADO} WHERE ID = ?`, [id]);
}

module.exports = {
  listarEditaisComConn,
  criarEditalComConn,
  atualizarEditalComConn,
  excluirEditalComConn,
  substituirAnexoComConn,
  criarAprovadoComConn,
  atualizarAprovadoComConn,
  excluirAprovadoComConn
};
