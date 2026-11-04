// Leads: tabela com estágio colorido e detalhe (contatos, interações, ações, tarefas).
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useAcao, useApp, useDados } from "../contexto.jsx";
import { ESTAGIOS, ESTAGIO_MAP, STATUS_TAREFA_MAP } from "../constants.js";
import { cx, deInputLocal, fmtData, lista, paraInputLocal, tempoRelativo } from "../util.js";
import { PilulaStatus } from "../components/Pilula.jsx";
import { Avatar } from "../components/Operador.jsx";
import Tabela from "../components/Tabela.jsx";
import { Carregando, ErroBox, Vazio } from "../components/Estados.jsx";
import Gaveta, { Campos, Secao } from "../components/Gaveta.jsx";

const ORDENS = [
  { chave: "proximo_followup_em", label: "Próximo follow-up", crescente: 1 },
  { chave: "ultimo_envio", label: "Último envio", crescente: 0 },
  { chave: "dominio", label: "Domínio", crescente: 1 },
];

export function LeadDetalhe({ dominio, onFechar }) {
  const { podeEditar } = useApp();
  const [executar, ocupado] = useAcao();
  const { dados, erro, carregando, recarregar } = useDados(() => api.lead(dominio), [dominio]);
  const lead = dados?.lead;
  const [f, setF] = useState(null);
  useEffect(() => {
    if (lead && !f) setF({ estagio_funil: lead.estagio_funil, proximo_followup_em: paraInputLocal(lead.proximo_followup_em), observacao: lead.observacao || "" });
  }, [lead, f]);
  const dono = lead?.dono_email || lead?.operador;
  const ed = lead && podeEditar(dono);

  async function salvar(e) {
    e.preventDefault();
    await executar(() => api.mudarEstagio(dominio, {
      estagio_funil: f.estagio_funil,
      proximo_followup_em: deInputLocal(f.proximo_followup_em),
      observacao: f.observacao,
    }), "Lead atualizado");
  }

  return (
    <Gaveta
      onFechar={onFechar}
      titulo={dominio}
      subtitulo={lead && <>
        <PilulaStatus mapa={ESTAGIO_MAP} valor={lead.estagio_funil} />
        {lead.empresa && <span>{lead.empresa}</span>}
        <Avatar email={dono} comNome />
      </>}
    >
      {!dados && carregando && <Carregando />}
      <ErroBox erro={erro} onTentar={recarregar} />
      {lead && (
        <>
          <Secao titulo="Resumo">
            <Campos itens={[
              ["Respondeu", lead.teve_resposta ? "Sim" : "Não"],
              ["Rodada", lead.rodada ? `R${lead.rodada}` : null],
              ["Primeiro envio", lead.primeiro_envio && fmtData(lead.primeiro_envio)],
              ["Último envio", lead.ultimo_envio && fmtData(lead.ultimo_envio)],
              ["Próximo follow-up", lead.proximo_followup_em && `${fmtData(lead.proximo_followup_em)} (${tempoRelativo(lead.proximo_followup_em)})`],
              ["CNPJ", lead.cnpj],
            ]} />
          </Secao>

          <Secao titulo="Estágio e follow-up">
            {!ed && <div className="nota-info">Somente leitura: este lead é de outro operador.</div>}
            {f && (
              <form className="form" onSubmit={salvar}>
                <div className="form-grade">
                  <label className="form-campo">
                    <span>Estágio</span>
                    <select value={f.estagio_funil} disabled={!ed} onChange={(e) => setF({ ...f, estagio_funil: e.target.value })}>
                      {ESTAGIOS.map((s) => <option key={s.chave} value={s.chave}>{s.label}</option>)}
                    </select>
                  </label>
                  <label className="form-campo">
                    <span>Próximo follow-up</span>
                    <input type="datetime-local" disabled={!ed} value={f.proximo_followup_em} onChange={(e) => setF({ ...f, proximo_followup_em: e.target.value })} />
                  </label>
                  <label className="form-campo form-campo-largo">
                    <span>Observação</span>
                    <textarea rows={2} disabled={!ed} value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} />
                  </label>
                </div>
                {ed && <div className="form-botoes"><button className="btn btn-primario" disabled={ocupado}>Salvar</button></div>}
              </form>
            )}
          </Secao>

          <Secao titulo={`Contatos (${dados.contatos?.length || 0})`}>
            <ul className="lista-simples">
              {(dados.contatos || []).map((c) => (
                <li key={c.id || c.email}><b>{c.nome || c.email}</b> <span className="muted">{c.email}{c.cargo ? ` · ${c.cargo}` : ""}</span></li>
              ))}
            </ul>
          </Secao>

          <Secao titulo={`Tarefas (${dados.tarefas?.length || 0})`}>
            <ul className="lista-simples">
              {(dados.tarefas || []).map((t) => (
                <li key={t.id} className="lista-simples-topo">
                  <span>{t.titulo}</span>
                  <PilulaStatus mapa={STATUS_TAREFA_MAP} valor={t.status} pequena />
                </li>
              ))}
              {!dados.tarefas?.length && <li className="muted">Nenhuma tarefa para este lead.</li>}
            </ul>
          </Secao>

          <Secao titulo={`Interações (${dados.interacoes?.length || 0})`}>
            <ul className="lista-simples">
              {(dados.interacoes || []).map((i) => (
                <li key={i.id}>
                  <div className="lista-simples-topo">
                    <span><span className={cx("selo", i.direcao === "recebido" ? "selo-ok" : "selo-sistema")}>{i.direcao}</span> <b>{i.assunto || i.canal}</b></span>
                    <span className="muted" title={fmtData(i.data_interacao)}>{tempoRelativo(i.data_interacao)}</span>
                  </div>
                  <div className="muted pequeno">{i.nome ? `${i.nome} <${i.email}>` : i.email} · {i.canal}</div>
                  {i.trecho && <div className="trecho">{i.trecho}</div>}
                </li>
              ))}
            </ul>
          </Secao>

          <Secao titulo={`Ações registradas (${dados.acoes?.length || 0})`}>
            <ul className="lista-simples">
              {(dados.acoes || []).map((a) => (
                <li key={a.id} className="lista-simples-topo">
                  <span><code>{a.tipo_acao}</code> {a.descricao}{a.rodada ? ` (R${a.rodada})` : ""}</span>
                  <span className="muted">{fmtData(a.criado_em || a.data_hora)}</span>
                </li>
              ))}
            </ul>
          </Secao>
        </>
      )}
    </Gaveta>
  );
}

export default function Leads({ painel }) {
  const { operadorFiltro, busca } = useApp();
  const [estagio, setEstagio] = useState("");
  const [soResposta, setSoResposta] = useState(false);
  const [ordem, setOrdem] = useState("proximo_followup_em");
  const [aberto, setAberto] = useState(null);
  const o = ORDENS.find((x) => x.chave === ordem);
  // A busca dos leads vai para a API (`busca=`), então espera o usuário parar de digitar.
  const [buscaD, setBuscaD] = useState(busca);
  useEffect(() => { const t = setTimeout(() => setBuscaD(busca), 350); return () => clearTimeout(t); }, [busca]);
  const { dados, erro, carregando, recarregar } = useDados(
    () => api.leads({ operador: operadorFiltro, estagio, teve_resposta: soResposta ? 1 : "", busca: buscaD.trim(), ordenar: o.chave, crescente: o.crescente, limite: 500 }),
    [operadorFiltro, estagio, soResposta, buscaD, ordem],
  );
  const leads = lista(dados, "leads");
  const porEstagio = painel?.por_estagio || {};

  return (
    <div className="view">
      <div className="view-cab">
        <div>
          <h1>Leads</h1>
          <p className="muted">{dados?.total ?? leads.length} leads{operadorFiltro ? " deste operador" : " na base"}.</p>
        </div>
        <div className="barra-ferramentas">
          <label className="check"><input type="checkbox" checked={soResposta} onChange={(e) => setSoResposta(e.target.checked)} /> só quem respondeu</label>
          <select value={ordem} onChange={(e) => setOrdem(e.target.value)} aria-label="Ordenar por">
            {ORDENS.map((x) => <option key={x.chave} value={x.chave}>Ordenar: {x.label}</option>)}
          </select>
        </div>
      </div>
      <div className="chips-filtro">
        <button className={cx("chip-filtro", !estagio && "ativo")} onClick={() => setEstagio("")}>Todos</button>
        {ESTAGIOS.map((s) => (
          <button key={s.chave} className={cx("chip-filtro", estagio === s.chave && "ativo")} onClick={() => setEstagio(s.chave)} style={{ "--cor-chip": s.cor }}>
            <span className="ponto" style={{ background: s.cor }} /> {s.label}
            {typeof porEstagio[s.chave] === "number" && <span className="chip-n">{porEstagio[s.chave]}</span>}
          </button>
        ))}
      </div>
      <ErroBox erro={erro} onTentar={recarregar} />
      {!dados && carregando && <Carregando />}
      {dados && !leads.length && <Vazio>Nenhum lead.</Vazio>}
      {leads.length > 0 && (
        <section className="grupo" style={{ "--cor-grupo": estagio ? ESTAGIO_MAP[estagio].cor : "#0073ea" }}>
          <div className="grupo-corpo">
            <Tabela larguras={[null, 200, 150, 120, 100, 80, 120, 140]}>
                <thead>
                  <tr>
                    <th className="col-titulo">Domínio</th>
                    <th>Empresa</th>
                    <th className="col-status">Estágio</th>
                    <th>Operador</th>
                    <th>Respondeu</th>
                    <th>Rodada</th>
                    <th>Último envio</th>
                    <th>Próximo follow-up</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((l) => {
                    const atrasado = l.proximo_followup_em && new Date(l.proximo_followup_em) < new Date();
                    return (
                      <tr key={l.id || l.dominio} className="linha-clicavel" onClick={() => setAberto(l.dominio)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setAberto(l.dominio)}>
                        <td className="col-titulo"><span className="titulo-celula">{l.dominio}</span></td>
                        <td>{l.empresa || <span className="muted">—</span>}</td>
                        <td className="celula-status"><PilulaStatus mapa={ESTAGIO_MAP} valor={l.estagio_funil} cheia /></td>
                        <td><Avatar email={l.dono_email || l.operador} comNome /></td>
                        <td>{l.teve_resposta ? <span className="selo selo-ok">sim</span> : <span className="muted">não</span>}</td>
                        <td>{l.rodada ? `R${l.rodada}` : <span className="muted">—</span>}</td>
                        <td title={fmtData(l.ultimo_envio)}>{l.ultimo_envio ? tempoRelativo(l.ultimo_envio) : <span className="muted">nunca</span>}</td>
                        <td className={cx(atrasado && "texto-erro")} title={fmtData(l.proximo_followup_em)}>{l.proximo_followup_em ? tempoRelativo(l.proximo_followup_em) : <span className="muted">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </Tabela>
          </div>
        </section>
      )}
      {aberto && <LeadDetalhe dominio={aberto} onFechar={() => setAberto(null)} />}
    </div>
  );
}
