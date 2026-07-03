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
      layout: opts.layout || "fitDataStretch",
      columnDefaults: { minWidth: opts.minWidthColuna || 90 },
      // Ordenação por cabeçalho desligada por padrão (não conflita com mover
      // linhas). Pode ser ligada (headerSort:true) quando as linhas NÃO se movem
      // — ex.: Saúde Indígena, que preserva a ordenação clicando no cabeçalho.
      headerSort: !!opts.headerSort,
      movableColumns: moverColunas,
      movableRows: moverLinhas,
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
        requestAnimationFrame(() => { try { tabela.redraw(true); } catch { /* aba oculta/destruída */ } });
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
    tabela.on("columnResized", () => { try { tabela.redraw(true); } catch { /* construindo */ } });
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
      if (tabela && pronta) {
        try { tabela.redraw(true); } catch { /* aba oculta/recém-montada */ }
      }
    },
    // Destroi a grade (mantém o wrapper/coach). Usado quando o conjunto de
    // colunas muda de forma estrutural e a grade precisa ser recriada (ex.: as
    // tabelas de Vagas ao alternar entre os modos detalhado × agregado).
    destruir() {
      if (tabela) { try { tabela.destroy(); } catch { /* já destruída */ } }
      tabela = null; pronta = false; pendente = null;
    },
  };
}
