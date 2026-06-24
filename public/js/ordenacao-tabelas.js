// ordenacao-tabelas.js
// Ordenação genérica por clique no cabeçalho, aplicável a todas as tabelas do painel.
// Cada coluna detecta o tipo do conteúdo e ordena pela regra que faz sentido:
//   - texto  -> alfabética A→Z / Z→A (pt-BR, ignora acentos/maiúsculas)
//   - número -> numérica (entende R$, %, separador de milhar e decimal)
//   - data   -> cronológica (dd/mm/aaaa ou aaaa-mm-dd)
// Células vazias ("-", "—", em branco) vão sempre para o fim.
//
// Não exige alterar cada módulo de domínio: opera sobre as linhas já renderizadas
// e reaplica a ordenação automaticamente quando o corpo da tabela é recriado
// (paginação, recarga de dados etc.) via MutationObserver.

const estados = new WeakMap();      // table -> { col, dir }
const observadores = new WeakMap(); // table -> MutationObserver

// Linhas que nunca entram na ordenação (linhas de total).
const RX_LINHA_FIXA = /total/i;

function ehCelulaVazia(txt) {
  return !txt || txt === "-" || txt === "—" || txt === "–" || txt === "--";
}

// Converte texto pt-BR ("R$ 1.234,56", "45%", "1.234") em número.
function parseNumero(txt) {
  let s = txt.replace(/[^\d,.-]/g, "");
  if (!s || s === "-" || s === "." || s === ",") return null;
  if (s.includes(",")) {
    // vírgula é o separador decimal: pontos são milhar.
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    // sem vírgula: pontos provavelmente são milhar (1.234 / 1.234.567).
    const partes = s.split(".");
    if (partes.length > 2) s = partes.join("");
    else if (partes.length === 2 && partes[1].length === 3) s = partes.join("");
  }
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

// Converte data pt-BR ("22/06/2026") ou ISO ("2026-06-22") em timestamp.
function parseData(txt) {
  let m = txt.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const ano = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return new Date(ano, Number(m[2]) - 1, Number(m[1])).getTime();
  }
  m = txt.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  return null;
}

// A partir de uma amostra dos valores da coluna, decide o tipo dominante.
function detectarTipo(valores) {
  let nums = 0, datas = 0, total = 0;
  for (const v of valores) {
    if (ehCelulaVazia(v)) continue;
    total++;
    if (parseData(v) !== null) datas++;
    else if (parseNumero(v) !== null) nums++;
  }
  if (total === 0) return "texto";
  if (datas / total >= 0.6) return "data";
  if (nums / total >= 0.6) return "numero";
  return "texto";
}

function comparar(a, b, tipo) {
  if (tipo === "numero") return (parseNumero(a) || 0) - (parseNumero(b) || 0);
  if (tipo === "data") return (parseData(a) || 0) - (parseData(b) || 0);
  return a.localeCompare(b, "pt-BR", { sensitivity: "base", numeric: true });
}

function textoCelula(row, col) {
  const c = row.cells[col];
  return c ? c.textContent.trim() : "";
}

function linhaCabecalho(table) {
  const thead = table.tHead;
  if (!thead || !thead.rows.length) return null;
  return thead.rows[thead.rows.length - 1];
}

function corpo(table) {
  return table.tBodies && table.tBodies[0] ? table.tBodies[0] : null;
}

function atualizarIndicadores(table, headRow) {
  const st = estados.get(table);
  Array.from(headRow.cells).forEach((th, i) => {
    if (!th.classList.contains("ordCol")) return;
    th.classList.toggle("sortAsc", !!st && st.col === i && st.dir === "asc");
    th.classList.toggle("sortDesc", !!st && st.col === i && st.dir === "desc");
  });
}

function aplicarOrdenacao(table) {
  const st = estados.get(table);
  const tbody = corpo(table);
  const headRow = linhaCabecalho(table);
  if (!st || !tbody || !headRow) return;

  const ncol = headRow.cells.length;
  const moveis = [];
  const fixas = [];
  for (const r of Array.from(tbody.rows)) {
    if (r.cells.length === ncol && !RX_LINHA_FIXA.test(r.className)) moveis.push(r);
    else fixas.push(r); // placeholders (colspan) e linhas de total ficam no fim
  }

  if (moveis.length >= 2) {
    const tipo = detectarTipo(moveis.map(r => textoCelula(r, st.col)));
    const dir = st.dir === "desc" ? -1 : 1;
    moveis.sort((ra, rb) => {
      const a = textoCelula(ra, st.col);
      const b = textoCelula(rb, st.col);
      const ae = ehCelulaVazia(a);
      const be = ehCelulaVazia(b);
      if (ae || be) return ae === be ? 0 : (ae ? 1 : -1); // vazios sempre por último
      return dir * comparar(a, b, tipo);
    });

    // Reaplica a ordem sem disparar o próprio observer.
    const obs = observadores.get(table);
    if (obs) obs.disconnect();
    const frag = document.createDocumentFragment();
    moveis.forEach(r => frag.appendChild(r));
    fixas.forEach(r => frag.appendChild(r));
    tbody.appendChild(frag);
    if (obs) obs.observe(tbody, { childList: true });
  }

  atualizarIndicadores(table, headRow);
}

function aoClicarCabecalho(table, col) {
  const st = estados.get(table);
  if (st && st.col === col) {
    st.dir = st.dir === "asc" ? "desc" : "asc";
  } else {
    estados.set(table, { col, dir: "asc" });
  }
  aplicarOrdenacao(table);
}

function ehColunaAcoes(th) {
  const t = (th.textContent || "").trim().toLowerCase();
  return t === "ações" || t === "ação" || t === "acoes" || t === "acao";
}

function tabelaElegivel(table) {
  if (table.hasAttribute("data-sem-ordenacao")) return false;
  // Tabelas de resumo/financeiras do remanejamento têm ordem própria significativa.
  if (table.classList.contains("remTableFinanceira")) return false;
  if (table.classList.contains("remResumoTable")) return false;
  const headRow = linhaCabecalho(table);
  if (!headRow || !headRow.querySelector("th")) return false;
  // Tabela principal de Vagas tem ordenação nativa própria (cabeçalho reconstruído
  // pelo vagas.js com data-click). É identificada pelo id do cabeçalho.
  if (headRow.id === "vagasHeaderRow") return false;
  if (headRow.querySelector("th[data-click]")) return false;
  return true;
}

function decorarTabela(table) {
  const headRow = linhaCabecalho(table);
  if (!headRow) return;

  Array.from(headRow.cells).forEach((th, i) => {
    if (th.classList.contains("ordCol")) return;
    if (th.hasAttribute("data-no-sort") || ehColunaAcoes(th)) return;
    th.classList.add("ordCol");
    th.setAttribute("title", "Clique para ordenar por esta coluna");
    th.addEventListener("click", () => aoClicarCabecalho(table, i));
  });

  if (!observadores.has(table)) {
    const tbody = corpo(table);
    if (tbody) {
      const obs = new MutationObserver(() => {
        if (estados.get(table)) aplicarOrdenacao(table);
      });
      obs.observe(tbody, { childList: true });
      observadores.set(table, obs);
    }
  }
}

export function configurarOrdenacaoTabelas() {
  document.querySelectorAll("table").forEach(table => {
    if (tabelaElegivel(table)) decorarTabela(table);
  });
}
