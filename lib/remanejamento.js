// Domínio: remanejamento de vagas (regras, cálculos e persistência).
const { DASH_CONFIG } = require("./config");
const { DASH_SQL, montarCaseCargoSql, montarSqlRemanejamentoLista, COMPONENTES_CUSTO_VAGA, COLUNAS_CUSTO_NOVAS, somaMensalCustoSql } = require("./sql");
const { getMysqlConnection, fecharJdbc, obterOuCarregarJsonCache, executarConsultaComConn } = require("./db");
const { limparValorDash, converterNumeroDash, normalizarChaveDash, mesesAteFimDoAno, calcularOciosasServidor } = require("./utils");
const { dseiNoEscopo, erroEscopo } = require("./escopo");

// Filtra uma lista de linhas (com idDseiCasai) pelo escopo de DSEI do usuário.
// escopo.todos (ou ausente) => sem filtro.
function filtrarLinhasPorEscopo(rows, escopo) {
  if (!escopo || escopo.todos) return rows || [];
  return (rows || []).filter(r => dseiNoEscopo(escopo, r.idDseiCasai));
}

// Bloqueia (403) o acesso a um processo cujo DSEI está fora do escopo do usuário.
async function garantirEscopoProcessoComConn(conn, idProcesso, escopo) {
  if (!escopo || escopo.todos) return;
  const [rows] = await conn.query(
    `SELECT ID_DSEI_CASAI FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.MOVIMENTACAO_REMANEJAMENTO_TABLE}\`
      WHERE ID_PROCESSO_REMANEJAMENTO = ? LIMIT 1`,
    [idProcesso]
  );
  const idDsei = rows && rows[0] ? rows[0].ID_DSEI_CASAI : null;
  if (!dseiNoEscopo(escopo, idDsei)) {
    const err = new Error("Você não tem acesso a este remanejamento (DSEI fora do seu escopo).");
    err.status = 403;
    err.expose = true;
    throw err;
  }
}

async function garantirTabelaMovimentacaoRemanejamento() {
  const conn = await getMysqlConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.MOVIMENTACAO_REMANEJAMENTO_TABLE}\` (
        \`ID_MOVIMENTACAO_REMANEJAMENTO\` INT(11) NOT NULL AUTO_INCREMENT,
        \`ID_PROCESSO_REMANEJAMENTO\`     INT(11) NOT NULL,
        \`ID_DSEI_CASAI\`                 INT(11) NOT NULL,
        \`ID_VAGA\`                       INT(11) NOT NULL,
        \`TIPO_MOVIMENTACAO\`             ENUM('ACRESCIMO','DECRESCIMO') NOT NULL,
        \`QTD\`                           INT(11) NOT NULL DEFAULT 1,
        \`DATA_INSERCAO\`                 DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`ID_MOVIMENTACAO_REMANEJAMENTO\`),
        KEY \`IDX_MOV_PROCESSO\` (\`ID_PROCESSO_REMANEJAMENTO\`),
        KEY \`IDX_MOV_DSEI_VAGA\` (\`ID_DSEI_CASAI\`, \`ID_VAGA\`),
        CONSTRAINT \`FK_MOV_PROCESSO\` FOREIGN KEY (\`ID_PROCESSO_REMANEJAMENTO\`)
          REFERENCES \`${DASH_CONFIG.PROCESSO_REMANEJAMENTO_TABLE}\` (\`ID_PROCESSO_REMANEJAMENTO\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } finally {
    await fecharJdbc(conn);
  }
}

// Garante a coluna N_MESES em PROCESSO_REMANEJAMENTO (meses do mês informado até
// dezembro, escolhido na criação e válido para os dois lados). Registros antigos ficam
// NULL e usam o cálculo derivado da data de inserção como fallback.
async function garantirColunaMesesRemanejamento() {
  const conn = await getMysqlConnection();
  try {
    const [cols] = await conn.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = 'N_MESES'`,
      [DASH_CONFIG.DB_SCHEMA, DASH_CONFIG.PROCESSO_REMANEJAMENTO_TABLE]
    );
    if (!cols.length) {
      await conn.query(
        `ALTER TABLE \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.PROCESSO_REMANEJAMENTO_TABLE}\`
          ADD COLUMN \`N_MESES\` INT(11) NULL`
      );
    }
  } finally {
    await fecharJdbc(conn);
  }
}

// Garante a coluna CRIADO_POR em MOVIMENTACAO_REMANEJAMENTO. Usada só pelos
// "ajustes pontuais" (movimentações sem ID_PROCESSO_REMANEJAMENTO): guarda quem
// fez o ajuste para exibir na janela de alterações pontuais. A coluna
// ID_PROCESSO_REMANEJAMENTO já é anulável no banco (feito manualmente).
async function garantirColunaAjusteRemanejamento() {
  const conn = await getMysqlConnection();
  try {
    const [cols] = await conn.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = 'CRIADO_POR'`,
      [DASH_CONFIG.DB_SCHEMA, DASH_CONFIG.MOVIMENTACAO_REMANEJAMENTO_TABLE]
    );
    if (!cols.length) {
      await conn.query(
        `ALTER TABLE \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.MOVIMENTACAO_REMANEJAMENTO_TABLE}\`
          ADD COLUMN \`CRIADO_POR\` VARCHAR(255) NULL`
      );
    }
  } finally {
    await fecharJdbc(conn);
  }
}

// Garante a coluna TP_AJUSTE em PROCESSO_REMANEJAMENTO: 'N' (padrão) = remanejamento
// normal (vai para o histórico); 'S' = ajuste pontual (vai para a janela de
// alterações pontuais). ENUM('N','S') força a validação e o padrão. Idempotente.
async function garantirColunaTpAjusteRemanejamento() {
  const conn = await getMysqlConnection();
  try {
    const [cols] = await conn.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = 'TP_AJUSTE'`,
      [DASH_CONFIG.DB_SCHEMA, DASH_CONFIG.PROCESSO_REMANEJAMENTO_TABLE]
    );
    if (!cols.length) {
      await conn.query(
        `ALTER TABLE \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.PROCESSO_REMANEJAMENTO_TABLE}\`
          ADD COLUMN \`TP_AJUSTE\` ENUM('N','S') NOT NULL DEFAULT 'N'`
      );
    }
  } finally {
    await fecharJdbc(conn);
  }
}

// Garante em CUSTO_GERAL_VAGA as colunas de valores acrescentadas depois: Abono
// Emergencial, Trabalho em Campo, Captação Médica e Auxílio de Área Remota. Entram
// logo APÓS VALE_ALIMENTACAO — portanto ANTES de DATA_INSERCAO — na ordem da lista,
// cada uma em seu próprio ALTER para que o AFTER encadeado valha mesmo quando só
// algumas faltam. Idempotente: roda no boot e não faz nada se já existirem.
async function garantirColunasCustoGeralVaga() {
  const conn = await getMysqlConnection();
  try {
    const [cols] = await conn.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [DASH_CONFIG.DB_SCHEMA, DASH_CONFIG.CUSTO_GERAL_VAGA_TABLE]
    );
    const existentes = new Set((cols || []).map(c => String(c.COLUMN_NAME).toUpperCase()));
    if (!existentes.size) return; // tabela ausente: nada a alterar (erro aparece na consulta)

    // Âncora de posição: a última coluna de valor que já existe, começando em
    // VALE_ALIMENTACAO. Sem âncora, a coluna vai para o fim (ainda funcional).
    let ancora = existentes.has("VALE_ALIMENTACAO") ? "VALE_ALIMENTACAO" : null;

    for (const coluna of COLUNAS_CUSTO_NOVAS) {
      if (existentes.has(coluna)) {
        ancora = coluna;
        continue;
      }
      const posicao = ancora ? ` AFTER \`${ancora}\`` : "";
      await conn.query(
        `ALTER TABLE \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.CUSTO_GERAL_VAGA_TABLE}\`
          ADD COLUMN \`${coluna}\` DECIMAL(15,2) NOT NULL DEFAULT 0.00${posicao}`
      );
      ancora = coluna;
    }
  } finally {
    await fecharJdbc(conn);
  }
}

async function getRemanejamentoListaData(escopo) {
  const rows = filtrarLinhasPorEscopo(await obterRemanejamentoListaComCache(), escopo);

  return {
    rows,
    atualizadoEm: obterUltimaAtualizacaoRemanejamento(rows)
  };
}

async function getRemanejamentoCadastroData(escopo) {
  const rows = filtrarLinhasPorEscopo(await obterRemanejamentoCadastroComCache(), escopo);

  return {
    rows,
    atualizadoEm: ""
  };
}

async function obterRemanejamentoListaComCache() {
  return obterOuCarregarJsonCache(DASH_CONFIG.CACHE_REMANEJAMENTO_LISTA_KEY, DASH_CONFIG.CACHE_SECONDS, async () => {
    const conn = await getMysqlConnection();
    try {
      return await buscarRemanejamentosComConn(conn);
    } finally {
      await fecharJdbc(conn);
    }
  });
}

async function obterRemanejamentoCadastroComCache() {
  return obterOuCarregarJsonCache(DASH_CONFIG.CACHE_REMANEJAMENTO_CADASTRO_KEY, DASH_CONFIG.CACHE_SECONDS, async () => {
    const conn = await getMysqlConnection();
    try {
      return await buscarRemanejamentoCadastroComConn(conn);
    } finally {
      await fecharJdbc(conn);
    }
  });
}

async function buscarRemanejamentosComConn(conn) {
  // Histórico = só remanejamentos normais (TP_AJUSTE = 'N'); ajustes ('S') ficam na
  // janela de alterações pontuais.
  return executarConsultaComConn(conn, montarSqlRemanejamentoLista("N"), mapRemanejamentoListaRow);
}

async function buscarRemanejamentoCadastroComConn(conn) {
  return executarConsultaComConn(conn, DASH_SQL.REMANEJAMENTO_CADASTRO, mapRemanejamentoCadastroRow);
}

function mapRemanejamentoListaRow(row) {
  const idProcesso = limparValorDash(row.id_processo ?? row[0]);
  const temAnexo = Number(row.tem_anexo || 0) > 0;

  return {
    idProcesso,
    idRemanejamento: idProcesso,
    dataCriacao: limparValorDash(row.data_inclusao_formatada),
    dataCriacaoFormatada: limparValorDash(row.data_inclusao_formatada),
    competencia: limparValorDash(row.competencia),
    idDseiCasai: limparValorDash(row.id_dsei_casai),
    dseiCasai: limparValorDash(row.dsei_casai),
    cargosReduzidos: limparValorDash(row.cargos_reduzidos),
    cargosAcrescentados: limparValorDash(row.cargos_acrescentados),
    totalReduzidoMensal: converterNumeroDash(row.total_reduzido_mensal),
    totalAcrescentadoMensal: converterNumeroDash(row.total_acrescentado_mensal),
    impactoMensal: converterNumeroDash(row.impacto_mensal),
    totalReduzidoPeriodo: converterNumeroDash(row.total_reduzido_periodo),
    totalAcrescentadoPeriodo: converterNumeroDash(row.total_acrescentado_periodo),
    impactoPeriodo: converterNumeroDash(row.impacto_periodo),
    numeroProcessoSei: limparValorDash(row.numero_processo_sei),
    numeroMeses: converterNumeroDash(row.numero_meses),
    observacao: limparValorDash(row.observacao),
    inseridoPorEmail: limparValorDash(row.criado_por),
    criadoPor: limparValorDash(row.criado_por),
    situacao: limparValorDash(row.situacao || "Registrado"),
    temAnexo,
    anexoOficioUrl: temAnexo ? `/api/remanejamento/anexo/${encodeURIComponent(idProcesso)}` : "",
    anexoOficioNome: limparValorDash(row.anexo_nome_arquivo),
    anexoOficioTipo: limparValorDash(row.anexo_mime_type),
    atualizadoEm: limparValorDash(row.data_inclusao_formatada),
    atualizadoEmFormatado: limparValorDash(row.data_inclusao_formatada)
  };
}

function mapRemanejamentoCadastroRow(row) {
  // Um campo por componente de custo (ver COMPONENTES_CUSTO_VAGA), somando o mensal
  // quando a query não trouxe valor_mensal.
  const componentes = {};
  let somaComponentes = 0;
  COMPONENTES_CUSTO_VAGA.forEach(c => {
    const valor = converterNumeroDash(row[c.aliasCadastro]);
    componentes[c.campo] = valor;
    somaComponentes += valor;
  });
  const valorMensal = converterNumeroDash(row.valor_mensal) || somaComponentes;

  return {
    idDseiCasai: converterNumeroDash(row.id_dsei_casai),
    dseiCasai: limparValorDash(row.dsei_casai),
    idCargoFuncao: converterNumeroDash(row.id_cargo_funcao),
    cargo: limparValorDash(row.cargo),
    quantitativoPlano: converterNumeroDash(row.quantitativo_plano_trabalho),
    cargaHoraria: limparValorDash(row.carga_horaria),
    ...componentes,
    valorMensal,
    vagasOciosas: converterNumeroDash(row.vagas_ociosas)
  };
}

// N_MESES do REMANEJAMENTO NORMAL: do mês informado (1..12) até o fim do ano
// (dezembro), ou seja 13 - mês. Sem mês válido, mantém o padrão (do mês atual até
// dezembro). Vale para os DOIS lados — reduzido e acrescentado usam o mesmo período.
function mesesRemanejamentoDoBody(body) {
  const mesEscolhido = Number(body.mes);
  return (mesEscolhido >= 1 && mesEscolhido <= 12)
    ? Math.max(1, 13 - mesEscolhido)
    : mesesAteFimDoAno();
}

// N_MESES do AJUSTE PONTUAL: aqui a base é 12, não 13 — o Nº de meses gravado é
// 12 - o número digitado no campo do mês. Sem número válido, cai no mês atual.
function mesesAjusteDoBody(body) {
  const mesDigitado = Number(body.mes);
  const base = (mesDigitado >= 1 && mesDigitado <= 12)
    ? mesDigitado
    : (new Date().getMonth() + 1);
  return Math.max(1, 12 - base);
}

// Nº de meses do lado ACRESCENTADO em um AJUSTE PONTUAL: o número que o admin digitou
// no campo do mês, ou seja, o complemento de N_MESES na base 12 (12 - N_MESES). No
// remanejamento normal os dois lados usam o mesmo N_MESES.
function mesesLadoAcrescentadoAjuste(meses) {
  return Math.max(1, 12 - Math.max(1, Math.min(12, Math.floor(Number(meses)) || 1)));
}

async function salvarRemanejamentoComConn(conn, body, file, escopo) {
  const idDseiCasai = converterNumeroDash(body.idDseiCasai);
  const processoSei = limparValorDash(body.processoSei);
  const observacao = limparValorDash(body.observacao);
  const criadoPor = limparValorDash(body.criadoPor || body.usuario || "painel");

  let linhasReduzido = [];
  let linhasAcrescentado = [];

  try {
    linhasReduzido = JSON.parse(body.linhasReduzido || "[]");
    linhasAcrescentado = JSON.parse(body.linhasAcrescentado || "[]");
  } catch (err) {
    throw new Error("Linhas de remanejamento inválidas.");
  }

  linhasReduzido = normalizarLinhasRemanejamentoServidor(linhasReduzido);
  linhasAcrescentado = normalizarLinhasRemanejamentoServidor(linhasAcrescentado);

  if (!idDseiCasai) throw new Error("Selecione o DSEI/CASAI.");
  if (!processoSei) throw new Error("Informe o número do Processo SEI.");
  if (!linhasReduzido.length) throw new Error("Informe ao menos um cargo reduzido.");
  if (!linhasAcrescentado.length) throw new Error("Informe ao menos um cargo acrescentado.");

  // Escopo: usuário restrito só pode criar remanejamento do(s) seu(s) DSEI(s).
  if (!dseiNoEscopo(escopo, idDseiCasai)) throw erroEscopo("Você não pode criar remanejamento para um DSEI fora do seu escopo.");

  // N_MESES: do mês escolhido até dezembro, igual para os dois lados.
  const meses = mesesRemanejamentoDoBody(body);

  // Custos sempre recalculados no servidor a partir de CUSTO_GERAL_VAGA (por DSEI + vaga),
  // ignorando os valores enviados pelo cliente, que servem apenas para visualização.
  const custos = await buscarCustosVagaPorDseiComConn(conn, idDseiCasai);
  const resumoReduzido = calcularResumoLinhasServidor(linhasReduzido, custos, meses);
  const resumoAcrescentado = calcularResumoLinhasServidor(linhasAcrescentado, custos, meses);
  const impactoMensal = resumoAcrescentado.mensal - resumoReduzido.mensal;
  const impactoPeriodo = resumoAcrescentado.periodo - resumoReduzido.periodo;

  // Espelha a regra do Apps Script: o remanejamento não pode aumentar o custo.
  if (impactoMensal > 0 || impactoPeriodo > 0) {
    throw new Error(
      "Remanejamento bloqueado: o impacto financeiro está positivo, indicando aumento de custo. " +
      "Ajuste os cargos para que o impacto mensal e do período fiquem zerados ou negativos."
    );
  }

  // Só é possível reduzir cargos que possuem vagas ociosas suficientes no DSEI/CASAI.
  await validarVagasOciosasReduzidoComConn(conn, idDseiCasai, linhasReduzido);

  await conn.beginTransaction();

  try {
    // 1) Processo (PROCESSO_REMANEJAMENTO, com anexo em BLOB).
    const [procResult] = await conn.execute(
      `INSERT INTO \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.PROCESSO_REMANEJAMENTO_TABLE}\` (
        N_PROCESSO,
        OBSERVACAO,
        CRIADO_POR,
        N_MESES,
        ANEXO_PROCESSO,
        ANEXO_NOME_ARQUIVO,
        ANEXO_MIME_TYPE,
        ANEXO_TAMANHO_BYTES
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        processoSei,
        observacao || null,
        criadoPor || null,
        meses,
        file ? file.buffer : null,
        file ? file.originalname : null,
        file ? file.mimetype : null,
        file ? file.size : null
      ]
    );

    const idProcesso = procResult.insertId;

    // 2) Modelo 1 processo -> N movimentações tipadas. Cada cargo vira uma linha em
    // MOVIMENTACAO_REMANEJAMENTO, com TIPO_MOVIMENTACAO indicando se é DECRESCIMO ou ACRESCIMO.
    const inserirMovimentacao = (linha, tipo) => conn.execute(
      `INSERT INTO \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.MOVIMENTACAO_REMANEJAMENTO_TABLE}\` (
        ID_PROCESSO_REMANEJAMENTO, ID_DSEI_CASAI, ID_VAGA, TIPO_MOVIMENTACAO, QTD
      ) VALUES (?, ?, ?, ?, ?)`,
      [idProcesso, idDseiCasai, linha.idCargoFuncao, tipo, linha.quantidade]
    );

    for (const linha of linhasReduzido) {
      await inserirMovimentacao(linha, "DECRESCIMO");
    }

    for (const linha of linhasAcrescentado) {
      await inserirMovimentacao(linha, "ACRESCIMO");
    }

    await conn.commit();
    return { idProcesso, impactoMensal, impactoPeriodo };
  } catch (err) {
    await conn.rollback();
    throw err;
  }
}

function mapearCargoParaPrevistas(idCargo) {
  const id = Number(idCargo);
  if ([28, 29, 30, 104].includes(id)) return 104;
  if ([77, 78, 79, 80, 81].includes(id)) return 81;
  if ([102, 45].includes(id)) return 45;
  return id;
}

// Soma as reduções (DECRESCIMO) atuais de um processo, agregadas pelo cargo
// consolidado (mesma chave usada na validação de ociosas).
async function obterReducoesAtuaisPorCargoComConn(conn, idProcesso) {
  const [rows] = await conn.query(
    `SELECT ID_VAGA AS id_vaga, SUM(QTD) AS qtd
     FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.MOVIMENTACAO_REMANEJAMENTO_TABLE}\`
     WHERE ID_PROCESSO_REMANEJAMENTO = ? AND TIPO_MOVIMENTACAO = 'DECRESCIMO'
     GROUP BY ID_VAGA`,
    [idProcesso]
  );
  const creditos = {};
  (rows || []).forEach(r => {
    const idMapeado = Number(mapearCargoParaPrevistas(r.id_vaga));
    creditos[idMapeado] = (creditos[idMapeado] || 0) + (Number(r.qtd) || 0);
  });
  return creditos;
}

// creditosPorCargo: ao EDITAR, as reduções atuais do próprio remanejamento já
// abateram as vagas ociosas na view; este mapa (idCargoMapeado -> qtd) devolve
// essas vagas ao saldo disponível para a validação não bloquear a edição.
async function validarVagasOciosasReduzidoComConn(conn, idDseiCasai, linhasReduzido, creditosPorCargo) {
  const creditos = creditosPorCargo || {};
  const [rows] = await conn.query(
    `SELECT \`id_cargo_funcao\`, \`cargo\`, COALESCE(\`vagas_ociosas\`, 0) AS vagas_ociosas
     FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.MONITORAMENTO_VIEW}\`
     WHERE \`id_dsei_casai\` = ?`,
    [idDseiCasai]
  );

  const ociosasPorCargo = {};
  (rows || []).forEach(r => {
    ociosasPorCargo[Number(r.id_cargo_funcao)] = {
      cargo: r.cargo,
      ociosas: Number(r.vagas_ociosas) || 0
    };
  });

  // Agrega a redução solicitada por cargo consolidado (vários ID_VAGA podem cair na mesma linha).
  const reducaoPorCargo = {};
  linhasReduzido.forEach(linha => {
    const idMapeado = mapearCargoParaPrevistas(linha.idCargoFuncao);
    reducaoPorCargo[idMapeado] = (reducaoPorCargo[idMapeado] || 0) + (Number(linha.quantidade) || 0);
  });

  const erros = [];
  Object.keys(reducaoPorCargo).forEach(idCargo => {
    const solicitado = reducaoPorCargo[idCargo];
    const info = ociosasPorCargo[Number(idCargo)] || { cargo: `cargo ${idCargo}`, ociosas: 0 };
    const credito = Number(creditos[Number(idCargo)] || 0);
    const disponivel = Math.max(0, Math.floor(info.ociosas) + credito);
    if (solicitado > disponivel) {
      erros.push(
        `${info.cargo}: ${disponivel} vaga(s) ociosa(s) disponível(is), mas foram solicitadas ${solicitado} para redução`
      );
    }
  });

  if (erros.length) {
    throw new Error(
      "Remanejamento bloqueado: não há vagas ociosas suficientes para reduzir os seguintes cargos neste DSEI/CASAI — " +
      erros.join("; ") + "."
    );
  }
}

async function buscarCustosVagaPorDseiComConn(conn, idDseiCasai) {
  const [rows] = await conn.query(
    `SELECT
       c.ID_VAGA,
       ${somaMensalCustoSql("c")} AS mensal_unitario
     FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.CUSTO_GERAL_VAGA_TABLE}\` c
     JOIN (
       SELECT ID_VAGA, MAX(ID_CUSTO_GERAL_VAGA) AS max_id
       FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.CUSTO_GERAL_VAGA_TABLE}\`
       WHERE ID_DSEI_CASAI = ?
       GROUP BY ID_VAGA
     ) ult ON ult.max_id = c.ID_CUSTO_GERAL_VAGA
     WHERE c.ID_DSEI_CASAI = ?`,
    [idDseiCasai, idDseiCasai]
  );

  const mapa = {};
  (rows || []).forEach(row => {
    mapa[String(converterNumeroDash(row.ID_VAGA))] = converterNumeroDash(row.mensal_unitario);
  });

  return mapa;
}

function calcularResumoLinhasServidor(linhas, custos, meses) {
  const mesesEfetivo = Math.max(1, Number(meses || 1));
  return (linhas || []).reduce((acc, linha) => {
    const mensalUnitario = Number(custos[String(linha.idCargoFuncao)] || 0);
    const mensal = mensalUnitario * Number(linha.quantidade || 0);
    acc.mensal += mensal;
    acc.periodo += mensal * mesesEfetivo;
    return acc;
  }, { mensal: 0, periodo: 0 });
}

function normalizarLinhasRemanejamentoServidor(linhas) {
  return (Array.isArray(linhas) ? linhas : [])
    .map(item => ({
      idCargoFuncao: converterNumeroDash(item.idCargoFuncao),
      quantidade: Math.max(0, converterNumeroDash(item.quantidade)),
      meses: Math.max(1, converterNumeroDash(item.meses) || 1)
    }))
    .filter(item => item.idCargoFuncao && item.quantidade > 0);
}

async function excluirRemanejamentoComConn(conn, idProcesso, escopo) {
  const id = converterNumeroDash(idProcesso);
  if (!id) throw new Error("Remanejamento inválido.");

  // Escopo: não excluir remanejamento de DSEI fora do escopo.
  await garantirEscopoProcessoComConn(conn, id, escopo);

  await conn.beginTransaction();
  try {
    // 1) Remove as movimentações do processo.
    await conn.execute(
      `DELETE FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.MOVIMENTACAO_REMANEJAMENTO_TABLE}\`
        WHERE ID_PROCESSO_REMANEJAMENTO = ?`,
      [id]
    );

    // 2) Remove o processo.
    await conn.execute(
      `DELETE FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.PROCESSO_REMANEJAMENTO_TABLE}\` WHERE ID_PROCESSO_REMANEJAMENTO = ?`,
      [id]
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  }
}

function montarSqlDetalheMovimentacao() {
  return `
    WITH
    cargo_dim AS (
      SELECT CAST(CARGO_ATUAL_ID AS UNSIGNED) AS id_cargo_funcao, MAX(CARGO_ATUAL_DESC) AS cargo
      FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`VW_SAUDE_INDIGENA\`
      GROUP BY CAST(CARGO_ATUAL_ID AS UNSIGNED)
    ),
    custo_dim AS (
      SELECT c.ID_DSEI_CASAI, c.ID_VAGA,
             ${COMPONENTES_CUSTO_VAGA.map(comp => `c.${comp.coluna}`).join(", ")}
      FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.CUSTO_GERAL_VAGA_TABLE}\` c
      JOIN (
        SELECT ID_DSEI_CASAI, ID_VAGA, MAX(ID_CUSTO_GERAL_VAGA) AS max_id
        FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.CUSTO_GERAL_VAGA_TABLE}\`
        GROUP BY ID_DSEI_CASAI, ID_VAGA
      ) ult ON ult.max_id = c.ID_CUSTO_GERAL_VAGA
    )
    SELECT
      COALESCE(p.N_MESES, 13 - MONTH(p.DATA_INSERCAO)) AS n_meses,
      COALESCE(p.TP_AJUSTE, 'N') AS tp_ajuste,
      ${montarCaseCargoSql("m.ID_VAGA", "cd")} AS cargo,
      m.QTD AS qtd,
      ${COMPONENTES_CUSTO_VAGA.map(c => `COALESCE(cu.${c.coluna}, 0) AS ${c.aliasDetalhe}`).join(",\n      ")}
    FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.MOVIMENTACAO_REMANEJAMENTO_TABLE}\` m
    JOIN \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.PROCESSO_REMANEJAMENTO_TABLE}\` p
      ON p.ID_PROCESSO_REMANEJAMENTO = m.ID_PROCESSO_REMANEJAMENTO
    LEFT JOIN cargo_dim cd ON cd.id_cargo_funcao = m.ID_VAGA
    LEFT JOIN custo_dim cu ON cu.ID_DSEI_CASAI = m.ID_DSEI_CASAI AND cu.ID_VAGA = m.ID_VAGA
    WHERE m.ID_PROCESSO_REMANEJAMENTO = ? AND m.TIPO_MOVIMENTACAO = ?
  `;
}

// Dados crus (com IDs) para repopular o formulário ao EDITAR um remanejamento.
async function getRemanejamentoEdicaoData(idProcesso, escopo) {
  const id = converterNumeroDash(idProcesso);
  if (!id) throw new Error("Remanejamento inválido.");

  const conn = await getMysqlConnection();
  try {
    await garantirEscopoProcessoComConn(conn, id, escopo);
    const [movs] = await conn.query(
      `SELECT ID_DSEI_CASAI AS id_dsei_casai, ID_VAGA AS id_cargo_funcao,
              TIPO_MOVIMENTACAO AS tipo, QTD AS qtd
       FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.MOVIMENTACAO_REMANEJAMENTO_TABLE}\`
       WHERE ID_PROCESSO_REMANEJAMENTO = ?`,
      [id]
    );
    const [procs] = await conn.query(
      `SELECT N_PROCESSO, OBSERVACAO, N_MESES, ANEXO_NOME_ARQUIVO, COALESCE(TP_AJUSTE, 'N') AS TP_AJUSTE
       FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.PROCESSO_REMANEJAMENTO_TABLE}\`
       WHERE ID_PROCESSO_REMANEJAMENTO = ? LIMIT 1`,
      [id]
    );

    const proc = procs[0] || {};
    const idDseiCasai = movs.length ? movs[0].id_dsei_casai : null;
    const nMeses = Number(proc.N_MESES);
    // O formulário repõe o número do mês, invertendo a conta usada ao gravar — e a base
    // difere por tipo de processo:
    //   • remanejamento normal -> base 13 (meses = 13 - mes, logo mes = 13 - meses);
    //   • ajuste pontual       -> base 12 (meses = 12 - mes, logo mes = 12 - meses).
    // Sem N_MESES válido, ambos caem no padrão (mês atual).
    const ehAjuste = String(proc.TP_AJUSTE || "N") === "S";
    const base = ehAjuste ? 12 : 13;
    const meses = (nMeses >= 1 && nMeses <= 12) ? nMeses : (new Date().getMonth() + 1);
    const mes = (nMeses >= 1 && nMeses <= 12)
      ? Math.min(12, Math.max(1, base - nMeses))
      : (new Date().getMonth() + 1);

    const linhasPorTipo = (tipo) => (movs || [])
      .filter(m => m.tipo === tipo)
      .map(m => ({ idCargoFuncao: String(m.id_cargo_funcao), quantidade: Number(m.qtd) || 0 }));

    return {
      idProcesso: id,
      idDseiCasai: idDseiCasai != null ? String(idDseiCasai) : "",
      processoSei: limparValorDash(proc.N_PROCESSO),
      observacao: limparValorDash(proc.OBSERVACAO),
      anexoNome: limparValorDash(proc.ANEXO_NOME_ARQUIVO),
      mes,
      meses,
      reduzidos: linhasPorTipo("DECRESCIMO"),
      acrescentados: linhasPorTipo("ACRESCIMO")
    };
  } finally {
    await fecharJdbc(conn);
  }
}

// Atualiza um remanejamento existente: mesmas regras/validações do salvar, em uma
// transação. Remove as movimentações atuais ANTES de validar as vagas ociosas (a
// view enxerga o delete na mesma conexão e libera as vagas deste próprio processo).
// O anexo só é trocado quando um novo arquivo é enviado.
async function atualizarRemanejamentoComConn(conn, idProcesso, body, file, escopo) {
  const id = converterNumeroDash(idProcesso);
  if (!id) throw new Error("Remanejamento inválido.");

  // Escopo: o processo existente precisa estar no escopo (não editar de outro DSEI).
  await garantirEscopoProcessoComConn(conn, id, escopo);

  const idDseiCasai = converterNumeroDash(body.idDseiCasai);
  const processoSei = limparValorDash(body.processoSei);
  const observacao = limparValorDash(body.observacao);

  let linhasReduzido = [];
  let linhasAcrescentado = [];
  try {
    linhasReduzido = JSON.parse(body.linhasReduzido || "[]");
    linhasAcrescentado = JSON.parse(body.linhasAcrescentado || "[]");
  } catch (err) {
    throw new Error("Linhas de remanejamento inválidas.");
  }

  linhasReduzido = normalizarLinhasRemanejamentoServidor(linhasReduzido);
  linhasAcrescentado = normalizarLinhasRemanejamentoServidor(linhasAcrescentado);

  if (!idDseiCasai) throw new Error("Selecione o DSEI/CASAI.");
  if (!processoSei) throw new Error("Informe o número do Processo SEI.");
  if (!linhasReduzido.length) throw new Error("Informe ao menos um cargo reduzido.");
  if (!linhasAcrescentado.length) throw new Error("Informe ao menos um cargo acrescentado.");

  // Escopo: o novo DSEI informado também precisa estar no escopo do usuário.
  if (!dseiNoEscopo(escopo, idDseiCasai)) throw erroEscopo("DSEI de destino fora do seu escopo.");

  const meses = mesesRemanejamentoDoBody(body);

  const custos = await buscarCustosVagaPorDseiComConn(conn, idDseiCasai);
  const resumoReduzido = calcularResumoLinhasServidor(linhasReduzido, custos, meses);
  const resumoAcrescentado = calcularResumoLinhasServidor(linhasAcrescentado, custos, meses);
  const impactoMensal = resumoAcrescentado.mensal - resumoReduzido.mensal;
  const impactoPeriodo = resumoAcrescentado.periodo - resumoReduzido.periodo;

  if (impactoMensal > 0 || impactoPeriodo > 0) {
    throw new Error(
      "Remanejamento bloqueado: o impacto financeiro está positivo, indicando aumento de custo. " +
      "Ajuste os cargos para que o impacto mensal e do período fiquem zerados ou negativos."
    );
  }

  // As reduções ATUAIS deste remanejamento já abateram as vagas ociosas na view.
  // Ao editar, elas serão substituídas, então são creditadas de volta na validação
  // (não depende de o delete ser visível na transação, que não era).
  const creditosOciosas = await obterReducoesAtuaisPorCargoComConn(conn, id);
  await validarVagasOciosasReduzidoComConn(conn, idDseiCasai, linhasReduzido, creditosOciosas);

  await conn.beginTransaction();
  try {
    // Substitui as movimentações: remove as atuais e insere as novas.
    await conn.execute(
      `DELETE FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.MOVIMENTACAO_REMANEJAMENTO_TABLE}\`
        WHERE ID_PROCESSO_REMANEJAMENTO = ?`,
      [id]
    );

    const inserirMovimentacao = (linha, tipo) => conn.execute(
      `INSERT INTO \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.MOVIMENTACAO_REMANEJAMENTO_TABLE}\` (
        ID_PROCESSO_REMANEJAMENTO, ID_DSEI_CASAI, ID_VAGA, TIPO_MOVIMENTACAO, QTD
      ) VALUES (?, ?, ?, ?, ?)`,
      [id, idDseiCasai, linha.idCargoFuncao, tipo, linha.quantidade]
    );

    for (const linha of linhasReduzido) await inserirMovimentacao(linha, "DECRESCIMO");
    for (const linha of linhasAcrescentado) await inserirMovimentacao(linha, "ACRESCIMO");

    if (file) {
      await conn.execute(
        `UPDATE \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.PROCESSO_REMANEJAMENTO_TABLE}\`
          SET N_PROCESSO = ?, OBSERVACAO = ?, N_MESES = ?,
              ANEXO_PROCESSO = ?, ANEXO_NOME_ARQUIVO = ?, ANEXO_MIME_TYPE = ?, ANEXO_TAMANHO_BYTES = ?
          WHERE ID_PROCESSO_REMANEJAMENTO = ?`,
        [processoSei, observacao || null, meses,
          file.buffer, file.originalname, file.mimetype, file.size, id]
      );
    } else {
      await conn.execute(
        `UPDATE \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.PROCESSO_REMANEJAMENTO_TABLE}\`
          SET N_PROCESSO = ?, OBSERVACAO = ?, N_MESES = ?
          WHERE ID_PROCESSO_REMANEJAMENTO = ?`,
        [processoSei, observacao || null, meses, id]
      );
    }

    await conn.commit();
    return { idProcesso: id, impactoMensal, impactoPeriodo };
  } catch (err) {
    await conn.rollback();
    throw err;
  }
}

async function getRemanejamentoDetalheData(idProcesso, escopo) {
  const id = converterNumeroDash(idProcesso);
  if (!id) throw new Error("Remanejamento inválido.");

  const sqlDetalhe = montarSqlDetalheMovimentacao();

  const conn = await getMysqlConnection();
  try {
    await garantirEscopoProcessoComConn(conn, id, escopo);
    const [linhasRed] = await conn.query(sqlDetalhe, [id, "DECRESCIMO"]);
    const [linhasAcr] = await conn.query(sqlDetalhe, [id, "ACRESCIMO"]);

    // Remanejamento normal: os dois lados usam N_MESES. Ajuste pontual: o reduzido usa
    // N_MESES e o acrescentado, o número digitado no campo do mês (12 - N_MESES, base 12).
    const primeira = linhasRed[0] || linhasAcr[0] || {};
    const meses = Math.max(1, Number(primeira.n_meses || mesesAteFimDoAno()));
    const ehAjuste = String(primeira.tp_ajuste || "N") === "S";
    const mesesAcrescentado = ehAjuste ? mesesLadoAcrescentadoAjuste(meses) : meses;

    const reduzidos = (linhasRed || []).map(l => montarItemDetalheRemanejamento(l, meses));
    const acrescentados = (linhasAcr || []).map(l => montarItemDetalheRemanejamento(l, mesesAcrescentado));

    const totalReduzidoMensal = reduzidos.reduce((s, i) => s + i.mensal, 0);
    const totalAcrescentadoMensal = acrescentados.reduce((s, i) => s + i.mensal, 0);
    const totalReduzidoPeriodo = reduzidos.reduce((s, i) => s + i.periodo, 0);
    const totalAcrescentadoPeriodo = acrescentados.reduce((s, i) => s + i.periodo, 0);

    return {
      idProcesso: id,
      meses,
      mesesAcrescentado,
      reduzidos,
      acrescentados,
      totalReduzidoMensal,
      totalAcrescentadoMensal,
      totalReduzidoPeriodo,
      totalAcrescentadoPeriodo,
      impactoMensal: totalAcrescentadoMensal - totalReduzidoMensal,
      impactoPeriodo: totalAcrescentadoPeriodo - totalReduzidoPeriodo
    };
  } finally {
    await fecharJdbc(conn);
  }
}

function montarItemDetalheRemanejamento(linha, meses) {
  const quantidade = converterNumeroDash(linha.qtd);

  // Cada componente já multiplicado pela quantidade; o mensal é a soma de todos.
  const componentes = {};
  let mensal = 0;
  COMPONENTES_CUSTO_VAGA.forEach(c => {
    const valor = converterNumeroDash(linha[c.aliasDetalhe]) * quantidade;
    componentes[c.campo] = valor;
    mensal += valor;
  });

  return {
    cargo: limparValorDash(linha.cargo),
    quantidade,
    meses,
    ...componentes,
    mensal,
    periodo: mensal * meses
  };
}

function montarOpcoesRemanejamentoAPartirDasRows(rows) {
  const mapaDseiOrigem = {};
  const mapaDseiDestino = {};
  const mapaVagasOrigem = {};
  const mapaVagasDestino = {};

  (rows || []).forEach(row => {
    const dsei = limparValorDash(row.dseiCasai);
    const cargo = limparValorDash(row.cargo);

    if (!dsei || !cargo) return;

    const dseiId = normalizarChaveDash(dsei);
    const cargoId = normalizarChaveDash(cargo);
    const parId = `${dseiId}||${cargoId}`;
    const vagasOciosas = calcularOciosasServidor(row);

    if (!mapaDseiDestino[dseiId]) {
      mapaDseiDestino[dseiId] = { id: dseiId, nome: dsei };
    }

    if (!mapaVagasDestino[parId]) {
      mapaVagasDestino[parId] = {
        id: parId,
        dseiId,
        dseiCasai: dsei,
        nome: cargo,
        valor: 0
      };
    }

    if (vagasOciosas <= 0) return;

    if (!mapaDseiOrigem[dseiId]) {
      mapaDseiOrigem[dseiId] = {
        id: dseiId,
        nome: dsei,
        vagasOciosas: 0
      };
    }

    mapaDseiOrigem[dseiId].vagasOciosas += vagasOciosas;

    if (!mapaVagasOrigem[parId]) {
      mapaVagasOrigem[parId] = {
        id: parId,
        dseiId,
        dseiCasai: dsei,
        nome: cargo,
        vagasOciosas: 0,
        valor: 0
      };
    }

    mapaVagasOrigem[parId].vagasOciosas += vagasOciosas;
  });

  return {
    dseis: Object.keys(mapaDseiOrigem)
      .map(key => mapaDseiOrigem[key])
      .filter(item => item.vagasOciosas > 0)
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    dseisDestino: Object.keys(mapaDseiDestino)
      .map(key => mapaDseiDestino[key])
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    vagasOrigem: Object.keys(mapaVagasOrigem)
      .map(key => mapaVagasOrigem[key])
      .filter(item => item.vagasOciosas > 0)
      .sort((a, b) => {
        const d = a.dseiCasai.localeCompare(b.dseiCasai, "pt-BR");
        return d !== 0 ? d : a.nome.localeCompare(b.nome, "pt-BR");
      }),
    vagasDestino: Object.keys(mapaVagasDestino)
      .map(key => mapaVagasDestino[key])
      .sort((a, b) => {
        const d = a.dseiCasai.localeCompare(b.dseiCasai, "pt-BR");
        return d !== 0 ? d : a.nome.localeCompare(b.nome, "pt-BR");
      })
  };
}

function obterUltimaAtualizacaoRemanejamento(rows) {
  const valores = (rows || [])
    .map(row => row.atualizadoEmFormatado || row.atualizadoEm || row.dataCriacaoFormatada || row.dataCriacao)
    .filter(Boolean);

  return valores[0] || "";
}

// ---------------------------------------------------------------------------
// Ajustes pontuais (admin) — processo de remanejamento com TP_AJUSTE = 'S'.
//
// Um ajuste é um PROCESSO_REMANEJAMENTO como qualquer outro (com N movimentações,
// e opcionalmente Nº SEI / observação / anexo), mas SEM as validações de ociosas,
// impacto financeiro ou bloqueio por PSS, e sem exigir os dois lados (só acréscimo
// ou só decréscimo é permitido). É marcado com TP_AJUSTE = 'S' para ir à janela de
// "alterações pontuais"; os normais (TP_AJUSTE = 'N', padrão) vão ao histórico.
// ---------------------------------------------------------------------------

// N_MESES do ajuste. No modo ajuste o painel digita o Nº de Meses e o envia em
// "meses" (1..12) — ele tem prioridade. Sem ele, cai na regra do mês (13 - mês) e,
// sem mês válido, no padrão do mês atual até dezembro.
function mesesAjusteRemanejamento(body) {
  const mesesInformado = Math.floor(Number(body.meses));
  if (mesesInformado >= 1 && mesesInformado <= 12) return mesesInformado;

  const mesEscolhido = Number(body.mes);
  return (mesEscolhido >= 1 && mesEscolhido <= 12)
    ? Math.max(1, 13 - mesEscolhido)
    : mesesAteFimDoAno();
}

async function salvarAjusteRemanejamentoComConn(conn, body, file, escopo) {
  const idDseiCasai = converterNumeroDash(body.idDseiCasai);
  const processoSei = limparValorDash(body.processoSei);
  const observacao = limparValorDash(body.observacao);
  const criadoPor = limparValorDash(body.criadoPor || body.usuario || "painel");

  let linhasReduzido = [];
  let linhasAcrescentado = [];
  try {
    linhasReduzido = JSON.parse(body.linhasReduzido || "[]");
    linhasAcrescentado = JSON.parse(body.linhasAcrescentado || "[]");
  } catch (err) {
    throw new Error("Linhas de ajuste inválidas.");
  }

  linhasReduzido = normalizarLinhasRemanejamentoServidor(linhasReduzido);
  linhasAcrescentado = normalizarLinhasRemanejamentoServidor(linhasAcrescentado);

  if (!idDseiCasai) throw new Error("Selecione o DSEI/CASAI.");
  // Regra única: ao menos uma linha no total. Nº SEI/observação/anexo são
  // OPCIONAIS. Sem exigir os dois lados, sem validar ociosas/impacto/PSS.
  if (!linhasReduzido.length && !linhasAcrescentado.length) {
    throw new Error("Informe ao menos um cargo para acrescentar ou reduzir.");
  }

  // Escopo: admin restrito só ajusta os DSEIs do seu escopo.
  if (!dseiNoEscopo(escopo, idDseiCasai)) throw erroEscopo("Você não pode ajustar um DSEI fora do seu escopo.");

  const meses = mesesAjusteRemanejamento(body);

  await conn.beginTransaction();
  try {
    // 1) Processo marcado como ajuste (TP_AJUSTE = 'S'), com anexo opcional.
    const [procResult] = await conn.execute(
      `INSERT INTO \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.PROCESSO_REMANEJAMENTO_TABLE}\` (
        N_PROCESSO, OBSERVACAO, CRIADO_POR, N_MESES,
        ANEXO_PROCESSO, ANEXO_NOME_ARQUIVO, ANEXO_MIME_TYPE, ANEXO_TAMANHO_BYTES, TP_AJUSTE
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'S')`,
      [
        processoSei || null,
        observacao || null,
        criadoPor || null,
        meses,
        file ? file.buffer : null,
        file ? file.originalname : null,
        file ? file.mimetype : null,
        file ? file.size : null
      ]
    );

    const idProcesso = procResult.insertId;

    // 2) Uma movimentação por cargo, vinculada ao processo do ajuste.
    const inserirMovimentacao = (linha, tipo) => conn.execute(
      `INSERT INTO \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.MOVIMENTACAO_REMANEJAMENTO_TABLE}\` (
        ID_PROCESSO_REMANEJAMENTO, ID_DSEI_CASAI, ID_VAGA, TIPO_MOVIMENTACAO, QTD, CRIADO_POR
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [idProcesso, idDseiCasai, linha.idCargoFuncao, tipo, linha.quantidade, criadoPor || null]
    );

    for (const linha of linhasReduzido) await inserirMovimentacao(linha, "DECRESCIMO");
    for (const linha of linhasAcrescentado) await inserirMovimentacao(linha, "ACRESCIMO");

    await conn.commit();
    return { idProcesso, inseridos: linhasReduzido.length + linhasAcrescentado.length };
  } catch (err) {
    await conn.rollback();
    throw err;
  }
}

// Atualiza um ajuste (processo TP_AJUSTE='S'): substitui as movimentações e os
// dados (Nº SEI/observação/anexo opcionais), SEM validações de ociosas/impacto/PSS.
// Mantém TP_AJUSTE='S' e recusa atualizar um remanejamento normal por esta via.
async function atualizarAjusteRemanejamentoComConn(conn, idProcesso, body, file, escopo) {
  const id = converterNumeroDash(idProcesso);
  if (!id) throw new Error("Ajuste inválido.");

  await garantirEscopoProcessoComConn(conn, id, escopo);

  const [procs] = await conn.query(
    `SELECT TP_AJUSTE FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.PROCESSO_REMANEJAMENTO_TABLE}\`
      WHERE ID_PROCESSO_REMANEJAMENTO = ? LIMIT 1`,
    [id]
  );
  const proc = procs && procs[0] ? procs[0] : null;
  if (!proc) throw new Error("Ajuste não encontrado.");
  if (String(proc.TP_AJUSTE) !== "S") {
    const err = new Error("Este processo é um remanejamento normal e não pode ser editado como ajuste.");
    err.status = 400;
    err.expose = true;
    throw err;
  }

  const idDseiCasai = converterNumeroDash(body.idDseiCasai);
  const processoSei = limparValorDash(body.processoSei);
  const observacao = limparValorDash(body.observacao);
  const criadoPor = limparValorDash(body.criadoPor || body.usuario || "painel");

  let linhasReduzido = [];
  let linhasAcrescentado = [];
  try {
    linhasReduzido = JSON.parse(body.linhasReduzido || "[]");
    linhasAcrescentado = JSON.parse(body.linhasAcrescentado || "[]");
  } catch (err) {
    throw new Error("Linhas de ajuste inválidas.");
  }
  linhasReduzido = normalizarLinhasRemanejamentoServidor(linhasReduzido);
  linhasAcrescentado = normalizarLinhasRemanejamentoServidor(linhasAcrescentado);

  if (!idDseiCasai) throw new Error("Selecione o DSEI/CASAI.");
  if (!linhasReduzido.length && !linhasAcrescentado.length) {
    throw new Error("Informe ao menos um cargo para acrescentar ou reduzir.");
  }
  if (!dseiNoEscopo(escopo, idDseiCasai)) throw erroEscopo("Você não pode ajustar um DSEI fora do seu escopo.");

  const meses = mesesAjusteRemanejamento(body);

  await conn.beginTransaction();
  try {
    await conn.execute(
      `DELETE FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.MOVIMENTACAO_REMANEJAMENTO_TABLE}\`
        WHERE ID_PROCESSO_REMANEJAMENTO = ?`,
      [id]
    );

    const inserirMovimentacao = (linha, tipo) => conn.execute(
      `INSERT INTO \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.MOVIMENTACAO_REMANEJAMENTO_TABLE}\` (
        ID_PROCESSO_REMANEJAMENTO, ID_DSEI_CASAI, ID_VAGA, TIPO_MOVIMENTACAO, QTD, CRIADO_POR
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, idDseiCasai, linha.idCargoFuncao, tipo, linha.quantidade, criadoPor || null]
    );
    for (const linha of linhasReduzido) await inserirMovimentacao(linha, "DECRESCIMO");
    for (const linha of linhasAcrescentado) await inserirMovimentacao(linha, "ACRESCIMO");

    // Anexo só é trocado quando um novo arquivo é enviado. TP_AJUSTE permanece 'S'.
    if (file) {
      await conn.execute(
        `UPDATE \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.PROCESSO_REMANEJAMENTO_TABLE}\`
          SET N_PROCESSO = ?, OBSERVACAO = ?, N_MESES = ?,
              ANEXO_PROCESSO = ?, ANEXO_NOME_ARQUIVO = ?, ANEXO_MIME_TYPE = ?, ANEXO_TAMANHO_BYTES = ?
          WHERE ID_PROCESSO_REMANEJAMENTO = ?`,
        [processoSei || null, observacao || null, meses,
          file.buffer, file.originalname, file.mimetype, file.size, id]
      );
    } else {
      await conn.execute(
        `UPDATE \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.PROCESSO_REMANEJAMENTO_TABLE}\`
          SET N_PROCESSO = ?, OBSERVACAO = ?, N_MESES = ?
          WHERE ID_PROCESSO_REMANEJAMENTO = ?`,
        [processoSei || null, observacao || null, meses, id]
      );
    }

    await conn.commit();
    return { idProcesso: id };
  } catch (err) {
    await conn.rollback();
    throw err;
  }
}

// Ajustes = processos com TP_AJUSTE = 'S'. Reaproveita a MESMA query/mapper do
// histórico (mesma forma de linha), apenas filtrando pelo tipo.
async function getAjustesRemanejamentoData(escopo) {
  const conn = await getMysqlConnection();
  try {
    const rows = filtrarLinhasPorEscopo(
      await executarConsultaComConn(conn, montarSqlRemanejamentoLista("S"), mapRemanejamentoListaRow),
      escopo
    );
    return { rows, atualizadoEm: obterUltimaAtualizacaoRemanejamento(rows) };
  } finally {
    await fecharJdbc(conn);
  }
}

// Exclui um ajuste (processo TP_AJUSTE = 'S') e suas movimentações. Recusa excluir
// um remanejamento normal por esta via.
async function excluirAjusteRemanejamentoComConn(conn, idProcesso, escopo) {
  const id = converterNumeroDash(idProcesso);
  if (!id) throw new Error("Ajuste inválido.");

  await garantirEscopoProcessoComConn(conn, id, escopo); // escopo pelo DSEI do processo

  const [rows] = await conn.query(
    `SELECT TP_AJUSTE FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.PROCESSO_REMANEJAMENTO_TABLE}\`
      WHERE ID_PROCESSO_REMANEJAMENTO = ? LIMIT 1`,
    [id]
  );
  const proc = rows && rows[0] ? rows[0] : null;
  if (!proc) throw new Error("Ajuste não encontrado.");
  if (String(proc.TP_AJUSTE) !== "S") {
    const err = new Error("Este processo é um remanejamento normal e não pode ser excluído como ajuste.");
    err.status = 400;
    err.expose = true;
    throw err;
  }

  await conn.beginTransaction();
  try {
    await conn.execute(
      `DELETE FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.MOVIMENTACAO_REMANEJAMENTO_TABLE}\`
        WHERE ID_PROCESSO_REMANEJAMENTO = ?`,
      [id]
    );
    await conn.execute(
      `DELETE FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.PROCESSO_REMANEJAMENTO_TABLE}\`
        WHERE ID_PROCESSO_REMANEJAMENTO = ?`,
      [id]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  }
}

module.exports = { getRemanejamentoListaData, getRemanejamentoCadastroData, getRemanejamentoDetalheData, getRemanejamentoEdicaoData, salvarRemanejamentoComConn, atualizarRemanejamentoComConn, excluirRemanejamentoComConn, garantirEscopoProcessoComConn, garantirTabelaMovimentacaoRemanejamento, garantirColunaMesesRemanejamento, garantirColunaAjusteRemanejamento, garantirColunaTpAjusteRemanejamento, garantirColunasCustoGeralVaga, salvarAjusteRemanejamentoComConn, atualizarAjusteRemanejamentoComConn, getAjustesRemanejamentoData, excluirAjusteRemanejamentoComConn, obterRemanejamentoListaComCache, obterRemanejamentoCadastroComCache, montarOpcoesRemanejamentoAPartirDasRows, obterUltimaAtualizacaoRemanejamento, normalizarLinhasRemanejamentoServidor, calcularResumoLinhasServidor, mapearCargoParaPrevistas };
