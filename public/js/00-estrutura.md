# Estrutura da modularização (ES Modules)

Existe **18 módulos ES** nesta pasta (`public/js/`). O HTML carrega apenas o entry:

```html
<script type="module" src="./js/app.js"></script>
```

## Camadas

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

## O que cada arquivo faz

| Arquivo | Responsabilidade |
|---|---|
| **app.js** | Entry. `init()`, carregamento inicial e em segundo plano, auto-refresh, orquestração geral (`renderTudo`, `onDataLoaded`). Liga tudo e registra o `DOMContentLoaded`. |
| **state.js** | Objeto `state` com **todo o estado mutável compartilhado** (dados carregados, filtros, página atual, sessão). Centralizado para poder ser reatribuído entre módulos. |
| **runtime.js** | Coleções mutáveis vivas: instâncias de gráficos (`charts`), configs de filtros (`filterConfigs`), flags de carregamento e caches. |
| **constants.js** | Valores fixos: paleta `COLORS`, filtros estáticos, config das tabelas de vagas, cargos fora do processo seletivo. |
| **utils.js** | Helpers puros sem estado: `formatNumber`, `formatPercent`, `formatCurrency`, `escapeHtml/Attr/Js`, `soma`, `part`, `setText`, `normalizar*`, etc. |
| **api.js** | Comunicação com o backend: `apiGet`, `apiPost`, cabeçalhos de auth e carregamento de configuração. |
| **auth.js** | Login, verificação de sessão, permissões por nível de usuário e logout. |
| **charts.js** | Renderizadores de gráfico (doughnut, bar, column, funnel, treemap, ranking, legenda) sobre Chart.js. |
| **kpis.js** | Cálculo de indicadores e preenchimento dos KPIs/resumos da Visão Geral; monta os dados que os gráficos exibem. |
| **vagas.js** | Aba de Vagas: tabelas de vagas, vagas ociosas e processo seletivo — cabeçalhos, ordenação, busca, paginação. |
| **alertas.js** | Aba de Alertas: tabela, KPIs de alerta e observações (editar/salvar/cancelar). |
| **remanejamento.js** | Aba de Remanejamento (cadastro, linhas, cálculos, histórico, detalhe/exclusão) e os painéis externos (Saúde Indígena / Férias). |
| **gestao-ferias.js** | Aba de Gestão de Férias (maquete interativa, dados de exemplo, sem backend): lote, consulta filtrável, histórico e detalhamento. |
| **processos-seletivos.js** | Aba de Processos Seletivos (maquete interativa, dados de exemplo, sem backend): tabela com KPIs, definição de status (Não iniciado / Em andamento / Encerrando em breve / Encerrado), cadastro de novos processos (modal) e detalhamento (vagas, cadastro reserva, convocados, desistentes e candidatos). |
| **exportacao.js** | Exportações para CSV e PDF (vagas, distribuição, processo seletivo, alertas). |
| **filtros.js** | Navegação entre abas, sidebar, multi-selects, filtros e a **delegação de eventos** (`data-click` / `data-change` / `data-input`) que substituiu os antigos handlers inline. |
| **gestao-ferias.js** | Aba de Gestão de Férias: maquete autocontida (dados de exemplo, sem backend) com lote, resumo, histórico, consulta e toast próprios; ligada no init via `configurarGestaoFerias()`. |
| **entrega-cracha.js** | Aba de Entrega de Crachá: maquete autocontida (dados de exemplo, sem backend) do fluxo solicitação → confecção → entrega; KPIs, filtros, tabela paginada, painel de detalhe, modal de cadastro e toast próprios; ligada no init via `configurarEntregaCracha()`. |
| **modal.js** | Modal central reutilizável (confirmação/aviso/entrada de texto) e overlays de carregamento. |
| **acesso.js** | Página de Solicitações de Acesso: aprovação/recusa de pedidos e níveis de autorização. |

## Convenções

- **Sem handlers inline no HTML.** Cada elemento interativo declara a ação em
  `data-click` / `data-change` / `data-input` e os parâmetros em outros `data-*`.
  O dispatcher central fica em `filtros.js → configurarDelegacaoEventos()`.
- **Estado sempre via `state.*`** (ex.: `state.vagasRows`), nunca variáveis globais soltas.
- **Módulos base** (`state`, `runtime`, `constants`, `utils`) não importam ninguém;
  os de domínio importam dessas bases e uns dos outros conforme a necessidade.
