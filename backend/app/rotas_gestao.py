"""Campainhas, acompanhamentos, relatos e diretrizes.

As mesmas operações servem o operador (painel) e o bot (`/bot/...`): a
credencial decide o alcance. O bot cria/edita/arquiva as próprias campainhas e
acompanhamentos, reporta por relatos e PROPÕE diretrizes; aprovar diretriz é
sempre do operador (dono ou admin), nunca do bot.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field

from . import servicos as S
from .auth import Principal, humano_ou_bot, leitores, so_bot, so_operador
from .db import jsonb, todos, transacao, um

router = APIRouter()


def rota_dupla(metodo: str, caminho: str):
    """Registra a mesma função em `/x` (painel) e `/bot/x` (chave do bot).

    A operação é uma só; o que muda é o alcance, e isso quem decide é a
    credencial (`Principal`), não o caminho.
    """

    def decorar(fn):
        registrar = getattr(router, metodo)
        registrar(caminho)(fn)
        registrar("/bot" + caminho)(fn)
        return fn

    return decorar


def _operador_alvo(p: Principal, informado: str | None) -> str:
    if p.tipo == "bot":
        return p.operador
    op = (informado or p.operador or "").lower()
    S.exige_editar(p, op, "Operador")
    return op


def _lead_id(cur, dominio: str | None, p: Principal) -> int | None:
    if not dominio:
        return None
    lead = S.lead_ou_404(cur, dominio)
    S.exige_ver(p, lead)
    return lead["id"]


def _lista(cur, tabela: str, p: Principal, operador: str, extra: str = "", params: list | None = None):
    filtros, prm = [], list(params or [])
    op = p.operador if p.tipo == "bot" else (operador or "").lower()
    if op:
        filtros.append("x.operador = %s")
        prm.insert(0, op)
    if extra:
        filtros.append(extra)
    where = ("where " + " and ".join(filtros)) if filtros else ""
    return todos(
        cur,
        f"""select x.*, l.dominio from {tabela} x left join leads l on l.id = x.lead_id
                          {where} order by x.criad{'a' if tabela == 'campainhas' else 'o'}_em desc limit 500""",
        prm,
    )


# ── Campainhas ──────────────────────────────────────────────────────────────
class CampainhaNova(BaseModel):
    nome: str = Field(min_length=3, max_length=120)
    tipo: str = Field(pattern="^(dominio|remetente|assunto)$")
    padrao: str = Field(min_length=2, max_length=300)
    caixa: str | None = None
    prioridade: str = Field("urgente", pattern="^(normal|urgente)$")
    instrucao: str | None = None
    dominio: str | None = None
    expira_em: datetime | None = None
    operador: str | None = None


class CampainhaPatch(BaseModel):
    nome: str | None = None
    padrao: str | None = None
    caixa: str | None = None
    prioridade: str | None = Field(None, pattern="^(normal|urgente)$")
    instrucao: str | None = None
    ativa: bool | None = None
    expira_em: datetime | None = None


@rota_dupla("get", "/campainhas")
def campainhas(operador: str = "", ativas: int = 0, p: Principal = Depends(leitores)):
    with transacao() as cur:
        extra = "x.arquivada_em is null and x.ativa" if ativas else ""
        return {"campainhas": _lista(cur, "campainhas", p, operador, extra)}


@rota_dupla("post", "/campainhas")
def campainha_criar(body: CampainhaNova, p: Principal = Depends(humano_ou_bot)):
    op = _operador_alvo(p, body.operador)
    with transacao() as cur:
        c = um(
            cur,
            """insert into campainhas (operador, nome, tipo, padrao, caixa, prioridade, instrucao, lead_id,
                                               expira_em, criada_por, criada_por_tipo)
                       values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) returning *""",
            (
                op,
                body.nome,
                body.tipo,
                body.padrao.strip().lower(),
                body.caixa,
                body.prioridade,
                body.instrucao,
                _lead_id(cur, body.dominio, p),
                body.expira_em,
                p.ator,
                p.tipo,
            ),
        )
        S.evento(cur, p, "criou", "campainha", c["id"], op, body.model_dump(exclude_none=True, mode="json"))
    return c


def _campainha(cur, cid: str, p: Principal) -> dict:
    c = um(cur, "select * from campainhas where id = %s", (cid,))
    if not c:
        raise HTTPException(404, "Campainha não encontrada.")
    S.exige_editar(p, c["operador"], "Campainha")
    return c


@rota_dupla("patch", "/campainhas/{cid}")
def campainha_alterar(cid: str, body: CampainhaPatch, p: Principal = Depends(humano_ou_bot)):
    mud = body.model_dump(exclude_none=True)
    if not mud:
        raise HTTPException(400, "Nada para alterar.")
    if "padrao" in mud:
        mud["padrao"] = mud["padrao"].strip().lower()
    with transacao() as cur:
        c = _campainha(cur, cid, p)
        sets = ", ".join(f"{k} = %s" for k in mud)
        novo = um(cur, f"update campainhas set {sets} where id = %s returning *", list(mud.values()) + [cid])
        S.evento(cur, p, "alterou", "campainha", cid, c["operador"], body.model_dump(exclude_none=True, mode="json"))
    return novo


@rota_dupla("delete", "/campainhas/{cid}")
def campainha_arquivar(cid: str, p: Principal = Depends(humano_ou_bot)):
    """Arquiva (não apaga): o histórico de disparos continua visível."""
    with transacao() as cur:
        c = _campainha(cur, cid, p)
        cur.execute(
            """update campainhas set ativa = false, arquivada_em = now(), arquivada_por = %s
                       where id = %s""",
            (p.ator, cid),
        )
        S.evento(cur, p, "arquivou", "campainha", cid, c["operador"], {"nome": c["nome"]})
    return {"ok": True}


@router.get("/campainhas/{cid}/disparos")
def campainha_disparos(cid: str, p: Principal = Depends(leitores)):
    with transacao() as cur:
        c = um(cur, "select operador from campainhas where id = %s", (cid,))
        if not c or not p.pode_ver(c["operador"]):
            raise HTTPException(404, "Campainha não encontrada.")
        return {
            "disparos": todos(
                cur,
                """select * from campainha_disparos where campainha_id = %s
                                          order by criado_em desc limit 200""",
                (cid,),
            )
        }


# ── Acompanhamentos ─────────────────────────────────────────────────────────
class AcompNovo(BaseModel):
    titulo: str = Field(min_length=3, max_length=200)
    instrucao: str | None = None
    agendado_para: datetime
    repetir_dias: int | None = Field(None, ge=1, le=365)
    dominio: str | None = None
    operador: str | None = None


class AcompPatch(BaseModel):
    titulo: str | None = None
    instrucao: str | None = None
    agendado_para: datetime | None = None
    repetir_dias: int | None = Field(None, ge=1, le=365)
    status: str | None = Field(None, pattern="^(agendado|concluido|cancelado)$")


@rota_dupla("get", "/acompanhamentos")
def acompanhamentos(operador: str = "", status: str = "", p: Principal = Depends(leitores)):
    with transacao() as cur:
        extra, prm = ("x.status = any(%s)", [status.split(",")]) if status else ("", [])
        return {"acompanhamentos": _lista(cur, "acompanhamentos", p, operador, extra, prm)}


@rota_dupla("post", "/acompanhamentos")
def acomp_criar(body: AcompNovo, p: Principal = Depends(humano_ou_bot)):
    op = _operador_alvo(p, body.operador)
    with transacao() as cur:
        a = um(
            cur,
            """insert into acompanhamentos (operador, lead_id, titulo, instrucao, agendado_para, repetir_dias,
                                                    criado_por, criado_por_tipo)
                       values (%s,%s,%s,%s,%s,%s,%s,%s) returning *""",
            (
                op,
                _lead_id(cur, body.dominio, p),
                body.titulo,
                body.instrucao,
                body.agendado_para,
                body.repetir_dias,
                p.ator,
                p.tipo,
            ),
        )
        S.evento(cur, p, "criou", "acompanhamento", a["id"], op, body.model_dump(exclude_none=True, mode="json"))
    return a


def _acomp(cur, aid: str, p: Principal) -> dict:
    a = um(cur, "select * from acompanhamentos where id = %s", (aid,))
    if not a:
        raise HTTPException(404, "Acompanhamento não encontrado.")
    S.exige_editar(p, a["operador"], "Acompanhamento")
    return a


@rota_dupla("patch", "/acompanhamentos/{aid}")
def acomp_alterar(aid: str, body: AcompPatch, p: Principal = Depends(humano_ou_bot)):
    mud = body.model_dump(exclude_none=True)
    if not mud:
        raise HTTPException(400, "Nada para alterar.")
    with transacao() as cur:
        a = _acomp(cur, aid, p)
        sets = ", ".join(f"{k} = %s" for k in mud)
        novo = um(cur, f"update acompanhamentos set {sets} where id = %s returning *", list(mud.values()) + [aid])
        S.evento(cur, p, "alterou", "acompanhamento", aid, a["operador"], body.model_dump(exclude_none=True, mode="json"))
    return novo


@rota_dupla("delete", "/acompanhamentos/{aid}")
def acomp_cancelar(aid: str, p: Principal = Depends(humano_ou_bot)):
    with transacao() as cur:
        a = _acomp(cur, aid, p)
        cur.execute("update acompanhamentos set status = 'cancelado' where id = %s", (aid,))
        S.evento(cur, p, "cancelou", "acompanhamento", aid, a["operador"], {"titulo": a["titulo"]})
    return {"ok": True}


# ── Relatos ─────────────────────────────────────────────────────────────────
class RelatoNovo(BaseModel):
    tipo: str = Field(pattern="^(info|alerta|pergunta|pedido_autorizacao)$")
    titulo: str = Field(min_length=3, max_length=200)
    corpo: str | None = Field(None, max_length=10000)
    dominio: str | None = None
    tarefa_id: str | None = None
    urgente: bool = False


@router.post("/bot/relatos")
def relato_criar(body: RelatoNovo, p: Principal = Depends(so_bot)):
    with transacao() as cur:
        return S.criar_relato(
            cur,
            p,
            operador=p.operador,
            tipo=body.tipo,
            titulo=body.titulo,
            corpo=body.corpo,
            lead_id=_lead_id(cur, body.dominio, p),
            tarefa_id=body.tarefa_id,
            urgente=body.urgente,
        )


@rota_dupla("get", "/relatos")
def relatos(operador: str = "", nao_lidos: int = 0, respondidos: int = 0, p: Principal = Depends(leitores)):
    filtros, prm = [], []
    op = p.operador if p.tipo == "bot" else operador.lower()
    if op:
        filtros.append("r.operador = %s")
        prm.append(op)
    if nao_lidos:
        filtros.append("r.lido_em is null")
    if respondidos:
        filtros.append("r.resposta is not null")
    where = ("where " + " and ".join(filtros)) if filtros else ""
    with transacao() as cur:
        return {
            "relatos": todos(
                cur,
                f"""select r.*, l.dominio from relatos r left join leads l on l.id = r.lead_id
                                          {where} order by r.criado_em desc limit 300""",
                prm,
            )
        }


def _relato(cur, rid: str, p: Principal) -> dict:
    r = um(cur, "select * from relatos where id = %s", (rid,))
    if not r:
        raise HTTPException(404, "Relato não encontrado.")
    S.exige_editar(p, r["operador"], "Relato")
    return r


@router.post("/relatos/{rid}/lido")
def relato_lido(rid: str, p: Principal = Depends(so_operador)):
    with transacao() as cur:
        r = _relato(cur, rid, p)
        cur.execute("update relatos set lido_em = coalesce(lido_em, now()) where id = %s", (rid,))
        S.evento(cur, p, "leu", "relato", rid, r["operador"])
    return {"ok": True}


class Resposta(BaseModel):
    resposta: str = Field(min_length=1, max_length=10000)


@router.post("/relatos/{rid}/responder")
def relato_responder(rid: str, body: Resposta, bg: BackgroundTasks, p: Principal = Depends(so_operador)):
    with transacao() as cur:
        r = _relato(cur, rid, p)
        cur.execute(
            """update relatos set resposta = %s, respondido_em = now(), respondido_por = %s,
                       lido_em = coalesce(lido_em, now()) where id = %s""",
            (body.resposta, p.ator, rid),
        )
        S.evento(cur, p, "respondeu", "relato", rid, r["operador"], {"resposta": body.resposta[:500]})
        t = S.criar_tarefa(
            cur,
            p,
            operador=r["operador"],
            tipo="resposta_operador",
            origem="operador",
            titulo=f"Resposta do operador: {r['titulo'][:120]}",
            lead_id=r["lead_id"],
            relato_id=rid,
            prioridade="urgente" if r["urgente"] else "normal",
            payload={
                "relato": {"id": rid, "tipo": r["tipo"], "titulo": r["titulo"], "corpo": r["corpo"]},
                "resposta": body.resposta,
                "respondido_por": p.ator,
            },
        )
    from .rotas_tarefas import _entregar

    bg.add_task(_entregar, t["id"])
    return {"ok": True, "tarefa_id": t["id"]}


# ── Diretrizes ──────────────────────────────────────────────────────────────
def _ativa(cur, operador: str | None) -> dict | None:
    """Ativa do operador; se não houver, a padrão da casa."""
    d = um(cur, "select * from diretrizes where operador = %s and status = 'ativa'", (operador,)) if operador else None
    return d or um(cur, "select * from diretrizes where operador is null and status = 'ativa'")


def _proxima_versao(cur, operador: str | None) -> int:
    r = um(cur, "select coalesce(max(versao), 0) + 1 v from diretrizes where operador is not distinct from %s", (operador,))
    return r["v"]


@router.get("/diretrizes")
def diretrizes(operador: str = "", p: Principal = Depends(leitores)):
    with transacao() as cur:
        if operador:
            linhas = todos(
                cur,
                """select * from diretrizes where operador = %s or operador is null
                                   order by operador nulls last, versao desc""",
                (operador.lower(),),
            )
        else:
            linhas = todos(cur, "select * from diretrizes order by operador nulls first, versao desc")
    return {"diretrizes": linhas}


@router.get("/diretrizes/{did}")
def diretriz(did: str, p: Principal = Depends(leitores)):
    with transacao() as cur:
        d = um(cur, "select * from diretrizes where id = %s", (did,))
        if not d:
            raise HTTPException(404, "Versão não encontrada.")
        base = None
        if d["base_versao"]:
            base = um(
                cur,
                """select id, versao, conteudo, regras from diretrizes
                              where operador is not distinct from %s and versao = %s""",
                (d["operador"], d["base_versao"]),
            )
            if not base and d["operador"]:
                base = um(
                    cur,
                    "select id, versao, conteudo, regras from diretrizes where operador is null and versao = %s",
                    (d["base_versao"],),
                )
    return {**d, "base": base}


@router.get("/bot/diretrizes")
def bot_diretrizes(p: Principal = Depends(so_bot)):
    with transacao() as cur:
        d = _ativa(cur, p.operador)
        regras = S.regras_do_operador(cur, p.operador)
    if not d:
        raise HTTPException(404, "Nenhuma diretriz ativa.")
    return {
        "id": d["id"],
        "operador": d["operador"],
        "versao": d["versao"],
        "conteudo": d["conteudo"],
        "regras": regras,
        "aprovada_por": d["decidida_por"],
        "aprovada_em": d["decidida_em"],
    }


class PropostaDiretriz(BaseModel):
    conteudo: str | None = Field(None, min_length=50)
    regras: dict | None = None
    motivo: str = Field(min_length=10, max_length=4000)
    base_versao: int | None = None


@router.post("/bot/diretrizes/propostas")
def bot_propor(body: PropostaDiretriz, p: Principal = Depends(so_bot)):
    """O bot propõe; só vale depois que o operador aprovar no painel."""
    if not body.conteudo and not body.regras:
        raise HTTPException(400, "Mande `conteudo` e/ou `regras`.")
    with transacao() as cur:
        atual = _ativa(cur, p.operador)
        d = um(
            cur,
            """insert into diretrizes (operador, versao, status, conteudo, regras, autor, autor_tipo, motivo, base_versao)
                       values (%s,%s,'proposta',%s,%s,%s,'bot',%s,%s) returning *""",
            (
                p.operador,
                _proxima_versao(cur, p.operador),
                body.conteudo or (atual or {}).get("conteudo") or "",
                jsonb(body.regras),
                p.ator,
                body.motivo,
                body.base_versao or (atual or {}).get("versao"),
            ),
        )
        S.evento(cur, p, "propos", "diretriz", d["id"], p.operador, {"versao": d["versao"], "motivo": body.motivo})
        S.criar_relato(
            cur,
            p,
            operador=p.operador,
            tipo="pedido_autorizacao",
            urgente=False,
            titulo=f"Proposta de diretriz v{d['versao']}",
            corpo=body.motivo,
        )
    return d


@router.get("/bot/diretrizes/propostas")
def bot_propostas(p: Principal = Depends(so_bot)):
    with transacao() as cur:
        return {
            "propostas": todos(
                cur,
                """select id, versao, status, motivo, base_versao, decidida_por, decidida_em,
                                                  nota_decisao, criada_em
                                           from diretrizes where operador = %s and autor_tipo = 'bot'
                                           order by versao desc""",
                (p.operador,),
            )
        }


class DiretrizNova(BaseModel):
    conteudo: str = Field(min_length=50)
    regras: dict | None = None
    motivo: str | None = None
    operador: str | None = None  # vazio = padrão da casa (só admin)


@router.post("/diretrizes")
def diretriz_publicar(body: DiretrizNova, p: Principal = Depends(so_operador)):
    op = (body.operador or "").lower() or None
    if op is None and not p.admin:
        raise HTTPException(403, "Só admin publica a diretriz padrão da casa.")
    if op:
        S.exige_editar(p, op, "Operador")
    with transacao() as cur:
        atual = _ativa(cur, op) if op else um(cur, "select * from diretrizes where operador is null and status = 'ativa'")
        d = um(
            cur,
            """insert into diretrizes (operador, versao, status, conteudo, regras, autor, autor_tipo, motivo,
                                               base_versao, decidida_por, decidida_em)
                       values (%s,%s,'proposta',%s,%s,%s,'operador',%s,%s,%s,now()) returning *""",
            (
                op,
                _proxima_versao(cur, op),
                body.conteudo,
                jsonb(body.regras),
                p.ator,
                body.motivo,
                (atual or {}).get("versao"),
                p.ator,
            ),
        )
        _ativar(cur, p, d, "publicada pelo operador")
    return d


def _ativar(cur, p: Principal, d: dict, nota: str | None):
    cur.execute(
        """update diretrizes set status = 'substituida'
                   where operador is not distinct from %s and status = 'ativa'""",
        (d["operador"],),
    )
    cur.execute(
        """update diretrizes set status = 'ativa', decidida_por = %s, decidida_em = now(), nota_decisao = %s
                   where id = %s""",
        (p.ator, nota, d["id"]),
    )
    if d["regras"] and d["operador"]:
        cur.execute("update operadores set regras = regras || %s where email = %s", (jsonb(d["regras"]), d["operador"]))
    S.evento(cur, p, "ativou", "diretriz", d["id"], d["operador"], {"versao": d["versao"], "nota": nota})


class Decisao(BaseModel):
    nota: str | None = None


def _proposta(cur, did: str, p: Principal) -> dict:
    d = um(cur, "select * from diretrizes where id = %s", (did,))
    if not d:
        raise HTTPException(404, "Versão não encontrada.")
    if d["operador"] is None and not p.admin:
        raise HTTPException(403, "Só admin decide a diretriz padrão da casa.")
    if d["operador"]:
        S.exige_editar(p, d["operador"], "Diretriz")
    if d["status"] != "proposta":
        raise HTTPException(409, f"Versão está '{d['status']}', não 'proposta'.")
    return d


@router.post("/diretrizes/{did}/aprovar")
def diretriz_aprovar(did: str, body: Decisao, p: Principal = Depends(so_operador)):
    with transacao() as cur:
        d = _proposta(cur, did, p)
        _ativar(cur, p, d, body.nota)
        if d["autor_tipo"] == "bot" and d["operador"]:
            S.criar_tarefa(
                cur,
                p,
                operador=d["operador"],
                tipo="resposta_operador",
                origem="operador",
                titulo=f"Diretriz v{d['versao']} aprovada",
                payload={"diretriz_id": str(d["id"]), "versao": d["versao"], "decisao": "aprovada", "nota": body.nota},
            )
    return {"ok": True}


@router.post("/diretrizes/{did}/rejeitar")
def diretriz_rejeitar(did: str, body: Decisao, p: Principal = Depends(so_operador)):
    with transacao() as cur:
        d = _proposta(cur, did, p)
        cur.execute(
            """update diretrizes set status = 'rejeitada', decidida_por = %s, decidida_em = now(), nota_decisao = %s
                       where id = %s""",
            (p.ator, body.nota, did),
        )
        S.evento(cur, p, "rejeitou", "diretriz", did, d["operador"], {"versao": d["versao"], "nota": body.nota})
        if d["autor_tipo"] == "bot" and d["operador"]:
            S.criar_tarefa(
                cur,
                p,
                operador=d["operador"],
                tipo="resposta_operador",
                origem="operador",
                titulo=f"Diretriz v{d['versao']} rejeitada",
                payload={"diretriz_id": str(d["id"]), "versao": d["versao"], "decisao": "rejeitada", "nota": body.nota},
            )
    return {"ok": True}
