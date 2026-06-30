// Validação ESTRUTURAL dos módulos ES do front (public/js).
//
// Por que existe: `node --check` valida cada arquivo como SCRIPT e NÃO detecta
// erros que só existem no nível de MÓDULO — binding duplicado (ex.: importar um
// nome que já é uma função local), export inexistente ou caminho de import
// quebrado. Foi essa lacuna que deixou passar um `import { abrirModal }` colidindo
// com uma função local `abrirModal`, quebrando o carregamento do app inteiro.
//
// Como funciona: tenta importar cada módulo. O import dispara PARSE + LINK antes
// de EXECUTAR. Erros de parse/link são SyntaxError (binding duplicado, "does not
// provide an export named …") ou ERR_MODULE_NOT_FOUND (import quebrado) — esses
// REPROVAM. Já erros de execução por faltar globais do navegador (document/window,
// que não existem no Node) são ReferenceError/TypeError e são ESPERADOS aqui:
// significam que o módulo passou no parse/link e só não roda fora do browser —
// NÃO reprovam. Como o parse acontece antes da execução, qualquer erro estrutural
// sempre aparece como SyntaxError antes de um eventual ReferenceError de DOM.
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const DIR = path.join(__dirname, "..", "public", "js");

function ehErroEstrutural(e) {
  if (e instanceof SyntaxError) return true;            // binding duplicado / export inexistente
  const cod = e && e.code;
  if (cod === "ERR_MODULE_NOT_FOUND" || cod === "ERR_UNSUPPORTED_DIR_IMPORT") return true; // import quebrado
  return false; // ReferenceError/TypeError de execução (document/window/etc.) — esperado fora do browser
}

(async () => {
  const arquivos = fs.readdirSync(DIR).filter((f) => f.endsWith(".js")).sort();
  const erros = [];

  for (const arquivo of arquivos) {
    const url = pathToFileURL(path.join(DIR, arquivo)).href;
    try {
      await import(url);
    } catch (e) {
      if (ehErroEstrutural(e)) {
        erros.push(`${arquivo}: ${e && e.message ? e.message : e}`);
      }
    }
  }

  if (erros.length) {
    console.error("[verificar-modulos] Erro(s) estrutural(is) de módulo ES no front:");
    erros.forEach((e) => console.error("  - " + e));
    process.exit(1);
  }

  console.log(`[verificar-modulos] OK — ${arquivos.length} módulos do front sem erro de parse/import/export.`);
})();
