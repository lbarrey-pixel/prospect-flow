// Quadro de tarefas: grupos por status (tabela) ou colunas (kanban).
import { useState } from "react";
import { Columns3, Plus, Rows3 } from "lucide-react";
import { api } from "../api.js";
import { useAcao, useApp, useDados } from "../contexto.jsx";
import {
  PRIORIDADE, PRIORIDADE_MAP, STATUS_TAREFA, STATUS_TAREFA_FECHADOS_PADRAO, STATUS_TAREFA_MAP, TIPO_TAREFA, TIPO_TAREFA_MAP,
} from "../constants.js";
import { atualizadaEm, contem, cx, fmtData, lista, tempoRelativo } from "../util.js";
import Grupo from "../components/Grupo.jsx";
import { PilulaStatus } from "../components/Pilula.jsx";
import { Avatar } from "../components/Operador.jsx";
import Tabela from "../components/Tabela.jsx";
import { Carregando, ErroBox, Vazio } from "../components/Estados.jsx";
import Modal from "../components/Modal.jsx";
import { Campo, SelectOperador } from "../components/Form.jsx";
import Icone from "../components/Icone.jsx";
import TarefaDetalhe from "./TarefaDetalhe.jsx";

const lerModo = () => { try { return localStorage.getItem("pf_web_modo_tarefas") || "tabela"; } catch { return "tabela"; } };

function TipoTarefa({ tipo }) {
  const t = TIPO_TAREFA_MAP[tipo];
  return <span className="tipo-tarefa"><Icone nome={t?.icone} size={14} /> {t?.label || tipo}</span>;
}

function TabelaTarefas({ tarefas, onAbrir }) {
  return (
    <Tabela larguras={[null, 150, 170, 120, 110, 130, 90, 90]}>
        <thead>
          <tr>
            <th className="col-titulo">Título</th>
            <th>Tipo</th>
            <th>Lead</th>
            <th>Operador</th>
            <th className="col-status">Prioridade</th>
            <th className="col-status">Status</th>
            <th>Criada</th>
            <th>Atualizada</th>
          </tr>
        </thead>
        <tbody>
          {tarefas.map((t) => (
            <tr key={t.id} onClick={() => onAbrir(t.id)} className="linha-clicavel" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onAbrir(t.id)}>
              <td className="col-titulo">
                <span className="titulo-celula">{t.titulo || "(sem título)"}</span>
                {t.ultimo_erro_entrega && <span className="marca-erro" title={t.ultimo_erro_entrega}>entrega falhando</span>}
              </td>
              <td><TipoTarefa tipo={t.tipo} /></td>
              <td>{t.dominio || <span className="muted">—</span>}</td>
              <td><Avatar email={t.operador} comNome /></td>
              <td className="celula-status"><PilulaStatus mapa={PRIORIDADE_MAP} valor={t.prioridade} cheia /></td>
              <td className="celula-status"><PilulaStatus mapa={STATUS_TAREFA_MAP} valor={t.status} cheia /></td>
              <td title={fmtData(t.criada_em)}>{tempoRelativo(t.criada_em)}</td>
              <td title={fmtData(atualizadaEm(t))}>{tempoRelativo(atualizadaEm(t))}</td>
            </tr>
          ))}
        </tbody>
      </Tabela>
  );
}

function Kanban({ porStatus, onAbrir }) {
  return (
    <div className="kanban">
      {STATUS_TAREFA.map((s) => {
        const itens = porStatus[s.chave] || [];
        return (
          <div className="kanban-coluna" key={s.chave}>
            <div className="kanban-cab" style={{ background: s.cor }}>
              <span>{s.label}</span>
              <span className="kanban-n">{itens.length}</span>
            </div>
            <div className="kanban-corpo">
              {itens.map((t) => (
                <button key={t.id} className={cx("cartao", t.prioridade === "urgente" && "cartao-urgente")} onClick={() => onAbrir(t.id)}>
                  <div className="cartao-titulo">{t.titulo || "(sem título)"}</div>
                  <div className="cartao-meta"><TipoTarefa tipo={t.tipo} /></div>
                  {t.dominio && <div className="cartao-lead">{t.dominio}</div>}
                  <div className="cartao-rodape">
                    <Avatar email={t.operador} tamanho={22} />
                    {t.prioridade === "urgente" && <PilulaStatus mapa={PRIORIDADE_MAP} valor="urgente" pequena />}
                    <span className="muted" title={fmtData(atualizadaEm(t))}>{tempoRelativo(atualizadaEm(t))}</span>
                  </div>
                </button>
              ))}
              {!itens.length && <div className="kanban-vazio">—</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function NovaTarefa({ onFechar, onCriada }) {
  const { eu, operadorFiltro } = useApp();
  const [executar, ocupado] = useAcao();
  const [f, setF] = useState({
    operador: (eu.admin && operadorFiltro) || eu.email,
    tipo: "pergunta", titulo: "", instrucao: "", dominio: "", prioridade: "normal",
  });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  async function salvar(e) {
    e.preventDefault();
    const r = await executar(() => api.criarTarefa({ ...f, dominio: f.dominio.trim() || null }), "Tarefa criada");
    if (r) onCriada(r);
  }
  return (
    <Modal titulo="Nova tarefa para o bot" onFechar={onFechar}>
      <form className="form" onSubmit={salvar}>
        <div className="form-grade">
          <Campo rotulo="Operador (bot de quem)"><SelectOperador value={f.operador} onChange={set("operador")} /></Campo>
          <Campo rotulo="Tipo">
            <select value={f.tipo} onChange={set("tipo")}>
              {TIPO_TAREFA.map((t) => <option key={t.chave} value={t.chave}>{t.label}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Título" largo><input required value={f.titulo} onChange={set("titulo")} placeholder="Ex.: Retomar contato com acme.example" /></Campo>
          <Campo rotulo="Instrução" largo dica="O bot decide texto, timing e ângulo, e pode adiar ou recusar com motivo.">
            <textarea rows={4} value={f.instrucao} onChange={set("instrucao")} />
          </Campo>
          <Campo rotulo="Lead (domínio, opcional)"><input value={f.dominio} onChange={set("dominio")} placeholder="exemplo.example" /></Campo>
          <Campo rotulo="Prioridade">
            <select value={f.prioridade} onChange={set("prioridade")}>
              {PRIORIDADE.map((p) => <option key={p.chave} value={p.chave}>{p.label}</option>)}
            </select>
          </Campo>
        </div>
        <div className="form-botoes">
          <button type="button" className="btn" onClick={onFechar}>Cancelar</button>
          <button type="submit" className="btn btn-primario" disabled={ocupado}>Criar tarefa</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Tarefas() {
  const { operadorFiltro, busca, nomeOp } = useApp();
  const [modo, setModoState] = useState(lerModo);
  const [tipo, setTipo] = useState("");
  const [aberta, setAberta] = useState(null);
  const [criando, setCriando] = useState(false);
  const setModo = (m) => { setModoState(m); try { localStorage.setItem("pf_web_modo_tarefas", m); } catch { /* ok */ } };

  const { dados, erro, carregando, recarregar } = useDados(() => api.tarefas({ operador: operadorFiltro, tipo }), [operadorFiltro, tipo]);
  const tarefas = lista(dados, "tarefas").filter((t) => contem(`${t.titulo} ${t.dominio || ""} ${TIPO_TAREFA_MAP[t.tipo]?.label || t.tipo} ${nomeOp(t.operador)}`, busca));
  const porStatus = {};
  for (const t of tarefas) (porStatus[t.status] ||= []).push(t);
  const total = tarefas.length;

  return (
    <div className="view">
      <div className="view-cab">
        <div>
          <h1>Quadro de tarefas</h1>
          <p className="muted">O n8n entrega as tarefas; o bot decide se executa, adia ou recusa, sempre com motivo.</p>
        </div>
        <div className="barra-ferramentas">
          <div className="alternador" role="group" aria-label="Visualização">
            <button className={cx(modo === "tabela" && "ativo")} onClick={() => setModo("tabela")}><Rows3 size={15} /> Tabela</button>
            <button className={cx(modo === "kanban" && "ativo")} onClick={() => setModo("kanban")}><Columns3 size={15} /> Kanban</button>
          </div>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Filtrar por tipo">
            <option value="">Todos os tipos</option>
            {TIPO_TAREFA.map((t) => <option key={t.chave} value={t.chave}>{t.label}</option>)}
          </select>
          <button className="btn btn-primario" onClick={() => setCriando(true)}><Plus size={16} /> Nova tarefa</button>
        </div>
      </div>

      <ErroBox erro={erro} onTentar={recarregar} />
      {!dados && carregando && <Carregando />}
      {dados && !total && <Vazio>Nenhuma tarefa {busca ? "para essa busca" : "por aqui"}.</Vazio>}

      {dados && total > 0 && modo === "tabela" && STATUS_TAREFA.filter((s) => porStatus[s.chave]?.length).map((s) => (
        <Grupo key={s.chave} titulo={s.label} cor={s.cor} contagem={porStatus[s.chave].length} abertoInicial={!STATUS_TAREFA_FECHADOS_PADRAO.includes(s.chave)}>
          <TabelaTarefas tarefas={porStatus[s.chave]} onAbrir={setAberta} />
        </Grupo>
      ))}
      {dados && total > 0 && modo === "kanban" && <Kanban porStatus={porStatus} onAbrir={setAberta} />}

      {aberta && <TarefaDetalhe id={aberta} onFechar={() => setAberta(null)} />}
      {criando && <NovaTarefa onFechar={() => setCriando(false)} onCriada={(t) => { setCriando(false); if (t?.id) setAberta(t.id); }} />}
    </div>
  );
}
