-- OPCIONAL — Limpeza das colunas de identidade da tabela de controle de crachás.
--
-- Desde a adoção do roster do trabalhador consolidado (VW_SAUDE_INDIGENA), a
-- identidade (nome, cargo, DSEI, situação, admissão, motivo) NÃO é mais lida
-- nem gravada em UGP_CRACHAS_CONTROLE_MANUAL — vem sempre do consolidado, por
-- matrícula. Estas colunas ficaram legadas e podem ser removidas quando a
-- migração estiver validada em produção. O app funciona com ou sem elas.
--
-- ATENÇÃO: rode primeiro o backup opcional abaixo se quiser preservar os dados.

-- (Opcional) Backup das colunas antes de remover:
-- CREATE TABLE `u226895969_ugp`.`BK_CRACHA_IDENTIDADE_20260727` AS
--   SELECT `MATRICULA`, `NOME`, `CARGO`, `DSEI`, `SITUACAO_DETALHADA`,
--          `DATA_ADMISSAO`, `MOTIVO_NAO_CRACHA`
--     FROM `u226895969_ugp`.`UGP_CRACHAS_CONTROLE_MANUAL`;

-- Linhas de controle órfãs (matrícula fora do consolidado) — não aparecem mais
-- na aba; liste antes de decidir o que fazer com elas:
-- SELECT c.`MATRICULA`
--   FROM `u226895969_ugp`.`UGP_CRACHAS_CONTROLE_MANUAL` c
--  WHERE NOT EXISTS (SELECT 1 FROM `u226895969_ugp`.`VW_SAUDE_INDIGENA` v
--                     WHERE v.`MATRICULA` = c.`MATRICULA`);

-- Remoção das colunas legadas (MySQL 8+: IF EXISTS é suportado no ALTER):
-- Obs.: NÃO remova MOTIVO_NAO_CRACHA — ela ainda é lida (campo "Motivo").
ALTER TABLE `u226895969_ugp`.`UGP_CRACHAS_CONTROLE_MANUAL`
  DROP COLUMN IF EXISTS `NOME`,
  DROP COLUMN IF EXISTS `CARGO`,
  DROP COLUMN IF EXISTS `DSEI`,
  DROP COLUMN IF EXISTS `SITUACAO_DETALHADA`,
  DROP COLUMN IF EXISTS `DATA_ADMISSAO`;
