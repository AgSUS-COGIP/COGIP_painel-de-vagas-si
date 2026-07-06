# Estrutura da modularização (ES Modules)

Há **mais de 20 módulos ES** nesta pasta (`public/js/`). O HTML carrega apenas o entry:

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
| **app.js** | Entry. `init()`, carregamento inicial e em segundo plano, auto-refresh, orquestração geral (`renderTudo`, `onResumoDataLoaded`). Liga tudo e registra o `DOMContentLoaded`. |
| **state.js** | Objeto `state` com **todo o estado mutável compartilhado** (dados carregados, filtros, página atual, sessão). Centralizado para poder ser reatribuído entre módulos. |
| **runtime.js** | Coleções mutáveis vivas: instâncias de gráficos (`charts`), configs de filtros (`filterConfigs`), flags de carregamento e caches. |
| **constants.js** | Valores fixos: paleta `COLORS`, filtros estáticos, config das tabelas de vagas, cargos fora do processo seletivo. |
| **utils.js** | Helpers puros sem estado: `formatNumber`, `formatPercent`, `formatCurrency`, `escapeHtml/Attr`, `debounce`, `valorCsv`/`baixarArquivoCsv` (download de CSV centralizado), `soma`, `part`, `setText`, `normalizar*`, etc. |
| **api.js** | Comunicação com o backend: `apiGet`, `apiPost`, cabeçalhos de auth e carregamento de configuração. |
| **auth.js** | Login, verificação de sessão, permissões por nível de usuário e logout. |
| **charts.js** | Renderizadores de gráfico (doughnut, bar, column, funnel, treemap, ranking, legenda) sobre Chart.js. |
| **kpis.js** | Cálculo de indicadores e preenchimento dos KPIs/resumos da Visão Geral; monta os dados que os gráficos exibem. |
| **vagas.js** | Aba de Vagas: tabelas de vagas, vagas ociosas e processo seletivo — cabeçalhos, ordenação, busca, paginação. |
| **alertas.js** | Aba de Alertas: tabela, KPIs de alerta e observações (editar/salvar/cancelar). |
| **remanejamento.js** | Aba de Remanejamento (cadastro, linhas, cálculos, histórico, detalhe/exclusão) e os painéis externos (Saúde Indígena / Férias). |
| **gestao-ferias.js** | Aba de Gestão de Férias (maquete interativa, dados de exemplo, sem backend): lote, consulta filtrável, histórico e detalhamento. |
| **processos-seletivos.js** | Aba de Processos Seletivos (somente leitura, sem backend): dados reais dos editais carregados de `processos-seletivos-dados.js`. Tabela com Unidade/UF/Edital/datas/Status/Responsável, KPIs por status + vagas previstas, filtros (unidade/status/busca) e detalhamento (Processo SEI, Ciclo, Etapa, Risco, Vagas Previstas/Contratados/Ociosas/Inscritos, Observações e link do edital). Exporta `obterBloqueiosRemanejamentoPSS` (bloqueia redução de unidades com edital em andamento). |
| **processos-seletivos-dados.js** | Dados reais dos editais (gerado a partir de `mock/AgSUS_Monitora_SaudeIndigena_20260618.csv`). Não editar à mão — regerar a partir do CSV. |
| **exportacao.js** | Exportações para CSV e PDF (vagas, distribuição, processo seletivo, alertas). |
| **filtros.js** | Navegação entre abas, sidebar, multi-selects, filtros e a **delegação de eventos** (`data-click` / `data-change` / `data-input`) que substituiu os antigos handlers inline. Inclui `filtrarRowsBase` (aplica filtro de DSEI/Cargo + gráfico ativo a um conjunto de linhas). |
| **gestao-ferias.js** | Aba de Gestão de Férias: maquete autocontida (dados de exemplo, sem backend) com lote, resumo, histórico, consulta e toast próprios; ligada no init via `configurarGestaoFerias()`. |
| **entrega-cracha.js** | Aba de Entrega de Crachá: consome dados reais via API (`/api/cracha`). A base `UGP_CONTROLE_CRACHAS_SI` é recriada por ETL diário, então os dados manuais ficam numa tabela-companheira (`UGP_CRACHAS_CONTROLE_MANUAL`, por matrícula) — leitura é base + overlay. Funil de 6 status (até `Entregue ao Trabalhador`); ao avançar o status, a data do marco (envio à gráfica/confecção/recebimentos) é carimbada automaticamente. Indicadores independentes: crachá devolvido e 2ª via (com motivo). KPIs, filtros, tabela paginada (datas nas últimas colunas), detalhe com trilha, edição do overlay e **mudança de status em lote**. **Importação de planilha CSV** (`/api/cracha/importar`): atualiza quem já existe e **cria no overlay** quem não está na base do ETL (identidade na própria companheira, marcado como "Importado"); a leitura é um UNION base + overlay-only. Modelo CSV para baixar. Escrita só para admin (nível ≥ 2). Carregamento sob demanda; chave = matrícula; ligada no init via `configurarEntregaCracha()`. |
| **escala-trabalho.js** | Aba de Escala de Trabalho — **camada de apresentação pura** (mesmo modelo das demais abas: MySQL → servidor → front). Consome `GET /api/escala` (`lib/escala.js`), que devolve os profissionais (nome/cargo/DSEI/polo + escala/situação/dias já prontos) e as opções de filtro (`filtros` + `polosPorDsei`); o front só renderiza. A **situação é real** (`SITUACAO_DETALHADA_DESC` da view — ex.: Normal/Férias/Auxílio doença; mesma do Painel da Força de Trabalho), assim como nome/cargo/DSEI/polo. As demais colunas de escala (escala/**alternância**/UBSI/período) ainda não têm fonte no banco e são preenchidas com placeholder **no servidor** até existir a origem real. A coluna **Alternância de Escala** (Par/Ímpar) define, no plantonista 12x36, se ele é escalado nos dias pares ou ímpares do mês — e o **Período/Dias é derivado dela**. O **detalhamento de plantonistas mostra o mês inteiro** (31 colunas, uma por dia; Profissional fixo, dias rolam) e marca **afastamentos** (Férias/Licença/Afastamento, mock por matrícula) nos dias correspondentes, com prioridade sobre o plantão. Filtros de DSEI, **Lotação (em cascata)**, cargo, escala e situação; tabela **paginada no rodapé** (modelo da aba de Crachás: `PAGE_SIZE_OPCOES`, `renderPaginacao`); alerta de sem escala, detalhamentos de plantonistas e de território empilhados (amostra de até `DETALHE_MAX`), **cada um com filtros próprios** (nome + cargo + polo/CASAI · nome + cargo + tipo de território) e exportação do conjunto filtrado — **plantonistas → PDF** (grade do mês em paisagem, via janela de impressão/"salvar como PDF", sem biblioteca externa) e **território → CSV**, resumo (KPIs). Tabelas via `criarTabelaArrastavel`. Excluir (remove só a escala, mantém a identidade) e **editar** exigem Editor (nível ≥ 2) e alteram os dados em memória (mock). A **edição** abre um modal (`abrirEdicaoEscala`) onde se define: **Lotação (polo base)** restrita ao DSEI do empregado (referência canônica `escala-polos-dados.js` — de `Polos.gs`, casada por chave de DSEI normalizada + aliases), UBSI **restrita ao DSEI** (catálogo do CNES `/data/rede_cnes.json`), tipo de escala (diarista/diurno/noturno/território), alternância (plantonista, só pré-preenche o calendário) e um **calendário do mês** (checkbox por dia + contador) sempre visível para diarista/plantonista — **pré-preenchido** pela alternância (plantonista) ou Seg–Sex (diarista) e editável; os dias marcados (`diasMarcados`) são o padrão de trabalho na tabela/detalhamento/PDF. Território usa ida/retorno+tipo. `escala-polos-dados.js` = mapa canônico DSEI → polos (Polos Base/SEDE/CASAI). Ligada no init via `configurarEscalaTrabalho()` e renderizada ao abrir via `renderEscalaTrabalhoAoMostrar()`. |
| **assistente.js** | Assistente virtual (robô flutuante). Widget fixo no `<body>` (fora de `.app`, que é escalado no modo painel fixo), visível em **todas as abas** e **arrastável** para qualquer ponto da tela (posição em `localStorage`, chave `assistente:pos`). A visibilidade espelha a de `.app` via `MutationObserver` (some no login/pendente/sem acesso). De início **apenas recebe feedback** (`POST /api/feedback`, gravado em `FEEDBACK_ASSISTENTE`); o painel de conversa já está preparado para, no futuro, ajudar o usuário e responder perguntas. Ligado no init via `configurarAssistente()`. |
| **modal.js** | Modal central reutilizável (confirmação/aviso/entrada de texto) e overlays de carregamento. |
| **acesso.js** | Página de Solicitações de Acesso: aprovação/recusa de pedidos e níveis de autorização. |

## Convenções

- **Sem handlers inline no HTML.** Cada elemento interativo declara a ação em
  `data-click` / `data-change` / `data-input` e os parâmetros em outros `data-*`.
  O dispatcher central fica em `filtros.js → configurarDelegacaoEventos()`.
- **Estado:** os módulos centrais (Visão Geral, Vagas, Alertas, Remanejamento)
  usam o objeto `state.*` (ex.: `state.vagasRows`). Os módulos de feature mais
  recentes (`entrega-cracha`, `saude-indigena`, `gestao-disciplinar`,
  `processos-seletivos`) encapsulam o próprio estado em `let` no escopo do módulo
  e registram a delegação de eventos local na raiz da sua view — padrão preferido
  por reduzir o acoplamento ao `state` global. Em nenhum caso há variáveis globais
  soltas em `window.*`. **Busca textual** é sempre debounced (`utils.debounce`).
- **Módulos base** (`state`, `runtime`, `constants`, `utils`) não importam ninguém;
  os de domínio importam dessas bases e uns dos outros conforme a necessidade.
