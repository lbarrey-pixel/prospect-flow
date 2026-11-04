// Gaveta lateral de detalhe.
import { useCallback } from "react";
import { X } from "lucide-react";
import { useTecla } from "../contexto.jsx";

export default function Gaveta({ titulo, subtitulo, onFechar, children, acoes }) {
  const fechar = useCallback(() => onFechar(), [onFechar]);
  // Esc fecha a gaveta só se não houver modal aberto por cima.
  const escape = useCallback(() => { if (!document.querySelector(".modal-fundo")) onFechar(); }, [onFechar]);
  useTecla("Escape", escape);
  return (
    <div className="gaveta-fundo" onClick={fechar}>
      <aside className="gaveta" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={typeof titulo === "string" ? titulo : "Detalhe"}>
        <header className="gaveta-cab">
          <div className="gaveta-titulos">
            <h2>{titulo}</h2>
            {subtitulo && <div className="gaveta-sub">{subtitulo}</div>}
          </div>
          <button className="btn-icone" onClick={fechar} title="Fechar (Esc)"><X size={20} /></button>
        </header>
        {acoes && <div className="gaveta-acoes">{acoes}</div>}
        <div className="gaveta-corpo">{children}</div>
      </aside>
    </div>
  );
}

export function Secao({ titulo, children, extra }) {
  return (
    <section className="secao">
      <div className="secao-cab">
        <h3>{titulo}</h3>
        {extra}
      </div>
      {children}
    </section>
  );
}

// Grade de rótulo/valor. `itens` = [[rotulo, valor], ...]; falsy é ignorado.
export function Campos({ itens }) {
  return (
    <dl className="campos">
      {itens.filter(Boolean).map(([rotulo, valor]) => (
        <div key={rotulo} className="campo">
          <dt>{rotulo}</dt>
          <dd>{valor === null || valor === undefined || valor === "" ? <span className="muted">—</span> : valor}</dd>
        </div>
      ))}
    </dl>
  );
}
