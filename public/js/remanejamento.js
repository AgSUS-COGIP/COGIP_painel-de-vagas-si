import { idSeguroAlerta } from "./alertas.js";
import { apiGet } from "./api.js";
import { garantirCarregamentoPagina, recarregarTodosOsDados } from "./app.js";
import { REMANEJAMENTO_EMPTY_OPTION } from "./constants.js";
import { atualizarModoRolagem } from "./filtros.js";
import { detalhesRemanejamentoCache, pageLoadState } from "./runtime.js";
import { state } from "./state.js";
import { cssEscapeAttr, escapeAttr, escapeHtml, formatCurrency, formatNumber, mesesAteFimDoAno, normalizarTextoPainel, setText, setValue, soma } from "./utils.js";

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

export function configurarRemanejamento() {
  state.remanejamentoDetalhePage = 1;

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

export function montarOpcoesCargosRemanejamento() {
  const idDsei = String(document.getElementById("remanejamentoDsei")?.value || "");
  return (state.remanejamentoCadastroRows || [])
    .filter(row => !idDsei || String(row.idDseiCasai || "") === idDsei)
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

export function renderRemanejamentoLista() {
  const tbody = document.getElementById("remanejamentoBody");
  atualizarIndicadoresRemanejamento();
  if (!tbody) return;

  if (!pageLoadState.remanejamentoLista) {
    tbody.innerHTML = '<tr><td class="remanejamentoEmpty" colspan="10">Carregando dados de remanejamento...</td></tr>';
    return;
  }

  if (!state.remanejamentoListaRows.length) {
    tbody.innerHTML = '<tr><td class="remanejamentoEmpty" colspan="10">Nenhum remanejamento registrado.</td></tr>';
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
    tbody.innerHTML = '<tr><td class="remanejamentoEmpty" colspan="10">Nenhum remanejamento encontrado para a busca informada.</td></tr>';
    return;
  }

  const podeExcluir = state.painelLoginUsuario && Number(state.painelLoginUsuario.nivelAutorizacao || 0) >= 2;

  tbody.innerHTML = rows.map(row => {
    const impacto = Number(row.impactoMensal || 0);
    const impactoClass = classeValorImpacto(impacto);
    const idAttr = escapeAttr(row.idProcesso);

    const btnDetalhe = `<button type="button" class="remAcaoBtn" title="Ver detalhes" data-click="detalhe-rem" data-id="${escapeAttr(row.idProcesso)}">👁</button>`;
    const btnExcluir = podeExcluir
      ? `<button type="button" class="remAcaoBtn remAcaoExcluir" title="Excluir remanejamento" data-click="excluir-rem" data-id="${escapeAttr(row.idProcesso)}">🗑</button>`
      : "";

    return `
          <tr data-rem-id="${idAttr}">
            <td>${escapeHtml(row.dataCriacaoFormatada || row.dataCriacao)}</td>
            <td>${escapeHtml(row.dseiCasai || "-")}</td>
            <td>${escapeHtml(row.competencia || "-")}</td>
            <td>${escapeHtml(row.cargosReduzidos || "-")}</td>
            <td>${formatCurrency(row.totalReduzidoPeriodo)}</td>
            <td>${escapeHtml(row.cargosAcrescentados || "-")}</td>
            <td>${formatCurrency(row.totalAcrescentadoPeriodo)}</td>
            <td class="${impactoClass}">${formatCurrency(row.impactoMensal)}</td>
            <td>${escapeHtml(row.inseridoPorEmail || row.criadoPor || "-")}</td>
            <td class="remAcoesCell">${btnDetalhe}${btnExcluir}</td>
          </tr>
        `;
  }).join("");
}

export function classeValorImpacto(valor) {
  const n = Number(valor || 0);
  return n < 0 ? "remNegativo" : n > 0 ? "remPositivo" : "";
}

export async function alternarDetalheRemanejamento(idProcesso) {
  const tbody = document.getElementById("remanejamentoBody");
  if (!tbody) return;

  const existente = document.getElementById(`remDetalhe-${idSeguroAlerta(idProcesso)}`);
  if (existente) {
    existente.remove();
    return;
  }

  const linhaPrincipal = tbody.querySelector(`tr[data-rem-id="${cssEscapeAttr(idProcesso)}"]`);
  if (!linhaPrincipal) return;

  const detalheTr = document.createElement("tr");
  detalheTr.id = `remDetalhe-${idSeguroAlerta(idProcesso)}`;
  detalheTr.className = "remDetalheRow";
  detalheTr.innerHTML = `<td colspan="10" class="remDetalheCell">Carregando detalhes...</td>`;
  linhaPrincipal.after(detalheTr);

  try {
    let detalhe = detalhesRemanejamentoCache[idProcesso];
    if (!detalhe) {
      detalhe = await apiGet(`/api/remanejamento/detalhe/${encodeURIComponent(idProcesso)}`);
      detalhesRemanejamentoCache[idProcesso] = detalhe;
    }
    const rowLista = (state.remanejamentoListaRows || []).find(r => String(r.idProcesso) === String(idProcesso)) || {};
    detalheTr.querySelector("td").innerHTML = renderDetalheRemanejamentoHtml(detalhe, rowLista);
  } catch (error) {
    detalheTr.querySelector("td").innerHTML = `Erro ao carregar detalhes: ${escapeHtml(error && error.message ? error.message : String(error))}`;
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
                <th>Grat. RT</th><th>Noturno</th><th>Encargos</th><th>Provisões</th><th>Mensal</th><th>Período</th>
              </tr>
            </thead>
            <tbody>${linhas || '<tr><td colspan="11">Sem itens.</td></tr>'}</tbody>
            <tfoot>
              <tr><td colspan="9">TOTAL</td><td>${formatCurrency(totalMensal)}</td><td>${formatCurrency(totalPeriodo)}</td></tr>
            </tfoot>
          </table>
        </div>
      `;
}

export function renderDetalheRemanejamentoHtml(detalhe, rowLista) {
  const impacto = Number(detalhe.impactoMensal || 0);
  const anexo = rowLista.anexoOficioUrl
    ? `<a class="remAnexoLink" href="${escapeAttr(rowLista.anexoOficioUrl)}" target="_blank" rel="noopener noreferrer">Abrir PDF</a>`
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

export async function excluirRemanejamentoPainel(idProcesso) {
  if (!confirm("Tem certeza que deseja excluir este remanejamento? Esta ação remove o registro nas três tabelas e não pode ser desfeita.")) {
    return;
  }

  try {
    const response = await fetch(`/api/remanejamento/${encodeURIComponent(idProcesso)}`, {
      method: "DELETE",
      headers: state.painelLoginToken ? { Authorization: `Bearer ${state.painelLoginToken}` } : {}
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Erro ${response.status}`);

    delete detalhesRemanejamentoCache[idProcesso];
    alert("Remanejamento excluído com sucesso.");
    // Atualiza todos os dados afetados pela exclusão (vagas ociosas voltam ao saldo,
    // monitoramento, alertas, visão geral e a própria lista).
    recarregarTodosOsDados();
  } catch (error) {
    alert(`Erro ao excluir remanejamento: ${error && error.message ? error.message : error}`);
  }
}

export function renderRemanejamentoListaErro(error) {
  const tbody = document.getElementById("remanejamentoBody");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td class="remanejamentoEmpty" colspan="10">Erro ao carregar remanejamentos: ${escapeHtml(error && error.message ? error.message : String(error))}</td></tr>`;
}

export function atualizarVagasOrigemPorDsei() {
  state.remanejamentoLinhas.reduzido = [criarLinhaRemanejamento("reduzido", { quantidade: 1, meses: 6 })];
  state.remanejamentoLinhas.acrescentado = [criarLinhaRemanejamento("acrescentado", { quantidade: 1, meses: 6 })];
  renderLinhasRemanejamento("reduzido");
  renderLinhasRemanejamento("acrescentado");
  atualizarResumoRemanejamento();
}

export function atualizarVagasDestinoPorDsei() {
  atualizarVagasOrigemPorDsei();
}

export function atualizarResumoRemanejamento() {
  const dseiSelect = document.getElementById("remanejamentoDsei");
  const dseiLabel = dseiSelect?.options?.[dseiSelect.selectedIndex]?.text || "DSEI não selecionado";
  const processoInput = document.getElementById("remanejamentoProcessoSei");
  const anexoInput = document.getElementById("remAnexoArquivo");
  const anexoPreview = document.getElementById("remanejamentoAnexoPreview");
  const processo = processoInput?.value || "";
  const anexoNome = anexoInput?.files?.[0]?.name || "";
  const resumoFinanceiro = atualizarResumoRemanejamentoPainel();
  const qtdMovimentada = soma(coletarLinhasRemanejamento("reduzido"), "quantidade") + soma(coletarLinhasRemanejamento("acrescentado"), "quantidade");

  setText(
    "remanejamentoCalculoTexto",
    `${dseiLabel}. Processo SEI: ${processo || "não informado"}. Impacto mensal previsto: ${formatCurrency(resumoFinanceiro.impactoMensal)}.`
  );

  setText("remanejamentoResultadoTotal", formatNumber(qtdMovimentada));

  if (anexoPreview) {
    anexoPreview.innerHTML = anexoNome
      ? `Anexo selecionado: <strong>${escapeHtml(anexoNome)}</strong>.`
      : "Clique ou arraste o arquivo para enviar. PDF até 10MB.";
  }

  atualizarAvisoOciosasRemanejamento();
}

export function atualizarAvisoOciosasRemanejamento() {
  const erros = validarOciosasReduzidoCliente();
  const aviso = document.getElementById("remOciosasAviso");
  const botao = document.getElementById("remSaveBtn");

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
    botao.disabled = erros.length > 0;
    botao.classList.toggle("remSaveBtnBloqueado", erros.length > 0);
    botao.title = erros.length ? "Ajuste as quantidades reduzidas: não há vagas ociosas suficientes." : "";
  }

  return erros;
}

export function obterRemanejamentoCadastroSelecionado() {
  return null;
}

export function atualizarIndicadoresRemanejamento() {
  setText("remKpiTotalRegistros", formatNumber(state.remanejamentoListaRows.length));
  setText("remKpiAnexos", formatNumber(state.remanejamentoListaRows.filter(row => row.temAnexo || row.anexoOficioUrl).length));
  setText("remKpiOrigens", formatNumber(new Set(state.remanejamentoListaRows.map(row => row.dseiCasai).filter(Boolean)).size));
}

export function inicializarFormularioRemanejamento(resetar) {
  if (resetar || !state.remanejamentoLinhas.reduzido.length) {
    state.remanejamentoLinhas.reduzido = [criarLinhaRemanejamento("reduzido", { quantidade: 1, meses: 6 })];
  }

  if (resetar || !state.remanejamentoLinhas.acrescentado.length) {
    state.remanejamentoLinhas.acrescentado = [criarLinhaRemanejamento("acrescentado", { quantidade: 1, meses: 6 })];
  }

  renderLinhasRemanejamento("reduzido");
  renderLinhasRemanejamento("acrescentado");
  atualizarResumoRemanejamentoPainel();
}

export function criarLinhaRemanejamento(tipo, valores) {
  return {
    id: `${tipo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    idCargoFuncao: valores?.idCargoFuncao || "",
    cargo: valores?.cargo || "",
    quantidade: Number(valores?.quantidade || 1),
    vagasOciosas: Number(valores?.vagasOciosas || 0),
    meses: mesesAteFimDoAno(),
    salarioBase: Number(valores?.salarioBase || 0),
    insalubridadePericulosidade: Number(valores?.insalubridadePericulosidade || 0),
    gratificacaoRt: Number(valores?.gratificacaoRt || 0),
    adicionalNoturno: Number(valores?.adicionalNoturno || 0),
    encargos: Number(valores?.encargos || 0),
    provisoes: Number(valores?.provisoes || 0)
  };
}

export function adicionarLinhaRemanejamento(tipo) {
  state.remanejamentoLinhas[tipo] = state.remanejamentoLinhas[tipo] || [];
  state.remanejamentoLinhas[tipo].push(criarLinhaRemanejamento(tipo, { quantidade: 1, meses: 6 }));
  renderLinhasRemanejamento(tipo);
  atualizarResumoRemanejamento();
}

export function removerLinhaRemanejamento(tipo, id) {
  state.remanejamentoLinhas[tipo] = (state.remanejamentoLinhas[tipo] || []).filter(item => item.id !== id);
  if (!state.remanejamentoLinhas[tipo].length) {
    state.remanejamentoLinhas[tipo].push(criarLinhaRemanejamento(tipo, { quantidade: 1, meses: 6 }));
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
  } else if (["quantidade", "meses", "salarioBase", "insalubridadePericulosidade", "gratificacaoRt", "adicionalNoturno", "encargos", "provisoes"].includes(campo)) {
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
  const opcoesCargo = montarOpcoesCargosRemanejamento();
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
  const mensal = salarioBase + insalubridadePericulosidade + gratificacaoRt + adicionalNoturno + encargos + provisoes;
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
      provisoes: Number(item.provisoes || 0)
    }))
    .filter(item => item.idCargoFuncao || item.quantidade || item.salarioBase || item.encargos || item.provisoes);
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
    const mensal = salarioBase + insalubridadePericulosidade + gratificacaoRt + adicionalNoturno + encargos + provisoes;
    acc.salarioBase += salarioBase;
    acc.insalubridadePericulosidade += insalubridadePericulosidade;
    acc.gratificacaoRt += gratificacaoRt;
    acc.adicionalNoturno += adicionalNoturno;
    acc.encargos += encargos;
    acc.provisoes += provisoes;
    acc.mensal += mensal;
    acc.total += mensal * meses;
    return acc;
  }, { salarioBase: 0, insalubridadePericulosidade: 0, gratificacaoRt: 0, adicionalNoturno: 0, encargos: 0, provisoes: 0, mensal: 0, total: 0 });
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
  setText("remImpactoPeriodoMeses", String(mesesAteFimDoAno()));

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
  state.remanejamentoLinhas = {
    reduzido: [criarLinhaRemanejamento("reduzido", { quantidade: 1, meses: 6 })],
    acrescentado: [criarLinhaRemanejamento("acrescentado", { quantidade: 1, meses: 6 })]
  };

  setValue("remanejamentoProcessoSei", "");
  setValue("remObservacao", "");

  const anexo = document.getElementById("remAnexoArquivo");
  if (anexo) anexo.value = "";

  renderLinhasRemanejamento("reduzido");
  renderLinhasRemanejamento("acrescentado");
  atualizarResumoRemanejamento();
}

export async function salvarRemanejamentoPainel() {
  const idDseiCasai = document.getElementById("remanejamentoDsei")?.value || "";
  const processoSei = document.getElementById("remanejamentoProcessoSei")?.value || "";
  const observacao = document.getElementById("remObservacao")?.value || "";
  const anexo = document.getElementById("remAnexoArquivo")?.files?.[0] || null;
  const linhasReduzido = coletarLinhasRemanejamento("reduzido").filter(item => item.idCargoFuncao && item.quantidade > 0);
  const linhasAcrescentado = coletarLinhasRemanejamento("acrescentado").filter(item => item.idCargoFuncao && item.quantidade > 0);

  if (!idDseiCasai) {
    alert("Selecione o DSEI.");
    return;
  }
  if (!processoSei.trim()) {
    alert("Informe o número do Processo SEI.");
    return;
  }
  if (!linhasReduzido.length || !linhasAcrescentado.length) {
    alert("Informe ao menos um cargo reduzido e um cargo acrescentado.");
    return;
  }

  const errosOciosas = atualizarAvisoOciosasRemanejamento();
  if (errosOciosas.length) {
    alert(`Não é possível salvar: não há vagas ociosas suficientes para reduzir — ${errosOciosas.join("; ")}.`);
    return;
  }

  const resumo = atualizarResumoRemanejamentoPainel();
  if (resumo && (Number(resumo.impactoMensal || 0) > 0 || Number(resumo.impactoPeriodo || 0) > 0)) {
    alert("Remanejamento bloqueado: o impacto financeiro está positivo (aumento de custo). Ajuste os cargos para que o impacto fique zerado ou negativo.");
    return;
  }

  const formData = new FormData();
  formData.append("idDseiCasai", idDseiCasai);
  formData.append("processoSei", processoSei);
  formData.append("observacao", observacao);
  formData.append("criadoPor", "painel");
  formData.append("linhasReduzido", JSON.stringify(linhasReduzido));
  formData.append("linhasAcrescentado", JSON.stringify(linhasAcrescentado));
  if (anexo) formData.append("anexo", anexo);

  try {
    const response = await fetch("/api/remanejamento/salvar", {
      method: "POST",
      headers: state.painelLoginToken ? { Authorization: `Bearer ${state.painelLoginToken}` } : {},
      body: formData
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Erro ${response.status}`);

    alert("Remanejamento salvo com sucesso.");
    limparFormularioRemanejamento();
    // Atualiza todos os dados afetados: lista de remanejamentos, vagas ociosas do
    // formulário, monitoramento, alertas e visão geral.
    recarregarTodosOsDados();
  } catch (error) {
    alert(`Erro ao salvar remanejamento: ${error && error.message ? error.message : error}`);
  }
}
