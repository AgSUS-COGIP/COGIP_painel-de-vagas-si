// Pré-processa a base territorial indígena (planilha exportada para JSON) num
// arquivo estático enxuto, seguindo a mesma lógica do mock/rede_cnes.json: o
// trabalho pesado roda AQUI (uma vez, na máquina do dev), não no navegador.
//
// A fonte é granular (uma linha por domicílio/registro, repetindo a aldeia
// dezenas de vezes) e tem só 4 colunas: DSEI, TERRA_INDIGENA, ALDEIA e
// POPULACAO_INDIGENA. Aqui agregamos DSEI → Terra Indígena → Aldeia, somando a
// população, e emitimos ~34 registros (um por DSEI) com o detalhe por aldeia
// preservado. Resultado: de ~15 MB para poucas centenas de KB.
//
// Uso:
//   node scripts/gerar-dados-indigenas.js "C:\\caminho\\dados_indigenas.json"
//   node scripts/gerar-dados-indigenas.js "<origem>" mock/dados_indigenas.json
const fs = require("fs");
const path = require("path");

const origem = process.argv[2];
const destino = process.argv[3] || path.join(__dirname, "..", "mock", "dados_indigenas.json");

if (!origem) {
  console.error("Uso: node scripts/gerar-dados-indigenas.js <arquivo-origem.json> [destino.json]");
  process.exit(1);
}

// Colapsa espaços e apara as pontas, preservando o texto original (acentos/caixa).
const limpar = v => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

function main() {
  console.log(`[territorial] lendo ${origem} …`);
  const bruto = JSON.parse(fs.readFileSync(origem, "utf8"));
  if (!Array.isArray(bruto)) throw new Error("A origem não é um array JSON.");
  console.log(`[territorial] ${bruto.length.toLocaleString("pt-BR")} linhas na origem.`);

  // DSEI -> { terras: Map(terra -> Map(aldeia -> populacao)) }
  const porDsei = new Map();

  for (const linha of bruto) {
    const dsei = limpar(linha.DSEI);
    if (!dsei) continue;
    const terra = limpar(linha.TERRA_INDIGENA) || "Não informado";
    const aldeia = limpar(linha.ALDEIA) || "Não informado";
    const pop = Number(linha.POPULACAO_INDIGENA) || 0;

    if (!porDsei.has(dsei)) porDsei.set(dsei, new Map());
    const terras = porDsei.get(dsei);
    if (!terras.has(terra)) terras.set(terra, new Map());
    const aldeias = terras.get(terra);
    aldeias.set(aldeia, (aldeias.get(aldeia) || 0) + pop);
  }

  const saida = [...porDsei.entries()].map(([dsei, terras]) => {
    let populacaoIndigena = 0;
    let qtdAldeias = 0;
    const listaTerras = [...terras.entries()].map(([nome, aldeias]) => {
      const listaAldeias = [...aldeias.entries()]
        .map(([an, pop]) => ({ nome: an, populacao: pop }))
        .sort((a, b) => b.populacao - a.populacao);
      const popTerra = listaAldeias.reduce((s, a) => s + a.populacao, 0);
      populacaoIndigena += popTerra;
      qtdAldeias += listaAldeias.length;
      return { nome, populacao: popTerra, aldeias: listaAldeias };
    }).sort((a, b) => b.populacao - a.populacao);

    return {
      dsei,
      populacaoIndigena,
      qtdTerrasIndigenas: listaTerras.length,
      qtdAldeias,
      terras: listaTerras
    };
  }).sort((a, b) => a.dsei.localeCompare(b.dsei, "pt-BR"));

  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, JSON.stringify(saida), "utf8");

  const tam = fs.statSync(destino).size;
  console.log(`[territorial] ${saida.length} DSEIs gravados em ${destino}`);
  console.log(`[territorial] tamanho final: ${(tam / 1024).toFixed(1)} KB`);
  const totalPop = saida.reduce((s, d) => s + d.populacaoIndigena, 0);
  console.log(`[territorial] população indígena total agregada: ${totalPop.toLocaleString("pt-BR")}`);
}

main();
