# Estrutura do CSS

O `public/styles.css` é um **índice de `@import` em camadas (`@layer`)**: cada parte desta
pasta é carregada numa camada própria, **na ordem declarada no topo do `styles.css`**.
Não reordene as camadas nem os imports: a ordem das camadas define a precedência.

⚠️ **Importante:** o CSS cresceu por ajustes acumulados, então o estilo de um componente
quase sempre tem uma **base** numa camada e **overrides** em camadas posteriores.
Regra prática: **arquivos com número maior vencem** (camada posterior vence anterior),
agora **independentemente da especificidade do seletor** — é a ordem das camadas que decide.
Se mudar algo e "não pegar", provavelmente há um override num arquivo de número mais alto.

🚫 **Não use `!important`.** A precedência já vem da ordem das camadas. Num modelo de
`@layer`, um `!important` numa camada **anterior** passa a vencer as **posteriores**
(a importância inverte a ordem das camadas) — ou seja, ele quebra o esquema em vez de
ajudar. Se uma regra não está vencendo, mova-a para a camada certa ou ajuste o seletor.
Os ~900 `!important` que existiam foram removidos quando a cascata virou `@layer`.

### Camadas-invariante (topo)

No fim do `styles.css` há duas camadas declaradas **por último** (logo, de maior
precedência) para invariantes de **estado** alternado por JS, que precisam vencer
qualquer regra de layout das camadas anteriores:

- **`sidebar-state`** — `.app.sidebar-collapsed` (largura recolhida do menu, ~78px).
  Vence as várias regras `.app { grid-template-columns: <largo> }` (09, 11, …).
- **`view-visibility`** — `.viewPanel:not(.active) { display:none }`. Vence os
  `#view-* { display:block/grid }` que algumas views definem sem exigir `.active`.

Esse é o padrão para "regra que precisa ganhar de todas": uma camada-topo dedicada
— **não** `!important`. Antes da migração, ambas eram forçadas com `!important`.

## O que cada arquivo faz

| Arquivo | Conteúdo / quando mexer aqui |
|---|---|
| **01-base.css** | Base de tudo: variáveis de cor (`:root --azul-*`, `--texto`), reset, layout geral, e o **primeiro** estilo de sidebar, KPIs, tabelas e gráficos. Mexa em cor/tema aqui. |
| **02-loading.css** | Tela de carregamento (spinner/splash). |
| **03-layout-claro.css** | Tema visual claro: ajustes amplos de layout, KPIs, tabelas, abas de vagas. Segundo lugar mais provável pra estilo de tabela/aba. |
| **04-loading-cores.css** | Variação de cores da tela de carregamento (fundo SUS). |
| **05-painel-saude-indigena.css** | Páginas de painel externo em iframe (Saúde Indígena / Férias) e seus botões "Abrir painel". |
| **06-remanejamento.css** | **Remanejamento** (caixas, tabelas, botões) **e o bloco `@media print`** (impressão/PDF, incl. observação de alerta virando texto). Mexa em impressão aqui. |
| **07-visao-geral-responsiva.css** | Visão Geral: legibilidade e responsividade dos gráficos/cards. |
| **08-menu-lateral.css** | **Menu lateral** colorido e recolhível (comportamento principal). Mexa no menu aqui. |
| **09-menu-largo.css** | Override do menu: largura maior, sem rolagem. |
| **10-cobertura-ajustes.css** | Ajustes pontuais: indicador de cobertura na Visão Geral e cards. |
| **11-responsivo-v3.css** | Responsividade geral (várias telas): encaixe, rolagem, breakpoints. Muitos overrides de sidebar/KPI/tabela aqui. |
| **12-notebook.css** | Ajustes específicos para telas de notebook (evitar empurrar a página). |
| **13-remanejamento-compacto.css** | Layout compacto do remanejamento **e os estilos de login** (`loginScreen`/`loginCard`) e do bloco usuário/sair da sidebar. Mexa no login aqui. |
| **14-visao-geral-pagina-unica.css** | Visão Geral em página única (sem rolagem): distribui os gráficos no espaço vertical. |
| **17-gestao-ferias.css** | Aba **Gestão de Férias** (`gf*`): cartões, tabelas, badges, KPIs, toast da maquete. |
| **18-entrega-cracha.css** | Aba **Entrega de Crachá** (`ec*`): KPIs, barra de filtros, tabela paginada, badges de status, painel de detalhe, modal de cadastro e toast. |
| **15-painel-fixo-visao-geral.css** | Painel fixo/TV da Visão Geral (escala da base 1918x927). |
| **16-acesso.css** | Página de Solicitações de Acesso e modal central reutilizável. |
| **17-gestao-ferias.css** | Aba de Gestão de Férias (painéis, tabelas, badges, toast). |
| **18-processos-seletivos.css** | Aba de Processos Seletivos (KPIs, tabela, badges de status, paginação, painel de detalhamento e modal de cadastro). |

## Onde mexer — referência rápida

| Quero mudar… | Comece por | Cuidado com override em |
|---|---|---|
| Cores / tema | `01-base.css` (`:root`) | — |
| Menu lateral | `08-menu-lateral.css` | `09`, `10`, `11`, `12` |
| Tela de login | `13-remanejamento-compacto.css` | — |
| Tabelas (Vagas/Alertas) | `03-layout-claro.css` | `01`, `06`, `07`, `11` |
| KPIs / cards | `01-base.css` / `03` | `07`, `10`, `11`, `14` |
| Gráficos da Visão Geral | `07-visao-geral-responsiva.css` | `11`, `12`, `14` |
| Remanejamento | `06-remanejamento.css` | `13` |
| Impressão / PDF | `06-remanejamento.css` (`@media print`) | — |
| Painel externo (iframe) | `05-painel-saude-indigena.css` | — |
| Responsividade / telas pequenas | `11-responsivo-v3.css` | `12` |

> Dica: pra achar a regra exata, busque o nome da classe (ex.: `grep -rn "kpiGrid" public/styles/`).
> O arquivo de **maior número** que tiver a classe costuma ser o que está valendo.

## Classes mais redefinidas (override pesado)

Estas classes são redefinidas em muitos arquivos/breakpoints. **Antes de mexer,
veja TODOS os pontos** (`grep -rn "<classe>" public/styles/`): o valor que vale
depende do breakpoint ativo **e** da ordem dos arquivos. Não tente unificar numa
definição só sem testar visualmente em cada combinação — cada bloco costuma ser
um override responsivo intencional, não duplicata.

| Classe | Redefinida em (≈) | Observação |
|---|---|---|
| `.imagemIndigenaPainel` | 03, 06 (×7), 07 (×3), 11, 12, 15 — ~18 no total | Imagem indígena dos painéis. Cada bloco ajusta largura/altura/posição por breakpoint (inclui `max-height`). Consolidar exige testar a imagem em cada combinação de **largura e altura**. |
| `.panelTipo` | 03, 06, 07, 11, 12 — ~16 | Grid dos painéis da Visão Geral (`grid-template-columns`/`gap` variam por tela). |
| `.app` | 01, 11 e media queries — ~14 | Grid raiz; `11-responsivo-v3.css` reescreve em camada posterior (sem `!important` — vence pela ordem das camadas). |

## Tokens de cor (`:root` em `01-base.css`)

Cores institucionais centralizadas: `--azul-profundo`, `--azul-menu`, `--azul-card`,
`--azul-escuro`, `--azul-primario`, `--ciano`, `--texto`, `--muted`. Os azuis
dominantes do tema já usam esses tokens (trocar a cor é num lugar só). Demais
cores ainda estão como literais espalhados — tokenização incremental.
