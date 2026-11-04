// Barra do topo: menu (celular), seletor de operador, busca, resumo do dia, atualização e usuário.
import { LogOut, Menu, RefreshCw, Search, X } from "lucide-react";
import { useApp, useRelogio } from "../contexto.jsx";
import { cx } from "../util.js";
import { MOCK } from "../api.js";

function Atualizado({ quando, carregando, onAtualizar }) {
  useRelogio(1000);
  const s = quando ? Math.max(0, Math.round((Date.now() - quando) / 1000)) : null;
  const texto = s === null ? "carregando…" : s < 2 ? "atualizado agora" : s < 60 ? `atualizado há ${s} s` : `atualizado há ${Math.round(s / 60)} min`;
  return (
    <button className={cx("atualizado", s !== null && s > 45 && "atrasado")} onClick={onAtualizar} title="Atualiza sozinho a cada 15 s. Clique para atualizar agora.">
      <RefreshCw size={14} className={carregando ? "girando" : ""} />
      <span>{texto}</span>
    </button>
  );
}

function Resumo({ painel }) {
  if (!painel) return null;
  const eh = painel.envios_hoje || {};
  const itens = [
    { n: painel.tarefas_abertas, t: "tarefas abertas" },
    { n: painel.tarefas_urgentes, t: "urgentes", alerta: true },
    { n: eh.enviado, t: "enviados hoje" },
    { n: eh.bloqueado, t: "bloqueados", alerta: true },
    { n: painel.relatos_nao_lidos, t: "relatos não lidos" },
  ].filter((i) => typeof i.n === "number" && (i.n > 0 || !i.alerta));
  return (
    <div className="resumo-dia" aria-label="Resumo do dia">
      {itens.map((i) => (
        <span key={i.t} className={cx("resumo-item", i.alerta && "resumo-alerta")}><b>{i.n}</b> {i.t}</span>
      ))}
    </div>
  );
}

export default function Topo({ painel, onMenu, onSair, carregando }) {
  const { operadores, operadorFiltro, setOperadorFiltro, busca, setBusca, ultimaAtualizacao, recarregar, usuario } = useApp();
  return (
    <header className="topo">
      <div className="topo-linha">
        <button className="btn-icone so-celular" onClick={onMenu} aria-label="Abrir menu"><Menu size={22} /></button>
        <div className="seletor-operador" role="tablist" aria-label="Operador">
          <button role="tab" aria-selected={!operadorFiltro} className={cx(!operadorFiltro && "ativo")} onClick={() => setOperadorFiltro("")}>Todos</button>
          {operadores.map((o) => (
            <button key={o.email} role="tab" aria-selected={operadorFiltro === o.email} className={cx(operadorFiltro === o.email && "ativo")} onClick={() => setOperadorFiltro(o.email)}>
              {o.nome}
            </button>
          ))}
        </div>
        <div className="busca">
          <Search size={16} />
          <input type="search" placeholder="Buscar título, lead, domínio…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          {busca && <button className="btn-icone" onClick={() => setBusca("")} aria-label="Limpar busca"><X size={14} /></button>}
        </div>
        <div className="topo-direita">
          <Atualizado quando={ultimaAtualizacao} carregando={carregando} onAtualizar={recarregar} />
          {usuario && (
            <div className="usuario">
              {usuario.foto ? <img src={usuario.foto} alt="" referrerPolicy="no-referrer" /> : <span className="avatar" style={{ width: 28, height: 28, background: "#0073ea" }}>{(usuario.nome || "?").charAt(0)}</span>}
              <span className="usuario-nome">{usuario.nome}</span>
              {!MOCK && <button className="btn-icone" onClick={onSair} title="Sair"><LogOut size={16} /></button>}
            </div>
          )}
        </div>
      </div>
      <Resumo painel={painel} />
    </header>
  );
}
