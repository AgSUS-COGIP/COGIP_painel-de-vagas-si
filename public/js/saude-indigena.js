// =========================================================
// Dashboard Saúde Indígena (nativo)
// Substitui o iframe do Looker. Consome /api/saude-indigena (payload híbrido
// colunar/dicionarizado — ver lib/saude-indigena.js), remonta as linhas e calcula
// KPIs, gráficos, filtros e a tabela geral 100% no cliente. Carregamento sob
// demanda (a base tem ~20k linhas: só busca quando a aba é aberta).
// Filtros: comboboxes pesquisáveis (criarCombo) + busca por nome + períodos.
// Tabela: rolagem infinita (100 linhas por vez) — renderizar ~20k de uma vez trava a aba.
// =========================================================
import { apiGet } from "./api.js";
import { state } from "./state.js";
import { formatNumber, formatPercent, escapeHtml, escapeAttr, valorCsv, baixarArquivoCsv, debounce, isoParaDataBr as fData } from "./utils.js";
import { abrirAviso } from "./modal.js";

const $ = id => document.getElementById(id);

// Paleta base azul (SUS) — tons frios (azul/teal/verde).
const PALETA = [
  "#007de0", "#0a66b0", "#1F7A8C", "#2E8B57", "#0053a7", "#5b9bd5",
  "#3A6B7E", "#1f8a53", "#6aa9d6", "#2C6E76", "#88b8e0", "#4C9A6A",
  "#00b5d8", "#155e6e", "#3d8fd6", "#5aa0a8"
];
const COR_INDIGENA = "#1F7A8C"; // teal — destaque dos indígenas no gráfico de raça
const COR_SUS_AZUL = "#0a66b0";
const COR_SUS_VERDE = "#1f8a53";
const TEXTO = "#1f3a5f";

// Raças/cores (ordem e cores fixas) para os gráficos empilhados — tons frios.
const RACAS = [
  { key: "INDIGENA", label: "Indígena", cor: "#007de0" },
  { key: "PARDA", label: "Parda", cor: "#1F7A8C" },
  { key: "BRANCA", label: "Branca", cor: "#6aa9d6" },
  { key: "PRETA/NEGRA", label: "Preta/Negra", cor: "#2E8B57" },
  { key: "AMARELA", label: "Amarela", cor: "#0053a7" }
];

// Regra de Vínculo com a Agência (definida pela área): estas situações = Desligado;
// todo o resto = Ativo. A contagem é sempre por REGISTRO distinto (deduplicado no backend).
const SITUACOES_DESLIGADO = new Set([
  "aviso indenizado", "aviso trabalhado", "desligado", "desligamento sem rescisão"
]);
const norm = s => (s || "").trim().toLowerCase();

// Situações que NÃO contam como afastamento no card "Em Afastamento"
// (definição da área): Atestado, Afastamento com remuneração e Licença Paternidade.
function afastamentoExcluido(situacao) {
  const s = norm(situacao);
  return s === "atestado" || s.includes("remunera") || s.includes("paternidade");
}

// ---------- Estado da view ----------
let dados = null;
let carregado = false;
let carregando = false;
let configurado = false;

const chartsSI = {};
const combos = {};          // id -> instância de combobox pesquisável
const exportGraficos = {};  // canvasId -> { colLabel, nome, pares } para exportar cada gráfico
let ordenacao = { col: null, dir: 1 }; // ordenação da tabela

// Granularidade dos gráficos de movimentação (admissões/desligamentos): ano | mes | dia.
let granAdmissao = "ano";
let granDeslig = "ano";

let filtros = vazio();
function vazio() {
  return {
    nome: [], indigena: [], vinculo: [], situacao: [], cargo: [], centro: [], uf: [],
    territorio: [], atuacao: [], tipoAdmissao: [], tipoDeslig: [],
    admIni: "", admFim: "", deslIni: "", deslFim: ""
  };
}

// ---------- Combobox pesquisável ----------
function fecharTodosCombos(exceto) {
  Object.values(combos).forEach(c => { if (c.root !== exceto) c.fechar(); });
}

// Combobox de MÚLTIPLA seleção (checkboxes) + busca por digitação.
function criarCombo(containerId, rotuloTodos, onChange, opts) {
  const root = $(containerId);
  if (!root) return null;
  const maxRender = (opts && opts.maxRender) || 200;
  const buscaPlaceholder = (opts && opts.searchPlaceholder) || "Buscar…";
  root.innerHTML = `
    <button type="button" class="siComboBtn" aria-haspopup="listbox" aria-expanded="false">
      <span class="siComboValor" id="${containerId}-valor"></span><i class="fa-solid fa-chevron-down"></i>
    </button>
    <div class="siComboPop" hidden>
      <div class="siComboSearch">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="text" class="siComboInput" placeholder="${escapeAttr(buscaPlaceholder)}" autocomplete="off" aria-label="${escapeAttr(buscaPlaceholder)}">
        <button type="button" class="siComboClear" hidden>Limpar</button>
      </div>
      <ul class="siComboList" role="listbox" aria-multiselectable="true"></ul>
    </div>`;

  // Nome acessível: associa o rótulo do campo (span irmão) ao botão e à lista.
  const campoLabel = root.parentElement?.querySelector(".siFieldLabel");
  if (campoLabel) {
    if (!campoLabel.id) campoLabel.id = `${containerId}-label`;
    root.querySelector(".siComboBtn")?.setAttribute("aria-labelledby", `${campoLabel.id} ${containerId}-valor`);
    root.querySelector(".siComboList")?.setAttribute("aria-label", campoLabel.textContent.trim());
  }

  const btn = root.querySelector(".siComboBtn");
  const valorEl = root.querySelector(".siComboValor");
  const pop = root.querySelector(".siComboPop");
  const input = root.querySelector(".siComboInput");
  const clearBtn = root.querySelector(".siComboClear");
  const list = root.querySelector(".siComboList");

  let opcoes = [];                 // [{value, label}]
  const selecionados = new Set();  // múltipla seleção
  let rotuloAll = rotuloTodos;

  function atualizarBotao() {
    let txt = rotuloAll;
    if (selecionados.size === 1) {
      const v = [...selecionados][0];
      const o = opcoes.find(o => o.value === v);
      txt = o ? o.label : v;
    } else if (selecionados.size > 1) {
      txt = `${selecionados.size} selecionados`;
    }
    valorEl.textContent = txt;
    root.classList.toggle("temValor", selecionados.size > 0);
    clearBtn.hidden = selecionados.size === 0;
  }
  function renderLista(filtro) {
    const f = (filtro || "").trim().toLowerCase();
    const vis = opcoes.filter(o => !f || o.label.toLowerCase().includes(f));
    const mostrados = vis.slice(0, maxRender);
    let html = mostrados.map(o =>
      `<li class="siComboOpt${selecionados.has(o.value) ? " is-sel" : ""}" data-v="${escapeAttr(o.value)}" title="${escapeAttr(o.label)}" role="option" aria-selected="${selecionados.has(o.value)}">
        <span class="siComboCheck"><i class="fa-solid fa-check"></i></span>
        <span class="siComboOptLabel">${escapeHtml(o.label)}</span>
      </li>`).join("");
    if (!vis.length) html = `<li class="siComboVazio">Nenhuma opção</li>`;
    else if (vis.length > maxRender) html += `<li class="siComboMais">+${vis.length - maxRender} — digite para refinar…</li>`;
    list.innerHTML = html;
  }
  function abrir() {
    fecharTodosCombos(root);
    pop.hidden = false;
    root.classList.add("aberto");
    btn.setAttribute("aria-expanded", "true");
    input.value = "";
    renderLista("");
    setTimeout(() => input.focus(), 10);
  }
  function fechar() { pop.hidden = true; root.classList.remove("aberto"); btn.setAttribute("aria-expanded", "false"); }
  function toggle(v) {
    if (selecionados.has(v)) selecionados.delete(v); else selecionados.add(v);
    atualizarBotao();
    renderLista(input.value);
    if (onChange) onChange();
  }

  btn.addEventListener("click", e => { e.stopPropagation(); pop.hidden ? abrir() : fechar(); });
  pop.addEventListener("click", e => e.stopPropagation());
  input.addEventListener("input", () => renderLista(input.value));
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") { const o = list.querySelector(".siComboOpt"); if (o) toggle(o.dataset.v); e.preventDefault(); }
    else if (e.key === "Escape") { fechar(); }
  });
  list.addEventListener("click", e => { const li = e.target.closest(".siComboOpt"); if (li) toggle(li.dataset.v); });
  clearBtn.addEventListener("click", () => { selecionados.clear(); atualizarBotao(); renderLista(input.value); if (onChange) onChange(); });

  const inst = {
    root,
    setOptions(valores, rotulo) {
      if (rotulo) rotuloAll = rotulo;
      opcoes = valores.map(v => (v && typeof v === "object")
        ? { value: String(v.value), label: String(v.label) }
        : { value: String(v), label: String(v) });
      atualizarBotao();
    },
    getValues() { return [...selecionados]; },
    clear() { selecionados.clear(); atualizarBotao(); },
    fechar
  };
  atualizarBotao();
  combos[containerId] = inst;
  return inst;
}

// ---------- Carregamento ----------
async function carregar() {
  if (carregando || carregado) return;
  carregando = true;
  mostrarEstado("Carregando dados da Saúde Indígena…");
  try {
    const payload = await apiGet("/api/saude-indigena");
    dados = decodificar(payload);
    carregado = true;
    esconderEstado();
    preencherSelects();
    render();
  } catch (e) {
    mostrarEstado(e && e.message ? e.message : "Falha ao carregar os dados.", true);
  } finally {
    carregando = false;
  }
}

function decodificar(payload) {
  const fields = payload.fields || [];
  const rawFields = payload.rawFields || [];
  const dim = payload.dim || {};
  const base = fields.length;

  const rows = (payload.rows || []).map(r => {
    const o = {};
    fields.forEach((f, i) => { o[f] = dim[f][r[i]]; });
    rawFields.forEach((f, j) => { o[f] = r[base + j]; });

    const flags = o.flags || 0;
    o.emAfastamento = !!(flags & 1);
    o.emFerias = !!(flags & 2);
    o.vinculo = SITUACOES_DESLIGADO.has(norm(o.situacao)) ? "Desligado" : "Ativo";
    o.ativo = o.vinculo === "Ativo";
    o.indigena = (o.raca || "").toUpperCase() === "INDIGENA";
    o.substituicao = (o.tipoAdmissao === "SUBSTITUIÇÃO") ? (o.statusSubstituicao || "") : "";
    return o;
  });

  return { fields, dim, rows, atualizadoEm: payload.atualizadoEm };
}

// ---------- Estado visual ----------
function mostrarEstado(msg, ehErro) {
  const el = $("siEstado");
  const body = $("siBody");
  if (el) {
    el.hidden = false;
    el.classList.toggle("is-erro", !!ehErro);
    el.innerHTML = ehErro
      ? `<i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(msg)}`
      : `<span class="siSpinner"></span> ${escapeHtml(msg)}`;
  }
  if (body) body.style.display = "none";
}
function esconderEstado() {
  const el = $("siEstado");
  if (el) el.hidden = true;
  const body = $("siBody");
  if (body) body.style.display = "";
}

// ---------- Filtros ----------
const ordenar = arr => [...arr].sort((a, b) => String(a).localeCompare(String(b), "pt-BR"));

function preencherSelects() {
  const dim = dados.dim;

  // Nome: combobox pesquisável com os nomes distintos (a busca refina a lista).
  const nomes = ordenar([...new Set(dados.rows.map(r => r.nome).filter(Boolean))]);
  combos.siFiltroNome?.setOptions(nomes);

  // Trabalhadores Indígenas: Sim/Não com o quantitativo (REGISTRO distinto = linhas).
  const ind = dados.rows.filter(r => r.indigena).length;
  const naoInd = dados.rows.length - ind;
  combos.siFiltroIndigena?.setOptions([
    { value: "SIM", label: `Sim (${formatNumber(ind)})` },
    { value: "NÃO", label: `Não (${formatNumber(naoInd)})` }
  ]);

  // Demais filtros: cada opção mostra o total (REGISTRO distinto) na frente.
  const contagem = chave => {
    const m = new Map();
    dados.rows.forEach(r => { const k = r[chave]; m.set(k, (m.get(k) || 0) + 1); });
    return m;
  };
  const comTotal = (valores, mapa) => ordenar(valores).map(v => ({
    value: v,
    label: `${v === "—" ? "Sem informação" : v} (${formatNumber(mapa.get(v) || 0)})`
  }));

  combos.siFiltroVinculo?.setOptions(comTotal(["Ativo", "Desligado"], contagem("vinculo")));
  combos.siFiltroSituacao?.setOptions(comTotal(dim.situacao, contagem("situacao")));
  combos.siFiltroCargo?.setOptions(comTotal(dim.cargo, contagem("cargo")));
  combos.siFiltroCentro?.setOptions(comTotal(dim.centroCusto, contagem("centroCusto")));
  combos.siFiltroUf?.setOptions(comTotal(dim.uf, contagem("uf")));
  combos.siFiltroTerritorio?.setOptions(comTotal(dim.localTrabalho, contagem("localTrabalho")));
  combos.siFiltroAtuacao?.setOptions(comTotal(dim.tipoAtuacao, contagem("tipoAtuacao")));
  combos.siFiltroTipoAdmissao?.setOptions(comTotal(dim.tipoAdmissao, contagem("tipoAdmissao")));

  // Tipo de Desligamento: só conta quem realmente foi desligado (vínculo =
  // Desligado). Pessoa ativa não tem desligamento, então fica de fora — inclusive
  // do "Sem informação". O desligado sem tipo informado segue como "Sem informação".
  const contagemDeslig = new Map();
  dados.rows.forEach(r => {
    if (r.vinculo !== "Desligado") return;
    const k = r.tipoDesligamento;
    contagemDeslig.set(k, (contagemDeslig.get(k) || 0) + 1);
  });
  combos.siFiltroTipoDeslig?.setOptions(comTotal([...contagemDeslig.keys()], contagemDeslig));
}

// Garante que um par (início, fim) de datas ISO esteja em ordem: se o usuário
// inverteu os campos (início > fim), troca os valores — caso contrário o filtro
// retornaria zero linhas sem explicação. A correção também é refletida nos inputs.
function normalizarRangeDatas(idIni, idFim) {
  const elIni = $(idIni);
  const elFim = $(idFim);
  const ini = elIni?.value || "";
  const fim = elFim?.value || "";
  if (ini && fim && ini > fim) {
    if (elIni) elIni.value = fim;
    if (elFim) elFim.value = ini;
    return { ini: fim, fim: ini };
  }
  return { ini, fim };
}

function lerFiltros() {
  const cv = id => combos[id] ? combos[id].getValues() : [];
  const admissao = normalizarRangeDatas("siAdmIni", "siAdmFim");
  const deslig = normalizarRangeDatas("siDeslIni", "siDeslFim");
  filtros = {
    nome: cv("siFiltroNome"),
    indigena: cv("siFiltroIndigena"),
    vinculo: cv("siFiltroVinculo"),
    situacao: cv("siFiltroSituacao"),
    cargo: cv("siFiltroCargo"),
    centro: cv("siFiltroCentro"),
    uf: cv("siFiltroUf"),
    territorio: cv("siFiltroTerritorio"),
    atuacao: cv("siFiltroAtuacao"),
    tipoAdmissao: cv("siFiltroTipoAdmissao"),
    tipoDeslig: cv("siFiltroTipoDeslig"),
    admIni: admissao.ini,
    admFim: admissao.fim,
    deslIni: deslig.ini,
    deslFim: deslig.fim
  };
}

function aplicarFiltros() {
  const f = filtros;
  return dados.rows.filter(r => {
    if (f.nome.length && !f.nome.includes(r.nome)) return false;
    if (f.indigena.length && !f.indigena.includes(r.indigena ? "SIM" : "NÃO")) return false;
    if (f.vinculo.length && !f.vinculo.includes(r.vinculo)) return false;
    if (f.situacao.length && !f.situacao.includes(r.situacao)) return false;
    if (f.cargo.length && !f.cargo.includes(r.cargo)) return false;
    if (f.centro.length && !f.centro.includes(r.centroCusto)) return false;
    if (f.uf.length && !f.uf.includes(r.uf)) return false;
    if (f.territorio.length && !f.territorio.includes(r.localTrabalho)) return false;
    if (f.atuacao.length && !f.atuacao.includes(r.tipoAtuacao)) return false;
    if (f.tipoAdmissao.length && !f.tipoAdmissao.includes(r.tipoAdmissao)) return false;
    // Tipo de Desligamento só se aplica a desligados (ativo não tem desligamento,
    // mesmo quando "Sem informação" está selecionado).
    if (f.tipoDeslig.length && (r.vinculo !== "Desligado" || !f.tipoDeslig.includes(r.tipoDesligamento))) return false;
    if (f.admIni && (!r.dataAdmissao || r.dataAdmissao < f.admIni)) return false;
    if (f.admFim && (!r.dataAdmissao || r.dataAdmissao > f.admFim)) return false;
    if (f.deslIni && (!r.dataDesligamento || r.dataDesligamento < f.deslIni)) return false;
    if (f.deslFim && (!r.dataDesligamento || r.dataDesligamento > f.deslFim)) return false;
    return true;
  });
}

function limparFiltros() {
  ["siAdmIni", "siAdmFim", "siDeslIni", "siDeslFim"]
    .forEach(id => { const el = $(id); if (el) el.value = ""; });
  Object.values(combos).forEach(c => c.clear());
  filtros = vazio();
  render();
}

// ---------- Agregações ----------
function contar(rows, chave) {
  const m = new Map();
  rows.forEach(r => { const k = r[chave] || "Não informado"; m.set(k, (m.get(k) || 0) + 1); });
  return m;
}
function topN(mapa, n) {
  const arr = [...mapa.entries()].sort((a, b) => b[1] - a[1]);
  return n ? arr.slice(0, n) : arr;
}
function ordenarFaixas(mapa) {
  return [...mapa.entries()].sort((a, b) => {
    const na = parseInt(a[0], 10), nb = parseInt(b[0], 10);
    if (isNaN(na)) return 1; if (isNaN(nb)) return -1;
    return na - nb;
  });
}

// Série temporal de movimentação: conta REGISTRO distinto por período
// (ano/mês/dia) a partir de um campo de data ISO (YYYY-MM-DD). Cada período
// é ordenado cronologicamente pela chave ISO e rotulado conforme a granularidade.
function serieTemporal(rows, campoData, granularidade) {
  const buckets = new Map(); // chaveOrdenavel -> { label, regs:Set }
  rows.forEach(r => {
    const iso = r[campoData];
    if (!iso) return;
    const [a, m, d] = String(iso).slice(0, 10).split("-");
    if (!a || !m || !d) return;
    let chave, label;
    if (granularidade === "ano") { chave = a; label = a; }
    else if (granularidade === "dia") { chave = `${a}-${m}-${d}`; label = `${d}/${m}/${a}`; }
    else { chave = `${a}-${m}`; label = `${m}/${a}`; }
    let b = buckets.get(chave);
    if (!b) { b = { label, regs: new Set() }; buckets.set(chave, b); }
    if (r.registro != null && r.registro !== "") b.regs.add(r.registro);
  });
  return [...buckets.entries()]
    .sort((x, y) => x[0].localeCompare(y[0]))
    .map(([, b]) => [b.label, b.regs.size]);
}

function rotuloGran(g) { return g === "dia" ? "Dia" : g === "mes" ? "Mês/Ano" : "Ano"; }

function renderSerieAdmissao(rows) {
  const serie = serieTemporal(rows, "dataAdmissao", granAdmissao);
  desenharSerie("siChartAdmissoes", serie, COR_SUS_VERDE);
  regExport("siChartAdmissoes", rotuloGran(granAdmissao), "admissoes_por_periodo", serie);
}

function renderSerieDeslig(rows) {
  const serie = serieTemporal(rows, "dataDesligamento", granDeslig);
  desenharSerie("siChartDesligamentos", serie, "#c0392b");
  regExport("siChartDesligamentos", rotuloGran(granDeslig), "desligamentos_por_periodo", serie);
}

// Gráfico empilhado: Top 10 categorias (por total) x composição de raça/cor.
function empilhadoPorRaca(canvasId, rows, chave, colLabel, nomeArquivo) {
  const totais = contar(rows, chave);
  const top = [...totais.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);
  const topSet = new Set(top);

  const m = new Map();
  top.forEach(c => m.set(c, {}));
  let temOutra = false;
  rows.forEach(r => {
    const cat = r[chave] || "Não informado";
    if (!topSet.has(cat)) return;
    let k = (r.raca || "").toUpperCase();
    if (!RACAS.some(x => x.key === k)) { k = "OUTRA"; temOutra = true; }
    const o = m.get(cat); o[k] = (o[k] || 0) + 1;
  });

  const cats = RACAS.concat(temOutra ? [{ key: "OUTRA", label: "Outra", cor: "#9aa0a6" }] : []);
  const series = cats.map(c => ({ label: c.label, cor: c.cor, data: top.map(t => m.get(t)[c.key] || 0) }));
  barEmpilhada(canvasId, top, series);

  const header = [colLabel, ...cats.map(c => c.label), "Total"];
  const linhas = top.map(t => {
    const vals = cats.map(c => m.get(t)[c.key] || 0);
    return [t, ...vals, vals.reduce((a, b) => a + b, 0)];
  });
  regExportMatriz(canvasId, nomeArquivo, header, linhas);
}

// ---------- Render ----------
function render() {
  if (!carregado || !dados) return;
  const rows = aplicarFiltros();

  renderKpis(rows);
  renderResumo(rows);

  const at = $("siAtualizado");
  if (at && dados.atualizadoEm) at.textContent = new Date(dados.atualizadoEm).toLocaleDateString("pt-BR");

  // --- Destaque: composição por raça/cor (DSEIs e cargos) ---
  empilhadoPorRaca("siChartRacaDsei", rows, "centroCusto", "DSEI / CASAI", "dseis_por_raca_cor");
  empilhadoPorRaca("siChartRacaCargo", rows, "cargo", "Cargo", "cargos_por_raca_cor");
  empilhadoPorRaca("siChartRacaGrau", rows, "grauInstrucao", "Grau de instrução", "grau_instrucao_por_raca_cor");

  // --- Indicadores gerais ---
  const situ = topN(contar(rows, "situacao"), 10);
  barH("siChartSituacao", situ.map(d => d[0]), situ.map(d => d[1]), PALETA[4]);
  regExport("siChartSituacao", "Situação", "trabalhadores_por_situacao", situ);

  const grau = topN(contar(rows, "grauInstrucao"));
  barH("siChartGrau", grau.map(d => d[0]), grau.map(d => d[1]), PALETA[6]);
  regExport("siChartGrau", "Grau de instrução", "trabalhadores_por_grau_instrucao", grau);

  const raca = topN(contar(rows, "raca"));
  rosca("siChartRaca", raca.map(d => d[0]), raca.map(d => d[1]),
    raca.map(d => (d[0] || "").toUpperCase() === "INDIGENA" ? COR_INDIGENA : null));
  regExport("siChartRaca", "Raça / Cor", "trabalhadores_por_raca_cor", raca);

  const sexo = topN(contar(rows, "sexo"));
  const corSexo = v => {
    const s = norm(v);
    if (s.startsWith("f")) return "#C85A8E";    // Feminino → rosa
    if (s.startsWith("m")) return COR_SUS_AZUL; // Masculino → azul
    return null;
  };
  rosca("siChartSexo", sexo.map(d => d[0]), sexo.map(d => d[1]), sexo.map(s => corSexo(s[0])), { legendReverse: true });
  regExport("siChartSexo", "Sexo", "trabalhadores_por_sexo", sexo);

  const atuacao = topN(contar(rows, "tipoAtuacao"));
  rosca("siChartAtuacao", atuacao.map(d => d[0]), atuacao.map(d => d[1]), []);
  regExport("siChartAtuacao", "Tipo de atuação", "trabalhadores_por_atuacao", atuacao);

  const faixas = ordenarFaixas(contar(rows, "faixaEtaria"));
  colunas("siChartFaixa", faixas.map(d => d[0]), faixas.map(d => d[1]), PALETA[2]);
  regExport("siChartFaixa", "Faixa etária", "trabalhadores_por_faixa_etaria", faixas);

  // --- Movimentação de pessoal (admissões/desligamentos por período) ---
  renderSerieAdmissao(rows);
  renderSerieDeslig(rows);

  renderTabela(rows);
}

// ---------- Exportação por gráfico ----------
function regExport(canvasId, colLabel, nome, pares) {
  exportGraficos[canvasId] = { nome, header: [colLabel, "Trabalhadores"], linhas: pares.map(([l, v]) => [l, v]) };
}

function regExportMatriz(canvasId, nome, header, linhas) {
  exportGraficos[canvasId] = { nome, header, linhas };
}

function exportarGrafico(canvasId) {
  const d = exportGraficos[canvasId];
  if (!d || !d.linhas || !d.linhas.length) { abrirAviso({ titulo: "Exportação", msg: "Sem dados para exportar neste gráfico.", perigo: true }); return; }
  baixarCsv([d.header, ...d.linhas], d.nome);
}

function setText(id, v) { const el = $(id); if (el) el.textContent = v; }

function renderKpis(rows) {
  const total = rows.length;
  const ativos = rows.filter(r => r.ativo).length;
  const indigenas = rows.filter(r => r.indigena).length;
  // Afastados: desconsidera Atestado, Afastamento com remuneração e Licença Paternidade.
  const afastados = rows.filter(r => r.emAfastamento && !afastamentoExcluido(r.situacao)).length;
  const ferias = rows.filter(r => r.emFerias).length;
  const desligados = rows.filter(r => !r.ativo).length;
  const porAtuacao = v => rows.filter(r => r.tipoAtuacao === v).length;

  // KPIs por tipo de atuação (TIPO_ATUACAO_TRABALHADOR).
  setText("siKpiAtDsei", formatNumber(porAtuacao("DSEI")));
  setText("siKpiAtPey", formatNumber(porAtuacao("Emergência Yanomami (PEY)")));
  setText("siKpiAtCasai", formatNumber(porAtuacao("CASAI")));
  setText("siKpiAtSamu", formatNumber(porAtuacao("SAMU Indígena")));

  // KPIs gerais.
  setText("siKpiTotal", formatNumber(total));
  setText("siKpiAtivos", formatNumber(ativos));
  setText("siKpiAtivosPct", total ? `${formatPercent(ativos / total * 100)} do total` : "—");
  setText("siKpiDesligados", formatNumber(desligados));
  setText("siKpiIndigenas", formatNumber(indigenas));
  setText("siKpiIndigenasPct", total ? `${formatPercent(indigenas / total * 100)} do total` : "—");
  setText("siKpiAfastados", formatNumber(afastados));
  setText("siKpiFerias", formatNumber(ferias));
}

function renderResumo(rows) {
  const p = [];
  const arr = (nome, lista) => {
    if (!lista.length) return;
    p.push(lista.length <= 2 ? lista.join(", ") : `${lista.length} ${nome}`);
  };
  arr("nomes", filtros.nome);
  if (filtros.indigena.length) p.push(filtros.indigena.map(v => v === "SIM" ? "Indígenas" : "Não indígenas").join(", "));
  arr("vínculos", filtros.vinculo);
  arr("situações", filtros.situacao);
  arr("cargos", filtros.cargo);
  arr("centros", filtros.centro);
  arr("UFs", filtros.uf);
  arr("territórios", filtros.territorio);
  arr("atuações", filtros.atuacao);
  arr("tipos de admissão", filtros.tipoAdmissao);
  arr("tipos de desligamento", filtros.tipoDeslig);
  if (filtros.admIni || filtros.admFim) p.push(`Admissão ${fData(filtros.admIni) || "…"}–${fData(filtros.admFim) || "…"}`);
  if (filtros.deslIni || filtros.deslFim) p.push(`Deslig. ${fData(filtros.deslIni) || "…"}–${fData(filtros.deslFim) || "…"}`);
  const resumo = p.length ? p.join(" · ") : "Todos os trabalhadores";
  setText("siResumoFiltro", `${formatNumber(rows.length)} trabalhadores · ${resumo}`);
}

// ---------- Tabela geral (todas as linhas, com rolagem) ----------
// fData (ISO -> dd/mm/aaaa) vem de utils.js (isoParaDataBr).
function cel(v) { return v ? escapeHtml(v) : "—"; }

// Ordenação por coluna (clique no cabeçalho).
function valorColuna(r, col) {
  if (col === "tipoDesligamento") return r.tipoDesligamento === "—" ? "" : r.tipoDesligamento;
  if (col === "dataAfast") return r.dataDesligamento || r.situacaoDataInicio || "";
  return r[col] !== undefined && r[col] !== null ? r[col] : "";
}

function ordenarLista(rows) {
  const { col, dir } = ordenacao;
  return rows.slice().sort((a, b) => {
    let va = valorColuna(a, col), vb = valorColuna(b, col);
    if (col === "registro") return ((Number(va) || 0) - (Number(vb) || 0)) * dir;
    va = va || ""; vb = vb || "";
    if (!va && vb) return 1;            // vazios sempre por último
    if (va && !vb) return -1;
    return String(va).localeCompare(String(vb), "pt-BR", { numeric: true }) * dir;
  });
}

function atualizarSetas() {
  const head = $("siTabelaHead");
  if (!head) return;
  head.querySelectorAll("th[data-col]").forEach(th => {
    const icon = th.querySelector(".siSortIcon");
    const ativo = th.dataset.col === ordenacao.col;
    th.classList.toggle("is-ordenado", ativo);
    if (icon) icon.className = "siSortIcon fa-solid " + (ativo ? (ordenacao.dir === 1 ? "fa-sort-up" : "fa-sort-down") : "fa-sort");
  });
}

// HTML de uma linha da tabela.
function linhaTabelaHtml(r) {
  const dataAfastDeslig = r.dataDesligamento || r.situacaoDataInicio || "";
  return `
      <tr>
        <td>${cel(r.registro)}</td>
        <td class="siTdNome">${cel(r.nome)}</td>
        <td>${cel(fData(r.dataNascimento))}</td>
        <td>${cel(r.sexo)}</td>
        <td>${cel(fData(r.dataAdmissao))}</td>
        <td>${cel(r.tipoAdmissao)}</td>
        <td>${cel(r.substituicao)}</td>
        <td class="siTdCargo">${cel(r.cargo)}</td>
        <td>${badgeSituacao(r)}</td>
        <td>${cel(r.tipoDesligamento === "—" ? "" : r.tipoDesligamento)}</td>
        <td>${cel(fData(dataAfastDeslig))}</td>
        <td>${cel(fData(r.situacaoDataFim))}</td>
        <td class="siTdLocal">${cel(r.localTrabalho)}</td>
        <td class="siTdLocal">${cel(r.centroCusto)}</td>
      </tr>`;
}

// Paginação por rolagem infinita: a base tem ~20k linhas e renderizar tudo de
// uma vez (≈280k células) trava a aba. Mostramos 100 por vez e carregamos mais
// 100 conforme o usuário rola até o fim.
const TABELA_PAGINA = 100;
let tabelaLista = [];        // lista completa (filtrada + ordenada)
let tabelaRenderizadas = 0;  // quantas linhas já estão no DOM

function renderTabela(rows) {
  const lista = ordenacao.col ? ordenarLista(rows) : rows;
  tabelaLista = lista;
  tabelaRenderizadas = 0;
  setText("siTabelaCount", `${formatNumber(lista.length)} trabalhadores`);
  atualizarSetas();

  const body = $("siTabelaBody");
  if (!body) return;
  // Volta ao topo ao trocar filtro/ordenação (senão a rolagem dispararia mais lotes).
  const wrap = body.closest(".siTableWrap");
  if (wrap) wrap.scrollTop = 0;

  if (!lista.length) {
    body.innerHTML = `<tr><td colspan="14" class="siVazio">Nenhum trabalhador encontrado para os filtros selecionados.</td></tr>`;
    setText("siTabelaRegistros", "Nenhum registro");
    return;
  }
  body.innerHTML = "";
  renderProximoLoteTabela();
}

// Acrescenta o próximo lote de linhas (append, sem reconstruir as anteriores).
function renderProximoLoteTabela() {
  const body = $("siTabelaBody");
  if (!body || tabelaRenderizadas >= tabelaLista.length) return;
  const fim = Math.min(tabelaRenderizadas + TABELA_PAGINA, tabelaLista.length);
  body.insertAdjacentHTML("beforeend",
    tabelaLista.slice(tabelaRenderizadas, fim).map(linhaTabelaHtml).join(""));
  tabelaRenderizadas = fim;
  const total = tabelaLista.length;
  setText("siTabelaRegistros", tabelaRenderizadas < total
    ? `Mostrando ${formatNumber(tabelaRenderizadas)} de ${formatNumber(total)} trabalhadores · role para carregar mais`
    : `${formatNumber(total)} trabalhadores`);
}

// ---------- Exportação Excel (CSV com BOM; abre direto no Excel) ----------
// BOM (via charCode p/ evitar ambiguidade) + ";" => abre direto no Excel.
function baixarCsv(linhas, nome) {
  const csv = String.fromCharCode(0xFEFF) + linhas.map(l => l.map(valorCsv).join(";")).join("\r\n");
  baixarArquivoCsv(csv, nome);
}

function exportarExcel() {
  if (!carregado || !dados) return;
  const rows = aplicarFiltros();
  if (!rows.length) { abrirAviso({ titulo: "Exportação", msg: "Nenhum trabalhador para exportar com os filtros atuais.", perigo: true }); return; }

  const headers = ["Registro", "Nome", "Data de Nascimento", "Sexo", "Admissão", "Tipo Admissão",
    "Substituição / Data Fim", "Cargo", "Situação", "Tipo de Desligamento",
    "Data Afastamento / Desligamento", "Término Afastamento", "Local de Trabalho", "Centro de Custo"];

  const linhas = [headers];
  rows.forEach(r => {
    linhas.push([
      r.registro, r.nome, fData(r.dataNascimento), r.sexo, fData(r.dataAdmissao), r.tipoAdmissao,
      r.substituicao, r.cargo, r.situacao, (r.tipoDesligamento === "—" ? "" : r.tipoDesligamento),
      fData(r.dataDesligamento || r.situacaoDataInicio), fData(r.situacaoDataFim), r.localTrabalho, r.centroCusto
    ]);
  });

  const csv = "\uFEFF" + linhas.map(l => l.map(valorCsv).join(";")).join("\r\n");
  baixarArquivoCsv(csv, "trabalhadores_saude_indigena.csv");
}

function badgeSituacao(r) {
  const cls = r.ativo ? "is-ativo" : "is-deslig";
  return `<span class="siBadge ${cls}">${escapeHtml(r.situacao || "—")}</span>`;
}

// ---------- Helpers de gráfico (Chart.js, isolados) ----------
function destruir(id) { if (chartsSI[id]) { chartsSI[id].destroy(); chartsSI[id] = null; } }

function semDados(canvasId, lista) {
  const canvas = $(canvasId);
  if (!canvas) return true;
  if (!lista.length || lista.every(v => !v)) {
    destruir(canvasId);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return true;
  }
  return false;
}

function coresPara(labels, overrides) {
  return labels.map((_, i) => (overrides && overrides[i]) ? overrides[i] : PALETA[i % PALETA.length]);
}

function rosca(canvasId, labels, values, overrides, opts) {
  if (typeof Chart === "undefined" || semDados(canvasId, values)) return;
  destruir(canvasId);
  const cores = coresPara(labels, overrides);
  const total = values.reduce((a, b) => a + b, 0);
  // legendReverse: numa rosca de 2 fatias, a 1ª fatia fica à direita e a 2ª à
  // esquerda; invertendo a legenda, cada rótulo fica do lado da sua fatia.
  const legendReverse = !!(opts && opts.legendReverse);
  chartsSI[canvasId] = new Chart($(canvasId), {
    type: "doughnut",
    data: { labels, datasets: [{ data: values, backgroundColor: cores, borderColor: "#fff", borderWidth: 3, hoverOffset: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "58%", layout: { padding: 10 },
      plugins: {
        legend: { position: "bottom", reverse: legendReverse, labels: { color: TEXTO, font: { size: 11, weight: "700" }, boxWidth: 12, padding: 10 } },
        datalabels: {
          color: "#fff", font: { size: 14, weight: "900" },
          textStrokeColor: "rgba(0,0,0,.55)", textStrokeWidth: 3,
          textShadowBlur: 5, textShadowColor: "rgba(0,0,0,.45)",
          formatter: v => total > 0 && (v / total) >= 0.03 ? formatPercent(v / total * 100) : ""
        },
        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${formatNumber(ctx.raw)} (${formatPercent(total ? ctx.raw / total * 100 : 0)})` } }
      }
    }
  });
}

// Barras horizontais empilhadas (composição por raça/cor).
function barEmpilhada(canvasId, labels, series) {
  if (typeof Chart === "undefined" || !labels.length) { destruir(canvasId); return; }
  destruir(canvasId);
  chartsSI[canvasId] = new Chart($(canvasId), {
    type: "bar",
    data: {
      labels,
      datasets: series.map(s => ({ label: s.label, data: s.data, backgroundColor: s.cor, borderRadius: 3, borderWidth: 0 }))
    },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false,
      layout: { padding: { right: 14, left: 2, top: 2, bottom: 2 } },
      plugins: {
        legend: { display: true, position: "top", labels: { color: TEXTO, font: { size: 11, weight: "700" }, boxWidth: 12, padding: 10 } },
        datalabels: { display: false },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatNumber(ctx.raw)}` } }
      },
      scales: {
        x: { stacked: true, beginAtZero: true, grid: { display: false }, ticks: { color: "rgba(7, 52, 107, .72)", font: { size: 10, weight: "700" } } },
        y: { stacked: true, grid: { display: false }, ticks: { color: TEXTO, font: { size: 10.5, weight: "800" }, autoSkip: false } }
      }
    }
  });
}

function barH(canvasId, labels, values, cor) {
  if (typeof Chart === "undefined" || semDados(canvasId, values)) return;
  destruir(canvasId);
  chartsSI[canvasId] = new Chart($(canvasId), {
    type: "bar",
    data: { labels, datasets: [{ data: values, backgroundColor: cor, borderRadius: 6, barPercentage: 0.6, categoryPercentage: 0.8, maxBarThickness: 26 }] },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false,
      layout: { padding: { right: 38, left: 2, top: 2, bottom: 2 } },
      plugins: {
        legend: { display: false },
        datalabels: { anchor: "end", align: "right", color: TEXTO, font: { size: 11, weight: "900" }, formatter: v => formatNumber(v), clip: false },
        tooltip: { callbacks: { label: ctx => formatNumber(ctx.raw) } }
      },
      scales: {
        x: { beginAtZero: true, grid: { display: false }, ticks: { color: "rgba(7, 52, 107, .72)", font: { size: 10, weight: "700" } } },
        y: { grid: { display: false }, ticks: { color: TEXTO, font: { size: 10.5, weight: "800" }, autoSkip: false } }
      }
    }
  });
}

function colunas(canvasId, labels, values, cor) {
  if (typeof Chart === "undefined" || semDados(canvasId, values)) return;
  destruir(canvasId);
  chartsSI[canvasId] = new Chart($(canvasId), {
    type: "bar",
    data: { labels, datasets: [{ data: values, backgroundColor: cor, borderRadius: 6, barPercentage: 0.55, categoryPercentage: 0.78, maxBarThickness: 46 }] },
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 20, right: 6, bottom: 2, left: 6 } },
      plugins: {
        legend: { display: false },
        datalabels: { anchor: "end", align: "top", offset: 2, color: TEXTO, font: { size: 10, weight: "900" }, formatter: v => formatNumber(v), clip: false },
        tooltip: { callbacks: { label: ctx => formatNumber(ctx.raw) } }
      },
      scales: {
        y: { beginAtZero: true, grid: { display: false }, ticks: { color: "rgba(7, 52, 107, .72)", font: { size: 10, weight: "700" } } },
        x: { grid: { display: false }, ticks: { color: TEXTO, font: { size: 10, weight: "800" }, autoSkip: false, maxRotation: 0, minRotation: 0 } }
      }
    }
  });
}

// Linha temporal: melhor que barras quando há muitos períodos (ex.: detalhe por
// dia). Área suave, sem rótulos por ponto (poluiria) e eixo X com autoSkip.
function linhaTempo(canvasId, labels, values, cor) {
  if (typeof Chart === "undefined" || semDados(canvasId, values)) return;
  destruir(canvasId);
  chartsSI[canvasId] = new Chart($(canvasId), {
    type: "line",
    data: {
      labels,
      datasets: [{
        data: values, borderColor: cor, backgroundColor: cor + "22",
        fill: true, tension: 0.25, borderWidth: 2,
        pointRadius: labels.length > 90 ? 0 : 2, pointHoverRadius: 5
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 18, right: 12, bottom: 2, left: 6 } },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        datalabels: { display: false },
        tooltip: { callbacks: { label: ctx => formatNumber(ctx.raw) } }
      },
      scales: {
        y: { beginAtZero: true, grid: { display: false }, ticks: { color: "rgba(7, 52, 107, .72)", font: { size: 10, weight: "700" } } },
        x: { grid: { display: false }, ticks: { color: TEXTO, font: { size: 9.5, weight: "700" }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } }
      }
    }
  });
}

// Escolhe a forma do gráfico de movimentação: barras para poucos períodos,
// linha para muitos (detalhe por dia/mês com muitos pontos fica ilegível em barras).
function desenharSerie(canvasId, serie, cor) {
  const labels = serie.map(d => d[0]);
  const values = serie.map(d => d[1]);
  if (labels.length > 24) linhaTempo(canvasId, labels, values, cor);
  else colunas(canvasId, labels, values, cor);
}

// ---------- Inicialização ----------

export function configurarSaudeIndigena() {
  if (configurado) return;
  const raiz = $("view-painelSaudeIndigena");
  if (!raiz) return;
  configurado = true;

  // Comboboxes pesquisáveis de múltipla seleção. O render é debounced para
  // não re-renderizar a tabela inteira (~20k linhas) a cada clique/tecla.
  const onFiltro = debounce(() => { lerFiltros(); render(); }, 140);
  criarCombo("siFiltroNome", "Todos os trabalhadores", onFiltro, { searchPlaceholder: "Digite o nome…", maxRender: 80 });
  criarCombo("siFiltroIndigena", "Todos os trabalhadores", onFiltro);
  criarCombo("siFiltroVinculo", "Todos os vínculos", onFiltro);
  criarCombo("siFiltroSituacao", "Todas as situações", onFiltro);
  criarCombo("siFiltroCargo", "Todos os cargos", onFiltro);
  criarCombo("siFiltroCentro", "Todos os centros de custo", onFiltro);
  criarCombo("siFiltroUf", "Todas as UFs", onFiltro);
  criarCombo("siFiltroTerritorio", "Todos os territórios", onFiltro);
  criarCombo("siFiltroAtuacao", "Todas as atuações", onFiltro);
  criarCombo("siFiltroTipoAdmissao", "Todos os tipos de admissão", onFiltro);
  criarCombo("siFiltroTipoDeslig", "Todos os tipos de desligamento", onFiltro);

  // Fecha qualquer combo ao clicar fora.
  document.addEventListener("click", () => fecharTodosCombos(null));

  // Carregamento sob demanda ao abrir a aba.
  const navItem = document.querySelector('.navItem[data-view="painelSaudeIndigena"]');
  if (navItem) navItem.addEventListener("click", () => { if (!carregado && !carregando) carregar(); });
  if (state.activeView === "painelSaudeIndigena") carregar();

  // Períodos por data (reagem na digitação): debounced (~250ms) para não
  // refiltrar/re-renderizar a base inteira (~20k linhas, tabela sem paginação)
  // a cada tecla.
  const onFiltroBusca = debounce(onFiltro, 250);
  raiz.querySelectorAll("[data-si-filtro]").forEach(el => el.addEventListener("input", onFiltroBusca));

  $("siBtnLimpar")?.addEventListener("click", limparFiltros);
  $("siBtnExportar")?.addEventListener("click", exportarExcel);

  // Exportação por gráfico (botões com data-export).
  raiz.addEventListener("click", e => {
    const b = e.target.closest("[data-export]");
    if (b) exportarGrafico(b.dataset.export);
  });

  // Detalhamento dos gráficos de movimentação por Ano / Mês / Dia.
  raiz.querySelectorAll("[data-si-gran]").forEach(btn => {
    btn.addEventListener("click", () => {
      const alvo = btn.dataset.siGranAlvo; // "admissao" | "deslig"
      const val = btn.dataset.siGran;      // "ano" | "mes" | "dia"
      if (alvo === "admissao") granAdmissao = val; else granDeslig = val;
      raiz.querySelectorAll(`[data-si-gran-alvo="${alvo}"]`)
        .forEach(b => b.classList.toggle("is-ativo", b === btn));
      if (!carregado || !dados) return;
      const rows = aplicarFiltros();
      if (alvo === "admissao") renderSerieAdmissao(rows); else renderSerieDeslig(rows);
    });
  });

  // Rolagem infinita: ao chegar perto do fim, carrega mais 100 linhas.
  const tabelaWrap = raiz.querySelector(".siTableWrap");
  if (tabelaWrap) {
    tabelaWrap.addEventListener("scroll", () => {
      if (tabelaWrap.scrollTop + tabelaWrap.clientHeight >= tabelaWrap.scrollHeight - 320) {
        renderProximoLoteTabela();
      }
    });
  }

  // Ordenação da tabela (clique no cabeçalho alterna asc/desc).
  $("siTabelaHead")?.addEventListener("click", e => {
    const th = e.target.closest("th[data-col]");
    if (!th) return;
    const col = th.dataset.col;
    if (ordenacao.col === col) ordenacao.dir = -ordenacao.dir;
    else { ordenacao.col = col; ordenacao.dir = 1; }
    renderTabela(aplicarFiltros());
  });

  window.addEventListener("resize", () => {
    Object.values(chartsSI).forEach(c => { if (c) c.resize(); });
  });
}
