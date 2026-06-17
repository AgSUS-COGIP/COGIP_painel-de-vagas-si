// =========================================================
// Processos Seletivos (maquete interativa)
// Aba autocontida, no mesmo padrão de gestao-ferias.js:
//   - Dados de exemplo em memória (sem backend).
//   - Cadastro de novos processos e definição de status
//     (Não iniciado / Em andamento / Encerrando em breve / Encerrado).
//   - Botão de ações que expande o detalhamento do processo:
//     quantidade de vagas, de convocados, de desistentes e o
//     acompanhamento de cada candidato convocado.
// Registra os próprios ouvintes em configurarProcessosSeletivos(),
// chamado no init do app. As ações operam sobre os dados em memória.
// =========================================================
import { abrirModal } from "./modal.js";
import { escapeAttr, escapeHtml } from "./utils.js";

// ---------- Status e badges ----------
const STATUS = ["Não iniciado", "Em andamento", "Encerrando em breve", "Encerrado"];

const BADGE_STATUS = {
  "Não iniciado": "is-naoiniciado",
  "Em andamento": "is-andamento",
  "Encerrando em breve": "is-breve",
  "Encerrado": "is-encerrado"
};

const TIPOS_VAGA = ["Ampla Concorrência", "Reserva Indígena", "Pessoa com Deficiência"];

const POR_PAGINA = 7;

// Status que congelam o DSEI para fins de Remanejamento: enquanto houver um
// processo seletivo "Em andamento" ou "Encerrando em breve", a redução de vagas
// daquele DSEI fica bloqueada (ver remanejamento.js).
const STATUS_BLOQUEIA_REMANEJAMENTO = ["Em andamento", "Encerrando em breve"];

// Mapa de DSEIs com processo(s) seletivo(s) em andamento/perto do término.
// O Remanejamento usa isto para bloquear o lado "reduzido" do DSEI. O cruzamento
// é feito pelo NOME do DSEI/cargo, pois Processos Seletivos é uma maquete de
// frontend (sem backend) e não compartilha IDs com o cadastro de remanejamento.
// Retorna: [{ dsei, cargos: [string], processos: [string] }]
export function obterBloqueiosRemanejamentoPSS() {
  const mapa = new Map();
  (processos || []).forEach(proc => {
    if (!STATUS_BLOQUEIA_REMANEJAMENTO.includes(proc.status)) return;
    const nomeDsei = String(proc.dsei || "").trim();
    if (!nomeDsei) return;
    const chave = nomeDsei.toLowerCase();
    if (!mapa.has(chave)) {
      mapa.set(chave, { dsei: nomeDsei, cargos: new Set(), processos: [] });
    }
    const item = mapa.get(chave);
    item.processos.push(proc.nome || proc.id || "Processo seletivo");
    (proc.vagas || []).forEach(vaga => {
      const cargo = String(vaga.cargo || "").trim();
      if (cargo) item.cargos.add(cargo);
    });
  });
  return [...mapa.values()].map(item => ({
    dsei: item.dsei,
    cargos: [...item.cargos],
    processos: item.processos
  }));
}

// ---------- Dados de exemplo ----------
// Cada vaga carrega também a quantidade do cadastro reserva (cadastroReserva)
// daquele cargo. Os números de "convocados/desistências" do cadastro reserva
// são derivados da lista de candidatos (fonte única da verdade).
let processos = [
  {
    id: "PS-001-2024",
    nome: "PS 001/2024 - Enfermagem", dsei: "Yanomami", unidade: "Pólo Base Auaris",
    dataInicio: "10/04/2024", divulgacao: "15/06/2024", dataFim: "15/12/2024", status: "Em andamento",
    vagas: [
      { cargo: "Enfermeiro", quantidade: 2, localidade: "Pólo Base Auaris", reservaIndigena: "Yanomami", tipoVaga: "Ampla Concorrência", cadastroReserva: 8 },
      { cargo: "Técnico de Enfermagem", quantidade: 4, localidade: "Pólo Base Auaris", reservaIndigena: "Yanomami", tipoVaga: "Ampla Concorrência", cadastroReserva: 15 }
    ],
    candidatos: [
      // Lista de convocados do cargo "Enfermeiro".
      { cargo: "Enfermeiro", nome: "João da Silva", classificacao: "1º", dataConvocacao: "20/05/2024", desistencia: false, documento: "" },
      { cargo: "Enfermeiro", nome: "Ana Costa", classificacao: "2º", dataConvocacao: "21/05/2024", desistencia: false, documento: "" },
      { cargo: "Enfermeiro", nome: "Pedro Henrique Alves", classificacao: "3º", dataConvocacao: "23/05/2024", desistencia: true, documento: "Termo_Desistencia_Pedro_Henrique_Alves.pdf" },
      // Lista de convocados do cargo "Técnico de Enfermagem" (diferente da anterior).
      { cargo: "Técnico de Enfermagem", nome: "Maria Oliveira", classificacao: "1º", dataConvocacao: "22/05/2024", desistencia: false, documento: "" },
      { cargo: "Técnico de Enfermagem", nome: "Carlos Mendes", classificacao: "2º", dataConvocacao: "22/05/2024", desistencia: true, documento: "Termo_Desistencia_Carlos_Mendes.pdf" },
      { cargo: "Técnico de Enfermagem", nome: "Juliana Reis", classificacao: "3º", dataConvocacao: "24/05/2024", desistencia: false, documento: "" },
      { cargo: "Técnico de Enfermagem", nome: "Bruno Alves", classificacao: "4º", dataConvocacao: "27/05/2024", desistencia: false, documento: "" },
      { cargo: "Técnico de Enfermagem", nome: "Sandra Melo", classificacao: "5º", dataConvocacao: "28/05/2024", desistencia: true, documento: "Termo_Desistencia_Sandra_Melo.pdf" }
    ]
  },
  {
    id: "PS-002-2024",
    nome: "PS 002/2024 - Médico Clínico Geral", dsei: "Alto Rio Negro", unidade: "Pólo Base São Gabriel",
    dataInicio: "20/04/2024", divulgacao: "25/06/2024", dataFim: "25/12/2024", status: "Em andamento",
    vagas: [
      { cargo: "Médico Clínico Geral", quantidade: 3, localidade: "Pólo Base São Gabriel", reservaIndigena: "Alto Rio Negro", tipoVaga: "Ampla Concorrência", cadastroReserva: 10 }
    ],
    candidatos: [
      { cargo: "Médico Clínico Geral", nome: "Ana Beatriz Rocha", classificacao: "1º", dataConvocacao: "28/06/2024", desistencia: false, documento: "" },
      { cargo: "Médico Clínico Geral", nome: "Rafael Souza", classificacao: "2º", dataConvocacao: "28/06/2024", desistencia: false, documento: "" },
      { cargo: "Médico Clínico Geral", nome: "Marcelo Reis", classificacao: "3º", dataConvocacao: "01/07/2024", desistencia: false, documento: "" },
      { cargo: "Médico Clínico Geral", nome: "Fernanda Dias", classificacao: "4º", dataConvocacao: "02/07/2024", desistencia: true, documento: "Termo_Desistencia_Fernanda_Dias.pdf" }
    ]
  },
  {
    id: "PS-003-2024",
    nome: "PS 003/2024 - Odontologia", dsei: "Kayapó do Pará", unidade: "Pólo Base Tucumã",
    dataInicio: "01/05/2024", divulgacao: "30/06/2024", dataFim: "30/11/2024", status: "Em andamento",
    vagas: [
      { cargo: "Cirurgião-Dentista", quantidade: 2, localidade: "Pólo Base Tucumã", reservaIndigena: "Kayapó do Pará", tipoVaga: "Ampla Concorrência", cadastroReserva: 6 },
      { cargo: "Téc. em Saúde Bucal", quantidade: 2, localidade: "Pólo Base Tucumã", reservaIndigena: "Kayapó do Pará", tipoVaga: "Reserva Indígena", cadastroReserva: 5 }
    ],
    candidatos: [
      // Convocados do cargo "Cirurgião-Dentista".
      { cargo: "Cirurgião-Dentista", nome: "Paula Santos", classificacao: "1º", dataConvocacao: "03/07/2024", desistencia: false, documento: "" },
      { cargo: "Cirurgião-Dentista", nome: "Diego Nunes", classificacao: "2º", dataConvocacao: "04/07/2024", desistencia: false, documento: "" },
      // Convocados do cargo "Téc. em Saúde Bucal" (lista distinta).
      { cargo: "Téc. em Saúde Bucal", nome: "Larissa Gomes", classificacao: "1º", dataConvocacao: "05/07/2024", desistencia: false, documento: "" },
      { cargo: "Téc. em Saúde Bucal", nome: "Marcos Vinícius Souza", classificacao: "2º", dataConvocacao: "06/07/2024", desistencia: true, documento: "Termo_Desistencia_Marcos_Vinicius_Souza.pdf" }
    ]
  },
  {
    id: "PS-004-2024",
    nome: "PS 004/2024 - Técnico de Enfermagem", dsei: "Leste de Roraima", unidade: "Pólo Base Surucucu",
    dataInicio: "05/05/2024", divulgacao: "05/07/2024", dataFim: "05/01/2025", status: "Em andamento",
    vagas: [
      { cargo: "Técnico de Enfermagem", quantidade: 5, localidade: "Pólo Base Surucucu", reservaIndigena: "Leste de Roraima", tipoVaga: "Reserva Indígena", cadastroReserva: 16 }
    ],
    candidatos: [
      { cargo: "Técnico de Enfermagem", nome: "Juliana Castro", classificacao: "1º", dataConvocacao: "08/07/2024", desistencia: false, documento: "" },
      { cargo: "Técnico de Enfermagem", nome: "Marcos Pereira", classificacao: "2º", dataConvocacao: "08/07/2024", desistencia: true, documento: "Termo_Desistencia_Marcos_Pereira.pdf" },
      { cargo: "Técnico de Enfermagem", nome: "Tiago Fernandes", classificacao: "3º", dataConvocacao: "10/07/2024", desistencia: false, documento: "" },
      { cargo: "Técnico de Enfermagem", nome: "Renata Lima", classificacao: "4º", dataConvocacao: "11/07/2024", desistencia: false, documento: "" }
    ]
  },
  {
    id: "PS-005-2024",
    nome: "PS 005/2024 - Psicólogo", dsei: "Maranhão", unidade: "Pólo Base Amarante",
    dataInicio: "15/05/2024", divulgacao: "15/07/2024", dataFim: "15/01/2025", status: "Encerrando em breve",
    vagas: [
      { cargo: "Psicólogo", quantidade: 2, localidade: "Pólo Base Amarante", reservaIndigena: "Maranhão", tipoVaga: "Ampla Concorrência", cadastroReserva: 7 }
    ],
    candidatos: [
      { cargo: "Psicólogo", nome: "Fernanda Dias", classificacao: "1º", dataConvocacao: "18/07/2024", desistencia: false, documento: "" },
      { cargo: "Psicólogo", nome: "Lucas Martins", classificacao: "2º", dataConvocacao: "19/07/2024", desistencia: false, documento: "" }
    ]
  },
  {
    id: "PS-006-2024",
    nome: "PS 006/2024 - Nutricionista", dsei: "Parintins", unidade: "Pólo Base Parintins",
    dataInicio: "20/05/2024", divulgacao: "20/07/2024", dataFim: "20/01/2025", status: "Encerrando em breve",
    vagas: [
      { cargo: "Nutricionista", quantidade: 1, localidade: "Pólo Base Parintins", reservaIndigena: "Parintins", tipoVaga: "Ampla Concorrência", cadastroReserva: 4 }
    ],
    candidatos: [
      { cargo: "Nutricionista", nome: "Camila Duarte", classificacao: "1º", dataConvocacao: "23/07/2024", desistencia: false, documento: "" }
    ]
  },
  {
    id: "PS-007-2024",
    nome: "PS 007/2024 - Fisioterapeuta", dsei: "Xingu", unidade: "Pólo Base Gaúcha do Norte",
    dataInicio: "10/03/2024", divulgacao: "10/05/2024", dataFim: "10/11/2024", status: "Encerrado",
    vagas: [
      { cargo: "Fisioterapeuta", quantidade: 2, localidade: "Pólo Base Gaúcha do Norte", reservaIndigena: "Xingu", tipoVaga: "Ampla Concorrência", cadastroReserva: 6 }
    ],
    candidatos: [
      { cargo: "Fisioterapeuta", nome: "Beatriz Rocha", classificacao: "1º", dataConvocacao: "12/05/2024", desistencia: false, documento: "" },
      { cargo: "Fisioterapeuta", nome: "Diego Nunes", classificacao: "2º", dataConvocacao: "12/05/2024", desistencia: false, documento: "" },
      { cargo: "Fisioterapeuta", nome: "Aline Barros", classificacao: "3º", dataConvocacao: "15/05/2024", desistencia: true, documento: "Termo_Desistencia_Aline_Barros.pdf" }
    ]
  },
  {
    id: "PS-008-2025",
    nome: "PS 008/2025 - Enfermagem (2ª Chamada)", dsei: "Yanomami", unidade: "Pólo Base Surucucu",
    dataInicio: "01/07/2025", divulgacao: "15/08/2025", dataFim: "15/01/2026", status: "Não iniciado",
    vagas: [
      { cargo: "Enfermeiro", quantidade: 3, localidade: "Pólo Base Surucucu", reservaIndigena: "Yanomami", tipoVaga: "Ampla Concorrência", cadastroReserva: 0 }
    ],
    candidatos: []
  },
  {
    id: "PS-009-2025",
    nome: "PS 009/2025 - Odontologia", dsei: "Alto Rio Negro", unidade: "Pólo Base Iauaretê",
    dataInicio: "10/07/2025", divulgacao: "20/08/2025", dataFim: "20/02/2026", status: "Não iniciado",
    vagas: [
      { cargo: "Cirurgião-Dentista", quantidade: 2, localidade: "Pólo Base Iauaretê", reservaIndigena: "Alto Rio Negro", tipoVaga: "Reserva Indígena", cadastroReserva: 0 }
    ],
    candidatos: []
  }
];

// ---------- Estado da aba ----------
let paginaAtual = 1;
let processoExpandido = null;       // id do processo com detalhamento aberto
let filtroCargoConvocados = null;   // cargo selecionado no acompanhamento (null = todos)
let seqNovo = 1;                    // contador para gerar ids de novos processos

const $ = id => document.getElementById(id);

// ---------- Toast simples (compartilha o estilo do gfToast) ----------
let toastTimer = null;
function psToast(mensagem, tipo) {
  let el = $("gfToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "gfToast";
    el.className = "gfToast";
    document.body.appendChild(el);
  }
  el.textContent = mensagem;
  el.classList.remove("is-erro", "is-ok");
  el.classList.add(tipo === "erro" ? "is-erro" : "is-ok", "show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

// ---------- Helpers ----------
function badgeStatus(status) {
  const cls = BADGE_STATUS[status] || "is-naoiniciado";
  return `<span class="psBadge ${cls}">${escapeHtml(status)}</span>`;
}

// "2024-04-10" (input date) -> "10/04/2024"
function isoParaBr(iso) {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// Resumo do cadastro reserva por cargo, derivado das vagas + candidatos.
// convocados = candidatos do cargo; desistências = candidatos que desistiram;
// em fila = quantidade do cadastro - convocados - desistências (>= 0).
function resumoCadastro(proc) {
  return (proc.vagas || []).map(v => {
    const candCargo = (proc.candidatos || []).filter(c => c.cargo === v.cargo);
    const convocados = candCargo.length;
    const desistencias = candCargo.filter(c => c.desistencia).length;
    const quantidade = Math.max(Number(v.cadastroReserva || 0), convocados + desistencias);
    const emFila = Math.max(0, quantidade - convocados - desistencias);
    return { cargo: v.cargo, quantidade, convocados, desistencias, emFila };
  });
}

function totaisProcesso(proc) {
  const vagas = (proc.vagas || []).reduce((s, v) => s + Number(v.quantidade || 0), 0);
  const resumo = resumoCadastro(proc);
  return {
    vagas,
    reserva: resumo.reduce((s, r) => s + r.quantidade, 0),
    convocados: resumo.reduce((s, r) => s + r.convocados, 0),
    desistentes: resumo.reduce((s, r) => s + r.desistencias, 0),
    emFila: resumo.reduce((s, r) => s + r.emFila, 0),
    resumo
  };
}

// ---------- Filtro + busca ----------
function processosFiltrados() {
  const dsei = $("psFiltroDsei")?.value || "";
  const termo = ($("psBusca")?.value || "").trim().toLowerCase();
  return processos.filter(p => {
    if (dsei && p.dsei !== dsei) return false;
    if (termo) {
      const alvo = `${p.nome} ${p.dsei} ${p.unidade} ${p.status}`.toLowerCase();
      if (!alvo.includes(termo)) return false;
    }
    return true;
  });
}

// ---------- KPIs ----------
function renderKpis() {
  const conta = status => processos.filter(p => p.status === status).length;
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set("psKpiTotal", processos.length);
  set("psKpiNaoIniciado", conta("Não iniciado"));
  set("psKpiAndamento", conta("Em andamento"));
  set("psKpiBreve", conta("Encerrando em breve"));
  set("psKpiEncerrado", conta("Encerrado"));
}

// ---------- Filtro de DSEI ----------
function preencherFiltroDsei() {
  const sel = $("psFiltroDsei");
  if (!sel) return;
  const atual = sel.value;
  const dseis = [...new Set(processos.map(p => p.dsei).filter(Boolean))].sort();
  sel.innerHTML = `<option value="">Todos os DSEIs</option>` +
    dseis.map(d => `<option value="${escapeAttr(d)}">${escapeHtml(d)}</option>`).join("");
  if (dseis.includes(atual)) sel.value = atual;
}

// ---------- Tabela ----------
function renderTabela() {
  const body = $("psTabelaBody");
  if (!body) return;

  const lista = processosFiltrados();
  const totalPaginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  if (paginaAtual > totalPaginas) paginaAtual = totalPaginas;
  const inicio = (paginaAtual - 1) * POR_PAGINA;
  const pagina = lista.slice(inicio, inicio + POR_PAGINA);

  if (!pagina.length) {
    body.innerHTML = `<tr><td colspan="8" class="psEmpty">Nenhum processo seletivo encontrado para os filtros selecionados.</td></tr>`;
  } else {
    body.innerHTML = pagina.map(p => {
      const aberto = processoExpandido === p.id;
      return `
        <tr class="${aberto ? "is-expandido" : ""}">
          <td class="psCelNome">${escapeHtml(p.nome)}</td>
          <td>${escapeHtml(p.dsei)}</td>
          <td>${escapeHtml(p.unidade)}</td>
          <td>${escapeHtml(p.dataInicio)}</td>
          <td>${escapeHtml(p.divulgacao)}</td>
          <td>${escapeHtml(p.dataFim)}</td>
          <td>${badgeStatus(p.status)}</td>
          <td class="psTd-center">
            <button type="button" class="psAcaoBtn ${aberto ? "is-aberto" : ""}" data-ps-detalhe="${escapeAttr(p.id)}"
              title="Ver detalhes do processo">
              <span>Detalhes</span>
              <i class="fa-solid fa-chevron-down"></i>
            </button>
          </td>
        </tr>`;
    }).join("");
  }

  // Rodapé / contador.
  const contador = $("psContador");
  if (contador) {
    if (!lista.length) {
      contador.textContent = "Nenhum processo cadastrado.";
    } else {
      const fim = Math.min(inicio + POR_PAGINA, lista.length);
      contador.textContent = `Mostrando ${inicio + 1} a ${fim} de ${lista.length} processo(s)`;
    }
  }

  renderPaginacao(totalPaginas);
}

function renderPaginacao(totalPaginas) {
  const wrap = $("psPaginacao");
  if (!wrap) return;
  if (totalPaginas <= 1) { wrap.innerHTML = ""; return; }

  let botoes = "";
  for (let i = 1; i <= totalPaginas; i += 1) {
    botoes += `<button type="button" class="psPagBtn ${i === paginaAtual ? "is-ativo" : ""}" data-ps-pagina="${i}">${i}</button>`;
  }
  wrap.innerHTML = `
    <button type="button" class="psPagBtn" data-ps-pagina="${Math.max(1, paginaAtual - 1)}" ${paginaAtual === 1 ? "disabled" : ""}>
      <i class="fa-solid fa-chevron-left"></i>
    </button>
    ${botoes}
    <button type="button" class="psPagBtn" data-ps-pagina="${Math.min(totalPaginas, paginaAtual + 1)}" ${paginaAtual === totalPaginas ? "disabled" : ""}>
      <i class="fa-solid fa-chevron-right"></i>
    </button>`;
}

// ---------- Detalhamento do processo ----------
function renderDetalhe() {
  const painel = $("psDetalhe");
  if (!painel) return;

  const proc = processos.find(p => p.id === processoExpandido);
  if (!proc) {
    painel.hidden = true;
    painel.innerHTML = "";
    return;
  }

  const t = totaisProcesso(proc);

  const linhasVagas = (proc.vagas || []).map((v, i) => {
    const candCargo = (proc.candidatos || []).filter(c => c.cargo === v.cargo);
    return `
    <tr>
      <td>${escapeHtml(v.cargo)}</td>
      <td class="psTd-center">${Number(v.quantidade || 0)}</td>
      <td>${escapeHtml(v.localidade || "—")}</td>
      <td>${escapeHtml(v.reservaIndigena || "—")}</td>
      <td>${escapeHtml(v.tipoVaga || "—")}</td>
      <td class="psTd-center">
        <button type="button" class="psBtn psBtnGhost psBtnSm ${filtroCargoConvocados === v.cargo ? "is-ativo" : ""}"
          data-ps-convocados="${escapeAttr(proc.id)}::${i}" title="Ver os convocados deste cargo no acompanhamento abaixo">
          <i class="fa-solid fa-users"></i> Convocados (${candCargo.length})
        </button>
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" class="psTd-center">Nenhuma vaga prevista cadastrada.</td></tr>`;

  const linhasReserva = t.resumo.map(r => `
    <tr>
      <td>${escapeHtml(r.cargo)}</td>
      <td class="psTd-center">${r.quantidade}</td>
      <td class="psTd-center">${r.convocados}</td>
      <td class="psTd-center">${r.desistencias}</td>
      <td class="psTd-center">${r.emFila}</td>
    </tr>`).join("") || `<tr><td colspan="5" class="psTd-center">Sem cadastro reserva vigente.</td></tr>`;

  // Se o cargo selecionado deixou de existir (ex.: troca de processo), volta para "todos".
  const cargosProcesso = [...new Set((proc.vagas || []).map(v => v.cargo))];
  if (filtroCargoConvocados && !cargosProcesso.includes(filtroCargoConvocados)) {
    filtroCargoConvocados = null;
  }

  // Mantém o índice original (para o botão de anexo) antes de filtrar por cargo.
  const candidatosFiltrados = (proc.candidatos || [])
    .map((c, i) => ({ ...c, _idx: i }))
    .filter(c => !filtroCargoConvocados || c.cargo === filtroCargoConvocados);

  const linhasCand = candidatosFiltrados.map(c => {
    const situacao = c.desistencia
      ? `<span class="psBadge is-encerrado">Desistência</span>`
      : `<span class="psBadge is-andamento">Convocado</span>`;
    const doc = c.documento
      ? `<a class="psDocLink" href="#" data-ps-doc="${escapeAttr(c.documento)}"><i class="fa-solid fa-paperclip"></i> ${escapeHtml(c.documento)}</a>`
      : "—";
    return `
      <tr>
        <td>${escapeHtml(c.cargo)}</td>
        <td>${escapeHtml(c.nome)}</td>
        <td class="psTd-center">${escapeHtml(c.classificacao || "—")}</td>
        <td class="psTd-center">${escapeHtml(c.dataConvocacao || "—")}</td>
        <td>${situacao}</td>
        <td class="psTd-center">${c.desistencia ? "Sim" : "Não"}</td>
        <td>${doc}</td>
        <td class="psTd-center">
          ${c.desistencia && !c.documento
            ? `<button type="button" class="psIconBtn" data-ps-anexar="${escapeAttr(proc.id)}::${c._idx}" title="Anexar termo de desistência"><i class="fa-solid fa-paperclip"></i></button>`
            : ""}
        </td>
      </tr>`;
  }).join("") || `<tr><td colspan="8" class="psTd-center">${filtroCargoConvocados ? "Nenhum candidato convocado para este cargo." : "Nenhum candidato convocado até o momento."}</td></tr>`;

  // Chips para alternar a lista de convocados por cargo (cada cargo tem a sua).
  const chipsConvocados = `
    <button type="button" class="psChip ${!filtroCargoConvocados ? "is-ativo" : ""}" data-ps-filtro-cargo="__TODOS__">
      Todos (${(proc.candidatos || []).length})
    </button>
    ${cargosProcesso.map(cg => {
      const qtd = (proc.candidatos || []).filter(c => c.cargo === cg).length;
      return `<button type="button" class="psChip ${filtroCargoConvocados === cg ? "is-ativo" : ""}" data-ps-filtro-cargo="${escapeAttr(cg)}">${escapeHtml(cg)} (${qtd})</button>`;
    }).join("")}`;

  const opcoesStatus = STATUS.map(s =>
    `<option value="${escapeAttr(s)}"${s === proc.status ? " selected" : ""}>${escapeHtml(s)}</option>`).join("");

  painel.innerHTML = `
    <div class="psDetalheTopo">
      <div class="psDetalheTitulo">
        <h3>${escapeHtml(proc.nome)} ${badgeStatus(proc.status)}</h3>
        <p>Período: ${escapeHtml(proc.dataInicio)} a ${escapeHtml(proc.dataFim)} &nbsp;·&nbsp;
          Divulgação do Resultado Final: ${escapeHtml(proc.divulgacao)}</p>
      </div>
      <div class="psDetalheAcoes">
        <label class="psStatusInline">
          <span>Status</span>
          <select class="psSelect" data-ps-status="${escapeAttr(proc.id)}">${opcoesStatus}</select>
        </label>
        <button type="button" class="psBtn psBtnGhost" data-ps-excluir="${escapeAttr(proc.id)}">
          <i class="fa-solid fa-trash"></i> Excluir
        </button>
        <button type="button" class="psBtn psBtnGhost" data-ps-detalhe="${escapeAttr(proc.id)}">
          Recolher detalhes <i class="fa-solid fa-chevron-up"></i>
        </button>
      </div>
    </div>

    <div class="psResumoTiles">
      <div class="psTile"><div class="psTileValue">${t.vagas}</div><div class="psTileLabel">Total de Vagas</div></div>
      <div class="psTile"><div class="psTileValue">${t.reserva}</div><div class="psTileLabel">Cadastro Reserva</div></div>
      <div class="psTile"><div class="psTileValue is-green">${t.convocados}</div><div class="psTileLabel">Convocados</div></div>
      <div class="psTile"><div class="psTileValue is-red">${t.desistentes}</div><div class="psTileLabel">Desistentes</div></div>
      <div class="psTile"><div class="psTileValue is-blue">${t.emFila}</div><div class="psTileLabel">Em Fila</div></div>
    </div>

    <div class="psDetalheGrid">
      <div class="psBloco">
        <h4 class="psBlocoTitulo">Vagas Previstas</h4>
        <div class="psTableWrap">
          <table class="psTable psTableSub">
            <thead><tr>
              <th>Cargo</th><th class="psTd-center">Quantidade</th><th>Localidade</th>
              <th>Reserva Indígena</th><th>Tipo de Vaga</th><th class="psTd-center">Ação</th>
            </tr></thead>
            <tbody>${linhasVagas}
              <tr class="psTotalRow"><td>Total</td><td class="psTd-center">${t.vagas}</td><td colspan="4"></td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="psBloco">
        <h4 class="psBlocoTitulo">Cadastro Reserva Vigente</h4>
        <div class="psTableWrap">
          <table class="psTable psTableSub">
            <thead><tr>
              <th>Cargo</th><th class="psTd-center">Quantidade</th><th class="psTd-center">Convocados</th>
              <th class="psTd-center">Desistências</th><th class="psTd-center">Em Fila</th>
            </tr></thead>
            <tbody>${linhasReserva}
              <tr class="psTotalRow"><td>Total</td><td class="psTd-center">${t.reserva}</td>
                <td class="psTd-center">${t.convocados}</td><td class="psTd-center">${t.desistentes}</td>
                <td class="psTd-center">${t.emFila}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="psBloco" id="psAcompanhamento">
      <div class="psBlocoHead">
        <h4 class="psBlocoTitulo">Acompanhamento de Candidatos Convocados${filtroCargoConvocados ? ` — ${escapeHtml(filtroCargoConvocados)}` : ""}</h4>
        <div class="psChips">${chipsConvocados}</div>
      </div>
      <div class="psTableWrap">
        <table class="psTable psTableSub">
          <thead><tr>
            <th>Cargo</th><th>Nome do Candidato</th><th class="psTd-center">Classificação</th>
            <th class="psTd-center">Data da Convocação</th><th>Situação</th>
            <th class="psTd-center">Desistência</th><th>Documento</th><th class="psTd-center">Ações</th>
          </tr></thead>
          <tbody>${linhasCand}</tbody>
        </table>
      </div>
      <div class="psLegenda">
        <span><span class="psDot is-green"></span> Convocado: candidato aceitou a vaga.</span>
        <span><span class="psDot is-red"></span> Desistência: candidato desistiu da vaga.</span>
      </div>
    </div>`;

  painel.hidden = false;
}

// ---------- Render geral ----------
function renderTudo() {
  renderKpis();
  preencherFiltroDsei();
  renderTabela();
  renderDetalhe();
}

// ---------- Ações ----------
function alternarDetalhe(id) {
  processoExpandido = processoExpandido === id ? null : id;
  filtroCargoConvocados = null; // ao trocar de processo, volta a lista para "todos".
  renderTabela();
  renderDetalhe();
  if (processoExpandido) {
    // Garante que o painel apareça em tela.
    setTimeout(() => $("psDetalhe")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 60);
  }
}

function alterarStatus(id, novoStatus) {
  const proc = processos.find(p => p.id === id);
  if (!proc || !STATUS.includes(novoStatus)) return;
  proc.status = novoStatus;
  renderKpis();
  renderTabela();
  renderDetalhe();
  psToast(`Status de "${proc.nome}" atualizado para "${novoStatus}".`);
}

async function excluirProcesso(id) {
  const proc = processos.find(p => p.id === id);
  if (!proc) return;
  const r = await abrirModal({
    titulo: "Excluir processo seletivo",
    msg: `Tem certeza que deseja excluir "${proc.nome}"? Esta ação não pode ser desfeita.`,
    confirmarTexto: "Excluir",
    perigo: true
  });
  if (!r || !r.ok) return;
  processos = processos.filter(p => p.id !== id);
  if (processoExpandido === id) processoExpandido = null;
  renderTudo();
  psToast(`Processo "${proc.nome}" excluído.`);
}

function anexarDocumento(chave) {
  // chave = "<idProcesso>::<indiceCandidato>"
  const [id, idxStr] = String(chave).split("::");
  const proc = processos.find(p => p.id === id);
  const idx = Number(idxStr);
  if (!proc || !proc.candidatos[idx]) return;
  const cand = proc.candidatos[idx];
  cand.documento = `Termo_Desistencia_${cand.nome.replace(/\s+/g, "_")}.pdf`;
  renderDetalhe();
  psToast(`Documento anexado para ${cand.nome}.`);
}

// Seleciona (ou limpa) o cargo cuja lista de convocados aparece no
// "Acompanhamento de Candidatos Convocados". cargo === null mostra todos.
function selecionarCargoConvocados(cargo, rolar) {
  filtroCargoConvocados = cargo;
  renderDetalhe();
  if (rolar) {
    setTimeout(() => $("psAcompanhamento")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }
}

// Recebe a chave do botão de Vagas Previstas ("<idProcesso>::<indiceVaga>")
// e abre a lista daquele cargo no acompanhamento abaixo.
function verConvocadosDoCargo(chave) {
  const [id, idxStr] = String(chave).split("::");
  const proc = processos.find(p => p.id === id);
  if (!proc) return;
  const vaga = proc.vagas[Number(idxStr)];
  if (!vaga) return;
  selecionarCargoConvocados(vaga.cargo, true);
}

// ============================================================
//  Modal de cadastro de novo processo seletivo
// ============================================================
let modalNovoCriado = false;
let seqVagaRow = 0;
let seqCandRow = 0;

function templateVagaRow() {
  const i = seqVagaRow++;
  const tipos = TIPOS_VAGA.map(t => `<option value="${escapeAttr(t)}">${escapeHtml(t)}</option>`).join("");
  return `
    <div class="psFormRow" data-vaga-row="${i}">
      <input class="psInput" data-campo="cargo" placeholder="Cargo">
      <input class="psInput" data-campo="quantidade" type="number" min="0" placeholder="Vagas">
      <input class="psInput" data-campo="cadastroReserva" type="number" min="0" placeholder="Cad. reserva">
      <input class="psInput" data-campo="localidade" placeholder="Localidade">
      <input class="psInput" data-campo="reservaIndigena" placeholder="Reserva indígena">
      <select class="psSelect" data-campo="tipoVaga">${tipos}</select>
      <button type="button" class="psIconBtn" data-remove-vaga="${i}" title="Remover vaga"><i class="fa-solid fa-trash"></i></button>
    </div>`;
}

function templateCandRow() {
  const i = seqCandRow++;
  return `
    <div class="psFormRow psFormRowCand" data-cand-row="${i}">
      <input class="psInput" data-campo="cargo" placeholder="Cargo">
      <input class="psInput" data-campo="nome" placeholder="Nome do candidato">
      <input class="psInput" data-campo="classificacao" placeholder="Class. (ex: 1)">
      <input class="psInput" data-campo="dataConvocacao" type="date">
      <label class="psCheck"><input type="checkbox" data-campo="desistencia"> Desistiu</label>
      <button type="button" class="psIconBtn" data-remove-cand="${i}" title="Remover candidato"><i class="fa-solid fa-trash"></i></button>
    </div>`;
}

function garantirModalNovo() {
  if (modalNovoCriado) return;
  const overlay = document.createElement("div");
  overlay.id = "psModalNovo";
  overlay.className = "psModalOverlay";
  overlay.hidden = true;
  const opcoesStatus = STATUS.map(s => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join("");
  overlay.innerHTML = `
    <div class="psModalCard" role="dialog" aria-modal="true" aria-labelledby="psModalTitulo">
      <div class="psModalHead">
        <h3 id="psModalTitulo"><i class="fa-solid fa-clipboard-list"></i> Novo Processo Seletivo</h3>
        <button type="button" class="psModalClose" data-ps-modal-fechar title="Fechar"><i class="fa-solid fa-xmark"></i></button>
      </div>

      <div class="psModalBody">
        <div class="psFormGrid">
          <label class="psField psField2">
            <span>Processo Seletivo <i class="psReq">*</i></span>
            <input class="psInput" id="psFNome" placeholder="Ex: PS 010/2025 - Enfermagem">
          </label>
          <label class="psField">
            <span>DSEI <i class="psReq">*</i></span>
            <input class="psInput" id="psFDsei" placeholder="Ex: Yanomami">
          </label>
          <label class="psField">
            <span>Unidade</span>
            <input class="psInput" id="psFUnidade" placeholder="Ex: Pólo Base Auaris">
          </label>
          <label class="psField">
            <span>Data Início</span>
            <input class="psInput" id="psFInicio" type="date">
          </label>
          <label class="psField">
            <span>Divulgação Resultado Final</span>
            <input class="psInput" id="psFDivulgacao" type="date">
          </label>
          <label class="psField">
            <span>Data Fim (Vigência)</span>
            <input class="psInput" id="psFFim" type="date">
          </label>
          <label class="psField">
            <span>Status</span>
            <select class="psSelect" id="psFStatus">${opcoesStatus}</select>
          </label>
        </div>

        <div class="psFormSecao">
          <div class="psFormSecaoHead">
            <h4>Vagas Previstas / Cadastro Reserva</h4>
            <button type="button" class="psBtn psBtnSm" data-ps-add-vaga><i class="fa-solid fa-plus"></i> Adicionar vaga</button>
          </div>
          <div class="psFormRow psFormRowHead">
            <span>Cargo</span><span>Vagas</span><span>Cad. reserva</span><span>Localidade</span>
            <span>Reserva indígena</span><span>Tipo de vaga</span><span></span>
          </div>
          <div id="psVagasRows"></div>
        </div>

        <div class="psFormSecao">
          <div class="psFormSecaoHead">
            <h4>Candidatos Convocados <small>(opcional)</small></h4>
            <button type="button" class="psBtn psBtnSm" data-ps-add-cand><i class="fa-solid fa-plus"></i> Adicionar candidato</button>
          </div>
          <div class="psFormRow psFormRowCand psFormRowHead">
            <span>Cargo</span><span>Nome</span><span>Classificação</span><span>Data convocação</span>
            <span>Desistência</span><span></span>
          </div>
          <div id="psCandRows"></div>
        </div>

        <div class="psModalErro" id="psModalErro"></div>
      </div>

      <div class="psModalFoot">
        <button type="button" class="psBtn psBtnGhost" data-ps-modal-fechar>Cancelar</button>
        <button type="button" class="psBtn" id="psBtnSalvarProcesso"><i class="fa-solid fa-check"></i> Salvar Processo</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  modalNovoCriado = true;

  // Fechar ao clicar fora do card ou nos botões de fechar.
  overlay.addEventListener("click", event => {
    if (event.target === overlay || event.target.closest("[data-ps-modal-fechar]")) {
      fecharModalNovo();
    }
  });

  // Delegação interna do modal: adicionar/remover linhas.
  overlay.addEventListener("click", event => {
    if (event.target.closest("[data-ps-add-vaga]")) {
      $("psVagasRows").insertAdjacentHTML("beforeend", templateVagaRow());
      return;
    }
    if (event.target.closest("[data-ps-add-cand]")) {
      $("psCandRows").insertAdjacentHTML("beforeend", templateCandRow());
      return;
    }
    const rv = event.target.closest("[data-remove-vaga]");
    if (rv) { rv.closest("[data-vaga-row]")?.remove(); return; }
    const rc = event.target.closest("[data-remove-cand]");
    if (rc) { rc.closest("[data-cand-row]")?.remove(); return; }
  });

  $("psBtnSalvarProcesso")?.addEventListener("click", salvarNovoProcesso);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !overlay.hidden) fecharModalNovo();
  });
}

function abrirModalNovo() {
  garantirModalNovo();
  // Limpa o formulário.
  ["psFNome", "psFDsei", "psFUnidade", "psFInicio", "psFDivulgacao", "psFFim"].forEach(id => {
    const el = $(id); if (el) el.value = "";
  });
  if ($("psFStatus")) $("psFStatus").value = "Não iniciado";
  if ($("psModalErro")) $("psModalErro").textContent = "";
  // Começa com uma linha de vaga e nenhuma de candidato.
  $("psVagasRows").innerHTML = templateVagaRow();
  $("psCandRows").innerHTML = "";
  $("psModalNovo").hidden = false;
  setTimeout(() => $("psFNome")?.focus(), 60);
}

function fecharModalNovo() {
  const ov = $("psModalNovo");
  if (ov) ov.hidden = true;
}

// Lê as linhas dinâmicas (vagas/candidatos) do modal.
function lerLinhas(containerId, seletor) {
  const container = $(containerId);
  if (!container) return [];
  return Array.from(container.querySelectorAll(seletor)).map(row => {
    const obj = {};
    row.querySelectorAll("[data-campo]").forEach(inp => {
      if (inp.type === "checkbox") obj[inp.dataset.campo] = inp.checked;
      else obj[inp.dataset.campo] = inp.value.trim();
    });
    return obj;
  });
}

function normalizarClassificacao(valor) {
  if (!valor) return "—";
  return /^\d+$/.test(valor) ? `${valor}º` : valor;
}

function salvarNovoProcesso() {
  const erro = msg => { const el = $("psModalErro"); if (el) el.textContent = msg; };

  const nome = $("psFNome").value.trim();
  const dsei = $("psFDsei").value.trim();
  if (!nome) { erro("Informe o nome do processo seletivo."); $("psFNome").focus(); return; }
  if (!dsei) { erro("Informe o DSEI."); $("psFDsei").focus(); return; }

  const vagas = lerLinhas("psVagasRows", "[data-vaga-row]")
    .filter(v => v.cargo)
    .map(v => ({
      cargo: v.cargo,
      quantidade: Number(v.quantidade || 0),
      cadastroReserva: Number(v.cadastroReserva || 0),
      localidade: v.localidade || "",
      reservaIndigena: v.reservaIndigena || "",
      tipoVaga: v.tipoVaga || "Ampla Concorrência"
    }));

  if (!vagas.length) { erro("Cadastre ao menos uma vaga (com o cargo preenchido)."); return; }

  const candidatos = lerLinhas("psCandRows", "[data-cand-row]")
    .filter(c => c.nome && c.cargo)
    .map(c => ({
      cargo: c.cargo,
      nome: c.nome,
      classificacao: normalizarClassificacao(c.classificacao),
      dataConvocacao: isoParaBr(c.dataConvocacao),
      desistencia: !!c.desistencia,
      documento: c.desistencia ? `Termo_Desistencia_${c.nome.replace(/\s+/g, "_")}.pdf` : ""
    }));

  const novo = {
    id: `PS-NOVO-${seqNovo++}`,
    nome,
    dsei,
    unidade: $("psFUnidade").value.trim() || "—",
    dataInicio: isoParaBr($("psFInicio").value) || "—",
    divulgacao: isoParaBr($("psFDivulgacao").value) || "—",
    dataFim: isoParaBr($("psFFim").value) || "—",
    status: STATUS.includes($("psFStatus").value) ? $("psFStatus").value : "Não iniciado",
    vagas,
    candidatos
  };

  processos.unshift(novo);
  paginaAtual = 1;
  processoExpandido = novo.id; // já abre o detalhamento do recém-criado.
  fecharModalNovo();
  renderTudo();
  setTimeout(() => $("psDetalhe")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 80);
  psToast(`Processo "${nome}" cadastrado com sucesso.`);
}

// ---------- Inicialização ----------
let processosConfigurado = false;

export function configurarProcessosSeletivos() {
  if (processosConfigurado) return;
  const raiz = $("view-processosSeletivos");
  if (!raiz) return;
  processosConfigurado = true;

  renderTudo();

  // Filtros e busca reagem na hora.
  $("psFiltroDsei")?.addEventListener("change", () => { paginaAtual = 1; renderTabela(); });
  $("psBusca")?.addEventListener("input", () => { paginaAtual = 1; renderTabela(); });
  $("psBtnNovo")?.addEventListener("click", abrirModalNovo);

  // Delegação para os elementos gerados dinamicamente (tabela + detalhe).
  raiz.addEventListener("click", event => {
    const det = event.target.closest("[data-ps-detalhe]");
    if (det) { alternarDetalhe(det.dataset.psDetalhe); return; }

    const pag = event.target.closest("[data-ps-pagina]");
    if (pag) { paginaAtual = Number(pag.dataset.psPagina) || 1; renderTabela(); return; }

    const excluir = event.target.closest("[data-ps-excluir]");
    if (excluir) { excluirProcesso(excluir.dataset.psExcluir); return; }

    const anexar = event.target.closest("[data-ps-anexar]");
    if (anexar) { anexarDocumento(anexar.dataset.psAnexar); return; }

    const conv = event.target.closest("[data-ps-convocados]");
    if (conv) { verConvocadosDoCargo(conv.dataset.psConvocados); return; }

    const chip = event.target.closest("[data-ps-filtro-cargo]");
    if (chip) {
      const cargo = chip.dataset.psFiltroCargo;
      selecionarCargoConvocados(cargo === "__TODOS__" ? null : cargo, false);
      return;
    }

    const doc = event.target.closest("[data-ps-doc]");
    if (doc) {
      event.preventDefault();
      psToast(`Visualização do documento "${doc.dataset.psDoc}" disponível na versão integrada.`);
    }
  });

  raiz.addEventListener("change", event => {
    const st = event.target.closest("[data-ps-status]");
    if (st) alterarStatus(st.dataset.psStatus, st.value);
  });
}
