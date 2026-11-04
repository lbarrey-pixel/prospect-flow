"""Board: a visão do gestor sobre a prospecção (GET /board).

Dois recortes, que não se misturam:
- **Prospecção do bot** (coorte): leads que receberam pelo menos um e-mail do bot.
  Retorno = resposta humana recebida DEPOIS do primeiro envio daquele lead.
- **Carteira**: todos os leads do CRM por estágio, inclusive histórico importado.

"Proposta" = estágio `proposta_enviada` ou `convertido` (cliente fechado, marcado
pelo operador). Agrega em Python pelo dia local, como o diário.
"""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends

from . import regras as R
from . import servicos as S
from .auth import Principal, leitores
from .db import todos, transacao, um
from .rotas_diario import ENVIOS, _dia, _filtro_op, _janela

router = APIRouter()

ESTAGIOS = ["frio", "aquecendo", "respondeu", "qualificado", "proposta_enviada", "convertido", "descartado"]
QUALIFICADOS = {"qualificado", "proposta_enviada", "convertido"}
PROPOSTAS = {"proposta_enviada", "convertido"}
NAO_HUMANO = {"bounce", "auto_reply", "redirect"}


def _taxa(a: int, b: int) -> float | None:
    return round(a / b, 4) if b else None


def _rodada(a: dict) -> str:
    if a["tipo_acao"] == "mensagem_enviada" and a["rodada"] in (1, 2, 3):
        return f"R{a['rodada']}"
    return "outros"


@router.get("/board")
def board(dias: int = 30, operador: str = "", p: Principal = Depends(leitores)):
    dias = max(7, min(int(dias or 30), 180))
    hoje = _dia("")
    ini, _ = _janela(hoje - timedelta(days=dias - 1))
    _, fim = _janela(hoje)
    ini_ant = ini - timedelta(days=dias)
    op = _filtro_op(p, operador)
    f_lead = "and l.dono_email = %s" if op else ""
    f_op = "and operador = %s" if op else ""
    prm = [op] if op else []
    tz = R.ZoneInfo(R.TZ_PADRAO)

    with transacao() as cur:
        leads = todos(
            cur,
            f"""select l.id, l.dominio, l.empresa, l.dono_email, l.estagio_funil, l.estagio_mudou_em,
                                      l.proximo_followup_em, l.ultimo_contato_em
                               from leads l where true {f_lead}""",
            prm,
        )
        acoes = todos(
            cur,
            f"""select a.lead_id, a.tipo_acao, a.rodada, a.data_hora em from acoes a
                               join leads l on l.id = a.lead_id
                               where (a.tipo_acao = any(%s) or a.tipo_acao = 'email_nao_entregue') {f_lead}""",
            [list(ENVIOS)] + prm,
        )
        inter = todos(
            cur,
            f"""select i.lead_id, i.data_interacao em, i.classe, i.interesse, i.assunto, i.trecho
                               from interacoes i join leads l on l.id = i.lead_id
                               where i.direcao = 'recebido' and i.data_interacao is not null {f_lead}""",
            prm,
        )
        tarefas = todos(
            cur,
            f"""select status, tipo, count(*) n from tarefas
                                 where criada_em >= %s and criada_em < %s {f_op} group by 1, 2""",
            [ini, fim] + prm,
        )
        envios = todos(
            cur,
            f"""select status, count(*) n from envios
                                where criado_em >= %s and criado_em < %s {f_op} group by 1""",
            [ini, fim] + prm,
        )
        relatos = um(cur, f"select count(*) n from relatos where lido_em is null {f_op}", prm)["n"]
        campainhas = um(cur, f"select count(*) n from campainhas where ativa and arquivada_em is null {f_op}", prm)["n"]
        acomp = um(cur, f"select count(*) n from acompanhamentos where status = 'agendado' {f_op}", prm)["n"]
        ops = todos(cur, "select email, nome from operadores where ativo order by nome")

    por_id = {l["id"]: l for l in leads}
    primeiro_envio: dict[int, object] = {}
    for a in acoes:
        if a["tipo_acao"] in ENVIOS:
            pe = primeiro_envio.get(a["lead_id"])
            if pe is None or a["em"] < pe:
                primeiro_envio[a["lead_id"]] = a["em"]

    # Respostas humanas da coorte (depois do primeiro envio do bot).
    respostas = []
    for i in inter:
        pe = primeiro_envio.get(i["lead_id"])
        if pe is None or i["em"] < pe:
            continue
        if i["classe"] == "bounce":
            respostas.append({**i, "bounce": True})
        elif i["classe"] not in NAO_HUMANO:
            respostas.append({**i, "bounce": False})
    humanas = [r for r in respostas if not r["bounce"]]

    # Série diária e totais do período (e do período anterior, para a variação).
    serie = {(hoje - timedelta(days=k)).isoformat(): {"emails": 0, "respostas": 0, "bounces": 0} for k in range(dias)}
    per = {"emails": 0, "respostas": 0, "bounces": 0, "interesse_real": 0, "novos_leads": 0}
    ant = {"emails": 0, "respostas": 0, "bounces": 0, "interesse_real": 0, "novos_leads": 0}
    rodadas = {"R1": 0, "R2": 0, "R3": 0, "outros": 0}

    def conta(em, chave, extra=None):
        if ini <= em < fim:
            per[chave] += 1
            c = serie.get(em.astimezone(tz).date().isoformat())
            if c is not None and chave in c:
                c[chave] += 1
            if extra:
                extra()
        elif ini_ant <= em < ini:
            ant[chave] += 1

    for a in acoes:
        if a["tipo_acao"] in ENVIOS:
            conta(a["em"], "emails", lambda a=a: rodadas.__setitem__(_rodada(a), rodadas[_rodada(a)] + 1))
        else:
            conta(a["em"], "bounces")
    for r in respostas:
        if r["bounce"]:
            conta(r["em"], "bounces")
        else:
            conta(r["em"], "respostas")
            if r["interesse"] == "real":
                conta(r["em"], "interesse_real")
    for pe in primeiro_envio.values():
        conta(pe, "novos_leads")

    # Funil acumulado da coorte.
    coorte = set(primeiro_envio)
    # Cada etapa contém a seguinte: quem foi qualificado respondeu (mesmo que a
    # resposta não tenha ficado registrada como interação).
    qualif = {i for i in coorte if por_id[i]["estagio_funil"] in QUALIFICADOS}
    real = {r["lead_id"] for r in humanas if r["interesse"] == "real"} | qualif
    responderam = {r["lead_id"] for r in humanas} | real
    prop = {i for i in coorte if por_id[i]["estagio_funil"] in PROPOSTAS}
    conv = {i for i in coorte if por_id[i]["estagio_funil"] == "convertido"}
    emails_total = sum(1 for a in acoes if a["tipo_acao"] in ENVIOS)
    bounces_total = sum(1 for a in acoes if a["tipo_acao"] == "email_nao_entregue") + sum(1 for r in respostas if r["bounce"])
    funil = [
        {"etapa": "prospectados", "n": len(coorte)},
        {"etapa": "responderam", "n": len(responderam)},
        {"etapa": "interesse_real", "n": len(real)},
        {"etapa": "qualificados", "n": len(qualif)},
        {"etapa": "propostas", "n": len(prop)},
        {"etapa": "convertidos", "n": len(conv)},
    ]

    # Tempo até a primeira resposta (horas), mediana.
    prim_resp: dict[int, object] = {}
    for r in humanas:
        if r["lead_id"] not in prim_resp or r["em"] < prim_resp[r["lead_id"]]:
            prim_resp[r["lead_id"]] = r["em"]
    horas = sorted((prim_resp[i] - primeiro_envio[i]).total_seconds() / 3600 for i in prim_resp)
    mediana_h = round(horas[len(horas) // 2], 1) if horas else None

    # Carteira (todos os leads).
    carteira = {e: 0 for e in ESTAGIOS}
    for l in leads:
        carteira[l["estagio_funil"]] = carteira.get(l["estagio_funil"], 0) + 1

    # Por operador.
    linhas = []
    for o in ops:
        if op and o["email"] != op:
            continue
        mine = {l["id"] for l in leads if l["dono_email"] == o["email"]}
        c = coorte & mine
        linhas.append(
            {
                "operador": o["email"],
                "nome": o["nome"],
                "carteira": len(mine),
                "prospectados": len(c),
                "emails": sum(1 for a in acoes if a["tipo_acao"] in ENVIOS and a["lead_id"] in mine),
                "emails_periodo": sum(
                    1 for a in acoes if a["tipo_acao"] in ENVIOS and a["lead_id"] in mine and ini <= a["em"] < fim
                ),
                "responderam": len(responderam & c),
                "taxa_retorno": _taxa(len(responderam & c), len(c)),
                "qualificados": len(qualif & c),
                "propostas": len(prop & c),
                "convertidos": len(conv & c),
                "convertidos_carteira": sum(1 for i in mine if por_id[i]["estagio_funil"] == "convertido"),
            }
        )

    # Leads quentes: última resposta humana da coorte, estágios ainda em jogo.
    ult: dict[int, dict] = {}
    for r in humanas:
        if r["lead_id"] not in ult or r["em"] > ult[r["lead_id"]]["em"]:
            ult[r["lead_id"]] = r
    quentes = []
    for lid, r in sorted(
        ult.items(),
        key=lambda kv: (kv[1]["interesse"] == "real" or por_id[kv[0]]["estagio_funil"] in QUALIFICADOS, kv[1]["em"]),
        reverse=True,
    ):
        l = por_id[lid]
        if l["estagio_funil"] in ("descartado", "convertido"):
            continue
        quentes.append(
            {
                "dominio": l["dominio"],
                "empresa": l["empresa"],
                "operador": l["dono_email"],
                "estagio": l["estagio_funil"],
                "interesse": r["interesse"],
                "respondeu_em": r["em"],
                "assunto": r["assunto"],
                "trecho": (r["trecho"] or "")[:180] or None,
                "proximo_followup_em": l["proximo_followup_em"],
            }
        )
        if len(quentes) == 8:
            break
    convertidos = sorted(
        (l for l in leads if l["estagio_funil"] == "convertido"),
        key=lambda l: l["estagio_mudou_em"] or l["ultimo_contato_em"] or ini,
        reverse=True,
    )[:6]

    t_status: dict[str, int] = {}
    t_tipo: dict[str, int] = {}
    for t in tarefas:
        t_status[t["status"]] = t_status.get(t["status"], 0) + t["n"]
        t_tipo[t["tipo"]] = t_tipo.get(t["tipo"], 0) + t["n"]
    agora_ = S.agora()
    followups_7d = sum(
        1
        for l in leads
        if l["proximo_followup_em"]
        and l["estagio_funil"] not in ("descartado", "convertido")
        and l["proximo_followup_em"] < agora_ + timedelta(days=7)
    )

    return {
        "operador": op or None,
        "dias": dias,
        "de": (hoje - timedelta(days=dias - 1)).isoformat(),
        "ate": hoje.isoformat(),
        "inicio_prospeccao": min(primeiro_envio.values()) if primeiro_envio else None,
        "periodo": {
            **per,
            "rodadas": rodadas,
            "taxa_bounce": _taxa(per["bounces"], per["emails"]),
            "taxa_resposta": _taxa(per["respostas"], per["emails"]),
        },
        "anterior": {
            **ant,
            "taxa_bounce": _taxa(ant["bounces"], ant["emails"]),
            "taxa_resposta": _taxa(ant["respostas"], ant["emails"]),
        },
        "acumulado": {
            "emails": emails_total,
            "bounces": bounces_total,
            "taxa_bounce": _taxa(bounces_total, emails_total),
            "taxa_retorno": _taxa(len(responderam), len(coorte)),
            "taxa_qualificacao": _taxa(len(qualif), len(responderam)),
            "taxa_proposta": _taxa(len(prop), len(responderam)),
            "taxa_conversao": _taxa(len(conv), len(coorte)),
            "mediana_horas_ate_resposta": mediana_h,
        },
        "funil": funil,
        "carteira": {"total": len(leads), "estagios": carteira},
        "serie": [{"dia": k, **v} for k, v in sorted(serie.items())],
        "operadores": linhas,
        "operacao": {
            "tarefas_status": t_status,
            "tarefas_tipo": t_tipo,
            "envios_status": {e["status"]: e["n"] for e in envios},
            "relatos_nao_lidos": relatos,
            "campainhas_ativas": campainhas,
            "acompanhamentos_agendados": acomp,
            "followups_7d": followups_7d,
        },
        "quentes": quentes,
        "convertidos_recentes": [
            {"dominio": l["dominio"], "empresa": l["empresa"], "operador": l["dono_email"], "em": l["estagio_mudou_em"]}
            for l in convertidos
        ],
    }
