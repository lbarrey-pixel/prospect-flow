"""Diário: o que aconteceu num dia, em linguagem de gente.

Junta três fontes numa linha do tempo só:
- `acoes`      — toques do bot (e-mail enviado, bounce, nota, decisão);
- `interacoes` — respostas recebidas (e o histórico importado);
- `eventos`    — o que acontece na API (tarefas, campainhas, diretrizes…).
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException

from . import regras as R
from . import servicos as S
from .auth import Principal, leitores
from .db import todos, transacao

router = APIRouter()

ENVIOS = {"mensagem_enviada", "reenvio_pos_bounce", "redirect_auto_reply", "resposta_in_thread"}
ROTULO_ENVIO = {
    "reenvio_pos_bounce": "reenvio após bounce",
    "redirect_auto_reply": "indicado em resposta automática",
    "resposta_in_thread": "resposta na conversa",
}
# Eventos que já aparecem por outra fonte (ação/interação) ou que são ruído de máquina.
EVENTOS_FORA = {
    "enviou",
    "registrou_contato",
    "registrou_acao",
    "pegou",
    "puxou",
    "entregou",
    "iniciou",
    "leu",
    "alterou",
}

_RX_PARA = re.compile(r"para\s+([^\s–—]+@[^\s–—]+)", re.I)
_RX_ASSUNTO = re.compile(r"assunto:\s*(.+?)(?:\s+[–—-]\s+resumo:|$)", re.I)
_RX_RESUMO = re.compile(r"resumo:\s*(.+)$", re.I)


def _campo(rx, texto):
    m = rx.search(texto or "")
    return m.group(1).strip() if m else None


def _dia(dia: str) -> date:
    if not dia:
        return S.agora().astimezone(R.ZoneInfo(R.TZ_PADRAO)).date()
    try:
        return date.fromisoformat(dia)
    except ValueError:
        raise HTTPException(422, "dia no formato AAAA-MM-DD")


def _janela(d: date) -> tuple[datetime, datetime]:
    return S.limites_do_dia(datetime.combine(d, datetime.min.time(), R.ZoneInfo(R.TZ_PADRAO)))


def _filtro_op(p: Principal, operador: str) -> str:
    return p.operador if p.tipo == "bot" else (operador or "").strip().lower()


def _item_acao(a: dict) -> dict:
    t = a["tipo_acao"]
    base = {
        "id": f"acao:{a['id']}",
        "em": a["data_hora"],
        "dominio": a["dominio"],
        "empresa": a["empresa"],
        "operador": a["dono_email"],
        "ator": a["realizado_por"],
        "origem": "acao",
        "rodada": a["rodada"],
        "proxima_acao_em": a["proxima_acao_em"],
    }
    desc = a["descricao"] or ""
    if t in ENVIOS:
        return {
            **base,
            "tipo": "email_enviado",
            "subtipo": t,
            "titulo": (f"R{a['rodada']}" if a["rodada"] else ROTULO_ENVIO.get(t, "e-mail")),
            "para": _campo(_RX_PARA, desc),
            "assunto": _campo(_RX_ASSUNTO, desc),
            "detalhe": _campo(_RX_RESUMO, desc) or (None if _campo(_RX_ASSUNTO, desc) else desc),
        }
    if t == "email_nao_entregue":
        return {
            **base,
            "tipo": "bounce",
            "titulo": "e-mail não entregue",
            "para": _campo(_RX_PARA, desc)
            or (re.search(r"[\w.+-]+@[\w.-]+", desc).group(0) if re.search(r"[\w.+-]+@[\w.-]+", desc) else None),
            "detalhe": desc,
        }
    if t.startswith("bot_") or t in ("nutricao_parada", "tarefa_humana"):
        return {**base, "tipo": "decisao", "titulo": t.replace("bot_", "").replace("_", " "), "detalhe": desc}
    return {**base, "tipo": "nota", "titulo": t.replace("_", " "), "detalhe": desc}


def _item_interacao(i: dict) -> dict:
    base = {
        "id": f"interacao:{i['id']}",
        "em": i["data_interacao"],
        "dominio": i["dominio"],
        "empresa": i["empresa"],
        "operador": i["dono_email"],
        "ator": i["email"],
        "origem": "interacao",
        "assunto": i["assunto"],
        "trecho": (i["trecho"] or "")[:600] or None,
        "interesse": i["interesse"],
        "classe": i["classe"],
    }
    if i["direcao"] == "enviado":
        return {
            **base,
            "tipo": "email_enviado",
            "subtipo": "historico",
            "titulo": "e-mail (histórico)",
            "para": i["email"],
        }
    if i["classe"] == "bounce":
        return {**base, "tipo": "bounce", "titulo": "e-mail não entregue"}
    if i["classe"] in ("auto_reply", "redirect"):
        return {**base, "tipo": "resposta", "titulo": "resposta automática", "de": i["email"]}
    return {
        **base,
        "tipo": "resposta",
        "de": i["email"],
        "titulo": "interesse real" if i["interesse"] == "real" else "resposta",
    }


def _item_evento(e: dict) -> dict:
    d = e["dados"] or {}
    tipo = {
        "tarefa": "tarefa",
        "campainha": "campainha",
        "acompanhamento": "acompanhamento",
        "relato": "relato",
        "diretriz": "diretriz",
        "envio": "envio",
        "lead": "lead",
    }.get(e["entidade"], "sistema")
    titulo = f"{e['acao'].replace('_', ' ')} {e['entidade']}"
    if d.get("titulo"):
        titulo += f": {d['titulo']}"
    elif d.get("nome"):
        titulo += f": {d['nome']}"
    return {
        "id": f"evento:{e['id']}",
        "em": e["em"],
        "tipo": tipo,
        "subtipo": e["acao"],
        "titulo": titulo,
        "dominio": e["entidade_id"] if e["entidade"] == "lead" else d.get("dominio"),
        "operador": e["operador"],
        "ator": e["ator"],
        "ator_tipo": e["ator_tipo"],
        "origem": "evento",
        "entidade": e["entidade"],
        "entidade_id": e["entidade_id"],
        "detalhe": d.get("motivo") or d.get("nota") or d.get("detalhe"),
        "dados": d,
    }


@router.get("/diario")
def diario(dia: str = "", operador: str = "", p: Principal = Depends(leitores)):
    d = _dia(dia)
    ini, fim = _janela(d)
    op = _filtro_op(p, operador)
    f_lead = "and l.dono_email = %s" if op else ""
    f_ev = "and e.operador = %s" if op else ""
    prm = [op] if op else []
    with transacao() as cur:
        acoes = todos(
            cur,
            f"""select a.*, l.dominio, l.empresa, l.dono_email from acoes a join leads l on l.id = a.lead_id
                               where a.data_hora >= %s and a.data_hora < %s {f_lead}""",
            [ini, fim] + prm,
        )
        inter = todos(
            cur,
            f"""select i.*, l.dominio, l.empresa, l.dono_email from interacoes i join leads l on l.id = i.lead_id
                               where i.data_interacao >= %s and i.data_interacao < %s {f_lead}
                                 and (i.direcao = 'recebido' or i.origem = 'importacao')""",
            [ini, fim] + prm,
        )
        evs = todos(
            cur,
            f"""select e.* from eventos e where e.em >= %s and e.em < %s {f_ev}
                             and e.acao <> all(%s)
                             and not (e.acao = 'rascunhou' and coalesce(e.dados->>'status', '') <> 'bloqueado')""",
            [ini, fim] + prm + [list(EVENTOS_FORA)],
        )
    itens = [_item_acao(a) for a in acoes] + [_item_interacao(i) for i in inter] + [_item_evento(e) for e in evs]
    itens.sort(key=lambda x: x["em"] or ini, reverse=True)
    resumo = {
        "emails_enviados": 0,
        "rodadas": 0,
        "respostas": 0,
        "interesse_real": 0,
        "bounces": 0,
        "notas": 0,
        "decisoes": 0,
        "tarefas": 0,
        "outros": 0,
    }
    for x in itens:
        if x["tipo"] == "email_enviado":
            resumo["emails_enviados"] += 1
            resumo["rodadas"] += 1 if x.get("rodada") else 0
        elif x["tipo"] == "resposta":
            resumo["respostas"] += 1
            resumo["interesse_real"] += 1 if x.get("interesse") == "real" else 0
        elif x["tipo"] == "bounce":
            resumo["bounces"] += 1
        elif x["tipo"] == "nota":
            resumo["notas"] += 1
        elif x["tipo"] == "decisao":
            resumo["decisoes"] += 1
        elif x["tipo"] == "tarefa":
            resumo["tarefas"] += 1
        else:
            resumo["outros"] += 1
    return {
        "dia": d.isoformat(),
        "operador": op or None,
        "resumo": resumo,
        "itens": itens,
        "anterior": (d - timedelta(days=1)).isoformat(),
        "proximo": (d + timedelta(days=1)).isoformat(),
    }


@router.get("/diario/dias")
def diario_dias(dias: int = 30, operador: str = "", p: Principal = Depends(leitores)):
    """Contagem por dia (navegação/calendário): e-mails enviados, respostas e bounces.
    Agrupa em Python pelo dia local (não depende da base de fusos do Postgres)."""
    dias = max(1, min(int(dias or 30), 120))
    hoje = _dia("")
    ini, _ = _janela(hoje - timedelta(days=dias - 1))
    _, fim = _janela(hoje)
    op = _filtro_op(p, operador)
    f_lead = "and l.dono_email = %s" if op else ""
    prm = [op] if op else []
    with transacao() as cur:
        acoes = todos(
            cur,
            f"""select a.data_hora em, a.tipo_acao from acoes a join leads l on l.id = a.lead_id
                               where a.data_hora >= %s and a.data_hora < %s {f_lead}""",
            [ini, fim] + prm,
        )
        inter = todos(
            cur,
            f"""select i.data_interacao em, i.classe from interacoes i join leads l on l.id = i.lead_id
                               where i.data_interacao >= %s and i.data_interacao < %s and i.direcao = 'recebido'
                               {f_lead}""",
            [ini, fim] + prm,
        )
    tz = R.ZoneInfo(R.TZ_PADRAO)
    por_dia = {(hoje - timedelta(days=k)).isoformat(): {"emails": 0, "respostas": 0, "bounces": 0} for k in range(dias)}
    for a in acoes:
        c = por_dia.get(a["em"].astimezone(tz).date().isoformat())
        if c is None:
            continue
        if a["tipo_acao"] in ENVIOS:
            c["emails"] += 1
        elif a["tipo_acao"] == "email_nao_entregue":
            c["bounces"] += 1
    for i in inter:
        c = por_dia.get(i["em"].astimezone(tz).date().isoformat())
        if c is None:
            continue
        if i["classe"] == "bounce":
            c["bounces"] += 1
        else:
            c["respostas"] += 1
    return {"dias": [{"dia": k, **v} for k, v in sorted(por_dia.items())]}
