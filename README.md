# COGIP — Painel de Vagas SI (desativado)

Este projeto foi **migrado para outro ambiente** e não é mais mantido aqui.

## Novo endereço

> **https://sigepsi-hom.agenciasus.org.br/**

Este repositório contém apenas o redirecionamento do domínio antigo da Vercel
para o novo endereço. Não há mais aplicação, banco de dados nem API aqui.

## Como o redirecionamento funciona

São três camadas, da mais externa para a mais interna:

| Arquivo | Papel |
| --- | --- |
| `vercel.json` | **1ª camada.** Redireciona **qualquer** rota (`/(.*)`) para o novo endereço, na borda da Vercel, antes de servir qualquer arquivo ou invocar função. |
| `index.js` + `package.json` | **2ª camada.** Servidor Node mínimo que responde `307` para tudo. Existe porque o projeto na Vercel está com preset **Node.js**, que exige um entrypoint de servidor — sem ele o build falha com `No entrypoint found`. |
| `index.html` / `public/index.html` | **3ª camada.** Página de fallback com `meta refresh` + `window.location.replace` e um link manual, caso nenhuma das anteriores atue. |

Se algum dia o preset do projeto na Vercel for trocado para **Other**, o
`index.js` e o `package.json` deixam de ser necessários e o deploy passa a ser
puramente estático.

Para rodar a 2ª camada localmente:

```bash
PORT=4001 node index.js
curl -I http://localhost:4001/vagas   # deve responder 307
```

O redirecionamento está configurado como **temporário (HTTP 307)**
(`"permanent": false` em `vercel.json`), para que o endereço antigo possa ser
reaproveitado se necessário sem que o navegador dos usuários mantenha o
redirecionamento em cache.

Para torná-lo **permanente (HTTP 308)** depois que a migração estiver
consolidada, troque em `vercel.json`:

```json
"permanent": true
```

Atenção: com 308 os navegadores passam a guardar o redirecionamento em cache
por tempo indeterminado, e desfazê-lo exige que cada usuário limpe o cache.

## Código anterior

O código da aplicação continua no histórico do Git. A tag
`pre-migracao-sigepsi` aponta para o último commit antes da desativação:

```bash
git checkout pre-migracao-sigepsi
```
