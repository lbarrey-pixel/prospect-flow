# Prospect Flow: painel web

React 18 + Vite 5, layout de quadro. Contrato da API em [`../docs/api.md`](../docs/api.md).

## Modo demonstração

```bash
npm ci
npm run dev
```

Abra http://localhost:5173. Sem `VITE_API_URL` (ou com `VITE_MOCK=1`) o painel usa uma API fictícia em memória (`src/mock.js`): não pede login, as ações alteram o estado e recarregar a página volta ao início. Tarefas criadas pelo painel andam sozinhas (pendente, entregue, em andamento, executou) a cada ~15 s, para mostrar o polling.

## Contra a API

Crie `web/.env.local`:

```
VITE_API_URL=http://localhost:8000
VITE_DEV_LOGIN=1                              # campo de e-mail; a API precisa de AUTH_DEV=1
# VITE_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com   # login por Google
```

Quem pode entrar é decidido pela API (`GET /eu`, tabela `crm.operadores`).

## Organização

- `src/api.js`: cliente da API, com desvio para o mock
- `src/mock.js`: API fictícia, mesmas rotas e formatos
- `src/views/`: uma tela por item da barra lateral
- `src/components/`: grupo, gaveta, modal, pílulas, diff, linha do tempo
