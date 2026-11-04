"""Conexão com o schema `crm` (psycopg 3 + pool, sem ORM).

A API entra como o papel `crm_api`, que só tem permissão no schema `crm`:
qualquer outra tabela do banco fica fora de alcance por permissão, não por
disciplina de código.
"""

from __future__ import annotations

import os
from contextlib import contextmanager

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

_pool: ConnectionPool | None = None


def pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        url = os.environ.get("DATABASE_URL", "")
        if not url:
            raise RuntimeError("DATABASE_URL não configurada")
        # prepare_threshold=None: funciona atrás de poolers em modo transação,
        # que não aceitam prepared statements nomeados.
        _pool = ConnectionPool(
            url,
            min_size=1,
            max_size=int(os.environ.get("DB_POOL_MAX", "5")),
            kwargs={"row_factory": dict_row, "prepare_threshold": None, "options": "-c search_path=crm"},
            open=True,
        )
    return _pool


def fechar():
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


@contextmanager
def transacao():
    """Uma conexão em transação; commit no fim, rollback se der erro."""
    with pool().connection() as conn, conn.transaction(), conn.cursor() as cur:
        yield cur


def um(cur, sql: str, params=None) -> dict | None:
    cur.execute(sql, params or ())
    return cur.fetchone()


def todos(cur, sql: str, params=None) -> list[dict]:
    cur.execute(sql, params or ())
    return cur.fetchall()


def jsonb(v):
    return Jsonb(v) if v is not None else None
