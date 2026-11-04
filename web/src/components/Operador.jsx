// Avatar do operador e selo de quem criou (bot x operador).
import { Bot, User, Workflow } from "lucide-react";
import { useApp } from "../contexto.jsx";
import { CORES_OPERADOR } from "../constants.js";

export function Avatar({ email, tamanho = 24, comNome = false }) {
  const { operadores, nomeOp } = useApp();
  const idx = Math.max(0, operadores.findIndex((o) => o.email === email));
  const nome = nomeOp(email);
  const inicial = (nome || "?").trim().charAt(0).toUpperCase();
  return (
    <span className="avatar-linha" title={email || ""}>
      <span
        className="avatar"
        style={{ width: tamanho, height: tamanho, fontSize: tamanho * 0.45, background: email ? CORES_OPERADOR[idx % CORES_OPERADOR.length] : "#797e87" }}
      >
        {inicial}
      </span>
      {comNome && <span className="avatar-nome">{nome}</span>}
    </span>
  );
}

// O contrato só traz `criada_por` / `criado_por` / `autor` como texto livre (sem tipo,
// exceto nas diretrizes, que têm `autor_tipo`). Regra usada aqui: "bot", "bot:…" e
// "bot…" é bot; "n8n", "tick", "sistema", "orquestrador", "api" são sistema; o resto
// (um e-mail) é operador.
export function tipoAutor(autor, autorTipo) {
  if (autorTipo) return autorTipo === "bot" ? "bot" : autorTipo === "operador" ? "operador" : "sistema";
  const a = String(autor || "").toLowerCase();
  if (a === "bot" || a.startsWith("bot:")) return "bot";
  if (["n8n", "tick", "sistema", "orquestrador", "api"].includes(a)) return "sistema";
  return "operador";
}

export function SeloAutor({ autor, autorTipo }) {
  const { nomeOp } = useApp();
  const tipo = tipoAutor(autor, autorTipo);
  if (tipo === "bot") {
    const de = String(autor || "").split(":")[1];
    return <span className="selo selo-bot" title={autor}><Bot size={12} /> Bot{de ? ` · ${de}` : ""}</span>;
  }
  if (tipo === "sistema") return <span className="selo selo-sistema" title={autor}><Workflow size={12} /> {autor || "Sistema"}</span>;
  return <span className="selo selo-operador" title={autor}><User size={12} /> {nomeOp(autor)}</span>;
}
