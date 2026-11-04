# Arquitetura

## Princípios

1. **O operador manda.** O bot tem autonomia de tática (texto, ângulo, horário, executar ou não, reportar). Mudança de diretriz só vale depois que o operador aprova no painel.
2. **Regras verificáveis ficam na API.** Teto diário, intervalo entre toques, rodada, janela de horário e estágio do lead são conferidos no servidor, não no prompt do bot.
3. **Tudo é visível.** Tarefa, decisão, envio, campainha, acompanhamento, relato e proposta de diretriz aparecem no painel. Toda escrita grava uma linha em `crm.eventos`.
4. **Sem infraestrutura paga como padrão.** Um Postgres, uma API e um n8n em Docker bastam.

## Peças

```
        painel (React) ── ID token do Google ──┐
                                               ▼
   bot ── chave "bot" ──►  API (FastAPI)  ◄── chave "orquestrador" ── n8n
    ▲                        │   │                                     │ cron · IMAP · SMTP
    └── webhook (HMAC) ──────┘   │ psycopg, papel crm_api              │ avisos ao operador
                                 ▼
                         Postgres · schema crm
```

- **API**: dona do estado e das regras. Valida o rascunho do bot antes de liberar o envio. Nunca fala SMTP.
- **n8n**: relógio, caixas de entrada, SMTP e avisos. Não decide tática; entrega tarefa e contexto.
- **Bot**: qualquer agente que fale HTTP. Recebe tarefas por webhook ou puxando `GET /bot/tarefas`, devolve a decisão, cuida das próprias campainhas e acompanhamentos, reporta ao operador e propõe diretrizes.
- **Painel**: quadro de tarefas, envios, leads, diário do dia, atividade, diretrizes e relatos.

## Banco: schema `crm`

Só o papel `crm_api` tem permissão no schema. A API se conecta com ele; o resto do banco, se existir, fica fora de alcance por permissão.

| Tabela | Para quê |
|---|---|
| `operadores` | e-mail, nome, admin, caixa de envio, BCC e `regras` (limites ajustáveis) |
| `leads`, `contatos`, `interacoes`, `acoes` | a carteira: uma empresa por domínio, contatos, e-mails trocados e toques do bot |
| `chaves_api` | hash SHA-256, operador, escopo (`bot`, `orquestrador`, `leitura`) |
| `bots` | um por operador: URL do webhook, segredo HMAC, ativo |
| `tarefas` | a fila e o quadro: tipo, status, prioridade, payload, resposta, motivo |
| `envios` | rascunho do bot, validado e enviado pelo n8n (ou bloqueado, com motivo) |
| `campainhas`, `campainha_disparos` | o que vigiar nas caixas e cada e-mail que tocou |
| `acompanhamentos` | lembretes agendados que viram tarefa na data |
| `relatos` | o bot reportando ao operador: info, alerta, pergunta, solicitação de autorização |
| `diretrizes` | versões por operador. `proposta` vira `ativa` só com aprovação humana |
| `eventos` | auditoria de toda escrita |

## Ciclo de uma tarefa

```
pendente ─► entregue ─► em_andamento ─► executou | parcial | adiou | recusou | bloqueado_humano
    │            (webhook ok ou bot puxou)          │
    └─► cancelada (humano)        falhou (erro)     └─ adiou + reagendar_em → volta a pendente no tick
```

`envio_diario` executado gera `envios`, um por e-mail. Cada envio passa pelas regras do operador:

- **aprovado**: o n8n envia;
- **agendado**: fora da janela, sai no próximo horário válido;
- **bloqueado**: furou teto, intervalo, rodada ou estágio. O motivo aparece no painel e o operador pode liberar a exceção.

O n8n envia e devolve o `message_id`. Só então a API grava a ação com a rodada. Nenhum e-mail sai sem registro, e não há registro de e-mail que não saiu.

## Os três fluxos do n8n

| Fluxo | Gatilho | O que faz |
|---|---|---|
| Envio diário | cron, manhã de dia útil | `POST /orquestrador/envio-diario`: a API filtra os candidatos que as regras de cada operador permitem tocar hoje e entrega **uma** tarefa ao bot |
| Resposta recebida | IMAP, e-mail novo | classifica bounce, resposta automática, redirect ou humano; `POST /orquestrador/inbound` cria a tarefa `tratar_resposta`; confere campainhas |
| Relógio | cron, a cada 5 min | `POST /orquestrador/tick`: reabre tarefas adiadas, dispara acompanhamentos, revalida envios agendados, repete webhooks que falharam; depois avisa o operador por e-mail |

Um quarto fluxo (`03_enviar_emails`) puxa os envios aprovados, envia por SMTP um de cada vez com pausa aleatória e devolve o resultado à API. O `99_erros` avisa o administrador se qualquer workflow falhar.

## Regras padrão do operador (`operadores.regras`)

```json
{
  "teto_frios": 20, "teto_respondeu": 5,
  "intervalo_dias_uteis": 5, "max_rodadas": 3, "ciclo_dias": 90,
  "janela": {"dias": [1,2,3,4,5], "inicio": "08:00", "fim": "17:00", "tz": "America/Sao_Paulo"},
  "contam_no_teto": ["R1", "R2", "R3"],
  "estagios_nutriveis": ["frio", "aquecendo", "respondeu"]
}
```

Só R1, R2 e R3 contam no teto e no intervalo. Reenvio depois de bounce, redirect de resposta automática e resposta dentro da conversa não contam. As regras de cada operador são mescladas sobre este padrão (`regras_efetivas`), e o cálculo mora em `backend/app/regras.py`, sem I/O, coberto por testes unitários.

## Classificação de respostas

Resposta humana passa por `ProvedorLLM` (`backend/app/llm.py`), que devolve `real` ou `generico`. Há três adaptadores: HTTP genérico (chat completions, configurado por `LLM_API_URL`, `LLM_API_KEY`, `LLM_MODEL`), nulo (sem configuração, tudo vira `generico`) e fake (testes). Erro de rede ou resposta estranha cai em `generico` e vai para o log; o cliente nunca vê o texto da exceção.
