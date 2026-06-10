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

    export function limitarLabelGrafico(label, limite) {
      const texto = String(label || "");
      const max = limite || 14;
      if (texto.length <= max) return texto;
      return texto.slice(0, max - 1).trim() + "…";
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
      return String(valor ?? "").replace(/"/g, '\\"');
    }

    export function mesesAteFimDoAno() {
      const mes = new Date().getMonth() + 1; // 1..12
      return Math.max(1, 13 - mes);
    }

    export function aplicarClasseResultado(id, value) {
      const el = document.getElementById(id);
      if (!el) return;

      el.classList.toggle("positivo", Number(value || 0) > 0);
      el.classList.toggle("negativo", Number(value || 0) < 0);
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

    export function escapeJs(value) {
      return String(value ?? "")
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
    }
