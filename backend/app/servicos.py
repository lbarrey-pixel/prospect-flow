"""Operações de domínio compartilhadas pelas rotas: eventos, tarefas, webhook,
envios, contexto do lead e classificação de interesse."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
from datetime import UTC, datetime, timedelta

import requests
from fastapi import HTTPException

from . import llm
from . import regras as R
from .auth import Principal
from .db import jsonb, todos, um

log = logging.getLogger(__name__)

ESTAGIOS = ("frio", "aquecendo", "respondeu", "qualificado", "proposta_enviada", "convertido", "descartado")
ESTAGIOS_BOT = ("frio", "aquecendo", "respondeu", "descartado")
STATUS_FINAIS = ("executou", "parcial", "adiou", "recusou", "bloqueado_humano", "falhou", "cancelada")


def agora() -> datetime:
    return datetime.now(UTC)


def json_padrao(v):
    if isinstance(v, datetime):
        return v.isoformat()
    return str(v)


# ── Auditoria ───────────────────────────────────────────────────────────────
def evento(
    cur,
    quem: Principal | str,
    acao: str,
    entidade: str,
    entidade_id,
    operador: str | None = None,
    dados: dict | None = None,
):
    if isinstance(quem, Principal):
        ator, ator_tipo = quem.ator, quem.ator_tipo
    else:
        ator, ator_tipo = quem, "sistema"
    cur.execute(
        """insert into eventos (ator, ator_tipo, operador, acao, entidade, entidade_id, dados)
                   values (%s,%s,%s,%s,%s,%s,%s)""",
        (
            ator,
            ator_tipo,
            operador,
            acao,
            entidade,
            str(entidade_id) if entidade_id is not None else None,
            jsonb(json.loads(json.dumps(dados, default=json_padrao)) if dados else None),
        ),
    )


# ── Leads ───────────────────────────────────────────────────────────────────
def lead_ou_404(cur, dominio: str) -> dict:
    lead = um(cur, "select * from leads where dominio = %s", ((dominio or "").strip().lower(),))
    if not lead:
        raise HTTPException(404, f"Domínio '{dominio}' não está na base de leads.")
    return lead


def lead_por_email(cur, email_ou_dominio: str) -> dict | None:
    """Acha o lead pelo domínio do remetente, casando também subdomínio
    (`rj.exemplo.com.br` → `exemplo.com.br`)."""
    d = (email_ou_dominio or "").strip().lower()
    if "@" in d:
        d = d.split("@")[-1].strip(" >")
    if not d:
        return None
    partes = d.split(".")
    candidatos = [".".join(partes[i:]) for i in range(len(partes) - 1)]
    linhas = todos(cur, "select * from leads where dominio = any(%s)", (candidatos,))
    if not linhas:
        return None
    return max(linhas, key=lambda l: len(l["dominio"]))  # o mais específico


def exige_ver(p: Principal, lead: dict):
    if not p.pode_ver(lead.get("dono_email")):
        raise HTTPException(403, f"Lead pertence a {lead.get('dono_email') or '(sem dono)'}: fora do alcance desta credencial.")


def exige_editar(p: Principal, dono: str | None, o_que: str = "Lead"):
    if not p.pode_editar(dono):
        raise HTTPException(
            403,
            (
                f"{o_que} sem dono definido: só admin edita."
                if not dono
                else f"{o_que} pertence a {dono}: fora do alcance desta credencial."
            ),
        )


def regras_do_operador(cur, operador: str) -> dict:
    op = um(cur, "select regras from operadores where email = %s", (operador,))
    return R.regras_efetivas((op or {}).get("regras"))


def estado_lead(cur, lead: dict) -> R.EstadoLead:
    ult = um(cur, """select max(data_hora) em from acoes where lead_id = %s and rodada is not null""", (lead["id"],))
    inval = todos(cur, "select lower(email) e from contatos where lead_id = %s and invalido", (lead["id"],))
    aberto = um(
        cur,
        """select 1 from envios where lead_id = %s and tipo_envio in ('R1','R2','R3')
                        and status in ('aprovado','agendado','enviando') limit 1""",
        (lead["id"],),
    )
    return R.EstadoLead(
        estagio_funil=lead["estagio_funil"],
        teve_resposta=bool(lead["teve_resposta"]),
        rodada_atual=int(lead["rodada_atual"] or 0),
        ultima_rodada_em=ult["em"] if ult else None,
        contatos_invalidos={x["e"] for x in inval},
        envio_aberto=bool(aberto),
    )


def limites_do_dia(referencia: datetime, tz: str = R.TZ_PADRAO) -> tuple[datetime, datetime]:
    """[início, fim) do dia local de `referencia`, em instantes absolutos."""
    z = R.ZoneInfo(tz)
    ini = datetime.combine(referencia.astimezone(z).date(), datetime.min.time(), z)
    return ini, ini + timedelta(days=1)


def saldo_dia(cur, operador: str, regras: dict, referencia: datetime) -> R.SaldoDia:
    ini, fim = limites_do_dia(referencia, regras["janela"]["tz"])
    linhas = todos(
        cur,
        """
        select l.teve_resposta, count(*) n
        from envios e join leads l on l.id = e.lead_id
        where e.operador = %s and e.tipo_envio in ('R1','R2','R3')
          and e.status in ('aprovado','agendado','enviando','enviado')
          and coalesce(e.enviado_em, e.enviar_apos, e.criado_em) >= %s
          and coalesce(e.enviado_em, e.enviar_apos, e.criado_em) < %s
        group by 1""",
        (operador, ini, fim),
    )
    s = R.SaldoDia()
    for l in linhas:
        if l["teve_resposta"]:
            s.respondeu = l["n"]
        else:
            s.frios = l["n"]
    return s


def contexto_lead(cur, lead: dict, n_acoes: int = 5, n_interacoes: int = 3) -> dict:
    contatos = todos(
        cur,
        """select email, nome, cargo, origem from contatos
                             where lead_id = %s and not invalido order by criado_em""",
        (lead["id"],),
    )
    acoes = todos(
        cur,
        """select tipo_acao, rodada, descricao, data_hora from acoes
                          where lead_id = %s order by data_hora desc limit %s""",
        (lead["id"], n_acoes),
    )
    inter = todos(
        cur,
        """select direcao, email, assunto, left(trecho, 400) trecho, data_interacao, classe, interesse
                          from interacoes where lead_id = %s order by data_interacao desc nulls last limit %s""",
        (lead["id"], n_interacoes),
    )
    return {
        "dominio": lead["dominio"],
        "empresa": lead["empresa"],
        "estagio_funil": lead["estagio_funil"],
        "teve_resposta": lead["teve_resposta"],
        "proximo_followup_em": lead["proximo_followup_em"],
        "rodada_atual": lead["rodada_atual"],
        "ciclo": lead["ciclo"],
        "observacao": lead["observacao"],
        "contatos": contatos,
        "ultimas_acoes": acoes,
        "ultimas_interacoes": inter,
    }


# ── Tarefas ─────────────────────────────────────────────────────────────────
def criar_tarefa(
    cur,
    quem: Principal | str,
    *,
    operador: str,
    tipo: str,
    titulo: str,
    payload: dict,
    origem: str,
    prioridade: str = "normal",
    lead_id: int | None = None,
    chave_dedup: str | None = None,
    campainha_id=None,
    acompanhamento_id=None,
    relato_id=None,
    prazo=None,
) -> dict | None:
    """Cria a tarefa (ou devolve None se a `chave_dedup` já existe)."""
    criada_por = quem.ator if isinstance(quem, Principal) else quem
    t = um(
        cur,
        """
        insert into tarefas (operador, tipo, titulo, payload, origem, prioridade, lead_id, chave_dedup,
                             campainha_id, acompanhamento_id, relato_id, prazo, criada_por)
        values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        on conflict (chave_dedup) do nothing
        returning *""",
        (
            operador,
            tipo,
            titulo,
            jsonb(json.loads(json.dumps(payload, default=json_padrao))),
            origem,
            prioridade,
            lead_id,
            chave_dedup,
            campainha_id,
            acompanhamento_id,
            relato_id,
            prazo,
            criada_por,
        ),
    )
    if t:
        evento(cur, quem, "criou", "tarefa", t["id"], operador, {"tipo": tipo, "titulo": titulo, "prioridade": prioridade})
    return t


def criar_relato(
    cur,
    quem: Principal | str,
    *,
    operador: str,
    tipo: str,
    titulo: str,
    corpo: str | None = None,
    lead_id: int | None = None,
    tarefa_id=None,
    urgente: bool = False,
) -> dict:
    criado_por = quem.ator if isinstance(quem, Principal) else quem
    r = um(
        cur,
        """insert into relatos (operador, tipo, titulo, corpo, lead_id, tarefa_id, urgente, criado_por)
                   values (%s,%s,%s,%s,%s,%s,%s,%s) returning *""",
        (operador, tipo, titulo, corpo, lead_id, tarefa_id, urgente, criado_por),
    )
    evento(cur, quem, "criou", "relato", r["id"], operador, {"tipo": tipo, "titulo": titulo, "urgente": urgente})
    return r


def assinar(segredo: str, corpo: bytes) -> str:
    return "sha256=" + hmac.new(segredo.encode(), corpo, hashlib.sha256).hexdigest()


def entregar_webhook(cur, tarefa: dict) -> bool:
    """Tenta avisar o bot. Sucesso → `entregue`. Falha → continua `pendente`
    (o tick tenta de novo e o bot também acha a tarefa pela fila)."""
    bot = um(cur, "select webhook_url, webhook_segredo, ativo from bots where operador = %s", (tarefa["operador"],))
    if not bot or not bot["ativo"] or not bot["webhook_url"]:
        return False
    corpo = json.dumps({"evento": "tarefa.nova", "tarefa": tarefa}, default=json_padrao, ensure_ascii=False).encode()
    erro = None
    try:
        r = requests.post(
            bot["webhook_url"],
            data=corpo,
            timeout=8,
            headers={
                "Content-Type": "application/json",
                "X-ProspectFlow-Evento": "tarefa.nova",
                "X-ProspectFlow-Assinatura": assinar(bot["webhook_segredo"] or "", corpo),
            },
        )
        ok = 200 <= r.status_code < 300
        if not ok:
            erro = f"HTTP {r.status_code}"
    except requests.RequestException as e:
        log.warning("webhook do bot falhou (tarefa %s)", tarefa["id"], exc_info=True)
        ok, erro = False, type(e).__name__
    if ok:
        cur.execute(
            """update tarefas set status = 'entregue', entregue_em = now(),
                       tentativas_entrega = tentativas_entrega + 1, ultimo_erro_entrega = null
                       where id = %s and status = 'pendente'""",
            (tarefa["id"],),
        )
        evento(cur, "webhook", "entregou", "tarefa", tarefa["id"], tarefa["operador"])
    else:
        cur.execute(
            """update tarefas set tentativas_entrega = tentativas_entrega + 1, ultimo_erro_entrega = %s
                       where id = %s""",
            (erro, tarefa["id"]),
        )
    return ok


# ── Envios ──────────────────────────────────────────────────────────────────
def validar_e_gravar_envio(cur, quem: Principal, tarefa: dict | None, operador: str, lead: dict, d: dict) -> dict:
    rasc = d.get("rascunho") or {}
    regras = regras_do_operador(cur, operador)
    ag = agora()
    enviar_apos = rasc.get("enviar_apos")
    if isinstance(enviar_apos, str) and enviar_apos:
        enviar_apos = datetime.fromisoformat(enviar_apos.replace("Z", "+00:00"))
    tipo = d.get("tipo_envio") or "R1"
    v = R.validar_envio(
        tipo,
        rasc.get("para") or "",
        estado_lead(cur, lead),
        saldo_dia(cur, operador, regras, ag),
        regras,
        ag,
        enviar_apos or None,
    )
    faltando = [c for c in ("para", "assunto", "corpo_html") if not (rasc.get(c) or "").strip()]
    if faltando:
        v = R.Veredito("bloqueado", f"rascunho incompleto: falta {', '.join(faltando)}", rodada=v.rodada)
    e = um(
        cur,
        """
        insert into envios (tarefa_id, operador, lead_id, tipo_envio, rodada, para, assunto, corpo_html, anexos,
                            in_reply_to, proxima_acao_em, status, motivo_bloqueio, enviar_apos)
        values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) returning *""",
        (
            tarefa["id"] if tarefa else None,
            operador,
            lead["id"],
            tipo if tipo in R.TIPOS_ENVIO else "R1",
            v.rodada,
            (rasc.get("para") or "").strip() or "(vazio)",
            (rasc.get("assunto") or "").strip() or "(sem assunto)",
            rasc.get("corpo_html") or "",
            list(rasc.get("anexos") or []),
            rasc.get("in_reply_to"),
            d.get("proxima_acao_em"),
            v.status,
            v.motivo,
            v.enviar_apos,
        ),
    )
    evento(
        cur,
        quem,
        "rascunhou",
        "envio",
        e["id"],
        operador,
        {"dominio": lead["dominio"], "tipo_envio": tipo, "status": v.status, "motivo": v.motivo},
    )
    return e


def concluir_envio(cur, quem: Principal | str, envio: dict, message_id: str | None):
    """n8n confirmou o envio: grava ação, interação e avança o lead."""
    lead = um(cur, "select * from leads where id = %s", (envio["lead_id"],))
    regras = regras_do_operador(cur, envio["operador"])
    ag = agora()
    tipo_acao = "mensagem_enviada" if envio["tipo_envio"] in R.TIPOS_RODADA else envio["tipo_envio"]
    descricao = f"{envio['tipo_envio']} – para {envio['para']} – assunto: {envio['assunto']}"
    proxima = envio["proxima_acao_em"]
    if envio["rodada"]:
        if not proxima:
            dias = regras["ciclo_dias"] if envio["rodada"] >= int(regras["max_rodadas"]) else None
            proxima = (
                (ag + timedelta(days=int(dias)))
                if dias
                else R.somar_dias_uteis(ag, int(regras["intervalo_dias_uteis"]), regras["janela"]["dias"])
            )
    cur.execute(
        """insert into acoes (lead_id, tipo_acao, descricao, rodada, data_hora, proxima_acao_em,
                                      realizado_por, tarefa_id, envio_id)
                   values (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (
            lead["id"],
            tipo_acao,
            descricao,
            envio["rodada"],
            ag,
            proxima,
            envio["operador"],
            envio["tarefa_id"],
            envio["id"],
        ),
    )
    cur.execute(
        """insert into interacoes (lead_id, email, data_interacao, assunto, trecho, canal, direcao, origem, message_id)
                   values (%s,%s,%s,%s,%s,'email','enviado','api',%s) on conflict do nothing""",
        (lead["id"], envio["para"], ag, envio["assunto"], None, message_id),
    )
    novo_ciclo = envio["rodada"] == 1 and int(lead["rodada_atual"] or 0) >= int(regras["max_rodadas"])
    cur.execute(
        """update leads set ultimo_envio = %s, ultimo_contato_em = %s,
                       primeiro_envio = coalesce(primeiro_envio, %s),
                       rodada_atual = coalesce(%s, rodada_atual),
                       ciclo = ciclo + %s,
                       proximo_followup_em = coalesce(%s, proximo_followup_em),
                       responsavel_bot = %s
                   where id = %s""",
        (ag, ag, ag, envio["rodada"], 1 if novo_ciclo else 0, proxima, envio["operador"], lead["id"]),
    )
    evento(
        cur,
        quem,
        "enviou",
        "envio",
        envio["id"],
        envio["operador"],
        {"dominio": lead["dominio"], "tipo_envio": envio["tipo_envio"], "message_id": message_id},
    )


# ── Classificação de interesse ──────────────────────────────────────────────
SYSTEM_QUALIFICA = """Você julga respostas de e-mail numa campanha de prospecção B2B (um fornecedor tentando
virar parceiro comercial do destinatário).

Classifique a resposta em UMA palavra:
- real: interesse genuíno. Pede reunião ou ligação, faz pergunta específica, pede orçamento, catálogo ou
  informação concreta, ou sinaliza demanda futura.
- generico: resposta automática ou educada mas vazia ("obrigado, vamos analisar", "encaminhei para o setor
  de compras", "cadastramos seu contato", "sem demanda no momento"), fora do escopo, ou só confirma
  recebimento sem pedir nada.

Responda só com a palavra: real ou generico."""

_provedor: llm.ProvedorLLM | None = None


def provedor_llm() -> llm.ProvedorLLM:
    global _provedor
    if _provedor is None:
        _provedor = llm.do_ambiente()
    return _provedor


def usar_provedor(p: llm.ProvedorLLM | None):
    """Troca o provedor (testes injetam um fake; None volta a ler o ambiente)."""
    global _provedor
    _provedor = p


def classificar_interesse(trecho: str) -> str:
    """'real' ou 'generico'. Melhor esforço: texto curto, sem modelo ou com erro → 'generico'."""
    texto = (trecho or "").strip()
    if len(texto) < 15:
        return "generico"
    try:
        saida = provedor_llm().completar(SYSTEM_QUALIFICA, texto[:2000], max_tokens=10).lower()
    except Exception:
        log.warning("classificação de interesse falhou; assumindo 'generico'", exc_info=True)
        return "generico"
    return "real" if "real" in saida else "generico"


def registrar_contato(
    cur,
    quem: Principal | str,
    lead: dict,
    *,
    direcao: str,
    email=None,
    nome=None,
    telefone=None,
    assunto=None,
    trecho=None,
    canal="email",
    message_id=None,
    classe=None,
) -> dict:
    """Grava a interação e, se for resposta humana, classifica e avança o funil.
    Auto-avanço só dentro de frio/aquecendo/respondeu: estágios que já são
    decisão humana (qualificado em diante) não mudam por aqui."""
    ag = agora()
    interesse = None
    atualiza: dict = {"ultimo_contato_em": ag}
    estagio = lead["estagio_funil"]
    if direcao == "recebido" and classe in (None, "humano"):
        atualiza["teve_resposta"] = True
        if estagio in ("frio", "aquecendo"):
            estagio = "respondeu"
        if estagio == "respondeu" and trecho:
            interesse = classificar_interesse(trecho)
            if interesse == "real":
                estagio = "qualificado"
    cur.execute(
        """insert into interacoes (lead_id, email, nome, telefone, data_interacao, assunto, trecho, canal,
                                           direcao, origem, message_id, classe, interesse)
                   values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) on conflict do nothing""",
        (
            lead["id"],
            email,
            nome,
            telefone,
            ag,
            assunto,
            trecho,
            canal,
            direcao,
            "bot" if isinstance(quem, Principal) and quem.tipo == "bot" else "api",
            message_id,
            classe,
            interesse,
        ),
    )
    mudou = estagio != lead["estagio_funil"]
    cur.execute(
        """update leads set ultimo_contato_em = %s, teve_resposta = teve_resposta or %s,
                       estagio_funil = %s, estagio_mudou_em = case when %s then now() else estagio_mudou_em end
                   where id = %s""",
        (ag, bool(atualiza.get("teve_resposta")), estagio, mudou, lead["id"]),
    )
    evento(
        cur,
        quem,
        "registrou_contato",
        "lead",
        lead["dominio"],
        lead["dono_email"],
        {"direcao": direcao, "classe": classe, "interesse": interesse, "estagio": estagio},
    )
    if mudou and estagio == "qualificado" and lead["dono_email"]:
        criar_relato(
            cur,
            "sistema",
            operador=lead["dono_email"],
            tipo="alerta",
            urgente=True,
            lead_id=lead["id"],
            titulo=f"{lead['dominio']} ficou qualificado",
            corpo=f"Resposta classificada como interesse real. Trecho: {(trecho or '')[:500]}",
        )
    return {"estagio_funil": estagio, "interesse_classificado": interesse, "mudou": mudou}
