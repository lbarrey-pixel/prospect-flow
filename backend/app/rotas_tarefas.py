"""Quadro de tarefas e envios (visão do operador)."""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from . import regras as R
from . import servicos as S
from .auth import Principal, leitores, so_operador
from .db import todos, transacao, um

router = APIRouter()


def _filtro_operador(p: Principal, operador: str) -> str:
    return p.operador if p.tipo == "bot" else (operador or "").strip().lower()


@router.get("/tarefas")
def tarefas(
    operador: str = "",
    status: str = "",
    tipo: str = "",
    dominio: str = "",
    desde: str = "",
    limite: int = 200,
    p: Principal = Depends(leitores),
):
    filtros, params = [], []
    op = _filtro_operador(p, operador)
    if op:
        filtros.append("t.operador = %s")
        params.append(op)
    if status:
        filtros.append("t.status = any(%s)")
        params.append(status.split(","))
    if tipo:
        filtros.append("t.tipo = any(%s)")
        params.append(tipo.split(","))
    if dominio:
        filtros.append("l.dominio = %s")
        params.append(dominio.lower())
    if desde:
        filtros.append("t.criada_em >= %s::timestamptz")
        params.append(desde)
    where = ("where " + " and ".join(filtros)) if filtros else ""
    with transacao() as cur:
        linhas = todos(
            cur,
            f"""select t.*, l.dominio from tarefas t left join leads l on l.id = t.lead_id
                               {where} order by t.criada_em desc limit %s""",
            params + [max(1, min(limite, 1000))],
        )
        contagem = todos(
            cur,
            f"""select t.status, count(*) n from tarefas t left join leads l on l.id = t.lead_id
                                  {where} group by 1""",
            params,
        )
    return {"tarefas": linhas, "contagem": {c["status"]: c["n"] for c in contagem}}


def _tarefa_ou_404(cur, tarefa_id: str) -> dict:
    t = um(cur, "select t.*, l.dominio from tarefas t left join leads l on l.id = t.lead_id where t.id = %s", (tarefa_id,))
    if not t:
        raise HTTPException(404, "Tarefa não encontrada.")
    return t


@router.get("/tarefas/{tarefa_id}")
def tarefa(tarefa_id: str, p: Principal = Depends(leitores)):
    with transacao() as cur:
        t = _tarefa_ou_404(cur, tarefa_id)
        if not p.pode_ver(t["operador"]):
            raise HTTPException(403, "Tarefa de outro operador.")
        t["eventos"] = todos(
            cur,
            "select *, em as criado_em, acao as resumo from eventos where entidade = 'tarefa' and entidade_id = %s order by em",
            (tarefa_id,),
        )
        t["envios"] = todos(cur, "select * from envios where tarefa_id = %s order by criado_em", (tarefa_id,))
    return t


class NovaTarefa(BaseModel):
    operador: str
    tipo: str = "pergunta"
    titulo: str
    instrucao: str | None = None
    dominio: str | None = None
    prioridade: str = "normal"


@router.post("/tarefas")
def tarefa_criar(body: NovaTarefa, bg: BackgroundTasks, p: Principal = Depends(so_operador)):
    S.exige_editar(p, body.operador.lower(), "Operador")
    with transacao() as cur:
        lead = S.lead_ou_404(cur, body.dominio) if body.dominio else None
        payload = {"instrucao": body.instrucao, "origem": "operador"}
        if lead:
            payload["leads"] = [S.contexto_lead(cur, lead)]
        t = S.criar_tarefa(
            cur,
            p,
            operador=body.operador.lower(),
            tipo=body.tipo,
            titulo=body.titulo,
            payload=payload,
            origem="operador",
            prioridade=body.prioridade if body.prioridade in ("normal", "urgente") else "normal",
            lead_id=lead["id"] if lead else None,
        )
    bg.add_task(_entregar, t["id"])
    return t


def _entregar(tarefa_id):
    with transacao() as cur:
        t = um(cur, "select * from tarefas where id = %s and status = 'pendente'", (tarefa_id,))
        if t:
            S.entregar_webhook(cur, t)


class Motivo(BaseModel):
    motivo: str | None = None
    nota: str | None = None  # o painel manda `nota` na liberação

    def texto(self):
        return self.motivo or self.nota


@router.post("/tarefas/{tarefa_id}/cancelar")
def tarefa_cancelar(tarefa_id: str, body: Motivo, p: Principal = Depends(so_operador)):
    with transacao() as cur:
        t = _tarefa_ou_404(cur, tarefa_id)
        S.exige_editar(p, t["operador"], "Tarefa")
        if t["status"] in S.STATUS_FINAIS:
            raise HTTPException(409, f"Tarefa já está '{t['status']}'.")
        cur.execute(
            """update tarefas set status = 'cancelada', concluida_em = now(), motivo = 'cancelada_operador',
                       detalhe = %s where id = %s""",
            (body.motivo, tarefa_id),
        )
        S.evento(cur, p, "cancelou", "tarefa", tarefa_id, t["operador"], {"motivo": body.motivo})
    return {"ok": True}


@router.post("/tarefas/{tarefa_id}/reenviar")
def tarefa_reenviar(tarefa_id: str, bg: BackgroundTasks, p: Principal = Depends(so_operador)):
    with transacao() as cur:
        t = _tarefa_ou_404(cur, tarefa_id)
        S.exige_editar(p, t["operador"], "Tarefa")
        cur.execute(
            """update tarefas set status = 'pendente', tentativas_entrega = 0, ultimo_erro_entrega = null,
                       entregue_em = null, concluida_em = null where id = %s""",
            (tarefa_id,),
        )
        S.evento(cur, p, "reenviou", "tarefa", tarefa_id, t["operador"], {"status_anterior": t["status"]})
    bg.add_task(_entregar, tarefa_id)
    return {"ok": True}


# ── Envios ──────────────────────────────────────────────────────────────────
@router.get("/envios")
def envios(operador: str = "", status: str = "", desde: str = "", limite: int = 200, p: Principal = Depends(leitores)):
    filtros, params = [], []
    op = _filtro_operador(p, operador)
    if op:
        filtros.append("e.operador = %s")
        params.append(op)
    if status:
        filtros.append("e.status = any(%s)")
        params.append(status.split(","))
    if desde:
        filtros.append("e.criado_em >= %s::timestamptz")
        params.append(desde)
    where = ("where " + " and ".join(filtros)) if filtros else ""
    with transacao() as cur:
        return {
            "envios": todos(
                cur,
                f"""select e.*, l.dominio from envios e join leads l on l.id = e.lead_id
                                        {where} order by e.criado_em desc limit %s""",
                params + [max(1, min(limite, 1000))],
            )
        }


def _envio_ou_404(cur, envio_id: str) -> dict:
    e = um(cur, "select * from envios where id = %s", (envio_id,))
    if not e:
        raise HTTPException(404, "Envio não encontrado.")
    return e


@router.post("/envios/{envio_id}/liberar")
def envio_liberar(envio_id: str, body: Motivo, p: Principal = Depends(so_operador)):
    """Exceção humana: o operador libera um envio que as regras dele barraram."""
    with transacao() as cur:
        e = _envio_ou_404(cur, envio_id)
        S.exige_editar(p, e["operador"], "Envio")
        if e["status"] != "bloqueado":
            raise HTTPException(409, f"Envio está '{e['status']}', não 'bloqueado'.")
        regras = S.regras_do_operador(cur, e["operador"])
        quando = R.proxima_janela(S.agora(), regras)
        status = "agendado" if quando > S.agora() else "aprovado"
        rodada = e["rodada"] or R.TIPOS_RODADA.get(e["tipo_envio"])
        cur.execute(
            """update envios set status = %s, enviar_apos = %s, liberado_por = %s, rodada = %s
                       where id = %s""",
            (status, quando if status == "agendado" else None, p.ator, rodada, envio_id),
        )
        S.evento(
            cur,
            p,
            "liberou",
            "envio",
            envio_id,
            e["operador"],
            {"motivo_bloqueio": e["motivo_bloqueio"], "justificativa": body.texto()},
        )
    return {"ok": True, "status": status}


@router.post("/envios/{envio_id}/cancelar")
def envio_cancelar(envio_id: str, body: Motivo, p: Principal = Depends(so_operador)):
    with transacao() as cur:
        e = _envio_ou_404(cur, envio_id)
        S.exige_editar(p, e["operador"], "Envio")
        if e["status"] in ("enviado", "enviando"):
            raise HTTPException(409, f"Envio já está '{e['status']}'.")
        cur.execute("update envios set status = 'cancelado' where id = %s", (envio_id,))
        S.evento(cur, p, "cancelou", "envio", envio_id, e["operador"], {"motivo": body.motivo})
    return {"ok": True}
