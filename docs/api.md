# API: contrato v1

Base local: `http://localhost:8000` (documentação interativa em `/docs`). JSON em tudo; datas em ISO-8601 com fuso.
Autenticação: `Authorization: Bearer <token>`.

- **Operador (painel)**: ID token do Google, com o e-mail cadastrado em `crm.operadores`. Admin edita tudo; os demais editam só o que é deles e veem tudo. Em desenvolvimento, com `AUTH_DEV=1`, o token `dev:<email>` entra como aquele operador.
- **Chave `bot`** (`pf_…`): enxerga e mexe só no que é do próprio operador.
- **Chave `orquestrador`** (n8n): rotas `/orquestrador/*`, todos os operadores.
- **Chave `leitura`**: só leitura.

Gere chaves com `python -m scripts.gerar_chave` (a chave aparece uma vez; o banco guarda só o hash).

Erros: `{"detail": "texto"}` com 400, 401, 403, 404, 409 ou 422. Erros internos devolvem mensagem genérica; o detalhe vai para o log.

## Comuns

| Rota | Quem | O quê |
|---|---|---|
| `GET /saude` | livre | `{ok, versao}` |
| `GET /eu` | todos | `{email, nome, tipo, admin, operador}` |
| `GET /operadores` | operador | lista com `regras`, `bcc`, `caixa` |
| `PATCH /operadores/{email}` | dono ou admin | altera `regras`, `bcc`, `caixa` |
| `GET /painel?operador=` | operador | contagens por estágio, tarefas abertas, relatos não lidos, envios do dia |
| `GET /eventos?operador=&entidade=&limite=` | operador | feed de atividade |

## Tarefas

Status: `pendente`, `entregue`, `em_andamento`, `executou`, `parcial`, `adiou`, `recusou`, `bloqueado_humano`, `falhou`, `cancelada`.
Tipo: `envio_diario`, `tratar_resposta`, `campainha`, `acompanhamento`, `resposta_operador`, `pergunta`.

| Rota | Quem | O quê |
|---|---|---|
| `GET /tarefas?operador=&status=&tipo=&dominio=&desde=&limite=` | operador | lista, mais recentes primeiro, com contagem por status |
| `GET /tarefas/{id}` | operador | tarefa, linha do tempo e envios |
| `POST /tarefas` | operador | cria tarefa manual `{operador, tipo, titulo, instrucao, dominio?, prioridade?}` |
| `POST /tarefas/{id}/cancelar` | dono ou admin | `{motivo}` |
| `POST /tarefas/{id}/reenviar` | dono ou admin | volta para `pendente` e tenta o webhook de novo |

## Bot (`/bot/*`)

| Rota | O quê |
|---|---|
| `GET /bot/tarefas` | a fila. Ao listar, `pendente` vira `entregue` |
| `POST /bot/tarefas/{id}/iniciar` | `em_andamento` |
| `POST /bot/tarefas/{id}/resultado` | devolve a decisão (abaixo) |
| `GET /bot/diretrizes` | diretriz ativa do operador (ou a padrão) |
| `POST /bot/diretrizes/propostas`, `GET /bot/diretrizes/propostas` | propõe mudança (fica `proposta` até aprovação) e consulta o andamento |
| `GET/POST /bot/campainhas`, `PATCH/DELETE /bot/campainhas/{id}` | campainhas próprias (DELETE arquiva) |
| `GET/POST /bot/acompanhamentos`, `PATCH/DELETE /bot/acompanhamentos/{id}` | idem |
| `POST /bot/relatos`, `GET /bot/relatos?respondidos=1` | reporta ao operador e lê as respostas |
| `PUT /bot/webhook` | `{url}`; o segredo HMAC é gerado e devolvido uma vez |

Resultado da tarefa:

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

`adiou` exige `reagendar_em`; `recusou`, `bloqueado_humano` e `parcial` exigem `motivo`. Cada `rascunho` vira um `envio`. A resposta traz `envios: [{id, dominio, status, motivo_bloqueio}]`, e o bot sabe na hora se algum foi barrado.

Webhook para o bot: `POST <webhook_url>` com `X-ProspectFlow-Evento: tarefa.nova`, `X-ProspectFlow-Assinatura: sha256=<hmac do corpo>` e corpo `{evento, tarefa}`. 2xx marca a tarefa como `entregue`; falha deixa `pendente` e o tick tenta de novo.

## Envios

Status: `aprovado`, `agendado`, `bloqueado`, `enviando`, `enviado`, `falhou`, `cancelado`.

| Rota | Quem | O quê |
|---|---|---|
| `GET /envios?operador=&status=&desde=` | operador | lista |
| `POST /envios/{id}/liberar` | dono ou admin | libera um bloqueado (exceção humana, registrada) |
| `POST /envios/{id}/cancelar` | dono ou admin | |

## Campainhas, acompanhamentos e relatos

| Rota | Quem | O quê |
|---|---|---|
| `GET/POST /campainhas`, `PATCH/DELETE /campainhas/{id}`, `GET /campainhas/{id}/disparos` | operador | campainha: `tipo` `dominio`, `remetente` ou `assunto`, com `padrao` e `prioridade` |
| `GET/POST /acompanhamentos`, `PATCH/DELETE /acompanhamentos/{id}` | operador | lembrete agendado que vira tarefa |
| `GET /relatos?operador=&nao_lidos=1` | operador | caixa de entrada do operador |
| `POST /relatos/{id}/lido`, `POST /relatos/{id}/responder` | dono ou admin | responder cria tarefa `resposta_operador` para o bot |

## Diretrizes

Status: `ativa`, `proposta`, `rejeitada`, `substituida`.

| Rota | Quem | O quê |
|---|---|---|
| `GET /diretrizes?operador=`, `GET /diretrizes/{id}` | operador | versões; o painel monta o diff com `base_versao` |
| `POST /diretrizes` | dono ou admin | publica versão nova (já `ativa`) |
| `POST /diretrizes/{id}/aprovar` | dono ou admin | vira `ativa`, a anterior fica `substituida`, as `regras` vão para `operadores.regras` |
| `POST /diretrizes/{id}/rejeitar` | dono ou admin | `{nota}`; o bot lê o motivo |

## Leads

| Rota | Quem | O quê |
|---|---|---|
| `GET /leads?operador=&estagio=&teve_resposta=&busca=&ordenar=&limite=&offset=` | operador; bot (só os dele) | lista |
| `GET /leads/{dominio}` | idem | lead, contatos, interações, ações e tarefas |
| `POST /leads/{dominio}/contato` | dono; bot dono; orquestrador | registra contato; `recebido` classifica o interesse |
| `POST /leads/{dominio}/estagio` | dono ou admin; bot só `frio`, `aquecendo`, `respondeu`, `descartado` | muda o estágio |
| `GET/POST /leads/{dominio}/acoes` | dono; bot dono | histórico de toques |

## Diário e board

| Rota | O quê |
|---|---|
| `GET /diario?dia=AAAA-MM-DD&operador=` | linha do tempo do dia com resumo e itens (e-mail enviado, resposta, bounce, decisão, tarefa…) |
| `GET /diario/dias?dias=30&operador=` | contagem por dia para o calendário |
| `GET /board?dias=30&operador=` | funil, taxas de resposta e bounce, série diária e quentes do período |

## Orquestrador (`/orquestrador/*`)

| Rota | O quê |
|---|---|
| `POST /orquestrador/tick` | reabre adiadas, dispara acompanhamentos vencidos, repete webhooks, libera agendados. Cada passo é idempotente |
| `POST /orquestrador/envio-diario` | monta a tarefa `envio_diario` de cada operador com bot ativo. Chave de deduplicação por operador e dia |
| `GET /orquestrador/envios/prontos` | pega envios `aprovado` e marca `enviando` (`FOR UPDATE SKIP LOCKED`) |
| `POST /orquestrador/envios/{id}/resultado` | `{ok, message_id?, erro?}`: `enviado` (grava a ação) ou `falhou`. Idempotente |
| `GET /orquestrador/campainhas` | campainhas ativas, agrupadas por caixa |
| `POST /orquestrador/campainhas/{id}/disparo` | registra o disparo, cria tarefa urgente e relato, sem duplicar por `message_id` |
| `POST /orquestrador/inbound` | `{caixa, message_id, de, para, assunto, trecho, classe, redirect_para?, endereco_falhou?, in_reply_to?}`; acha o lead, registra e cria `tratar_resposta`. Duplicado por `message_id` devolve `duplicado: true` |
| `GET /orquestrador/avisos` | o que avisar ao operador agora; marca como avisado |
