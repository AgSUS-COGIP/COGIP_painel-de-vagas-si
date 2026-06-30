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
