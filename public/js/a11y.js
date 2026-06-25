// Acessibilidade aplicada uma vez sobre o HTML estático (no init):
//   1) marca ícones decorativos (Font Awesome) como aria-hidden;
//   2) associa cada <label> ao seu controle (for/id) quando ainda não associado.
// É um complemento aos atributos já presentes no HTML (nav, modais, radiogroups):
// onde o atributo já existe, nada é alterado. Roda só sobre o que existe no
// carregamento; conteúdo renderizado dinamicamente já nasce com o rótulo textual.
export function aplicarAcessibilidade(raiz = document) {
  try {
    marcarIconesDecorativos(raiz);
    associarLabels(raiz);
  } catch (e) {
    // Acessibilidade é progressiva: uma falha aqui nunca deve quebrar o painel.
    console.error("Falha ao aplicar ajustes de acessibilidade:", e);
  }
}

// Ícones do Font Awesome são puramente visuais; o texto vizinho já dá o nome
// acessível. Marca como aria-hidden os que ainda não têm o atributo.
function marcarIconesDecorativos(raiz) {
  raiz.querySelectorAll("i.fa-solid, i.fa-regular, i.fa-brands, i.fa-light, i.fa-thin, i.fa-duotone")
    .forEach(icone => {
      if (!icone.hasAttribute("aria-hidden")) icone.setAttribute("aria-hidden", "true");
    });
}

// Para cada <label> sem `for` e sem controle aninhado (estes já se associam
// sozinhos), liga ao controle imediatamente seguinte (input/select/textarea com
// id) — o padrão dominante "<label>Texto</label><input id=…>". Conservador: só
// associa quando o irmão seguinte é um controle com id, evitando associações
// ambíguas.
function associarLabels(raiz) {
  raiz.querySelectorAll("label:not([for])").forEach(label => {
    if (label.querySelector("input, select, textarea")) return; // controle aninhado
    const proximo = label.nextElementSibling;
    if (proximo && proximo.matches("input[id], select[id], textarea[id]")) {
      label.setAttribute("for", proximo.id);
    }
  });
}
