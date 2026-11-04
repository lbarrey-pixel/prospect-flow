"""Rotas do n8n. O n8n cuida do mundo externo (relógio, IMAP, SMTP, avisos);
o estado e as regras ficam aqui."""

from __future__ import annotations

import os
from collections import defaultdict
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from . import regras as R
from . import servicos as S
from .auth import Principal, so_orquestrador
from .db import todos, transacao, um

router = APIRouter(prefix="/orquestrador")

MAX_TENTATIVAS_WEBHOOK = 5


@router.post("/tick")
def tick(p: Principal = Depends(so_orquestrador)):
    """Roda a cada poucos minutos. Cada passo é idempotente."""
    res = defaultdict(int)
    ag = S.agora()
    with transacao() as cur:
        # 1. Tarefas adiadas cuja hora chegou voltam para a fila.
        for t in todos(
            cur,
            """update tarefas set status = 'pendente', tentativas_entrega = 0, entregue_em = null
                               where status = 'adiou' and reagendar_em <= now() returning id, operador""",
        ):
            S.evento(cur, p, "reabriu", "tarefa", t["id"], t["operador"])
            res["tarefas_reabertas"] += 1

        # 2. Acompanhamentos vencidos viram tarefa.
        for a in todos(
            cur,
            """select a.*, l.dominio from acompanhamentos a left join leads l on l.id = a.lead_id
                               where a.status = 'agendado' and a.agendado_para <= now() for update of a skip locked""",
        ):
            payload = {
                "acompanhamento": {
                    "id": str(a["id"]),
                    "titulo": a["titulo"],
                    "instrucao": a["instrucao"],
                    "criado_por": a["criado_por"],
                    "criado_por_tipo": a["criado_por_tipo"],
                }
            }
            if a["lead_id"]:
                lead = um(cur, "select * from leads where id = %s", (a["lead_id"],))
                payload["leads"] = [S.contexto_lead(cur, lead)]
            t = S.criar_tarefa(
                cur,
                p,
                operador=a["operador"],
                tipo="acompanhamento",
                titulo=a["titulo"],
                payload=payload,
                origem="sistema",
                lead_id=a["lead_id"],
                acompanhamento_id=a["id"],
                chave_dedup=f"acomp:{a['id']}:{a['agendado_para'].isoformat()}",
            )
            if a["repetir_dias"]:
                cur.execute(
                    """update acompanhamentos set agendado_para = agendado_para + make_interval(days => repetir_dias),
                               ultimo_disparo_em = now(), tarefa_id = %s where id = %s""",
                    (t["id"] if t else a["tarefa_id"], a["id"]),
                )
            else:
                cur.execute(
                    """update acompanhamentos set status = 'disparado', ultimo_disparo_em = now(), tarefa_id = %s
                               where id = %s""",
                    (t["id"] if t else a["tarefa_id"], a["id"]),
                )
            res["acompanhamentos_disparados"] += 1

        # 3. Campainhas vencidas se desligam.
        cur.execute("""update campainhas set ativa = false where ativa and expira_em is not null and expira_em <= now()
                       returning id""")
        res["campainhas_expiradas"] = cur.rowcount

        # 4. Envios agendados que chegaram na hora: revalida (o teto é do dia do envio).
        for e in todos(
            cur,
            """select * from envios where status = 'agendado' and enviar_apos <= now()
                               for update skip locked""",
        ):
            if e["liberado_por"]:
                cur.execute("update envios set status = 'aprovado' where id = %s", (e["id"],))
                res["envios_liberados"] += 1
                continue
            lead = um(cur, "select * from leads where id = %s", (e["lead_id"],))
            regras = S.regras_do_operador(cur, e["operador"])
            cur.execute("update envios set status = 'cancelado' where id = %s", (e["id"],))  # sai da contagem
            v = R.validar_envio(
                e["tipo_envio"],
                e["para"],
                S.estado_lead(cur, lead),
                S.saldo_dia(cur, e["operador"], regras, ag),
                regras,
                ag,
            )
            cur.execute(
                """update envios set status = %s, motivo_bloqueio = %s, enviar_apos = %s where id = %s""",
                (v.status, v.motivo, v.enviar_apos, e["id"]),
            )
            res[f"envios_{v.status}"] += 1

    # 5. Webhooks pendentes (fora da transação grande: cada um na sua).
    with transacao() as cur:
        pendentes = todos(
            cur,
            """select * from tarefas where status = 'pendente' and tentativas_entrega < %s
                                  order by (prioridade = 'urgente') desc, criada_em limit 50""",
            (MAX_TENTATIVAS_WEBHOOK,),
        )
    for t in pendentes:
        with transacao() as cur:
            if S.entregar_webhook(cur, t):
                res["webhooks_entregues"] += 1
            else:
                res["webhooks_falharam"] += 1
    return dict(res)


@router.post("/envio-diario")
def envio_diario(operador: str | None = None, p: Principal = Depends(so_orquestrador)):
    """Monta a tarefa do dia: candidatos que as regras do operador permitem tocar
    hoje + saldo do teto. QUEM, COMO e SE tocar é decisão do bot."""
    criadas = []
    with transacao() as cur:
        ops = todos(
            cur,
            """select o.email, o.nome, o.regras, o.bcc, o.caixa from operadores o
                            join bots b on b.operador = o.email
                            where o.ativo and b.ativo and (%s::text is null or o.email = %s)""",
            (operador, operador),
        )
        ag = S.agora()
        for op in ops:
            regras = R.regras_efetivas(op["regras"])
            if not R.eh_dia_util(ag.astimezone(R.ZoneInfo(regras["janela"]["tz"])), regras["janela"]["dias"]):
                continue
            leads = todos(
                cur,
                """select * from leads where dono_email = %s and estagio_funil = any(%s)
                                  and (proximo_followup_em is null or proximo_followup_em <= now())
                                  order by proximo_followup_em nulls first, id limit 400""",
                (op["email"], regras["estagios_nutriveis"]),
            )
            frios, resp = [], []
            for lead in leads:
                est = S.estado_lead(cur, lead)
                if est.envio_aberto:
                    continue
                rodada, _ = R.proxima_rodada_esperada(est, regras, ag)
                if rodada is None:
                    continue
                ctx = S.contexto_lead(cur, lead)
                ctx["rodada_permitida"] = f"R{rodada}"
                (resp if lead["teve_resposta"] else frios).append(ctx)
            saldo = S.saldo_dia(cur, op["email"], regras, ag)
            n_f = max(0, int(regras["teto_frios"]) - saldo.frios)
            n_r = max(0, int(regras["teto_respondeu"]) - saldo.respondeu)
            # Folga de 2x o saldo: o bot escolhe, e pode recusar alguns.
            candidatos = frios[: n_f * 2] + resp[: n_r * 2]
            if not candidatos:
                continue
            dia = ag.astimezone(R.ZoneInfo(regras["janela"]["tz"])).date().isoformat()
            t = S.criar_tarefa(
                cur,
                p,
                operador=op["email"],
                tipo="envio_diario",
                origem="orquestrador",
                titulo=f"Envios de {dia}",
                chave_dedup=f"envio_diario:{op['email']}:{dia}",
                payload={
                    "versao_contrato": 1,
                    "regras_operador": regras,
                    "saldo_dia": {
                        "frios_enviados": saldo.frios,
                        "respondeu_enviados": saldo.respondeu,
                        "pode_frios": n_f,
                        "pode_respondeu": n_r,
                    },
                    "bcc": op["bcc"],
                    "leads": candidatos,
                    "instrucao": (
                        "Escolha quem tocar hoje e devolva um rascunho por e-mail em "
                        "POST /bot/tarefas/{id}/resultado. Recusar ou adiar é válido: diga o motivo."
                    ),
                },
            )
            if t:
                criadas.append({"operador": op["email"], "tarefa_id": t["id"], "candidatos": len(candidatos)})
    with transacao() as cur:
        for c in criadas:
            t = um(cur, "select * from tarefas where id = %s", (c["tarefa_id"],))
            S.entregar_webhook(cur, t)
    return {"criadas": criadas}


@router.get("/envios/prontos")
def envios_prontos(limite: int = 20, p: Principal = Depends(so_orquestrador)):
    """Pega envios aprovados e marca `enviando` (ninguém mais pega o mesmo)."""
    with transacao() as cur:
        linhas = todos(
            cur,
            """
            update envios e set status = 'enviando', tentativas = tentativas + 1
            from leads l, operadores o
            where e.id in (select id from envios where status = 'aprovado' order by criado_em limit %s for update skip locked)
              and l.id = e.lead_id and o.email = e.operador
            returning e.*, l.dominio, o.bcc, o.caixa""",
            (max(1, min(limite, 50)),),
        )
        for e in linhas:
            S.evento(cur, p, "pegou", "envio", e["id"], e["operador"])
    return {"envios": linhas}


class ResultadoEnvio(BaseModel):
    ok: bool
    message_id: str | None = None
    erro: str | None = None


@router.post("/envios/{envio_id}/resultado")
def envio_resultado(envio_id: str, body: ResultadoEnvio, p: Principal = Depends(so_orquestrador)):
    with transacao() as cur:
        e = um(cur, "select * from envios where id = %s for update", (envio_id,))
        if not e:
            raise HTTPException(404, "Envio não encontrado.")
        if e["status"] == "enviado":
            return {"ok": True, "idempotente": True}
        if e["status"] != "enviando":
            raise HTTPException(409, f"Envio está '{e['status']}', não 'enviando'.")
        if body.ok:
            cur.execute(
                """update envios set status = 'enviado', message_id = %s, enviado_em = now(), erro = null
                           where id = %s""",
                (body.message_id, envio_id),
            )
            S.concluir_envio(cur, p, e, body.message_id)
        else:
            cur.execute("update envios set status = 'falhou', erro = %s where id = %s", (body.erro, envio_id))
            S.evento(cur, p, "falhou", "envio", envio_id, e["operador"], {"erro": body.erro})
            S.criar_relato(
                cur,
                "sistema",
                operador=e["operador"],
                tipo="alerta",
                lead_id=e["lead_id"],
                tarefa_id=e["tarefa_id"],
                titulo=f"Envio falhou para {e['para']}",
                corpo=body.erro,
            )
    return {"ok": True}


@router.get("/campainhas")
def campainhas_ativas(p: Principal = Depends(so_orquestrador)):
    with transacao() as cur:
        linhas = todos(
            cur,
            """select c.id, c.operador, c.nome, c.tipo, c.padrao, c.prioridade,
                                      coalesce(c.caixa, o.caixa) caixa
                               from campainhas c join operadores o on o.email = c.operador
                               where c.ativa and c.arquivada_em is null
                                 and (c.expira_em is null or c.expira_em > now())""",
        )
    por_caixa = defaultdict(list)
    for c in linhas:
        por_caixa[c["caixa"] or "(sem caixa)"].append(c)
    return {"caixas": [{"caixa": k, "campainhas": v} for k, v in por_caixa.items()]}


class Disparo(BaseModel):
    message_id: str
    de: str | None = None
    assunto: str | None = None
    trecho: str | None = None
    recebido_em: datetime | None = None


@router.post("/campainhas/{cid}/disparo")
def campainha_disparo(cid: str, body: Disparo, p: Principal = Depends(so_orquestrador)):
    with transacao() as cur:
        c = um(cur, "select * from campainhas where id = %s", (cid,))
        if not c:
            raise HTTPException(404, "Campainha não encontrada.")
        d = um(
            cur,
            """insert into campainha_disparos (campainha_id, message_id, de, assunto, trecho, recebido_em)
                       values (%s,%s,%s,%s,%s,%s) on conflict (campainha_id, message_id) do nothing returning id""",
            (cid, body.message_id, body.de, body.assunto, (body.trecho or "")[:4000], body.recebido_em),
        )
        if not d:
            return {"ok": True, "duplicado": True}
        lead = S.lead_por_email(cur, body.de or "") if body.de else None
        payload = {
            "campainha": {"id": str(cid), "nome": c["nome"], "instrucao": c["instrucao"]},
            "inbound": body.model_dump(mode="json"),
        }
        if lead:
            payload["leads"] = [S.contexto_lead(cur, lead)]
        t = S.criar_tarefa(
            cur,
            p,
            operador=c["operador"],
            tipo="campainha",
            origem="orquestrador",
            prioridade=c["prioridade"],
            titulo=f"Campainha: {c['nome']}",
            payload=payload,
            lead_id=lead["id"] if lead else c["lead_id"],
            campainha_id=cid,
            chave_dedup=f"campainha:{cid}:{body.message_id}",
        )
        if not t:
            return {"ok": True, "duplicado": True}
        cur.execute("""update campainha_disparos set tarefa_id = %s where id = %s""", (t["id"], d["id"]))
        cur.execute("""update campainhas set disparos = disparos + 1, ultimo_disparo_em = now() where id = %s""", (cid,))
        if c["prioridade"] == "urgente":
            S.criar_relato(
                cur,
                "sistema",
                operador=c["operador"],
                tipo="alerta",
                urgente=True,
                tarefa_id=t["id"],
                lead_id=t["lead_id"],
                titulo=f"Campainha '{c['nome']}' tocou",
                corpo=f"De: {body.de}\nAssunto: {body.assunto}\n\n{(body.trecho or '')[:800]}",
            )
        S.evento(cur, p, "tocou", "campainha", cid, c["operador"], {"message_id": body.message_id, "de": body.de})
    with transacao() as cur:
        S.entregar_webhook(cur, t)
    return {"ok": True, "tarefa_id": t["id"]}


class Inbound(BaseModel):
    caixa: str | None = None
    message_id: str
    de: str
    para: str | None = None
    assunto: str | None = None
    trecho: str | None = None
    classe: str = "humano"  # humano | bounce | auto_reply | redirect
    redirect_para: str | None = None
    endereco_falhou: str | None = None  # bounce: o endereço que não existe
    in_reply_to: str | None = None


@router.post("/inbound")
def inbound(body: Inbound, p: Principal = Depends(so_orquestrador)):
    """Resposta chegou numa caixa. Bounce e auto-reply NÃO passam pela
    classificação (não são resposta do lead); todos viram tarefa para o bot."""
    if body.classe not in ("humano", "bounce", "auto_reply", "redirect"):
        raise HTTPException(422, "classe inválida")
    with transacao() as cur:
        lead = None
        if body.classe == "bounce" and body.endereco_falhou:
            lead = S.lead_por_email(cur, body.endereco_falhou)
        if not lead and body.in_reply_to:
            lead = um(
                cur,
                """select l.* from envios e join leads l on l.id = e.lead_id
                              where e.message_id = %s limit 1""",
                (body.in_reply_to,),
            )
        lead = lead or S.lead_por_email(cur, body.de)
        if not lead:
            return {"ok": True, "lead": None, "ignorado": "remetente não é lead"}
        if not lead["dono_email"]:
            return {"ok": True, "lead": lead["dominio"], "ignorado": "lead sem dono"}
        resultado = None
        if body.classe == "humano":
            resultado = S.registrar_contato(
                cur,
                p,
                lead,
                direcao="recebido",
                email=body.de,
                assunto=body.assunto,
                trecho=body.trecho,
                message_id=body.message_id,
                classe="humano",
            )
        else:
            cur.execute(
                """insert into interacoes (lead_id, email, data_interacao, assunto, trecho, direcao, origem,
                                                   message_id, classe)
                           values (%s,%s,now(),%s,%s,'recebido','api',%s,%s) on conflict do nothing""",
                (lead["id"], body.de, body.assunto, (body.trecho or "")[:4000], body.message_id, body.classe),
            )
            if body.classe == "bounce":
                alvo = (body.endereco_falhou or "").lower()
                if alvo:
                    cur.execute(
                        "update contatos set invalido = true where lead_id = %s and lower(email) = %s",
                        (lead["id"], alvo),
                    )
                cur.execute(
                    """insert into acoes (lead_id, tipo_acao, descricao, realizado_por)
                               values (%s,'email_nao_entregue',%s,%s)""",
                    (lead["id"], f"bounce de {alvo or '?'}", p.ator),
                )
        lead = um(cur, "select * from leads where id = %s", (lead["id"],))
        t = S.criar_tarefa(
            cur,
            p,
            operador=lead["dono_email"],
            tipo="tratar_resposta",
            origem="orquestrador",
            titulo=f"{body.classe}: {lead['dominio']}",
            lead_id=lead["id"],
            prioridade="urgente" if (resultado or {}).get("estagio_funil") == "qualificado" else "normal",
            chave_dedup=f"inbound:{body.message_id}",
            payload={
                "inbound": {
                    **body.model_dump(mode="json"),
                    "contato_registrado": body.classe == "humano",
                    "estagio_apos_contato": lead["estagio_funil"],
                },
                "leads": [S.contexto_lead(cur, lead)],
            },
        )
    if t:
        with transacao() as cur:
            S.entregar_webhook(cur, t)
    return {
        "ok": True,
        "lead": lead["dominio"],
        "tarefa_id": t["id"] if t else None,
        "duplicado": t is None,
        **(resultado or {}),
    }


@router.get("/avisos")
def avisos(p: Principal = Depends(so_orquestrador)):
    """O que o n8n deve avisar ao operador agora. Marca como avisado."""
    with transacao() as cur:
        linhas = todos(
            cur,
            """
            update relatos r set avisado_em = now()
            from operadores o
            where r.avisado_em is null and o.email = r.operador
              and (r.urgente or r.tipo in ('pergunta','pedido_autorizacao'))
            returning r.id, r.operador, o.nome, o.caixa, r.tipo, r.titulo, r.corpo, r.urgente, r.criado_em""",
        )
    return {"avisos": linhas, "painel": os.environ.get("PAINEL_URL", "")}
