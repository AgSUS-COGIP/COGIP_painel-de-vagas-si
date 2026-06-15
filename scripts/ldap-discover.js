/**
 * Script de DESCOBERTA do LDAP/Active Directory (somente leitura).
 *
 * Objetivo: a partir das credenciais de serviço no .env (LDAP_URL, LDAP_BIND_DN,
 * LDAP_BIND_PASSWORD, LDAP_SEARCH_BASE), explorar o diretório para descobrirmos:
 *   1) Se a conexão/bind funciona e qual a base real (RootDSE / namingContexts).
 *   2) Quais atributos os objetos de usuário possuem (amostra).
 *   3) Se existe algum atributo que possa guardar login/senha do SEI.
 *
 * IMPORTANTE: o AD nunca devolve senhas (unicodePwd/userPassword são write-only/hash).
 * Este script NÃO tenta ler senhas; ele apenas mapeia a estrutura para sabermos
 * onde (e se) as credenciais do SEI estão guardadas.
 *
 * Uso:  node scripts/ldap-discover.js
 */
require("dotenv").config();

const { Client } = require("ldapts");

const CFG = {
  url: process.env.LDAP_URL || "",
  bindDN: process.env.LDAP_BIND_DN || "",
  bindPassword: process.env.LDAP_BIND_PASSWORD || "",
  searchBase: process.env.LDAP_SEARCH_BASE || "",
  rejectUnauthorized: String(process.env.LDAP_TLS_REJECT_UNAUTHORIZED || "true") !== "false",
  timeout: Number(process.env.LDAP_TIMEOUT || 8000),
  amostraUsuarios: Number(process.env.LDAP_DISCOVER_AMOSTRA || 5)
};

// Atributos cujo NOME sugere login/senha/sistema externo (ex.: SEI). Só usamos os
// nomes para destacar candidatos — não exibimos valores de campos de senha.
const PADROES_INTERESSE = /sei|senha|pass|pwd|login|user|account|sistema|cred|token/i;
// Nunca imprimir o valor destes (são binários/sensíveis), mesmo que apareçam.
const ATRIBUTOS_SENSIVEIS = /unicodePwd|userPassword|^pwd|Hash|secret|objectSid|objectGUID|^msExch.*BL$/i;

function linha(c = "─", n = 72) { return c.repeat(n); }

function truncar(valor, max = 120) {
  const s = Array.isArray(valor) ? valor.join(" | ") : String(valor);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function imprimirEntrada(entrada, { mascararSensiveis = true } = {}) {
  console.log(`  DN: ${entrada.dn}`);
  const chaves = Object.keys(entrada).filter(k => k !== "dn").sort();
  for (const chave of chaves) {
    const destaque = PADROES_INTERESSE.test(chave) ? "  <== candidato" : "";
    if (mascararSensiveis && ATRIBUTOS_SENSIVEIS.test(chave)) {
      console.log(`    ${chave}: [valor oculto]${destaque}`);
    } else {
      console.log(`    ${chave}: ${truncar(entrada[chave])}${destaque}`);
    }
  }
  console.log("");
}

async function main() {
  console.log(linha("="));
  console.log("DESCOBERTA LDAP — somente leitura");
  console.log(linha("="));
  console.log(`URL ................ ${CFG.url || "(vazio!)"}`);
  console.log(`Bind DN ............ ${CFG.bindDN || "(vazio!)"}`);
  console.log(`Search Base ........ ${CFG.searchBase || "(vazio — vamos tentar pelo RootDSE)"}`);
  console.log(`TLS reject unauth .. ${CFG.rejectUnauthorized}`);
  console.log("");

  if (!CFG.url || !CFG.bindDN || !CFG.bindPassword) {
    console.error("Faltam variáveis no .env (LDAP_URL, LDAP_BIND_DN, LDAP_BIND_PASSWORD).");
    process.exit(1);
  }

  const client = new Client({
    url: CFG.url,
    timeout: CFG.timeout,
    connectTimeout: CFG.timeout,
    tlsOptions: { rejectUnauthorized: CFG.rejectUnauthorized }
  });

  try {
    // 1) Bind com a conta de serviço.
    await client.bind(CFG.bindDN, CFG.bindPassword);
    console.log("✓ Bind realizado com sucesso.\n");

    // 2) RootDSE: descobre as bases disponíveis (namingContexts/defaultNamingContext).
    console.log(linha());
    console.log("1) RootDSE (bases e capacidades do servidor)");
    console.log(linha());
    try {
      const { searchEntries } = await client.search("", {
        scope: "base",
        filter: "(objectClass=*)",
        attributes: [
          "namingContexts", "defaultNamingContext", "rootDomainNamingContext",
          "configurationNamingContext", "schemaNamingContext",
          "dnsHostName", "ldapServiceName", "supportedLDAPVersion"
        ]
      });
      for (const e of searchEntries) imprimirEntrada(e, { mascararSensiveis: false });
    } catch (err) {
      console.log(`  (não foi possível ler o RootDSE: ${err.message})\n`);
    }

    const base = CFG.searchBase;
    if (!base) {
      console.log("Sem LDAP_SEARCH_BASE definido — use um dos namingContexts acima e rode de novo.");
      return;
    }

    // 3) Amostra de objetos de USUÁRIO com TODOS os atributos legíveis.
    console.log(linha());
    console.log(`2) Amostra de usuários em: ${base}`);
    console.log(`   (mostrando até ${CFG.amostraUsuarios} — todos os atributos legíveis)`);
    console.log(linha());
    const atributosVistos = new Set();
    const candidatos = new Set();
    try {
      const { searchEntries } = await client.search(base, {
        scope: "sub",
        filter: "(&(objectCategory=person)(objectClass=user))",
        sizeLimit: CFG.amostraUsuarios,
        // "*" = atributos normais; ldapts traz o que a conta de serviço puder ler.
        attributes: ["*"]
      });

      if (!searchEntries.length) {
        console.log("  Nenhum usuário retornado (verifique a base ou o filtro).\n");
      }
      for (const e of searchEntries) {
        imprimirEntrada(e);
        for (const k of Object.keys(e)) {
          if (k === "dn") continue;
          atributosVistos.add(k);
          if (PADROES_INTERESSE.test(k)) candidatos.add(k);
        }
      }
    } catch (err) {
      console.log(`  (falha na busca de usuários: ${err.message})\n`);
    }

    // 4) Resumo: todos os atributos encontrados + candidatos a login/senha do SEI.
    console.log(linha());
    console.log("3) Resumo dos atributos encontrados nos usuários");
    console.log(linha());
    console.log("Todos os atributos vistos:");
    console.log("  " + (Array.from(atributosVistos).sort().join(", ") || "(nenhum)"));
    console.log("");
    console.log("Atributos candidatos (nome sugere login/senha/SEI):");
    console.log("  " + (Array.from(candidatos).sort().join(", ") || "(nenhum encontrado)"));
    console.log("");
    console.log("Lembrete: senhas (unicodePwd/userPassword) NUNCA retornam em buscas.");
    console.log("Se as credenciais do SEI não aparecerem como atributo de texto acima,");
    console.log("elas não estão acessíveis via LDAP e precisarão de outra fonte.");
  } catch (err) {
    console.error("\n✗ Erro:", err && err.message ? err.message : err);
    console.error("  (verifique LDAP_URL, credenciais de bind, rede/porta e TLS).");
    process.exitCode = 1;
  } finally {
    try { await client.unbind(); } catch { /* ignora */ }
  }
}

main();
