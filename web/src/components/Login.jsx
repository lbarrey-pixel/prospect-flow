// Login com Google Identity Services. Em desenvolvimento local, VITE_DEV_LOGIN=1 troca por um campo de e-mail
// (a API precisa estar com AUTH_DEV=1).
import { useEffect, useRef } from "react";
import { useState } from "react";
import { GOOGLE_CLIENT_ID } from "../api.js";

const DEV_LOGIN = import.meta.env.VITE_DEV_LOGIN === "1";

export function decodeJwtPayload(jwt) {
  const b64 = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder("utf-8").decode(bytes));
}

let scriptPromise = null;
export function carregarGoogle() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => { scriptPromise = null; reject(new Error("Falha ao carregar o login do Google")); };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

export function iniciarGoogle(callback) {
  window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback, ux_mode: "popup", auto_select: true });
}

export default function Login({ onLogin, onDevLogin, erro }) {
  const btnRef = useRef(null);
  const [email, setEmail] = useState("ana@example.com");
  useEffect(() => {
    let vivo = true;
    if (DEV_LOGIN || !GOOGLE_CLIENT_ID) return undefined;
    carregarGoogle().then(() => {
      if (!vivo || !btnRef.current) return;
      iniciarGoogle(onLogin);
      window.google.accounts.id.prompt(() => {});
      window.google.accounts.id.renderButton(btnRef.current, { theme: "outline", size: "large", text: "signin_with", locale: "pt-BR", width: 280 });
    }).catch(() => {});
    return () => { vivo = false; };
  }, [onLogin]);

  return (
    <div className="login-tela">
      <div className="login-card">
        <div className="marca-logo marca-logo-grande">P</div>
        <h1>Prospect Flow</h1>
        <p className="muted">Prospecção B2B. Acesso restrito aos operadores.</p>
        {DEV_LOGIN ? (
          <form onSubmit={(e) => { e.preventDefault(); onDevLogin(email.trim().toLowerCase()); }}>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="e-mail do operador" required />
            <button type="submit" className="btn btn-primario">Entrar (modo dev)</button>
          </form>
        ) : GOOGLE_CLIENT_ID ? <div ref={btnRef} className="login-botao" /> : (
          <div className="erro-box">VITE_GOOGLE_CLIENT_ID não configurado. Para testar sem login, rode com VITE_MOCK=1.</div>
        )}
        {erro && <div className="erro-box">{erro}</div>}
      </div>
    </div>
  );
}
