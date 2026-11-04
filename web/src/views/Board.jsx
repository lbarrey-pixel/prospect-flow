// Board: a visão do gestor sobre a prospecção (GET /board).
// Topo com os números que importam (retorno, propostas, convertidos), o período
// comparado com o anterior, a atividade por dia, o funil, a carteira por estágio,
// o placar por operador, a saúde da operação e os leads quentes.
// Gráficos em SVG puro, sem biblioteca.
import { useMemo, useState } from "react";
import { api } from "../api.js";
import { useApp, useDados } from "../contexto.jsx";
import { CORES_OPERADOR, ESTAGIOS, ESTAGIO_MAP } from "../constants.js";
import { cx, tempoRelativo } from "../util.js";
import { Carregando, ErroBox, Vazio } from "../components/Estados.jsx";
import Icone from "../components/Icone.jsx";
import { LeadDetalhe } from "./Leads.jsx";

const PERIODOS = [[7, "7 dias"], [30, "30 dias"], [90, "90 dias"]];
const ETAPAS = {
  prospectados: "Prospectados", responderam: "Responderam", interesse_real: "Interesse real",
  qualificados: "Qualificados", propostas: "Propostas", convertidos: "Clientes",
};

const n0 = (v) => (v ?? 0).toLocaleString("pt-BR");
const pct = (v, casas = 1) => (v === null || v === undefined ? "—" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: casas, minimumFractionDigits: casas })}%`);
const diaCurto = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const diaLongo = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" });
const fmtHoras = (h) => (h === null || h === undefined ? "—" : h < 48 ? `${Math.round(h)} h` : `${(h / 24).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dias`);

// Variação contra o período anterior. `bomQuandoSobe=false` para bounce.
function Delta({ atual, anterior, bomQuandoSobe = true, taxa = false }) {
  if (anterior === null || anterior === undefined || atual === null || atual === undefined) return null;
  if (!taxa && !anterior) return atual ? <span className="bd-delta neutro">novo</span> : null;
  const d = taxa ? (atual - anterior) * 100 : ((atual - anterior) / anterior) * 100;
  if (Math.abs(d) < 0.05) return <span className="bd-delta neutro">= anterior</span>;
  const bom = (d > 0) === bomQuandoSobe;
  return (
    <span className={cx("bd-delta", bom ? "bom" : "ruim")} title="Comparado com o período anterior de mesmo tamanho">
      {d > 0 ? "▲" : "▼"} {Math.abs(d).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}{taxa ? " p.p." : "%"}
    </span>
  );
}

function Sparkline({ valores, cor }) {
  if (!valores?.length) return null;
  const max = Math.max(1, ...valores);
  const w = 96, h = 28;
  const pts = valores.map((v, i) => [(i / Math.max(1, valores.length - 1)) * w, h - 2 - (v / max) * (h - 4)]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  return (
    <svg className="bd-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <path d={`${d}L${w},${h}L0,${h}Z`} fill={cor} opacity="0.12" />
      <path d={d} fill="none" stroke={cor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Anel({ valor, rotulo }) {
  const r = 42, c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, valor || 0));
  return (
    <svg className="bd-anel" viewBox="0 0 100 100" width="112" height="112" role="img" aria-label={`${rotulo}: ${pct(valor)}`}>
      <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,.18)" strokeWidth="9" />
      <circle cx="50" cy="50" r={r} fill="none" stroke="url(#bd-grad-anel)" strokeWidth="9" strokeLinecap="round"
        strokeDasharray={`${c * v} ${c}`} transform="rotate(-90 50 50)" />
      <defs>
        <linearGradient id="bd-grad-anel" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7ef0c4" /><stop offset="1" stopColor="#ffffff" />
        </linearGradient>
      </defs>
      <text x="50" y="53" textAnchor="middle" className="bd-anel-valor">{pct(valor, 1)}</text>
      <text x="50" y="68" textAnchor="middle" className="bd-anel-rotulo">{rotulo}</text>
    </svg>
  );
}

function Hero({ b }) {
  const f = Object.fromEntries(b.funil.map((x) => [x.etapa, x.n]));
  const a = b.acumulado;
  const desde = b.inicio_prospeccao ? new Date(b.inicio_prospeccao).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" }) : null;
  return (
    <section className="bd-hero">
      <div className="bd-hero-brilho" aria-hidden="true" />
      <div className="bd-hero-texto">
        <span className="bd-hero-selo"><Icone nome="Sparkles" size={14} /> Prospecção ativa{desde ? ` desde ${desde}` : ""}</span>
        <h1>Board de prospecção</h1>
        <p>O bot abordou <b>{n0(f.prospectados)}</b> empresas com <b>{n0(a.emails)}</b> e-mails.
          {" "}<b>{n0(f.responderam)}</b> responderam, <b>{n0(f.qualificados)}</b> viraram oportunidade e <b>{n0(f.propostas)}</b> chegaram a proposta.</p>
      </div>
      <div className="bd-hero-numeros">
        <Anel valor={a.taxa_retorno} rotulo="retorno" />
        <div className="bd-hero-num">
          <span className="v">{n0(f.qualificados)}</span>
          <span className="r">oportunidades</span>
          <span className="s">{pct(a.taxa_qualificacao, 0)} de quem respondeu</span>
        </div>
        <div className="bd-hero-num">
          <span className="v">{n0(f.propostas)}</span>
          <span className="r">propostas</span>
          <span className="s">{pct(a.taxa_proposta, 0)} de quem respondeu</span>
        </div>
        <div className="bd-hero-num destaque">
          <span className="v">{n0(f.convertidos)}</span>
          <span className="r">clientes</span>
          <span className="s">{pct(a.taxa_conversao, 1)} dos prospectados</span>
        </div>
      </div>
    </section>
  );
}

function Tile({ icone, cor, rotulo, valor, delta, spark, sub }) {
  return (
    <div className="bd-tile">
      <div className="bd-tile-topo">
        <span className="bd-tile-icone" style={{ background: `${cor}1f`, color: cor }}><Icone nome={icone} size={16} /></span>
        <span className="bd-tile-rotulo">{rotulo}</span>
      </div>
      <div className="bd-tile-meio">
        <span className="bd-tile-valor">{valor}</span>
        {spark}
      </div>
      <div className="bd-tile-pe">{delta}{sub ? <span className="muted">{sub}</span> : null}</div>
    </div>
  );
}

function Cartao({ titulo, sub, acao, children, className }) {
  return (
    <section className={cx("bd-cartao", className)}>
      <header className="bd-cartao-cab">
        <div><h2>{titulo}</h2>{sub ? <p className="muted">{sub}</p> : null}</div>
        {acao}
      </header>
      {children}
    </section>
  );
}

// Atividade diária: barras de e-mails enviados + linha de respostas (mesma escala: contagem).
function Atividade({ serie }) {
  const [foco, setFoco] = useState(null);
  const W = 720, H = 220, E = 34, D = 8, T = 10, B = 24;
  const max = Math.max(4, ...serie.map((d) => Math.max(d.emails, d.respostas)));
  // Topo "redondo" e par, para os três ticks serem inteiros.
  const passo = Math.max(2, Math.pow(10, Math.floor(Math.log10(max))) / 2);
  const topo = Math.ceil(max / passo) * passo + (Math.ceil(max / passo) % 2 ? passo : 0);
  const ticks = [0, topo / 2, topo];
  const larg = (W - E - D) / serie.length;
  const x = (i) => E + i * larg + larg / 2;
  const y = (v) => T + (H - T - B) * (1 - v / topo);
  const linha = serie.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.respostas).toFixed(1)}`).join("");
  const barra = Math.max(2, Math.min(18, larg - 3));
  const cadaRotulo = Math.ceil(serie.length / 8);
  const f = foco !== null ? serie[foco] : null;
  return (
    <div className="bd-grafico" onMouseLeave={() => setFoco(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="E-mails enviados e respostas por dia">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={E} x2={W - D} y1={y(t)} y2={y(t)} className="bd-grade" />
            <text x={E - 6} y={y(t) + 4} textAnchor="end" className="bd-eixo">{n0(t)}</text>
          </g>
        ))}
        {serie.map((d, i) => d.emails > 0 && (
          <rect key={d.dia} x={x(i) - barra / 2} y={y(d.emails)} width={barra} height={Math.max(0, y(0) - y(d.emails))}
            rx={Math.min(4, barra / 2)} className={cx("bd-barra", foco === i && "foco")} />
        ))}
        <path d={linha} className="bd-linha" />
        {serie.map((d, i) => d.respostas > 0 && (
          <circle key={d.dia} cx={x(i)} cy={y(d.respostas)} r={foco === i ? 5 : 3.5} className="bd-ponto" />
        ))}
        {serie.map((d, i) => ((i % cadaRotulo === 0 && serie.length - 1 - i >= cadaRotulo / 2) || i === serie.length - 1) && (
          <text key={d.dia} x={x(i)} y={H - 6} textAnchor="middle" className="bd-eixo">{diaCurto(d.dia)}</text>
        ))}
        {foco !== null && <line x1={x(foco)} x2={x(foco)} y1={T} y2={y(0)} className="bd-mira" />}
        {serie.map((d, i) => (
          <rect key={d.dia} x={E + i * larg} y={0} width={larg} height={H} fill="transparent" onMouseEnter={() => setFoco(i)} />
        ))}
      </svg>
      {f && (
        <div className="bd-tooltip" style={{ left: `${(x(foco) / W) * 100}%` }}>
          <b>{diaLongo(f.dia)}</b>
          <span><i className="bd-leg-q env" /> {n0(f.emails)} e-mails</span>
          <span><i className="bd-leg-q resp" /> {n0(f.respostas)} respostas</span>
          {f.bounces ? <span className="muted">{n0(f.bounces)} não entregues</span> : null}
        </div>
      )}
      <div className="bd-legenda">
        <span><i className="bd-leg-q env" /> E-mails enviados</span>
        <span><i className="bd-leg-l resp" /> Respostas</span>
      </div>
    </div>
  );
}

function Funil({ funil }) {
  const max = Math.max(1, funil[0]?.n || 0);
  return (
    <ol className="bd-funil">
      {funil.map((e, i) => {
        const ant = i ? funil[i - 1].n : null;
        return (
          <li key={e.etapa} className="bd-funil-etapa">
            <div className="bd-funil-rotulo">
              <span>{ETAPAS[e.etapa] || e.etapa}</span>
              {ant ? <span className="bd-funil-conv" title="Passagem desde a etapa anterior">{pct(e.n / ant, 0)}</span> : null}
              <b>{n0(e.n)}</b>
            </div>
            <div className="bd-funil-trilho">
              <div className={`bd-funil-barra e${i}`} style={{ width: `${Math.max(e.n ? 1.5 : 0, (e.n / max) * 100)}%` }} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Carteira({ carteira }) {
  const total = carteira.total || 0;
  const itens = ESTAGIOS.map((e) => ({ ...e, n: carteira.estagios?.[e.chave] || 0 })).filter((e) => e.n);
  return (
    <div className="bd-carteira">
      <div className="bd-carteira-total"><span className="v">{n0(total)}</span><span className="muted">leads na base</span></div>
      <div className="bd-pilha" role="img" aria-label="Leads por estágio">
        {itens.map((e) => (
          <span key={e.chave} style={{ flexGrow: e.n, background: e.cor }} title={`${e.label}: ${n0(e.n)} (${pct(e.n / total, 0)})`} />
        ))}
      </div>
      <ul className="bd-carteira-lista">
        {itens.map((e) => (
          <li key={e.chave}>
            <i style={{ background: e.cor }} />
            <span>{e.label}</span>
            <b>{n0(e.n)}</b>
            <span className="muted">{pct(e.n / total, 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Rodadas({ rodadas }) {
  const itens = [["R1", "1º toque"], ["R2", "2º toque"], ["R3", "3º toque"], ["outros", "Reenvios e respostas"]];
  const max = Math.max(1, ...itens.map(([k]) => rodadas[k] || 0));
  return (
    <ul className="bd-rodadas">
      {itens.map(([k, rot]) => (
        <li key={k}>
          <span className="bd-rodada-k">{k === "outros" ? "+" : k}</span>
          <span className="bd-rodada-r">{rot}</span>
          <span className="bd-rodada-trilho"><span style={{ width: `${((rodadas[k] || 0) / max) * 100}%` }} /></span>
          <b>{n0(rodadas[k])}</b>
        </li>
      ))}
    </ul>
  );
}

function Operadores({ linhas, operadores }) {
  const cor = (email) => CORES_OPERADOR[Math.max(0, operadores.findIndex((o) => o.email === email)) % CORES_OPERADOR.length];
  const maxTaxa = Math.max(0.01, ...linhas.map((l) => l.taxa_retorno || 0));
  return (
    <div className="bd-tabela-wrap">
      <table className="bd-tabela">
        <thead>
          <tr>
            <th>Operador</th><th className="num">Carteira</th><th className="num">Prospectados</th><th className="num">E-mails</th>
            <th className="num">Responderam</th><th>Retorno</th><th className="num">Oportunid.</th><th className="num">Propostas</th>
            <th className="num">Clientes</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.operador}>
              <td><span className="bd-avatar" style={{ background: cor(l.operador) }}>{(l.nome || "?").charAt(0)}</span>{l.nome}</td>
              <td className="num">{n0(l.carteira)}</td>
              <td className="num">{n0(l.prospectados)}</td>
              <td className="num">{n0(l.emails)}{l.emails_periodo ? <span className="muted"> · {n0(l.emails_periodo)} no período</span> : null}</td>
              <td className="num">{n0(l.responderam)}</td>
              <td>
                <span className="bd-taxa">
                  <span className="bd-taxa-trilho"><span style={{ width: `${((l.taxa_retorno || 0) / maxTaxa) * 100}%` }} /></span>
                  {pct(l.taxa_retorno)}
                </span>
              </td>
              <td className="num">{n0(l.qualificados)}</td>
              <td className="num">{n0(l.propostas)}</td>
              <td className="num" title={`${n0(l.convertidos_carteira)} clientes na carteira toda`}>{n0(l.convertidos)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Operacao({ o, irPara }) {
  const ts = o.tarefas_status || {};
  const decididas = (ts.executou || 0) + (ts.parcial || 0) + (ts.adiou || 0) + (ts.recusou || 0) + (ts.bloqueado_humano || 0);
  const abertas = (ts.pendente || 0) + (ts.entregue || 0) + (ts.em_andamento || 0);
  const es = o.envios_status || {};
  const itens = [
    { icone: "Bot", cor: "#9d50dd", v: pct(decididas ? ((ts.executou || 0) + (ts.parcial || 0)) / decididas : null, 0), r: "tarefas executadas pelo bot", s: `${n0(ts.adiou)} adiadas · ${n0(ts.recusou)} recusadas`, area: "tarefas" },
    { icone: "LayoutGrid", cor: "#f59a23", v: n0(abertas), r: "tarefas em aberto", s: ts.bloqueado_humano ? `${n0(ts.bloqueado_humano)} esperando humano` : "fila em dia", area: "tarefas", alerta: ts.bloqueado_humano > 0 },
    { icone: "ShieldQuestion", cor: "#e2445c", v: n0(es.bloqueado), r: "envios barrados pelas regras", s: `${n0(es.enviado)} enviados pelo n8n`, area: "envios", alerta: es.bloqueado > 0 },
    { icone: "Inbox", cor: "#3d9ad6", v: n0(o.relatos_nao_lidos), r: "relatos do bot não lidos", s: "o bot reportando", area: "relatos", alerta: o.relatos_nao_lidos > 0 },
    { icone: "BellRing", cor: "#e2445c", v: n0(o.campainhas_ativas), r: "campainhas ativas", s: "vigiando caixas", area: "campainhas" },
    { icone: "CalendarClock", cor: "#00a35c", v: n0(o.followups_7d), r: "follow-ups em 7 dias", s: `${n0(o.acompanhamentos_agendados)} acompanhamentos agendados`, area: "acompanhamentos" },
  ];
  return (
    <div className="bd-operacao">
      {itens.map((it) => (
        <button key={it.r} className={cx("bd-op-item", it.alerta && "alerta")} onClick={() => irPara(it.area)}>
          <span className="bd-tile-icone" style={{ background: `${it.cor}1f`, color: it.cor }}><Icone nome={it.icone} size={16} /></span>
          <span className="bd-op-v">{it.v}</span>
          <span className="bd-op-r">{it.r}</span>
          <span className="muted bd-op-s">{it.s}</span>
        </button>
      ))}
    </div>
  );
}

function Quentes({ itens, nomeOp, onAbrir }) {
  if (!itens.length) return <Vazio>Nenhuma resposta ainda.</Vazio>;
  return (
    <ul className="bd-quentes">
      {itens.map((q) => {
        const e = ESTAGIO_MAP[q.estagio];
        return (
          <li key={q.dominio}>
            <button onClick={() => onAbrir(q.dominio)}>
              <span className="bd-q-topo">
                <b>{q.empresa || q.dominio}</b>
                {q.interesse === "real" && <span className="selo selo-ok"><Icone nome="Flame" size={12} /> interesse real</span>}
                {e && <span className="bd-q-estagio" style={{ color: e.cor, background: `${e.cor}1a` }}>{e.label}</span>}
              </span>
              {q.trecho && <span className="bd-q-trecho">“{q.trecho}”</span>}
              <span className="muted bd-q-meta">{nomeOp(q.operador)} · respondeu {tempoRelativo(q.respondeu_em)}{q.dominio && q.empresa ? ` · ${q.dominio}` : ""}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export default function Board({ irPara }) {
  const { operadorFiltro, operadores, nomeOp } = useApp();
  const [dias, setDias] = useState(30);
  const [leadAberto, setLeadAberto] = useState(null);
  const { dados: b, erro, carregando, recarregar } = useDados(() => api.board({ dias, operador: operadorFiltro }), [dias, operadorFiltro]);

  const sparks = useMemo(() => {
    const s = b?.serie || [];
    return { emails: s.map((d) => d.emails), respostas: s.map((d) => d.respostas), bounces: s.map((d) => d.bounces) };
  }, [b]);

  if (!b) {
    return (
      <div className="view">
        <ErroBox erro={erro} onTentar={recarregar} />
        {carregando && <Carregando texto="Montando o board…" />}
      </div>
    );
  }
  const p = b.periodo, a = b.anterior;

  return (
    <div className="view bd">
      <Hero b={b} />

      <div className="bd-periodo">
        <span className="muted">
          {b.operador ? `${nomeOp(b.operador)} · ` : "Todos os operadores · "}
          {new Date(`${b.de}T12:00:00`).toLocaleDateString("pt-BR")} a {new Date(`${b.ate}T12:00:00`).toLocaleDateString("pt-BR")}, comparado com os {b.dias} dias anteriores
        </span>
        <div className="chips-filtro">
          {PERIODOS.map(([d, r]) => (
            <button key={d} className={cx("chip-filtro", dias === d && "ativo")} onClick={() => setDias(d)}>{r}</button>
          ))}
        </div>
      </div>

      <div className="bd-tiles">
        <Tile icone="Send" cor="#2a78d6" rotulo="E-mails enviados" valor={n0(p.emails)} spark={<Sparkline valores={sparks.emails} cor="#2a78d6" />}
          delta={<Delta atual={p.emails} anterior={a.emails} />} />
        <Tile icone="Reply" cor="#1baf7a" rotulo="Respostas" valor={n0(p.respostas)} spark={<Sparkline valores={sparks.respostas} cor="#1baf7a" />}
          delta={<Delta atual={p.respostas} anterior={a.respostas} />} sub={`${pct(p.taxa_resposta)} por e-mail`} />
        <Tile icone="Flame" cor="#eb6834" rotulo="Interesse real" valor={n0(p.interesse_real)}
          delta={<Delta atual={p.interesse_real} anterior={a.interesse_real} />} sub="pediram catálogo, cotação ou contato" />
        <Tile icone="Building2" cor="#4a3aa7" rotulo="Empresas abordadas" valor={n0(p.novos_leads)}
          delta={<Delta atual={p.novos_leads} anterior={a.novos_leads} />} sub="primeiro toque no período" />
        <Tile icone="AlertTriangle" cor="#d03b3b" rotulo="Não entregues" valor={pct(p.taxa_bounce)} spark={<Sparkline valores={sparks.bounces} cor="#d03b3b" />}
          delta={<Delta atual={p.taxa_bounce} anterior={a.taxa_bounce} bomQuandoSobe={false} taxa />} sub={`${n0(p.bounces)} bounces`} />
        <Tile icone="Timer" cor="#0891b2" rotulo="Tempo até responder" valor={fmtHoras(b.acumulado.mediana_horas_ate_resposta)} sub="mediana desde o 1º e-mail" />
      </div>

      <div className="bd-grade-2">
        <Cartao titulo="Atividade do bot" sub="E-mails enviados e respostas humanas por dia" className="bd-largo">
          <Atividade serie={b.serie} />
        </Cartao>
        <Cartao titulo="Funil da prospecção" sub="Acumulado desde o início · % = passagem da etapa anterior">
          <Funil funil={b.funil} />
        </Cartao>
      </div>

      <div className="bd-grade-3">
        <Cartao titulo="Status da carteira" sub="Todos os leads do CRM por estágio">
          <Carteira carteira={b.carteira} />
        </Cartao>
        <Cartao titulo="Cadência no período" sub="E-mails por rodada (só R1 a R3 contam no teto)">
          <Rodadas rodadas={p.rodadas} />
        </Cartao>
        <Cartao titulo="Clientes recentes" sub="Leads que viraram proposta no ERP">
          {b.convertidos_recentes.length ? (
            <ul className="bd-conv">
              {b.convertidos_recentes.map((c) => (
                <li key={c.dominio}>
                  <button onClick={() => setLeadAberto(c.dominio)}>
                    <span className="bd-conv-ic"><Icone nome="Trophy" size={14} /></span>
                    <span className="bd-conv-n"><b>{c.empresa || c.dominio}</b><span className="muted">{nomeOp(c.operador)}{c.em ? ` · ${tempoRelativo(c.em)}` : ""}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <Vazio>Nenhum convertido ainda.</Vazio>}
        </Cartao>
      </div>

      <Cartao titulo="Placar por operador" sub="Prospecção do bot de cada um (acumulado) e a carteira de cada um">
        <Operadores linhas={b.operadores} operadores={operadores} />
      </Cartao>

      <div className="bd-grade-2 inverso">
        <Cartao titulo="Leads quentes" sub="Últimas respostas, interesse real primeiro">
          <Quentes itens={b.quentes} nomeOp={nomeOp} onAbrir={setLeadAberto} />
        </Cartao>
        <Cartao titulo="Saúde da operação" sub={`Tarefas e envios dos últimos ${b.dias} dias; clique para abrir`}>
          <Operacao o={b.operacao} irPara={irPara} />
        </Cartao>
      </div>

      {leadAberto && <LeadDetalhe dominio={leadAberto} onFechar={() => setLeadAberto(null)} />}
    </div>
  );
}
