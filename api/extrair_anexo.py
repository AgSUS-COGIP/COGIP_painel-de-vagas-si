# -*- coding: utf-8 -*-
"""
Função Serverless (Python) da Vercel — extração do anexo de um edital.

Recebe os BYTES de um PDF no corpo da requisição (POST, application/pdf) e
devolve JSON com o quadro de vagas e o cronograma do edital. O arquivo é
processado em memória e NÃO é gravado em lugar nenhum.

Por que existe: no runtime Node serverless da Vercel não há binário `python`,
então o servidor Express não consegue mais chamar o extrator via `spawn`. Aqui
a extração roda como uma função Python própria (Vercel detecta `api/*.py` +
`requirements.txt`), e o Express a consome por HTTP (mantendo lá a autenticação).

Esta é a ÚNICA fonte da lógica de extração: o CLI de desenvolvimento local
(scripts/extrair_anexo_local.py) importa `extrair()` deste arquivo. Única
dependência externa: pdfplumber.

Rota: POST /api/extrair_anexo   (corpo = bytes do PDF)
"""
import io
import os
import re
import json
import unicodedata
from http.server import BaseHTTPRequestHandler

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


# ----------------------------------------------------------------------------
# Quadro de vagas COM lotacao (cargo x lotacao) — layouts variados:
#   • CARGO | AMPLA | PCD | PPIQ | TOTAL | LOTACAO             (valores inteiros)
#   • VAGA  | AMPLA | PPIQ | TOTAL | MUNICIPIO/LOTACAO         (valores CR / '1 + CR' / '-')
#   • VAGAS | LOTACAO | AMPLA | PCD | PRETOS E PARDOS | INDIGENAS | QUILOMBOLAS | TOTAL
# O mesmo cargo se repete em varias lotacoes; a celula do cargo costuma vir
# mesclada (vazia nas linhas de continuacao) e o nome pode quebrar em 2 linhas.
# Dirigido pelo cabecalho: a lotacao pode estar em qualquer coluna, os valores
# podem ser texto e o detalhamento de cotas varia. PPIQ -> primeira cota pretos/pardos.
# ----------------------------------------------------------------------------
LOT_VAL_RE = re.compile(r"^(?:\d{1,3}|cr|\d{1,3}\s*\+\s*cr|-)$")
# map_header (dest) -> chave de armazenamento (estilo do extract_bordered).
# PPIQ cai em Pretos_Pardos (instrucao do usuario: 1a cota pretos/pardos).
LOT_VALDEST = {
    "Ampla_Concorrencia": "Ampla_Concorrencia", "PcD": "PcD", "PPIQ": "Pretos_Pardos",
    "Pretos_Pardos": "Pretos_Pardos", "Indigenas": "Indigenas",
    "Quilombolas": "Quilombolas", "Total": "Total",
}
# Palavras que so aparecem em cabecalho — nunca sao nome de cargo.
LOT_HDRWORD = {"cargo", "cargos", "vaga", "vagas", "funcao", "ampla", "concorrencia",
               "concorren", "cia", "pcd", "ppiq", "total", "lotacao", "municipio",
               "pretos", "pardos", "indigenas", "quilombolas", "e"}
LOT_TOTAL = {"total", "total de vagas", "total geral"}


def _lot_is_val(s):
    return bool(LOT_VAL_RE.match(clean_cell(s).lower()))


def _lot_col_headers(t, nrows=3):
    """Rotulo combinado de cada coluna (junta as ~3 primeiras linhas do cabecalho)."""
    ncols = max((len(r) for r in t[:nrows] if r), default=0)
    labels = [""] * ncols
    for r in t[:nrows]:
        for ci in range(min(len(r), ncols)):
            c = clean_cell(r[ci])
            if c:
                labels[ci] = (labels[ci] + " " + c).strip()
    return labels, ncols


def _lot_papeis(labels):
    """(cargo_idx, lot_idx, dests) a partir dos rotulos de coluna, na ordem das colunas."""
    cargo_idx = lot_idx = None
    dests = []
    for ci, l in enumerate(labels):
        n = norm(l)
        if lot_idx is None and ("lota" in n or "municipio" in n):
            lot_idx = ci
            continue
        if cargo_idx is None and any(k in n for k in VAGA_HDR):
            cargo_idx = ci
            continue
        d = map_header(l)
        if d in LOT_VALDEST:
            dests.append(LOT_VALDEST[d])
    if cargo_idx is None:
        cargo_idx = 0
    return cargo_idx, lot_idx, dests


def _lot_cargo_junk(cargo):
    """True quando o 'cargo' e so palavra(s) de cabecalho (ou vazio)."""
    n = norm(cargo)
    return (not n) or all(w in LOT_HDRWORD for w in n.split())


def _lot_coluna_lotacao(cells, idx_txt, lot_idx):
    """Indice da celula de lotacao NESTA linha. Usa a coluna do cabecalho quando ela
    existe e traz texto aqui; senao, a ULTIMA coluna de texto — nos layouts do quadro
    a lotacao vem depois do cargo. O fallback e o que salva as tabelas de continuacao
    (paginas seguintes), que o pdfplumber devolve com outro numero de colunas, deixando
    o indice do cabecalho fora de lugar (ou fora do range)."""
    if lot_idx is not None and lot_idx in idx_txt:
        return lot_idx
    return idx_txt[-1] if idx_txt else None


def _lot_parse_tabela(t, lot_idx, dests, out):
    """Extrai linhas (cargo x lotacao) de UMA tabela para `out`, com forward-fill do
    cargo (linha sem cargo herda o anterior) e tratamento das linhas SEM valor, que
    aparecem em duas formas:
      • no meio da tabela -> 'cauda': o nome do cargo quebrou em 2 linhas e o resto
        completa o cargo da linha anterior ('Analista Tecnico de' + 'Saude Indigena');
      • antes da 1a linha de dados -> cargo NOVO cuja celula esta mesclada para baixo
        (tipico da tabela de continuacao: a pagina abre com o nome do cargo sozinho e
        as vagas vem na linha seguinte, com a celula do cargo vazia)."""
    last = out[-1] if out else None
    pendente = ""      # cargo lido numa linha so dele, aguardando a linha de dados
    tem_dados = False  # já saiu alguma linha de dados DESTA tabela?
    for row in t:
        cells = [clean_cell(c).replace("\n", " ") for c in row]
        idx_txt = [k for k in range(len(cells)) if cells[k] and not _lot_is_val(cells[k])]

        # Linha sem nenhum valor: nao tem lotacao, todo o texto e candidato a cargo.
        if not any(_lot_is_val(c) for c in cells):
            texto = " ".join(cells[k] for k in idx_txt).strip()
            if not texto or _lot_cargo_junk(texto):
                continue
            if tem_dados and last is not None:
                last["Cargo"] = (last["Cargo"] + " " + texto).strip()
            else:
                pendente = (pendente + " " + texto).strip()
            continue

        li = _lot_coluna_lotacao(cells, idx_txt, lot_idx)
        lot = cells[li] if li is not None else ""
        vals = [cells[k] for k in range(len(cells)) if k != li and _lot_is_val(cells[k])]
        cargo = " ".join(cells[k] for k in idx_txt if k != li).strip()
        if _lot_cargo_junk(cargo):
            cargo = ""
        if vals and lot and norm(lot) not in LOT_TOTAL:
            rec = {"Cargo": cargo or pendente or (last["Cargo"] if last else "")}
            for nm, v in zip(dests, vals):
                rec[nm] = v
            rec["Lotacao"] = lot
            out.append(rec)
            last = rec
            pendente = ""
            tem_dados = True


def _lot_parece_continuacao(t):
    """True quando uma tabela SEM cabecalho parece a continuacao do quadro: tem ao
    menos uma linha com 2+ celulas de valor (as cotas) e uma de texto (a lotacao).
    Descarta o que o pdfplumber devolve como tabela solta na mesma pagina (celulas de
    1 coluna com um nome de cargo) e as tabelas de outros anexos (requisitos, salario,
    jornada), que nao tem duas cotas na mesma linha."""
    for row in t:
        cells = [clean_cell(c).replace("\n", " ") for c in row]
        vals = sum(1 for c in cells if _lot_is_val(c))
        txts = sum(1 for c in cells if c and not _lot_is_val(c))
        if vals >= 2 and txts >= 1:
            return True
    return False


def extract_lotacao(pdf):
    """Quadro de vagas por lotacao (cargo repete em varias lotacoes). Retorna
    (rows, pagina); cada row usa as chaves do extract_bordered (Cargo, cotas, Lotacao)."""
    out = []
    locked = None  # (cargo_idx, lot_idx, dests, ncols)
    src = None
    for i, pg in enumerate(pdf.pages):
        # Achado o quadro, para ao chegar no Anexo III (descricao dos cargos).
        if locked is not None and any(s in norm(pg.extract_text() or "") for s in OCR_STOP):
            break
        for t in pg.extract_tables():
            if not t or not t[0]:
                continue
            labels, ncols = _lot_col_headers(t)
            hj = norm(" ".join(labels))
            tem_hdr = "ampla" in hj and ("lota" in hj or "municipio" in hj)
            if tem_hdr:
                cargo_idx, lot_idx, dests = _lot_papeis(labels)
                if lot_idx is None or not dests:
                    continue
                locked = (cargo_idx, lot_idx, dests, ncols)
                if src is None:
                    src = i + 1
            # Continuacao nas paginas seguintes: o cabecalho nao se repete e o
            # pdfplumber costuma devolver um numero de colunas DIFERENTE do da pagina
            # do cabecalho (lá as celulas mescladas do titulo criam colunas vazias a
            # mais). Por isso o criterio nao pode ser a igualdade de colunas: aceita
            # tambem a tabela cujas linhas tem a cara do quadro.
            elif locked is not None and (ncols == locked[3] or _lot_parece_continuacao(t)):
                lot_idx, dests = locked[1], locked[2]
            else:
                continue
            _lot_parse_tabela(t, lot_idx, dests, out)
    return (out, src) if out else ([], None)


def extract_quadro(pdf_bytes):
    """Retorna (rows, pagina, formato) ou ([], None, '')."""
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            # Formato com lotacao (cargo x lotacao) tem prioridade quando detectado.
            rows, pg = extract_lotacao(pdf)
            if rows:
                return rows, pg, "lotacao"
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
# Fallback OCR — PDFs escaneados (sem camada de texto)
# ----------------------------------------------------------------------------
# Quando o PDF é só imagem, pdfplumber não acha texto/tabela nenhuma. Aqui
# rasterizamos as páginas (pypdfium2) e passamos por OCR (rapidocr-onnxruntime,
# pip-only, sem binário de sistema), reconstruindo o QUADRO e o CRONOGRAMA por
# GEOMETRIA: as colunas vêm do x dos cabeçalhos; as linhas do agrupamento por y
# dos valores/datas; o texto do cargo/atividade (que quebra em várias linhas) é
# atribuído à linha de y mais próximo. Imports são lazy: sem as libs, o extrator
# segue funcionando para PDFs com texto e o OCR apenas não roda.
_OCR_ENGINE = None


def _ocr_libs_ok():
    import importlib.util as u
    return all(u.find_spec(m) for m in ("pypdfium2", "rapidocr_onnxruntime", "numpy"))


def _get_ocr():
    global _OCR_ENGINE
    if _OCR_ENGINE is None:
        from rapidocr_onnxruntime import RapidOCR
        _OCR_ENGINE = RapidOCR()
    return _OCR_ENGINE


def _ocr_uma_pagina(pdf, i, ocr, scale, np):
    """Rasteriza + OCR de UMA página. Retorna [word, ...].
    word = {text, x0,x1,y0,y1, cx,cy}. box_thresh/text_score baixos p/ detectar
    dígitos isolados (ex.: '1','2') que o default do detector perde."""
    pil = pdf[i].render(scale=scale).to_pil().convert("RGB")
    res, _ = ocr(np.array(pil), box_thresh=0.3, text_score=0.3)
    ws = []
    for box, txt, _conf in (res or []):
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        ws.append({
            "text": unicodedata.normalize("NFKC", str(txt)),
            "x0": min(xs), "x1": max(xs), "y0": min(ys), "y1": max(ys),
            "cx": (min(xs) + max(xs)) / 2.0, "cy": (min(ys) + max(ys)) / 2.0,
        })
    return ws


# Início da parte irrelevante: os editais trazem Anexo I (cronograma), Anexo II
# (quadro de vagas) e, por último, o Anexo III (descrição/atribuições dos cargos),
# que não interessa e costuma ser a maior parte do PDF. Ao detectar seu início,
# paramos o OCR — o que precisávamos (Anexos I e II) já ficou para trás.
OCR_STOP = ("anexo iii", "anexo 3", "descricao das func", "descricao das atividades",
            "descricao sumaria", "atribuicoes do", "atribuicoes dos cargos",
            "das atribuicoes", "descricao dos cargos")


def _pagina_de_parada(words):
    txt = norm(" ".join(w["text"] for w in words))
    return any(m in txt for m in OCR_STOP)


def _header_word(words, key):
    """Palavra (mais ao topo) cujo texto normalizado contém `key`."""
    cand = sorted([w for w in words if key in norm(w["text"])], key=lambda w: w["cy"])
    return cand[0] if cand else None


def _cluster_rows(anchor, gap):
    """Agrupa os tokens-âncora (valores/datas) em linhas por proximidade de cy."""
    rows = []
    for w in sorted(anchor, key=lambda w: w["cy"]):
        if rows and (w["cy"] - rows[-1]["cy"]) < gap:
            rows[-1]["items"].append(w)
            rows[-1]["cy"] = sum(it["cy"] for it in rows[-1]["items"]) / len(rows[-1]["items"])
        else:
            rows.append({"cy": w["cy"], "items": [w]})
    return rows


def _nearest_row(rows, cy):
    if not rows:
        return None
    return min(range(len(rows)), key=lambda k: abs(rows[k]["cy"] - cy))


OCR_COLS = [("ampla", "Ampla_Concorrencia"), ("pcd", "PcD"), ("pretos", "Pretos_Pardos"),
            ("indigena", "Indigenas"), ("quilombola", "Quilombolas"), ("total", "Total")]
OCR_VAL_RE = re.compile(r"^(\d{1,3}\+?cr|\d{1,3}|cr)$")
OCR_DATE_RE = re.compile(r"\d{1,2}\s*(?:a|e|/)?\s*\d{0,2}/\d{1,2}")
OCR_JUNK = ("sei agsus", "anexo", "pagina", "quadro de vagas", "www", "reserva se",
            "cadastro reserva", "agencia brasileira", "documento", "pg ")


def _ocr_junk(text):
    n = norm(text)
    return any(j in n for j in OCR_JUNK)


def _quadro_linhas(words, centers, cargo_bound, hdr_y):
    """Reconstrói as linhas do quadro numa página, dadas as colunas (centers)."""
    data = [w for w in words if w["cy"] > hdr_y + 4 and not _ocr_junk(w["text"])]
    values = [w for w in data if w["cx"] >= cargo_bound
              and OCR_VAL_RE.match(norm(w["text"]).replace(" ", ""))]
    rows = _cluster_rows(values, gap=28)
    recs = [{"cargo": [], "cells": {}} for _ in rows]
    for w in values:
        k = _nearest_row(rows, w["cy"])
        dest = min(centers, key=lambda d: abs(centers[d] - w["cx"]))
        recs[k]["cells"].setdefault(dest, w["text"])
    for w in [w for w in data if w["cx"] < cargo_bound]:
        k = _nearest_row(rows, w["cy"])
        if k is not None:
            recs[k]["cargo"].append(w)
    out = []
    for r in recs:
        cargo = re.sub(r"\s+", " ", " ".join(
            w["text"] for w in sorted(r["cargo"], key=lambda w: (round(w["cy"] / 18), w["cx"])))).strip()
        if len(norm(cargo)) < 3 or not r["cells"]:
            continue
        rec = {"Cargo": cargo}
        rec.update(r["cells"])
        out.append(rec)
    return out


def _ocr_quadro(paginas):
    """Quadro de vagas via OCR, com continuação em páginas sem cabeçalho: a
    geometria (colunas) da página do cabeçalho é reaproveitada nas seguintes,
    parando na 1ª página de continuação sem linhas válidas."""
    todos, pg_ini = [], None
    centers = cargo_bound = None
    for i, ws in enumerate(paginas):
        hdr = {dest: _header_word(ws, key) for key, dest in OCR_COLS}
        tem_hdr = hdr.get("Ampla_Concorrencia") and hdr.get("PcD") and hdr.get("Total")
        if tem_hdr:
            centers = {d: h["cx"] for d, h in hdr.items() if h}
            cargo_bound = centers["Ampla_Concorrencia"] - (centers["PcD"] - centers["Ampla_Concorrencia"]) / 2.0
            hdr_y = max(h["y1"] for h in hdr.values() if h)
        elif centers is not None:
            hdr_y = 0  # continuação: sem cabeçalho, usa as colunas já conhecidas
        else:
            continue  # ainda não encontramos o cabeçalho do quadro
        linhas = _quadro_linhas(ws, centers, cargo_bound, hdr_y)
        if not linhas:
            if not tem_hdr:
                break  # continuação vazia => fim da tabela
            continue
        if pg_ini is None:
            pg_ini = i + 1
        todos.extend(linhas)
    return todos, pg_ini


def _ocr_cronograma(paginas):
    """Cronograma via OCR: colunas Atividades|Datas; linhas ancoradas pelas datas."""
    for i, words in enumerate(paginas):
        a = _header_word(words, "atividade")
        d = _header_word(words, "data")
        if not a or not d:
            continue
        bound = (a["cx"] + d["cx"]) / 2.0
        hdr_y = max(a["y1"], d["y1"])
        data = [w for w in words if w["cy"] > hdr_y + 4 and not _ocr_junk(w["text"])]
        dates = [w for w in data if w["cx"] >= bound and OCR_DATE_RE.search(w["text"])]
        if not dates:
            continue
        rows = _cluster_rows(dates, gap=30)
        recs = [{"ativ": [], "data": []} for _ in rows]
        for w in dates:
            recs[_nearest_row(rows, w["cy"])]["data"].append(w)
        # Não atribui texto muito abaixo da última data (evita o parágrafo "Obs:"
        # e rodapés que ficam sob a tabela colarem na última atividade).
        y_lim = max(w["cy"] for w in dates) + 40
        for w in [w for w in data if w["cx"] < bound and w["cy"] <= y_lim]:
            k = _nearest_row(rows, w["cy"])
            if k is not None:
                recs[k]["ativ"].append(w)
        out = []
        for r in recs:
            ativ = re.sub(r"\s+", " ", " ".join(
                w["text"] for w in sorted(r["ativ"], key=lambda w: (round(w["cy"] / 18), w["cx"])))).strip()
            ativ = re.split(r"\bObs\b", ativ)[0].strip()
            data = " ".join(w["text"] for w in sorted(r["data"], key=lambda w: w["cx"])).strip()
            if len(norm(ativ)) < 3:
                continue
            out.append({"Ordem": len(out) + 1, "Atividade": ativ, "Data": data})
        if out:
            return out, i + 1
    return [], None


def _extrair_ocr(pdf_bytes):
    """Roda o OCR (se as libs existirem) e devolve (cargos_rows, quadro_pg,
    cronograma_rows, crono_pg, status)."""
    if not _ocr_libs_ok():
        return [], None, [], None, "ocr:indisponivel"
    try:
        import numpy as np
        import pypdfium2 as pdfium
        max_pg = int(os.environ.get("EXTRATOR_OCR_MAX_PAGINAS") or 12)
        scale = float(os.environ.get("EXTRATOR_OCR_SCALE") or 3.0)
        ocr = _get_ocr()
        pdf = pdfium.PdfDocument(pdf_bytes)
        paginas = []
        for i in range(min(len(pdf), max_pg)):
            ws = _ocr_uma_pagina(pdf, i, ocr, scale, np)
            paginas.append(ws)
            # Chegou no Anexo III (descrição das funções)? Inclui a página (pode
            # ter o fim do quadro no topo) e PARA — o resto do PDF não importa.
            if _pagina_de_parada(ws):
                break
        cargos, qpg = _ocr_quadro(paginas)
        crono, cpg = _ocr_cronograma(paginas)
        return cargos, qpg, crono, cpg, "ocr"
    except Exception as e:  # noqa
        return [], None, [], None, "ocr:erro:" + str(e)[:80]


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


# Verifica (barato) se o PDF tem CAMADA DE TEXTO: lê o texto de umas poucas
# páginas (extract_text é rápido; extract_tables é que é caro). Num PDF escaneado
# volta ~0, e aí NÃO vale a pena rodar a extração por tabelas do pdfplumber sobre
# todas as páginas-imagem (custa minutos e não acha nada) — vamos direto ao OCR.
def _tem_camada_texto(pdf_bytes, amostra=6, minimo=40):
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            total = 0
            for pg in pdf.pages[:amostra]:
                total += len((pg.extract_text() or "").strip())
                if total >= minimo:
                    return True
    except Exception:  # noqa
        return False
    return False


def extrair(pdf_bytes):
    """Núcleo reutilizável: PDF (bytes) -> dict {cargos, cronograma, ...}.

    Usado tanto pela função Serverless (handler) quanto pelo CLI de dev local
    (scripts/extrair_anexo_local.py).
    """
    if not pdf_bytes:
        return {"erro": "Arquivo vazio."}

    cargos, formato, quadro_pagina = [], "", None
    cronograma, crono_pagina = [], None

    # Só roda o pdfplumber (por tabelas) se houver texto; escaneado pula direto ao OCR.
    if _tem_camada_texto(pdf_bytes):
        try:
            rows, pg, fmt = extract_quadro(pdf_bytes)
            cargos = [mapear_cargo(r) for r in rows]
            quadro_pagina, formato = pg, fmt
        except Exception as e:  # noqa
            formato = "erro:" + str(e)[:80]

        try:
            crows, cpg = extract_cronograma(pdf_bytes)
            cronograma = [{"ordem": r["Ordem"], "atividade": r["Atividade"],
                           "data": r["Data"]} for r in crows]
            crono_pagina = cpg
        except Exception:  # noqa
            cronograma = []

    # Nada na camada de texto => provável PDF escaneado: tenta OCR (best-effort).
    ocr_status = None
    if not cargos and not cronograma:
        crows, qpg, ocr_crono, ccpg, ocr_status = _extrair_ocr(pdf_bytes)
        if crows:
            cargos = [mapear_cargo(r) for r in crows]
            quadro_pagina, formato = qpg, ocr_status
        if ocr_crono:
            cronograma = [{"ordem": r["Ordem"], "atividade": r["Atividade"],
                           "data": r["Data"]} for r in ocr_crono]
            crono_pagina = ccpg
            if not formato:
                formato = ocr_status

    return {
        "cargos": cargos,
        "formato": formato,
        "quadroPagina": quadro_pagina,
        "cronograma": cronograma,
        "cronogramaPagina": crono_pagina,
        "ocr": ocr_status,
    }


# ----------------------------------------------------------------------------
# Handler da função Serverless da Vercel
# ----------------------------------------------------------------------------
def _token_ok(headers):
    """Se EXTRATOR_ANEXO_TOKEN estiver definido no ambiente, exige o mesmo valor
    no header 'x-extrator-token' (guarda simples contra chamadas externas). Sem a
    variável, não há checagem (funciona sem configuração extra)."""
    esperado = os.environ.get("EXTRATOR_ANEXO_TOKEN")
    if not esperado:
        return True
    return headers.get("x-extrator-token") == esperado


class handler(BaseHTTPRequestHandler):
    def _responder(self, status, obj):
        payload = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        if not _token_ok(self.headers):
            self._responder(401, {"erro": "Não autorizado."})
            return
        try:
            length = int(self.headers.get("content-length") or 0)
        except ValueError:
            length = 0
        data = self.rfile.read(length) if length else b""
        if not data:
            self._responder(400, {"erro": "Envie os bytes de um PDF no corpo da requisição."})
            return
        try:
            self._responder(200, extrair(data))
        except Exception as e:  # noqa
            self._responder(422, {"erro": "Não foi possível ler o PDF.", "detalhe": str(e)[:120]})

    def do_GET(self):
        self._responder(405, {"erro": "Use POST com os bytes do PDF."})
