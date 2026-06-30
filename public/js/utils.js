export function quebrarLabelGrafico(label, maxChars, maxLines) {
  const texto = String(label || "").trim();
  if (!texto) return "";

  const palavras = texto.split(/\s+/);
  const linhas = [];
  let linha = "";

  palavras.forEach(palavra => {
    const teste = linha ? `${linha} ${palavra}` : palavra;
    if (teste.length <= maxChars || !linha) {
      linha = teste;
    } else {
      linhas.push(linha);
      linha = palavra;
    }
  });

  if (linha) linhas.push(linha);

  if (linhas.length <= maxLines) return linhas;

  const reduzidas = linhas.slice(0, maxLines);
  reduzidas[maxLines - 1] = reduzidas[maxLines - 1].replace(/\s+$/g, "") + "…";
  return reduzidas;
}

export function normalizarNomeCargo(cargo) {
  return String(cargo || "")
    .normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .toUpperCase().replace(/\s+/g, " ").trim();
}

export function normalizarTextoPainel(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function soma(data, field) {
  return data.reduce((acc, row) => acc + Number(row[field] || 0), 0);
}

export function part(value, total) {
  if (!total) return 0;
  return (Number(value || 0) / Number(total || 0)) * 100;
}

export function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerText = value;
}

export function cssEscapeAttr(valor) {
  return String(valor ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

export function formatCurrency(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

export function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

export function valorCsv(value) {
  if (value === null || value === undefined) return "";
  return `"${String(value).replace(/"/g, '""')}"`;
}

// Dispara o download de um CSV já montado (string com BOM). Centraliza o blob +
// âncora temporária usados por todas as telas de exportação. Acrescenta ".csv"
// ao nome se faltar.
export function baixarArquivoCsv(conteudo, nomeArquivo) {
  const blob = new Blob([conteudo], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo.endsWith(".csv") ? nomeArquivo : `${nomeArquivo}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function formatNumber(value) {
  return Number(value || 0).toLocaleString("pt-BR");
}

export function formatPercent(value) {
  return `${Number(value || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })}%`;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

export function safeUrl(value) {
  // Remove espaços/quebras (evita truques como "java\tscript:" com tab/newline).
  const url = String(value ?? "").replace(/\s+/g, "").trim();
  if (!url) return "";
  if (/^(https?:|blob:|mailto:|tel:)/i.test(url)) return url;
  // Tem um esquema explícito fora da allowlist (ex.: javascript:, data:, vbscript:).
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return "";
  // Sem esquema: URL relativa, âncora (#) ou query (?) — considerada segura.
  return url;
}

// Adia a execução de `fn` até passar `delay` ms sem novas chamadas. Usado para
// evitar refiltrar/re-renderizar bases grandes a cada tecla digitada na busca.
export function debounce(fn, delay = 200) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// ---------- Datas (BR <-> ISO) ----------
// Helpers centralizados de data. Antes cada módulo reimplementava estes (com
// nomes e fallbacks diferentes); estas versões são superset das anteriores:
// aceitam dia/mês de 1-2 dígitos (com padding), toleram datas-hora ISO
// (`slice(0,10)`) e recebem o `fallback` por parâmetro para preservar o
// comportamento de cada chamador ("" em campos, "—" em tabelas).

// "aaaa-mm-dd" (ou "aaaa-mm-ddThh:mm…") -> "dd/mm/aaaa". `fallback` quando vazio/inválido.
export function isoParaDataBr(iso, fallback = "") {
  if (!iso) return fallback;
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return (a && a.length === 4 && m && d) ? `${d}/${m}/${a}` : fallback;
}

// "dd/mm/aaaa" -> "aaaa-mm-dd" (com zero à esquerda). `fallback` quando não casa.
export function dataBrParaIso(br, fallback = "") {
  const m = String(br || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : fallback;
}

// "dd/mm/aaaa" -> Date (horário local) ou null se o formato não casar.
export function dataBrParaDate(br) {
  const m = String(br || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
}

// dd/mm/aaaa com calendário válido (rejeita 32/13, 30/02, etc.). Vazio = falso.
export function dataBrValida(br) {
  const m = String(br || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return false;
  const d = +m[1], mes = +m[2], a = +m[3];
  if (mes < 1 || mes > 12 || d < 1 || d > 31) return false;
  const dt = new Date(a, mes - 1, d);
  return dt.getFullYear() === a && dt.getMonth() === mes - 1 && dt.getDate() === d;
}
