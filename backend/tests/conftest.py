"""Banco de teste.

Os testes de API rodam contra um Postgres de verdade, com o mesmo schema de
produção (db/migrations/001_schema.sql). Ordem de preferência:

1. `TEST_DATABASE_URL` no ambiente (CI e dev local com Postgres instalado);
2. `pgserver`, se estiver instalado, que sobe um Postgres embutido descartável.

Sem nenhum dos dois, os testes de API são pulados e só os de regras rodam.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[2]
SCHEMA = RAIZ / "db" / "migrations" / "001_schema.sql"


@pytest.fixture(scope="session")
def url_banco():
    url = os.environ.get("TEST_DATABASE_URL")
    if url:
        yield url
        return
    pgserver = pytest.importorskip("pgserver", reason="defina TEST_DATABASE_URL ou instale pgserver")
    srv = pgserver.get_server(tempfile.mkdtemp(), cleanup_mode="stop")
    try:
        yield srv.get_uri()
    finally:
        srv.cleanup()


@pytest.fixture(scope="session")
def banco_limpo(url_banco):
    """Recria o schema `crm` do zero e devolve a URL."""
    import psycopg

    with psycopg.connect(url_banco, autocommit=True) as c:
        c.execute("drop schema if exists crm cascade")
        c.execute(SCHEMA.read_text(encoding="utf-8"))
    return url_banco
