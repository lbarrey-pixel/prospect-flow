#!/bin/sh
# Roda uma vez, na criação do volume do Postgres (docker-entrypoint-initdb.d).
# Cria o schema, o papel da API com login e aplica o seed de demonstração.
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /migrations/001_schema.sql
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "alter role crm_api with login password '${CRM_API_DB_PASSWORD}'"
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /seed/seed.sql
