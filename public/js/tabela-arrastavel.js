// =========================================================
// Helper reutilizável: grade Tabulator com colunas/linhas arrastáveis
// =========================================================
// Encapsula a configuração validada na Gestão Disciplinar para reusar nas demais
// grades SIMPLES (listas): Tabulator com movableColumns/movableRows, layout
// fitColumns, cabeçalho fixo + rolagem, persistência do layout das COLUNAS
// (recurso nativo) e da ordem das LINHAS (localStorage), além dos coachmarks de
// onboarding (dicas de arrastar).
//
// As chaves dos coachmarks são GENÉRICAS por tipo de dica (compartilhadas entre
// TODAS as tabelas): dispensou numa, não reaparece nas outras.
//
// Uso típico (re-render a cada filtro):
//   const grade = criarTabelaArrastavel({
//     elemento: "minhaTabelaDiv",      // id do <div> vazio (ou o próprio elemento)
//     colunas: [ ...colDefs Tabulator ],
//     persistID: "minhaTabela",        // único: persiste ordem/largura das colunas
//     ordemKey: "minhaTabela:ordem",   // único: persiste a ordem das linhas (opcional)
//     indexField: "matricula",         // campo-chave único da linha (default "id")
//   });
//   grade.render(linhasFiltradas);     // realimenta aplicando a ordem salva

// ---- Coachmarks: chaves genéricas por tipo, COMPARTILHADAS entre tabelas ----
const chaveCoach = tipo => `coachReordenar:${tipo}`;

function coachVisto(tipo) {
  try { return localStorage.getItem(chaveCoach(tipo)) === "1"; }
  catch { return false; }
}

function marcarCoachVisto(tipo) {
  try { localStorage.setItem(chaveCoach(tipo), "1"); } catch { /* só nesta sessão */ }
}

// ---- "O usuário já ajustou a largura das colunas desta grade?" (por persistID) ----
// Regra 1 (dividir o espaço por igual) vale só no 1º acesso; assim que o usuário
// redimensiona uma coluna, marcamos aqui e passamos a RESPEITAR a largura escolhida
// — a partir daí é o fitDataStretch que estica a última coluna p/ não sobrar vão.
const chaveLargura = pid => `tabLarguraCustom:${pid}`;
function larguraTocada(pid) {
  if (!pid) return false;
  try { return localStorage.getItem(chaveLargura(pid)) === "1"; }
  catch { return false; }
}
function marcarLarguraTocada(pid) {
  if (!pid) return;
  try { localStorage.setItem(chaveLargura(pid), "1"); } catch { /* só nesta sessão */ }
}

const COACH_HTML = `
  <div class="tabCoach" data-tab-coach hidden>
    <div class="tabCoachBubble tabCoachBubble--cols" data-coach="colunas">
      <span>Agora é possível reordenar as colunas e o tamanho de acordo com a sua vontade.</span>
      <button type="button" class="tabCoachBtn" data-coach-fechar="colunas"><i class="fa-solid fa-check"></i> Entendi</button>
    </div>
    <div class="tabCoachBubble tabCoachBubble--rows" data-coach="linhas">
      <span>É possível reordenar as linhas para compará-las lado a lado.</span>
      <button type="button" class="tabCoachBtn" data-coach-fechar="linhas"><i class="fa-solid fa-check"></i> Entendi</button>
    </div>
  </div>`;

// Mostra cada balão ainda não visto; some o overlay quando todos já foram vistos.
function atualizarVisibilidadeCoach(coach) {
  let algumVisivel = false;
  coach.querySelectorAll("[data-coach]").forEach(balao => {
    const visto = coachVisto(balao.dataset.coach);
    balao.hidden = visto;
    if (!visto) algumVisivel = true;
  });
  coach.hidden = !algumVisivel;
}

// ---- Persistência (localStorage) da ordem das linhas ----
function lerOrdem(chave) {
  if (!chave) return [];
  try { return JSON.parse(localStorage.getItem(chave)) || []; }
  catch { return []; }
}

function salvarOrdem(chave, ids) {
  if (!chave) return;
  try { localStorage.setItem(chave, JSON.stringify(ids)); } catch { /* só nesta sessão */ }
}

// Reordena conforme a preferência salva; ids sem posição (novos) vão para o fim.
function ordenarPorPreferencia(linhas, chave, campoId) {
  const ordem = lerOrdem(chave);
  if (!ordem.length) return linhas;
  const pos = new Map(ordem.map((id, i) => [id, i]));
  return linhas
    .map((r, i) => [r, pos.has(r[campoId]) ? pos.get(r[campoId]) : ordem.length + i])
    .sort((a, b) => a[1] - b[1])
    .map(([r]) => r);
}

// Cria/retorna a grade. Retorna { tabela, render(linhas), marcarSelecionada, redraw }.
export function criarTabelaArrastavel(opts) {
  const el = typeof opts.elemento === "string" ? document.getElementById(opts.elemento) : opts.elemento;
  if (!el || !window.Tabulator) return null;

  const campoId = opts.indexField || "id";
  const ordemKey = opts.ordemKey || "";
  const moverLinhas = opts.movableRows !== false;
  const moverColunas = opts.movableColumns !== false;
  // Modo "só estilo": nada arrastável (ex.: cronograma do edital) — só o visual do
  // Tabulator. Sem coachmarks e sem cursor de arraste.
  const soEstilo = !moverLinhas && !moverColunas;
  const usarCoach = opts.coach !== false && !soEstilo;
  const idSelecionado = typeof opts.idSelecionado === "function" ? opts.idSelecionado : null;

  // ---- Preenchimento da largura (regra 1: dividir igual no 1º acesso) ----
  // Ligado por padrão; passe equalizarColunas:false p/ desligar numa grade específica.
  const equalizar = opts.equalizarColunas !== false;
  const layoutBase = opts.layout || "fitDataStretch";
  const minWidthPadrao = opts.minWidthColuna || 90;
  // Fonte da verdade p/ "coluna de largura fixa" (ex.: ações, checkbox, dias da
  // escala): a definição ORIGINAL — imune à persistência, que grava width nas
  // colunas depois que o usuário redimensiona. Assim distribuímos só o espaço das
  // colunas realmente flexíveis e nunca "engordamos" uma coluna de ação/checkbox.
  const larguraFixaPorCampo = new Map();
  const minWidthPorCampo = new Map();
  (opts.colunas || []).forEach(c => {
    if (!c || c.field == null) return;
    if (c.width != null) larguraFixaPorCampo.set(c.field, c.width);
    if (c.minWidth != null) minWidthPorCampo.set(c.field, c.minWidth);
  });
  const estadoLargura = { equalizando: false, equalizado: false, ultimaLargura: 0 };

  // Esqueleto (shimmer) durante a reconstrução da grade — opt-in por grade.
  const usarEsqueleto = opts.esqueleto === true;

  // Envolve o elemento num wrapper posicionado (base dos coachmarks) — idempotente.
  let wrap = el.closest(".tabArrWrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "tabArrWrap";
    el.parentNode.insertBefore(wrap, el);
    wrap.appendChild(el);
  }
  // Modo só-estilo: marca o wrapper para o CSS remover os cursores de arraste.
  wrap.classList.toggle("tabArrWrap--estatico", soEstilo);

  // Injeta os coachmarks uma vez e liga a dispensa individual de cada balão.
  let coach = null;
  if (usarCoach) {
    if (!wrap.querySelector("[data-tab-coach]")) wrap.insertAdjacentHTML("beforeend", COACH_HTML);
    coach = wrap.querySelector("[data-tab-coach]");
    // Mostra só as dicas pertinentes ao que é arrastável nesta tabela.
    if (!moverLinhas) coach.querySelector('[data-coach="linhas"]')?.remove();
    if (!moverColunas) coach.querySelector('[data-coach="colunas"]')?.remove();
    coach.addEventListener("click", event => {
      const btn = event.target.closest("[data-coach-fechar]");
      if (!btn) return;
      marcarCoachVisto(btn.dataset.coachFechar);
      // Some a mesma dica em TODAS as grades visíveis na página (não só nesta).
      document.querySelectorAll("[data-tab-coach]").forEach(atualizarVisibilidadeCoach);
    });
  }

  // ---- Esqueleto (skeleton) durante a reconstrução da grade ----
  // Entre destruir() e o tableBuilt da nova grade, mostra um cabeçalho + linhas
  // "shimmer" no lugar, para parecer que só os DADOS trocaram — não a tabela toda.
  // Vive no wrapper (persistente entre destruir/recriar), então a grade nova o remove.
  function mostrarEsqueleto() {
    if (!usarEsqueleto || !wrap) return;
    const altura = el.offsetHeight || 0;              // altura da grade ANTES de destruir
    let sk = wrap.querySelector(".tabSkeleton");
    if (!sk) {
      sk = document.createElement("div");
      sk.className = "tabSkeleton";
      sk.setAttribute("aria-hidden", "true");
      wrap.appendChild(sk);
    }
    // Preenche a altura anterior com ~N linhas (cabeçalho ~44px + linhas ~41px).
    const n = Math.max(4, Math.min(16, Math.round(((altura || 320) - 44) / 41)));
    sk.innerHTML = '<div class="tabSkeletonHead"></div><div class="tabSkeletonBody">' +
      '<div class="tabSkeletonRow"></div>'.repeat(n) + "</div>";
    if (altura) wrap.style.minHeight = `${altura}px`; // segura a altura enquanto remonta
    // Rede de segurança: normalmente é o tableBuilt da nova grade que esconde o
    // esqueleto (revelação limpa, já com as colunas equalizadas). Mas se aquele rAF
    // não vier (ex.: aba em segundo plano pausa o requestAnimationFrame), este timer
    // garante que o esqueleto não fique preso cobrindo a tabela. Guardado no wrapper
    // (não no closure) para ser compartilhado entre a grade destruída e a recriada.
    if (wrap._skTimer) clearTimeout(wrap._skTimer);
    wrap._skTimer = setTimeout(esconderEsqueleto, 2000);
  }

  function esconderEsqueleto() {
    if (wrap && wrap._skTimer) { clearTimeout(wrap._skTimer); wrap._skTimer = 0; }
    const sk = wrap && wrap.querySelector(".tabSkeleton");
    if (!sk) return;
    sk.remove();
    wrap.style.minHeight = "";
  }

  let tabela = null;

  function marcarSelecionada() {
    if (!tabela || !idSelecionado) return;
    const sel = idSelecionado();
    try {
      tabela.getRows().forEach(row =>
        row.getElement().classList.toggle("tab-selected", row.getData()[campoId] === sel));
    } catch { /* ainda construindo */ }
  }

  function dadosOrdenados(linhas) {
    return ordenarPorPreferencia(linhas || [], ordemKey, campoId);
  }

  // Regra 1 — preenche a tabela dividindo o espaço IGUALMENTE entre as colunas
  // flexíveis (sem width fixa na definição). Só roda no 1º acesso (enquanto o
  // usuário não redimensionou nada nesta grade); depois disso é o fitDataStretch
  // que estica a última coluna para não sobrar vão à direita (regra 2). Colunas de
  // largura fixa (ações/checkbox/dias) são respeitadas; em overflow, deixa rolar.
  function equalizarLarguras() {
    if (!tabela || !equalizar) return;
    if (layoutBase.indexOf("fitColumns") === 0) return; // fitColumns já preenche sozinho
    if (!el.clientWidth) return;                         // aba oculta: mediria errado
    if (larguraTocada(opts.persistID)) return;           // usuário já ajustou: respeita
    let cols;
    try { cols = tabela.getColumns().filter(c => c.isVisible()); } catch { return; }
    if (!cols.length) return;
    const holder = el.querySelector(".tabulator-tableholder");
    const disponivel = (holder && holder.clientWidth) || el.clientWidth;
    if (!disponivel) return;
    // Idempotente: já dividido nesta mesma largura → não refaz a cada render.
    if (estadoLargura.equalizado && estadoLargura.ultimaLargura === disponivel) return;
    const ehFixa = c => {
      const f = c.getField();
      return f != null ? larguraFixaPorCampo.has(f) : c.getDefinition().width != null;
    };
    const flex = cols.filter(c => !ehFixa(c));
    if (!flex.length) return;                            // todas fixas: nada a dividir
    // minWidth efetivo da coluna (o do columnDefaults quando ela não define o seu).
    const minEfetivo = c => {
      const f = c.getField();
      const m = f != null && minWidthPorCampo.has(f) ? minWidthPorCampo.get(f) : minWidthPadrao;
      return parseInt(m, 10) || 0;
    };
    // A largura REAL de uma coluna fixa é o maior entre a width definida e o seu
    // minWidth (o Tabulator faz esse clamp — ex.: width:64 com minWidth:90 vira 90).
    // Usar só a width definida subestimaria a soma e estouraria a tabela na direita.
    const somaFixas = cols.filter(ehFixa).reduce((soma, c) => {
      const f = c.getField();
      const def = f != null && larguraFixaPorCampo.has(f) ? larguraFixaPorCampo.get(f) : (c.getWidth() || 0);
      return soma + Math.max(def, minEfetivo(c));
    }, 0);
    const livre = disponivel - somaFixas;
    if (livre <= 0) return;                              // overflow: deixa rolar na horizontal
    const cada = Math.floor(livre / flex.length);
    estadoLargura.equalizando = true;                    // marca p/ o columnResized ignorar
    try {
      flex.forEach(c => c.setWidth(Math.max(minEfetivo(c), cada)));
    } catch { /* ainda construindo */ }
    estadoLargura.equalizando = false;
    estadoLargura.equalizado = true;
    estadoLargura.ultimaLargura = disponivel;
  }

  let pronta = false;       // tableBuilt já disparou?
  let pendente = null;      // dados pedidos enquanto ainda construía
  // Mensagem do estado vazio. Pode ser trocada em tempo real (ex.: "Carregando…",
  // erro de carregamento, "nenhum registro") via render(linhas, placeholder).
  let placeholderAtual = opts.vazio || "Nenhum registro.";

  function construir(linhas) {
    if (!el.clientWidth) return; // aba oculta: sem largura o Tabulator mede colunas erradas
    // maxHeight (padrão): a grade cresce conforme o conteúdo e só rola ao atingir o
    // limite — tabelas VAZIAS ficam no tamanho mínimo (só cabeçalho + mensagem).
    // alturaFixa: usa height fixo (DOM virtual garantido) — para tabelas enormes
    // que nunca ficam vazias (ex.: Consulta de Férias com ~20k linhas).
    const cfgAltura = opts.alturaFixa
      ? { height: opts.altura || "480px" }
      : { maxHeight: opts.altura || "480px" };
    tabela = new window.Tabulator(el, {
      data: dadosOrdenados(linhas),
      index: campoId,
      ...cfgAltura,
      // fitDataStretch: colunas na largura própria; a última estica para preencher
      // (nunca sobra espaço vazio à direita) e rola na horizontal quando o total
      // passa do container. É o "mínimo = largura do container".
      layout: layoutBase,
      columnDefaults: { minWidth: opts.minWidthColuna || 90 },
      // Ordenação por cabeçalho desligada por padrão (não conflita com mover
      // linhas). Pode ser ligada (headerSort:true) quando as linhas NÃO se movem
      // — ex.: Saúde Indígena, que preserva a ordenação clicando no cabeçalho.
      headerSort: !!opts.headerSort,
      movableColumns: moverColunas,
      movableRows: moverLinhas,
      // autoResize usa ResizeObserver e pode entrar em laço de redimensionamento
      // ("Maximum call stack size exceeded") com fitColumns/containers reflowando.
      // Grades que redesenham manualmente (via redraw() ao mostrar) passam false.
      autoResize: opts.autoResize !== false,
      persistence: { columns: true },
      persistenceID: opts.persistID,
      placeholder: placeholderAtual,
      columns: opts.colunas,
      rowFormatter: row => {
        if (idSelecionado) row.getElement().classList.toggle("tab-selected", row.getData()[campoId] === idSelecionado());
        // Gancho opcional para realce de estado por linha (ex.: is-etapa-atual,
        // is-desistiu): recebe a row do Tabulator e aplica classes próprias.
        if (typeof opts.aoFormatarLinha === "function") opts.aoFormatarLinha(row);
      },
    });
    tabela.on("tableBuilt", () => {
      pronta = true;
      if (coach) atualizarVisibilidadeCoach(coach);
      if (pendente !== null) { const p = pendente; pendente = null; aplicarDados(p); }
      // Alguns navegadores montam a grade com o CORPO vazio (só cabeçalho) até um
      // relayout — o conteúdo "some" e só aparece ao rolar/redimensionar. Um redraw
      // no próximo frame, após o layout assentar, corrige de forma determinística.
      if (typeof requestAnimationFrame === "function") {
        // Só redesenha se o elemento tem largura (visível). Redesenhar com
        // clientWidth=0 (aba oculta / layout ainda não assentou) faz o Tabulator
        // entrar em laço no adjustTableSize (RangeError: Maximum call stack).
        requestAnimationFrame(() => {
          try { if (el.clientWidth) { tabela.redraw(true); equalizarLarguras(); } } catch { /* aba oculta/destruída */ }
          esconderEsqueleto();  // revela a grade nova já pronta, no lugar do esqueleto
        });
      }
    });
    if (typeof opts.aoClicarLinha === "function") {
      tabela.on("rowClick", (e, row) => opts.aoClicarLinha(row.getData(), e, row));
    }
    if (ordemKey && moverLinhas) {
      tabela.on("rowMoved", () => salvarOrdem(ordemKey, tabela.getRows().map(r => r.getData()[campoId])));
    }
    // Quebra de texto sem custo contínuo: o `white-space: normal` do CSS já faz o
    // texto quebrar, mas a ALTURA da linha só é recalculada ao SOLTAR o
    // redimensionamento (columnResized dispara no mouseup, não a cada mousemove).
    // Evita o variableHeight, que remede todas as linhas a cada pixel arrastado.
    tabela.on("columnResized", () => {
      // Ignora o resize disparado pela nossa própria equalização (regra 1).
      if (estadoLargura.equalizando) return;
      // Regra 2: o usuário ajustou → respeita a largura escolhida daqui pra frente
      // (não reequaliza) e o fitDataStretch estica a última coluna p/ preencher o vão.
      marcarLarguraTocada(opts.persistID);
      try { if (el.clientWidth) tabela.redraw(true); } catch { /* construindo */ }
    });
  }

  // Alimenta a grade. Construção PREGUIÇOSA: a tabela é montada já COM os dados na
  // 1ª chamada (montar vazia e chamar replaceData() em seguida arrisca o Tabulator
  // ainda não ter terminado o build — replaceData rejeita e os dados somem). Enquanto
  // não dispara o tableBuilt, guarda em `pendente` e aplica depois.
  function aplicarDados(linhas) {
    if (!tabela) { construir(linhas || []); return; }
    if (!pronta) { pendente = linhas || []; return; }
    Promise.resolve(tabela.replaceData(dadosOrdenados(linhas || [])))
      .then(marcarSelecionada)
      .catch(() => { /* corrida rara de build: o tableBuilt reaplica o pendente */ });
  }

  if (opts.dados && opts.dados.length) construir(opts.dados);

  // Troca a mensagem do estado vazio. Atualiza o placeholder das próximas
  // construções/renders e, se a grade já existe e está vazia, o texto na hora.
  function definirPlaceholder(msg) {
    placeholderAtual = msg;
    if (!tabela) return;
    tabela.options.placeholder = msg;
    const ph = el.querySelector(".tabulator-placeholder-contents");
    if (ph) ph.innerHTML = msg;
  }

  return {
    get tabela() { return tabela; },
    // render(linhas[, placeholder]): o 2º argumento (opcional) troca a mensagem
    // do estado vazio antes de aplicar os dados (ex.: "Carregando…"/erro).
    render(linhas, placeholder) {
      if (placeholder != null) definirPlaceholder(placeholder);
      aplicarDados(linhas);
    },
    marcarSelecionada,
    // Só redesenha se a tabela JÁ foi construída (tableBuilt disparou). Chamar
    // redraw antes disso gera "Table Not Initialized" e erro de offsetWidth (o
    // elemento interno ainda é null). No 1º "mostrar", a grade acabou de ser
    // montada com dados — não precisa de redraw; o guard pronta evita o erro.
    redraw() {
      // clientWidth=0 (aba oculta/sem layout) faz o Tabulator entrar em laço no
      // adjustTableSize — só redesenha quando o elemento está visível.
      if (tabela && pronta && el.clientWidth) {
        try { tabela.redraw(true); equalizarLarguras(); } catch { /* aba oculta/recém-montada */ }
      }
    },
    // Destroi a grade (mantém o wrapper/coach). Usado quando o conjunto de
    // colunas muda de forma estrutural e a grade precisa ser recriada (ex.: as
    // tabelas de Vagas ao alternar entre os modos detalhado × agregado).
    destruir() {
      mostrarEsqueleto();  // esqueleto no lugar enquanto a nova grade é remontada
      if (tabela) { try { tabela.destroy(); } catch { /* já destruída */ } }
      tabela = null; pronta = false; pendente = null;
    },
  };
}
