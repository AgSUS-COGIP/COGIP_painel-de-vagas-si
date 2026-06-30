import { apiPost } from "./api.js";
import { nivelModulo } from "./permissoes.js";
import { filtrarRowsBase, getSelectedValues } from "./filtros.js";
import { pageLoadState } from "./runtime.js";
import { state } from "./state.js";
import { escapeAttr, escapeHtml, formatNumber, normalizarTextoPainel } from "./utils.js";
import { criarTabelaArrastavel } from "./tabela-arrastavel.js";

export function renderAlertasDaPagina() {
  const tbody = document.getElementById("alertasBody");
  const pagination = document.getElementById("alertasPagination");

  if (!pageLoadState.alertas) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="5">Carregando dados da aba Alertas...</td></tr>';
    if (pagination) pagination.innerHTML = "";
    return;
  }

  const tiposAlertaSelecionados = getSelectedValues("fTipoAlerta");
  state.alertasRows = montarAlertas(filtrarRowsBase(state.alertasBaseRows)).filter(row => {
    if (!tiposAlertaSelecionados || !tiposAlertaSelecionados.length) return true;
    return tiposAlertaSelecionados.includes(String(row.tipoValor || ""));
  });

  renderAlertasTable(state.alertasRows);
}

export function renderAlertasErro(error) {
  const pag = document.getElementById("alertasPagination");
  if (pag) pag.innerHTML = `<span>Erro ao carregar Alertas: ${escapeHtml(error && error.message ? error.message : String(error))}</span>`;
}

export function montarAlertas(data) {
  const rows = [];

  // A regra de excedente (incluindo a consolidação ENFERMEIRO/FARMACÊUTICO + ART
  // e a separação RT) é calculada na própria view e exposta nas colunas
  // qtdVagasExcedentes (cargos comuns) e qtdVagasArtExcedentes (cargos ART).
  data.forEach(row => {
    const afastamento = Number(row.qtdAfastamentoSemSubstituto || 0);
    const temporario = Number(row.qtdTemporarioAtivo || 0);
    const excedente = Number(row.qtdVagasExcedentes || 0);
    const excedenteRt = Number(row.qtdVagasArtExcedentes || 0);
    const substituicao = Number(row.contratadosSubstituicao || 0);
    const afastados = Number(row.afastados || 0);

    // Substituição sem afastado correspondente: indicador de substituição
    // segurando vaga para gestante (não há campo de gestante na base).
    if (substituicao > 0 && afastados === 0) {
      rows.push({
        tipoValor: "SUBSTITUICAO_SEGURANDO_VAGA",
        tipo: "Substituição sem afastado",
        dsei: row.dseiCasai,
        cargo: row.cargo,
        qtd: formatNumber(substituicao),
        detalhe: `${formatNumber(substituicao)} substituição(ões) sem afastado correspondente`
      });
    }

    if (afastamento > 0) {
      rows.push({
        tipoValor: "AFASTAMENTO_SEM_SUBSTITUTO",
        tipo: "Afastamento sem substituto",
        dsei: row.dseiCasai,
        cargo: row.cargo,
        qtd: formatNumber(afastamento),
        detalhe: `${formatNumber(afastamento)} afastamento(s) sem substituto`
      });
    }

    if (temporario > 0) {
      rows.push({
        tipoValor: "TEMPORARIO_ATIVO",
        tipo: "Temporário ativo — monitorar",
        dsei: row.dseiCasai,
        cargo: row.cargo,
        qtd: formatNumber(temporario),
        detalhe: `${formatNumber(temporario)} temporário(s) ativo(s)`
      });
    }

    if (excedenteRt > 0) {
      rows.push({
        tipoValor: "RT_EXCEDENTE",
        tipo: "RT excedente",
        dsei: row.dseiCasai,
        cargo: row.cargo,
        qtd: formatNumber(excedenteRt),
        detalhe: `${formatNumber(excedenteRt)} vaga(s) excedente(s) de RT pela coluna Vagas Ociosas`
      });
    }

    if (excedente > 0) {
      rows.push({
        tipoValor: "VAGA_EXCEDENTE",
        tipo: "Vaga excedente",
        dsei: row.dseiCasai,
        cargo: row.cargo,
        qtd: formatNumber(excedente),
        detalhe: `${formatNumber(excedente)} contratado(s) acima da necessidade operacional após considerar afastados`
      });
    }
  });

  rows.forEach(row => {
    row.chave = gerarChaveAlerta(row);
    row.observacao = state.observacoesAlertas[row.chave]?.observacao || "";
  });

  return rows.sort((a, b) => {
    const d = String(a.dsei || "").localeCompare(String(b.dsei || ""));
    if (d !== 0) return d;
    return String(a.cargo || "").localeCompare(String(b.cargo || ""));
  });
}

// Grade arrastável dos Alertas (só COLUNAS: a tabela re-renderiza ao editar uma
// observação/filtrar, o que resetaria a ordem de linhas). A coluna Observação
// usa variableHeight (cresce ao entrar em edição) e reaproveita o HTML existente.
let gradeAlertas = null;
const ALERTAS_COLS = [
  { title: "DSEI/CASAI", field: "dsei" },
  { title: "Cargo", field: "cargo" },
  { title: "Tipo de Alerta", field: "tipo" },
  { title: "Detalhe", field: "detalhe", widthGrow: 2 },
  {
    // minWidth garante espaço p/ o campo + botões: ao alargar outra coluna, a
    // Observação para de encolher aqui e a rolagem horizontal aparece (em vez de
    // cortar os botões). Mesmo princípio do minWidth das colunas no Disciplinar.
    title: "Observação", field: "_obs", widthGrow: 3, minWidth: 300, variableHeight: true, hozAlign: "left",
    formatter: c => {
      const row = c.getData();
      const chave = row.chave;
      const infoObs = state.observacoesAlertas[chave] || {};
      const obs = infoObs.observacao || row.observacao || "";
      return `<div class="alertaObservacaoCell">${renderObservacaoAlertaHtml(chave, obs, infoObs)}</div>`;
    },
  },
];

export function renderAlertasTable(rows) {
  if (!document.getElementById("alertasTab")) return;
  const pagination = document.getElementById("alertasPagination");
  if (pagination) pagination.innerHTML = rows.length
    ? `<span>Exibindo ${formatNumber(rows.length)} alerta(s) com rolagem.</span>`
    : "";
  // Injeta a chave (índice único da linha) usada pela edição e pela persistência.
  const dados = rows.map(r => ({ ...r, chave: r.chave || gerarChaveAlerta(r) }));
  if (!gradeAlertas) gradeAlertas = criarTabelaArrastavel({
    elemento: "alertasTab", colunas: ALERTAS_COLS, persistID: "alertasV2",
    indexField: "chave", movableRows: false, altura: "520px",
    // Layout padrão (fitDataStretch), igual ao Disciplinar: a última coluna
    // (Observação) estica para a largura DISPONÍVEL (descontando a barra de
    // rolagem vertical, sem cortar os botões); ao alargar uma coluna além do que
    // cabe, surge a barra de rolagem horizontal.
    vazio: "Sem alertas para os filtros selecionados.",
  });
  gradeAlertas?.render(dados);
}

// Editar observações de alertas exige permissão de Editor (nível >= 2) no módulo.
function podeEditarObservacaoAlerta() {
  return nivelModulo("alertas") >= 2;
}

export function renderObservacaoAlertaHtml(chave, obs, infoObs) {
  const atualizadoEm = infoObs?.atualizadoEm || "";
  const usuarioEdicao = infoObs?.usuario || "";
  const metaPartes = [];

  if (atualizadoEm) metaPartes.push(`Última edição: ${escapeHtml(atualizadoEm)}`);
  if (usuarioEdicao) metaPartes.push(`Editado por: ${escapeHtml(usuarioEdicao)}`);

  const meta = metaPartes.length
    ? `<div class="alertaObservacaoMeta">${metaPartes.join("<br>")}</div>`
    : "";

  // Usuário comum (nível < 2): somente leitura, sem botão/campo de edição.
  if (!podeEditarObservacaoAlerta()) {
    return `
          <div class="alertaObservacaoWrap">
            <div class="alertaObservacaoTexto">${obs ? escapeHtml(obs) : "—"}</div>
            ${meta}
          </div>
        `;
  }

  const emEdicao = state.alertaObservacaoEditando === chave || !obs;

  if (!emEdicao) {
    return `
          <div class="alertaObservacaoWrap">
            <div class="alertaObservacaoTexto">${escapeHtml(obs)}</div>
            <div class="alertaObservacaoActions">
              <button type="button" class="alertaObservacaoBtn secundario" data-click="editar-obs" data-chave="${escapeAttr(chave)}">Editar</button>
            </div>
            ${meta}
            <div class="alertaObservacaoStatus" id="${idStatusObservacaoAlerta(chave)}"></div>
          </div>
        `;
  }

  return `
        <div class="alertaObservacaoWrap">
          <div class="alertaObservacaoTextoPrint">${escapeHtml(obs)}</div>
          <input type="text" class="alertaObservacaoInput" id="${idObservacaoAlerta(chave)}" placeholder="Digite uma justificativa ou observação" value="${escapeHtml(obs)}" />
          <div class="alertaObservacaoActions">
            <button type="button" class="alertaObservacaoBtn" id="${idBotaoObservacaoAlerta(chave)}" data-click="salvar-obs" data-chave="${escapeAttr(chave)}">Salvar</button>
            ${obs ? `<button type="button" class="alertaObservacaoBtn secundario" data-click="cancelar-obs">Cancelar</button>` : ""}
          </div>
          ${meta}
          <div class="alertaObservacaoStatus" id="${idStatusObservacaoAlerta(chave)}"></div>
        </div>
      `;
}

export function idSeguroAlerta(chave) {
  return String(chave || "").replace(/[^A-Za-z0-9_-]/g, "_");
}

export function idObservacaoAlerta(chave) {
  return "obsAlerta_" + idSeguroAlerta(chave);
}

export function idBotaoObservacaoAlerta(chave) {
  return "btnObsAlerta_" + idSeguroAlerta(chave);
}

export function idStatusObservacaoAlerta(chave) {
  return "statusObsAlerta_" + idSeguroAlerta(chave);
}

export function gerarChaveAlerta(row) {
  return [
    row?.dsei || "",
    row?.cargo || "",
    row?.tipoValor || ""
  ].map(normalizarTextoPainel).join("|");
}

export function editarObservacaoAlertaPainel(chave) {
  if (!podeEditarObservacaoAlerta()) return;
  state.alertaObservacaoEditando = chave;
  renderAlertasTable(state.alertasRows);

  setTimeout(() => {
    const campo = document.getElementById(idObservacaoAlerta(chave));
    if (campo) {
      campo.focus();
      campo.selectionStart = campo.value.length;
      campo.selectionEnd = campo.value.length;
    }
  }, 0);
}

export function cancelarEdicaoObservacaoAlertaPainel() {
  state.alertaObservacaoEditando = null;
  renderAlertasTable(state.alertasRows);
}

export function salvarObservacaoAlertaPainel(chave) {
  if (!podeEditarObservacaoAlerta()) return;
  const row = state.alertasRows.find(item => (item.chave || gerarChaveAlerta(item)) === chave);
  const campo = document.getElementById(idObservacaoAlerta(chave));
  const botao = document.getElementById(idBotaoObservacaoAlerta(chave));
  const status = document.getElementById(idStatusObservacaoAlerta(chave));

  if (!row || !campo) {
    alert("Não foi possível identificar o alerta para salvar a observação.");
    return;
  }

  const observacao = campo.value || "";

  if (botao) botao.disabled = true;
  if (status) status.innerText = "Salvando...";

  apiPost("/api/alertas/observacao", {
    chave,
    dsei: row.dsei,
    cargo: row.cargo,
    tipoValor: row.tipoValor,
    tipo: row.tipo,
    detalhe: row.detalhe,
    observacao
  })
    .then(payload => {
      state.observacoesAlertas[chave] = {
        ...(state.observacoesAlertas[chave] || {}),
        observacao: payload?.observacao ?? observacao,
        usuario: payload?.usuario || "",
        atualizadoEm: payload?.atualizadoEm || ""
      };

      state.alertaObservacaoEditando = null;
      renderAlertasTable(state.alertasRows);
    })
    .catch(error => {
      if (botao) botao.disabled = false;
      if (status) status.innerText = "";
      alert(error && error.message ? error.message : String(error));
    });
}

export function mudarPaginaAlertas(delta) {
  renderAlertasTable(state.alertasRows);
}
