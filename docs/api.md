# API: contract v1

Local base: `http://localhost:8000` (interactive documentation at `/docs`). JSON everywhere; dates in ISO-8601 with a timezone.
Authentication: `Authorization: Bearer <token>`.

- **Operator (panel)**: Google ID token, with the email registered in `crm.operadores`. An admin edits everything; the others edit only what is theirs and see everything. In development, with `AUTH_DEV=1`, the token `dev:<email>` signs in as that operator.
- **`bot` key** (`pf_…`): sees and changes only what belongs to its own operator.
- **`orquestrador` key** (n8n): routes `/orquestrador/*`, all operators.
- **`leitura` key**: read-only.

Generate keys with `python -m scripts.gerar_chave` (the key is shown once; the database stores only the hash).

Errors: `{"detail": "texto"}` with 400, 401, 403, 404, 409, or 422. Internal errors return a generic message; the detail goes to the log.

## Common

| Route | Who | What |
|---|---|---|
| `GET /saude` | public | `{ok, versao}` |
| `GET /eu` | everyone | `{email, nome, tipo, admin, operador}` |
| `GET /operadores` | operator | list with `regras`, `bcc`, `caixa` |
| `PATCH /operadores/{email}` | owner or admin | changes `regras`, `bcc`, `caixa` |
| `GET /painel?operador=` | operator | counts by stage, open tasks, unread reports, sends for the day |
| `GET /eventos?operador=&entidade=&limite=` | operator | activity feed |

## Tasks

Status: `pendente`, `entregue`, `em_andamento`, `executou`, `parcial`, `adiou`, `recusou`, `bloqueado_humano`, `falhou`, `cancelada`.
Type: `envio_diario`, `tratar_resposta`, `campainha`, `acompanhamento`, `resposta_operador`, `pergunta`.

| Route | Who | What |
|---|---|---|
| `GET /tarefas?operador=&status=&tipo=&dominio=&desde=&limite=` | operator | list, newest first, with a count by status |
| `GET /tarefas/{id}` | operator | task, timeline, and sends |
| `POST /tarefas` | operator | creates a manual task `{operador, tipo, titulo, instrucao, dominio?, prioridade?}` |
| `POST /tarefas/{id}/cancelar` | owner or admin | `{motivo}` |
| `POST /tarefas/{id}/reenviar` | owner or admin | returns to `pendente` and tries the webhook again |

## Bot (`/bot/*`)

| Route | What |
|---|---|
| `GET /bot/tarefas` | the queue. On listing, `pendente` becomes `entregue` |
| `POST /bot/tarefas/{id}/iniciar` | `em_andamento` |
| `POST /bot/tarefas/{id}/resultado` | returns the decision (below) |
| `GET /bot/diretrizes` | the operator's active guideline (or the default) |
| `POST /bot/diretrizes/propostas`, `GET /bot/diretrizes/propostas` | proposes a change (stays `proposta` until approval) and checks progress |
| `GET/POST /bot/campainhas`, `PATCH/DELETE /bot/campainhas/{id}` | own bells (DELETE archives) |
| `GET/POST /bot/acompanhamentos`, `PATCH/DELETE /bot/acompanhamentos/{id}` | same |
| `POST /bot/relatos`, `GET /bot/relatos?respondidos=1` | reports to the operator and reads the replies |
| `PUT /bot/webhook` | `{url}`; the HMAC secret is generated and returned once |

Task result:

```json
{ "status": "executou|parcial|adiou|recusou|bloqueado_humano",
  "motivo": "texto curto", "detalhe": "texto livre", "reagendar_em": null,
  "decisoes": [
    { "dominio": "acme-industrial.example", "decisao": "executou|adiou|recusou",
      "tipo_envio": "R1|R2|R3|reenvio_pos_bounce|redirect_auto_reply|resposta_in_thread",
      "rascunho": { "para": "compras@acme-industrial.example", "assunto": "…", "corpo_html": "<p>…</p>",
                    "anexos": ["catalogo"], "in_reply_to": null, "enviar_apos": null },
      "proxima_acao_em": "2026-10-09T09:00:00-03:00" } ] }
```

`adiou` requires `reagendar_em`; `recusou`, `bloqueado_humano`, and `parcial` require `motivo`. Each `rascunho` becomes an `envio`. The response includes `envios: [{id, dominio, status, motivo_bloqueio}]`, and the bot knows immediately whether any was blocked.

Webhook to the bot: `POST <webhook_url>` with `X-ProspectFlow-Evento: tarefa.nova`, `X-ProspectFlow-Assinatura: sha256=<hmac of the body>` and body `{evento, tarefa}`. 2xx marks the task as `entregue`; failure leaves it `pendente` and the tick tries again.

## Sends

Status: `aprovado`, `agendado`, `bloqueado`, `enviando`, `enviado`, `falhou`, `cancelado`.

| Route | Who | What |
|---|---|---|
| `GET /envios?operador=&status=&desde=` | operator | list |
| `POST /envios/{id}/liberar` | owner or admin | releases a blocked one (human exception, recorded) |
| `POST /envios/{id}/cancelar` | owner or admin | |

## Bells, follow-ups, and reports

| Route | Who | What |
|---|---|---|
| `GET/POST /campainhas`, `PATCH/DELETE /campainhas/{id}`, `GET /campainhas/{id}/disparos` | operator | bell: `tipo` `dominio`, `remetente`, or `assunto`, with `padrao` and `prioridade` |
| `GET/POST /acompanhamentos`, `PATCH/DELETE /acompanhamentos/{id}` | operator | scheduled reminder that becomes a task |
| `GET /relatos?operador=&nao_lidos=1` | operator | the operator's inbox |
| `POST /relatos/{id}/lido`, `POST /relatos/{id}/responder` | owner or admin | replying creates a `resposta_operador` task for the bot |

## Guidelines

Status: `ativa`, `proposta`, `rejeitada`, `substituida`.

| Route | Who | What |
|---|---|---|
| `GET /diretrizes?operador=`, `GET /diretrizes/{id}` | operator | versions; the panel builds the diff with `base_versao` |
| `POST /diretrizes` | owner or admin | publishes a new version (already `ativa`) |
| `POST /diretrizes/{id}/aprovar` | owner or admin | becomes `ativa`, the previous one becomes `substituida`, and the `regras` go to `operadores.regras` |
| `POST /diretrizes/{id}/rejeitar` | owner or admin | `{nota}`; the bot reads the reason |

## Leads

| Route | Who | What |
|---|---|---|
| `GET /leads?operador=&estagio=&teve_resposta=&busca=&ordenar=&limite=&offset=` | operator; bot (only its own) | list |
| `GET /leads/{dominio}` | same | lead, contacts, interactions, actions, and tasks |
| `POST /leads/{dominio}/contato` | owner; owning bot; orchestrator | records a contact; `recebido` classifies the interest |
| `POST /leads/{dominio}/estagio` | owner or admin; bot only `frio`, `aquecendo`, `respondeu`, `descartado` | changes the stage |
| `GET/POST /leads/{dominio}/acoes` | owner; owning bot | history of touches |

## Diary and board

| Route | What |
|---|---|
| `GET /diario?dia=AAAA-MM-DD&operador=` | the day's timeline with a summary and items (email sent, reply, bounce, decision, task…) |
| `GET /diario/dias?dias=30&operador=` | count per day for the calendar |
| `GET /board?dias=30&operador=` | funnel, reply and bounce rates, daily series, and hot leads for the period |

## Orchestrator (`/orquestrador/*`)

| Route | What |
|---|---|
| `POST /orquestrador/tick` | reopens postponed tasks, fires overdue follow-ups, retries webhooks, releases scheduled sends. Each step is idempotent |
| `POST /orquestrador/envio-diario` | builds the `envio_diario` task of each operator with an active bot. Deduplication key per operator and day |
| `GET /orquestrador/envios/prontos` | takes `aprovado` sends and marks them `enviando` (`FOR UPDATE SKIP LOCKED`) |
| `POST /orquestrador/envios/{id}/resultado` | `{ok, message_id?, erro?}`: `enviado` (records the action) or `falhou`. Idempotent |
| `GET /orquestrador/campainhas` | active bells, grouped by mailbox |
| `POST /orquestrador/campainhas/{id}/disparo` | records the firing, creates an urgent task and a report, without duplicating on `message_id` |
| `POST /orquestrador/inbound` | `{caixa, message_id, de, para, assunto, trecho, classe, redirect_para?, endereco_falhou?, in_reply_to?}`; finds the lead, records it, and creates `tratar_resposta`. A duplicate by `message_id` returns `duplicado: true` |
| `GET /orquestrador/avisos` | what to notify the operator about now; marks it as notified |
