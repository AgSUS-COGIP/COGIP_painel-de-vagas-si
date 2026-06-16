# Estrutura do CSS

O `public/styles.css` é só um **índice de `@import`** que carrega as 18 partes desta pasta
**na ordem da cascata**. Não reordene os imports: a ordem define a precedência.

⚠️ **Importante:** o CSS cresceu por ajustes acumulados, então o estilo de um componente
quase sempre tem uma **base** num arquivo e **overrides** em arquivos posteriores.
Regra prática: **arquivos com número maior vencem** (vêm depois na cascata). Se mudar algo
e "não pegar", provavelmente há um override num arquivo de número mais alto.

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
