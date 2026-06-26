// Domínio: remanejamento de vagas (regras, cálculos e persistência).
const { DASH_CONFIG } = require("./config");
const { DASH_SQL, montarCaseCargoSql } = require("./sql");
const { getMysqlConnection, fecharJdbc, obterOuCarregarJsonCache, executarConsultaComConn, limparCacheDashboard } = require("./db");
const { limparValorDash, converterNumeroDash, normalizarChaveDash, formatarDataBancoDash, extrairCompetenciaDash, nomeMesDash, obterUltimaAtualizacaoDash, somaServidor, mesesAteFimDoAno, calcularOciosasServidor } = require("./utils");

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

// Garante a coluna N_MESES em PROCESSO_REMANEJAMENTO (meses do remanejamento até
// dezembro, escolhido na criação). Registros antigos ficam NULL e usam o cálculo
// derivado da data de inserção como fallback.
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

async function getRemanejamentoListaData() {
  const rows = await obterRemanejamentoListaComCache();

  return {
    rows,
    atualizadoEm: obterUltimaAtualizacaoRemanejamento(rows)
  };
}

async function getRemanejamentoCadastroData() {
  const rows = await obterRemanejamentoCadastroComCache();

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
  return executarConsultaComConn(conn, DASH_SQL.REMANEJAMENTO_LISTA, mapRemanejamentoListaRow);
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
  const salarioBase = converterNumeroDash(row.salario_base);
  const insalubridadePericulosidade = converterNumeroDash(row.insalubridade_periculosidade);
  const gratificacaoRt = converterNumeroDash(row.gratificacao_rt);
  const adicionalNoturno = converterNumeroDash(row.adicional_noturno);
  const encargos = converterNumeroDash(row.encargos);
  const provisoes = converterNumeroDash(row.provisoes);
  const valeAlimentacao = converterNumeroDash(row.vale_alimentacao);
  const valorMensal = converterNumeroDash(row.valor_mensal)
    || salarioBase + insalubridadePericulosidade + gratificacaoRt + adicionalNoturno + encargos + provisoes + valeAlimentacao;

  return {
    idDseiCasai: converterNumeroDash(row.id_dsei_casai),
    dseiCasai: limparValorDash(row.dsei_casai),
    idCargoFuncao: converterNumeroDash(row.id_cargo_funcao),
    cargo: limparValorDash(row.cargo),
    quantitativoPlano: converterNumeroDash(row.quantitativo_plano_trabalho),
    cargaHoraria: limparValorDash(row.carga_horaria),
    salarioBase,
    insalubridadePericulosidade,
    gratificacaoRt,
    adicionalNoturno,
    encargos,
    provisoes,
    valeAlimentacao,
    valorMensal,
    vagasOciosas: converterNumeroDash(row.vagas_ociosas)
  };
}

async function salvarRemanejamentoComConn(conn, body, file) {
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

  // N_MESES: do mês escolhido (1..12) até o fim do ano (dezembro). Sem mês válido,
  // mantém o padrão (do mês atual até dezembro).
  const mesEscolhido = Number(body.mes);
  const meses = (mesEscolhido >= 1 && mesEscolhido <= 12)
    ? Math.max(1, 13 - mesEscolhido)
    : mesesAteFimDoAno();

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
       c.SALARIO_BASE,
       c.INSALUBRIDADE_PERICULOSIDADE,
       c.GRATIFICACAO_RT,
       c.NOTURNO,
       c.ENCARGOS,
       c.PROVISOES,
       c.VALE_ALIMENTACAO
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
    const mensal =
      converterNumeroDash(row.SALARIO_BASE) +
      converterNumeroDash(row.INSALUBRIDADE_PERICULOSIDADE) +
      converterNumeroDash(row.GRATIFICACAO_RT) +
      converterNumeroDash(row.NOTURNO) +
      converterNumeroDash(row.ENCARGOS) +
      converterNumeroDash(row.PROVISOES) +
      converterNumeroDash(row.VALE_ALIMENTACAO);
    mapa[String(converterNumeroDash(row.ID_VAGA))] = mensal;
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

async function excluirRemanejamentoComConn(conn, idProcesso) {
  const id = converterNumeroDash(idProcesso);
  if (!id) throw new Error("Remanejamento inválido.");

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
      SELECT c.ID_DSEI_CASAI, c.ID_VAGA, c.SALARIO_BASE, c.INSALUBRIDADE_PERICULOSIDADE,
             c.GRATIFICACAO_RT, c.NOTURNO, c.ENCARGOS, c.PROVISOES, c.VALE_ALIMENTACAO
      FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.CUSTO_GERAL_VAGA_TABLE}\` c
      JOIN (
        SELECT ID_DSEI_CASAI, ID_VAGA, MAX(ID_CUSTO_GERAL_VAGA) AS max_id
        FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.CUSTO_GERAL_VAGA_TABLE}\`
        GROUP BY ID_DSEI_CASAI, ID_VAGA
      ) ult ON ult.max_id = c.ID_CUSTO_GERAL_VAGA
    )
    SELECT
      COALESCE(p.N_MESES, 13 - MONTH(p.DATA_INSERCAO)) AS n_meses,
      ${montarCaseCargoSql("m.ID_VAGA", "cd")} AS cargo,
      m.QTD AS qtd,
      COALESCE(cu.SALARIO_BASE, 0) AS salario,
      COALESCE(cu.INSALUBRIDADE_PERICULOSIDADE, 0) AS insal,
      COALESCE(cu.GRATIFICACAO_RT, 0) AS grat,
      COALESCE(cu.NOTURNO, 0) AS noturno,
      COALESCE(cu.ENCARGOS, 0) AS encargos,
      COALESCE(cu.PROVISOES, 0) AS provisoes,
      COALESCE(cu.VALE_ALIMENTACAO, 0) AS vale
    FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.MOVIMENTACAO_REMANEJAMENTO_TABLE}\` m
    JOIN \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.PROCESSO_REMANEJAMENTO_TABLE}\` p
      ON p.ID_PROCESSO_REMANEJAMENTO = m.ID_PROCESSO_REMANEJAMENTO
    LEFT JOIN cargo_dim cd ON cd.id_cargo_funcao = m.ID_VAGA
    LEFT JOIN custo_dim cu ON cu.ID_DSEI_CASAI = m.ID_DSEI_CASAI AND cu.ID_VAGA = m.ID_VAGA
    WHERE m.ID_PROCESSO_REMANEJAMENTO = ? AND m.TIPO_MOVIMENTACAO = ?
  `;
}

// Dados crus (com IDs) para repopular o formulário ao EDITAR um remanejamento.
async function getRemanejamentoEdicaoData(idProcesso) {
  const id = converterNumeroDash(idProcesso);
  if (!id) throw new Error("Remanejamento inválido.");

  const conn = await getMysqlConnection();
  try {
    const [movs] = await conn.query(
      `SELECT ID_DSEI_CASAI AS id_dsei_casai, ID_VAGA AS id_cargo_funcao,
              TIPO_MOVIMENTACAO AS tipo, QTD AS qtd
       FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.MOVIMENTACAO_REMANEJAMENTO_TABLE}\`
       WHERE ID_PROCESSO_REMANEJAMENTO = ?`,
      [id]
    );
    const [procs] = await conn.query(
      `SELECT N_PROCESSO, OBSERVACAO, N_MESES, ANEXO_NOME_ARQUIVO
       FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.PROCESSO_REMANEJAMENTO_TABLE}\`
       WHERE ID_PROCESSO_REMANEJAMENTO = ? LIMIT 1`,
      [id]
    );

    const proc = procs[0] || {};
    const idDseiCasai = movs.length ? movs[0].id_dsei_casai : null;
    const nMeses = Number(proc.N_MESES);
    // meses = 13 - mes  ->  mes = 13 - meses. Sem N_MESES, usa o mês atual.
    const mes = (nMeses >= 1 && nMeses <= 12)
      ? Math.min(12, Math.max(1, 13 - nMeses))
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
async function atualizarRemanejamentoComConn(conn, idProcesso, body, file) {
  const id = converterNumeroDash(idProcesso);
  if (!id) throw new Error("Remanejamento inválido.");

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

  const mesEscolhido = Number(body.mes);
  const meses = (mesEscolhido >= 1 && mesEscolhido <= 12)
    ? Math.max(1, 13 - mesEscolhido)
    : mesesAteFimDoAno();

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

async function getRemanejamentoDetalheData(idProcesso) {
  const id = converterNumeroDash(idProcesso);
  if (!id) throw new Error("Remanejamento inválido.");

  const sqlDetalhe = montarSqlDetalheMovimentacao();

  const conn = await getMysqlConnection();
  try {
    const [linhasRed] = await conn.query(sqlDetalhe, [id, "DECRESCIMO"]);
    const [linhasAcr] = await conn.query(sqlDetalhe, [id, "ACRESCIMO"]);

    const meses = Math.max(1, Number((linhasRed[0] || linhasAcr[0] || {}).n_meses || mesesAteFimDoAno()));

    const reduzidos = (linhasRed || []).map(l => montarItemDetalheRemanejamento(l, meses));
    const acrescentados = (linhasAcr || []).map(l => montarItemDetalheRemanejamento(l, meses));

    const totalReduzidoMensal = reduzidos.reduce((s, i) => s + i.mensal, 0);
    const totalAcrescentadoMensal = acrescentados.reduce((s, i) => s + i.mensal, 0);

    return {
      idProcesso: id,
      meses,
      reduzidos,
      acrescentados,
      totalReduzidoMensal,
      totalAcrescentadoMensal,
      totalReduzidoPeriodo: totalReduzidoMensal * meses,
      totalAcrescentadoPeriodo: totalAcrescentadoMensal * meses,
      impactoMensal: totalAcrescentadoMensal - totalReduzidoMensal,
      impactoPeriodo: (totalAcrescentadoMensal - totalReduzidoMensal) * meses
    };
  } finally {
    await fecharJdbc(conn);
  }
}

function montarItemDetalheRemanejamento(linha, meses) {
  const quantidade = converterNumeroDash(linha.qtd);
  const salario = converterNumeroDash(linha.salario) * quantidade;
  const insalubridade = converterNumeroDash(linha.insal) * quantidade;
  const gratificacaoRt = converterNumeroDash(linha.grat) * quantidade;
  const noturno = converterNumeroDash(linha.noturno) * quantidade;
  const encargos = converterNumeroDash(linha.encargos) * quantidade;
  const provisoes = converterNumeroDash(linha.provisoes) * quantidade;
  const valeAlimentacao = converterNumeroDash(linha.vale) * quantidade;
  const mensal = salario + insalubridade + gratificacaoRt + noturno + encargos + provisoes + valeAlimentacao;

  return {
    cargo: limparValorDash(linha.cargo),
    quantidade,
    meses,
    salario,
    insalubridade,
    gratificacaoRt,
    noturno,
    encargos,
    provisoes,
    valeAlimentacao,
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

module.exports = { getRemanejamentoListaData, getRemanejamentoCadastroData, getRemanejamentoDetalheData, getRemanejamentoEdicaoData, salvarRemanejamentoComConn, atualizarRemanejamentoComConn, excluirRemanejamentoComConn, garantirTabelaMovimentacaoRemanejamento, garantirColunaMesesRemanejamento, obterRemanejamentoListaComCache, obterRemanejamentoCadastroComCache, montarOpcoesRemanejamentoAPartirDasRows, obterUltimaAtualizacaoRemanejamento, normalizarLinhasRemanejamentoServidor, calcularResumoLinhasServidor, mapearCargoParaPrevistas };
