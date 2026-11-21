# Prospect Flow: web panel

React 18 + Vite 5, board layout. API contract in [`../docs/api.md`](../docs/api.md).

## Demo mode

```bash
npm ci
npm run dev
```

Open http://localhost:5173. Without `VITE_API_URL` (or with `VITE_MOCK=1`) the panel uses an in-memory fake API (`src/mock.js`): it does not ask for login, actions change the state, and reloading the page returns to the start. Tasks created by the panel advance on their own (pendente, entregue, em andamento, executou) every ~15 s, to show polling.

## Against the API

Create `web/.env.local`:

```
VITE_API_URL=http://localhost:8000
VITE_DEV_LOGIN=1                              # email field; the API needs AUTH_DEV=1
# VITE_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com   # Google login
```

Who can sign in is decided by the API (`GET /eu`, table `crm.operadores`).

## Organization

- `src/api.js`: API client, diverting to the mock
- `src/mock.js`: fake API, same routes and formats
- `src/views/`: one screen per sidebar item
- `src/components/`: group, drawer, modal, pills, diff, timeline
