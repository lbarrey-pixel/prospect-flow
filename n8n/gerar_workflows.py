"""Gera os workflows do n8n (n8n/workflows/*.json) a partir deste arquivo.

Por que gerar em vez de editar o JSON à mão: código JavaScript dentro de JSON
escapado é ilegível e quebra fácil. Aqui o código fica legível, e o JSON sai
válido e sem credencial nenhuma (as credenciais são referenciadas pelo NOME
que você cria no n8n; os segredos do nó Code vêm de variáveis de ambiente do
Docker, ver n8n/docker-compose.yml).

    python n8n/gerar_workflows.py           # escreve n8n/workflows/*.json
    python n8n/gerar_workflows.py --check   # falha se os JSONs versionados estiverem desatualizados
"""

from __future__ import annotations

import json
import sys
import uuid
from pathlib import Path

SAIDA = Path(__file__).parent / "workflows"
CRED_API = {"httpHeaderAuth": {"id": "cred-api-orquestrador", "name": "Prospect Flow orquestrador"}}
CRED_SMTP_AVISOS = {"smtp": {"id": "cred-smtp-avisos", "name": "SMTP avisos"}}
CRED_IMAP = {"imap": {"id": "cred-imap-operador", "name": "IMAP operador"}}


NS = uuid.UUID("6f1c2f0e-6a52-4c57-9d0b-3f1d6f0a9b11")
_ctx = {"wf": ""}


def _id(nome=""):
    # Determinístico: o mesmo nó sempre recebe o mesmo id, então o JSON só muda quando o fluxo muda.
    return str(uuid.uuid5(NS, f"{_ctx['wf']}/{nome}"))


def no(nome, tipo, versao, pos, params, cred=None, **extra):
    n = {"id": _id(nome), "name": nome, "type": tipo, "typeVersion": versao, "position": list(pos), "parameters": params}
    if cred:
        n["credentials"] = cred
    n.update(extra)
    return n


def http(nome, pos, metodo, caminho, corpo=None, timeout=90000):
    """Chamada à API. Timeout longo e 3 tentativas: a API pode estar subindo ou atrás de um host que hiberna."""
    p = {
        "method": metodo,
        "url": f"={{{{ $env.PF_API_URL }}}}{caminho}",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "options": {"timeout": timeout},
    }
    if corpo is not None:
        p.update({"sendBody": True, "specifyBody": "json", "jsonBody": corpo})
    return no(nome, "n8n-nodes-base.httpRequest", 4.2, pos, p, CRED_API, retryOnFail=True, maxTries=3, waitBetweenTries=5000)


def agenda(nome, pos, cron):
    return no(
        nome,
        "n8n-nodes-base.scheduleTrigger",
        1.2,
        pos,
        {"rule": {"interval": [{"field": "cronExpression", "expression": cron}]}},
    )


def codigo(nome, pos, js, modo="runOnceForAllItems"):
    return no(nome, "n8n-nodes-base.code", 2, pos, {"mode": modo, "jsCode": js.strip()})


def ligar(*pares):
    """pares: (origem, destino[, saida])"""
    con = {}
    for par in pares:
        a, b = par[0], par[1]
        saida = par[2] if len(par) > 2 else 0
        alvo = con.setdefault(a["name"], {"main": []})["main"]
        while len(alvo) <= saida:
            alvo.append([])
        alvo[saida].append({"node": b["name"], "type": "main", "index": 0})
    return con


def workflow(nome, nos, conexoes, notas=""):
    return {
        "name": nome,
        "nodes": nos,
        "connections": conexoes,
        "active": False,
        "settings": {
            "executionOrder": "v1",
            "timezone": "America/Sao_Paulo",
            "saveDataErrorExecution": "all",
            "saveDataSuccessExecution": "none",
            "errorWorkflow": "",
        },
        "meta": {"templateCredsSetupCompleted": False, "descricao": notas},
        "tags": [{"name": "prospect-flow"}],
    }


def nota(texto, pos, largura=420, altura=200):
    return no("Nota", "n8n-nodes-base.stickyNote", 1, pos, {"content": texto, "width": largura, "height": altura})


# ── 01 · Relógio: tick + avisos ao operador ──────────────────────────────────
def wf_relogio():
    gat = agenda("A cada 5 min (7h–20h, seg–sex)", (0, 0), "*/5 7-20 * * 1-5")
    tick = http("Tick (adiadas, acompanhamentos, agendados, webhooks)", (240, 0), "POST", "/orquestrador/tick")
    avisos = http("Buscar avisos", (480, 0), "GET", "/orquestrador/avisos")
    separar = codigo(
        "Um item por aviso",
        (720, 0),
        """
const r = $input.first().json;
return (r.avisos || []).map(a => ({ json: { ...a, painel: r.painel } }));
""",
    )
    email = no(
        "Avisar o operador por e-mail",
        "n8n-nodes-base.emailSend",
        2.1,
        (960, 0),
        {
            "fromEmail": "={{ $env.CRM_AVISOS_REMETENTE }}",
            "toEmail": "={{ $json.caixa || $json.operador }}",
            "subject": "={{ ($json.urgente ? '[URGENTE] ' : '') + '[Prospect Flow] ' + $json.titulo }}",
            "emailFormat": "text",
            "text": "={{ ($json.corpo || '') + '\\n\\nTipo: ' + $json.tipo + '\\nAbrir o painel: ' + ($json.painel || '') }}",
            "options": {},
        },
        CRED_SMTP_AVISOS,
    )
    n = nota(
        "## Relógio do Prospect Flow\nO n8n só dá o compasso: o `tick` reabre tarefas adiadas, dispara "
        "acompanhamentos vencidos, revalida envios agendados e tenta de novo os webhooks do bot. "
        "Depois, avisa o operador do que é urgente (relatos, campainhas, lead qualificado).",
        (0, -260),
    )
    return workflow(
        "Prospect Flow · 01 · Relógio e avisos",
        [n, gat, tick, avisos, separar, email],
        ligar((gat, tick), (tick, avisos), (avisos, separar), (separar, email)),
    )


# ── 02 · Envio diário ────────────────────────────────────────────────────────
def wf_envio_diario():
    gat = agenda("09:00 seg–sex", (0, 0), "0 9 * * 1-5")
    acordar = http("Acordar a API", (240, 0), "GET", "/saude")
    montar = http("Montar a tarefa envio_diario de cada operador", (480, 0), "POST", "/orquestrador/envio-diario")
    n = nota(
        "## Envio diário\nA API filtra os candidatos que as regras de cada operador permitem tocar hoje "
        "(estágio, rodada, intervalo, teto) e entrega UMA tarefa ao bot. Quem tocar, o texto e o ângulo "
        "são decisão do bot, e ele pode recusar.",
        (0, -260),
    )
    return workflow("Prospect Flow · 02 · Envio diário", [n, gat, acordar, montar], ligar((gat, acordar), (acordar, montar)))


# ── 03 · Enviar e-mails aprovados ────────────────────────────────────────────
JS_ENVIAR = r"""
// Monta o e-mail a partir do modelo HTML local e envia por SMTP (nodemailer, que já vem no n8n).
// Por que Code e não o nó "Send Email": In-Reply-To/References precisam sair para R2/R3
// ficarem na mesma conversa, e anexos variam por envio.
// Segredos vêm do ambiente do container (nunca do canvas):
//   CRM_SMTP = {"ana@example.com": {"host":"...","port":587,"secure":false,"user":"...","pass":"..."}}
//   CRM_TEMPLATES_DIR (padrão /templates, montado pelo docker-compose)
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const e = $json;
const smtp = JSON.parse($env.CRM_SMTP || '{}')[e.caixa];
if (!smtp) return { json: { envio_id: e.id, ok: false, erro: `sem SMTP configurado para ${e.caixa}` } };

const pasta = $env.CRM_TEMPLATES_DIR || '/templates';
const modelo = fs.readFileSync(path.join(pasta, 'modelo_email.html'), 'utf8');
const html = modelo.replace(/<!--[\s\S]*?-->/, '').replace('{{CORPO}}', e.corpo_html);

const ARQUIVOS = { catalogo: 'catalogo.pdf', ficha_cadastral: 'ficha_cadastral.pdf' };
const anexos = [];
for (const a of e.anexos || []) {
  const arq = ARQUIVOS[a] && path.join(pasta, 'anexos', ARQUIVOS[a]);
  if (arq && fs.existsSync(arq)) anexos.push({ filename: ARQUIVOS[a], content: fs.readFileSync(arq) });
}

try {
  const t = nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: !!smtp.secure,
                                         auth: { user: smtp.user, pass: smtp.pass } });
  const info = await t.sendMail({
    from: e.caixa, to: e.para, bcc: e.bcc || undefined, subject: e.assunto, html, attachments: anexos,
    inReplyTo: e.in_reply_to || undefined, references: e.in_reply_to || undefined,
  });
  return { json: { envio_id: e.id, ok: true, message_id: info.messageId } };
} catch (err) {
  return { json: { envio_id: e.id, ok: false, erro: String(err.message || err).slice(0, 500) } };
}
"""


def wf_enviar():
    gat = agenda("A cada 3 min (8h–17h, seg–sex)", (0, 0), "*/3 8-16 * * 1-5")
    prontos = http("Pegar envios aprovados", (240, 0), "GET", "/orquestrador/envios/prontos?limite=10")
    separar = codigo("Um item por envio", (480, 0), "return ($input.first().json.envios || []).map(e => ({ json: e }));")
    lote = no("Um de cada vez", "n8n-nodes-base.splitInBatches", 3, (720, 0), {"batchSize": 1, "options": {}})
    enviar = codigo("Montar e enviar (SMTP)", (960, 100), JS_ENVIAR, modo="runOnceForEachItem")
    resultado = http(
        "Registrar resultado na API",
        (1200, 100),
        "POST",
        "=/orquestrador/envios/{{ $json.envio_id }}/resultado",
        corpo="={{ JSON.stringify({ ok: $json.ok, message_id: $json.message_id, erro: $json.erro }) }}",
    )
    resultado["parameters"]["url"] = "={{ $env.PF_API_URL }}/orquestrador/envios/{{ $json.envio_id }}/resultado"
    pausa = no(
        "Pausa de 20–40 s",
        "n8n-nodes-base.wait",
        1.1,
        (1440, 100),
        {"amount": "={{ 20 + Math.floor(Math.random() * 21) }}", "unit": "seconds"},
    )
    n = nota(
        "## Envio de e-mail\nSó sai o que a API aprovou (teto, intervalo, rodada, janela). Depois do SMTP, "
        "o resultado volta para a API, que grava a ação com a rodada. Se o registro falhar, o envio fica "
        "`enviando` e aparece no painel: nunca sai e-mail sem rastro.",
        (0, -260),
        460,
    )
    return workflow(
        "Prospect Flow · 03 · Enviar e-mails aprovados",
        [n, gat, prontos, separar, lote, enviar, resultado, pausa],
        ligar(
            (gat, prontos),
            (prontos, separar),
            (separar, lote),
            (lote, enviar, 1),
            (enviar, resultado),
            (resultado, pausa),
            (pausa, lote),
        ),
    )


# ── 04 · Caixa de entrada (um por operador) ──────────────────────────────────
JS_CLASSIFICAR = r"""
// Classifica o e-mail recebido e confere as campainhas. Regras simples e
// explicáveis; o que for resposta de gente vai para a classificação da API.
const campainhas = ($('Campainhas ativas').first().json.caixas || [])
  .filter(c => c.caixa === $env.CRM_CAIXA_ATUAL).flatMap(c => c.campainhas);
const saida = [];
for (const item of $('Novo e-mail').all()) {
  const m = item.json;
  const h = m.headers || {};
  const cab = (k) => String(h[k] || h[k.toLowerCase()] || '').toLowerCase();
  const de = String(m.from?.value?.[0]?.address || m.from || '').toLowerCase();
  const assunto = String(m.subject || '');
  const texto = String(m.text || m.textPlain || '').slice(0, 4000);
  const mid = m.messageId || m['message-id'] || cab('message-id');

  let classe = 'humano', endereco_falhou = null, redirect_para = null;
  if (/mailer-daemon|postmaster/.test(de) || /undeliverable|delivery status notification|não foi possível entregar|returned mail|falha na entrega/i.test(assunto)) {
    classe = 'bounce';
    const fr = texto.match(/final-recipient:.*?;\s*([^\s>]+@[^\s>]+)/i) || texto.match(/([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i);
    endereco_falhou = fr ? fr[1].toLowerCase() : null;
  } else if (cab('auto-submitted').startsWith('auto') || cab('x-autoreply') || cab('x-autorespond') ||
             /resposta automática|automatic reply|out of office|ausente|férias|ferias/i.test(assunto)) {
    classe = 'auto_reply';
    const dominio = de.split('@')[1];
    const outros = (texto.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [])
      .map(x => x.toLowerCase()).filter(x => x !== de && x.endsWith('@' + dominio));
    if (outros.length) { classe = 'redirect'; redirect_para = outros[0]; }
  }

  const inbound = { caixa: $env.CRM_CAIXA_ATUAL, message_id: mid, de, para: String(m.to?.text || m.to || ''),
                    assunto, trecho: texto, classe, endereco_falhou, redirect_para,
                    in_reply_to: m.inReplyTo || cab('in-reply-to') || null };
  const tocou = campainhas.filter(c =>
    (c.tipo === 'dominio' && (de.endsWith('@' + c.padrao) || de.endsWith('.' + c.padrao))) ||
    (c.tipo === 'remetente' && de === c.padrao) ||
    (c.tipo === 'assunto' && assunto.toLowerCase().includes(c.padrao)));
  saida.push({ json: { inbound, disparos: tocou.map(c => ({ campainha_id: c.id, message_id: mid, de, assunto,
                                                            trecho: texto.slice(0, 1500), recebido_em: m.date })) } });
}
return saida;
"""


def wf_caixa():
    gat = no(
        "Novo e-mail",
        "n8n-nodes-base.emailReadImap",
        2,
        (0, 0),
        {
            "mailbox": "INBOX",
            "postProcessAction": "nothing",
            "format": "resolved",
            "options": {"customEmailConfig": '["UNSEEN"]'},
        },
        CRED_IMAP,
    )
    camp = http("Campainhas ativas", (240, 0), "GET", "/orquestrador/campainhas")
    camp["executeOnce"] = True
    classif = codigo("Classificar (bounce, auto-reply, redirect, humano) e conferir campainhas", (480, 0), JS_CLASSIFICAR)
    inbound = http(
        "Entregar à API (/inbound)", (760, -100), "POST", "/orquestrador/inbound", corpo="={{ JSON.stringify($json.inbound) }}"
    )
    disparos = codigo(
        "Um item por campainha que tocou",
        (760, 120),
        "return $input.all().flatMap(i => (i.json.disparos || []).map(d => ({ json: d })));",
    )
    tocar = http(
        "Tocar a campainha",
        (1000, 120),
        "POST",
        "/orquestrador/campainhas/x/disparo",
        corpo="={{ JSON.stringify({ message_id: $json.message_id, de: $json.de, assunto: $json.assunto, trecho: $json.trecho, recebido_em: $json.recebido_em }) }}",
    )
    tocar["parameters"]["url"] = "={{ $env.PF_API_URL }}/orquestrador/campainhas/{{ $json.campainha_id }}/disparo"
    n = nota(
        "## Caixa de entrada\nLê só e-mails novos (não marca como lido, não move nada). "
        "Bounce e resposta automática NÃO passam pela classificação de interesse (não são resposta do lead). "
        "Toda mensagem de lead vira tarefa `tratar_resposta`; campainha que tocou vira tarefa urgente + aviso. "
        "Defina CRM_CAIXA_ATUAL no ambiente desta instância (ou duplique este workflow por caixa).",
        (0, -280),
        520,
        220,
    )
    return workflow(
        "Prospect Flow · 04 · Caixa de entrada",
        [n, gat, camp, classif, inbound, disparos, tocar],
        ligar((gat, camp), (camp, classif), (classif, inbound), (classif, disparos), (disparos, tocar)),
    )


# ── 99 · Erros ───────────────────────────────────────────────────────────────
def wf_erros():
    gat = no("Erro em qualquer workflow", "n8n-nodes-base.errorTrigger", 1, (0, 0), {})
    email = no(
        "Avisar o administrador",
        "n8n-nodes-base.emailSend",
        2.1,
        (260, 0),
        {
            "fromEmail": "={{ $env.CRM_AVISOS_REMETENTE }}",
            "toEmail": "={{ $env.CRM_AVISOS_ADMIN }}",
            "subject": "=[Prospect Flow] Falha no workflow {{ $json.workflow.name }}",
            "emailFormat": "text",
            "text": "={{ 'Nó: ' + ($json.execution.lastNodeExecuted || '?') + '\\nErro: ' + ($json.execution.error?.message || '?') + '\\nExecução: ' + ($json.execution.url || '') }}",
            "options": {},
        },
        CRED_SMTP_AVISOS,
    )
    return workflow("Prospect Flow · 99 · Erros", [gat, email], ligar((gat, email)))


def todos():
    fabricas = {
        "01_relogio": wf_relogio,
        "02_envio_diario": wf_envio_diario,
        "03_enviar_emails": wf_enviar,
        "04_caixa_entrada": wf_caixa,
        "99_erros": wf_erros,
    }
    for nome, f in fabricas.items():
        _ctx["wf"] = nome
        yield nome, json.dumps(f(), ensure_ascii=False, indent=2) + "\n"


if __name__ == "__main__":
    checar = "--check" in sys.argv
    SAIDA.mkdir(exist_ok=True)
    desatualizados = []
    for nome, texto in todos():
        arq = SAIDA / f"{nome}.json"
        if checar:
            if not arq.exists() or arq.read_text(encoding="utf-8") != texto:
                desatualizados.append(arq.name)
        else:
            arq.write_text(texto, encoding="utf-8")
            print("gerado", nome)
    if desatualizados:
        sys.exit("desatualizado (rode python n8n/gerar_workflows.py): " + ", ".join(desatualizados))
