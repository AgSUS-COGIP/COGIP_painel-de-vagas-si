import { state } from "./state.js";

export async function carregarConfiguracaoApp_() {
  // Config é OPCIONAL para o boot: só define URLs de painéis externos, o
  // googleClientId (botão de login Google) e imagens de fundo — todos com default
  // seguro. Uma falha em /api/config NÃO deve derrubar o app; segue com defaults.
  let config = {};
  try {
    config = await apiGet("/api/config");
  } catch (e) {
    console.warn("[config] Falha ao carregar /api/config; seguindo com defaults.", e && e.message ? e.message : e);
  }
  state.DASHBOARD_SAUDE_INDIGENA_URL = String(config.dashboardSaudeIndigenaUrl || "").trim();
  state.DASHBOARD_FERIAS_URL = String(config.dashboardFeriasUrl || "").trim();
  state.googleClientId = String(config.googleClientId || "").trim();

  const root = document.documentElement;
  root.style.setProperty("--background-painel-image", config.backgroundPainelUrl ? `url("${config.backgroundPainelUrl}")` : "none");
  root.style.setProperty("--imagem-indigena-painel-image", config.imagemIndigenaPainelUrl ? `url("${config.imagemIndigenaPainelUrl}")` : "none");

  document.querySelectorAll("[data-config-src]").forEach(img => {
    const key = img.getAttribute("data-config-src");
    const value = config[key];

    if (value) {
      img.src = value;
    }
  });
}

export function authHeaders(extra) {
  // Sessão via cookie HttpOnly (enviado automaticamente em requisições same-origin).
  return Object.assign({ Accept: "application/json" }, extra || {});
}

export async function apiGet(path) {
  const response = await fetch(path, {
    headers: authHeaders(),
    // Sempre busca do servidor: sem isso o navegador pode devolver uma resposta
    // cacheada (ex.: matriz de permissões recém-alterada aparecendo desatualizada).
    cache: "no-store"
  });

  if (!response.ok) {
    let message = `Erro ${response.status}`;

    try {
      const payload = await response.json();
      if (payload && payload.error) message = payload.error;
    } catch (err) { }

    throw new Error(message);
  }

  return response.json();
}

export async function apiPost(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body || {})
  });

  if (!response.ok) {
    let message = `Erro ${response.status}`;

    try {
      const payload = await response.json();
      if (payload && payload.error) message = payload.error;
    } catch (err) { }

    throw new Error(message);
  }

  return response.json();
}

export async function apiDelete(path) {
  const response = await fetch(path, {
    method: "DELETE",
    headers: authHeaders(),
    cache: "no-store"
  });

  if (!response.ok) {
    let message = `Erro ${response.status}`;

    try {
      const payload = await response.json();
      if (payload && payload.error) message = payload.error;
    } catch (err) { }

    throw new Error(message);
  }

  return response.json();
}
