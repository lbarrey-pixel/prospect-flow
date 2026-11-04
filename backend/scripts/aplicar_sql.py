"""Roda um arquivo .sql com a DATABASE_URL do ambiente.

python -m scripts.aplicar_sql ../db/migrations/001_schema.sql
python -m scripts.aplicar_sql ../db/seed.sql
"""

import os
import sys
from pathlib import Path

import psycopg

caminho = Path(sys.argv[1])
with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True, prepare_threshold=None, options="-c search_path=crm") as c:
    c.execute(caminho.read_text(encoding="utf-8"))
print("aplicado:", caminho.name)
