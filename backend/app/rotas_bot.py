"""O lado do bot: fila de tarefas, resultado (decisão) e webhook."""

from __future__ import annotations

import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import servicos as S
from .auth import Principal, so_bot
from .db import jsonb, todos, transacao, um

router = APIRouter(prefix="/bot")

STATUS_RESULTADO = ("executou", "parcial", "adiou", "recusou", "bloqueado_humano")


@router.get("/tarefas")
def minhas_tarefas(status: str = "pendente,entregue", limite: int = 50, p: Principal = Depends(so_bot)):
    """A fila. Ao listar, `pendente` vira `entregue` (o bot já viu)."""
    with transacao() as cur:
        linhas = todos(
            cur,
            """select t.*, l.dominio from tarefas t left join leads l on l.id = t.lead_id
                               where t.operador = %s and t.status = any(%s)
                               order by (t.prioridade = 'urgente') desc, t.criada_em limit %s""",
            (p.operador, status.split(","), max(1, min(limite, 200))),
        )
        pend = [t["id"] for t in linhas if t["status"] == "pendente"]
        if pend:
            cur.execute(
                """update tarefas set status = 'entregue', entregue_em = now()
                           where id = any(%s) and status = 'pendente'""",
                (pend,),
            )
            for tid in pend:
                S.evento(cur, p, "puxou", "tarefa", tid, p.operador)
    return {"tarefas": linhas}


def _minha(cur, tarefa_id: str, p: Principal) -> dict:
    t = um(cur, "select * from tarefas where id = %s for update", (tarefa_id,))
    if not t or t["operador"] != p.operador:
        raise HTTPException(404, "Tarefa não encontrada.")
    return t


@router.post("/tarefas/{tarefa_id}/iniciar")
def iniciar(tarefa_id: str, p: Principal = Depends(so_bot)):
    with transacao() as cur:
        t = _minha(cur, tarefa_id, p)
        if t["status"] not in ("pendente", "entregue"):
            raise HTTPException(409, f"Tarefa está '{t['status']}'.")
        cur.execute(
            """update tarefas set status = 'em_andamento', iniciada_em = now(),
                       entregue_em = coalesce(entregue_em, now()) where id = %s""",
            (tarefa_id,),
        )
        S.evento(cur, p, "iniciou", "tarefa", tarefa_id, p.operador)
    return {"ok": True}


class Rascunho(BaseModel):
    para: str
    assunto: str
    corpo_html: str
    anexos: list[str] = []
    in_reply_to: str | None = None
    enviar_apos: datetime | None = None


class Decisao(BaseModel):
    dominio: str
    decisao: str = Field(pattern="^(executou|adiou|recusou)$")
    motivo: str | None = None
    detalhe: str | None = Field(None, max_length=2000)
    tipo_envio: str | None = None
    rascunho: Rascunho | None = None
    proxima_acao_em: datetime | None = None
    estagio_sugerido: str | None = None


class Resultado(BaseModel):
    status: str
    motivo: str | None = None
    detalhe: str | None = Field(None, max_length=4000)
    reagendar_em: datetime | None = None
    decisoes: list[Decisao] = []


@router.post("/tarefas/{tarefa_id}/resultado")
def resultado(tarefa_id: str, body: Resultado, p: Principal = Depends(so_bot)):
    if body.status not in STATUS_RESULTADO:
        raise HTTPException(422, f"status deve ser um de: {', '.join(STATUS_RESULTADO)}")
    if body.status == "adiou" and not body.reagendar_em:
        raise HTTPException(422, "`adiou` exige `reagendar_em`.")
    if body.status in ("recusou", "bloqueado_humano", "parcial") and not body.motivo:
        raise HTTPException(422, f"`{body.status}` exige `motivo`.")
    envios = []
    with transacao() as cur:
        t = _minha(cur, tarefa_id, p)
        if t["status"] in S.STATUS_FINAIS and t["status"] != "adiou":
            raise HTTPException(409, f"Tarefa já concluída como '{t['status']}'.")
        for d in body.decisoes:
            lead = S.lead_ou_404(cur, d.dominio)
            S.exige_editar(p, lead["dono_email"])
            if d.decisao == "executou" and d.rascunho:
                e = S.validar_e_gravar_envio(
                    cur,
                    p,
                    t,
                    p.operador,
                    lead,
                    {
                        "tipo_envio": d.tipo_envio,
                        "rascunho": d.rascunho.model_dump(mode="json"),
                        "proxima_acao_em": d.proxima_acao_em,
                    },
                )
                envios.append(
                    {
                        "id": e["id"],
                        "dominio": lead["dominio"],
                        "status": e["status"],
                        "motivo_bloqueio": e["motivo_bloqueio"],
                        "enviar_apos": e["enviar_apos"],
                    }
                )
            elif d.decisao in ("adiou", "recusou"):
                # Decisão sobre o lead fica na trilha do lead, mas NÃO conta como contato.
                cur.execute(
                    """insert into acoes (lead_id, tipo_acao, descricao, data_hora, proxima_acao_em, realizado_por, tarefa_id)
                               values (%s,%s,%s,now(),%s,%s,%s)""",
                    (
                        lead["id"],
                        f"bot_{d.decisao}",
                        f"{d.motivo or ''} – {d.detalhe or ''}".strip(" –"),
                        d.proxima_acao_em,
                        p.ator,
                        tarefa_id,
                    ),
                )
                if d.proxima_acao_em:
                    cur.execute("update leads set proximo_followup_em = %s where id = %s", (d.proxima_acao_em, lead["id"]))
            if d.estagio_sugerido:
                if d.estagio_sugerido in S.ESTAGIOS_BOT:
                    cur.execute(
                        """update leads set estagio_funil = %s, estagio_mudou_em = now() where id = %s
                                   and estagio_funil <> %s""",
                        (d.estagio_sugerido, lead["id"], d.estagio_sugerido),
                    )
                    S.evento(
                        cur,
                        p,
                        "mudou_estagio",
                        "lead",
                        lead["dominio"],
                        p.operador,
                        {"de": lead["estagio_funil"], "para": d.estagio_sugerido, "tarefa_id": tarefa_id},
                    )
                else:
                    S.criar_relato(
                        cur,
                        p,
                        operador=p.operador,
                        tipo="pergunta",
                        lead_id=lead["id"],
                        tarefa_id=tarefa_id,
                        titulo=f"Bot sugere {lead['dominio']} → {d.estagio_sugerido}",
                        corpo=d.detalhe,
                    )
        cur.execute(
            """update tarefas set status = %s, motivo = %s, detalhe = %s, resposta = %s, reagendar_em = %s,
                           concluida_em = case when %s = 'adiou' then null else now() end,
                           iniciada_em = coalesce(iniciada_em, now())
                       where id = %s""",
            (
                body.status,
                body.motivo,
                body.detalhe,
                jsonb(body.model_dump(mode="json")),
                body.reagendar_em,
                body.status,
                tarefa_id,
            ),
        )
        S.evento(
            cur,
            p,
            body.status,
            "tarefa",
            tarefa_id,
            p.operador,
            {"motivo": body.motivo, "detalhe": body.detalhe, "envios": len(envios)},
        )
        if body.status == "bloqueado_humano":
            S.criar_relato(
                cur,
                p,
                operador=p.operador,
                tipo="pedido_autorizacao",
                urgente=True,
                tarefa_id=tarefa_id,
                lead_id=t["lead_id"],
                titulo=f"Tarefa precisa de você: {t['titulo'][:120]}",
                corpo=f"Motivo: {body.motivo}. {body.detalhe or ''}",
            )
    return {"ok": True, "envios": envios}


class Webhook(BaseModel):
    url: str = Field(pattern=r"^https://")
    nome: str | None = None


@router.put("/webhook")
def webhook(body: Webhook, p: Principal = Depends(so_bot)):
    """Registra/troca a URL. O segredo HMAC é novo a cada troca e só aparece aqui."""
    segredo = secrets.token_urlsafe(32)
    with transacao() as cur:
        cur.execute(
            """insert into bots (operador, nome, webhook_url, webhook_segredo)
                       values (%s,%s,%s,%s)
                       on conflict (operador) do update set webhook_url = excluded.webhook_url,
                           webhook_segredo = excluded.webhook_segredo, nome = coalesce(%s, bots.nome)""",
            (p.operador, body.nome or p.ator, body.url, segredo, body.nome),
        )
        S.evento(cur, p, "registrou_webhook", "bot", p.operador, p.operador, {"url": body.url})
    return {
        "ok": True,
        "url": body.url,
        "segredo": segredo,
        "assinatura": "X-ProspectFlow-Assinatura: sha256=HMAC_SHA256(segredo, corpo_bruto)",
    }
