// Acompanhamentos: lembretes agendados (com ou sem lead) que viram tarefa na data.
import { useState } from "react";
import { Archive, Pencil, Plus } from "lucide-react";
import { api } from "../api.js";
import { useAcao, useApp, useDados } from "../contexto.jsx";
import { STATUS_ACOMPANHAMENTO, STATUS_ACOMPANHAMENTO_MAP } from "../constants.js";
import { contem, cx, deInputLocal, fmtData, lista, paraInputLocal, tempoRelativo } from "../util.js";
import Grupo from "../components/Grupo.jsx";
import { PilulaStatus } from "../components/Pilula.jsx";
import { Avatar, SeloAutor } from "../components/Operador.jsx";
import Tabela from "../components/Tabela.jsx";
import { Carregando, ErroBox, Vazio } from "../components/Estados.jsx";
import Gaveta, { Campos, Secao } from "../components/Gaveta.jsx";
import Modal, { ConfirmarComTexto } from "../components/Modal.jsx";
import { Campo, Interruptor, SelectOperador } from "../components/Form.jsx";

// O contrato não tem "ativo" em acompanhamentos. Decisão: desativar = PATCH status "cancelado";
// reativar = PATCH status "agendado"; arquivar = DELETE (o mock grava `arquivado_em`).
const ativo = (a) => a.status === "agendado" || a.status === "disparado";
const arquivado = (a) => !!a.arquivado_em;

function FormAcompanhamento({ inicial, onFechar }) {
  const { eu, operadorFiltro } = useApp();
  const [executar, ocupado] = useAcao();
  const novo = !inicial;
  const [f, setF] = useState(() => ({
    operador: inicial?.operador || (eu.admin && operadorFiltro) || eu.email,
    titulo: inicial?.titulo || "",
    dominio: inicial?.dominio || "",
    instrucao: inicial?.instrucao || "",
    agendado_para: paraInputLocal(inicial?.agendado_para || new Date(Date.now() + 864e5).toISOString()),
    repetir_dias: inicial?.repetir_dias ?? "",
  }));
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  async function salvar(e) {
    e.preventDefault();
    const corpo = {
      ...f,
      dominio: f.dominio.trim() || null,
      agendado_para: deInputLocal(f.agendado_para),
      repetir_dias: f.repetir_dias === "" ? null : Number(f.repetir_dias),
    };
    const r = novo
      ? await executar(() => api.criarAcompanhamento(corpo), "Acompanhamento criado")
      : await executar(() => { const { operador: _op, ...resto } = corpo; return api.editarAcompanhamento(inicial.id, resto); }, "Acompanhamento salvo");
    if (r) onFechar();
  }
  return (
    <Modal titulo={novo ? "Novo acompanhamento" : `Editar: ${inicial.titulo}`} onFechar={onFechar}>
      <form className="form" onSubmit={salvar}>
        <div className="form-grade">
          <Campo rotulo="Título" largo><input required value={f.titulo} onChange={set("titulo")} placeholder="Ex.: Retomar acme.example depois da feira" /></Campo>
          <Campo rotulo="Operador"><SelectOperador value={f.operador} onChange={set("operador")} disabled={!novo} /></Campo>
          <Campo rotulo="Lead (domínio, opcional)"><input value={f.dominio} onChange={set("dominio")} placeholder="exemplo.example" /></Campo>
          <Campo rotulo="Quando"><input type="datetime-local" required value={f.agendado_para} onChange={set("agendado_para")} /></Campo>
          <Campo rotulo="Repetir a cada (dias)" dica="Vazio = uma vez só"><input type="number" min="1" value={f.repetir_dias} onChange={set("repetir_dias")} /></Campo>
          <Campo rotulo="Instrução para o bot" largo><textarea rows={3} value={f.instrucao} onChange={set("instrucao")} /></Campo>
        </div>
        <div className="form-botoes">
          <button type="button" className="btn" onClick={onFechar}>Cancelar</button>
          <button type="submit" className="btn btn-primario" disabled={ocupado}>{novo ? "Criar" : "Salvar"}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Acompanhamentos() {
  const { operadorFiltro, busca, podeEditar } = useApp();
  const [executar] = useAcao();
  const [abertoId, setAbertoId] = useState(null);
  const [form, setForm] = useState(null);
  const [arquivar, setArquivar] = useState(null);
  const { dados, erro, carregando, recarregar } = useDados(() => api.acompanhamentos({ operador: operadorFiltro }), [operadorFiltro]);
  const todos = lista(dados, "acompanhamentos").filter((a) => contem(`${a.titulo} ${a.dominio || ""} ${a.instrucao || ""}`, busca));
  const grupos = [
    ...STATUS_ACOMPANHAMENTO.map((s) => ({ ...s, itens: todos.filter((a) => !arquivado(a) && a.status === s.chave), aberto: s.chave !== "concluido" })),
    { chave: "arquivados", label: "Arquivados", cor: "#4b4f56", itens: todos.filter(arquivado), aberto: false },
  ];
  const aberto = abertoId && todos.find((a) => a.id === abertoId);
  const alternar = (a) => (ligar) => executar(
    () => api.editarAcompanhamento(a.id, { status: ligar ? "agendado" : "cancelado" }),
    ligar ? "Acompanhamento reativado" : "Acompanhamento desativado",
  );

  return (
    <div className="view">
      <div className="view-cab">
        <div>
          <h1>Acompanhamentos</h1>
          <p className="muted">Lembretes com data. Na hora marcada, o tick do n8n transforma em tarefa para o bot.</p>
        </div>
        <div className="barra-ferramentas">
          <button className="btn btn-primario" onClick={() => setForm({ inicial: null })}><Plus size={16} /> Novo acompanhamento</button>
        </div>
      </div>
      <ErroBox erro={erro} onTentar={recarregar} />
      {!dados && carregando && <Carregando />}
      {dados && !todos.length && <Vazio>Nenhum acompanhamento.</Vazio>}
      {grupos.filter((g) => g.itens.length).map((g) => (
        <Grupo key={g.chave} titulo={g.label} cor={g.cor} contagem={g.itens.length} abertoInicial={g.aberto}>
          <Tabela larguras={[null, 160, 200, 90, 110, 130, 120, 110]}>
              <thead>
                <tr>
                  <th className="col-titulo">Título</th>
                  <th>Lead</th>
                  <th>Quando</th>
                  <th>Repete</th>
                  <th>Operador</th>
                  <th>Criado por</th>
                  <th className="col-status">Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {g.itens.map((a) => {
                  const ed = podeEditar(a.operador) && !arquivado(a);
                  const vencido = a.status === "agendado" && new Date(a.agendado_para) < new Date();
                  return (
                    <tr key={a.id} className="linha-clicavel" onClick={() => setAbertoId(a.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setAbertoId(a.id)}>
                      <td className="col-titulo"><span className="titulo-celula">{a.titulo}</span></td>
                      <td>{a.dominio || <span className="muted">—</span>}</td>
                      <td className={cx(vencido && "texto-erro")} title={fmtData(a.agendado_para)}>{fmtData(a.agendado_para)} <span className="muted pequeno">({tempoRelativo(a.agendado_para)})</span></td>
                      <td>{a.repetir_dias ? `a cada ${a.repetir_dias} d` : <span className="muted">não</span>}</td>
                      <td><Avatar email={a.operador} comNome /></td>
                      <td><SeloAutor autor={a.criado_por} /></td>
                      <td className="celula-status"><PilulaStatus mapa={STATUS_ACOMPANHAMENTO_MAP} valor={a.status} cheia /></td>
                      <td>
                        {!arquivado(a) && (
                          <span className="botoes-linha" onClick={(e) => e.stopPropagation()}>
                            <Interruptor ligado={ativo(a)} onChange={alternar(a)} disabled={!ed || a.status === "concluido"} />
                            <button className="btn-icone" disabled={!ed} onClick={() => setForm({ inicial: a })} title="Editar"><Pencil size={15} /></button>
                            <button className="btn-icone" disabled={!ed} onClick={() => setArquivar(a)} title="Arquivar"><Archive size={15} /></button>
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

      {aberto && !form && (
        <Gaveta
          onFechar={() => setAbertoId(null)}
          titulo={aberto.titulo}
          subtitulo={<><PilulaStatus mapa={STATUS_ACOMPANHAMENTO_MAP} valor={aberto.status} /><SeloAutor autor={aberto.criado_por} /><Avatar email={aberto.operador} comNome /></>}
          acoes={!arquivado(aberto) && <>
            <span className="rotulo-interruptor">
              <Interruptor ligado={ativo(aberto)} onChange={alternar(aberto)} disabled={!podeEditar(aberto.operador) || aberto.status === "concluido"} />
              {ativo(aberto) ? "Ativo" : "Desativado"}
            </span>
            <button className="btn" disabled={!podeEditar(aberto.operador)} onClick={() => setForm({ inicial: aberto })}><Pencil size={15} /> Editar</button>
            <button className="btn btn-perigo-suave" disabled={!podeEditar(aberto.operador)} onClick={() => setArquivar(aberto)}><Archive size={15} /> Arquivar</button>
          </>}
        >
          <Secao titulo="Dados">
            <Campos itens={[
              ["Lead", aberto.dominio],
              ["Quando", `${fmtData(aberto.agendado_para)} (${tempoRelativo(aberto.agendado_para)})`],
              ["Repete", aberto.repetir_dias ? `a cada ${aberto.repetir_dias} dias` : "não"],
              ["Último disparo", aberto.ultimo_disparo_em && fmtData(aberto.ultimo_disparo_em)],
              ["Tarefa gerada", aberto.tarefa_id && <code key="t">{aberto.tarefa_id}</code>],
              ["Criado", fmtData(aberto.criado_em)],
              aberto.arquivado_em && ["Arquivado", fmtData(aberto.arquivado_em)],
            ]} />
          </Secao>
          <Secao titulo="Instrução">
            {aberto.instrucao ? <div className="texto-longo">{aberto.instrucao}</div> : <div className="muted">Sem instrução.</div>}
          </Secao>
        </Gaveta>
      )}
      {form && <FormAcompanhamento inicial={form.inicial} onFechar={() => setForm(null)} />}
      {arquivar && (
        <ConfirmarComTexto
          titulo="Arquivar acompanhamento"
          texto={`"${arquivar.titulo}" sai da agenda e vai para Arquivados.`}
          botao="Arquivar"
          perigo
          onFechar={() => setArquivar(null)}
          onConfirmar={async () => { await executar(() => api.arquivarAcompanhamento(arquivar.id), "Acompanhamento arquivado"); setArquivar(null); }}
        />
      )}
    </div>
  );
}
