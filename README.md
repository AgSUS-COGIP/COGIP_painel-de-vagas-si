# Painel Web — Monitoramento de Vagas (Saúde Indígena)

Versão web do painel de monitoramento de vagas em Saúde Indígena, com **frontend estático modular** (ES Modules + CSS particionado) e **backend Node.js/Express** com MySQL, cache em memória e autenticação (senha local e Google OAuth).

## Estrutura do projeto

```
.
├── server.js                # Backend Express: API, MySQL, cache, auth, upload de anexos
├── package.json             # Scripts (start/dev/check/test) e dependências
├── .env.exemple             # Modelo de variáveis de ambiente (copie para .env)
├── test/                    # Testes (node --test)
└── public/                  # Frontend estático servido pelo Express
    ├── index.html           # Marcação única; carrega o entry como módulo e o styles.css
    ├── styles.css           # Índice que importa os parciais de styles/ na ordem da cascata
    ├── assets/images/        # Logos e imagens do painel
    ├── js/                   # Lógica do frontend em ES Modules (entry: app.js)
    └── styles/               # CSS dividido em parciais numerados (01..15)
```

O HTML carrega **um único entry** de JS e **um único** CSS; o resto é importado a partir deles:

```html
<link rel="stylesheet" href="./styles.css">
<script type="module" src="./js/app.js"></script>
```

### Frontend: ES Modules (`public/js/`)

São 14 módulos. `app.js` é o entry; os módulos **base** não dependem de ninguém e os de **domínio** dependem das bases (e uns dos outros conforme necessário).

```
                 ┌─────────────┐
   entry  ──────▶│   app.js    │  init + orquestração de carregamento
                 └──────┬──────┘
        ┌───────────────┼───────────────────────────────┐
   auth.js          filtros.js                      (domínios)
   api.js      (navegação + delegação)   charts/kpis/vagas/alertas/
                                          remanejamento/exportacao
        └───────────────┴───────────────────────────────┘
                 ▼ todos dependem de ▼
        state.js · runtime.js · constants.js · utils.js   (base, sem dependências)
```

| Arquivo | Responsabilidade |
|---|---|
| **app.js** | Entry. `init()`, carregamento inicial e em segundo plano, auto-refresh e orquestração geral (`renderTudo`, `onDataLoaded`). |
| **state.js** | Objeto `state` com **todo o estado mutável compartilhado** (dados, filtros, página atual, sessão). |
| **runtime.js** | Coleções vivas: instâncias de gráficos (`charts`), configs de filtros (`filterConfigs`), flags de carregamento e caches. |
| **constants.js** | Valores fixos: paleta `COLORS`, filtros estáticos, config das tabelas de vagas, cargos fora do processo seletivo. |
| **utils.js** | Helpers puros sem estado: `formatNumber`, `formatPercent`, `formatCurrency`, `escapeHtml/Attr/Js`, `soma`, `setText`, `normalizar*`, etc. |
| **api.js** | Comunicação com o backend: `apiGet`, `apiPost`, cabeçalhos de auth e carregamento de configuração. |
| **auth.js** | Login, verificação de sessão, permissões por nível de usuário e logout. |
| **charts.js** | Renderizadores de gráfico (doughnut, bar, column, funnel, treemap, ranking, legenda) sobre Chart.js. |
| **kpis.js** | Cálculo de indicadores e preenchimento dos KPIs/resumos da Visão Geral. |
| **vagas.js** | Aba de Vagas: tabelas de vagas, vagas ociosas e processo seletivo (cabeçalhos, ordenação, busca, paginação). |
| **alertas.js** | Aba de Alertas: tabela, KPIs de alerta e observações (editar/salvar/cancelar). |
| **remanejamento.js** | Aba de Remanejamento (cadastro, linhas, cálculos, histórico) e os painéis externos (Saúde Indígena / Férias). |
| **exportacao.js** | Exportações para CSV e PDF (vagas, distribuição, processo seletivo, alertas). |
| **filtros.js** | Navegação entre abas, sidebar, multi-selects, filtros e a **delegação de eventos** (`data-click` / `data-change` / `data-input`). |

> Há uma referência viva em [`public/js/00-estrutura.md`](public/js/00-estrutura.md).

**Convenções**

- **Sem handlers inline no HTML.** Cada elemento interativo declara a ação em `data-click` / `data-change` / `data-input` e os parâmetros em outros `data-*`; o dispatcher central fica em `filtros.js`.
- **Estado sempre via `state.*`** (ex.: `state.vagasRows`), nunca variáveis globais soltas.
- **Módulos base** (`state`, `runtime`, `constants`, `utils`) não importam ninguém.

### Frontend: CSS particionado (`public/styles/`)

`styles.css` é só um índice que importa os parciais **na ordem da cascata** — a ordem importa, pois define a precedência das regras. Não reordene sem necessidade.

```
01-base                 06-remanejamento           11-responsivo-v3
02-loading              07-visao-geral-responsiva  12-notebook
03-layout-claro         08-menu-lateral            13-remanejamento-compacto
04-loading-cores        09-menu-largo              14-visao-geral-pagina-unica
05-painel-saude-indigena 10-cobertura-ajustes      15-painel-fixo-visao-geral
```

Em geral: `01-base` define a fundação; os parciais seguintes tratam de áreas/telas específicas; os de numeração mais alta (`11`–`15`) cuidam de responsividade e ajustes finos, então sobrescrevem os anteriores.

### Backend (`server.js`)

API Express que serve o `public/` e expõe os endpoints de dados, com:

- Consultas **MySQL** (pool via `mysql2`) e **cache em memória** por processo (`CACHE_SECONDS`).
- **Autenticação** com sessão JWT e duas formas de login: senha local (hash `bcryptjs`) e **Google OAuth/OpenID**.
- **Upload de anexos** de remanejamento (`multer`).
- Compatibilidade com a configuração herdada do Apps Script (`MYSQL_JDBC_URL`, `MYSQL_USER`, `MYSQL_PASSWORD`).

## Como rodar

1. Instale as dependências:

```bash
npm install
```

2. Crie o arquivo `.env` a partir de `.env.exemple` e ajuste as credenciais:

```bash
cp .env.exemple .env
```

Variáveis principais:

```env
PORT=3306

MYSQL_JDBC_URL=jdbc:mysql://host:3306/banco
MYSQL_USER=usuario
MYSQL_PASSWORD=senha
MYSQL_DATABASE=banco

CACHE_SECONDS=300

# Sessão JWT
JWT_SECRET=troque-por-um-segredo-forte
JWT_EXPIRES=8h

# Admin inicial (criado só se a tabela de usuários estiver vazia)
SEED_ADMIN_LOGIN=admin
SEED_ADMIN_SENHA=AgSUS@2026
```

> O `.env.exemple` traz também a configuração opcional de **Google OAuth** (`GOOGLE_*`), com comentários explicando cada campo. Deixe `GOOGLE_CLIENT_ID` vazio para manter o login Google desativado.

3. Inicie a aplicação:

```bash
npm start      # ou: npm run dev
```

4. Acesse (a porta é a definida em `PORT`):

```text
http://localhost:3306
```

## Scripts

| Comando | O que faz |
|---|---|
| `npm start` / `npm run dev` | Sobe o servidor (`node server.js`). |
| `npm run check` | Verifica a sintaxe de `server.js` e de todos os módulos em `public/js/`. |
| `npm test` | Roda os testes (`node --test`). |

## Observações

- O backend aceita `MYSQL_JDBC_URL`, `MYSQL_USER` e `MYSQL_PASSWORD`, mantendo compatibilidade com a configuração usada no Apps Script.
- As imagens locais ficam em `public/assets/images/`; logos remotas seguem servidas pelos links públicos configurados.
- O cache é local ao processo Node e respeita `CACHE_SECONDS`.
- Os arquivos legados do Apps Script já não fazem parte da versão atual do projeto.
