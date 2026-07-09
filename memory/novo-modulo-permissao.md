---
name: novo-modulo-permissao
description: Como registrar uma aba/módulo novo para ele aparecer na matriz de Perfis de Acesso (aba Solicitações)
metadata:
  type: feedback
---

Toda aba nova precisa aparecer na tabela "Administração de Perfis de Acesso" (aba Solicitações), como uma coluna **antes das 3 últimas** (Perfis de Acesso, Escopo (DSEI), Ações).

**Como fazer:** adicionar o módulo `{ chave, rotulo, icone }` em DOIS arrays, sempre **antes da entrada `solicitacoes`** (que é a coluna "Perfis de Acesso"):
- `lib/permissoes.js` → `MODULOS` (backend, fonte de verdade)
- `public/js/permissoes.js` → `MODULOS_PERMISSAO` (front; espelha o backend)

A `chave` deve casar com o `data-view` do item de menu. A matriz monta as colunas via `MODULOS_PERMISSAO.map(...)` seguido de "Escopo (DSEI)" e "Ações", então a posição no array = a ordem da coluna.

**Why:** o armazenamento de permissões é chave-valor (`EMAIL, MODULO, NIVEL`), então adicionar módulo NÃO exige migração de banco. Módulos novos ficam gated (nível 0 = sem acesso) até um admin liberar; o super admin recebe nível 3 em todos os módulos ao logar (`garantirSuperAdminComConn` em `lib/auth.js`), então precisa **reiniciar o servidor + refazer login** para ver a aba nova.

**How to apply:** ao criar uma aba, além do nav item + view + módulo JS + CSS, registrar nesses 2 arrays antes de `solicitacoes`. Ex.: `controleEstabilidade` (Controle de Estabilidade).
