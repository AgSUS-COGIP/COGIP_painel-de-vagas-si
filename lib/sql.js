// SQL central (monitoramento e remanejamento). Usa nomes de schema/tabela da config.
const { DASH_CONFIG } = require("./config");

function montarCaseCargoSql(coluna, cargoDimAlias) {
  return `COALESCE(
    CASE ${coluna}
      WHEN 9999 THEN 'ANALISTA TECNICO'
      WHEN 9998 THEN 'ASSESSOR REGIONAL INDIGENA'
      WHEN 9997 THEN 'AUXILIAR SI'
      WHEN 9996 THEN 'ENFERMEIRO (ART)'
      WHEN 9995 THEN 'FARMACEUTICO (ART)'
      WHEN 9994 THEN 'ANALISTA SI'
      WHEN 104 THEN 'ANALISTA ADMINISTRATIVO'
      WHEN 81 THEN 'MEDICO ESPECIALIDADES'
      WHEN 45 THEN 'ASSISTENTE ADMINISTRATIVO'
      WHEN 46 THEN 'ASSISTENTE DE COMUNICACAO'
      WHEN 50 THEN 'AUXILIAR DE PROTESE DENTARIA'
      WHEN 54 THEN 'BIOQUIMICO'
      ELSE NULL
    END,
    ${cargoDimAlias}.cargo,
    CONCAT('CARGO ID ', ${coluna})
  )`;
}

const DASH_SQL = {
  MONITORAMENTO: `
    SELECT
      \`dsei_casai\`,
      \`cargo\`,
      \`quantitativo_plano_trabalho\`,
      \`total_contratados_geral\`,
      \`contratados_substituicao\`,
      \`contratados_temporario\`,
      \`contratados_normal\`,
      \`afastados\`,
      \`trabalhadores_situacao_normal\`,
      \`vagas_ociosas\`,
      \`alerta_afastamento_sem_substituto\`,
      \`qtd_afastamento_sem_substituto\`,
      \`alerta_temporario_ativo\`,
      \`qtd_temporario_ativo\`,
      \`alerta_vagas_excedentes\`,
      \`qtd_vagas_excedentes\`,
      \`alerta_vagas_art_excedentes\`,
      \`qtd_vagas_art_excedentes\`,
      \`contratados_indigenas\`
    FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.MONITORAMENTO_VIEW}\`
    ORDER BY \`dsei_casai\`, \`cargo\`
  `,
  MONITORAMENTO_TOTAIS: `
    SELECT
      SUM(\`total_contratados_geral\`) AS \`total_contratados_geral\`
    FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.MONITORAMENTO_VIEW}\`
  `,
  REMANEJAMENTO_LISTA: `
    WITH
    dsei_dim AS (
      SELECT
        UNIDADE_ORCAMENTARIA_ID AS id_dsei_casai,
        MAX(UNIDADE_ORCAMENTARIA_DESC) AS dsei_casai
      FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`VW_SAUDE_INDIGENA\`
      GROUP BY UNIDADE_ORCAMENTARIA_ID
    ),
    cargo_dim AS (
      SELECT
        CAST(CARGO_ATUAL_ID AS UNSIGNED) AS id_cargo_funcao,
        MAX(CARGO_ATUAL_DESC) AS cargo
      FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`VW_SAUDE_INDIGENA\`
      GROUP BY CAST(CARGO_ATUAL_ID AS UNSIGNED)
    ),
    custo_dim AS (
      SELECT
        c.ID_DSEI_CASAI,
        c.ID_VAGA,
        (COALESCE(c.SALARIO_BASE,0) + COALESCE(c.INSALUBRIDADE_PERICULOSIDADE,0) + COALESCE(c.GRATIFICACAO_RT,0)
          + COALESCE(c.NOTURNO,0) + COALESCE(c.ENCARGOS,0) + COALESCE(c.PROVISOES,0)) AS mensal_unitario
      FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.CUSTO_GERAL_VAGA_TABLE}\` c
      JOIN (
        SELECT ID_DSEI_CASAI, ID_VAGA, MAX(ID_CUSTO_GERAL_VAGA) AS max_id
        FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.CUSTO_GERAL_VAGA_TABLE}\`
        GROUP BY ID_DSEI_CASAI, ID_VAGA
      ) ult ON ult.max_id = c.ID_CUSTO_GERAL_VAGA
    ),
    -- Movimentações de decréscimo (vagas reduzidas) agregadas por processo.
    red AS (
      SELECT
        m.ID_PROCESSO_REMANEJAMENTO AS id_processo,
        MAX(m.ID_DSEI_CASAI) AS id_dsei_casai,
        SUM(COALESCE(custo.mensal_unitario, 0) * m.QTD) AS total_mensal,
        GROUP_CONCAT(CONCAT(${montarCaseCargoSql("m.ID_VAGA", "cd")}, ' x', m.QTD) ORDER BY cd.cargo SEPARATOR ' | ') AS cargos
      FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.MOVIMENTACAO_REMANEJAMENTO_TABLE}\` m
      LEFT JOIN cargo_dim cd ON cd.id_cargo_funcao = m.ID_VAGA
      LEFT JOIN custo_dim custo ON custo.ID_DSEI_CASAI = m.ID_DSEI_CASAI AND custo.ID_VAGA = m.ID_VAGA
      WHERE m.TIPO_MOVIMENTACAO = 'DECRESCIMO'
      GROUP BY m.ID_PROCESSO_REMANEJAMENTO
    ),
    -- Movimentações de acréscimo (vagas acrescidas) agregadas por processo.
    acr AS (
      SELECT
        m.ID_PROCESSO_REMANEJAMENTO AS id_processo,
        MAX(m.ID_DSEI_CASAI) AS id_dsei_casai,
        SUM(COALESCE(custo.mensal_unitario, 0) * m.QTD) AS total_mensal,
        GROUP_CONCAT(CONCAT(${montarCaseCargoSql("m.ID_VAGA", "cd")}, ' x', m.QTD) ORDER BY cd.cargo SEPARATOR ' | ') AS cargos
      FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.MOVIMENTACAO_REMANEJAMENTO_TABLE}\` m
      LEFT JOIN cargo_dim cd ON cd.id_cargo_funcao = m.ID_VAGA
      LEFT JOIN custo_dim custo ON custo.ID_DSEI_CASAI = m.ID_DSEI_CASAI AND custo.ID_VAGA = m.ID_VAGA
      WHERE m.TIPO_MOVIMENTACAO = 'ACRESCIMO'
      GROUP BY m.ID_PROCESSO_REMANEJAMENTO
    )
    SELECT
      p.ID_PROCESSO_REMANEJAMENTO AS id_processo,
      p.DATA_INSERCAO AS data_inclusao,
      DATE_FORMAT(p.DATA_INSERCAO, '%d/%m/%Y %H:%i:%s') AS data_inclusao_formatada,
      DATE_FORMAT(p.DATA_INSERCAO, '%m/%Y') AS competencia,
      p.N_PROCESSO AS numero_processo_sei,
      p.OBSERVACAO AS observacao,
      p.CRIADO_POR AS criado_por,
      p.ANEXO_NOME_ARQUIVO AS anexo_nome_arquivo,
      p.ANEXO_MIME_TYPE AS anexo_mime_type,
      p.ANEXO_TAMANHO_BYTES AS anexo_tamanho_bytes,
      CASE WHEN p.ANEXO_PROCESSO IS NULL THEN 0 ELSE 1 END AS tem_anexo,
      COALESCE(red.id_dsei_casai, acr.id_dsei_casai) AS id_dsei_casai,
      CASE WHEN COALESCE(red.id_dsei_casai, acr.id_dsei_casai) = 9610501 THEN 'SAMU INDÍGENA'
           ELSE COALESCE(dd.dsei_casai, CONCAT('DSEI/CASAI ID ', COALESCE(red.id_dsei_casai, acr.id_dsei_casai))) END AS dsei_casai,
      red.cargos AS cargos_reduzidos,
      acr.cargos AS cargos_acrescentados,
      COALESCE(red.total_mensal, 0) AS total_reduzido_mensal,
      COALESCE(acr.total_mensal, 0) AS total_acrescentado_mensal,
      (COALESCE(acr.total_mensal, 0) - COALESCE(red.total_mensal, 0)) AS impacto_mensal,
      (COALESCE(red.total_mensal, 0) * COALESCE(p.N_MESES, 13 - MONTH(p.DATA_INSERCAO))) AS total_reduzido_periodo,
      (COALESCE(acr.total_mensal, 0) * COALESCE(p.N_MESES, 13 - MONTH(p.DATA_INSERCAO))) AS total_acrescentado_periodo,
      ((COALESCE(acr.total_mensal, 0) - COALESCE(red.total_mensal, 0)) * COALESCE(p.N_MESES, 13 - MONTH(p.DATA_INSERCAO))) AS impacto_periodo,
      'Registrado' AS situacao
    FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.PROCESSO_REMANEJAMENTO_TABLE}\` p
    LEFT JOIN red ON red.id_processo = p.ID_PROCESSO_REMANEJAMENTO
    LEFT JOIN acr ON acr.id_processo = p.ID_PROCESSO_REMANEJAMENTO
    LEFT JOIN dsei_dim dd ON dd.id_dsei_casai = COALESCE(red.id_dsei_casai, acr.id_dsei_casai)
    ORDER BY p.DATA_INSERCAO DESC
  `,
  REMANEJAMENTO_CADASTRO: `
    WITH
    dsei_dim AS (
      SELECT
        UNIDADE_ORCAMENTARIA_ID AS id_dsei_casai,
        MAX(UNIDADE_ORCAMENTARIA_DESC) AS dsei_casai
      FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`VW_SAUDE_INDIGENA\`
      GROUP BY UNIDADE_ORCAMENTARIA_ID
    ),
    cargo_dim AS (
      SELECT
        CAST(CARGO_ATUAL_ID AS UNSIGNED) AS id_cargo_funcao,
        MAX(CARGO_ATUAL_DESC) AS cargo
      FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`VW_SAUDE_INDIGENA\`
      GROUP BY CAST(CARGO_ATUAL_ID AS UNSIGNED)
    ),
    custo_dim AS (
      SELECT
        c.ID_DSEI_CASAI,
        c.ID_VAGA,
        c.SALARIO_BASE,
        c.INSALUBRIDADE_PERICULOSIDADE,
        c.GRATIFICACAO_RT,
        c.NOTURNO,
        c.ENCARGOS,
        c.PROVISOES
      FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.CUSTO_GERAL_VAGA_TABLE}\` c
      JOIN (
        SELECT ID_DSEI_CASAI, ID_VAGA, MAX(ID_CUSTO_GERAL_VAGA) AS max_id
        FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.CUSTO_GERAL_VAGA_TABLE}\`
        GROUP BY ID_DSEI_CASAI, ID_VAGA
      ) ult ON ult.max_id = c.ID_CUSTO_GERAL_VAGA
    )
    SELECT
      vp.id_dsei_casai,
      CASE WHEN vp.id_dsei_casai = 9610501 THEN 'SAMU INDÍGENA'
           ELSE COALESCE(dd.dsei_casai, CONCAT('DSEI/CASAI ID ', vp.id_dsei_casai)) END AS dsei_casai,
      vp.id_cargo_funcao,
      COALESCE(
        CASE vp.id_cargo_funcao
          WHEN 9999 THEN 'ANALISTA TECNICO'
          WHEN 9998 THEN 'ASSESSOR REGIONAL INDIGENA'
          WHEN 9997 THEN 'AUXILIAR SI'
          WHEN 9996 THEN 'ENFERMEIRO (ART)'
          WHEN 9995 THEN 'FARMACEUTICO (ART)'
          WHEN 9994 THEN 'ANALISTA SI'
          WHEN 104 THEN 'ANALISTA ADMINISTRATIVO'
          WHEN 81 THEN 'MEDICO ESPECIALIDADES'
          WHEN 45 THEN 'ASSISTENTE ADMINISTRATIVO'
          WHEN 46 THEN 'ASSISTENTE DE COMUNICACAO'
          WHEN 50 THEN 'AUXILIAR DE PROTESE DENTARIA'
          WHEN 54 THEN 'BIOQUIMICO'
          ELSE NULL
        END,
        cd.cargo,
        CONCAT('CARGO ID ', vp.id_cargo_funcao)
      ) AS cargo,
      COALESCE(vp.QTD, 0) AS quantitativo_plano_trabalho,
      COALESCE(vp.CARGA_HORARIA, '') AS carga_horaria,
      COALESCE(cgv.SALARIO_BASE, 0) AS salario_base,
      COALESCE(cgv.INSALUBRIDADE_PERICULOSIDADE, 0) AS insalubridade_periculosidade,
      COALESCE(cgv.GRATIFICACAO_RT, 0) AS gratificacao_rt,
      COALESCE(cgv.NOTURNO, 0) AS adicional_noturno,
      COALESCE(cgv.ENCARGOS, 0) AS encargos,
      COALESCE(cgv.PROVISOES, 0) AS provisoes,
      (
        COALESCE(cgv.SALARIO_BASE, 0) +
        COALESCE(cgv.INSALUBRIDADE_PERICULOSIDADE, 0) +
        COALESCE(cgv.GRATIFICACAO_RT, 0) +
        COALESCE(cgv.NOTURNO, 0) +
        COALESCE(cgv.ENCARGOS, 0) +
        COALESCE(cgv.PROVISOES, 0)
      ) AS valor_mensal,
      COALESCE(oci.vagas_ociosas, 0) AS vagas_ociosas
    FROM \`${DASH_CONFIG.DB_SCHEMA}\`.\`VAGAS_PREVISTAS\` vp
    LEFT JOIN dsei_dim dd
      ON dd.id_dsei_casai = vp.id_dsei_casai
    LEFT JOIN cargo_dim cd
      ON cd.id_cargo_funcao = vp.id_cargo_funcao
    LEFT JOIN custo_dim cgv
      ON cgv.ID_DSEI_CASAI = vp.id_dsei_casai AND cgv.ID_VAGA = vp.id_cargo_funcao
    LEFT JOIN \`${DASH_CONFIG.DB_SCHEMA}\`.\`${DASH_CONFIG.MONITORAMENTO_VIEW}\` oci
      ON oci.id_dsei_casai = vp.id_dsei_casai
     AND oci.id_cargo_funcao = (
       CASE
         WHEN vp.id_cargo_funcao IN (28, 29, 30, 104) THEN 104
         WHEN vp.id_cargo_funcao IN (77, 78, 79, 80, 81) THEN 81
         WHEN vp.id_cargo_funcao IN (102, 45) THEN 45
         ELSE vp.id_cargo_funcao
       END
     )
    ORDER BY dsei_casai, cargo
  `
};

module.exports = { DASH_SQL, montarCaseCargoSql };
