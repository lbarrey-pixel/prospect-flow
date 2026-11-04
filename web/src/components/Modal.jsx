// Modal simples (formulários e confirmações).
import { useCallback, useState } from "react";
import { X } from "lucide-react";
import { useTecla } from "../contexto.jsx";

export default function Modal({ titulo, onFechar, children, rodape, largura = 560 }) {
  const fechar = useCallback(() => onFechar(), [onFechar]);
  useTecla("Escape", fechar);
  return (
    <div className="modal-fundo" onClick={fechar}>
      <div className="modal" style={{ maxWidth: largura }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={titulo}>
        <header className="modal-cab">
          <h2>{titulo}</h2>
          <button className="btn-icone" onClick={fechar} title="Fechar (Esc)"><X size={20} /></button>
        </header>
        <div className="modal-corpo">{children}</div>
        {rodape && <footer className="modal-rodape">{rodape}</footer>}
      </div>
    </div>
  );
}

// Confirmação com campo de texto opcional (motivo / nota).
export function ConfirmarComTexto({
  titulo, texto, rotulo, placeholder, obrigatorio = false, botao = "Confirmar", perigo = false, onConfirmar, onFechar,
}) {
  const [valor, setValor] = useState("");
  const [ocupado, setOcupado] = useState(false);
  async function enviar(e) {
    e.preventDefault();
    if (obrigatorio && !valor.trim()) return;
    setOcupado(true);
    try { await onConfirmar(valor.trim()); } finally { setOcupado(false); }
  }
  return (
    <Modal titulo={titulo} onFechar={onFechar}>
      <form onSubmit={enviar} className="form">
        {texto && <div className="modal-texto">{texto}</div>}
        {rotulo && (
          <label className="form-campo">
            <span>{rotulo}{obrigatorio ? " *" : " (opcional)"}</span>
            <textarea rows={3} placeholder={placeholder} autoFocus value={valor} onChange={(e) => setValor(e.target.value)} />
          </label>
        )}
        <div className="form-botoes">
          <button type="button" className="btn" onClick={onFechar}>Voltar</button>
          <button type="submit" className={perigo ? "btn btn-perigo" : "btn btn-primario"} disabled={ocupado || (obrigatorio && !valor.trim())}>
            {botao}
          </button>
        </div>
      </form>
    </Modal>
  );
}
