// Campainhas: o que vigiar nas caixas de entrada (domínio, remetente, assunto) e com que urgência.
import { useState } from "react";
import { Archive, Pencil, Plus } from "lucide-react";
import { api } from "../api.js";
import { useAcao, useApp, useDados } from "../contexto.jsx";
import { PRIORIDADE, PRIORIDADE_MAP, TIPO_CAMPAINHA } from "../constants.js";
import { contem, deInputLocal, fmtData, lista, paraInputLocal, tempoRelativo } from "../util.js";
import Grupo from "../components/Grupo.jsx";
import { Etiqueta, PilulaStatus } from "../components/Pilula.jsx";
import { Avatar, SeloAutor } from "../components/Operador.jsx";
import Tabela from "../components/Tabela.jsx";
import { Carregando, ErroBox, Vazio } from "../components/Estados.jsx";
import Gaveta, { Campos, Secao } from "../components/Gaveta.jsx";
import Modal, { ConfirmarComTexto } from "../components/Modal.jsx";
import { Campo, Interruptor, SelectOperador } from "../components/Form.jsx";

function FormCampainha({ inicial, onFechar }) {
  const { eu, operadorFiltro, operadores } = useApp();
  const [executar, ocupado] = useAcao();
  const novo = !inicial;
  const opInicial = inicial?.operador || (eu.admin && operadorFiltro) || eu.email;
  const [f, setF] = useState(() => ({
    operador: opInicial,
    nome: inicial?.nome || "",
    tipo: inicial?.tipo || "dominio",
    padrao: inicial?.padrao || "",
    caixa: inicial?.caixa || operadores.find((o) => o.email === opInicial)?.caixa || opInicial,
    prioridade: inicial?.prioridade || "urgente",
    instrucao: inicial?.instrucao || "",
    dominio_lead: inicial?.dominio_lead || "",
    expira_em: paraInputLocal(inicial?.expira_em),
    ativa: inicial ? !!inicial.ativa : true,
  }));
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? (e.target.type === "checkbox" ? e.target.checked : e.target.value) : e }));
  const dicaPadrao = { dominio: "Ex.: acme.example (qualquer remetente do domínio)", remetente: "Ex.: compras@acme.example", assunto: "Texto ou expressão no assunto. Ex.: orçamento|cotação" }[f.tipo];

  async function salvar(e) {
    e.preventDefault();
    const corpo = { ...f, dominio_lead: f.dominio_lead.trim() || null, expira_em: deInputLocal(f.expira_em) };
    const r = novo
      ? await executar(() => api.criarCampainha(corpo), "Campainha criada")
      : await executar(() => { const { operador: _op, ...resto } = corpo; return api.editarCampainha(inicial.id, resto); }, "Campainha salva");
    if (r) onFechar();
  }

  return (
    <Modal titulo={novo ? "Nova campainha" : `Editar campainha: ${inicial.nome}`} onFechar={onFechar}>
      <form className="form" onSubmit={salvar}>
        <div className="form-grade">
          <Campo rotulo="Nome" largo><input required value={f.nome} onChange={set("nome")} placeholder="Ex.: Acme respondeu" /></Campo>
          <Campo rotulo="Operador"><SelectOperador value={f.operador} onChange={set("operador")} disabled={!novo} /></Campo>
          <Campo rotulo="Caixa vigiada"><input value={f.caixa} onChange={set("caixa")} /></Campo>
          <Campo rotulo="Tipo">
            <select value={f.tipo} onChange={set("tipo")}>
              {Object.entries(TIPO_CAMPAINHA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Prioridade">
            <select value={f.prioridade} onChange={set("prioridade")}>
              {PRIORIDADE.map((p) => <option key={p.chave} value={p.chave}>{p.label}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Padrão" largo dica={dicaPadrao}><input required value={f.padrao} onChange={set("padrao")} /></Campo>
          <Campo rotulo="Instrução para o bot" largo><textarea rows={3} value={f.instrucao} onChange={set("instrucao")} placeholder="O que o bot deve fazer quando tocar" /></Campo>
          <Campo rotulo="Lead (domínio, opcional)"><input value={f.dominio_lead} onChange={set("dominio_lead")} placeholder="acme.example" /></Campo>
          <Campo rotulo="Expira em (opcional)"><input type="datetime-local" value={f.expira_em} onChange={set("expira_em")} /></Campo>
          <label className="check form-campo-largo"><input type="checkbox" checked={f.ativa} onChange={set("ativa")} /> Ativa</label>
        </div>
        <div className="form-botoes">
          <button type="button" className="btn" onClick={onFechar}>Cancelar</button>
          <button type="submit" className="btn btn-primario" disabled={ocupado}>{novo ? "Criar campainha" : "Salvar"}</button>
        </div>
      </form>
    </Modal>
  );
}

function CampainhaDetalhe({ c, onFechar, onEditar, onArquivar, onAlternar }) {
  const { podeEditar } = useApp();
  const ed = podeEditar(c.operador) && !c.arquivada_em;
  const { dados, carregando, erro } = useDados(() => api.disparosCampainha(c.id), [c.id]);
  const disparos = lista(dados, "disparos");
  return (
    <Gaveta
      onFechar={onFechar}
      titulo={c.nome}
      subtitulo={<>
        {c.arquivada_em ? <Etiqueta>Arquivada</Etiqueta> : c.ativa ? <Etiqueta tom="ok">Ativa</Etiqueta> : <Etiqueta>Inativa</Etiqueta>}
        <SeloAutor autor={c.criada_por} />
        <Avatar email={c.operador} comNome />
      </>}
      acoes={!c.arquivada_em && <>
        <span className="rotulo-interruptor"><Interruptor ligado={c.ativa} onChange={onAlternar} disabled={!ed} /> {c.ativa ? "Ativa" : "Inativa"}</span>
        <button className="btn" disabled={!ed} onClick={onEditar}><Pencil size={15} /> Editar</button>
        <button className="btn btn-perigo-suave" disabled={!ed} onClick={onArquivar}><Archive size={15} /> Arquivar</button>
      </>}
    >
      <Secao titulo="Regra">
        <Campos itens={[
          ["Tipo", TIPO_CAMPAINHA[c.tipo] || c.tipo],
          ["Padrão", <code key="p">{c.padrao}</code>],
          ["Caixa", c.caixa],
          ["Prioridade", <PilulaStatus key="pr" mapa={PRIORIDADE_MAP} valor={c.prioridade} pequena />],
          ["Lead", c.dominio_lead],
          ["Expira", c.expira_em && fmtData(c.expira_em)],
          ["Criada", fmtData(c.criada_em)],
          c.arquivada_em && ["Arquivada", `${fmtData(c.arquivada_em)} por ${c.arquivada_por || "—"}`],
        ]} />
        {c.instrucao && <div className="texto-longo">{c.instrucao}</div>}
      </Secao>
      <Secao titulo={`Disparos (${c.disparos ?? disparos.length})`}>
        <ErroBox erro={erro} />
        {!dados && carregando && <Carregando />}
        {dados && !disparos.length && <div className="muted">Ainda não tocou.</div>}
        <ul className="lista-simples">
          {disparos.map((d) => (
            <li key={d.id || d.message_id}>
              <div className="lista-simples-topo"><b>{d.assunto || "(sem assunto)"}</b><span className="muted" title={fmtData(d.recebido_em)}>{tempoRelativo(d.recebido_em)}</span></div>
              <div className="muted pequeno">De {d.de}</div>
              {d.trecho && <div className="trecho">{d.trecho}</div>}
            </li>
          ))}
        </ul>
      </Secao>
    </Gaveta>
  );
}

export default function Campainhas() {
  const { operadorFiltro, busca, podeEditar } = useApp();
  const [executar] = useAcao();
  const [abertoId, setAbertoId] = useState(null);
  const [form, setForm] = useState(null); // {inicial}
  const [arquivar, setArquivar] = useState(null);
  const { dados, erro, carregando, recarregar } = useDados(() => api.campainhas({ operador: operadorFiltro }), [operadorFiltro]);
  const todas = lista(dados, "campainhas").filter((c) => contem(`${c.nome} ${c.padrao} ${c.dominio_lead || ""} ${c.instrucao || ""}`, busca));
  const grupos = [
    { chave: "ativas", titulo: "Ativas", cor: "#00a35c", itens: todas.filter((c) => c.ativa && !c.arquivada_em), aberto: true },
    { chave: "inativas", titulo: "Inativas", cor: "#797e87", itens: todas.filter((c) => !c.ativa && !c.arquivada_em), aberto: true },
    { chave: "arquivadas", titulo: "Arquivadas", cor: "#4b4f56", itens: todas.filter((c) => c.arquivada_em), aberto: false },
  ];
  const aberta = abertoId && todas.find((c) => c.id === abertoId);
  const alternar = (c) => (ativa) => executar(() => api.editarCampainha(c.id, { ativa }), ativa ? "Campainha ativada" : "Campainha desativada");

  return (
    <div className="view">
      <div className="view-cab">
        <div>
          <h1>Campainhas</h1>
          <p className="muted">E-mails que, ao chegar, viram tarefa (e relato) na hora. Bot e operador podem criar.</p>
        </div>
        <div className="barra-ferramentas">
          <button className="btn btn-primario" onClick={() => setForm({ inicial: null })}><Plus size={16} /> Nova campainha</button>
        </div>
      </div>
      <ErroBox erro={erro} onTentar={recarregar} />
      {!dados && carregando && <Carregando />}
      {dados && !todas.length && <Vazio>Nenhuma campainha.</Vazio>}
      {grupos.filter((g) => g.itens.length).map((g) => (
        <Grupo key={g.chave} titulo={g.titulo} cor={g.cor} contagem={g.itens.length} abertoInicial={g.aberto}>
          <Tabela larguras={[null, 180, 150, 105, 120, 95, 90, 75, 105]}>
              <thead>
                <tr>
                  <th className="col-titulo">Nome</th>
                  <th>Vigia</th>
                  <th>Lead</th>
                  <th>Operador</th>
                  <th>Criada por</th>
                  <th className="col-status">Prioridade</th>
                  <th>Disparos</th>
                  <th>Expira</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {g.itens.map((c) => {
                  const ed = podeEditar(c.operador) && !c.arquivada_em;
                  return (
                    <tr key={c.id} className="linha-clicavel" onClick={() => setAbertoId(c.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setAbertoId(c.id)}>
                      <td className="col-titulo"><span className="titulo-celula">{c.nome}</span></td>
                      <td><span className="muted pequeno">{TIPO_CAMPAINHA[c.tipo] || c.tipo}:</span> <code>{c.padrao}</code></td>
                      <td>{c.dominio_lead || <span className="muted">—</span>}</td>
                      <td><Avatar email={c.operador} comNome /></td>
                      <td><SeloAutor autor={c.criada_por} /></td>
                      <td className="celula-status"><PilulaStatus mapa={PRIORIDADE_MAP} valor={c.prioridade} cheia /></td>
                      <td>{c.disparos ?? 0}{c.ultimo_disparo_em && <span className="muted pequeno"> · {tempoRelativo(c.ultimo_disparo_em)}</span>}</td>
                      <td>{c.expira_em ? <span title={fmtData(c.expira_em)}>{tempoRelativo(c.expira_em)}</span> : <span className="muted">—</span>}</td>
                      <td>
                        {!c.arquivada_em && (
                          <span className="botoes-linha" onClick={(e) => e.stopPropagation()}>
                            <Interruptor ligado={c.ativa} onChange={alternar(c)} disabled={!ed} />
                            <button className="btn-icone" disabled={!ed} onClick={() => setForm({ inicial: c })} title="Editar"><Pencil size={15} /></button>
                            <button className="btn-icone" disabled={!ed} onClick={() => setArquivar(c)} title="Arquivar"><Archive size={15} /></button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Tabela>
        </Grupo>
      ))}

      {aberta && !form && (
        <CampainhaDetalhe c={aberta} onFechar={() => setAbertoId(null)} onEditar={() => setForm({ inicial: aberta })}
          onArquivar={() => setArquivar(aberta)} onAlternar={alternar(aberta)} />
      )}
      {form && <FormCampainha inicial={form.inicial} onFechar={() => setForm(null)} />}
      {arquivar && (
        <ConfirmarComTexto
          titulo="Arquivar campainha"
          texto={`"${arquivar.nome}" deixa de tocar e vai para Arquivadas. O histórico de disparos é mantido.`}
          botao="Arquivar"
          perigo
          onFechar={() => setArquivar(null)}
          onConfirmar={async () => { await executar(() => api.arquivarCampainha(arquivar.id), "Campainha arquivada"); setArquivar(null); }}
        />
      )}
    </div>
  );
}
