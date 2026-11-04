// Grupo colapsável do quadro (cabeçalho colorido + borda esquerda na cor do grupo).
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export default function Grupo({ titulo, cor, contagem, abertoInicial = true, children, extra }) {
  const [aberto, setAberto] = useState(abertoInicial);
  return (
    <section className="grupo" style={{ "--cor-grupo": cor }}>
      <header className="grupo-cab">
        <button className="grupo-toggle" onClick={() => setAberto((v) => !v)} aria-expanded={aberto}>
          {aberto ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          <span className="grupo-titulo">{titulo}</span>
          <span className="grupo-contagem">{contagem} {contagem === 1 ? "item" : "itens"}</span>
        </button>
        {extra}
      </header>
      {aberto && <div className="grupo-corpo">{children}</div>}
    </section>
  );
}
