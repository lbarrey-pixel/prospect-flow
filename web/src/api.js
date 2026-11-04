// Cliente da API do Prospect Flow (contrato em docs/api.md).
//
// Modo MOCK: com VITE_MOCK=1, ou sem VITE_API_URL, todas as chamadas vão para
// src/mock.js (dados fictícios em memória). As ações mudam o estado mock, então
// dá para navegar e demonstrar sem backend.
import { ApiError, qs } from "./util.js";

const API_URL = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
export const MOCK = import.meta.env.VITE_MOCK === "1" || !API_URL;
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

let token = null;
let aoNaoAutorizado = null;
export function definirToken(t) { token = t; }
export function aoPerderAcesso(fn) { aoNaoAutorizado = fn; }

let mockPromise = null;
function carregarMock() {
  if (!mockPromise) mockPromise = import("./mock.js");
  return mockPromise;
}

async function req(method, path, body) {
  if (MOCK) {
    const { mockRequest } = await carregarMock();
    return mockRequest(method, path, body);
  }
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Sem conexão com a API (ela pode estar subindo; tente de novo em alguns segundos).");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail ?? j);
    } catch { /* corpo vazio */ }
    if (res.status === 401 && aoNaoAutorizado) aoNaoAutorizado(detail);
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return null;
  const texto = await res.text();
  return texto ? JSON.parse(texto) : null;
}

const enc = encodeURIComponent;

export const api = {
  // Comuns
  saude: () => req("GET", "/saude"),
  eu: () => req("GET", "/eu"),
  operadores: () => req("GET", "/operadores"),
  painel: (operador) => req("GET", `/painel${qs({ operador })}`),
  eventos: (p) => req("GET", `/eventos${qs(p)}`),
  diario: (p) => req("GET", `/diario${qs(p)}`),
  diarioDias: (p) => req("GET", `/diario/dias${qs(p)}`),
  board: (p) => req("GET", `/board${qs(p)}`),

  // Tarefas
  tarefas: (p) => req("GET", `/tarefas${qs({ limite: 200, ...p })}`),
  tarefa: (id) => req("GET", `/tarefas/${enc(id)}`),
  criarTarefa: (dados) => req("POST", "/tarefas", dados),
  cancelarTarefa: (id, motivo) => req("POST", `/tarefas/${enc(id)}/cancelar`, { motivo }),
  reenviarTarefa: (id) => req("POST", `/tarefas/${enc(id)}/reenviar`, {}),

  // Envios
  envios: (p) => req("GET", `/envios${qs(p)}`),
  liberarEnvio: (id, nota) => req("POST", `/envios/${enc(id)}/liberar`, { nota }),
  cancelarEnvio: (id, motivo) => req("POST", `/envios/${enc(id)}/cancelar`, { motivo }),

  // Campainhas
  campainhas: (p) => req("GET", `/campainhas${qs(p)}`),
  criarCampainha: (dados) => req("POST", "/campainhas", dados),
  editarCampainha: (id, dados) => req("PATCH", `/campainhas/${enc(id)}`, dados),
  arquivarCampainha: (id) => req("DELETE", `/campainhas/${enc(id)}`),
  disparosCampainha: (id) => req("GET", `/campainhas/${enc(id)}/disparos`),

  // Acompanhamentos
  acompanhamentos: (p) => req("GET", `/acompanhamentos${qs(p)}`),
  criarAcompanhamento: (dados) => req("POST", "/acompanhamentos", dados),
  editarAcompanhamento: (id, dados) => req("PATCH", `/acompanhamentos/${enc(id)}`, dados),
  arquivarAcompanhamento: (id) => req("DELETE", `/acompanhamentos/${enc(id)}`),

  // Relatos
  relatos: (p) => req("GET", `/relatos${qs(p)}`),
  marcarRelatoLido: (id) => req("POST", `/relatos/${enc(id)}/lido`, {}),
  responderRelato: (id, resposta) => req("POST", `/relatos/${enc(id)}/responder`, { resposta }),

  // Diretrizes
  diretrizes: (operador) => req("GET", `/diretrizes${qs({ operador })}`),
  diretriz: (id) => req("GET", `/diretrizes/${enc(id)}`),
  publicarDiretriz: (dados) => req("POST", "/diretrizes", dados),
  aprovarDiretriz: (id, nota) => req("POST", `/diretrizes/${enc(id)}/aprovar`, { nota }),
  rejeitarDiretriz: (id, nota) => req("POST", `/diretrizes/${enc(id)}/rejeitar`, { nota }),

  // Leads
  leads: (p) => req("GET", `/leads${qs(p)}`),
  lead: (dominio) => req("GET", `/leads/${enc(dominio)}`),
  mudarEstagio: (dominio, dados) => req("POST", `/leads/${enc(dominio)}/estagio`, dados),
};
