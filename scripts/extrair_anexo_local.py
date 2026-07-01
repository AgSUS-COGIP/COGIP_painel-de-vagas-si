# -*- coding: utf-8 -*-
"""
Extracao LOCAL do anexo de um edital (sem acessar o site da AgSUS).

Recebe os bytes de um PDF pela entrada padrao (stdin) e devolve, em JSON na
saida padrao, o quadro de vagas e o cronograma do edital.

Este script e autossuficiente: as rotinas de extracao de PDF abaixo
(extract_quadro / extract_cronograma e helpers) sao as mesmas que eram usadas
pelo extrair_vagas.py, apenas sem toda a parte de localizar/baixar o anexo no
site -- aqui o arquivo e fornecido direto pelo usuario. Unica dependencia
externa: pdfplumber.

Uso (chamado pelo servidor):
    python extrair_anexo_local.py  < arquivo.pdf
"""
import io
import re
import sys
import json
import unicodedata

import pdfplumber


# ----------------------------------------------------------------------------
# Helpers de texto
# ----------------------------------------------------------------------------
def strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def norm(s):
    """minusculo, sem acento, so alfanumerico com espacos simples."""
    s = strip_accents(str(s)).lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def clean_cell(v):
    if v is None:
        return ""
    return re.sub(r"\s+", " ", str(v)).strip()


# ----------------------------------------------------------------------------
# Extracao do quadro de vagas dos PDFs
# ----------------------------------------------------------------------------
VAGA_HDR = ("vaga", "vagas", "cargo", "cargos", "funcao")
SKIP_CARGO = {"", "vaga", "vagas", "cargo", "cargos", "total", "total de vagas",
              "funcao", "lotacao"}

COLMAP = [
    ("ampla", "Ampla_Concorrencia"),
    ("ppiq", "PPIQ"),
    ("deficiencia", "PcD"),
    ("pcd", "PcD"),
    ("preto", "Pretos_Pardos"),
    ("pardo", "Pretos_Pardos"),
    ("indigena", "Indigenas"),
    ("quilombola", "Quilombolas"),
    ("total", "Total"),
    ("lota", "Lotacao"),
]


def map_header(col):
    c = norm(col)
    for key, dest in COLMAP:
        if key in c:
            return dest
    return None


def extract_bordered(pdf):
    """Procura tabelas com header de quadro de vagas. Retorna (rows, pagina)."""
    out_rows = []
    src_page = None
    for i, pg in enumerate(pdf.pages):
        for t in pg.extract_tables():
            if not t or not t[0]:
                continue
            hdr = [clean_cell(c) for c in t[0]]
            hnorm = norm(" ".join(hdr))
            if "ampla" not in hnorm:
                continue
            if not any(k in hnorm for k in VAGA_HDR):
                continue
            # coluna do cargo = primeira cujo header bate em vaga/cargo, senao col 0
            cargo_idx = 0
            for ci, c in enumerate(hdr):
                if any(k in norm(c) for k in VAGA_HDR):
                    cargo_idx = ci
                    break
            # mapeia colunas de valor
            colnames = {}
            for ci, c in enumerate(hdr):
                if ci == cargo_idx:
                    continue
                d = map_header(c)
                colnames[ci] = d if d else ("Outros:" + clean_cell(c))
            for row in t[1:]:
                if not row or cargo_idx >= len(row):
                    continue
                cargo = clean_cell(row[cargo_idx])
                if norm(cargo) in SKIP_CARGO or not re.search(r"[a-zA-ZÀ-ÿ]", cargo):
                    continue
                rec = {"Cargo": cargo}
                outros = []
                for ci, val in enumerate(row):
                    if ci == cargo_idx or ci not in colnames:
                        continue
                    v = clean_cell(val)
                    name = colnames[ci]
                    if name.startswith("Outros:"):
                        if v:
                            outros.append(name[7:] + "=" + v)
                    else:
                        rec[name] = v
                if outros:
                    rec["Outros"] = "; ".join(outros)
                out_rows.append(rec)
            if out_rows and src_page is None:
                src_page = i + 1
        if out_rows:
            break
    return out_rows, src_page


LINE_PAIR_RE = re.compile(r"([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ().,/ºª°\- ]*?)\s+(\d{1,3}|CR)\b")
BORDERLESS_JUNK = ("cargos de ensino", "quadro de vagas", "anexo", "cr cadastro",
                   "total de vagas", "cargos", "pagina", "assinado eletronicamente",
                   "documento foi", "documento pode", "autenticidade", "verificador",
                   "codigo", "conferido", "https", "www", "sei agsus", "nº sei",
                   "referencia", "processo n")


def extract_borderless(pdf):
    """1o ciclo: 'Quadro de Vagas e Cargos' sem bordas, formato 'Cargo <n/CR>'."""
    out_rows = []
    src_page = None
    for i, pg in enumerate(pdf.pages):
        tx = pg.extract_text() or ""
        if "quadro de vagas" not in norm(tx):
            continue
        src_page = i + 1
        for line in tx.split("\n"):
            ln = clean_cell(line)
            nl = norm(ln)
            if not ln or any(j in nl for j in BORDERLESS_JUNK):
                # ainda assim pode haver pares uteis na linha; mas pulamos cabecalhos
                if nl.startswith("total de vagas"):
                    continue
            for m in LINE_PAIR_RE.finditer(ln):
                cargo = clean_cell(m.group(1))
                val = m.group(2)
                ncargo = norm(cargo)
                # remove prefixos de cabecalho colados
                if not ncargo or len(ncargo) < 3:
                    continue
                if any(j in ncargo for j in BORDERLESS_JUNK):
                    # tenta limpar o comeco (ex.: 'CARGOS Pará Analista ...')
                    continue
                if ncargo in SKIP_CARGO:
                    continue
                out_rows.append({"Cargo": cargo, "Vagas": val})
        if out_rows:
            break
    return out_rows, src_page


def extract_quadro(pdf_bytes):
    """Retorna (rows, pagina, formato) ou ([], None, '')."""
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            rows, pg = extract_bordered(pdf)
            if rows:
                return rows, pg, "bordered"
            rows, pg = extract_borderless(pdf)
            if rows:
                return rows, pg, "borderless"
    except Exception as e:  # noqa
        return [], None, "erro:" + str(e)[:60]
    return [], None, ""


# ----------------------------------------------------------------------------
# Extracao do cronograma (Atividades x Datas provaveis)
# ----------------------------------------------------------------------------
CRONO_ATIV = ("atividade", "evento", "etapa", "fase", "descricao")
CRONO_DATA = ("data", "periodo", "prazo")
# linhas/cabecalhos que nao sao atividade
CRONO_SKIP = {"atividade", "atividades", "evento", "eventos", "etapa", "etapas",
              "fase", "fases", "descricao", "cronograma"}


def extract_cronograma(pdf_bytes):
    """Extrai o cronograma do PDF de anexos.

    Procura uma tabela cujo cabecalho tenha uma coluna de 'Atividades' e outra
    de 'Datas provaveis' (ou variantes). Como a quantidade de etapas varia por
    DSEI/edital, retorna todas as linhas encontradas.

    Retorna (rows, pagina), rows = [{"Ordem": n, "Atividade": .., "Data": ..}].
    """
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for i, pg in enumerate(pdf.pages):
                for t in pg.extract_tables():
                    if not t or not t[0]:
                        continue
                    hdr = [norm(clean_cell(c)) for c in t[0]]
                    ativ_idx = data_idx = None
                    for ci, c in enumerate(hdr):
                        if ativ_idx is None and any(k in c for k in CRONO_ATIV):
                            ativ_idx = ci
                        if data_idx is None and any(k in c for k in CRONO_DATA):
                            data_idx = ci
                    if ativ_idx is None or data_idx is None or ativ_idx == data_idx:
                        continue
                    rows = []
                    for row in t[1:]:
                        if not row or max(ativ_idx, data_idx) >= len(row):
                            continue
                        ativ = clean_cell(row[ativ_idx])
                        data = clean_cell(row[data_idx])
                        if not ativ or not re.search(r"[a-zA-ZÀ-ÿ]", ativ):
                            continue
                        if norm(ativ) in CRONO_SKIP:
                            continue
                        rows.append({"Ordem": len(rows) + 1,
                                     "Atividade": ativ, "Data": data})
                    if rows:
                        return rows, i + 1
    except Exception:
        return [], None
    return [], None


# ----------------------------------------------------------------------------
# Saida no formato do front
# ----------------------------------------------------------------------------
# Nomes do extrator (Python) -> campos usados pelo front (processos-seletivos.js).
KEYMAP = {
    "Cargo": "cargo",
    "Vagas": "vagas",
    "Ampla_Concorrencia": "ampla",
    "PcD": "pcd",
    "Pretos_Pardos": "pretosPardos",
    "Indigenas": "indigenas",
    "Quilombolas": "quilombolas",
    "PPIQ": "ppiq",
    "Total": "total",
    "Lotacao": "lotacao",
}


def mapear_cargo(rec):
    """Converte um registro do extrator para o formato esperado pelo front."""
    out = {}
    for chave, valor in rec.items():
        destino = KEYMAP.get(chave)
        if destino:
            out[destino] = valor
    return out


def emitir(obj):
    """Escreve o JSON como bytes UTF-8 no stdout.

    Evita que a code page do console (cp1252 no Windows) corrompa os acentos:
    o Node lê o stdout como UTF-8, então a saída precisa ser UTF-8 explícito.
    """
    payload = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(payload)
    sys.stdout.buffer.flush()


def main():
    data = sys.stdin.buffer.read()
    if not data:
        emitir({"erro": "Arquivo vazio."})
        return

    cargos, formato, quadro_pagina = [], "", None
    cronograma, crono_pagina = [], None

    try:
        rows, pg, fmt = extract_quadro(data)
        cargos = [mapear_cargo(r) for r in rows]
        quadro_pagina, formato = pg, fmt
    except Exception as e:  # noqa
        formato = "erro:" + str(e)[:80]

    try:
        crows, cpg = extract_cronograma(data)
        cronograma = [{"ordem": r["Ordem"], "atividade": r["Atividade"],
                       "data": r["Data"]} for r in crows]
        crono_pagina = cpg
    except Exception:  # noqa
        cronograma = []

    emitir({
        "cargos": cargos,
        "formato": formato,
        "quadroPagina": quadro_pagina,
        "cronograma": cronograma,
        "cronogramaPagina": crono_pagina,
    })


if __name__ == "__main__":
    main()
