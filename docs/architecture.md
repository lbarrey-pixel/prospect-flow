# Architecture

## Principles

1. **The operator is in charge.** The bot has tactical autonomy (text, angle, time, whether or not to execute, reporting). A guideline change takes effect only after the operator approves it on the panel.
2. **Verifiable rules live in the API.** Daily cap, interval between touches, round, time window, and lead stage are checked on the server, not in the bot's prompt.
3. **Everything is visible.** Task, decision, send, bell, follow-up, report, and guideline proposal show up on the panel. Every write records a row in `crm.eventos`.
4. **No paid infrastructure by default.** One Postgres, one API, and one n8n in Docker are enough.

## Parts

```
        panel (React) ── Google ID token ──┐
                                           ▼
   bot ── "bot" key ──►  API (FastAPI)  ◄── "orquestrador" key ── n8n
    ▲                     │   │                                │ cron · IMAP · SMTP
    └── webhook (HMAC) ───┘   │ psycopg, role crm_api          │ notices to the operator
                              ▼
                      Postgres · schema crm
```

- **API**: owns the state and the rules. Validates the bot's draft before releasing the send. Never speaks SMTP.
- **n8n**: clock, inboxes, SMTP, and notices. It does not decide tactics; it delivers the task and the context.
- **Bot**: any agent that speaks HTTP. It receives tasks by webhook or by pulling `GET /bot/tarefas`, returns the decision, takes care of its own bells and follow-ups, reports to the operator, and proposes guidelines.
- **Panel**: task board, sends, leads, the day's diary, activity, guidelines, and reports.

## Database: schema `crm`

Only the `crm_api` role has permission on the schema. The API connects with it; the rest of the database, if it exists, stays out of reach by permission.

| Table | What it is for |
|---|---|
| `operadores` | email, name, admin, sending mailbox, BCC, and `regras` (adjustable limits) |
| `leads`, `contatos`, `interacoes`, `acoes` | the book of business: one company per domain, contacts, emails exchanged, and the bot's touches |
| `chaves_api` | SHA-256 hash, operator, scope (`bot`, `orquestrador`, `leitura`) |
| `bots` | one per operator: webhook URL, HMAC secret, active |
| `tarefas` | the queue and the board: type, status, priority, payload, response, reason |
| `envios` | the bot's draft, validated and sent by n8n (or blocked, with a reason) |
| `campainhas`, `campainha_disparos` | what to watch in the mailboxes and each email that rang |
| `acompanhamentos` | scheduled reminders that become a task on the date |
| `relatos` | the bot reporting to the operator: info, alerta, pergunta, authorization request |
| `diretrizes` | versions per operator. `proposta` becomes `ativa` only with human approval |
| `eventos` | audit of every write |

## Lifecycle of a task

```
pendente ─► entregue ─► em_andamento ─► executou | parcial | adiou | recusou | bloqueado_humano
    │           (webhook ok or the bot pulled)    │
    └─► cancelada (human)      falhou (error)     └─ adiou + reagendar_em → returns to pendente on the tick
```

An executed `envio_diario` produces `envios`, one per email. Each send goes through the operator's rules:

- **aprovado**: n8n sends it;
- **agendado**: outside the window, it goes out at the next valid time;
- **bloqueado**: it breached the cap, the interval, the round, or the stage. The reason shows on the panel and the operator can release the exception.

n8n sends and returns the `message_id`. Only then does the API record the action with the round. No email goes out without a record, and there is no record of an email that did not go out.

## The three n8n flows

| Flow | Trigger | What it does |
|---|---|---|
| Daily send | cron, morning of a business day | `POST /orquestrador/envio-diario`: the API filters the candidates that each operator's rules allow touching today and delivers **one** task to the bot |
| Reply received | IMAP, new email | classifies bounce, automatic reply, redirect, or human; `POST /orquestrador/inbound` creates the `tratar_resposta` task; checks bells |
| Clock | cron, every 5 min | `POST /orquestrador/tick`: reopens postponed tasks, fires follow-ups, revalidates scheduled sends, retries webhooks that failed; then notifies the operator by email |

A fourth flow (`03_enviar_emails`) pulls the approved sends, sends them by SMTP one at a time with a random pause, and returns the result to the API. `99_erros` notifies the administrator if any workflow fails.

## Default operator rules (`operadores.regras`)

```json
{
  "teto_frios": 20, "teto_respondeu": 5,
  "intervalo_dias_uteis": 5, "max_rodadas": 3, "ciclo_dias": 90,
  "janela": {"dias": [1,2,3,4,5], "inicio": "08:00", "fim": "17:00", "tz": "America/Sao_Paulo"},
  "contam_no_teto": ["R1", "R2", "R3"],
  "estagios_nutriveis": ["frio", "aquecendo", "respondeu"]
}
```

Only R1, R2, and R3 count toward the cap and the interval. A resend after a bounce, an automatic-reply redirect, and a reply inside the conversation do not count. Each operator's rules are merged on top of this default (`regras_efetivas`), and the calculation lives in `backend/app/regras.py`, with no I/O, covered by unit tests.

## Reply classification

A human reply goes through `ProvedorLLM` (`backend/app/llm.py`), which returns `real` or `generico`. There are three adapters: generic HTTP (chat completions, configured by `LLM_API_URL`, `LLM_API_KEY`, `LLM_MODEL`), null (no configuration, everything becomes `generico`), and fake (tests). A network error or a strange response falls back to `generico` and goes to the log; the client never sees the exception text.
