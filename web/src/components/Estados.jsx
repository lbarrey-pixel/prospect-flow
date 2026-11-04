import { Loader } from "lucide-react";

export function Carregando({ texto = "Carregando…" }) {
  return <div className="estado"><Loader size={16} className="girando" /> {texto}</div>;
}

export function Vazio({ children = "Nada por aqui." }) {
  return <div className="estado estado-vazio">{children}</div>;
}

export function ErroBox({ erro, onTentar }) {
  if (!erro) return null;
  return (
    <div className="erro-box" role="alert">
      <span>{erro}</span>
      {onTentar && <button className="btn btn-pequeno" onClick={onTentar}>Tentar de novo</button>}
    </div>
  );
}
