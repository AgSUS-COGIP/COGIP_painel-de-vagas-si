# Painel Web

Versão web do painel de monitoramento de vagas em Saúde Indígena, com frontend estático e backend Node.js/Express.

## Estrutura

- `public/index.html`: marcação da interface
- `public/styles.css`: estilos extraídos do HTML original
- `public/app.js`: lógica do frontend, agora usando `fetch`
- `server.js`: backend Express com consultas MySQL e cache em memória
- `.env`: variáveis de ambiente locais

## Como rodar

1. Instale as dependências:

```bash
npm install
```

2. Crie um arquivo `.env` a partir de `.env.example` e ajuste as credenciais do MySQL.

Exemplo mínimo:

```env
PORT=3000
MYSQL_JDBC_URL=jdbc:mysql://host:3306/banco
MYSQL_USER=usuario
MYSQL_PASSWORD=senha
MYSQL_DATABASE=banco
```

3. Inicie a aplicação:

```bash
npm start
```

4. Acesse:

```text
http://localhost:3306
```

## Observações

- O backend aceita `MYSQL_JDBC_URL`, `MYSQL_USER` e `MYSQL_PASSWORD`, mantendo compatibilidade com a configuração usada no Apps Script.
- As imagens do painel continuam sendo servidas a partir dos links públicos do Google Drive.
- O cache agora é local ao processo Node e respeita `CACHE_SECONDS`.
- Os arquivos legados do Apps Script já não fazem parte da versão atual do projeto.
