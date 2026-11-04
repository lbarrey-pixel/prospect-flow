// Linha do tempo de eventos (detalhe da tarefa e feed de atividade).
import { Activity, Bell, Bot, Building2, CalendarClock, Inbox, ScrollText, Send, Settings2, User, Workflow } from "lucide-react";
import { fmtData, tempoRelativo } from "../util.js";
import { tipoAutor } from "./Operador.jsx";
import { useApp } from "../contexto.jsx";

const ICONE_ENTIDADE = {
  tarefa: Activity,
  envio: Send,
  campainha: Bell,
  acompanhamento: CalendarClock,
  relato: Inbox,
  diretriz: ScrollText,
  lead: Building2,
  operador: Settings2,
};

export function rotuloAtor(ev, nomeOp) {
  const tipo = tipoAutor(ev.ator, ev.ator_tipo);
  if (tipo === "bot") {
    const de = String(ev.ator || "").split(":")[1];
    return { tipo, texto: de ? `Bot · ${de}` : "Bot" };
  }
  if (tipo === "sistema") return { tipo, texto: ev.ator || "Sistema" };
  return { tipo, texto: nomeOp(ev.ator) };
}

export default function LinhaDoTempo({ eventos, mostrarEntidade = false, onAbrir, podeAbrir }) {
  const { nomeOp } = useApp();
  if (!eventos?.length) return <div className="muted">Nenhum evento registrado.</div>;
  return (
    <ol className="linha-tempo">
      {eventos.map((ev) => {
        const IconeEnt = ICONE_ENTIDADE[ev.entidade] || Activity;
        const ator = rotuloAtor(ev, nomeOp);
        const IconeAtor = ator.tipo === "bot" ? Bot : ator.tipo === "sistema" ? Workflow : User;
        return (
          <li key={ev.id} className={`lt-item lt-${ator.tipo}`}>
            <span className="lt-ponto"><IconeEnt size={14} /></span>
            <div className="lt-conteudo">
              <div className="lt-topo">
                <span className={`selo selo-${ator.tipo}`}><IconeAtor size={12} /> {ator.texto}</span>
                {mostrarEntidade && <span className="lt-entidade">{ev.entidade}{ev.acao ? ` · ${ev.acao}` : ""}</span>}
                <span className="lt-hora" title={fmtData(ev.criado_em)}>{tempoRelativo(ev.criado_em)}</span>
              </div>
              <div className="lt-resumo">
                {onAbrir && ev.entidade_id && (!podeAbrir || podeAbrir(ev)) ? (
                  <button className="link" onClick={() => onAbrir(ev)}>{ev.resumo || ev.acao}</button>
                ) : (ev.resumo || ev.acao)}
                {ev.dominio && <span className="lt-dominio"> · {ev.dominio}</span>}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
