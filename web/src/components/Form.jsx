// Campos de formulário reutilizáveis.
import { useApp } from "../contexto.jsx";

export function Campo({ rotulo, dica, children, largo = false }) {
  return (
    <label className={largo ? "form-campo form-campo-largo" : "form-campo"}>
      <span>{rotulo}</span>
      {children}
      {dica && <small className="muted">{dica}</small>}
    </label>
  );
}

// Seletor de operador: admin escolhe qualquer um; os demais só a si mesmos.
export function SelectOperador({ value, onChange, disabled }) {
  const { operadores, eu } = useApp();
  const opcoes = eu?.admin ? operadores : operadores.filter((o) => o.email === eu?.email);
  return (
    <select value={value || ""} onChange={(e) => onChange(e.target.value)} disabled={disabled || opcoes.length <= 1}>
      {opcoes.map((o) => <option key={o.email} value={o.email}>{o.nome}</option>)}
    </select>
  );
}

export function Interruptor({ ligado, onChange, disabled, title }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!ligado}
      className={ligado ? "interruptor ligado" : "interruptor"}
      onClick={(e) => { e.stopPropagation(); onChange(!ligado); }}
      disabled={disabled}
      title={title || (ligado ? "Ativa: clique para desativar" : "Inativa: clique para ativar")}
    >
      <span className="interruptor-bola" />
    </button>
  );
}
