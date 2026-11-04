# Prospect Flow

CRM de prospecção B2B ativa em que um agente (o "bot") rascunha os e-mails, a API aplica as regras de envio e o n8n cuida de relógio, caixas de entrada e SMTP. Os operadores supervisionam tudo num painel em forma de quadro.

> Versão de portfólio. O sistema roda em produção para um cliente; aqui marca e dados são fictícios, e o código em produção é privado por contrato.

## Por que existe

Uma distribuidora B2B queria abordar centenas de empresas frias por mês sem virar spam e sem perder o controle. Deixar um agente de IA mandar e-mail solto não serve: ele precisa de teto diário, intervalo entre toques, limite de rodadas e janela de horário, e alguém precisa poder ver, vetar e corrigir o que ele faz.

A divisão que funcionou:

- o **bot** decide tática (quem tocar, texto, ângulo) e pode recusar uma tarefa, sempre com motivo;
- a **API** é a dona das regras verificáveis e só aprova o envio que passa por elas;
- o **n8n** é a lista de tarefas e o mundo externo (cron, IMAP, SMTP); ele não decide nada;
- o **operador** é a hierarquia superior: aprova mudanças de diretriz, libera exceções e responde às perguntas do bot.

## Stack

| Camada | Tecnologia |
|---|---|
| API | Python 3.11, FastAPI, psycopg 3 com pool (SQL direto, sem ORM), Pydantic |
| Banco | PostgreSQL 16, schema `crm`, papel de login restrito (`crm_api`) |
| Orquestração | n8n (workflows gerados por código: `n8n/gerar_workflows.py`) |
| Painel | React 18, Vite 5, JavaScript; modo demonstração com API simulada |
| Classificação | porta `ProvedorLLM` com adaptador HTTP genérico (chat completions), nulo e fake |
| Qualidade | pytest contra Postgres real, ruff, CI no GitHub Actions |

## Como rodar

### Tudo com Docker

```bash
cp .env.example .env
docker compose up --build
```

Sobe o Postgres com schema e seed (3 operadores e 8 leads fictícios), a API em `http://localhost:8000` (`/docs` tem o Swagger) e o n8n em `http://localhost:5678`.

Importar os workflows no n8n:

```bash
docker compose exec n8n n8n import:workflow --separate --input=/workflows
```

Depois, no n8n, crie as credenciais citadas nos workflows (`Prospect Flow orquestrador` como Header Auth com `Authorization: Bearer <chave>`, `SMTP avisos`, `IMAP operador`). Gere a chave do orquestrador com:

```bash
docker compose exec api python -m scripts.gerar_chave --escopo orquestrador --nome n8n
```

### Painel

```bash
cd web
npm ci
npm run dev
```

Sem `VITE_API_URL` o painel roda em **modo demonstração**: usa uma API simulada em memória (`src/mock.js`), sem login, e as ações (aprovar, liberar, responder) alteram o estado até recarregar a página. Para usar a API real, crie `web/.env.local`:

```
VITE_API_URL=http://localhost:8000
VITE_DEV_LOGIN=1          # entra com um e-mail do seed; exige AUTH_DEV=1 na API
```

Em produção o login é por Google (`VITE_GOOGLE_CLIENT_ID` no painel e `GOOGLE_CLIENT_ID` na API).

### Testes

```bash
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
export TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/prospect_test   # um database vazio
python -m pytest
ruff check . && ruff format --check .      # na raiz do repositório
python n8n/gerar_workflows.py --check      # na raiz: confere se os JSONs estão em dia
```

Os testes de API rodam contra um Postgres de verdade com o mesmo schema de produção e recriam o schema `crm` a cada execução, então use um database descartável.

## Estrutura

| Caminho | O que tem |
|---|---|
| `backend/app/regras.py` | regras de envio puras (teto, intervalo, rodada, janela, dias úteis), sem I/O |
| `backend/app/servicos.py` | operações de domínio: eventos, tarefas, envios, classificação, webhook |
| `backend/app/rotas_*.py` | rotas por assunto: orquestrador, bot, tarefas, leads, gestão, diário, board |
| `backend/app/llm.py` | porta `ProvedorLLM` e adaptadores |
| `backend/app/auth.py` | operador (ID token), chaves de API com hash, cache limitado |
| `db/migrations/001_schema.sql` | schema `crm` e permissões; `db/seed.sql` tem os dados fictícios |
| `n8n/` | gerador dos workflows e os JSONs gerados |
| `templates/` | modelo de e-mail HTML e anexos de exemplo |
| `web/` | painel: Board, Tarefas, Envios, Leads, Diário, Atividade, Campainhas, Acompanhamentos, Relatos, Diretrizes |
| `docs/` | arquitetura, contrato da API e decisões (ADRs) |

## Decisões

- [n8n é lista de tarefas, não o cérebro](docs/adr/0001-n8n-lista-de-tarefas-nao-cerebro.md)
- [A API nunca envia; o n8n envia](docs/adr/0002-api-nunca-envia-n8n-envia.md)
- [Idempotência com SKIP LOCKED e chaves de deduplicação](docs/adr/0003-idempotencia-skip-locked-e-chaves-de-deduplicacao.md)
- [Credenciais guardadas só como hash](docs/adr/0004-credenciais-guardadas-so-como-hash.md)

Mais detalhes em [docs/arquitetura.md](docs/arquitetura.md) e [docs/api.md](docs/api.md).

## Classificação de respostas com LLM

Quando um lead responde, a API pergunta a um modelo se o interesse é `real` ou `generico`. Configure `LLM_API_URL`, `LLM_API_KEY` e `LLM_MODEL` com qualquer API de chat completions; sem isso, tudo é `generico`. Falha do provedor nunca derruba o recebimento: vai para o log e cai no valor padrão.

---

## English

B2B outbound prospecting CRM. An agent (the "bot") drafts emails, the API enforces the sending rules, n8n handles the clock, inboxes and SMTP, and human operators supervise everything on a board.

> Portfolio version. The system runs in production for a client; brand and data here are fictional, and the production code is private by contract.

**Why it exists.** A B2B distributor wanted to reach hundreds of cold companies a month without becoming spam and without losing control. An AI agent sending email unsupervised is not acceptable: it needs a daily cap, spacing between touches, a round limit and a sending window, and a person must be able to see, veto and correct what it does. The split: the bot decides tactics and may refuse a task (always with a reason); the API owns every verifiable rule and only approves sends that pass them; n8n is a task list plus the outside world (cron, IMAP, SMTP) and decides nothing; the operator is the final authority and approves guideline changes.

**Stack.** Python 3.11 / FastAPI / psycopg 3 pool (plain SQL), PostgreSQL 16 (restricted role, `crm` schema), n8n with workflows generated from code, React 18 + Vite 5 panel, an `LLMProvider`-style port with a generic HTTP adapter for reply classification, pytest against a real Postgres, ruff and GitHub Actions.

**Run it.** `cp .env.example .env && docker compose up --build` starts Postgres with schema and seed (3 operators, 8 leads), the API on `:8000` and n8n on `:5678`; import the workflows with `docker compose exec n8n n8n import:workflow --separate --input=/workflows`. The panel (`cd web && npm ci && npm run dev`) runs in demo mode with an in-memory fake API unless `VITE_API_URL` is set. Tests: `pip install -r backend/requirements-dev.txt`, point `TEST_DATABASE_URL` at an empty database and run `python -m pytest` in `backend/`.

**Key decisions** (see `docs/adr/`): n8n as task list, not brain; the API never sends email, n8n does; idempotency through `SKIP LOCKED` and dedup keys; API keys stored only as hashes.
