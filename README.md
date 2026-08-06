# COGIP — Painel de Vagas SI (desativado)

Este projeto foi **migrado para outro ambiente** e não é mais mantido aqui.

## Novo endereço

> **https://sigepsi.agenciasus.org.br/**

Este repositório contém apenas o redirecionamento do domínio antigo da Vercel
para o novo endereço. Não há mais aplicação, banco de dados nem API aqui.

## Como o redirecionamento funciona

| Arquivo | Papel |
| --- | --- |
| `vercel.json` | Redireciona **qualquer** rota (`/(.*)`) para o novo endereço, na borda da Vercel, antes de servir qualquer arquivo. |
| `index.html` / `public/index.html` | Página de fallback com `meta refresh` + `window.location.replace`, caso o redirecionamento da borda não seja aplicado. Também mostra um link manual. |

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
