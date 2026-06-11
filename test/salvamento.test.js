const test = require("node:test");
const assert = require("node:assert/strict");
const srv = require("../server.js");

const {
  _salvarObservacaoAlertaComConn: salvarObservacao,
  _salvarRemanejamentoComConn: salvarRemanejamento,
  _normalizarLinhasRemanejamentoServidor: normalizarLinhas,
  _calcularResumoLinhasServidor: calcularResumo,
  _mapearCargoParaPrevistas: mapearCargo,
  _mesesAteFimDoAno: mesesAteFimDoAno,
  _limparValorDash: limpar,
  _converterNumeroDash: numero
} = srv;

function fakeConn({ custos = [], ociosas = [], insertId = 1 } = {}) {
  const calls = { execute: [], query: [], tx: [] };
  return {
    calls,
    async query(sql, params) {
      calls.query.push({ sql, params });
      if (/SALARIO_BASE/.test(sql)) return [custos];      
      if (/vagas_ociosas/.test(sql)) return [ociosas];    
      return [[]];
    },
    async execute(sql, params) {
      calls.execute.push({ sql, params });
      if (/PROCESSO_REMANEJAMENTO/.test(sql)) return [{ insertId }];
      return [{ insertId: 0 }];
    },
    async beginTransaction() { calls.tx.push("begin"); },
    async commit() { calls.tx.push("commit"); },
    async rollback() { calls.tx.push("rollback"); }
  };
}

// ---------------------------------------------------------------------------
// 1) Observação de alerta
// ---------------------------------------------------------------------------
test("observação de alerta: grava todos os campos sanitizados", async () => {
  const conn = fakeConn();
  await salvarObservacao(conn, {
    chave: "  ALERTA-1 ",
    dsei: "CASAI DF",
    cargo: "Enfermeiro",
    tipoValor: "AFASTAMENTO_SEM_SUBSTITUTO",
    detalhe: "afastado desde 2026",
    observacao: "  substituto a caminho  ",
    usuario: "fulano@x"
  });

  assert.equal(conn.calls.execute.length, 1, "deve fazer exatamente 1 INSERT");
  const { sql, params } = conn.calls.execute[0];
  assert.match(sql, /INSERT INTO/);
  assert.match(sql, /ON DUPLICATE KEY UPDATE/, "deve ser upsert (não duplica chave)");
  assert.deepEqual(params, [
    "ALERTA-1", "CASAI DF", "Enfermeiro", "AFASTAMENTO_SEM_SUBSTITUTO",
    "afastado desde 2026", "substituto a caminho", "fulano@x"
  ]);
});

test("observação de alerta: campos opcionais vazios viram NULL e usuário padrão = 'painel'", async () => {
  const conn = fakeConn();
  await salvarObservacao(conn, { chave: "K1", observacao: "" });
  assert.deepEqual(conn.calls.execute[0].params, ["K1", null, null, null, null, null, "painel"]);
});

test("observação de alerta: sem chave é rejeitada e não grava nada", async () => {
  const conn = fakeConn();
  await assert.rejects(() => salvarObservacao(conn, { observacao: "x" }), /identificar o alerta/);
  assert.equal(conn.calls.execute.length, 0);
});

// ---------------------------------------------------------------------------
// 2) Remanejamento (processo + movimentações)
// ---------------------------------------------------------------------------
const CUSTO = (id, salario) => ({
  ID_VAGA: id, SALARIO_BASE: salario, INSALUBRIDADE_PERICULOSIDADE: 0,
  GRATIFICACAO_RT: 0, NOTURNO: 0, ENCARGOS: 0, PROVISOES: 0
});

test("remanejamento: grava o processo e uma movimentação por cargo (DECRESCIMO/ACRESCIMO)", async () => {
  const conn = fakeConn({
    custos: [CUSTO(10, 1000), CUSTO(20, 400)],
    ociosas: [{ id_cargo_funcao: 10, cargo: "Cargo A", vagas_ociosas: 5 }],
    insertId: 77
  });

  const res = await salvarRemanejamento(conn, {
    idDseiCasai: "3",
    processoSei: "  SEI-12345  ",
    observacao: "remanejamento teste",
    usuario: "tester",
    linhasReduzido: JSON.stringify([{ idCargoFuncao: 10, quantidade: 2 }]),
    linhasAcrescentado: JSON.stringify([{ idCargoFuncao: 20, quantidade: 2 }])
  }, null);

  // Processo gravado com os dados corretos (anexo nulo quando não há arquivo).
  const proc = conn.calls.execute.find(c => /PROCESSO_REMANEJAMENTO/.test(c.sql));
  assert.deepEqual(proc.params, ["SEI-12345", "remanejamento teste", "tester", null, null, null, null]);

  // Uma movimentação por cargo, com tipo e quantidade corretos.
  const movs = conn.calls.execute.filter(c => /MOVIMENTACAO_REMANEJAMENTO/.test(c.sql));
  assert.equal(movs.length, 2);
  assert.deepEqual(movs[0].params, [77, 3, 10, "DECRESCIMO", 2]);
  assert.deepEqual(movs[1].params, [77, 3, 20, "ACRESCIMO", 2]);

  // Transação confirmada e retorno com o id do processo.
  assert.deepEqual(conn.calls.tx, ["begin", "commit"]);
  assert.equal(res.idProcesso, 77);
});

test("remanejamento: grava metadados do anexo quando há arquivo", async () => {
  const conn = fakeConn({
    custos: [CUSTO(10, 1000), CUSTO(20, 400)],
    ociosas: [{ id_cargo_funcao: 10, vagas_ociosas: 5 }],
    insertId: 5
  });
  const file = { buffer: Buffer.from("pdf"), originalname: "oficio.pdf", mimetype: "application/pdf", size: 3 };

  await salvarRemanejamento(conn, {
    idDseiCasai: "1",
    processoSei: "SEI-1",
    linhasReduzido: JSON.stringify([{ idCargoFuncao: 10, quantidade: 1 }]),
    linhasAcrescentado: JSON.stringify([{ idCargoFuncao: 20, quantidade: 1 }])
  }, file);

  const proc = conn.calls.execute.find(c => /PROCESSO_REMANEJAMENTO/.test(c.sql));
  assert.equal(proc.params[3], file.buffer);
  assert.equal(proc.params[4], "oficio.pdf");
  assert.equal(proc.params[5], "application/pdf");
  assert.equal(proc.params[6], 3);
});

test("remanejamento: impacto financeiro positivo é bloqueado e nada é gravado", async () => {
  const conn = fakeConn({
    custos: [CUSTO(10, 100), CUSTO(20, 1000)], // reduz barato, acrescenta caro -> impacto +
    ociosas: [{ id_cargo_funcao: 10, vagas_ociosas: 5 }]
  });
  await assert.rejects(() => salvarRemanejamento(conn, {
    idDseiCasai: "1",
    processoSei: "SEI-1",
    linhasReduzido: JSON.stringify([{ idCargoFuncao: 10, quantidade: 1 }]),
    linhasAcrescentado: JSON.stringify([{ idCargoFuncao: 20, quantidade: 1 }])
  }, null), /impacto financeiro/);
  assert.equal(conn.calls.execute.length, 0, "não pode gravar nada quando bloqueado");
});

test("remanejamento: sem vaga ociosa suficiente é rejeitado", async () => {
  const conn = fakeConn({
    custos: [CUSTO(10, 1000), CUSTO(20, 400)],
    ociosas: [{ id_cargo_funcao: 10, vagas_ociosas: 1 }] // pede 3, só tem 1
  });
  await assert.rejects(() => salvarRemanejamento(conn, {
    idDseiCasai: "1",
    processoSei: "SEI-1",
    linhasReduzido: JSON.stringify([{ idCargoFuncao: 10, quantidade: 3 }]),
    linhasAcrescentado: JSON.stringify([{ idCargoFuncao: 20, quantidade: 1 }])
  }, null));
  assert.equal(conn.calls.execute.length, 0);
});

test("remanejamento: campos obrigatórios ausentes são rejeitados", async () => {
  const base = {
    idDseiCasai: "1", processoSei: "SEI-1",
    linhasReduzido: JSON.stringify([{ idCargoFuncao: 10, quantidade: 1 }]),
    linhasAcrescentado: JSON.stringify([{ idCargoFuncao: 20, quantidade: 1 }])
  };
  await assert.rejects(() => salvarRemanejamento(fakeConn(), { ...base, idDseiCasai: "" }), /DSEI/);
  await assert.rejects(() => salvarRemanejamento(fakeConn(), { ...base, processoSei: "" }), /Processo SEI/);
  await assert.rejects(() => salvarRemanejamento(fakeConn(), { ...base, linhasReduzido: "[]" }), /reduzido/);
  await assert.rejects(() => salvarRemanejamento(fakeConn(), { ...base, linhasAcrescentado: "[]" }), /acrescentado/);
});

// ---------------------------------------------------------------------------
// 3) Helpers que preparam os dados gravados (garantem o valor correto)
// ---------------------------------------------------------------------------
test("normalizarLinhas: converte números e descarta linhas sem id ou com qtd 0", () => {
  const out = normalizarLinhas([
    { idCargoFuncao: "10", quantidade: "2" },
    { idCargoFuncao: "20", quantidade: "0" }, // descartada (qtd 0)
    { idCargoFuncao: "", quantidade: "5" },   // descartada (sem id)
    { idCargoFuncao: "30", quantidade: "3", meses: "0" }
  ]);
  assert.deepEqual(out, [
    { idCargoFuncao: 10, quantidade: 2, meses: 1 },
    { idCargoFuncao: 30, quantidade: 3, meses: 1 }
  ]);
});

test("calcularResumo: soma mensal e do período corretamente", () => {
  const custos = { "10": 1000, "20": 400 };
  const r = calcularResumo([{ idCargoFuncao: 10, quantidade: 2 }, { idCargoFuncao: 20, quantidade: 1 }], custos, 6);
  assert.equal(r.mensal, 2400);       // 1000*2 + 400*1
  assert.equal(r.periodo, 2400 * 6);
});

test("mapearCargoParaPrevistas: consolida grupos de cargos", () => {
  assert.equal(mapearCargo(28), 104);
  assert.equal(mapearCargo(77), 81);
  assert.equal(mapearCargo(102), 45);
  assert.equal(mapearCargo(50), 50); // fora de grupo: mantém
});

test("mesesAteFimDoAno: sempre entre 1 e 12", () => {
  const m = mesesAteFimDoAno();
  assert.ok(m >= 1 && m <= 12, `valor inesperado: ${m}`);
});

test("limparValorDash: trim, colapsa espaços e trata nulos", () => {
  assert.equal(limpar("  a   b \n c "), "a b c");
  assert.equal(limpar(null), "");
  assert.equal(limpar(undefined), "");
});

test("converterNumeroDash: lê formatos pt-BR e descarta lixo", () => {
  assert.equal(numero("1.234,56"), 1234.56); // com vírgula, o ponto é milhar
  assert.equal(numero("2,5"), 2.5);
  assert.equal(numero("1000"), 1000);
  assert.equal(numero(""), 0);
  assert.equal(numero("abc"), 0);
  assert.equal(numero(42), 42);
  assert.equal(numero("1.000"), 1); // "1.000" (só ponto) é lido como decimal → 1, não 1000.
});
