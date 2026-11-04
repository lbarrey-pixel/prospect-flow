"""Regras verificáveis do operador: dias úteis, janela de envio e validação do
rascunho do bot antes de liberar para o n8n.

Tudo aqui é função pura (sem banco), para dar para testar. A tática (texto,
ângulo, quem tocar hoje) continua sendo do bot; o que está aqui são os limites
que o operador definiu em `crm.operadores.regras`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

TZ_PADRAO = "America/Sao_Paulo"

REGRAS_PADRAO = {
    "teto_frios": 20,
    "teto_respondeu": 5,
    "intervalo_dias_uteis": 5,
    "max_rodadas": 3,
    "ciclo_dias": 90,
    "janela": {"dias": [1, 2, 3, 4, 5], "inicio": "08:00", "fim": "17:00", "tz": TZ_PADRAO},
    "estagios_nutriveis": ["frio", "aquecendo", "respondeu"],
}

TIPOS_RODADA = {"R1": 1, "R2": 2, "R3": 3}
TIPOS_FORA_DO_TETO = {"reenvio_pos_bounce", "redirect_auto_reply", "resposta_in_thread"}
TIPOS_ENVIO = set(TIPOS_RODADA) | TIPOS_FORA_DO_TETO


def regras_efetivas(regras: dict | None) -> dict:
    r = {**REGRAS_PADRAO, **(regras or {})}
    r["janela"] = {**REGRAS_PADRAO["janela"], **((regras or {}).get("janela") or {})}
    return r


def _tz(regras: dict) -> ZoneInfo:
    return ZoneInfo((regras.get("janela") or {}).get("tz") or TZ_PADRAO)


def _hhmm(s: str) -> time:
    h, m = (s or "00:00").split(":")
    return time(int(h), int(m))


def eh_dia_util(d: datetime, dias: list[int]) -> bool:
    return d.isoweekday() in dias


def somar_dias_uteis(inicio: datetime, n: int, dias: list[int] | None = None) -> datetime:
    """`inicio` + n dias úteis, mantendo a hora."""
    dias = dias or [1, 2, 3, 4, 5]
    d = inicio
    contados = 0
    while contados < n:
        d += timedelta(days=1)
        if eh_dia_util(d, dias):
            contados += 1
    return d


def dias_uteis_entre(a: datetime, b: datetime, dias: list[int] | None = None) -> int:
    """Quantos dias úteis (pelo calendário local) há depois de `a` até `b`, inclusive."""
    dias = dias or [1, 2, 3, 4, 5]
    da, db = a.date(), b.date()
    if db <= da:
        return 0
    n = 0
    d = da
    while d < db:
        d += timedelta(days=1)
        if d.isoweekday() in dias:
            n += 1
    return n


def dentro_da_janela(quando: datetime, regras: dict) -> bool:
    j = regras["janela"]
    local = quando.astimezone(_tz(regras))
    return eh_dia_util(local, j["dias"]) and _hhmm(j["inicio"]) <= local.time() < _hhmm(j["fim"])


def proxima_janela(quando: datetime, regras: dict) -> datetime:
    """O primeiro instante >= `quando` dentro da janela de envio."""
    j = regras["janela"]
    tz = _tz(regras)
    local = quando.astimezone(tz)
    for _ in range(15):
        ini = datetime.combine(local.date(), _hhmm(j["inicio"]), tz)
        fim = datetime.combine(local.date(), _hhmm(j["fim"]), tz)
        if eh_dia_util(local, j["dias"]):
            if local < ini:
                return ini
            if local < fim:
                return local
        local = datetime.combine(local.date() + timedelta(days=1), time(0, 0), tz)
    return quando  # janela mal configurada: não trava o envio por isso


def mesmo_dia_local(a: datetime, b: datetime, regras: dict) -> bool:
    tz = _tz(regras)
    return a.astimezone(tz).date() == b.astimezone(tz).date()


@dataclass
class EstadoLead:
    estagio_funil: str
    teve_resposta: bool
    rodada_atual: int
    ultima_rodada_em: datetime | None
    contatos_invalidos: set[str] = field(default_factory=set)
    envio_aberto: bool = False  # já há envio aprovado/agendado/enviando para o lead


@dataclass
class SaldoDia:
    frios: int = 0
    respondeu: int = 0


@dataclass
class Veredito:
    status: str  # aprovado | agendado | bloqueado
    motivo: str | None = None
    enviar_apos: datetime | None = None
    rodada: int | None = None


def proxima_rodada_esperada(lead: EstadoLead, regras: dict, agora: datetime) -> tuple[int | None, str | None]:
    """(rodada que pode sair agora, motivo se nenhuma pode)."""
    max_r = int(regras["max_rodadas"])
    if lead.rodada_atual >= max_r:
        if lead.ultima_rodada_em and agora < lead.ultima_rodada_em + timedelta(days=int(regras["ciclo_dias"])):
            return None, f"ciclo encerrado (R{max_r} enviada); novo ciclo só depois de {regras['ciclo_dias']} dias"
        return 1, None
    if lead.rodada_atual > 0 and lead.ultima_rodada_em:
        dias = dias_uteis_entre(
            lead.ultima_rodada_em.astimezone(_tz(regras)), agora.astimezone(_tz(regras)), regras["janela"]["dias"]
        )
        if dias < int(regras["intervalo_dias_uteis"]):
            return None, (
                f"intervalo: só {dias} dia(s) útil(eis) desde a R{lead.rodada_atual}; " f"mínimo {regras['intervalo_dias_uteis']}"
            )
    return lead.rodada_atual + 1, None


def validar_envio(
    tipo_envio: str,
    para: str,
    lead: EstadoLead,
    saldo: SaldoDia,
    regras: dict,
    agora: datetime,
    enviar_apos: datetime | None = None,
) -> Veredito:
    """Decide se o rascunho do bot sai, espera a janela ou é barrado (com motivo)."""
    if tipo_envio not in TIPOS_ENVIO:
        return Veredito("bloqueado", f"tipo_envio inválido: {tipo_envio}")
    if lead.estagio_funil not in regras["estagios_nutriveis"]:
        return Veredito("bloqueado", f"lead em '{lead.estagio_funil}': fora da nutrição (trabalho humano)")
    if (para or "").strip().lower() in lead.contatos_invalidos:
        return Veredito("bloqueado", f"contato {para} já deu bounce")

    rodada = None
    if tipo_envio in TIPOS_RODADA:
        if lead.envio_aberto:
            return Veredito("bloqueado", "já existe envio de rodada pendente para este lead")
        esperada, motivo = proxima_rodada_esperada(lead, regras, agora)
        if esperada is None:
            return Veredito("bloqueado", motivo)
        pedida = TIPOS_RODADA[tipo_envio]
        if pedida != esperada:
            return Veredito("bloqueado", f"rodada fora de ordem: pediu R{pedida}, a próxima é R{esperada}")
        rodada = pedida
        if lead.teve_resposta:
            if saldo.respondeu >= int(regras["teto_respondeu"]):
                return Veredito(
                    "bloqueado", f"teto diário de 'já respondeu' atingido ({regras['teto_respondeu']})", rodada=rodada
                )
        elif saldo.frios >= int(regras["teto_frios"]):
            return Veredito("bloqueado", f"teto diário de frios atingido ({regras['teto_frios']})", rodada=rodada)

    alvo = max(agora, enviar_apos) if enviar_apos else agora
    janela = proxima_janela(alvo, regras)
    if janela > agora:
        return Veredito("agendado", None, janela, rodada)
    return Veredito("aprovado", None, None, rodada)
