import { gerarChaveAlerta } from "./alertas.js";
import { filterConfigs } from "./runtime.js";
import { state } from "./state.js";
import { formatPercent, valorCsv } from "./utils.js";
import { filtrarCargosProcessoSeletivo, obterRowsVagasPorVisualizacao, valoresDistribuicao } from "./vagas.js";

export function exportarPdf() {
  window.print();
}

export function exportarVagas() {
  const rows = state.vagasRows.map(row => ({
    "DSEI/CASAI": row.dseiCasai,
    "Cargo": row.cargo,
    "Vagas previstas": row.quantitativoPlano,
    "Total de Trabalhadores": row.totalTrabalhadores,
    "Afastados": row.afastados,
    "Vagas Ociosas (Déficit Operacional)": row.ociosas,
    "Trabalhadores Normais": row.contratadosNormal,
    "Substituições": row.contratadosSubstituicao,
    "Temporárias": row.contratadosTemporario,
    "Percentual de preenchimento": formatPercent(row.preenchimento),
    "Atualização": row.atualizacaoDados
  }));

  baixarCsv("base_vagas_saude_indigena", rows, false);
}

export function exportarDistribuicaoVagasOciosas() {
  // Exporta a tabela "Distribuição das Vagas Ociosas" conforme a visualização
  // ativa da aba Vagas e respeitando os filtros superiores DSEI/CASAI e Cargo.
  const linhasBase = obterRowsVagasPorVisualizacao(state.vagasRows);
  let rows;

  if (state.vagasViewAtual === "detalhado") {
    rows = linhasBase.map(row => {
      const base = valoresDistribuicao(row);
      return {
        "DSEI/CASAI": row.dseiCasai || "Não informado",
        "Cargo": row.cargo || "Não informado",
        "Normais/Temporárias": base.normalTemporario,
        "Afastamento sem substituição": base.substituicaoTabela,
        "Vagas Ociosas": base.vagasOciosas
      };
    });
  } else {
    const primeiraColuna = state.vagasViewAtual === "cargo" ? "Cargo" : "DSEI/CASAI";
    rows = linhasBase.map(row => {
      const base = valoresDistribuicao(row);
      return {
        [primeiraColuna]: row.label || "Não informado",
        "Normais/Temporárias": base.normalTemporario,
        "Afastamento sem substituição": base.substituicaoTabela,
        "Vagas Ociosas": base.vagasOciosas
      };
    });
  }

  rows = rows.filter(item =>
    Number(item["Vagas Ociosas"] || 0) !== 0 ||
    Number(item["Afastamento sem substituição"] || 0) !== 0 ||
    Number(item["Normais/Temporárias"] || 0) !== 0
  );

  baixarCsv("distribuicao_vagas_ociosas", rows, false);
}

export function exportarProcessoSeletivo() {
  // Exporta a tabela "Vagas para Processo Seletivo" conforme a visualização ativa
  // e respeitando os filtros superiores DSEI/CASAI e Cargo.
  const linhasBase = obterRowsVagasPorVisualizacao(filtrarCargosProcessoSeletivo(state.vagasRows));
  let rows;

  if (state.vagasViewAtual === "detalhado") {
    rows = linhasBase.map(row => {
      const base = valoresDistribuicao(row);
      return {
        "DSEI/CASAI": row.dseiCasai || "Não informado",
        "Cargo": row.cargo || "Não informado",
        "Normais": base.normalTemporario,
        "Temporárias": base.contratadosTemporario,
        "Total Processo Seletivo": base.processoSeletivo
      };
    });
  } else {
    const primeiraColuna = state.vagasViewAtual === "cargo" ? "Cargo" : "DSEI/CASAI";
    rows = linhasBase.map(row => {
      const base = valoresDistribuicao(row);
      return {
        [primeiraColuna]: row.label || "Não informado",
        "Normais": base.normalTemporario,
        "Temporárias": base.contratadosTemporario,
        "Total Processo Seletivo": base.processoSeletivo
      };
    });
  }

  rows = rows.filter(item =>
    Number(item["Normais"] || 0) !== 0 ||
    Number(item["Temporárias"] || 0) !== 0 ||
    Number(item["Total Processo Seletivo"] || 0) !== 0
  );

  baixarCsv("vagas_processo_seletivo", rows, false);
}

export function exportarAlertas() {
  const rows = state.alertasRows.map(row => ({
    "DSEI/CASAI": row.dsei,
    "Cargo": row.cargo,
    "Tipo de Alerta": row.tipo,
    "Detalhe": row.detalhe,
    "Observação": row.observacao || state.observacoesAlertas[row.chave || gerarChaveAlerta(row)]?.observacao || ""
  }));

  baixarCsv("alertas_saude_indigena", rows, true);
}

export function baixarCsv(nomeArquivo, rows, incluirTipoAlerta = false) {
  const linhas = [];

  linhas.push(["Arquivo", nomeArquivo]);
  linhas.push(["Exportado em", new Date().toLocaleString("pt-BR")]);
  linhas.push(["DSEI/CASAI", valorFiltro("fDsei")]);
  linhas.push(["Cargo", valorFiltro("fCargo")]);
  if (incluirTipoAlerta) {
    linhas.push(["Tipo de Alerta", valorFiltro("fTipoAlerta")]);
  }
  linhas.push([]);

  if (!rows || rows.length === 0) {
    linhas.push(["Sem dados para os filtros selecionados."]);
  } else {
    const headers = Object.keys(rows[0]);
    linhas.push(headers);
    rows.forEach(row => {
      linhas.push(headers.map(h => row[h]));
    });
  }

  const csv = "\uFEFF" + linhas
    .map(linha => linha.map(valorCsv).join(";"))
    .join("\r\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = `${nomeArquivo}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function valorFiltro(id) {
  const cfg = filterConfigs[id];
  if (!cfg) return "Todos";

  const selected = cfg.options.filter(opt => cfg.selected.has(String(opt.value))).map(opt => opt.label);
  if (!selected.length || selected.length === cfg.options.length) return "Todos";
  return selected.join(", ");
}
