// Helpers puros (sanitização de valores, datas, somas). Sem dependências de
// banco/HTTP. Usa apenas a config (fuso horário).
const { DASH_CONFIG } = require("./config");

function mesesAteFimDoAno() {
  const mes = new Date().getMonth() + 1; // 1..12
  return Math.max(1, 13 - mes);
}

function somaServidor(rows, field) {
  return (rows || []).reduce((acc, row) => acc + Number(row[field] || 0), 0);
}

function normalizarChaveDash(valor) {
  return limparValorDash(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function limparValorDash(valor) {
  if (valor === null || valor === undefined) return "";

  return String(valor)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function converterNumeroDash(valor) {
  if (valor === null || valor === undefined || valor === "") return 0;
  if (typeof valor === "number") return valor;

  let texto = String(valor).trim();
  if (!texto) return 0;

  texto = texto.replace(/[^\d,.-]/g, "");

  const lastComma = texto.lastIndexOf(",");
  const lastDot = texto.lastIndexOf(".");

  if (lastComma >= 0 && lastDot >= 0) {
    texto = lastComma > lastDot
      ? texto.replace(/\./g, "").replace(",", ".")
      : texto.replace(/,/g, "");
  } else if (lastComma >= 0) {
    texto = texto.replace(/\./g, "").replace(",", ".");
  } else {
    texto = texto.replace(/,/g, "");
  }

  const numero = Number(texto);
  return Number.isNaN(numero) ? 0 : numero;
}

function formatarDataBancoDash(valor) {
  if (!valor) return "";

  if (valor instanceof Date) {
    return formatDateInTimeZone(valor, DASH_CONFIG.TIMEZONE);
  }

  const texto = limparValorDash(valor);
  const matchMySql = texto.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/);
  if (matchMySql) {
    const [, ano, mes, dia, hora = "00", minuto = "00", segundo = "00"] = matchMySql;
    return `${dia}/${mes}/${ano} ${hora}:${minuto}:${segundo}`;
  }

  const data = new Date(texto);
  if (!Number.isNaN(data.getTime())) {
    return formatDateInTimeZone(data, DASH_CONFIG.TIMEZONE);
  }

  return texto;
}

function extrairCompetenciaDash(atualizacao) {
  if (!atualizacao) return "";

  const texto = String(atualizacao).trim();
  const matchBR = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (matchBR) {
    return `${nomeMesDash(Number(matchBR[2]))}/${Number(matchBR[3])}`;
  }

  const matchISO = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (matchISO) {
    return `${nomeMesDash(Number(matchISO[2]))}/${Number(matchISO[1])}`;
  }

  return "";
}

function nomeMesDash(mes) {
  const nomes = [
    "",
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro"
  ];

  return nomes[mes] || "";
}

function obterUltimaAtualizacaoDash(rows) {
  const atualizacoes = (rows || []).map(r => r.atualizacaoDados).filter(Boolean);
  return atualizacoes[0] || formatDateInTimeZone(new Date(), DASH_CONFIG.TIMEZONE);
}

function aguardar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatDateInTimeZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  const parts = formatter.formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value || "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

module.exports = { limparValorDash, converterNumeroDash, normalizarChaveDash, formatarDataBancoDash, extrairCompetenciaDash, nomeMesDash, obterUltimaAtualizacaoDash, somaServidor, mesesAteFimDoAno, formatDateInTimeZone, aguardar };
