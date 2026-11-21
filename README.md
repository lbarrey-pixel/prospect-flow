# Prospect Flow

This repository is a portfolio sample of a system running in production. The brand and the data are fictional, and the full production code is private.

> Portfolio version. The system runs in production for a client; brand and data here are fictional, and the production code is private by contract.

B2B outbound prospecting CRM in which an agent (the "bot") drafts the emails, the API applies the sending rules, and n8n handles the clock, inboxes, and SMTP. Operators supervise everything on a board-style panel.

## Why it exists

A B2B distributor wanted to reach hundreds of cold companies a month without becoming spam and without losing control. Letting an AI agent send email on its own is not acceptable: it needs a daily cap, an interval between touches, a round limit, and a time window, and someone must be able to see, veto, and correct what it does.

The split that worked:

- the **bot** decides tactics (whom to touch, the text, the angle) and may refuse a task, always with a reason;
- the **API** owns the verifiable rules and only approves a send that passes them;
- **n8n** is the task list and the outside world (cron, IMAP, SMTP); it decides nothing;
- the **operator** is the higher authority: approves guideline changes, releases exceptions, and answers the bot's questions.

## Stack

| Layer | Technology |
|---|---|
| API | Python 3.11, FastAPI, psycopg 3 with a pool (plain SQL, no ORM), Pydantic |
| Database | PostgreSQL 16, schema `crm`, restricted login role (`crm_api`) |
| Orchestration | n8n (workflows generated from code: `n8n/gerar_workflows.py`) |
| Panel | React 18, Vite 5, JavaScript; demo mode with a simulated API |
| Classification | `ProvedorLLM` port with a generic HTTP adapter (chat completions), null, and fake |
| Quality | pytest against a real Postgres, ruff, CI on GitHub Actions |

## How to run

### Everything with Docker

```bash
cp .env.example .env
docker compose up --build
```

This brings up Postgres with the schema and the seed (3 operators and 8 fictional leads), the API at `http://localhost:8000` (`/docs` has the Swagger), and n8n at `http://localhost:5678`.

Import the workflows into n8n:

```bash
docker compose exec n8n n8n import:workflow --separate --input=/workflows
```

Then, in n8n, create the credentials mentioned in the workflows (`Prospect Flow orquestrador` as Header Auth with `Authorization: Bearer <chave>`, `SMTP avisos`, `IMAP operador`). Generate the orchestrator key with:

```bash
docker compose exec api python -m scripts.gerar_chave --escopo orquestrador --nome n8n
```

### Panel

```bash
cd web
npm ci
npm run dev
```

Without `VITE_API_URL` the panel runs in **demo mode**: it uses an in-memory simulated API (`src/mock.js`), with no login, and the actions (approve, release, reply) change the state until the page is reloaded. To use the real API, create `web/.env.local`:

```
VITE_API_URL=http://localhost:8000
VITE_DEV_LOGIN=1          # signs in with a seed email; requires AUTH_DEV=1 on the API
```

In production, login is through Google (`VITE_GOOGLE_CLIENT_ID` on the panel and `GOOGLE_CLIENT_ID` on the API).

### Tests

```bash
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
export TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/prospect_test   # an empty database
python -m pytest
ruff check . && ruff format --check .      # at the repository root
python n8n/gerar_workflows.py --check      # at the root: checks that the JSON files are up to date
```

The API tests run against a real Postgres with the same schema as production and recreate the `crm` schema on every run, so use a disposable database.

## Structure

| Path | Contents |
|---|---|
| `backend/app/regras.py` | pure sending rules (cap, interval, round, window, business days), no I/O |
| `backend/app/servicos.py` | domain operations: events, tasks, sends, classification, webhook |
| `backend/app/rotas_*.py` | routes by topic: orchestrator, bot, tasks, leads, management, diary, board |
| `backend/app/llm.py` | `ProvedorLLM` port and adapters |
| `backend/app/auth.py` | operator (ID token), API keys with a hash, limited cache |
| `db/migrations/001_schema.sql` | schema `crm` and permissions; `db/seed.sql` has the fictional data |
| `n8n/` | workflow generator and the generated JSON files |
| `templates/` | HTML email template and sample attachments |
| `web/` | panel: Board, Tasks, Sends, Leads, Diary, Activity, Bells, Follow-ups, Reports, Guidelines |
| `docs/` | architecture, the API contract, and decisions (ADRs) |

## Decisions

- [n8n is a task list, not the brain](docs/adr/0001-n8n-is-a-task-list-not-the-brain.md)
- [The API never sends; n8n sends](docs/adr/0002-the-api-never-sends-n8n-sends.md)
- [Idempotency with SKIP LOCKED and deduplication keys](docs/adr/0003-idempotency-with-skip-locked-and-deduplication-keys.md)
- [Credentials stored only as a hash](docs/adr/0004-api-credentials-stored-only-as-a-hash.md)

More detail in [docs/architecture.md](docs/architecture.md) and [docs/api.md](docs/api.md).

## Reply classification with an LLM

When a lead replies, the API asks a model whether the interest is `real` or `generico`. Set `LLM_API_URL`, `LLM_API_KEY`, and `LLM_MODEL` to any chat-completions API; without that, everything is `generico`. A provider failure never fails receipt of the message: it goes to the log and falls back to the default value.
