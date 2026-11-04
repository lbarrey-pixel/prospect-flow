"""Leads, painel, operadores e eventos."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from . import servicos as S
from .auth import Principal, humano_ou_bot, leitores, principal, so_operador
from .db import jsonb, todos, transacao, um

router = APIRouter()

ORDENAVEIS = {"ultimo_envio", "proximo_followup_em", "ultimo_contato_em", "atualizado_em", "criado_em", "dominio"}


def _operador_filtro(p: Principal, operador: str) -> str:
    """Bot só enxerga o próprio operador, sempre."""
    if p.tipo == "bot":
        return p.operador
    return (operador or "").strip().lower()


@router.get("/eu")
def eu(p: Principal = Depends(principal)):
    nome = None
    if p.operador:
        with transacao() as cur:
            op = um(cur, "select nome from operadores where email = %s", (p.operador,))
            nome = op["nome"] if op else None
    return {
        "email": p.ator if p.tipo == "operador" else None,
        "nome": nome or p.ator,
        "tipo": p.tipo,
        "admin": p.admin,
        "operador": p.operador,
    }


@router.get("/operadores")
def operadores(p: Principal = Depends(leitores)):
    with transacao() as cur:
        return {"operadores": todos(cur, "select email, nome, admin, caixa, bcc, regras, ativo from operadores order by nome")}


class OperadorPatch(BaseModel):
    regras: dict | None = None
    bcc: str | None = None
    caixa: str | None = None


@router.patch("/operadores/{email}")
def operador_alterar(email: str, body: OperadorPatch, p: Principal = Depends(so_operador)):
    email = email.lower()
    S.exige_editar(p, email, "Operador")
    with transacao() as cur:
        atual = um(cur, "select * from operadores where email = %s", (email,))
        if not atual:
            raise HTTPException(404, "Operador não encontrado.")
        novo = um(
            cur,
            """update operadores set regras = coalesce(%s, regras), bcc = coalesce(%s, bcc),
                          caixa = coalesce(%s, caixa) where email = %s returning *""",
            (jsonb({**(atual["regras"] or {}), **body.regras}) if body.regras else None, body.bcc, body.caixa, email),
        )
        S.evento(cur, p, "alterou", "operador", email, email, body.model_dump(exclude_none=True))
        return novo


@router.get("/leads")
def leads(
    operador: str = "",
    estagio: str = "",
    teve_resposta: int = -1,
    busca: str = "",
    limite: int = 100,
    offset: int = 0,
    ordenar: str = "proximo_followup_em",
    crescente: int = 1,
    p: Principal = Depends(leitores),
):
    limite = max(1, min(int(limite or 100), 500))
    coluna = ordenar if ordenar in ORDENAVEIS else "proximo_followup_em"
    filtros, params = [], []
    op = _operador_filtro(p, operador)
    if op:
        filtros.append("dono_email = %s")
        params.append(op)
    if estagio:
        filtros.append("estagio_funil = any(%s)")
        params.append([e.strip() for e in estagio.split(",")])
    if teve_resposta in (0, 1):
        filtros.append("teve_resposta = %s")
        params.append(bool(teve_resposta))
    if busca:
        filtros.append("(dominio ilike %s or empresa ilike %s)")
        params += [f"%{busca}%", f"%{busca}%"]
    where = ("where " + " and ".join(filtros)) if filtros else ""
    direcao = "asc" if int(crescente or 0) else "desc"
    with transacao() as cur:
        total = um(cur, f"select count(*) n from leads {where}", params)["n"]
        linhas = todos(
            cur,
            f"""select *, rodada_atual as rodada from leads {where} order by {coluna} {direcao} nulls first, id
                               limit %s offset %s""",
            params + [limite, max(0, int(offset or 0))],
        )
    return {"leads": linhas, "total": total, "limite": limite, "offset": offset}


@router.get("/leads/{dominio}")
def lead_detalhe(dominio: str, p: Principal = Depends(leitores)):
    with transacao() as cur:
        lead = S.lead_ou_404(cur, dominio)
        S.exige_ver(p, lead)
        lead["rodada"] = lead["rodada_atual"]
        return {
            "lead": lead,
            "contatos": todos(cur, "select * from contatos where lead_id = %s order by criado_em", (lead["id"],)),
            "interacoes": todos(
                cur,
                """select * from interacoes where lead_id = %s
                                        order by data_interacao desc nulls last limit 200""",
                (lead["id"],),
            ),
            "acoes": todos(cur, "select * from acoes where lead_id = %s order by data_hora desc limit 200", (lead["id"],)),
            "tarefas": todos(
                cur,
                """select id, tipo, status, titulo, motivo, criada_em, concluida_em from tarefas
                                     where lead_id = %s order by criada_em desc limit 50""",
                (lead["id"],),
            ),
            "envios": todos(
                cur,
                """select id, tipo_envio, rodada, para, assunto, status, motivo_bloqueio, enviado_em, criado_em
                                    from envios where lead_id = %s order by criado_em desc limit 50""",
                (lead["id"],),
            ),
        }


class ContatoPayload(BaseModel):
    canal: str = "email"
    direcao: str = "enviado"
    email: str | None = None
    nome: str | None = None
    telefone: str | None = None
    assunto: str | None = None
    trecho: str | None = None
    message_id: str | None = None


@router.post("/leads/{dominio}/contato")
def lead_contato(dominio: str, body: ContatoPayload, p: Principal = Depends(principal)):
    if p.tipo == "leitura":
        raise HTTPException(403, "Credencial só de leitura.")
    direcao = body.direcao if body.direcao in ("enviado", "recebido") else "enviado"
    with transacao() as cur:
        lead = S.lead_ou_404(cur, dominio)
        S.exige_editar(p, lead["dono_email"])
        r = S.registrar_contato(
            cur,
            p,
            lead,
            direcao=direcao,
            email=body.email,
            nome=body.nome,
            telefone=body.telefone,
            assunto=body.assunto,
            trecho=body.trecho,
            canal=body.canal,
            message_id=body.message_id,
            classe="humano" if direcao == "recebido" else None,
        )
    return {"ok": True, "lead_id": lead["id"], **r}


class EstagioPayload(BaseModel):
    estagio_funil: str
    proximo_followup_em: str | None = None
    observacao: str | None = None


@router.post("/leads/{dominio}/estagio")
def lead_estagio(dominio: str, body: EstagioPayload, p: Principal = Depends(humano_ou_bot)):
    estagio = (body.estagio_funil or "").strip().lower()
    if estagio not in S.ESTAGIOS:
        raise HTTPException(400, f"estagio_funil inválido. Use um de: {', '.join(S.ESTAGIOS)}")
    if p.tipo == "bot" and estagio not in S.ESTAGIOS_BOT:
        raise HTTPException(
            403,
            (
                f"Bot não muda lead para '{estagio}': qualificação é da classificação (POST /contato) "
                "ou do operador. Se acha que é o caso, registre um relato."
            ),
        )
    with transacao() as cur:
        lead = S.lead_ou_404(cur, dominio)
        S.exige_editar(p, lead["dono_email"])
        cur.execute(
            """update leads set estagio_funil = %s,
                           estagio_mudou_em = case when estagio_funil <> %s then now() else estagio_mudou_em end,
                           proximo_followup_em = case when %s then %s::timestamptz else proximo_followup_em end,
                           observacao = coalesce(%s, observacao), responsavel_bot = %s
                       where id = %s""",
            (
                estagio,
                estagio,
                body.proximo_followup_em is not None,
                body.proximo_followup_em or None,
                body.observacao,
                p.ator,
                lead["id"],
            ),
        )
        S.evento(
            cur,
            p,
            "mudou_estagio",
            "lead",
            lead["dominio"],
            lead["dono_email"],
            {"de": lead["estagio_funil"], "para": estagio, "observacao": body.observacao},
        )
    return {"ok": True, "lead_id": lead["id"], "estagio_funil": estagio}


class AcaoPayload(BaseModel):
    tipo_acao: str
    descricao: str | None = None
    rodada: int | None = None
    data_hora: str | None = None
    proxima_acao_em: str | None = None
    tarefa_id: str | None = None


# Ações que são toque/contato de verdade e por isso atualizam ultimo_contato_em.
ACOES_DE_CONTATO = {
    "mensagem_enviada",
    "ligacao",
    "reuniao_marcada",
    "tentativa_contato",
    "follow_up",
    "reenvio_pos_bounce",
    "redirect_auto_reply",
    "resposta_in_thread",
}


@router.post("/leads/{dominio}/acoes")
def lead_acao(dominio: str, body: AcaoPayload, p: Principal = Depends(humano_ou_bot)):
    tipo = (body.tipo_acao or "nota").strip().lower()
    with transacao() as cur:
        lead = S.lead_ou_404(cur, dominio)
        S.exige_editar(p, lead["dono_email"])
        a = um(
            cur,
            """insert into acoes (lead_id, tipo_acao, descricao, rodada, data_hora, proxima_acao_em,
                                          realizado_por, tarefa_id)
                       values (%s,%s,%s,%s,coalesce(%s::timestamptz, now()),%s,%s,%s) returning *""",
            (
                lead["id"],
                tipo,
                body.descricao,
                body.rodada,
                body.data_hora,
                body.proxima_acao_em,
                p.ator,
                body.tarefa_id,
            ),
        )
        if tipo in ACOES_DE_CONTATO:
            cur.execute("update leads set ultimo_contato_em = %s where id = %s", (a["data_hora"], lead["id"]))
        if body.proxima_acao_em is not None:
            cur.execute("update leads set proximo_followup_em = %s where id = %s", (body.proxima_acao_em or None, lead["id"]))
        if tipo == "email_nao_entregue" and body.descricao:
            # Marca como inválido o endereço citado na descrição, se for um contato conhecido.
            cur.execute(
                """update contatos set invalido = true
                           where lead_id = %s and position(lower(email) in lower(%s)) > 0""",
                (lead["id"], body.descricao),
            )
        S.evento(cur, p, "registrou_acao", "lead", lead["dominio"], lead["dono_email"], {"tipo_acao": tipo})
    return {"ok": True, "lead_id": lead["id"], "acao_id": a["id"]}


@router.get("/leads/{dominio}/acoes")
def lead_acoes(dominio: str, limite: int = 100, p: Principal = Depends(leitores)):
    with transacao() as cur:
        lead = S.lead_ou_404(cur, dominio)
        S.exige_ver(p, lead)
        acoes = todos(
            cur,
            "select * from acoes where lead_id = %s order by data_hora desc limit %s",
            (lead["id"], max(1, min(limite, 500))),
        )
    return {"acoes": acoes, "total": len(acoes)}


@router.get("/painel")
def painel(operador: str = "", p: Principal = Depends(leitores)):
    op = _operador_filtro(p, operador)
    f_lead = "where dono_email = %s" if op else ""
    f_op = "and operador = %s" if op else ""
    prm = [op] if op else []
    with transacao() as cur:
        estagios = todos(cur, f"select estagio_funil, count(*) n from leads {f_lead} group by 1", prm)
        tarefas = todos(
            cur,
            f"""select status, count(*) n from tarefas
                                 where (status not in ('executou','recusou','cancelada','parcial','falhou')
                                        or criada_em > now() - interval '1 day') {f_op} group by 1""",
            prm,
        )
        relatos = um(cur, f"select count(*) n from relatos where lido_em is null {f_op}", prm)["n"]
        ini, fim = S.limites_do_dia(S.agora())
        envios = todos(
            cur,
            f"""select status, count(*) n from envios
                                where coalesce(enviado_em, enviar_apos, criado_em) >= %s
                                  and coalesce(enviado_em, enviar_apos, criado_em) < %s {f_op} group by 1""",
            [ini, fim] + prm,
        )
        propostas = um(cur, f"select count(*) n from diretrizes where status = 'proposta' {f_op}", prm)["n"]
        urgentes = um(
            cur,
            f"""select count(*) n from tarefas where prioridade = 'urgente'
                               and status in ('pendente','entregue','em_andamento','bloqueado_humano') {f_op}""",
            prm,
        )["n"]
    por_status = {x["status"]: x["n"] for x in tarefas}
    envios_hoje = {x["status"]: x["n"] for x in envios}
    envios_hoje["total"] = sum(envios_hoje.values())
    return {
        "total": sum(x["n"] for x in estagios),
        "total_leads": sum(x["n"] for x in estagios),
        "tarefas_abertas": sum(
            n for s, n in por_status.items() if s in ("pendente", "entregue", "em_andamento", "bloqueado_humano")
        ),
        "tarefas_urgentes": urgentes,
        "diretrizes_propostas": propostas,
        "por_estagio": {x["estagio_funil"]: x["n"] for x in estagios},
        "tarefas_por_status": {x["status"]: x["n"] for x in tarefas},
        "relatos_nao_lidos": relatos,
        "envios_hoje": envios_hoje,
        "diretrizes_pendentes": propostas,
    }


@router.get("/eventos")
def eventos(operador: str = "", entidade: str = "", entidade_id: str = "", limite: int = 100, p: Principal = Depends(leitores)):
    filtros, params = [], []
    op = _operador_filtro(p, operador)
    if op:
        filtros.append("operador = %s")
        params.append(op)
    if entidade:
        filtros.append("entidade = %s")
        params.append(entidade)
    if entidade_id:
        filtros.append("entidade_id = %s")
        params.append(entidade_id)
    where = ("where " + " and ".join(filtros)) if filtros else ""
    with transacao() as cur:
        return {
            "eventos": todos(
                cur,
                f"""select *, em as criado_em,
                                          case when entidade = 'lead' then entidade_id else dados->>'dominio' end as dominio,
                                          acao || ' ' || entidade || coalesce(' ' || (dados->>'titulo'), '') as resumo
                                          from eventos {where} order by em desc limit %s""",
                params + [max(1, min(limite, 500))],
            )
        }
