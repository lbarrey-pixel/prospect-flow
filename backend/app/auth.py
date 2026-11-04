"""Quem está chamando.

- Operador (painel): ID token do Google, e-mail cadastrado em `crm.operadores`.
- Chave `pf_…`: escopo `bot` (só o próprio operador), `orquestrador` (n8n) ou
  `leitura`. No banco fica só o SHA-256 da chave.
- Com `AUTH_DEV=1`, um token `dev:<email>` entra como aquele operador. É para
  rodar o stack local sem configurar OAuth; nunca ligar em produção.
"""

from __future__ import annotations

import hashlib
import logging
import os
import time
from dataclasses import dataclass

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .db import transacao, um

log = logging.getLogger(__name__)

PREFIXO_CHAVE = "pf_"
PREFIXO_DEV = "dev:"
_security = HTTPBearer(auto_error=False)
# Chave do cache é o hash do token, nunca o token em si.
_cache: dict[str, tuple[Principal, float]] = {}
_TTL = 300
_CACHE_MAX = 500


@dataclass(frozen=True)
class Principal:
    tipo: str  # operador | bot | orquestrador | leitura
    ator: str  # e-mail do operador, ou nome da chave
    operador: str | None  # operador "dono" (bot/operador); None para orquestrador
    admin: bool = False

    @property
    def ator_tipo(self) -> str:
        return {"leitura": "sistema"}.get(self.tipo, self.tipo)

    def pode_editar(self, dono: str | None) -> bool:
        if self.tipo == "orquestrador":
            return True
        if self.tipo == "operador":
            return self.admin or (dono is not None and dono == self.operador)
        if self.tipo == "bot":
            return dono is not None and dono == self.operador
        return False

    def pode_ver(self, dono: str | None) -> bool:
        if self.tipo in ("operador", "orquestrador", "leitura"):
            return True
        return dono is not None and dono == self.operador


def hash_chave(chave: str) -> str:
    return hashlib.sha256(chave.encode("utf-8")).hexdigest()


def _por_chave(token: str) -> Principal:
    with transacao() as cur:
        ch = um(
            cur,
            """update chaves_api set ultimo_uso_em = now()
               where hash_sha256 = %s returning nome, operador, escopo, ativa""",
            (hash_chave(token),),
        )
        if not ch:
            raise HTTPException(401, "Chave de API inválida.")
        if not ch["ativa"]:
            raise HTTPException(403, "Chave de API revogada.")
        if ch["operador"]:
            op = um(cur, "select ativo from operadores where email = %s", (ch["operador"],))
            if not op or not op["ativo"]:
                raise HTTPException(403, "Operador da chave está inativo.")
    return Principal(tipo=ch["escopo"], ator=ch["nome"], operador=ch["operador"])


def _operador_cadastrado(email: str) -> Principal:
    with transacao() as cur:
        op = um(cur, "select email, admin, ativo from operadores where email = %s", (email,))
    if not op or not op["ativo"]:
        raise HTTPException(403, f"Acesso negado para {email}")
    return Principal(tipo="operador", ator=email, operador=email, admin=bool(op["admin"]))


def _por_google(token: str) -> Principal:
    from google.auth.transport import requests as g_requests
    from google.oauth2 import id_token

    client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
    if not client_id:
        raise HTTPException(401, "Login por Google não está configurado nesta instância.")
    try:
        info = id_token.verify_oauth2_token(token, g_requests.Request(), client_id, clock_skew_in_seconds=30)
    except Exception:
        # O motivo fica no log; para o cliente basta saber que o token não serve.
        log.info("ID token recusado", exc_info=True)
        raise HTTPException(401, "Token inválido ou expirado.") from None
    return _operador_cadastrado((info.get("email") or "").lower())


def _por_dev(token: str) -> Principal:
    if os.environ.get("AUTH_DEV") != "1":
        raise HTTPException(401, "Token inválido.")
    return _operador_cadastrado(token[len(PREFIXO_DEV) :].strip().lower())


def _guardar(chave: str, p: Principal, agora: float):
    if len(_cache) >= _CACHE_MAX:
        for k in [k for k, (_, exp) in _cache.items() if exp <= agora]:
            del _cache[k]
    if len(_cache) >= _CACHE_MAX:
        # Ainda cheio: descarta os mais antigos (ordem de inserção do dict).
        for k in list(_cache)[: _CACHE_MAX // 5]:
            del _cache[k]
    _cache[chave] = (p, agora + _TTL)


def resolver(token: str) -> Principal:
    agora = time.time()
    chave = hash_chave(token)
    em_cache = _cache.get(chave)
    if em_cache and em_cache[1] > agora:
        return em_cache[0]
    if token.startswith(PREFIXO_CHAVE):
        p = _por_chave(token)
    elif token.startswith(PREFIXO_DEV):
        p = _por_dev(token)
    else:
        p = _por_google(token)
    _guardar(chave, p, agora)
    return p


def principal(cred: HTTPAuthorizationCredentials | None = Depends(_security)) -> Principal:
    if cred is None:
        raise HTTPException(401, "Credencial ausente.")
    return resolver(cred.credentials.strip())


def exige(*tipos: str):
    def dep(p: Principal = Depends(principal)) -> Principal:
        if p.tipo not in tipos:
            raise HTTPException(403, f"Rota não liberada para credencial do tipo '{p.tipo}'.")
        return p

    return dep


so_operador = exige("operador")
so_bot = exige("bot")
so_orquestrador = exige("orquestrador")
humano_ou_bot = exige("operador", "bot")
leitores = exige("operador", "bot", "orquestrador", "leitura")
