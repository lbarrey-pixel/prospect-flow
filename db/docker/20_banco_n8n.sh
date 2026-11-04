#!/bin/sh
# O n8n guarda seu estado num database próprio, separado do schema `crm`.
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "create database n8n"
