# -*- coding: utf-8 -*-
"""
CLI de desenvolvimento LOCAL do extrator de anexo do edital.

Recebe os bytes de um PDF pela entrada padrão (stdin) e devolve, em JSON no
stdout, o quadro de vagas e o cronograma do edital. É usado pelo server.js via
`spawn(python, ...)` quando o app roda FORA da Vercel (ex.: `node server.js`
em desenvolvimento).

A lógica de extração NÃO vive mais aqui: ela é a mesma da função Serverless da
Vercel (api/extrair_anexo.py) e é importada dela, para haver uma única fonte.
Na Vercel o server.js não chama este script — chama a função por HTTP.

Uso (chamado pelo servidor):
    python extrair_anexo_local.py  < arquivo.pdf
"""
import os
import sys
import json

# Importa o núcleo de extração da função da Vercel (fonte única da lógica).
_API_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "api")
sys.path.insert(0, _API_DIR)
from extrair_anexo import extrair  # noqa: E402


def emitir(obj):
    """Escreve o JSON como bytes UTF-8 no stdout.

    Evita que a code page do console (cp1252 no Windows) corrompa os acentos:
    o Node lê o stdout como UTF-8, então a saída precisa ser UTF-8 explícito.
    """
    payload = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(payload)
    sys.stdout.buffer.flush()


def main():
    emitir(extrair(sys.stdin.buffer.read()))


if __name__ == "__main__":
    main()
