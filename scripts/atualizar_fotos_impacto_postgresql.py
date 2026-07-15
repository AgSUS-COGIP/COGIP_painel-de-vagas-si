"""
Atualiza a situação de crachás no PostgreSQL com base no CSV da API Impacto.

Regra:
- Consulta o CSV da Impacto.
- Localiza a coluna de CPF da pessoa.
- Considera somente linhas em que "tem foto de perfil?" seja "SIM".
- Atualiza UGP_CRACHAS_CONTROLE_MANUAL.STATUS_MANUAL de
  "FOTO PENDENTE DE ENVIO" (ou vazio, que o app exibe como
  "Foto Pendente de Envio") para "POSSUI FOTO NA IMPACTO"
  (exibido no app como "Envio à Gráfica Pendente").
- O CPF vem do join com BD_TRABALHADOR_CONSOLIDADO pela MATRICULA,
  igual ao app (lib/cracha.js).
- Trabalhadores desligados NÃO são alterados, usando a mesma regra da
  aba de crachás (SITUACAO_DETALHADA contendo "deslig", "aviso indeniz",
  "aviso trabalh" ou "demiss").
- Nenhuma outra situação é alterada.

Dependências:
    pip install requests psycopg2-binary python-dotenv

Variáveis esperadas no arquivo .env:
    IMPACTO_URL=https://api.prd.impacto.agsus.br.instituicao.me/integrated-profile/unified-person/unified-people/pf/csv
    IMPACTO_APPKEY=...
    IMPACTO_BEARER_TOKEN=...

    DB_HOST=...
    DB_PORT=5432
    DB_NAME=...
    DB_USER=...
    DB_PASSWORD=...
    DB_SCHEMA=public
    DB_SSLMODE=prefer

    # Opcionais (padrões abaixo)
    DB_TABLE=UGP_CRACHAS_CONTROLE_MANUAL
    DB_TABLE_CONSOLIDADO=BD_TRABALHADOR_CONSOLIDADO
    DB_COLUNA_CPF=          # se vazio, detecta automaticamente

    # true = simula e desfaz; false = confirma no banco
    DRY_RUN=true
"""

from __future__ import annotations

import csv
import io
import logging
import os
import re
import sys
import time
import unicodedata
from typing import Iterable

import psycopg2
from dotenv import load_dotenv
import requests
from psycopg2 import sql
from psycopg2.extras import execute_values


# Valores de banco (STATUS_MANUAL). O app exibe "POSSUI FOTO NA IMPACTO"
# como "Envio à Gráfica Pendente" (ver lib/cracha.js, STATUS_FUNIL).
STATUS_ORIGEM = "FOTO PENDENTE DE ENVIO"
STATUS_DESTINO = "POSSUI FOTO NA IMPACTO"
ATUALIZADO_POR = "script_impacto"

CPF_COLUMN_ALIASES = {
    "cpf da pessoa",
    "cpf pessoa",
    "cpf",
    "cpf number",
    "cpf_number",
    "unified person cpf number",
    "unified_person_cpf_number",
}

PHOTO_COLUMN_ALIASES = {
    "tem foto de perfil",
    "tem foto perfil",
    "possui foto de perfil",
    "possui foto perfil",
    "foto de perfil",
    "profile photo",
    "has profile photo",
}

# Padrões de SITUACAO_DETALHADA que caracterizam trabalhador desligado —
# mesma regra da aba de crachás (public/js/entrega-cracha.js, PADROES_DESLIGADO).
PADROES_DESLIGADO = ["deslig", "aviso indeniz", "aviso trabalh", "demiss"]


def configurar_log() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
    )


def normalizar_nome_coluna(value: object) -> str:
    text = "" if value is None else str(value)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = text.strip().lower()
    text = re.sub(r"[_\-?/]+", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def normalizar_cpf(value: object) -> str | None:
    digits = re.sub(r"\D", "", "" if value is None else str(value))

    if not digits:
        return None

    # CPFs podem chegar como número e perder zeros à esquerda.
    digits = digits.zfill(11)

    if len(digits) != 11:
        return None

    return digits


def valor_eh_sim(value: object) -> bool:
    normalized = normalizar_nome_coluna(value)
    return normalized in {"sim", "s", "yes", "true", "1"}


def env_obrigatoria(name: str) -> str:
    value = os.getenv(name)
    if value is None or not value.strip():
        raise RuntimeError(f"A variável de ambiente obrigatória {name} não foi informada.")
    return value.strip()


def montar_payload_impacto() -> dict:
    return {
        "pagination": {
            "page": 1,
            "limit": 0,
        },
        "filter": {
            "search": "",
            "id": "",
            "name": "",
            "social_name": "",
            "mother_name": "",
            "father_name": "",
            "cnpj_number": "",
            "cpf_number": "",
            "cns_number": "",
            "ctps_pis_number": "",
            "rg_number": "",
            "sex": "",
            "race": "",
            "ethnicity": "",
            "main_address_neighbourhood": "",
            "health_place_name": "",
            "school_place_name": "",
            "social_place_name": "",
            "gov_place_name": "",
            "jobsite_name": "",
            "unified_person_id": "",
            "unified_person_name": "",
            "unified_person_social_name": "",
            "unified_person_mother_name": "",
            "unified_person_father_name": "",
            "unified_person_cpf_number": "",
            "unified_person_cns_number": "",
            "unified_person_ctps_pis_number": "",
            "unified_person_rg_number": "",
            "unified_person_sex": "",
            "unified_person_race": "",
            "unified_person_main_address_neighbourhood": "",
            "unified_person_health_place_name": "",
            "unified_person_school_place_name": "",
            "unified_person_social_place_name": "",
            "unified_person_gov_place_name": "",
            "unified_person_cnpj_number": "",
            "unified_person_ethnicity": "",
            "unified_person_jobsite_name": "",
            "unified_person_unified_person_id": "",
            "unified_person_unified_person_name": "",
            "unified_person_unified_person_social_name": "",
            "unified_person_unified_person_mother_name": "",
            "unified_person_unified_person_father_name": "",
            "unified_person_unified_person_cpf_number": "",
            "unified_person_unified_person_cns_number": "",
            "unified_person_unified_person_ctps_pis_number": "",
            "unified_person_unified_person_rg_number": "",
            "unified_person_unified_person_sex": "",
            "unified_person_unified_person_race": "",
            "unified_person_unified_person_main_address_neighbourhood": "",
            "unified_person_unified_person_health_place_name": "",
            "unified_person_unified_person_school_place_name": "",
            "unified_person_unified_person_social_place_name": "",
            "unified_person_unified_person_gov_place_name": "",
            "info_1": "",
            "info_2": "",
            "info_3": "",
            "info_4": "",
            "info_5": "",
            "info_6": "",
            "info_7": "",
            "info_1_rule": "",
            "info_2_rule": "",
            "info_3_rule": "",
            "info_4_rule": "",
            "info_5_rule": "",
            "info_6_rule": "",
            "info_7_rule": "",
            "activity_type_name": "",
            "place_name": "",
            "search_fields": ["name", "cpf_number"],
        },
    }


def baixar_csv_impacto() -> str:
    url = env_obrigatoria("IMPACTO_URL")
    app_key = env_obrigatoria("IMPACTO_APPKEY")
    bearer_token = env_obrigatoria("IMPACTO_BEARER_TOKEN")

    headers = {
        "appkey": app_key,
        "Authorization": f"Bearer {bearer_token}",
        "Accept": "text/csv",
        "Content-Type": "application/json",
    }

    max_tentativas = 3
    response = None

    for tentativa in range(1, max_tentativas + 1):
        logging.info("Consultando a API Impacto (tentativa %s/%s)...", tentativa, max_tentativas)

        try:
            response = requests.post(
                url,
                headers=headers,
                json=montar_payload_impacto(),
                timeout=(30, 300),
            )
        except requests.RequestException as exc:
            if tentativa == max_tentativas:
                raise
            logging.warning("Falha de conexão com a Impacto: %s. Nova tentativa em 15s...", exc)
            time.sleep(15)
            continue

        if response.ok:
            break

        # 5xx são erros temporários do servidor da Impacto; vale tentar de novo.
        if response.status_code >= 500 and tentativa < max_tentativas:
            logging.warning(
                "API Impacto respondeu HTTP %s. Nova tentativa em 15s...",
                response.status_code,
            )
            time.sleep(15)
            continue

        raise RuntimeError(
            f"Erro na API Impacto. HTTP {response.status_code}. "
            f"Resposta: {response.text[:2000]}"
        )

    response.encoding = response.encoding or "utf-8"
    text = response.text.lstrip("﻿")

    if not text.strip():
        raise RuntimeError("A API Impacto retornou uma resposta vazia.")

    if text.lstrip().startswith(("{", "[")):
        raise RuntimeError(
            "A API Impacto retornou JSON em vez de CSV. "
            f"Resposta: {text[:2000]}"
        )

    logging.info("CSV da Impacto recebido com sucesso.")
    return text


def detectar_delimitador(text: str) -> str:
    first_line = text.splitlines()[0] if text.splitlines() else ""
    return ";" if first_line.count(";") >= first_line.count(",") else ","


def localizar_coluna(fieldnames: Iterable[str], aliases: set[str], description: str) -> str:
    normalized_to_original = {
        normalizar_nome_coluna(field): field
        for field in fieldnames
        if field is not None
    }

    for alias in aliases:
        normalized_alias = normalizar_nome_coluna(alias)
        if normalized_alias in normalized_to_original:
            return normalized_to_original[normalized_alias]

    available = ", ".join(str(field) for field in fieldnames)
    raise RuntimeError(
        f"Não foi possível localizar a coluna {description}. "
        f"Colunas recebidas: {available}"
    )


def extrair_cpfs_com_foto(csv_text: str) -> set[str]:
    delimiter = detectar_delimitador(csv_text)
    reader = csv.DictReader(io.StringIO(csv_text), delimiter=delimiter)

    if not reader.fieldnames:
        raise RuntimeError("O CSV retornado pela Impacto não possui cabeçalho.")

    cpf_column = localizar_coluna(
        reader.fieldnames,
        CPF_COLUMN_ALIASES,
        "de CPF da pessoa",
    )
    photo_column = localizar_coluna(
        reader.fieldnames,
        PHOTO_COLUMN_ALIASES,
        '"tem foto de perfil?"',
    )

    logging.info("Coluna de CPF localizada: %s", cpf_column)
    logging.info("Coluna de foto localizada: %s", photo_column)

    cpfs: set[str] = set()
    invalid_cpfs = 0
    rows_with_photo = 0

    for row in reader:
        if not valor_eh_sim(row.get(photo_column)):
            continue

        rows_with_photo += 1
        cpf = normalizar_cpf(row.get(cpf_column))

        if cpf:
            cpfs.add(cpf)
        else:
            invalid_cpfs += 1

    logging.info("Linhas com foto = SIM: %s", rows_with_photo)
    logging.info("CPFs válidos e únicos com foto: %s", len(cpfs))

    if invalid_cpfs:
        logging.warning("Linhas com foto, mas CPF inválido/vazio: %s", invalid_cpfs)

    return cpfs


def conectar_postgres():
    return psycopg2.connect(
        host=env_obrigatoria("DB_HOST"),
        port=int(os.getenv("DB_PORT", "5432")),
        dbname=env_obrigatoria("DB_NAME"),
        user=env_obrigatoria("DB_USER"),
        password=env_obrigatoria("DB_PASSWORD"),
        sslmode=os.getenv("DB_SSLMODE", "prefer"),
        connect_timeout=30,
        application_name="atualiza_foto_impacto_crachas",
    )


def detectar_coluna_cpf(cursor, schema_name: str, consolidado: str) -> str:
    """Detecta a coluna de CPF no consolidado (CPF, NR_CPF...), como o app faz."""
    coluna_env = os.getenv("DB_COLUNA_CPF", "").strip()
    if coluna_env:
        return coluna_env

    cursor.execute(
        """
        SELECT column_name FROM information_schema.columns
         WHERE table_schema = %s AND table_name = %s AND UPPER(column_name) LIKE '%%CPF%%'
        """,
        (schema_name, consolidado),
    )
    nomes = [str(row[0]) for row in cursor.fetchall()]

    if not nomes:
        raise RuntimeError(
            f"Nenhuma coluna de CPF encontrada na tabela {consolidado}. "
            "Informe DB_COLUNA_CPF no .env."
        )

    for nome in nomes:
        if nome.upper() == "CPF":
            return nome
    return nomes[0]


def atualizar_situacao_crachas(cpfs_com_foto: set[str]) -> int:
    if not cpfs_com_foto:
        logging.warning("Nenhum CPF com foto foi encontrado. Nada será atualizado.")
        return 0

    schema_name = os.getenv("DB_SCHEMA", "public").strip()
    table_name = os.getenv("DB_TABLE", "UGP_CRACHAS_CONTROLE_MANUAL").strip()
    consolidado = os.getenv("DB_TABLE_CONSOLIDADO", "BD_TRABALHADOR_CONSOLIDADO").strip()
    dry_run = os.getenv("DRY_RUN", "true").strip().lower() in {"1", "true", "sim", "yes"}

    logging.info(
        "Conectando ao PostgreSQL. Destino: %s.%s (CPF via %s) | DRY_RUN=%s",
        schema_name,
        table_name,
        consolidado,
        dry_run,
    )

    connection = conectar_postgres()

    try:
        with connection.cursor() as cursor:
            coluna_cpf = detectar_coluna_cpf(cursor, schema_name, consolidado)
            logging.info("Coluna de CPF no consolidado: %s", coluna_cpf)

            # A tabela temporária evita montar um IN gigantesco.
            cursor.execute(
                """
                CREATE TEMP TABLE tmp_cpfs_impacto (
                    cpf VARCHAR(11) PRIMARY KEY
                ) ON COMMIT DROP
                """
            )

            execute_values(
                cursor,
                "INSERT INTO tmp_cpfs_impacto (cpf) VALUES %s ON CONFLICT DO NOTHING",
                [(cpf,) for cpf in cpfs_com_foto],
                page_size=5000,
            )

            # O CPF vem do consolidado (join por MATRICULA, como no app).
            # LPAD recupera zeros à esquerda perdidos; NULLIF impede que CPF
            # vazio vire '00000000000'. STATUS_MANUAL vazio/NULL é tratado
            # como "Foto Pendente de Envio" (mesma regra do app). Desligados
            # ficam de fora (mesma regra da aba de crachás: SITUACAO_DETALHADA
            # contendo os PADROES_DESLIGADO; ILIKE ignora caixa).
            filtro_nao_desligado = sql.SQL(" AND NOT (") + sql.SQL(" OR ").join(
                sql.SQL("COALESCE(cracha.{situacao_detalhada}::text, '') ILIKE {padrao}").format(
                    situacao_detalhada=sql.Identifier("SITUACAO_DETALHADA"),
                    padrao=sql.Literal(f"%{padrao}%"),
                )
                for padrao in PADROES_DESLIGADO
            ) + sql.SQL(")")

            condicoes_comuns = sql.SQL(
                """
                   tc.{matricula} = cracha.{matricula}
                   AND LPAD(
                           NULLIF(regexp_replace(COALESCE(tc.{cpf}::text, ''), '[^0-9]', '', 'g'), ''),
                           11, '0'
                       ) = impacto.cpf
                   AND (cracha.{status} IS NULL
                        OR TRIM(cracha.{status}::text) = ''
                        OR UPPER(TRIM(cracha.{status}::text)) = %s)
                """
            ).format(
                matricula=sql.Identifier("MATRICULA"),
                cpf=sql.Identifier(coluna_cpf),
                status=sql.Identifier("STATUS_MANUAL"),
            ) + filtro_nao_desligado

            # Lista os registros afetados para conferência antes de gravar.
            select_query = sql.SQL(
                """
                SELECT cracha.{matricula}, cracha.{nome}, cracha.{dsei},
                       cracha.{status}, cracha.{situacao_detalhada}
                  FROM {schema}.{table} AS cracha,
                       {schema}.{consolidado} AS tc,
                       tmp_cpfs_impacto AS impacto
                 WHERE {condicoes}
                 ORDER BY cracha.{nome}
                """
            ).format(
                matricula=sql.Identifier("MATRICULA"),
                nome=sql.Identifier("NOME"),
                dsei=sql.Identifier("DSEI"),
                status=sql.Identifier("STATUS_MANUAL"),
                situacao_detalhada=sql.Identifier("SITUACAO_DETALHADA"),
                schema=sql.Identifier(schema_name),
                table=sql.Identifier(table_name),
                consolidado=sql.Identifier(consolidado),
                condicoes=condicoes_comuns,
            )

            cursor.execute(select_query, (STATUS_ORIGEM,))
            afetados = cursor.fetchall()
            logging.info("Registros que serão atualizados (%s):", len(afetados))
            for matricula, nome, dsei, status, situacao in afetados[:200]:
                logging.info(
                    "  MATRICULA=%s | %s | DSEI=%s | status atual=%s | situação=%s",
                    matricula,
                    nome or "-",
                    dsei or "-",
                    status or "(vazio)",
                    situacao or "-",
                )
            if len(afetados) > 200:
                logging.info("  ... e mais %s registro(s).", len(afetados) - 200)

            update_query = sql.SQL(
                """
                UPDATE {schema}.{table} AS cracha
                   SET {status} = %s,
                       {atualizado_por} = %s
                  FROM {schema}.{consolidado} AS tc,
                       tmp_cpfs_impacto AS impacto
                 WHERE {condicoes}
                """
            ).format(
                schema=sql.Identifier(schema_name),
                table=sql.Identifier(table_name),
                consolidado=sql.Identifier(consolidado),
                status=sql.Identifier("STATUS_MANUAL"),
                atualizado_por=sql.Identifier("ATUALIZADO_POR"),
                condicoes=condicoes_comuns,
            )

            cursor.execute(update_query, (STATUS_DESTINO, ATUALIZADO_POR, STATUS_ORIGEM))
            updated_rows = cursor.rowcount

            if dry_run:
                connection.rollback()
                logging.warning(
                    "SIMULAÇÃO concluída: %s registro(s) seriam atualizados. "
                    "Nenhuma alteração foi gravada.",
                    updated_rows,
                )
            else:
                connection.commit()
                logging.info(
                    "Atualização concluída: %s registro(s) atualizados.",
                    updated_rows,
                )

            return updated_rows

    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def main() -> int:
    configurar_log()
    load_dotenv()

    try:
        csv_text = baixar_csv_impacto()
        cpfs_com_foto = extrair_cpfs_com_foto(csv_text)
        atualizar_situacao_crachas(cpfs_com_foto)
        return 0

    except requests.RequestException as exc:
        logging.exception("Falha de comunicação com a API Impacto: %s", exc)
        return 1
    except psycopg2.Error as exc:
        logging.exception("Falha no PostgreSQL: %s", exc)
        return 1
    except Exception as exc:
        logging.exception("Erro na execução: %s", exc)
        return 1


if __name__ == "__main__":
    sys.exit(main())
