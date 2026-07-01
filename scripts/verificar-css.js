// Verifica a consistência entre os arquivos CSS em public/styles/ e o índice
// public/styles.css. A arquitetura em @layer depende de que TODO arquivo esteja
// importado (e na sua camada): um .css órfão não carrega e some silenciosamente.
// Roda no `npm run check`; sai com código 1 (falha) se houver divergência.
const fs = require("fs");
const path = require("path");

const STYLES_DIR = path.join(__dirname, "..", "public", "styles");
const INDICE = path.join(__dirname, "..", "public", "styles.css");

function verificar() {
  const indice = fs.readFileSync(INDICE, "utf8");

  // Arquivos .css reais na pasta (ignora a documentação .md).
  const arquivos = fs.readdirSync(STYLES_DIR)
    .filter((f) => f.endsWith(".css"))
    .sort();

  const erros = [];

  for (const arquivo of arquivos) {
    // Cada arquivo precisa de um @import correspondente no índice.
    if (!indice.includes(`styles/${arquivo}`)) {
      erros.push(`Arquivo sem @import em styles.css: ${arquivo}`);
    }
  }

  // E o caminho inverso: um @import para um arquivo que não existe mais.
  const importados = [...indice.matchAll(/styles\/([\w.-]+\.css)/g)].map((m) => m[1]);
  for (const importado of importados) {
    if (!arquivos.includes(importado)) {
      erros.push(`@import aponta para arquivo inexistente: ${importado}`);
    }
  }

  if (erros.length) {
    console.error("[verificar-css] Divergência entre public/styles/ e styles.css:");
    erros.forEach((e) => console.error("  - " + e));
    process.exit(1);
  }

  console.log(`[verificar-css] OK — ${arquivos.length} arquivos CSS, todos importados em styles.css.`);
}

verificar();
