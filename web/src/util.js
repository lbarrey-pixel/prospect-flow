// Utilitários sem dependência: datas, textos e diff de linhas.

export class ApiError extends Error {
  constructor(status, detail) {
    super(detail || `Erro ${status}`);
    this.status = status;
  }
}

const RE_ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
export const pareceData = (s) => typeof s === "string" && RE_ISO.test(s);

export function fmtData(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function fmtDia(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(Date.now() - 864e5);
  if (d.toDateString() === hoje.toDateString()) return "Hoje";
  if (d.toDateString() === ontem.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
}

export function fmtHora(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

// "há 3 min", "em 2 dias".
export function tempoRelativo(iso) {
  if (!iso) return "—";
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const fut = diff > 0;
  const fmt = (n, un) => (fut ? `em ${n} ${un}` : `há ${n} ${un}`);
  if (abs < 60e3) return fut ? "em instantes" : "agora";
  if (abs < 3600e3) return fmt(Math.round(abs / 60e3), "min");
  if (abs < 864e5) return fmt(Math.round(abs / 3600e3), "h");
  const dias = Math.round(abs / 864e5);
  if (dias < 31) return fmt(dias, dias === 1 ? "dia" : "dias");
  return fmtData(iso);
}

// ISO -> valor de <input type="datetime-local"> no fuso local.
export function paraInputLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const deInputLocal = (v) => (v ? new Date(v).toISOString() : null);

const SIGLAS = { id: "ID", html: "HTML", url: "URL", bcc: "BCC", cnpj: "CNPJ", r1: "R1", r2: "R2", r3: "R3" };
const ACENTOS = {
  acao: "ação", acoes: "ações", decisao: "decisão", decisoes: "decisões", instrucao: "instrução",
  previa: "prévia", estagio: "estágio", dominio: "domínio", proxima: "próxima", ultimo: "último",
  ultima: "última", rodada: "rodada", conteudo: "conteúdo", versao: "versão", saldo: "saldo",
  tentativas: "tentativas", candidatos: "candidatos", proximo: "próximo", numero: "número",
  criterio: "critério", observacao: "observação", padrao: "padrão", horario: "horário",
};
export function humanizar(chave) {
  const partes = String(chave).split("_").filter(Boolean).map((p) => SIGLAS[p] || ACENTOS[p] || p);
  if (!partes.length) return chave;
  const s = partes.join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const cx = (...xs) => xs.filter(Boolean).join(" ");

export function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === "") continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function contem(texto, busca) {
  if (!busca) return true;
  return String(texto || "").toLowerCase().includes(busca.trim().toLowerCase());
}

// Diff de linhas por LCS (sem dependência). Devolve
// [{tipo: "igual"|"add"|"rem", texto, a, b}] com os números de linha de cada lado.
export function diffLinhas(antes, depois) {
  const A = String(antes ?? "").split("\n");
  const B = String(depois ?? "").split("\n");
  const n = A.length;
  const m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push({ tipo: "igual", texto: A[i], a: i + 1, b: j + 1 });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ tipo: "rem", texto: A[i], a: i + 1, b: null });
      i++;
    } else {
      out.push({ tipo: "add", texto: B[j], a: null, b: j + 1 });
      j++;
    }
  }
  while (i < n) { out.push({ tipo: "rem", texto: A[i], a: i + 1, b: null }); i++; }
  while (j < m) { out.push({ tipo: "add", texto: B[j], a: null, b: j + 1 }); j++; }
  return out;
}

// Esconde trechos iguais longos, mantendo `contexto` linhas em volta das mudanças.
export function compactarDiff(linhas, contexto = 2) {
  const manter = linhas.map(() => false);
  linhas.forEach((l, idx) => {
    if (l.tipo !== "igual") {
      for (let k = Math.max(0, idx - contexto); k <= Math.min(linhas.length - 1, idx + contexto); k++) manter[k] = true;
    }
  });
  const out = [];
  let pulados = 0;
  linhas.forEach((l, idx) => {
    if (manter[idx]) {
      if (pulados) { out.push({ tipo: "pulo", qtd: pulados }); pulados = 0; }
      out.push(l);
    } else pulados++;
  });
  if (pulados) out.push({ tipo: "pulo", qtd: pulados });
  return out;
}

export const jsonBonito = (v) => JSON.stringify(v ?? null, null, 2);

// A rota pode devolver lista pura ou {chave: [...]}: aceita os dois.
export function lista(resp, chave) {
  if (Array.isArray(resp)) return resp;
  if (resp && Array.isArray(resp[chave])) return resp[chave];
  if (resp && Array.isArray(resp.itens)) return resp.itens;
  return [];
}

// "Atualizada" de uma tarefa: o contrato não tem `atualizada_em`, então usa a data mais recente.
export function atualizadaEm(t) {
  if (t.atualizada_em) return t.atualizada_em;
  const datas = [t.criada_em, t.entregue_em, t.iniciada_em, t.concluida_em].filter(Boolean);
  return datas.sort().at(-1) || null;
}
