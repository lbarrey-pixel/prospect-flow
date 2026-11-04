"""API do Prospect Flow. Contrato em docs/api.md; desenho em docs/arquitetura.md."""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import rotas_board, rotas_bot, rotas_diario, rotas_gestao, rotas_leads, rotas_orquestrador, rotas_tarefas

VERSAO = "1.0.0"

app = FastAPI(title="Prospect Flow", version=VERSAO)

origens = [o.strip() for o in os.environ.get("CORS_ORIGENS", "http://localhost:5173").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origens, allow_methods=["*"], allow_headers=["*"])


@app.get("/saude")
def saude():
    return {"ok": True, "versao": VERSAO}


# A ordem importa: /bot/* e /orquestrador/* antes das rotas com parâmetro.
app.include_router(rotas_bot.router)
app.include_router(rotas_orquestrador.router)
app.include_router(rotas_diario.router)
app.include_router(rotas_board.router)
app.include_router(rotas_gestao.router)
app.include_router(rotas_tarefas.router)
app.include_router(rotas_leads.router)
