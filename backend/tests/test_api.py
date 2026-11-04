"""Fluxo completo da API contra um Postgres com o schema de produção (ver conftest).

O login do painel usa o modo `AUTH_DEV=1` (token `dev:<email>`); as chaves de
API são reais, com o hash gravado no banco como em produção.
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta

import pytest

OP = "teste@example.com"
OUTRO = "outro@example.com"
JANELA_TOTAL = {"janela": {"dias": [1, 2, 3, 4, 5, 6, 7], "inicio": "00:00", "fim": "23:59"}}


@pytest.fixture(scope="module")
def monkeypatch_module():
    mp = pytest.MonkeyPatch()
    yield mp
    mp.undo()


@pytest.fixture(scope="module")
def ctx(banco_limpo, monkeypatch_module):
    import psycopg

    with psycopg.connect(banco_limpo, autocommit=True) as c:
        c.execute(
            "insert into crm.operadores (email, nome, admin, caixa, bcc, regras) values (%s,'Teste',false,%s,%s,%s)",
            (OP, OP, OP, psycopg.types.json.Jsonb(JANELA_TOTAL)),
        )
        c.execute("insert into crm.operadores (email, nome, admin) values (%s,'Outro',false)", (OUTRO,))
        for d in ("acme.example", "beta.example"):
            c.execute("insert into crm.leads (dominio, empresa, dono_email) values (%s,%s,%s)", (d, d.upper(), OP))
            c.execute(
                "insert into crm.contatos (lead_id, email) select id, 'compras@'||dominio from crm.leads where dominio=%s",
                (d,),
            )
        c.execute("insert into crm.leads (dominio, dono_email) values ('alheio.example', %s)", (OUTRO,))
        c.execute(
            """insert into crm.diretrizes (operador, versao, status, conteudo, autor, autor_tipo)
               values (null, 1, 'ativa', %s, 'seed', 'sistema')""",
            ("# Diretrizes padrão\n" + "linha\n" * 20,),
        )

    monkeypatch_module.setenv("DATABASE_URL", banco_limpo)
    monkeypatch_module.setenv("AUTH_DEV", "1")
    for var in ("LLM_API_URL", "LLM_API_KEY", "LLM_MODEL"):
        monkeypatch_module.delenv(var, raising=False)
    from app import auth, db, llm, servicos

    db.fechar()
    auth._cache.clear()
    fake = llm.ProvedorFake()
    servicos.usar_provedor(fake)

    chaves = {}
    with db.transacao() as cur:
        for nome, escopo, op in (("bot", "bot", OP), ("orq", "orquestrador", None), ("bot_outro", "bot", OUTRO)):
            k = auth.PREFIXO_CHAVE + secrets.token_urlsafe(16)
            cur.execute(
                "insert into chaves_api (hash_sha256, prefixo, nome, operador, escopo) values (%s,%s,%s,%s,%s)",
                (auth.hash_chave(k), k[:10], f"chave {nome}", op, escopo),
            )
            chaves[nome] = k
        cur.execute("insert into bots (operador, nome) values (%s, 'bot teste')", (OP,))

    from app.main import app
    from fastapi.testclient import TestClient

    cli = TestClient(app)

    def h(quem):
        tok = chaves.get(quem) or quem
        return {"Authorization": f"Bearer {tok}"}

    yield cli, h, fake
    servicos.usar_provedor(None)
    db.fechar()


def op(email=OP):
    return f"dev:{email}"


def test_fluxo_envio_diario(ctx):
    cli, h, _ = ctx
    r = cli.post("/orquestrador/envio-diario", headers=h("orq"))
    assert r.status_code == 200, r.text
    assert r.json()["criadas"][0]["candidatos"] == 2
    # De novo no mesmo dia: não duplica.
    assert cli.post("/orquestrador/envio-diario", headers=h("orq")).json()["criadas"] == []

    fila = cli.get("/bot/tarefas", headers=h("bot")).json()["tarefas"]
    assert len(fila) == 1 and fila[0]["tipo"] == "envio_diario"
    tid = fila[0]["id"]
    assert {l["dominio"] for l in fila[0]["payload"]["leads"]} == {"acme.example", "beta.example"}
    assert cli.get(f"/tarefas/{tid}", headers=h(op())).json()["status"] == "entregue"

    assert cli.post(f"/bot/tarefas/{tid}/iniciar", headers=h("bot")).status_code == 200
    rasc = {
        "para": "compras@acme.example",
        "assunto": "Acme: cadastro de fornecedor",
        "corpo_html": "<p>Olá</p>",
        "anexos": ["catalogo"],
    }
    r = cli.post(
        f"/bot/tarefas/{tid}/resultado",
        headers=h("bot"),
        json={
            "status": "parcial",
            "motivo": "contexto_lead",
            "detalhe": "beta fica pra depois",
            "decisoes": [
                {"dominio": "acme.example", "decisao": "executou", "tipo_envio": "R1", "rascunho": rasc},
                {
                    "dominio": "beta.example",
                    "decisao": "executou",
                    "tipo_envio": "R2",
                    "rascunho": {**rasc, "para": "compras@beta.example"},
                },
            ],
        },
    )
    assert r.status_code == 200, r.text
    envs = {e["dominio"]: e for e in r.json()["envios"]}
    assert envs["acme.example"]["status"] == "aprovado"
    assert envs["beta.example"]["status"] == "bloqueado" and "fora de ordem" in envs["beta.example"]["motivo_bloqueio"]

    prontos = cli.get("/orquestrador/envios/prontos", headers=h("orq")).json()["envios"]
    assert [e["dominio"] for e in prontos] == ["acme.example"] and prontos[0]["bcc"] == OP
    eid = prontos[0]["id"]
    assert (
        cli.post(
            f"/orquestrador/envios/{eid}/resultado", headers=h("orq"), json={"ok": True, "message_id": "<m1@example>"}
        ).status_code
        == 200
    )
    # Idempotente.
    assert cli.post(
        f"/orquestrador/envios/{eid}/resultado", headers=h("orq"), json={"ok": True, "message_id": "<m1@example>"}
    ).json()["idempotente"]

    lead = cli.get("/leads/acme.example", headers=h("bot")).json()
    assert lead["lead"]["rodada_atual"] == 1 and lead["lead"]["proximo_followup_em"]
    assert lead["acoes"][0]["tipo_acao"] == "mensagem_enviada" and lead["acoes"][0]["rodada"] == 1

    # Mesma R1 de novo: barrada (rodada já foi). R2 antes de 5 dias úteis: barrada pelo intervalo.
    t2 = cli.post("/tarefas", headers=h(op()), json={"operador": OP, "titulo": "teste", "dominio": "acme.example"}).json()
    r = cli.post(
        f"/bot/tarefas/{t2['id']}/resultado",
        headers=h("bot"),
        json={
            "status": "executou",
            "decisoes": [{"dominio": "acme.example", "decisao": "executou", "tipo_envio": "R2", "rascunho": rasc}],
        },
    )
    assert "intervalo" in r.json()["envios"][0]["motivo_bloqueio"]

    # Operador libera a exceção; vira aprovado.
    bloq = r.json()["envios"][0]["id"]
    assert cli.post(f"/envios/{bloq}/liberar", headers=h(op()), json={"motivo": "teste"}).json()["status"] == "aprovado"


def test_inbound_humano_e_bounce(ctx):
    cli, h, fake = ctx
    fake.respostas.append("real")
    r = cli.post(
        "/orquestrador/inbound",
        headers=h("orq"),
        json={
            "message_id": "<r1@acme>",
            "de": "joao@filial.acme.example",
            "assunto": "RE: Acme",
            "trecho": "Obrigado, podem enviar a cotação dos itens da página 4.",
            "classe": "humano",
            "in_reply_to": "<m1@example>",
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["lead"] == "acme.example" and r.json()["estagio_funil"] == "qualificado"
    assert len(fake.chamadas) == 1 and "página 4" in fake.chamadas[0][1]
    inter = cli.get("/leads/acme.example", headers=h("bot")).json()["interacoes"]
    assert [i["interesse"] for i in inter if i["direcao"] == "recebido"] == ["real"]
    # Duplicado não cria outra tarefa.
    assert cli.post(
        "/orquestrador/inbound",
        headers=h("orq"),
        json={"message_id": "<r1@acme>", "de": "joao@acme.example", "classe": "humano"},
    ).json()["duplicado"]

    r = cli.post(
        "/orquestrador/inbound",
        headers=h("orq"),
        json={
            "message_id": "<b1>",
            "de": "mailer-daemon@mail.example",
            "classe": "bounce",
            "endereco_falhou": "compras@beta.example",
        },
    )
    assert r.json()["lead"] == "beta.example"
    beta = cli.get("/leads/beta.example", headers=h("bot")).json()
    assert beta["lead"]["teve_resposta"] is False and beta["lead"]["estagio_funil"] == "frio"
    assert beta["contatos"][0]["invalido"] is True

    assert (
        cli.post(
            "/orquestrador/inbound",
            headers=h("orq"),
            json={"message_id": "<x>", "de": "alguem@naoelead.example", "classe": "humano"},
        ).json()["lead"]
        is None
    )


def test_alcance_do_bot(ctx):
    cli, h, _ = ctx
    assert cli.get("/leads/alheio.example", headers=h("bot")).status_code == 403
    assert all(l["dono_email"] == OP for l in cli.get("/leads?operador=" + OUTRO, headers=h("bot")).json()["leads"])
    r = cli.post("/leads/acme.example/estagio", headers=h("bot"), json={"estagio_funil": "qualificado"})
    assert r.status_code == 403
    assert cli.post("/leads/acme.example/estagio", headers=h("bot"), json={"estagio_funil": "descartado"}).status_code == 200
    assert cli.post("/leads/acme.example/estagio", headers=h("bot_outro"), json={"estagio_funil": "frio"}).status_code == 403
    assert cli.post("/orquestrador/tick", headers=h("bot")).status_code == 403
    assert cli.post("/diretrizes/x/aprovar", headers=h("bot"), json={}).status_code == 403


def test_tokens_invalidos(ctx):
    cli, h, _ = ctx
    assert cli.get("/eu").status_code == 401
    assert cli.get("/eu", headers={"Authorization": "Bearer pf_naoexiste"}).status_code == 401
    assert cli.get("/eu", headers=h(op("ninguem@example.com"))).status_code == 403
    eu = cli.get("/eu", headers=h(op())).json()
    assert eu["tipo"] == "operador" and eu["email"] == OP


def test_campainha(ctx):
    cli, h, _ = ctx
    c = cli.post(
        "/bot/campainhas",
        headers=h("bot"),
        json={"nome": "Cotação Acme", "tipo": "dominio", "padrao": "ACME.example", "instrucao": "avisar na hora"},
    ).json()
    assert c["criada_por_tipo"] == "bot" and c["padrao"] == "acme.example"
    caixas = cli.get("/orquestrador/campainhas", headers=h("orq")).json()["caixas"]
    assert caixas[0]["caixa"] == OP and caixas[0]["campainhas"][0]["id"] == c["id"]

    disp = {"message_id": "<c1>", "de": "compras@acme.example", "assunto": "Cotação 123", "trecho": "segue lista"}
    r = cli.post(f"/orquestrador/campainhas/{c['id']}/disparo", headers=h("orq"), json=disp).json()
    assert r["tarefa_id"]
    assert cli.post(f"/orquestrador/campainhas/{c['id']}/disparo", headers=h("orq"), json=disp).json()["duplicado"]
    t = cli.get(f"/tarefas/{r['tarefa_id']}", headers=h(op())).json()
    assert t["prioridade"] == "urgente" and t["tipo"] == "campainha"

    avisos = cli.get("/orquestrador/avisos", headers=h("orq")).json()["avisos"]
    assert any("Cotação Acme" in a["titulo"] for a in avisos)
    assert cli.get("/orquestrador/avisos", headers=h("orq")).json()["avisos"] == []  # já avisado

    assert cli.delete(f"/bot/campainhas/{c['id']}", headers=h("bot")).status_code == 200
    assert cli.get("/orquestrador/campainhas", headers=h("orq")).json()["caixas"] == []
    assert cli.delete(f"/campainhas/{c['id']}", headers=h(op(OUTRO))).status_code == 403


def test_acompanhamento_e_adiamento_no_tick(ctx):
    cli, h, _ = ctx
    passado = (datetime.now(UTC) - timedelta(minutes=5)).isoformat()
    a = cli.post(
        "/bot/acompanhamentos",
        headers=h("bot"),
        json={
            "titulo": "Checar proposta da Acme",
            "agendado_para": passado,
            "repetir_dias": 7,
            "dominio": "acme.example",
        },
    ).json()
    t = cli.post("/tarefas", headers=h(op()), json={"operador": OP, "titulo": "pergunta"}).json()
    assert (
        cli.post(
            f"/bot/tarefas/{t['id']}/resultado", headers=h("bot"), json={"status": "adiou", "reagendar_em": passado}
        ).status_code
        == 200
    )
    assert cli.post(f"/bot/tarefas/{t['id']}/resultado", headers=h("bot"), json={"status": "adiou"}).status_code == 422

    r = cli.post("/orquestrador/tick", headers=h("orq")).json()
    assert r["acompanhamentos_disparados"] == 1 and r["tarefas_reabertas"] == 1
    a2 = [x for x in cli.get("/bot/acompanhamentos", headers=h("bot")).json()["acompanhamentos"] if x["id"] == a["id"]][0]
    assert a2["status"] == "agendado" and a2["ultimo_disparo_em"]  # recorrente: reagendado
    assert cli.post("/orquestrador/tick", headers=h("orq")).json().get("acompanhamentos_disparados", 0) == 0


def test_diretriz_proposta_pelo_bot_so_vale_aprovada(ctx):
    cli, h, _ = ctx
    v1 = cli.get("/bot/diretrizes", headers=h("bot")).json()
    assert v1["versao"] == 1 and v1["operador"] is None
    p = cli.post(
        "/bot/diretrizes/propostas",
        headers=h("bot"),
        json={
            "conteudo": "# Diretrizes do Teste\n" + "regra nova\n" * 10,
            "regras": {"teto_frios": 15},
            "motivo": "Teto menor reduz bounce",
            "base_versao": 1,
        },
    ).json()
    assert p["status"] == "proposta"
    assert cli.get("/bot/diretrizes", headers=h("bot")).json()["versao"] == 1  # ainda não vale
    assert cli.post(f"/diretrizes/{p['id']}/aprovar", headers=h(op(OUTRO)), json={}).status_code == 403
    assert cli.post(f"/diretrizes/{p['id']}/aprovar", headers=h(op()), json={"nota": "ok"}).status_code == 200
    ativa = cli.get("/bot/diretrizes", headers=h("bot")).json()
    assert ativa["id"] == p["id"] and ativa["regras"]["teto_frios"] == 15
    assert any(t["titulo"].startswith("Diretriz v") for t in cli.get("/bot/tarefas", headers=h("bot")).json()["tarefas"])
    d = cli.get(f"/diretrizes/{p['id']}", headers=h(op())).json()
    assert d["base"]["versao"] == 1


def test_relato_e_resposta(ctx):
    cli, h, _ = ctx
    r = cli.post(
        "/bot/relatos",
        headers=h("bot"),
        json={"tipo": "pergunta", "titulo": "Posso responder sobre prazo de entrega?", "dominio": "acme.example"},
    ).json()
    assert cli.post(f"/relatos/{r['id']}/responder", headers=h(op()), json={"resposta": "Pode."}).status_code == 200
    resp = cli.get("/bot/relatos?respondidos=1", headers=h("bot")).json()["relatos"]
    assert resp[0]["resposta"] == "Pode."
    painel = cli.get("/painel", headers=h(op())).json()
    assert painel["total_leads"] == 3 and "por_estagio" in painel
    ev = cli.get("/eventos?limite=500", headers=h(op())).json()["eventos"]
    assert {"criou", "enviou", "tocou", "ativou", "respondeu"} <= {e["acao"] for e in ev}


def test_diario(ctx):
    cli, h, _ = ctx
    d = cli.get(f"/diario?operador={OP}", headers=h(op())).json()
    tipos = {x["tipo"] for x in d["itens"]}
    assert {"email_enviado", "resposta", "bounce", "tarefa", "campainha"} <= tipos, tipos
    env = [x for x in d["itens"] if x["tipo"] == "email_enviado"][0]
    assert env["dominio"] == "acme.example" and env["para"] == "compras@acme.example"
    assert env["assunto"] == "Acme: cadastro de fornecedor" and env["titulo"] == "R1"
    assert d["resumo"]["emails_enviados"] == 1 and d["resumo"]["rodadas"] == 1 and d["resumo"]["bounces"] >= 1
    # Bot só vê o próprio operador, mesmo pedindo outro.
    assert cli.get(f"/diario?operador={OUTRO}", headers=h("bot")).json()["operador"] == OP
    # Descrição em texto livre (formato antigo das ações) também é lida.
    from app.rotas_diario import _item_acao

    it = _item_acao(
        {
            "id": 1,
            "tipo_acao": "mensagem_enviada",
            "rodada": 2,
            "data_hora": None,
            "dominio": "x",
            "empresa": None,
            "dono_email": OP,
            "realizado_por": "bot",
            "proxima_acao_em": None,
            "descricao": "Rodada 2/3 – e-mail para compras@example.com – assunto: X: seguindo – resumo: ângulo novo",
        }
    )
    assert (it["para"], it["assunto"], it["detalhe"]) == ("compras@example.com", "X: seguindo", "ângulo novo")
    dias = cli.get("/diario/dias?dias=7", headers=h(op())).json()["dias"]
    assert len(dias) == 7 and dias[-1]["emails"] >= 1
    assert cli.get("/diario?dia=ontem", headers=h(op())).status_code == 422


def test_board(ctx):
    cli, h, _ = ctx
    b = cli.get(f"/board?dias=30&operador={OP}", headers=h(op()))
    assert b.status_code == 200, b.text
    b = b.json()
    assert len(b["serie"]) == 30 and b["periodo"]["emails"] >= 1
    etapas = [f["n"] for f in b["funil"]]
    assert etapas[0] >= 1 and etapas == sorted(etapas, reverse=True), etapas
    assert b["carteira"]["total"] == 2 and [o["operador"] for o in b["operadores"]] == [OP]
    # Bot só vê o próprio operador.
    assert cli.get(f"/board?operador={OUTRO}", headers=h("bot")).json()["operador"] == OP
