const test = require("node:test");
const assert = require("node:assert/strict");
const srv = require("../server.js");

const {
  _salvarObservacaoAlertaComConn: salvarObservacao,
  _salvarRemanejamentoComConn: salvarRemanejamento,
  _salvarAjusteRemanejamentoComConn: salvarAjuste,
  _normalizarLinhasRemanejamentoServidor: normalizarLinhas,
  _calcularResumoLinhasServidor: calcularResumo,
  _mapearCargoParaPrevistas: mapearCargo,
  _mesesAteFimDoAno: mesesAteFimDoAno,
  _limparValorDash: limpar,
  _converterNumeroDash: numero,
  _salvarSolicitacaoAcessoComConn: solicitarAcesso,
  _aprovarSolicitacaoComConn: aprovarAcesso,
  _recusarSolicitacaoComConn: recusarAcesso,
  _excluirUsuarioComConn: excluirUsuario
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
    mes: 1, // N_MESES = 13 - 1 = 12 (determinístico no teste)
    linhasReduzido: JSON.stringify([{ idCargoFuncao: 10, quantidade: 2 }]),
    linhasAcrescentado: JSON.stringify([{ idCargoFuncao: 20, quantidade: 2 }])
  }, null);

  // Processo gravado com os dados corretos (N_MESES no índice 3; anexo nulo quando não há arquivo).
  const proc = conn.calls.execute.find(c => /PROCESSO_REMANEJAMENTO/.test(c.sql));
  assert.deepEqual(proc.params, ["SEI-12345", "remanejamento teste", "tester", 12, null, null, null, null]);

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
    mes: 6, // N_MESES = 13 - 6 = 7 (índice 3); o anexo vem depois
    linhasReduzido: JSON.stringify([{ idCargoFuncao: 10, quantidade: 1 }]),
    linhasAcrescentado: JSON.stringify([{ idCargoFuncao: 20, quantidade: 1 }])
  }, file);

  // Ordem do INSERT: [processoSei, observacao, criadoPor, N_MESES, anexoBuffer, nome, mime, tamanho].
  const proc = conn.calls.execute.find(c => /PROCESSO_REMANEJAMENTO/.test(c.sql));
  assert.equal(proc.params[3], 7);
  assert.equal(proc.params[4], file.buffer);
  assert.equal(proc.params[5], "oficio.pdf");
  assert.equal(proc.params[6], "application/pdf");
  assert.equal(proc.params[7], 3);
});

test("remanejamento normal: N_MESES = 13 - mês e os DOIS lados usam esse período", async () => {
  const conn = fakeConn({
    custos: [CUSTO(10, 1000), CUSTO(20, 400)],
    ociosas: [{ id_cargo_funcao: 10, vagas_ociosas: 5 }],
    insertId: 9
  });

  const res = await salvarRemanejamento(conn, {
    idDseiCasai: "1",
    processoSei: "SEI-1",
    mes: 4, // 13 - 4 = 9 meses nos dois lados
    linhasReduzido: JSON.stringify([{ idCargoFuncao: 10, quantidade: 1 }]),
    linhasAcrescentado: JSON.stringify([{ idCargoFuncao: 20, quantidade: 1 }])
  }, null);

  const proc = conn.calls.execute.find(c => /PROCESSO_REMANEJAMENTO/.test(c.sql));
  assert.equal(proc.params[3], 9);
  assert.equal(res.impactoMensal, 400 - 1000);
  assert.equal(res.impactoPeriodo, (400 - 1000) * 9);
});

test("ajuste pontual: N_MESES = 12 - mês digitado (o acrescentado usa o próprio número)", async () => {
  // params do INSERT do processo: [processoSei, observacao, criadoPor, N_MESES, ...].
  const nMeses = async body => {
    const conn = fakeConn({ insertId: 1 });
    await salvarAjuste(conn, {
      idDseiCasai: "1", linhasReduzido: "[]",
      linhasAcrescentado: JSON.stringify([{ idCargoFuncao: 20, quantidade: 1 }]),
      ...body
    }, null);
    return conn.calls.execute.find(c => /TP_AJUSTE/.test(c.sql)).params[3];
  };

  // Digitou 4 -> reduzido = 8 meses (gravado em N_MESES); acrescentado = 12 - 8 = 4.
  assert.equal(await nMeses({ mes: 4 }), 8);
  assert.equal(await nMeses({ mes: 11 }), 1);
  assert.equal(
    await nMeses({ mes: 0 }),
    Math.max(1, 12 - (new Date().getMonth() + 1)),
    "fora de 1..12 cai no padrão (base 12 do mês atual)"
  );
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
// 2b) Ajuste pontual (processo com TP_AJUSTE = 'S')
// ---------------------------------------------------------------------------
test("ajuste pontual: cria PROCESSO com TP_AJUSTE='S' e movimentações vinculadas", async () => {
  const conn = fakeConn({ insertId: 88 });
  const res = await salvarAjuste(conn, {
    idDseiCasai: "3",
    processoSei: "SEI-9",
    criadoPor: "admin@x",
    mes: 1,
    linhasReduzido: JSON.stringify([{ idCargoFuncao: 10, quantidade: 2 }]),
    linhasAcrescentado: JSON.stringify([{ idCargoFuncao: 20, quantidade: 1 }])
  }, null);

  // Processo marcado como ajuste (TP_AJUSTE = 'S').
  const proc = conn.calls.execute.find(c => /TP_AJUSTE/.test(c.sql));
  assert.ok(proc, "deve inserir o processo");
  assert.match(proc.sql, /'S'/);
  // Movimentações vinculadas ao processo (id 88); params = [proc, dsei, vaga, tipo, qtd, criadoPor].
  const movs = conn.calls.execute.filter(c => /TIPO_MOVIMENTACAO/.test(c.sql));
  assert.equal(movs.length, 2);
  assert.deepEqual(movs[0].params, [88, 3, 10, "DECRESCIMO", 2, "admin@x"]);
  assert.deepEqual(movs[1].params, [88, 3, 20, "ACRESCIMO", 1, "admin@x"]);
  assert.deepEqual(conn.calls.tx, ["begin", "commit"]);
  assert.equal(res.idProcesso, 88);
});

test("ajuste pontual: aceita só acréscimo (sem redução) e só decréscimo (sem acréscimo)", async () => {
  const soAcr = fakeConn({ insertId: 5 });
  await salvarAjuste(soAcr, {
    idDseiCasai: "1", linhasReduzido: "[]",
    linhasAcrescentado: JSON.stringify([{ idCargoFuncao: 20, quantidade: 4 }])
  }, null);
  const mAcr = soAcr.calls.execute.filter(c => /TIPO_MOVIMENTACAO/.test(c.sql));
  assert.equal(mAcr.length, 1);
  assert.equal(mAcr[0].params[3], "ACRESCIMO");

  const soDec = fakeConn({ insertId: 6 });
  await salvarAjuste(soDec, {
    idDseiCasai: "1", linhasAcrescentado: "[]",
    linhasReduzido: JSON.stringify([{ idCargoFuncao: 10, quantidade: 5 }])
  }, null);
  const mDec = soDec.calls.execute.filter(c => /TIPO_MOVIMENTACAO/.test(c.sql));
  assert.equal(mDec.length, 1);
  assert.equal(mDec[0].params[3], "DECRESCIMO");
});

test("ajuste pontual: sem DSEI ou sem nenhuma linha é rejeitado (nada é gravado)", async () => {
  const semDsei = fakeConn();
  await assert.rejects(() => salvarAjuste(semDsei, {
    idDseiCasai: "", linhasReduzido: "[]",
    linhasAcrescentado: JSON.stringify([{ idCargoFuncao: 20, quantidade: 1 }])
  }, null), /DSEI/);
  assert.equal(semDsei.calls.execute.length, 0);

  const semLinhas = fakeConn();
  await assert.rejects(() => salvarAjuste(semLinhas, {
    idDseiCasai: "1", linhasReduzido: "[]", linhasAcrescentado: "[]"
  }, null), /ao menos um cargo/);
  assert.equal(semLinhas.calls.execute.length, 0);
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

// ---------------------------------------------------------------------------
// 4) Solicitação / aprovação de acesso
// ---------------------------------------------------------------------------
function acessoConn({ pendente = null, solicitacao = null, usuarioExiste = false, insertId = 10 } = {}) {
  const calls = { query: [], execute: [], tx: [] };
  return {
    calls,
    async query(sql, params) {
      calls.query.push({ sql, params });
      if (/`ID_SOLICITACAO` = \?/.test(sql)) return [solicitacao ? [solicitacao] : []];              // aprovar/recusar por id
      if (/SELECT `ID_SOLICITACAO`[\s\S]*`EMAIL` = \?/.test(sql)) return [pendente ? [pendente] : []]; // salvar (1 linha por e-mail)
      if (/`ID_USUARIO`[\s\S]*`EMAIL` = \?/.test(sql)) return [usuarioExiste ? [{ ID_USUARIO: 1 }] : []];
      return [[]];
    },
    async execute(sql, params) { calls.execute.push({ sql, params }); return [{ insertId }]; },
    async beginTransaction() { calls.tx.push("begin"); },
    async commit() { calls.tx.push("commit"); },
    async rollback() { calls.tx.push("rollback"); }
  };
}

test("solicitar acesso: justificativa é obrigatória", async () => {
  const conn = acessoConn();
  await assert.rejects(() => solicitarAcesso(conn, "a@x.org", { justificativa: "  " }), /justificativa/i);
  assert.equal(conn.calls.execute.length, 0);
});

test("solicitar acesso: sem pendente cria nova solicitação com e-mail normalizado", async () => {
  const conn = acessoConn({ pendente: null, insertId: 55 });
  const res = await solicitarAcesso(conn, "Fulano@AgSUS.org.BR", {
    nome: "Fulano", cargo: "Analista", coordenacao: "COGIP", dsei: "DF", casai: "Brasília",
    justificativa: "preciso acompanhar as vagas"
  });
  assert.equal(res.atualizado, false);
  const ins = conn.calls.execute[0];
  assert.match(ins.sql, /INSERT INTO/);
  assert.match(ins.sql, /'PENDENTE'/);
  assert.deepEqual(ins.params, ["fulano@agsus.org.br", "Fulano", "Analista", "COGIP", "DF", "Brasília", "preciso acompanhar as vagas"]);
});

test("solicitar acesso: com pendente existente atualiza (não cria nova)", async () => {
  const conn = acessoConn({ pendente: { ID_SOLICITACAO: 7 } });
  const res = await solicitarAcesso(conn, "a@x.org", { justificativa: "nova justificativa" });
  assert.equal(res.atualizado, true);
  assert.equal(res.id, 7);
  assert.match(conn.calls.execute[0].sql, /UPDATE/);
});

test("aprovar acesso: marca APROVADO e libera usuário existente", async () => {
  const conn = acessoConn({ solicitacao: { EMAIL: "a@x.org", NOME: "A", STATUS: "PENDENTE" }, usuarioExiste: true });
  const res = await aprovarAcesso(conn, 9, "admin@x.org", {});
  assert.equal(res.status, "APROVADO");
  // 1ª execução: UPDATE da solicitação para APROVADO
  assert.match(conn.calls.execute[0].sql, /STATUS` = 'APROVADO'/);
  assert.deepEqual(conn.calls.execute[0].params, ["admin@x.org", null, 9]);
  // 2ª execução: apenas ativa o usuário (UPDATE ATIVO=1). Sem nível global: o
  // acesso a cada aba é concedido depois na matriz de Perfis.
  assert.match(conn.calls.execute[1].sql, /UPDATE/);
  assert.match(conn.calls.execute[1].sql, /`ATIVO` = 1/);
  assert.doesNotMatch(conn.calls.execute[1].sql, /NIVEL_AUTORIZACAO/);
  assert.deepEqual(conn.calls.execute[1].params, ["a@x.org"]);
  assert.deepEqual(conn.calls.tx, ["begin", "commit"]);
});

test("aprovar acesso: cria usuário quando não existe (sem nível global)", async () => {
  const conn = acessoConn({ solicitacao: { EMAIL: "novo@x.org", NOME: "Novo", STATUS: "PENDENTE" }, usuarioExiste: false });
  await aprovarAcesso(conn, 3, "admin@x.org", {});
  const insUser = conn.calls.execute.find(c => /INSERT INTO[\s\S]*`ATIVO`/.test(c.sql));
  assert.ok(insUser, "deve inserir o usuário");
  // Nasce com NIVEL_AUTORIZACAO=0 (obsoleto) e ATIVO=1; sem acesso a nenhuma aba.
  assert.match(insUser.sql, /VALUES \(\?, '', \?, \?, 0, 1\)/);
  assert.deepEqual(insUser.params, ["novo", "Novo", "novo@x.org"]);
});

test("aprovar acesso: solicitação já decidida é rejeitada", async () => {
  const conn = acessoConn({ solicitacao: { EMAIL: "a@x.org", NOME: "A", STATUS: "APROVADO" } });
  await assert.rejects(() => aprovarAcesso(conn, 9, "admin@x.org", {}), /já foi decidida/);
});

test("recusar acesso: justificativa é obrigatória", async () => {
  const conn = acessoConn({ solicitacao: { STATUS: "PENDENTE" } });
  await assert.rejects(() => recusarAcesso(conn, 9, "admin@x.org", "   "), /justificativa/i);
  assert.equal(conn.calls.execute.length, 0);
});

test("recusar acesso: marca RECUSADO e revoga o acesso (ATIVO=0)", async () => {
  const conn = acessoConn({ solicitacao: { EMAIL: "a@x.org", STATUS: "PENDENTE" } });
  const res = await recusarAcesso(conn, 9, "admin@x.org", "fora do escopo");
  assert.equal(res.status, "RECUSADO");
  // 1ª execução: marca a solicitação como RECUSADO
  assert.match(conn.calls.execute[0].sql, /STATUS` = 'RECUSADO'/);
  assert.deepEqual(conn.calls.execute[0].params, ["admin@x.org", "fora do escopo", 9]);
  // 2ª execução: revoga o acesso do usuário (ATIVO=0)
  assert.match(conn.calls.execute[1].sql, /`ATIVO` = 0/);
  assert.deepEqual(conn.calls.execute[1].params, ["a@x.org"]);
  assert.deepEqual(conn.calls.tx, ["begin", "commit"]);
});

test("excluir usuário: remove das TRÊS tabelas em transação (e-mail normalizado)", async () => {
  const conn = acessoConn();
  await excluirUsuario(conn, "Alguem@X.org");
  assert.equal(conn.calls.execute.length, 3, "três DELETE (solicitações + usuários + permissões por módulo)");
  assert.match(conn.calls.execute[0].sql, /DELETE FROM/);
  assert.match(conn.calls.execute[1].sql, /DELETE FROM/);
  // 3º DELETE: limpa as permissões por módulo (evita órfãs que reaparecem).
  assert.match(conn.calls.execute[2].sql, /DELETE FROM/);
  assert.match(conn.calls.execute[2].sql, /PERMISSOES_MODULOS/);
  assert.deepEqual(conn.calls.execute[0].params, ["alguem@x.org"]);
  assert.deepEqual(conn.calls.execute[1].params, ["alguem@x.org"]);
  assert.deepEqual(conn.calls.execute[2].params, ["alguem@x.org"]);
  assert.deepEqual(conn.calls.tx, ["begin", "commit"]);
  // Reaproveita o AUTO_INCREMENT (próximo id = MAX+1) nas tabelas com id próprio.
  const alters = conn.calls.query.filter(c => /ALTER TABLE[\s\S]*AUTO_INCREMENT/.test(c.sql));
  assert.equal(alters.length, 2, "deve resetar o AUTO_INCREMENT das duas tabelas com id");
});

test("excluir usuário: e-mail vazio é rejeitado", async () => {
  await assert.rejects(() => excluirUsuario(acessoConn(), "   "), /e-mail/i);
});

// ---------------------------------------------------------------------------
// Crachás: importação e reversão em LOTE (chunked), com roster do consolidado.
// A identidade vem do consolidado (VW_SAUDE_INDIGENA): a importação NÃO cadastra
// trabalhador — matrícula fora do consolidado é erro por linha.
// ---------------------------------------------------------------------------
const { importarCrachasComConn: importarCrachas, reverterLoteComConn: reverterLote } = require("../lib/cracha.js");

// Mock de conexão para o crachá: `consolidado` = matrículas presentes na view;
// `overlay` = estado atual do controle por matrícula; `prev` = snapshots de
// desfazer. Distingue as consultas pelo texto do SQL.
function crachaConn({ consolidado = [], overlay = {}, prev = {} } = {}) {
  const calls = { query: [], tx: [], inserts: [] };
  return {
    calls,
    async query(sql, params) {
      calls.query.push({ sql, params });
      if (/INSERT INTO/.test(sql)) { calls.inserts.push({ sql, params }); return [{ affectedRows: 1 }]; }
      if (/VW_SAUDE_INDIGENA/.test(sql)) { // identidade no consolidado
        const rows = (params || []).filter(m => consolidado.includes(String(m)))
          .map(m => ({ MATRICULA: String(m), NOME: `Nome ${m}`, CPF: null, CARGO: null, DSEI: null, ID_DSEI_CASAI: null, SITUACAO_DETALHADA: null, DATA_ADMISSAO: null }));
        return [rows];
      }
      if (/`PREV_SNAPSHOT`, `PREV_TINHA`/.test(sql)) { // snapshots p/ reverter
        const rows = (params || []).filter(m => prev[String(m)]).map(m => ({ MATRICULA: String(m), ...prev[String(m)] }));
        return [rows];
      }
      if (/'%Y-%m-%d'/.test(sql)) { // estado atual do controle (leitura em lote do import)
        const rows = (params || []).filter(m => overlay[String(m)]).map(m => ({ MATRICULA: String(m), ...overlay[String(m)] }));
        return [rows];
      }
      if (/STATUS_EFETIVO/.test(sql)) { // busca final dos registros (controle)
        const uniq = [...new Set((params || []).map(String))];
        return [uniq.map(m => ({ MATRICULA: m }))];
      }
      return [[]];
    },
    async execute(sql, params) { calls.query.push({ sql, params }); return [{}]; },
    async beginTransaction() { calls.tx.push("begin"); },
    async commit() { calls.tx.push("commit"); },
    async rollback() { calls.tx.push("rollback"); }
  };
}

test("importar crachás (lote): atualiza quem está no consolidado e coleta erros por linha", async () => {
  const conn = crachaConn({
    consolidado: ["1", "2"],
    overlay: { "1": { STATUS_MANUAL: "FOTO PENDENTE DE ENVIO", DATA_ENVIO: null, DEVOLVIDO: 0, SEGUNDA_VIA: 0 } }
  });
  const r = await importarCrachas(conn, [
    { matricula: "1", status: "Crachás em Confecção" },   // existente: muda status (auto-carimba DATA_ENVIO)
    { matricula: "2", observacao: "primeiro registro" },  // sem linha de controle ainda: upsert cria
    { matricula: "", status: "Foto Pendente de Envio" },  // erro: matrícula em branco
    { matricula: "9", status: "Foto Pendente de Envio" }  // erro: fora do consolidado (não cadastra)
  ], "op@x");

  assert.equal(r.total, 4);
  assert.equal(r.criados, 0, "importação nunca cadastra trabalhador");
  assert.equal(r.atualizados, 2);
  assert.equal(r.erros.length, 2, "linha em branco + fora do consolidado");
  assert.ok(r.erros.some(e => /Matrícula em branco/.test(e.erro)));
  assert.ok(r.erros.some(e => e.matricula === "9" && /Trabalhador Consolidado/.test(e.erro)));

  // Uma única gravação em lote (multi-linha), dentro de transação.
  assert.equal(conn.calls.inserts.length, 1, "grava em um único INSERT multi-linha");
  assert.deepEqual(conn.calls.tx, ["begin", "commit"], "gravação atômica");
  const { sql, params } = conn.calls.inserts[0];
  assert.match(sql, /ON DUPLICATE KEY UPDATE/);
  assert.equal(params.length, 2 * 15, "2 linhas válidas x 15 colunas (matrícula + 11 dados + snapshot + tinha + usuário)");

  // Matrícula 1 (tinha controle): auto-carimba DATA_ENVIO=hoje e guarda snapshot (PREV_TINHA=1).
  const linha1 = params.slice(0, 15);
  assert.equal(linha1[0], "1");
  assert.match(String(linha1[3]), /^\d{4}-\d{2}-\d{2}$/, "DATA_ENVIO carimbada (3ª coluna de dados)");
  assert.equal(linha1[13], 1, "PREV_TINHA=1 (havia registro de controle)");
  // Matrícula 2 (primeiro registro): nasce sem snapshot (PREV_TINHA=0).
  const linha2 = params.slice(15, 30);
  assert.equal(linha2[0], "2");
  assert.equal(linha2[13], 0, "PREV_TINHA=0 (não havia registro)");
});

test("importar crachás (lote): sem linhas válidas não grava nada", async () => {
  const conn = crachaConn();
  const r = await importarCrachas(conn, [{ matricula: "", status: "x" }], "op@x");
  assert.equal(r.criados, 0);
  assert.equal(r.atualizados, 0);
  assert.equal(r.erros.length, 1);
  assert.equal(conn.calls.inserts.length, 0, "nada a gravar");
  assert.deepEqual(conn.calls.tx, [], "não abre transação sem dados");
});

test("reverter crachás (lote): restaura snapshot e ignora quem não tem o que desfazer", async () => {
  const conn = crachaConn({
    consolidado: ["10", "20", "30"],
    prev: {
      "10": { PREV_SNAPSHOT: JSON.stringify({ STATUS_MANUAL: "FOTO PENDENTE DE ENVIO", DEVOLVIDO: 0, SEGUNDA_VIA: 0 }), PREV_TINHA: 1 }, // restaura
      "20": { PREV_SNAPSHOT: null, PREV_TINHA: null }, // nada a desfazer
      "30": { PREV_SNAPSHOT: null, PREV_TINHA: 0 }     // primeiro registro: sem estado anterior
    }
  });
  const r = await reverterLote(conn, ["10", "20", "30", ""]);

  assert.deepEqual(conn.calls.tx, ["begin", "commit"], "gravação atômica");
  assert.equal(conn.calls.inserts.length, 1, "um upsert de restauração em lote");
  assert.equal(conn.calls.inserts[0].params[0], "10", "1ª coluna da tupla restaurada = matrícula");
  assert.equal(r.erros.length, 2);
  assert.ok(r.erros.some(e => e.matricula === "20" && /Não há alteração/.test(e.erro)));
  assert.ok(r.erros.some(e => e.matricula === "30" && /primeiro registro/.test(e.erro)));
  assert.deepEqual(r.registros.map(x => x.matricula), ["10"], "registros dos revertidos, buscados em lote");
});
