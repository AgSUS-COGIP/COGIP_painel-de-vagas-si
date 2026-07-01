import { idSeguroAlerta } from "./alertas.js";
import { nivelModulo } from "./permissoes.js";
import { apiGet } from "./api.js";
import { recarregarTodosOsDados } from "./app.js";
import { NIVEL, REMANEJAMENTO_EMPTY_OPTION, REMANEJAMENTO_MESES_PADRAO } from "./constants.js";
import { abrirAviso, abrirModal, mostrarCarregando, ocultarCarregando } from "./modal.js";
import { obterBloqueiosRemanejamentoPSS } from "./processos-seletivos.js";
import { detalhesRemanejamentoCache, pageLoadState } from "./runtime.js";
import { state } from "./state.js";
import { cssEscapeAttr, escapeAttr, escapeHtml, formatCurrency, formatNumber, normalizarTextoPainel, safeUrl, setText, setValue, soma } from "./utils.js";
import { tornarSelectPesquisavel, sincronizarSelectPesquisavel } from "./searchable-select.js";
import { criarTabelaArrastavel } from "./tabela-arrastavel.js";

// Grade Tabulator do histórico (só colunas) e id do remanejamento com detalhe aberto.
let gradeRem = null;
let remDetalheAberto = null;

export function configurarPainelExterno() {
  const iframe = document.getElementById("iframeDashboardSaudeIndigena");
  const placeholder = document.getElementById("dashboardSaudeIndigenaPlaceholder");
  const btn = document.getElementById("btnAbrirPainelExterno");
  const url = String(state.DASHBOARD_SAUDE_INDIGENA_URL || "").trim();

  if (!iframe || !placeholder) return;

  iframe.removeAttribute("src");
  iframe.style.display = "none";

  if (!url) {
    placeholder.style.display = "grid";
    if (btn) btn.disabled = true;
    return;
  }

  placeholder.style.display = "grid";
  if (btn) btn.disabled = false;
}

export function carregarPainelExternoSobDemanda() {
  if (state.painelExternoCarregado) return;

  const iframe = document.getElementById("iframeDashboardSaudeIndigena");
  const placeholder = document.getElementById("dashboardSaudeIndigenaPlaceholder");
  const url = String(state.DASHBOARD_SAUDE_INDIGENA_URL || "").trim();

  if (!iframe || !placeholder || !url) return;

  iframe.src = url;
  iframe.style.display = "block";
  placeholder.style.display = "none";
  state.painelExternoCarregado = true;
}

export function abrirPainelExterno() {
  const url = String(state.DASHBOARD_SAUDE_INDIGENA_URL || "").trim();

  if (!url) {
    alert("O link do painel ainda não foi configurado em state.DASHBOARD_SAUDE_INDIGENA_URL.");
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

export function configurarPainelFerias() {
  const iframe = document.getElementById("iframeDashboardFerias");
  const placeholder = document.getElementById("dashboardFeriasPlaceholder");
  const btn = document.getElementById("btnAbrirPainelFerias");
  const url = String(state.DASHBOARD_FERIAS_URL || "").trim();

  if (!iframe || !placeholder) return;

  iframe.removeAttribute("src");
  iframe.style.display = "none";

  placeholder.style.display = "grid";
  if (btn) btn.disabled = !url;
}

export function carregarPainelFeriasSobDemanda() {
  if (state.painelFeriasCarregado) return;

  const iframe = document.getElementById("iframeDashboardFerias");
  const placeholder = document.getElementById("dashboardFeriasPlaceholder");
  const url = String(state.DASHBOARD_FERIAS_URL || "").trim();

  if (!iframe || !placeholder || !url) return;

  iframe.src = url;
  iframe.style.display = "block";
  placeholder.style.display = "none";
  state.painelFeriasCarregado = true;
}

export function abrirPainelFerias() {
  const url = String(state.DASHBOARD_FERIAS_URL || "").trim();

  if (!url) {
    alert("O link do painel ainda não foi configurado em state.DASHBOARD_FERIAS_URL.");
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

// Marca a aba em modo somente-leitura (Leitor, nível < 2). O CSS (.rem-readonly)
// esconde TODOS os botões de escrita em qualquer profundidade — rede de segurança
// de render, complementando o que auth.js já esconde (bloco de documentação/salvar).
function aplicarModoLeituraRemanejamento() {
  const raiz = document.getElementById("view-remanejamento");
  if (raiz) raiz.classList.toggle("rem-readonly", nivelUsuarioRemanejamento() < NIVEL.ADMIN);
}

export function configurarRemanejamento() {
  state.remanejamentoDetalhePage = 1;
  aplicarModoLeituraRemanejamento();

  if (!pageLoadState.remanejamentoCadastro) {
    preencherSelectRemanejamento("remanejamentoDsei", [REMANEJAMENTO_EMPTY_OPTION], item => item.label);
    inicializarFormularioRemanejamento();
    atualizarResumoRemanejamento();
    return;
  }

  const dseis = montarOpcoesDseiRemanejamento();
  preencherSelectRemanejamento("remanejamentoDsei", dseis, item => item.label);
  inicializarFormularioRemanejamento(true);
  atualizarResumoRemanejamento();
}

export function montarOpcoesDseiRemanejamento() {
  const mapa = new Map();

  (state.remanejamentoCadastroRows || []).forEach(row => {
    if (!row.idDseiCasai || !row.dseiCasai) return;
    mapa.set(String(row.idDseiCasai), {
      value: String(row.idDseiCasai),
      label: row.dseiCasai
    });
  });

  const lista = [...mapa.values()].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  return lista.length ? lista : [REMANEJAMENTO_EMPTY_OPTION];
}

// ---------- Bloqueio por Processo Seletivo (PSS) ----------
// Regra: enquanto um DSEI tiver processo seletivo em andamento/perto do término,
// a REDUÇÃO de vagas daquele DSEI fica bloqueada na criação do remanejamento.
// O super administrador (nível 3) pode liberar pontualmente os demais cargos do
// DSEI, mas o(s) cargo(s) do próprio processo seletivo permanece(m) bloqueado(s).

// Nível efetivo do usuário no módulo Remanejamento (override por perfil de
// acesso ou, na ausência, o nível global). 2 = Editor, 3 = Administrador.
function nivelUsuarioRemanejamento() {
  return state.painelLoginUsuario ? nivelModulo("remanejamento") : 0;
}

// Nome (texto) do DSEI selecionado no formulário — usado para cruzar com o PSS.
function nomeDseiSelecionadoRemanejamento() {
  const sel = document.getElementById("remanejamentoDsei");
  return sel?.options?.[sel.selectedIndex]?.text || "";
}

// Bloqueio de PSS para o DSEI selecionado (ou null). Compara pelo nome do DSEI.
function bloqueioPSSDoDseiSelecionado() {
  const nome = normalizarTextoPainel(nomeDseiSelecionadoRemanejamento());
  if (!nome) return null;
  return (obterBloqueiosRemanejamentoPSS() || [])
    .find(b => normalizarTextoPainel(b.dsei) === nome) || null;
}

// O lado "reduzido" está liberado para o DSEI atual?
//   - sem PSS no DSEI: liberado;
//   - com PSS e usuário < super admin: bloqueado;
//   - com PSS e super admin: bloqueado até confirmar "editar pontualmente".
function reduzidoLiberadoRemanejamento() {
  const bloqueio = bloqueioPSSDoDseiSelecionado();
  if (!bloqueio) return true;
  if (nivelUsuarioRemanejamento() < 3) return false;
  return state.remanejamentoPssLiberadoDsei === normalizarTextoPainel(bloqueio.dsei);
}

export function montarOpcoesCargosRemanejamento(tipo) {
  const idDsei = String(document.getElementById("remanejamentoDsei")?.value || "");
  let rows = (state.remanejamentoCadastroRows || [])
    .filter(row => !idDsei || String(row.idDseiCasai || "") === idDsei);

  // Bloqueio por PSS afeta apenas o lado reduzido.
  if (tipo === "reduzido") {
    const bloqueio = bloqueioPSSDoDseiSelecionado();
    if (bloqueio) {
      // DSEI ainda bloqueado (admin comum ou super admin sem liberar): nenhuma opção.
      if (!reduzidoLiberadoRemanejamento()) return [];
      // Liberado pelo super admin: remove o(s) cargo(s) do próprio processo seletivo,
      // que permanece(m) bloqueado(s) para todos.
      const cargosPSS = (bloqueio.cargos || []).map(c => normalizarTextoPainel(c));
      if (cargosPSS.length) {
        rows = rows.filter(row => !cargosPSS.includes(normalizarTextoPainel(row.cargo || "")));
      }
    }
  }

  return rows
    .slice()
    .sort((a, b) => String(a.cargo || "").localeCompare(String(b.cargo || ""), "pt-BR"))
    .map(row => {
      const cargo = row.cargo || `Cargo ID ${row.idCargoFuncao}`;
      const ociosas = Math.max(0, Math.floor(Number(row.vagasOciosas || 0)));
      return {
        value: String(row.idCargoFuncao || ""),
        // Mostra quantas vagas ociosas o cargo tem no DSEI selecionado.
        label: `${cargo} — ${ociosas} ociosa(s)`,
        row
      };
    });
}

export function obterCadastroCargoRemanejamento(idCargoFuncao) {
  const idDsei = String(document.getElementById("remanejamentoDsei")?.value || "");
  return (state.remanejamentoCadastroRows || []).find(row => {
    return String(row.idDseiCasai || "") === idDsei
      && String(row.idCargoFuncao || "") === String(idCargoFuncao || "");
  }) || null;
}

export function preencherSelectRemanejamento(id, items, labelFn) {
  const select = document.getElementById(id);
  if (!select) return;

  select.innerHTML = (items || []).map(item => `
        <option value="${escapeAttr(item.value)}">${escapeHtml(labelFn(item))}</option>
      `).join("");

  // Torna o dropdown pesquisável (idempotente) e re-sincroniza o texto exibido.
  tornarSelectPesquisavel(select, { placeholder: "Pesquise o DSEI/CASAI…" });
  sincronizarSelectPesquisavel(select);
}

export function abrirFormularioRemanejamento() {
  exibirViewRemanejamento("remanejamento");
  inicializarFormularioRemanejamento();
  atualizarResumoRemanejamento();
}

export function voltarListaRemanejamento() {
  exibirViewRemanejamento("remanejamento");
}

export function exibirViewRemanejamento(view) {
  state.activeView = view;

  document.querySelectorAll(".viewPanel").forEach(panel => panel.classList.remove("active"));
  const panel = document.getElementById("view-remanejamento");
  if (panel) panel.classList.add("active");

  document.querySelectorAll(".navItem").forEach(item => {
    item.classList.toggle("active", item.dataset.view === "remanejamento");
  });

  atualizarModoRolagem("remanejamento");
  garantirCarregamentoPagina("remanejamento");
}

// Botões de ação da linha (delegação `data-click` global trata os cliques).
// Permissões reavaliadas a cada render (o nível do usuário pode mudar após login).
function acoesRemHtml(row) {
  // Nível EFETIVO no módulo Remanejamento (override por perfil de acesso ou, na
  // ausência, o global) — não o global puro. Assim um perfil "Administrador" no
  // módulo enxerga as ações corretamente.
  const nivelUsuario = nivelUsuarioRemanejamento();
  const podeExcluir = nivelUsuario >= NIVEL.ADMIN;      // Excluir: Editor(2)/Admin(3)
  const podeEditar = nivelUsuario >= NIVEL.SUPERADMIN;  // Alterar: só Admin(3)
  const id = escapeAttr(row.idProcesso);
  const btnDetalhe = `<button type="button" class="remAcaoBtn" title="Ver detalhes" data-click="detalhe-rem" data-id="${id}"><i class="fa-solid fa-info"></i></button>`;
  const btnEditar = podeEditar
    ? `<button type="button" class="remAcaoBtn remAcaoEditar" title="Alterar remanejamento" data-click="editar-rem" data-id="${id}"><i class="fa-solid fa-pen-to-square"></i></button>`
    : "";
  const btnExcluir = podeExcluir
    ? `<button type="button" class="remAcaoBtn remAcaoExcluir" title="Excluir remanejamento" data-click="excluir-rem" data-id="${id}"><i class="fa-solid fa-trash"></i></button>`
    : "";
  return `${btnDetalhe}${btnEditar}${btnExcluir}`;
}

const REM_COLS = [
  { title: "Data", field: "dataCriacaoFormatada", minWidth: 90,
    formatter: c => { const r = c.getRow().getData(); return escapeHtml(r.dataCriacaoFormatada || r.dataCriacao || "-"); } },
  { title: "DSEI", field: "dseiCasai", minWidth: 90, formatter: c => escapeHtml(c.getValue() || "-") },
  { title: "Competência", field: "competencia", minWidth: 90, formatter: c => escapeHtml(c.getValue() || "-") },
  { title: "Vaga Reduzida", field: "cargosReduzidos", minWidth: 160, formatter: c => formatarCargosRemanejamento(c.getValue(), "reduzido") },
  { title: "Valor Reduzido", field: "totalReduzidoPeriodo", minWidth: 110, cssClass: "remValorReduzido", formatter: c => formatCurrency(c.getValue()) },
  { title: "Vaga Acrescentada", field: "cargosAcrescentados", minWidth: 160, formatter: c => formatarCargosRemanejamento(c.getValue(), "acrescentado") },
  { title: "Valor Acrescentado", field: "totalAcrescentadoPeriodo", minWidth: 110, cssClass: "remValorAcrescentado", formatter: c => formatCurrency(c.getValue()) },
  { title: "Impacto Mensal", field: "impactoMensal", minWidth: 110,
    formatter: c => { const v = Number(c.getValue() || 0); return `<span class="${classeValorImpacto(v)}">${formatCurrency(v)}</span>`; } },
  { title: "Responsável", field: "inseridoPorEmail", minWidth: 120,
    formatter: c => { const r = c.getRow().getData(); return escapeHtml(r.inseridoPorEmail || r.criadoPor || "-"); } },
  { title: "Ações", field: "_acoes", headerSort: false, minWidth: 110, cssClass: "remAcoesCell", formatter: c => acoesRemHtml(c.getRow().getData()) }
];

function garantirGradeRem() {
  if (!gradeRem) {
    gradeRem = criarTabelaArrastavel({
      elemento: "remanejamentoBody",
      colunas: REM_COLS,
      persistID: "remHistoricoV1",
      indexField: "idProcesso",
      movableRows: false,
      idSelecionado: () => remDetalheAberto,
      vazio: "Nenhum remanejamento registrado."
    });
  }
  return gradeRem;
}

// Fecha o painel de detalhe (some ao re-renderizar a lista, como era no antigo <tr>).
function fecharDetalheRem() {
  remDetalheAberto = null;
  const panel = document.getElementById("remDetalhePanel");
  if (panel) { panel.hidden = true; panel.innerHTML = ""; }
}

export function renderRemanejamentoLista() {
  aplicarModoLeituraRemanejamento();
  atualizarIndicadoresRemanejamento();
  if (!document.getElementById("remanejamentoBody")) return;

  const grade = garantirGradeRem();
  fecharDetalheRem();

  if (!pageLoadState.remanejamentoLista) {
    grade.render([], "Carregando dados de remanejamento...");
    return;
  }
  if (!state.remanejamentoListaRows.length) {
    grade.render([], "Nenhum remanejamento registrado.");
    return;
  }

  const termo = normalizarTextoPainel(document.getElementById("remanejamentoSearch")?.value || "");
  const status = String(document.getElementById("remanejamentoStatusFiltro")?.value || "");

  const rows = (state.remanejamentoListaRows || []).filter(row => {
    if (status && String(row.situacao || "") !== status) return false;
    if (!termo) return true;
    const texto = normalizarTextoPainel([
      row.dataCriacaoFormatada || row.dataCriacao,
      row.dseiCasai,
      row.competencia,
      row.cargosReduzidos,
      row.cargosAcrescentados,
      row.numeroProcessoSei,
      row.inseridoPorEmail,
      row.situacao
    ].join(" "));
    return texto.includes(termo);
  });

  if (!rows.length) {
    grade.render([], "Nenhum remanejamento encontrado para a busca informada.");
    return;
  }

  // Linhas vão para a grade Tabulator; o cabeçalho/ações ficam nas colunas
  // (REM_COLS). As permissões dos botões são avaliadas no formatter (acoesRemHtml).
  grade.render(rows);
}

// Separa as vagas (vindas como "CARGO x2 | OUTRO x1") em divs distintos e troca
// o sufixo "xN" por "- N un" em cada vaga.
export function formatarCargosRemanejamento(texto, variante) {
  const raw = String(texto || "").trim();
  if (!raw || raw === "-") return "-";
  const classeVariante = variante === "reduzido"
    ? " remCargoReduzido"
    : variante === "acrescentado"
      ? " remCargoAcrescentado"
      : "";
  return raw
    .split(" | ")
    .map(item => {
      const formatado = item.replace(/\s*x\s*(\d+)\s*$/i, " - $1 un");
      return `<div class="remCargoItem${classeVariante}">${escapeHtml(formatado)}</div>`;
    })
    .join("");
}

export function classeValorImpacto(valor) {
  const n = Number(valor || 0);
  return n < 0 ? "remNegativo" : n > 0 ? "remPositivo" : "";
}

export async function alternarDetalheRemanejamento(idProcesso) {
  const panel = document.getElementById("remDetalhePanel");
  if (!panel) return;

  // Toggle: clicar de novo no mesmo remanejamento fecha o painel.
  if (remDetalheAberto != null && String(remDetalheAberto) === String(idProcesso)) {
    fecharDetalheRem();
    gradeRem?.marcarSelecionada();
    return;
  }

  remDetalheAberto = String(idProcesso);
  gradeRem?.marcarSelecionada();   // destaca a linha do detalhe aberto
  panel.hidden = false;
  panel.innerHTML = `<div class="remDetalheCell">Carregando detalhes...</div>`;
  // A tabela pode ser longa e o painel abre abaixo dela: traz à vista.
  setTimeout(() => panel.scrollIntoView({ behavior: "smooth", block: "nearest" }), 40);

  try {
    let detalhe = detalhesRemanejamentoCache[idProcesso];
    if (!detalhe) {
      detalhe = await apiGet(`/api/remanejamento/detalhe/${encodeURIComponent(idProcesso)}`);
      detalhesRemanejamentoCache[idProcesso] = detalhe;
    }
    // O usuário pode ter fechado/trocado enquanto carregava: não sobrescreve.
    if (String(remDetalheAberto) !== String(idProcesso)) return;
    const rowLista = (state.remanejamentoListaRows || []).find(r => String(r.idProcesso) === String(idProcesso)) || {};
    panel.innerHTML = renderDetalheRemanejamentoHtml(detalhe, rowLista);
  } catch (error) {
    if (String(remDetalheAberto) !== String(idProcesso)) return;
    panel.innerHTML = `<div class="remDetalheCell">Erro ao carregar detalhes: ${escapeHtml(error && error.message ? error.message : String(error))}</div>`;
  }
}

export function renderTabelaDetalheRemanejamento(titulo, itens) {
  const linhas = (itens || []).map(item => `
        <tr>
          <td>${escapeHtml(item.cargo || "-")}</td>
          <td>${formatNumber(item.quantidade)}</td>
          <td>${formatNumber(item.meses)}</td>
          <td>${formatCurrency(item.salario)}</td>
          <td>${formatCurrency(item.insalubridade)}</td>
          <td>${formatCurrency(item.gratificacaoRt)}</td>
          <td>${formatCurrency(item.noturno)}</td>
          <td>${formatCurrency(item.encargos)}</td>
          <td>${formatCurrency(item.provisoes)}</td>
          <td>${formatCurrency(item.valeAlimentacao)}</td>
          <td>${formatCurrency(item.mensal)}</td>
          <td>${formatCurrency(item.periodo)}</td>
        </tr>
      `).join("");

  const totalMensal = (itens || []).reduce((s, i) => s + Number(i.mensal || 0), 0);
  const totalPeriodo = (itens || []).reduce((s, i) => s + Number(i.periodo || 0), 0);

  return `
        <div class="remDetalheTitulo">${escapeHtml(titulo)}</div>
        <div class="remDetalheTableWrap">
          <table class="remTable remDetalheTable">
            <thead>
              <tr>
                <th>Cargo</th><th>Qtd.</th><th>Meses</th><th>Salário</th><th>Insal./Peric.</th>
                <th>Grat. RT</th><th>Noturno</th><th>Encargos</th><th>Provisões</th><th>Vale Alim.</th><th>Mensal</th><th>Período</th>
              </tr>
            </thead>
            <tbody>${linhas || '<tr><td colspan="12">Sem itens.</td></tr>'}</tbody>
            <tfoot>
              <tr><td colspan="10">TOTAL</td><td>${formatCurrency(totalMensal)}</td><td>${formatCurrency(totalPeriodo)}</td></tr>
            </tfoot>
          </table>
        </div>
      `;
}

export function renderDetalheRemanejamentoHtml(detalhe, rowLista) {
  const impacto = Number(detalhe.impactoMensal || 0);
  const anexo = rowLista.anexoOficioUrl
    ? `<a class="remAnexoLink" href="${escapeAttr(safeUrl(rowLista.anexoOficioUrl))}" target="_blank" rel="noopener noreferrer">Abrir PDF</a>`
    : "—";

  return `
        <div class="remDetalheBox">
          ${renderTabelaDetalheRemanejamento("VAGAS REDUZIDAS", detalhe.reduzidos)}
          ${renderTabelaDetalheRemanejamento("VAGAS ACRESCENTADAS", detalhe.acrescentados)}
          <div class="remDetalheImpacto ${classeValorImpacto(impacto)}">Impacto Mensal: ${formatCurrency(impacto)}</div>
          <div class="remDetalheMeta">
            <div><strong>Usuário:</strong> ${escapeHtml(rowLista.inseridoPorEmail || rowLista.criadoPor || "-")}</div>
            <div><strong>Processo SEI:</strong> ${escapeHtml(rowLista.numeroProcessoSei || "-")}</div>
            <div><strong>Documento PDF:</strong> ${anexo}</div>
            <div><strong>Observação:</strong> ${escapeHtml(rowLista.observacao || "-")}</div>
          </div>
        </div>
      `;
}

// Carrega um remanejamento existente no formulário para edição e ativa o modo edição.
export async function editarRemanejamentoPainel(idProcesso) {
  if (nivelUsuarioRemanejamento() < NIVEL.ADMIN) return; // defesa em profundidade: leitor não edita (backend também exige >= 2)
  mostrarCarregando();
  let dados;
  try {
    dados = await apiGet(`/api/remanejamento/edicao/${encodeURIComponent(idProcesso)}`);
  } catch (error) {
    ocultarCarregando();
    await abrirAviso({
      titulo: "Erro ao carregar",
      msg: `Não foi possível carregar o remanejamento para edição: ${error && error.message ? error.message : error}`,
      perigo: true
    });
    return;
  }
  ocultarCarregando();

  // Garante que os selects (DSEI/cargos) já estão populados antes de preencher.
  const dseis = montarOpcoesDseiRemanejamento();
  preencherSelectRemanejamento("remanejamentoDsei", dseis, item => item.label);

  // 1) DSEI e mês precisam vir antes das linhas (afetam cadastro do cargo e meses).
  setValue("remanejamentoDsei", String(dados.idDseiCasai || ""));
  sincronizarSelectPesquisavel(document.getElementById("remanejamentoDsei"));
  const mesEl = document.getElementById("remanejamentoMes");
  if (mesEl) {
    mesEl.value = String(dados.mes || (new Date().getMonth() + 1));
    mesEl.dataset.tocado = "1";
    tornarSelectPesquisavel(mesEl, { placeholder: "Pesquise o mês…" });
    sincronizarSelectPesquisavel(mesEl);
  }

  // 2) Linhas reduzido/acrescentado a partir dos IDs salvos.
  state.remanejamentoLinhas.reduzido = (dados.reduzidos || []).map(item => construirLinhaEdicaoRemanejamento("reduzido", item));
  state.remanejamentoLinhas.acrescentado = (dados.acrescentados || []).map(item => construirLinhaEdicaoRemanejamento("acrescentado", item));
  if (!state.remanejamentoLinhas.reduzido.length) state.remanejamentoLinhas.reduzido = [criarLinhaRemanejamento("reduzido", {})];
  if (!state.remanejamentoLinhas.acrescentado.length) state.remanejamentoLinhas.acrescentado = [criarLinhaRemanejamento("acrescentado", {})];

  // 3) Documentação.
  setValue("remanejamentoProcessoSei", dados.processoSei || "");
  setValue("remObservacao", dados.observacao || "");
  const anexo = document.getElementById("remAnexoArquivo");
  if (anexo) { anexo.value = ""; anexo._fi?.render(); }

  // 4) Ativa o modo edição (borda amarela + banner + botão "Atualizar").
  state.remanejamentoEditandoId = dados.idProcesso;
  aplicarModoEdicaoRemanejamento(true, dados.idProcesso);

  renderLinhasRemanejamento("reduzido");
  renderLinhasRemanejamento("acrescentado");
  atualizarResumoRemanejamento();

  document.getElementById("remPageShell")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Monta uma linha do formulário a partir de { idCargoFuncao, quantidade } salvos,
// buscando os custos no cadastro do DSEI já selecionado.
function construirLinhaEdicaoRemanejamento(tipo, item) {
  const linha = criarLinhaRemanejamento(tipo, { quantidade: item.quantidade });
  const cadastro = obterCadastroCargoRemanejamento(item.idCargoFuncao);
  linha.idCargoFuncao = String(item.idCargoFuncao || "");
  linha.cargo = cadastro?.cargo || "";
  // Nas reduções, credita de volta a quantidade original: as vagas ociosas do
  // cadastro já descontam esta redução, então sem o crédito a edição bloquearia.
  const baseOciosas = Number(cadastro?.vagasOciosas || 0);
  linha.vagasOciosas = tipo === "reduzido"
    ? baseOciosas + Math.max(0, Number(item.quantidade || 0))
    : baseOciosas;
  linha.salarioBase = Number(cadastro?.salarioBase || 0);
  linha.insalubridadePericulosidade = Number(cadastro?.insalubridadePericulosidade || 0);
  linha.gratificacaoRt = Number(cadastro?.gratificacaoRt || 0);
  linha.adicionalNoturno = Number(cadastro?.adicionalNoturno || 0);
  linha.encargos = Number(cadastro?.encargos || 0);
  linha.provisoes = Number(cadastro?.provisoes || 0);
  linha.valeAlimentacao = Number(cadastro?.valeAlimentacao || 0);
  linha.quantidade = Math.max(1, Number(item.quantidade || 1));
  return linha;
}

// Liga/desliga o indicador visual de edição (borda amarela, banner e label do botão).
export function aplicarModoEdicaoRemanejamento(ativo, idProcesso) {
  const shell = document.getElementById("remEditArea");
  if (shell) shell.classList.toggle("remEditandoForm", !!ativo);

  const banner = document.getElementById("remEditandoBanner");
  if (banner) banner.style.display = ativo ? "" : "none";

  setText("remEditandoId", ativo ? `#${idProcesso}` : "");

  const botao = document.getElementById("remSaveBtn");
  if (botao) botao.textContent = ativo ? "Atualizar Remanejamento" : "Salvar Remanejamento";
}

export function cancelarEdicaoRemanejamento() {
  state.remanejamentoEditandoId = null;
  aplicarModoEdicaoRemanejamento(false);
  limparFormularioRemanejamento();
}

export async function excluirRemanejamentoPainel(idProcesso) {
  if (nivelUsuarioRemanejamento() < NIVEL.ADMIN) return; // defesa em profundidade: leitor não exclui (backend também exige >= 2)
  const confirmacao = await abrirModal({
    titulo: "Excluir remanejamento",
    msg: "Tem certeza que deseja excluir este remanejamento? Esta ação remove o registro nas tabelas de movimentação e processo de remanejamento e não pode ser desfeita.",
    confirmarTexto: "Excluir",
    perigo: true
  });
  if (!confirmacao.ok) return;

  mostrarCarregando();
  try {
    const response = await fetch(`/api/remanejamento/${encodeURIComponent(idProcesso)}`, {
      method: "DELETE"
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Erro ${response.status}`);

    delete detalhesRemanejamentoCache[idProcesso];
    // Atualiza todos os dados afetados pela exclusão (vagas ociosas voltam ao saldo,
    // monitoramento, alertas, visão geral e a própria lista).
    await recarregarTodosOsDados();
    ocultarCarregando();
    await abrirAviso({ titulo: "Remanejamento excluído", msg: "Remanejamento excluído com sucesso." });
  } catch (error) {
    ocultarCarregando();
    await abrirAviso({
      titulo: "Erro ao excluir",
      msg: `Erro ao excluir remanejamento: ${error && error.message ? error.message : error}`,
      perigo: true
    });
  }
}

export function renderRemanejamentoListaErro(error) {
  if (!document.getElementById("remanejamentoBody")) return;
  fecharDetalheRem();
  garantirGradeRem().render([], `Erro ao carregar remanejamentos: ${escapeHtml(error && error.message ? error.message : String(error))}`);
}

export function atualizarVagasOrigemPorDsei() {
  // Troca de DSEI cancela qualquer liberação pontual concedida pelo super admin.
  state.remanejamentoPssLiberadoDsei = null;
  state.remanejamentoLinhas.reduzido = [criarLinhaRemanejamento("reduzido", { quantidade: 1, meses: REMANEJAMENTO_MESES_PADRAO })];
  state.remanejamentoLinhas.acrescentado = [criarLinhaRemanejamento("acrescentado", { quantidade: 1, meses: REMANEJAMENTO_MESES_PADRAO })];
  renderLinhasRemanejamento("reduzido");
  renderLinhasRemanejamento("acrescentado");
  atualizarResumoRemanejamento();
}

export function atualizarResumoRemanejamento() {
  const dseiSelect = document.getElementById("remanejamentoDsei");
  const dseiLabel = dseiSelect?.options?.[dseiSelect.selectedIndex]?.text || "DSEI não selecionado";
  const processoInput = document.getElementById("remanejamentoProcessoSei");
  const anexoPreview = document.getElementById("remanejamentoAnexoPreview");
  const processo = processoInput?.value || "";
  const resumoFinanceiro = atualizarResumoRemanejamentoPainel();
  const qtdMovimentada = soma(coletarLinhasRemanejamento("reduzido"), "quantidade") + soma(coletarLinhasRemanejamento("acrescentado"), "quantidade");

  setText(
    "remanejamentoCalculoTexto",
    `${dseiLabel}. Processo SEI: ${processo || "não informado"}. Impacto mensal previsto: ${formatCurrency(resumoFinanceiro.impactoMensal)}.`
  );

  setText("remanejamentoResultadoTotal", formatNumber(qtdMovimentada));

  if (anexoPreview) {
    // O arquivo selecionado agora aparece no chip do componente; aqui fica só a dica.
    anexoPreview.textContent = "Selecione o PDF pelo botão acima. Até 10MB.";
  }

  atualizarAvisoOciosasRemanejamento();
}

export function atualizarAvisoOciosasRemanejamento() {
  const erros = validarOciosasReduzidoCliente();
  const aviso = document.getElementById("remOciosasAviso");
  const botao = document.getElementById("remSaveBtn");

  // Atualiza o banner de PSS e descobre se a redução do DSEI está bloqueada.
  const pssBloqueado = atualizarBloqueioPSSRemanejamento();

  if (aviso) {
    if (erros.length) {
      aviso.hidden = false;
      aviso.innerHTML = `⚠ <strong>Não é possível salvar:</strong> não há vagas ociosas suficientes para reduzir — ${erros.map(escapeHtml).join("; ")}.`;
    } else {
      aviso.hidden = true;
      aviso.innerHTML = "";
    }
  }

  if (botao) {
    const bloqueado = erros.length > 0 || pssBloqueado;
    botao.disabled = bloqueado;
    botao.classList.toggle("remSaveBtnBloqueado", bloqueado);
    botao.title = pssBloqueado
      ? "Redução bloqueada: o DSEI possui processo seletivo em andamento."
      : erros.length
        ? "Ajuste as quantidades reduzidas: não há vagas ociosas suficientes."
        : "";
  }

  return erros;
}

// Atualiza o banner de bloqueio por PSS no lado reduzido e habilita/desabilita o
// botão "Adicionar Cargo" do reduzido. Retorna true quando a redução está bloqueada.
export function atualizarBloqueioPSSRemanejamento() {
  const aviso = document.getElementById("remPssBloqueioAviso");
  const btnAddReduzido = document.querySelector('[data-click="adicionar-linha-rem"][data-tipo="reduzido"]');
  const bloqueio = bloqueioPSSDoDseiSelecionado();

  if (!bloqueio) {
    if (aviso) { aviso.hidden = true; aviso.innerHTML = ""; }
    if (btnAddReduzido) btnAddReduzido.disabled = false;
    return false;
  }

  const liberado = reduzidoLiberadoRemanejamento();
  const processosTxt = (bloqueio.processos || []).join(", ");
  const cargosTxt = (bloqueio.cargos || []).join(", ");

  let html = "";
  if (!liberado) {
    html = `🔒 <strong>Redução bloqueada:</strong> o DSEI <strong>${escapeHtml(bloqueio.dsei)}</strong> possui processo(s) seletivo(s) em andamento (${escapeHtml(processosTxt)}). Não é possível reduzir vagas deste DSEI enquanto o processo estiver ativo.`;
    if (nivelUsuarioRemanejamento() >= 3) {
      html += ` <button type="button" class="remSecondaryBtn remLiberarPssBtn" data-click="liberar-pss-rem">Editar pontualmente (liberar redução)</button>`;
    }
  } else {
    html = `🔓 <strong>Redução liberada pontualmente pelo super administrador.</strong> O(s) cargo(s) do processo seletivo permanece(m) bloqueado(s): <strong>${escapeHtml(cargosTxt)}</strong>.`;
  }

  if (aviso) { aviso.hidden = false; aviso.innerHTML = html; }
  // O botão de adicionar cargo reduzido só fica ativo quando a redução está liberada.
  if (btnAddReduzido) btnAddReduzido.disabled = !liberado;

  return !liberado;
}

// Ação do super administrador: liberar pontualmente a redução dos demais cargos
// do DSEI (o cargo do processo seletivo continua bloqueado).
export async function liberarBloqueioPSSRemanejamento() {
  if (nivelUsuarioRemanejamento() < 3) return;
  const bloqueio = bloqueioPSSDoDseiSelecionado();
  if (!bloqueio) return;

  const cargosTxt = (bloqueio.cargos || []).join(", ") || "—";
  const confirmacao = await abrirModal({
    titulo: "Liberar redução pontualmente",
    msg: `O DSEI ${bloqueio.dsei} possui processo(s) seletivo(s) em andamento.\n\nComo super administrador, você pode liberar a redução de vagas dos demais cargos deste DSEI.\n\nO(s) cargo(s) do processo seletivo permanecerá(ão) bloqueado(s): ${cargosTxt}.\n\nDeseja liberar?`,
    confirmarTexto: "Liberar redução"
  });
  if (!confirmacao.ok) return;

  state.remanejamentoPssLiberadoDsei = normalizarTextoPainel(bloqueio.dsei);
  renderLinhasRemanejamento("reduzido");
  atualizarResumoRemanejamento();
}

export function atualizarIndicadoresRemanejamento() {
  setText("remKpiTotalRegistros", formatNumber(state.remanejamentoListaRows.length));
  setText("remKpiAnexos", formatNumber(state.remanejamentoListaRows.filter(row => row.temAnexo || row.anexoOficioUrl).length));
  setText("remKpiOrigens", formatNumber(new Set(state.remanejamentoListaRows.map(row => row.dseiCasai).filter(Boolean)).size));
}

export function inicializarFormularioRemanejamento(resetar) {
  // Padrão do mês = mês atual (mesmo cálculo já definido) ao abrir/resetar o form.
  const mesEl = document.getElementById("remanejamentoMes");
  if (mesEl && (resetar || !(Number(mesEl.value) >= 1 && Number(mesEl.value) <= 12) || !mesEl.dataset.tocado)) {
    mesEl.value = String(new Date().getMonth() + 1);
    mesEl.dataset.tocado = "1";
  }
  if (mesEl) {
    tornarSelectPesquisavel(mesEl, { placeholder: "Pesquise o mês…" });
    sincronizarSelectPesquisavel(mesEl);
  }

  if (resetar || !state.remanejamentoLinhas.reduzido.length) {
    state.remanejamentoLinhas.reduzido = [criarLinhaRemanejamento("reduzido", { quantidade: 1, meses: REMANEJAMENTO_MESES_PADRAO })];
  }

  if (resetar || !state.remanejamentoLinhas.acrescentado.length) {
    state.remanejamentoLinhas.acrescentado = [criarLinhaRemanejamento("acrescentado", { quantidade: 1, meses: REMANEJAMENTO_MESES_PADRAO })];
  }

  renderLinhasRemanejamento("reduzido");
  renderLinhasRemanejamento("acrescentado");
  atualizarResumoRemanejamentoPainel();
}

// Mês escolhido no formulário (1..12). Sem seleção válida, usa o mês atual.
export function mesRemanejamentoSelecionado() {
  const v = Number(document.getElementById("remanejamentoMes")?.value);
  return v >= 1 && v <= 12 ? v : new Date().getMonth() + 1;
}

// Meses do mês escolhido até dezembro (mesma regra do servidor: 13 - mês).
export function mesesRemanejamentoSelecionado() {
  return Math.max(1, 13 - mesRemanejamentoSelecionado());
}

export function criarLinhaRemanejamento(tipo, valores) {
  return {
    id: `${tipo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    idCargoFuncao: valores?.idCargoFuncao || "",
    cargo: valores?.cargo || "",
    quantidade: Number(valores?.quantidade || 1),
    vagasOciosas: Number(valores?.vagasOciosas || 0),
    meses: mesesRemanejamentoSelecionado(),
    salarioBase: Number(valores?.salarioBase || 0),
    insalubridadePericulosidade: Number(valores?.insalubridadePericulosidade || 0),
    gratificacaoRt: Number(valores?.gratificacaoRt || 0),
    adicionalNoturno: Number(valores?.adicionalNoturno || 0),
    encargos: Number(valores?.encargos || 0),
    provisoes: Number(valores?.provisoes || 0),
    valeAlimentacao: Number(valores?.valeAlimentacao || 0)
  };
}

// Mês alterado: recalcula os meses de todas as linhas (reduzido/acrescentado) e
// atualiza o resumo/impacto do período.
export function alterarMesRemanejamento() {
  const meses = mesesRemanejamentoSelecionado();
  ["reduzido", "acrescentado"].forEach(tipo => {
    (state.remanejamentoLinhas[tipo] || []).forEach(linha => { linha.meses = meses; });
    renderLinhasRemanejamento(tipo);
  });
  atualizarResumoRemanejamento();
}

export function adicionarLinhaRemanejamento(tipo) {
  if (nivelUsuarioRemanejamento() < NIVEL.ADMIN) return; // defesa em profundidade: leitor não edita o formulário
  state.remanejamentoLinhas[tipo] = state.remanejamentoLinhas[tipo] || [];
  state.remanejamentoLinhas[tipo].push(criarLinhaRemanejamento(tipo, { quantidade: 1, meses: REMANEJAMENTO_MESES_PADRAO }));
  renderLinhasRemanejamento(tipo);
  atualizarResumoRemanejamento();
}

export function removerLinhaRemanejamento(tipo, id) {
  if (nivelUsuarioRemanejamento() < NIVEL.ADMIN) return; // defesa em profundidade: leitor não edita o formulário
  state.remanejamentoLinhas[tipo] = (state.remanejamentoLinhas[tipo] || []).filter(item => item.id !== id);
  if (!state.remanejamentoLinhas[tipo].length) {
    state.remanejamentoLinhas[tipo].push(criarLinhaRemanejamento(tipo, { quantidade: 1, meses: REMANEJAMENTO_MESES_PADRAO }));
  }
  renderLinhasRemanejamento(tipo);
  atualizarResumoRemanejamento();
}

export function atualizarCampoLinhaRemanejamento(tipo, id, campo, valor) {
  const linha = (state.remanejamentoLinhas[tipo] || []).find(item => item.id === id);
  if (!linha) return;

  if (campo === "idCargoFuncao") {
    const cadastro = obterCadastroCargoRemanejamento(valor);
    linha.idCargoFuncao = valor;
    linha.cargo = cadastro?.cargo || "";
    linha.vagasOciosas = Number(cadastro?.vagasOciosas || 0);
    linha.salarioBase = Number(cadastro?.salarioBase || 0);
    linha.insalubridadePericulosidade = Number(cadastro?.insalubridadePericulosidade || 0);
    linha.gratificacaoRt = Number(cadastro?.gratificacaoRt || 0);
    linha.adicionalNoturno = Number(cadastro?.adicionalNoturno || 0);
    linha.encargos = Number(cadastro?.encargos || 0);
    linha.provisoes = Number(cadastro?.provisoes || 0);
    linha.valeAlimentacao = Number(cadastro?.valeAlimentacao || 0);
  } else if (["quantidade", "meses", "salarioBase", "insalubridadePericulosidade", "gratificacaoRt", "adicionalNoturno", "encargos", "provisoes", "valeAlimentacao"].includes(campo)) {
    linha[campo] = Number(valor || 0);
  } else {
    linha[campo] = valor;
  }

  atualizarResumoRemanejamento();
  renderLinhasRemanejamento(tipo);
}

export function renderLinhasRemanejamento(tipo) {
  const body = document.getElementById(tipo === "reduzido" ? "remReduzidoBody" : "remAcrescentadoBody");
  if (!body) return;

  const rows = state.remanejamentoLinhas[tipo] || [];
  const opcoesCargo = montarOpcoesCargosRemanejamento(tipo);
  const optionsHtml = ['<option value="">Selecione</option>'].concat(opcoesCargo.map(opt => `<option value="${escapeAttr(opt.value)}">${escapeHtml(opt.label)}</option>`)).join("");

  body.innerHTML = rows.map(row => {
    const total = calcularTotalLinhaRemanejamento(row);
    const selectHtml = `<select data-change="campo-linha-rem" data-tipo="${escapeAttr(tipo)}" data-id="${escapeAttr(row.id)}" data-campo="idCargoFuncao">${optionsHtml.replace(`value="${escapeAttr(row.idCargoFuncao)}"`, `value="${escapeAttr(row.idCargoFuncao)}" selected`)}</select>`;

    // Apenas para o lado reduzido: exibe vagas ociosas disponíveis e sinaliza quando falta.
    let infoOciosas = "";
    let classeLinha = "";
    if (tipo === "reduzido" && row.idCargoFuncao) {
      const ociosas = Math.max(0, Math.floor(Number(row.vagasOciosas || 0)));
      const solicitado = Math.max(0, Number(row.quantidade || 0));
      const excede = solicitado > ociosas;
      classeLinha = excede ? ' class="remLinhaInvalida"' : "";
      infoOciosas = `<div class="remOciosasInfo ${excede ? "remOciosasInfoErro" : ""}">${excede
          ? `⚠ Sem vaga ociosa suficiente: ${ociosas} disponível(is)`
          : `Vagas ociosas disponíveis: ${ociosas}`
        }</div>`;
    }

    return `
          <tr${classeLinha}>
            <td>${selectHtml}${infoOciosas}</td>
            <td><input type="number" min="0" step="1" value="${escapeAttr(row.quantidade)}" data-input="campo-linha-rem" data-tipo="${escapeAttr(tipo)}" data-id="${escapeAttr(row.id)}" data-campo="quantidade"></td>
            <td><span class="remMesesValor" title="Meses do mês atual até dezembro (calculado automaticamente).">${escapeHtml(row.meses)}</span></td>
            <td><strong>${formatCurrency(total.total)}</strong></td>
            <td><button type="button" class="remDeleteBtn" data-click="remover-linha-rem" data-tipo="${escapeAttr(tipo)}" data-id="${escapeAttr(row.id)}">🗑</button></td>
          </tr>
        `;
  }).join("");

  // Torna os selects de cargo pesquisáveis (recriados a cada render do corpo).
  body.querySelectorAll('select[data-change="campo-linha-rem"]').forEach(sel =>
    tornarSelectPesquisavel(sel, { placeholder: "Pesquise o cargo…" }));
}

export function validarOciosasReduzidoCliente() {
  const porCargo = {};
  (state.remanejamentoLinhas.reduzido || []).forEach(linha => {
    if (!linha.idCargoFuncao) return;
    const id = String(linha.idCargoFuncao);
    if (!porCargo[id]) {
      porCargo[id] = { cargo: linha.cargo || `Cargo ${id}`, ociosas: Math.max(0, Math.floor(Number(linha.vagasOciosas || 0))), solicitado: 0 };
    }
    porCargo[id].solicitado += Math.max(0, Number(linha.quantidade || 0));
  });

  return Object.values(porCargo)
    .filter(item => item.solicitado > item.ociosas)
    .map(item => `${item.cargo}: ${item.ociosas} vaga(s) ociosa(s), solicitado ${item.solicitado}`);
}

export function calcularTotalLinhaRemanejamento(row) {
  const quantidade = Math.max(0, Number(row.quantidade || 0));
  const meses = Math.max(1, Number(row.meses || 1));
  const salarioBase = Number(row.salarioBase || 0) * quantidade;
  const insalubridadePericulosidade = Number(row.insalubridadePericulosidade || 0) * quantidade;
  const gratificacaoRt = Number(row.gratificacaoRt || 0) * quantidade;
  const adicionalNoturno = Number(row.adicionalNoturno || 0) * quantidade;
  const encargos = Number(row.encargos || 0) * quantidade;
  const provisoes = Number(row.provisoes || 0) * quantidade;
  const valeAlimentacao = Number(row.valeAlimentacao || 0) * quantidade;
  const mensal = salarioBase + insalubridadePericulosidade + gratificacaoRt + adicionalNoturno + encargos + provisoes + valeAlimentacao;
  return { mensal, total: mensal * meses };
}

export function coletarLinhasRemanejamento(tipo) {
  return (state.remanejamentoLinhas[tipo] || [])
    .map(item => ({
      ...item,
      idCargoFuncao: Number(item.idCargoFuncao || 0),
      quantidade: Number(item.quantidade || 0),
      meses: Math.max(1, Number(item.meses || 1)),
      salarioBase: Number(item.salarioBase || 0),
      insalubridadePericulosidade: Number(item.insalubridadePericulosidade || 0),
      gratificacaoRt: Number(item.gratificacaoRt || 0),
      adicionalNoturno: Number(item.adicionalNoturno || 0),
      encargos: Number(item.encargos || 0),
      provisoes: Number(item.provisoes || 0),
      valeAlimentacao: Number(item.valeAlimentacao || 0)
    }))
    .filter(item => item.idCargoFuncao || item.quantidade || item.salarioBase || item.encargos || item.provisoes || item.valeAlimentacao);
}

export function calcularResumoLinhasRemanejamento(items) {
  return (items || []).reduce((acc, item) => {
    const quantidade = Number(item.quantidade || 0);
    const meses = Math.max(1, Number(item.meses || 1));
    const salarioBase = Number(item.salarioBase || 0) * quantidade;
    const insalubridadePericulosidade = Number(item.insalubridadePericulosidade || 0) * quantidade;
    const gratificacaoRt = Number(item.gratificacaoRt || 0) * quantidade;
    const adicionalNoturno = Number(item.adicionalNoturno || 0) * quantidade;
    const encargos = Number(item.encargos || 0) * quantidade;
    const provisoes = Number(item.provisoes || 0) * quantidade;
    const valeAlimentacao = Number(item.valeAlimentacao || 0) * quantidade;
    const mensal = salarioBase + insalubridadePericulosidade + gratificacaoRt + adicionalNoturno + encargos + provisoes + valeAlimentacao;
    acc.salarioBase += salarioBase;
    acc.insalubridadePericulosidade += insalubridadePericulosidade;
    acc.gratificacaoRt += gratificacaoRt;
    acc.adicionalNoturno += adicionalNoturno;
    acc.encargos += encargos;
    acc.provisoes += provisoes;
    acc.valeAlimentacao += valeAlimentacao;
    acc.mensal += mensal;
    acc.total += mensal * meses;
    return acc;
  }, { salarioBase: 0, insalubridadePericulosidade: 0, gratificacaoRt: 0, adicionalNoturno: 0, encargos: 0, provisoes: 0, valeAlimentacao: 0, mensal: 0, total: 0 });
}

export function atualizarResumoRemanejamentoPainel() {
  const reduzidos = coletarLinhasRemanejamento("reduzido");
  const acrescentados = coletarLinhasRemanejamento("acrescentado");
  const red = calcularResumoLinhasRemanejamento(reduzidos);
  const add = calcularResumoLinhasRemanejamento(acrescentados);
  const impactoMensal = add.mensal - red.mensal;
  const impactoPeriodo = add.total - red.total;

  setText("remTotalReduzidoTopo", formatCurrency(red.mensal));
  setText("remTotalAcrescentadoTopo", formatCurrency(add.mensal));
  setText("remImpactoMensalTopo", formatCurrency(impactoMensal));
  setText("remImpactoPeriodoTopo", formatCurrency(impactoPeriodo));
  setText("remTotalReduzidoTabela", formatCurrency(red.total));
  setText("remTotalAcrescentadoTabela", formatCurrency(add.total));
  setText("remTotalReduzidoMensal", formatCurrency(red.mensal));
  setText("remTotalAcrescentadoMensal", formatCurrency(add.mensal));
  setText("remImpactoMensal2", formatCurrency(impactoMensal));
  setText("remImpactoPeriodo2", formatCurrency(impactoPeriodo));
  setText("remImpactoPeriodoMeses", String(mesesRemanejamentoSelecionado()));

  setText("remSalarioRed", formatCurrency(red.salarioBase));
  setText("remSalarioAdd", formatCurrency(add.salarioBase));
  setText("remSalarioImpacto", formatCurrency(add.salarioBase - red.salarioBase));
  setText("remInsalRed", formatCurrency(red.insalubridadePericulosidade));
  setText("remInsalAdd", formatCurrency(add.insalubridadePericulosidade));
  setText("remInsalImpacto", formatCurrency(add.insalubridadePericulosidade - red.insalubridadePericulosidade));
  setText("remRtRed", formatCurrency(red.gratificacaoRt));
  setText("remRtAdd", formatCurrency(add.gratificacaoRt));
  setText("remRtImpacto", formatCurrency(add.gratificacaoRt - red.gratificacaoRt));
  setText("remNoturnoRed", formatCurrency(red.adicionalNoturno));
  setText("remNoturnoAdd", formatCurrency(add.adicionalNoturno));
  setText("remNoturnoImpacto", formatCurrency(add.adicionalNoturno - red.adicionalNoturno));
  setText("remEncargoRed", formatCurrency(red.encargos));
  setText("remEncargoAdd", formatCurrency(add.encargos));
  setText("remEncargoImpacto", formatCurrency(add.encargos - red.encargos));
  setText("remProvisaoRed", formatCurrency(red.provisoes));
  setText("remProvisaoAdd", formatCurrency(add.provisoes));
  setText("remProvisaoImpacto", formatCurrency(add.provisoes - red.provisoes));
  setText("remValeRed", formatCurrency(red.valeAlimentacao));
  setText("remValeAdd", formatCurrency(add.valeAlimentacao));
  setText("remValeImpacto", formatCurrency(add.valeAlimentacao - red.valeAlimentacao));
  setText("remResumoTotalRed", formatCurrency(red.mensal));
  setText("remResumoTotalAdd", formatCurrency(add.mensal));
  setText("remResumoTotalImpacto", formatCurrency(impactoMensal));

  ["remImpactoMensalTopo", "remImpactoPeriodoTopo", "remImpactoMensal2", "remImpactoPeriodo2", "remResumoTotalImpacto"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const value = id.includes("Periodo") ? impactoPeriodo : impactoMensal;
    el.classList.toggle("remNegativo", value < 0);
    el.classList.toggle("remPositivo", value > 0);
  });

  return { red, add, impactoMensal, impactoPeriodo };
}

export function limparFormularioRemanejamento() {
  // Limpar também cancela qualquer liberação pontual de PSS concedida pelo super admin.
  state.remanejamentoPssLiberadoDsei = null;
  state.remanejamentoLinhas = {
    reduzido: [criarLinhaRemanejamento("reduzido", { quantidade: 1, meses: REMANEJAMENTO_MESES_PADRAO })],
    acrescentado: [criarLinhaRemanejamento("acrescentado", { quantidade: 1, meses: REMANEJAMENTO_MESES_PADRAO })]
  };

  setValue("remanejamentoProcessoSei", "");
  setValue("remObservacao", "");
  // Padrão: mês atual (mesmo cálculo já definido).
  setValue("remanejamentoMes", String(new Date().getMonth() + 1));

  // Limpar também encerra o modo de edição, se estiver ativo.
  state.remanejamentoEditandoId = null;
  aplicarModoEdicaoRemanejamento(false);

  const anexo = document.getElementById("remAnexoArquivo");
  if (anexo) { anexo.value = ""; anexo._fi?.render(); }

  renderLinhasRemanejamento("reduzido");
  renderLinhasRemanejamento("acrescentado");
  atualizarResumoRemanejamento();
}

export async function salvarRemanejamentoPainel() {
  if (nivelUsuarioRemanejamento() < NIVEL.ADMIN) return; // defesa em profundidade: leitor não salva (backend também exige >= 2)
  const idDseiCasai = document.getElementById("remanejamentoDsei")?.value || "";
  const processoSei = document.getElementById("remanejamentoProcessoSei")?.value || "";
  const observacao = document.getElementById("remObservacao")?.value || "";
  const anexo = document.getElementById("remAnexoArquivo")?.files?.[0] || null;
  const linhasReduzido = coletarLinhasRemanejamento("reduzido").filter(item => item.idCargoFuncao && item.quantidade > 0);
  const linhasAcrescentado = coletarLinhasRemanejamento("acrescentado").filter(item => item.idCargoFuncao && item.quantidade > 0);

  if (!idDseiCasai) {
    await abrirAviso({ titulo: "Remanejamento bloqueado", msg: "Selecione o DSEI.", perigo: true });
    return;
  }
  if (!processoSei.trim()) {
    await abrirAviso({ titulo: "Remanejamento bloqueado", msg: "Informe o número do Processo SEI.", perigo: true });
    return;
  }
  if (!linhasReduzido.length || !linhasAcrescentado.length) {
    await abrirAviso({ titulo: "Remanejamento bloqueado", msg: "Informe ao menos um cargo reduzido e um cargo acrescentado.", perigo: true });
    return;
  }

  // Bloqueio por Processo Seletivo (frontend): impede reduzir vagas de DSEI com PSS ativo.
  const bloqueioPSS = bloqueioPSSDoDseiSelecionado();
  if (bloqueioPSS) {
    if (!reduzidoLiberadoRemanejamento()) {
      await abrirAviso({
        titulo: "Remanejamento bloqueado",
        msg: `O DSEI ${bloqueioPSS.dsei} possui processo seletivo em andamento (${bloqueioPSS.processos.join(", ")}). A redução de vagas deste DSEI está bloqueada enquanto o processo estiver ativo.`,
        perigo: true
      });
      return;
    }
    // Mesmo liberado pelo super admin, o cargo do processo seletivo permanece bloqueado.
    const cargosPSS = (bloqueioPSS.cargos || []).map(c => normalizarTextoPainel(c));
    const conflito = linhasReduzido.find(item => cargosPSS.includes(normalizarTextoPainel(item.cargo || "")));
    if (conflito) {
      await abrirAviso({
        titulo: "Remanejamento bloqueado",
        msg: `O cargo "${conflito.cargo}" está vinculado a um processo seletivo em andamento e não pode ser reduzido.`,
        perigo: true
      });
      return;
    }
  }

  const errosOciosas = atualizarAvisoOciosasRemanejamento();
  if (errosOciosas.length) {
    await abrirAviso({
      titulo: "Remanejamento bloqueado",
      msg: `Não é possível salvar: não há vagas ociosas suficientes para reduzir — ${errosOciosas.join("; ")}.`,
      perigo: true
    });
    return;
  }

  const resumo = atualizarResumoRemanejamentoPainel();
  if (resumo && (Number(resumo.impactoMensal || 0) > 0 || Number(resumo.impactoPeriodo || 0) > 0)) {
    await abrirAviso({
      titulo: "Remanejamento bloqueado",
      msg: "Remanejamento bloqueado: o impacto financeiro está positivo (aumento de custo). Ajuste os cargos para que o impacto fique zerado ou negativo.",
      perigo: true
    });
    return;
  }

  const editandoId = state.remanejamentoEditandoId;

  // Confirmação extra para evitar remanejamentos errados — resume os dados principais.
  const dseiNome = document.getElementById("remanejamentoDsei")?.selectedOptions?.[0]?.text || idDseiCasai;
  const impactoMensalFmt = formatCurrency(resumo ? resumo.impactoMensal : 0);
  const confirmacao = await abrirModal({
    titulo: editandoId ? "Confirmar alteração" : "Confirmar remanejamento",
    msg: `${editandoId ? `Você está alterando o remanejamento #${editandoId}.\n\n` : ""}Confira os dados antes de ${editandoId ? "atualizar" : "registrar"}:\nDSEI/CASAI: ${dseiNome}\nProcesso SEI: ${processoSei}\nImpacto mensal: ${impactoMensalFmt}\n\nEsta ação altera as vagas ociosas e o monitoramento.`,
    confirmarTexto: editandoId ? "Atualizar remanejamento" : "Confirmar remanejamento"
  });
  if (!confirmacao.ok) return;

  await enviarRemanejamento({ idDseiCasai, processoSei, observacao, anexo, linhasReduzido, linhasAcrescentado, editandoId });
}

// Monta o FormData, envia ao backend (cria ou atualiza) e trata sucesso/erro com
// feedback visual. Extraído de salvarRemanejamentoPainel para separar o envio das
// validações e da confirmação.
async function enviarRemanejamento({ idDseiCasai, processoSei, observacao, anexo, linhasReduzido, linhasAcrescentado, editandoId }) {
  const formData = new FormData();
  formData.append("idDseiCasai", idDseiCasai);
  formData.append("processoSei", processoSei);
  formData.append("observacao", observacao);
  formData.append("mes", String(mesRemanejamentoSelecionado()));
  formData.append("criadoPor", "painel");
  formData.append("linhasReduzido", JSON.stringify(linhasReduzido));
  formData.append("linhasAcrescentado", JSON.stringify(linhasAcrescentado));
  if (anexo) formData.append("anexo", anexo);

  const url = editandoId
    ? `/api/remanejamento/${encodeURIComponent(editandoId)}`
    : "/api/remanejamento/salvar";
  const metodo = editandoId ? "PUT" : "POST";

  mostrarCarregando();
  try {
    const response = await fetch(url, {
      method: metodo,
      body: formData
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Erro ${response.status}`);

    state.remanejamentoEditandoId = null;
    aplicarModoEdicaoRemanejamento(false);
    limparFormularioRemanejamento();
    // Atualiza todos os dados afetados: lista de remanejamentos, vagas ociosas do
    // formulário, monitoramento, alertas e visão geral.
    await recarregarTodosOsDados();
    ocultarCarregando();
    await abrirAviso({
      titulo: editandoId ? "Remanejamento atualizado" : "Remanejamento salvo",
      msg: editandoId ? "Remanejamento atualizado com sucesso." : "Remanejamento salvo com sucesso."
    });
  } catch (error) {
    ocultarCarregando();
    await abrirAviso({
      titulo: editandoId ? "Erro ao atualizar" : "Erro ao salvar",
      msg: `Erro ao ${editandoId ? "atualizar" : "salvar"} remanejamento: ${error && error.message ? error.message : error}`,
      perigo: true
    });
  }
}
