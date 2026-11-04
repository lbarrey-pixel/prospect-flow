// Menu lateral. No celular vira gaveta aberta pelo botão de menu do topo.
import { AREAS } from "../constants.js";
import { cx } from "../util.js";
import Icone from "./Icone.jsx";
import { MOCK } from "../api.js";

export default function Sidebar({ area, onArea, badges, aberta, onFechar }) {
  return (
    <>
      <div className={cx("sidebar-fundo", aberta && "visivel")} onClick={onFechar} />
      <nav className={cx("sidebar", aberta && "aberta")} aria-label="Áreas do CRM">
        <div className="sidebar-marca">
          <span className="marca-logo">P</span>
          <div>
            <div className="marca-nome">Prospect Flow</div>
            <div className="marca-sub">Prospecção</div>
          </div>
        </div>
        <ul className="sidebar-lista">
          {AREAS.map((a) => {
            const b = badges[a.chave];
            return (
              <li key={a.chave}>
                <button className={cx("sidebar-item", area === a.chave && "ativo")} onClick={() => { onArea(a.chave); onFechar(); }}>
                  <Icone nome={a.icone} size={18} />
                  <span className="sidebar-label">{a.label}</span>
                  {b ? <span className={cx("badge", b.urgente && "badge-urgente")} title={b.title}>{b.n}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
        {MOCK && (
          <div className="sidebar-rodape">
            <span className="selo selo-demo">Modo demonstração</span>
            <div className="muted">Dados fictícios em memória. Recarregar a página restaura o estado inicial.</div>
          </div>
        )}
      </nav>
    </>
  );
}
