// =========================================================
// Gerador de public/js/processos-seletivos-dados.js
// Lê o CSV oficial dos editais (mock/AgSUS_Monitora_*.csv) e
// regenera o módulo JS consumido pela aba "Processos Seletivos".
//
// Uso:
//   node scripts/gerar-processos-seletivos.js
//   node scripts/gerar-processos-seletivos.js caminho/para/outro.csv
//
// O CSV usa ";" como separador e aspas duplas opcionais por campo.
// As colunas esperadas (na ordem do cabeçalho) são:
//   Unidade; UF; Edital; Processo SEI; Ciclo; Vagas Previstas;
//   Contratados; Vagas Ociosas; Inscritos; Status; Etapa; Risco;
//   Data de Início; Data de Encerramento; Responsável; Observações;
//   Link do Edital
// =========================================================
const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..");
const CSV_PADRAO = path.join(RAIZ, "mock", "AgSUS_Monitora_SaudeIndigena_20260618.csv");
const SAIDA = path.join(RAIZ, "public", "js", "processos-seletivos-dados.js");

const csvPath = process.argv[2] ? path.resolve(process.argv[2]) : CSV_PADRAO;

// ---- Parser de CSV (delimitador ";", aspas duplas, aspas escapadas "") ----
function parseCsv(texto, delim = ";") {
  const linhas = [];
  let campo = "";
  let linha = [];
  let dentroAspas = false;

  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i];
    if (dentroAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i += 1; }
        else dentroAspas = false;
      } else {
        campo += c;
      }
    } else if (c === '"') {
      dentroAspas = true;
    } else if (c === delim) {
      linha.push(campo); campo = "";
    } else if (c === "\n") {
      linha.push(campo); linhas.push(linha); linha = []; campo = "";
    } else if (c === "\r") {
      // ignora (CRLF)
    } else {
      campo += c;
    }
  }
  // último campo/linha (sem newline final)
  if (campo !== "" || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

const limpar = v => String(v ?? "").trim();
const num = v => {
  const n = parseInt(String(v ?? "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
};

// "DD/MM/AAAA" -> "AAAA-MM-DD"; mantém ISO; vazio -> "".
function paraIso(v) {
  const s = limpar(v);
  if (!s) return "";
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return s;
}

// ---- Leitura e mapeamento ----
const texto = fs.readFileSync(csvPath, "utf8").replace(/^﻿/, "");
const linhas = parseCsv(texto).filter(l => l.some(c => limpar(c) !== ""));
const [, ...corpo] = linhas; // descarta o cabeçalho

const registros = corpo.map((cols, idx) => {
  const vagasPrevistas = num(cols[5]);
  const contratados = num(cols[6]);
  const ociosasCsv = limpar(cols[7]);
  return {
    id: `ps-${idx + 1}`,
    unidade: limpar(cols[0]),
    uf: limpar(cols[1]),
    edital: limpar(cols[2]),
    processoSei: limpar(cols[3]),
    ciclo: limpar(cols[4]),
    vagasPrevistas,
    contratados,
    vagasOciosas: ociosasCsv !== "" ? num(cols[7]) : Math.max(0, vagasPrevistas - contratados),
    inscritos: num(cols[8]),
    status: limpar(cols[9]),
    etapa: limpar(cols[10]),
    risco: limpar(cols[11]),
    dataInicio: paraIso(cols[12]),
    dataEncerramento: paraIso(cols[13]),
    responsavel: limpar(cols[14]),
    observacoes: limpar(cols[15]),
    linkEdital: limpar(cols[16])
  };
});

const cabecalho =
  `// Gerado a partir de mock/${path.basename(csvPath)}\n` +
  `// Dados reais dos editais de Processo Seletivo Simplificado (PSS) da Saude Indigena.\n` +
  `// Para atualizar: rode \`node scripts/gerar-processos-seletivos.js\` (nao editar a mao).\n`;

const conteudo =
  `${cabecalho}export const PROCESSOS_SELETIVOS_DADOS = ${JSON.stringify(registros, null, 2)};\n`;

fs.writeFileSync(SAIDA, conteudo, "utf8");
console.log(`OK: ${registros.length} edital(is) gravado(s) em ${path.relative(RAIZ, SAIDA)}`);
