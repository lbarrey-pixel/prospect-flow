from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app import regras as R

SP = ZoneInfo("America/Sao_Paulo")
REG = R.regras_efetivas({})


def dt(*a):
    return datetime(*a, tzinfo=SP)


def lead(**kw):
    base = dict(estagio_funil="frio", teve_resposta=False, rodada_atual=0, ultima_rodada_em=None)
    base.update(kw)
    return R.EstadoLead(**base)


# 2026-10-01 é quinta-feira.
QUI_10H = dt(2026, 10, 1, 10, 0)


def test_dias_uteis_pula_fim_de_semana():
    assert R.somar_dias_uteis(dt(2026, 10, 2, 9), 1) == dt(2026, 10, 5, 9)  # sex + 1 = seg
    assert R.dias_uteis_entre(dt(2026, 10, 2, 9), dt(2026, 10, 9, 9)) == 5  # sex → sex seguinte


def test_janela():
    assert R.dentro_da_janela(QUI_10H, REG)
    assert not R.dentro_da_janela(dt(2026, 10, 1, 17, 30), REG)
    assert R.proxima_janela(dt(2026, 10, 1, 18), REG) == dt(2026, 10, 2, 8)
    assert R.proxima_janela(dt(2026, 10, 3, 10), REG) == dt(2026, 10, 5, 8)  # sábado → segunda
    assert R.proxima_janela(dt(2026, 10, 1, 7), REG) == dt(2026, 10, 1, 8)


def test_r1_aprovado_na_janela():
    v = R.validar_envio("R1", "a@example.com", lead(), R.SaldoDia(), REG, QUI_10H)
    assert (v.status, v.rodada) == ("aprovado", 1)


def test_fora_da_janela_agenda():
    v = R.validar_envio("R1", "a@example.com", lead(), R.SaldoDia(), REG, dt(2026, 10, 1, 19))
    assert v.status == "agendado" and v.enviar_apos == dt(2026, 10, 2, 8)


def test_enviar_apos_do_bot_respeitado():
    v = R.validar_envio("R1", "a@example.com", lead(), R.SaldoDia(), REG, QUI_10H, dt(2026, 10, 1, 14))
    assert v.status == "agendado" and v.enviar_apos == dt(2026, 10, 1, 14)


def test_teto_frios_e_respondeu_separados():
    assert R.validar_envio("R1", "a@example.com", lead(), R.SaldoDia(frios=20), REG, QUI_10H).status == "bloqueado"
    assert (
        R.validar_envio("R1", "a@example.com", lead(teve_resposta=True), R.SaldoDia(frios=20), REG, QUI_10H).status == "aprovado"
    )
    assert (
        R.validar_envio("R1", "a@example.com", lead(teve_resposta=True), R.SaldoDia(respondeu=5), REG, QUI_10H).status
        == "bloqueado"
    )


def test_fora_do_teto_nao_conta():
    for tipo in ("reenvio_pos_bounce", "redirect_auto_reply", "resposta_in_thread"):
        v = R.validar_envio(
            tipo,
            "b@example.com",
            lead(rodada_atual=1, ultima_rodada_em=QUI_10H - timedelta(hours=1)),
            R.SaldoDia(frios=99),
            REG,
            QUI_10H,
        )
        assert v.status == "aprovado" and v.rodada is None, tipo


def test_intervalo_de_5_dias_uteis():
    l = lead(rodada_atual=1, ultima_rodada_em=dt(2026, 9, 28, 10))  # seg
    assert "intervalo" in R.validar_envio("R2", "a@example.com", l, R.SaldoDia(), REG, QUI_10H).motivo
    assert R.validar_envio("R2", "a@example.com", l, R.SaldoDia(), REG, dt(2026, 10, 5, 10)).status == "aprovado"


def test_rodada_fora_de_ordem():
    v = R.validar_envio(
        "R3", "a@example.com", lead(rodada_atual=1, ultima_rodada_em=dt(2026, 9, 1, 10)), R.SaldoDia(), REG, QUI_10H
    )
    assert v.status == "bloqueado" and "R2" in v.motivo


def test_ciclo_de_90_dias_depois_da_r3():
    l = lead(rodada_atual=3, ultima_rodada_em=dt(2026, 9, 1, 10))
    assert "ciclo" in R.validar_envio("R1", "a@example.com", l, R.SaldoDia(), REG, QUI_10H).motivo
    assert R.validar_envio("R1", "a@example.com", l, R.SaldoDia(), REG, dt(2026, 12, 1, 10)).status == "aprovado"


def test_estagio_fora_da_nutricao_e_bounce():
    assert (
        R.validar_envio("R1", "a@example.com", lead(estagio_funil="qualificado"), R.SaldoDia(), REG, QUI_10H).status
        == "bloqueado"
    )
    l = lead(contatos_invalidos={"a@example.com"})
    assert R.validar_envio("R1", "A@example.com", l, R.SaldoDia(), REG, QUI_10H).status == "bloqueado"


def test_regras_do_operador_sobrepoem_padrao():
    reg = R.regras_efetivas({"teto_frios": 2, "janela": {"fim": "19:00"}})
    assert reg["janela"]["inicio"] == "08:00" and reg["janela"]["fim"] == "19:00"
    assert R.validar_envio("R1", "a@example.com", lead(), R.SaldoDia(frios=2), reg, QUI_10H).status == "bloqueado"
