// Diário: o que aconteceu num dia, em cartões (GET /diario + GET /diario/dias).
// E-mails enviados, respostas, bounces, notas e decisões do bot, e o que o
// o Prospect Flow fez (tarefas, campainhas, diretrizes). Clicar abre o lead ou a tarefa.
import { useMemo, useState } from "react";
import { api } from "../api.js";
import { useApp, useDados } from "../contexto.jsx";
import { contem, cx, fmtHora } from "../util.js";
import { Carregando, ErroBox, Vazio } from "../components/Estados.jsx";
import Icone from "../components/Icone.jsx";
import { LeadDetalhe } from "./Leads.jsx";
import TarefaDetalhe from "./TarefaDetalhe.jsx";

const TIPOS = {
  email_enviado: { label: "E-mail enviado", icone: "Mail", cor: "#0073ea" },
  resposta: { label: "Resposta", icone: "Reply", cor: "#00a35c" },
  bounce: { label: "Não entregue", icone: "AlertTriangle", cor: "#e2445c" },
  nota: { label: "Nota", icone: "FileText", cor: "#676879" },
  decisao: { label: "Decisão do bot", icone: "Bot", cor: "#9d50dd" },
  tarefa: { label: "Tarefa", icone: "LayoutGrid", cor: "#f59a23" },
  campainha: { label: "Campainha", icone: "BellRing", cor: "#e2445c" },
  diretriz: { label: "Diretriz", icone: "ScrollText", cor: "#9d50dd" },
};
const OUTRO = { label: "Sistema", icone: "Activity", cor: "#676879" };
const tipoDe = (t) => TIPOS[t] || OUTRO;

const hojeIso = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const fmtDiaLongo = (iso) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
const maiuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);

function Kpi({ icone, cor, valor, rotulo, extra }) {
  return (
    <div className="kpi">
      <span className="kpi-icone" style={{ background: `${cor}1f`, color: cor }}><Icone nome={icone} size={18} /></span>
      <div>
        <div className="kpi-valor">{valor}</div>
        <div className="kpi-rotulo">{rotulo}{extra ? <span className="muted"> · {extra}</span> : null}</div>
      </div>
    </div>
  );
}

function Calendario({ dias, dia, onDia }) {
  const max = Math.max(1, ...dias.map((d) => d.emails + d.respostas));
  return (
    <div className="diario-cal" role="list" aria-label="Últimos 30 dias">
      {dias.map((d) => {
        const total = d.emails + d.respostas;
        const sem = new Date(`${d.dia}T12:00:00`).getDay();
        return (
          <button key={d.dia} role="listitem" className={cx("diario-cal-dia", d.dia === dia && "ativo", (sem === 0 || sem === 6) && "fds")}
            onClick={() => onDia(d.dia)}
            title={`${fmtDiaLongo(d.dia)}: ${d.emails} e-mails, ${d.respostas} respostas, ${d.bounces} não entregues`}>
            <span className="diario-cal-barra">
              <span className="b-env" style={{ height: `${(d.emails / max) * 100}%` }} />
              <span className="b-resp" style={{ height: `${(d.respostas / max) * 100}%` }} />
            </span>
            <span className="diario-cal-num">{Number(d.dia.slice(8))}</span>
            {total ? <span className="sr-only">{total}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function Cartao({ it, onAbrir }) {
  const t = tipoDe(it.tipo);
  const clicavel = !!(it.dominio || it.entidade === "tarefa");
  const Tag = clicavel ? "button" : "div";
  return (
    <Tag className={cx("diario-item", clicavel && "clicavel")} onClick={clicavel ? () => onAbrir(it) : undefined}>
      <span className="diario-hora">{fmtHora(it.em)}</span>
      <span className="diario-icone" style={{ background: t.cor }}><Icone nome={t.icone} size={15} /></span>
      <div className="diario-corpo">
        <div className="diario-linha1">
          <span className="diario-tipo" style={{ color: t.cor }}>{it.tipo === "email_enviado" && it.rodada ? `E-mail · R${it.rodada}` : t.label}</span>
          {it.dominio && <b className="diario-lead">{it.empresa || it.dominio}</b>}
          {it.empresa && it.dominio && <span className="muted">{it.dominio}</span>}
          {it.interesse === "real" && <span className="selo selo-ok">interesse real</span>}
          {it.tipo === "email_enviado" && !it.rodada && it.titulo && <span className="selo selo-sistema">{it.titulo}</span>}
          {it.ator_tipo === "bot" && <span className="selo selo-bot">bot</span>}
        </div>
        {it.assunto && <div className="diario-assunto">{it.assunto}</div>}
        {(it.para || it.de) && <div className="muted diario-meta">{it.para ? `para ${it.para}` : `de ${it.de}`}</div>}
        {!it.assunto && it.tipo !== "email_enviado" && it.titulo && it.origem === "evento" && <div className="diario-assunto">{it.titulo}</div>}
        {(it.detalhe || it.trecho) && <div className="diario-detalhe">{it.trecho || it.detalhe}</div>}
      </div>
    </Tag>
  );
}

export default function Diario() {
  const { operadorFiltro, busca } = useApp();
  const [dia, setDia] = useState(hojeIso());
  const [filtro, setFiltro] = useState("");
  const [leadAberto, setLeadAberto] = useState(null);
  const [tarefaAberta, setTarefaAberta] = useState(null);

  const { dados, erro, carregando, recarregar } = useDados(() => api.diario({ dia, operador: operadorFiltro }), [dia, operadorFiltro]);
  const { dados: cal } = useDados(() => api.diarioDias({ dias: 30, operador: operadorFiltro }), [operadorFiltro]);

  const itens = useMemo(() => (dados?.itens || []).filter((it) =>
    (!filtro || (filtro === "outros" ? !["email_enviado", "resposta", "bounce", "nota", "decisao"].includes(it.tipo) : it.tipo === filtro)) &&
    contem(`${it.dominio || ""} ${it.empresa || ""} ${it.assunto || ""} ${it.para || ""} ${it.de || ""} ${it.detalhe || ""} ${it.trecho || ""} ${it.titulo || ""}`, busca)
  ), [dados, filtro, busca]);

  const r = dados?.resumo || {};
  const n = (t) => (dados?.itens || []).filter((x) => x.tipo === t).length;
  const nOutros = (dados?.itens || []).filter((x) => !["email_enviado", "resposta", "bounce", "nota", "decisao"].includes(x.tipo)).length;
  const hoje = hojeIso();
  const abrir = (it) => {
    if (it.entidade === "tarefa" && it.entidade_id) setTarefaAberta(it.entidade_id);
    else if (it.dominio) setLeadAberto(it.dominio);
  };

  return (
    <div className="view">
      <div className="view-cab">
        <div>
          <h1>Diário</h1>
          <p className="muted">O que o bot e o CRM fizeram em cada dia: e-mails, respostas, bounces, notas e decisões.</p>
        </div>
        <div className="barra-ferramentas diario-nav">
          <button className="btn" onClick={() => setDia(somarDias(dia, -1))} aria-label="Dia anterior"><Icone nome="ChevronLeft" /></button>
          <input type="date" value={dia} max={hoje} onChange={(e) => e.target.value && setDia(e.target.value)} aria-label="Escolher dia" />
          <button className="btn" onClick={() => setDia(somarDias(dia, 1))} disabled={dia >= hoje} aria-label="Próximo dia"><Icone nome="ChevronRight" /></button>
          {dia !== hoje && <button className="btn" onClick={() => setDia(hoje)}>Hoje</button>}
        </div>
      </div>

      {cal?.dias?.length ? <Calendario dias={cal.dias} dia={dia} onDia={setDia} /> : null}

      <h2 className="diario-titulo-dia">{dia === hoje ? `Hoje, ${fmtDiaLongo(dia)}` : maiuscula(fmtDiaLongo(dia))}</h2>
      <div className="kpis">
        <Kpi icone="Mail" cor="#0073ea" valor={r.emails_enviados ?? "—"} rotulo="e-mails enviados" extra={r.rodadas ? `${r.rodadas} de rodada` : null} />
        <Kpi icone="Reply" cor="#00a35c" valor={r.respostas ?? "—"} rotulo="respostas" extra={r.interesse_real ? `${r.interesse_real} com interesse real` : null} />
        <Kpi icone="AlertTriangle" cor="#e2445c" valor={r.bounces ?? "—"} rotulo="não entregues" />
        <Kpi icone="Bot" cor="#9d50dd" valor={dados ? (r.notas || 0) + (r.decisoes || 0) : "—"} rotulo="notas e decisões" />
      </div>

      <div className="chips-filtro">
        {[["", "Tudo", dados?.itens?.length], ["email_enviado", "E-mails", n("email_enviado")], ["resposta", "Respostas", n("resposta")],
          ["bounce", "Não entregues", n("bounce")], ["nota", "Notas", n("nota")], ["decisao", "Decisões", n("decisao")], ["outros", "CRM e sistema", nOutros]]
          .map(([k, v, c]) => (
            <button key={k} className={cx("chip-filtro", filtro === k && "ativo")} onClick={() => setFiltro(k)}>
              {v} <span className="chip-n">{c ?? 0}</span>
            </button>
          ))}
      </div>

      <ErroBox erro={erro} onTentar={recarregar} />
      {!dados && carregando && <Carregando />}
      {dados && !itens.length && <Vazio>{dados.itens?.length ? "Nada com esse filtro." : "Nada registrado neste dia."}</Vazio>}
      {itens.length > 0 && (
        <div className="diario-lista">
          {itens.map((it) => <Cartao key={it.id} it={it} onAbrir={abrir} />)}
        </div>
      )}
      {leadAberto && <LeadDetalhe dominio={leadAberto} onFechar={() => setLeadAberto(null)} />}
      {tarefaAberta && <TarefaDetalhe id={tarefaAberta} onFechar={() => setTarefaAberta(null)} />}
    </div>
  );
}
