"""Gera uma chave de API. A chave aparece UMA vez na saída; no banco fica só o hash.

Uso (com DATABASE_URL no ambiente):
  python -m scripts.gerar_chave --escopo bot --operador ana@example.com --nome "bot da Ana"
  python -m scripts.gerar_chave --escopo orquestrador --nome "n8n"
"""

import argparse
import secrets

from app.auth import PREFIXO_CHAVE, hash_chave
from app.db import transacao


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--escopo", required=True, choices=["bot", "orquestrador", "leitura"])
    ap.add_argument("--operador")
    ap.add_argument("--nome", required=True)
    a = ap.parse_args()
    if a.escopo != "orquestrador" and not a.operador:
        ap.error("--operador é obrigatório para escopo bot/leitura")
    chave = PREFIXO_CHAVE + secrets.token_urlsafe(32)
    with transacao() as cur:
        cur.execute(
            """insert into chaves_api (hash_sha256, prefixo, nome, operador, escopo)
                       values (%s,%s,%s,%s,%s)""",
            (hash_chave(chave), chave[:10], a.nome, a.operador, a.escopo),
        )
        if a.escopo == "bot":
            cur.execute(
                """insert into bots (operador, nome) values (%s,%s)
                           on conflict (operador) do nothing""",
                (a.operador, a.nome),
            )
        cur.execute(
            """insert into eventos (ator, ator_tipo, operador, acao, entidade, entidade_id)
                       values ('script', 'sistema', %s, 'criou', 'chave_api', %s)""",
            (a.operador, chave[:10]),
        )
    print(chave)


if __name__ == "__main__":
    main()
