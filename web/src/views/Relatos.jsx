// Relatos: caixa de entrada do que o bot reporta ao operador.
import { useState } from "react";
import { Check, MailOpen, Reply } from "lucide-react";
import { api } from "../api.js";
import { useAcao, useApp, useDados } from "../contexto.jsx";
import { TIPO_RELATO, TIPO_RELATO_MAP } from "../constants.js";
import { contem, cx, fmtData, lista, tempoRelativo } from "../util.js";
import { Carregando, ErroBox, Vazio } from "../components/Estados.jsx";
import { Avatar } from "../components/Operador.jsx";
import Gaveta, { Campos, Secao } from "../components/Gaveta.jsx";
import Icone from "../components/Icone.jsx";

const FILTROS = [
  { chave: "todos", label: "Todos", f: () => true },
  { chave: "nao_lidos", label: "Não lidos", f: (r) => !r.lido_em },
  { chave: "urgentes", label: "Urgentes", f: (r) => r.urgente },
  { chave: "aguardando", label: "Aguardando resposta", f: (r) => ["pergunta", "pedido_autorizacao"].includes(r.tipo) && !r.resposta },
  { chave: "respondidos", label: "Respondidos", f: (r) => !!r.resposta },
];

function IconeTipo({ tipo }) {
  const t = TIPO_RELATO_MAP[tipo];
  return (
    <span className="relato-icone" style={{ background: t?.cor || "#797e87" }} title={t?.label || tipo}>
      <Icone nome={t?.icone} size={16} color="#fff" />
    </span>
  );
}

function RelatoDetalhe({ r, onFechar }) {
  const { podeEditar, nomeOp } = useApp();
  const [executar, ocupado] = useAcao();
  const [resposta, setResposta] = useState("");
  const ed = podeEditar(r.operador);
  async function responder(e) {
    e.preventDefault();
    if (!resposta.trim()) return;
    const ok = await executar(() => api.responderRelato(r.id, resposta.trim()), "Resposta enviada: o bot recebe como tarefa");
    if (ok) setResposta("");
  }
  return (
    <Gaveta
      onFechar={onFechar}
      titulo={r.titulo}
      subtitulo={<>
        <span className="tipo-tarefa"><IconeTipo tipo={r.tipo} /> {TIPO_RELATO_MAP[r.tipo]?.label || r.tipo}</span>
        {r.urgente && <span className="selo selo-urgente">Urgente</span>}
        <Avatar email={r.operador} comNome />
      </>}
      acoes={!r.lido_em && (
        <button className="btn" disabled={!ed} onClick={() => executar(() => api.marcarRelatoLido(r.id), "Marcado como lido")}>
          <MailOpen size={15} /> Marcar como lido
        </button>
      )}
    >
      <Secao titulo="Mensagem do bot">
        <div className="texto-longo">{r.corpo}</div>
      </Secao>
      <Secao titulo="Dados">
        <Campos itens={[
          ["Lead", r.dominio],
          ["Recebido", fmtData(r.criado_em)],
          ["Lido", r.lido_em ? fmtData(r.lido_em) : "não lido"],
          ["Tarefa", r.tarefa_id && <code key="t">{r.tarefa_id}</code>],
        ]} />
      </Secao>
      <Secao titulo="Resposta do operador">
        {r.resposta ? (
          <div className="resposta-box">
            <div className="texto-longo">{r.resposta}</div>
            <div className="muted pequeno">{nomeOp(r.respondido_por)} · {fmtData(r.respondido_em)}</div>
          </div>
        ) : ed ? (
          <form className="form" onSubmit={responder}>
            <textarea rows={4} value={resposta} onChange={(e) => setResposta(e.target.value)} placeholder="Sua resposta vira uma tarefa 'resposta do operador' para o bot." />
            <div className="form-botoes">
              <button type="submit" className="btn btn-primario" disabled={ocupado || !resposta.trim()}><Reply size={15} /> Responder</button>
            </div>
          </form>
        ) : <div className="muted">Só o dono do relato ou o admin pode responder.</div>}
      </Secao>
    </Gaveta>
  );
}

export default function Relatos() {
  const { operadorFiltro, busca, podeEditar } = useApp();
  const [executar] = useAcao();
  const [filtro, setFiltro] = useState("todos");
  const [abertoId, setAbertoId] = useState(null);
  const { dados, erro, carregando, recarregar } = useDados(() => api.relatos({ operador: operadorFiltro }), [operadorFiltro]);
  const todos = lista(dados, "relatos").filter((r) => contem(`${r.titulo} ${r.corpo} ${r.dominio || ""}`, busca));
  const fn = FILTROS.find((f) => f.chave === filtro).f;
  const visiveis = todos.filter(fn).sort((a, b) => (Number(!!b.urgente && !b.lido_em) - Number(!!a.urgente && !a.lido_em)) || String(b.criado_em).localeCompare(String(a.criado_em)));
  const aberto = abertoId && todos.find((r) => r.id === abertoId);

  return (
    <div className="view">
      <div className="view-cab">
        <div>
          <h1>Relatos</h1>
          <p className="muted">O bot reportando: informações, alertas, perguntas e pedidos de autorização.</p>
        </div>
      </div>
      <div className="chips-filtro" role="tablist">
        {FILTROS.map((f) => {
          const n = todos.filter(f.f).length;
          return (
            <button key={f.chave} role="tab" aria-selected={filtro === f.chave} className={cx("chip-filtro", filtro === f.chave && "ativo")} onClick={() => setFiltro(f.chave)}>
              {f.label} <span className="chip-n">{n}</span>
            </button>
          );
        })}
      </div>
      <div className="legenda">
        {TIPO_RELATO.map((t) => <span key={t.chave} className="legenda-item"><IconeTipo tipo={t.chave} /> {t.label}</span>)}
      </div>
      <ErroBox erro={erro} onTentar={recarregar} />
      {!dados && carregando && <Carregando />}
      {dados && !visiveis.length && <Vazio>Caixa vazia.</Vazio>}
      <ul className="caixa-entrada">
        {visiveis.map((r) => (
          <li key={r.id} className={cx("relato", !r.lido_em && "nao-lido", r.urgente && "urgente")}>
            <button className="relato-botao" onClick={() => setAbertoId(r.id)}>
              <IconeTipo tipo={r.tipo} />
              <div className="relato-texto">
                <div className="relato-topo">
                  {r.urgente && <span className="selo selo-urgente">Urgente</span>}
                  <span className="relato-titulo">{r.titulo}</span>
                </div>
                <div className="relato-trecho">{r.corpo}</div>
                <div className="relato-meta">
                  <Avatar email={r.operador} tamanho={18} comNome />
                  {r.dominio && <span>· {r.dominio}</span>}
                  {r.resposta && <span className="selo selo-ok"><Check size={12} /> respondido</span>}
                </div>
              </div>
              <span className="relato-hora" title={fmtData(r.criado_em)}>{tempoRelativo(r.criado_em)}</span>
            </button>
            {!r.lido_em && (
              <button className="btn-icone relato-lido" title="Marcar como lido" disabled={!podeEditar(r.operador)}
                onClick={() => executar(() => api.marcarRelatoLido(r.id), "Marcado como lido")}>
                <MailOpen size={16} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {aberto && <RelatoDetalhe r={aberto} onFechar={() => setAbertoId(null)} />}
    </div>
  );
}
