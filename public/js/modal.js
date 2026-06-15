// ----------------------------------------------------------------------------
// Modal central reutilizável (mesmo visual da página de solicitações).
// Usa o markup global #acessoModal do index.html. Oferece:
//   - abrirModal(opts): confirmação (Confirmar/Cancelar) ou entrada de texto.
//   - abrirAviso(opts): popup informativo com um único botão (sucesso/erro/bloqueio).
// abrirModal resolve { ok: true, valor } ao confirmar, ou { ok: false } ao cancelar.
// ----------------------------------------------------------------------------
function el(id) { return document.getElementById(id); }

let modalResolver = null;
let modalExigeInput = false;

// Liga os botões do modal uma única vez (idempotente).
function garantirBindModal() {
  const conf = el("acessoModalConfirmar");
  if (conf && !conf.dataset.bound) { conf.dataset.bound = "1"; conf.addEventListener("click", confirmarModalClick); }
  const canc = el("acessoModalCancelar");
  if (canc && !canc.dataset.bound) { canc.dataset.bound = "1"; canc.addEventListener("click", () => fecharModal({ ok: false })); }
  const ov = el("acessoModal");
  if (ov && !ov.dataset.bound) {
    ov.dataset.bound = "1";
    ov.addEventListener("click", (e) => { if (e.target === ov) fecharModal({ ok: false }); });
  }
}

// Abre o modal central. Com `comInput`, mostra um campo de texto (ex.: motivo da recusa).
// Com `semCancelar`, oculta o botão Cancelar (modais de aviso).
export function abrirModal(opts) {
  const o = opts || {};
  garantirBindModal();
  modalExigeInput = !!o.comInput;
  return new Promise(resolve => {
    modalResolver = resolve;
    if (el("acessoModalTitulo")) el("acessoModalTitulo").innerText = o.titulo || "Confirmar";
    if (el("acessoModalMsg")) el("acessoModalMsg").innerText = o.msg || "";
    if (el("acessoModalErro")) el("acessoModalErro").innerText = "";

    const wrap = el("acessoModalInputWrap");
    const input = el("acessoModalInput");
    if (wrap) wrap.style.display = o.comInput ? "" : "none";
    if (el("acessoModalInputLabel")) el("acessoModalInputLabel").innerText = o.inputLabel || "";
    if (input) { input.value = ""; input.placeholder = o.placeholder || ""; }

    const canc = el("acessoModalCancelar");
    if (canc) canc.style.display = o.semCancelar ? "none" : "";

    const conf = el("acessoModalConfirmar");
    if (conf) {
      conf.innerText = o.confirmarTexto || "Confirmar";
      conf.classList.toggle("solRecusar", !!o.perigo);
      conf.classList.toggle("solAprovar", !o.perigo);
    }

    const ov = el("acessoModal");
    if (ov) ov.style.display = "flex";
    if (o.comInput && input) setTimeout(() => input.focus(), 50);
  });
}

// Popup informativo com um único botão. `perigo: true` → estilo de erro/bloqueio (vermelho);
// caso contrário → estilo de sucesso (verde). Resolve quando o usuário fecha.
export function abrirAviso(opts) {
  const o = opts || {};
  return abrirModal({
    titulo: o.titulo || "Aviso",
    msg: o.msg || "",
    confirmarTexto: o.confirmarTexto || "OK",
    perigo: !!o.perigo,
    semCancelar: true
  });
}

function confirmarModalClick() {
  if (modalExigeInput) {
    const input = el("acessoModalInput");
    const valor = input ? input.value.trim() : "";
    if (!valor) {
      if (el("acessoModalErro")) el("acessoModalErro").innerText = "Este campo é obrigatório.";
      if (input) input.focus();
      return;
    }
    fecharModal({ ok: true, valor });
    return;
  }
  fecharModal({ ok: true });
}

export function fecharModal(resultado) {
  const ov = el("acessoModal");
  if (ov) ov.style.display = "none";
  const r = modalResolver;
  modalResolver = null;
  modalExigeInput = false;
  if (r) r(resultado || { ok: false });
}

// Overlay de carregamento leve (fundo translúcido + loadingDots), usado durante
// operações assíncronas como salvar/excluir remanejamento.
export function mostrarCarregando() {
  const ov = el("overlayCarregando");
  if (ov) ov.style.display = "flex";
}

export function ocultarCarregando() {
  const ov = el("overlayCarregando");
  if (ov) ov.style.display = "none";
}
