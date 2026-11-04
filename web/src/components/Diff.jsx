// Diff linha a linha (LCS próprio em util.js), com opção de esconder trechos iguais.
import { useMemo, useState } from "react";
import { compactarDiff, diffLinhas } from "../util.js";

export default function Diff({ antes, depois, rotuloAntes = "base", rotuloDepois = "proposta" }) {
  const [soMudancas, setSoMudancas] = useState(true);
  const linhas = useMemo(() => diffLinhas(antes, depois), [antes, depois]);
  const add = linhas.filter((l) => l.tipo === "add").length;
  const rem = linhas.filter((l) => l.tipo === "rem").length;
  const mostrar = soMudancas ? compactarDiff(linhas, 2) : linhas;
  return (
    <div className="diff">
      <div className="diff-cab">
        <span className="diff-resumo">
          <span className="diff-n-add">+{add}</span> <span className="diff-n-rem">−{rem}</span>
          <span className="muted"> · {rotuloAntes} → {rotuloDepois}</span>
        </span>
        <label className="check">
          <input type="checkbox" checked={soMudancas} onChange={(e) => setSoMudancas(e.target.checked)} /> só trechos alterados
        </label>
      </div>
      {add === 0 && rem === 0 ? (
        <div className="diff-sem-mudanca">Sem diferenças.</div>
      ) : (
        <div className="diff-corpo">
          {mostrar.map((l, i) =>
            l.tipo === "pulo" ? (
              <div key={i} className="diff-linha diff-pulo">⋯ {l.qtd} {l.qtd === 1 ? "linha igual" : "linhas iguais"}</div>
            ) : (
              <div key={i} className={`diff-linha diff-${l.tipo}`}>
                <span className="diff-num">{l.a ?? ""}</span>
                <span className="diff-num">{l.b ?? ""}</span>
                <span className="diff-sinal">{l.tipo === "add" ? "+" : l.tipo === "rem" ? "−" : " "}</span>
                <span className="diff-texto">{l.texto || " "}</span>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
