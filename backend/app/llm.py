"""Porta para o modelo de linguagem usado na classificação de respostas.

A API só precisa de uma coisa do modelo: dado um `system` e um texto, devolver
uma resposta curta. `ProvedorHTTP` fala com qualquer serviço que exponha o
formato de chat completions (a maioria dos fornecedores e dos gateways/proxies
expõe esse formato). Quem não tem chave configurada cai
no `ProvedorNulo`, e os testes usam o `ProvedorFake`.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Protocol

import requests

log = logging.getLogger(__name__)


class ProvedorLLM(Protocol):
    def completar(self, system: str, texto: str, max_tokens: int = 16) -> str: ...


@dataclass
class ProvedorHTTP:
    url: str
    chave: str
    modelo: str
    timeout: float = 20.0

    def completar(self, system: str, texto: str, max_tokens: int = 16) -> str:
        r = requests.post(
            self.url,
            timeout=self.timeout,
            headers={"Authorization": f"Bearer {self.chave}", "Content-Type": "application/json"},
            json={
                "model": self.modelo,
                "max_tokens": max_tokens,
                "temperature": 0,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": texto}],
            },
        )
        r.raise_for_status()
        return extrair_texto(r.json())


def extrair_texto(corpo: dict) -> str:
    """Aceita os dois formatos de resposta mais comuns, sem quebrar se faltar campo."""
    if not isinstance(corpo, dict):
        return ""
    escolhas = corpo.get("choices")
    if isinstance(escolhas, list) and escolhas:
        msg = (escolhas[0] or {}).get("message") or {}
        conteudo = msg.get("content")
        if isinstance(conteudo, str):
            return conteudo.strip()
        if isinstance(conteudo, list):
            return "".join(b.get("text", "") for b in conteudo if isinstance(b, dict)).strip()
    blocos = corpo.get("content")
    if isinstance(blocos, list):
        return "".join(b.get("text", "") for b in blocos if isinstance(b, dict)).strip()
    if isinstance(blocos, str):
        return blocos.strip()
    return ""


class ProvedorNulo:
    """Sem modelo configurado: responde vazio e deixa a regra de negócio decidir o padrão."""

    def completar(self, system: str, texto: str, max_tokens: int = 16) -> str:
        return ""


@dataclass
class ProvedorFake:
    """Para testes: devolve respostas na ordem e guarda o que foi perguntado."""

    respostas: list[str] = field(default_factory=list)
    chamadas: list[tuple[str, str]] = field(default_factory=list)

    def completar(self, system: str, texto: str, max_tokens: int = 16) -> str:
        self.chamadas.append((system, texto))
        return self.respostas.pop(0) if self.respostas else ""


def do_ambiente() -> ProvedorLLM:
    url = os.environ.get("LLM_API_URL", "").strip()
    chave = os.environ.get("LLM_API_KEY", "").strip()
    modelo = os.environ.get("LLM_MODEL", "").strip()
    if url and chave and modelo:
        return ProvedorHTTP(url, chave, modelo, timeout=float(os.environ.get("LLM_TIMEOUT", "20")))
    return ProvedorNulo()
