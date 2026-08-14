// Servidor mínimo que redireciona qualquer rota para o novo endereço.
//
// Em produção o redirect declarado em vercel.json já atua na borda da Vercel,
// antes de a requisição chegar aqui. Este arquivo existe por dois motivos:
//
//   1. O projeto na Vercel está configurado com o preset Node.js, que exige um
//      entrypoint de servidor — sem ele o build falha com "No entrypoint found".
//   2. Funciona como segunda camada: se a regra da borda não for aplicada, o
//      próprio servidor responde 307 para o novo endereço.
const http = require("http");

const DESTINO = "https://sigepsi.agenciasus.org.br/";
const porta = process.env.PORT || 3000;

http
  .createServer((req, res) => {
    res.writeHead(307, {
      location: DESTINO,
      // Evita que o navegador guarde o redirect em cache, mantendo a migração
      // reversível enquanto o novo ambiente não estiver consolidado.
      "cache-control": "no-store",
    });
    res.end();
  })
  .listen(porta, () => {
    console.log(`Redirecionando todas as rotas para ${DESTINO} (porta ${porta})`);
  });
