// Envios: o que o bot rascunhou e a API validou (aprovado, agendado, bloqueado…).
import { useState } from "react";
import { Ban, Unlock } from "lucide-react";
import { api } from "../api.js";
import { useAcao, useApp, useDados } from "../contexto.jsx";
import { MOTIVO_BLOQUEIO, STATUS_ENVIO, STATUS_ENVIO_MAP, TIPO_ENVIO } from "../constants.js";
import { contem, fmtData, lista, tempoRelativo } from "../util.js";
import Grupo from "../components/Grupo.jsx";
import { PilulaStatus } from "../components/Pilula.jsx";
import { Avatar } from "../components/Operador.jsx";
import Tabela from "../components/Tabela.jsx";
import { Carregando, ErroBox, Vazio } from "../components/Estados.jsx";
import Gaveta, { Campos, Secao } from "../components/Gaveta.jsx";
import { PreviaEmail } from "../components/Dados.jsx";
import { ConfirmarComTexto } from "../components/Modal.jsx";

const PODE_CANCELAR = ["aprovado", "agendado", "bloqueado"];
const motivoTexto = (m) => (m ? MOTIVO_BLOQUEIO[m] || m : null);

function quando(e) {
  if (e.enviado_em) return { rotulo: "Enviado", iso: e.enviado_em };
  if (e.enviar_apos) return { rotulo: "Sai após", iso: e.enviar_apos };
  return { rotulo: "Criado", iso: e.criado_em };
}

function useAcoesEnvio() {
  const [executar] = useAcao();
  const [confirmar, setConfirmar] = useState(null); // {tipo, envio}
  const modal = confirmar && (confirmar.tipo === "liberar" ? (
    <ConfirmarComTexto
      titulo="Liberar envio bloqueado"
      texto={<>
        <p>Este envio foi barrado pelas regras: <b>{motivoTexto(confirmar.envio.motivo_bloqueio) || "sem motivo informado"}</b>.</p>
        <p>Liberar é uma <b>exceção humana</b>: fica registrada com o seu nome, e o n8n envia na próxima rodada.</p>
      </>}
      rotulo="Nota da exceção"
      placeholder="Ex.: o comprador pediu retorno hoje"
      botao="Liberar envio"
      onFechar={() => setConfirmar(null)}
      onConfirmar={async (nota) => { await executar(() => api.liberarEnvio(confirmar.envio.id, nota || null), "Envio liberado"); setConfirmar(null); }}
    />
  ) : (
    <ConfirmarComTexto
      titulo="Cancelar envio"
      texto={`O e-mail para ${confirmar.envio.para} não será enviado.`}
      perigo
      botao="Cancelar envio"
      onFechar={() => setConfirmar(null)}
      onConfirmar={async () => { await executar(() => api.cancelarEnvio(confirmar.envio.id), "Envio cancelado"); setConfirmar(null); }}
    />
  ));
  return [setConfirmar, modal];
}

function BotoesEnvio({ e, pedir, compacto = false }) {
  const { podeEditar } = useApp();
  const ed = podeEditar(e.operador);
  return (
    <span className="botoes-linha" onClick={(ev) => ev.stopPropagation()}>
      {e.status === "bloqueado" && (
        <button className="btn btn-pequeno btn-primario" disabled={!ed} onClick={() => pedir({ tipo: "liberar", envio: e })} title={ed ? "Liberar (exceção humana)" : "Só o dono ou o admin"}>
          <Unlock size={14} />{!compacto && " Liberar"}
        </button>
      )}
      {PODE_CANCELAR.includes(e.status) && (
        <button className="btn btn-pequeno btn-perigo-suave" disabled={!ed} onClick={() => pedir({ tipo: "cancelar", envio: e })} title={ed ? "Cancelar envio" : "Só o dono ou o admin"}>
          <Ban size={14} />{!compacto && " Cancelar"}
        </button>
      )}
    </span>
  );
}

function EnvioDetalhe({ envio: e, onFechar, pedir }) {
  return (
    <Gaveta
      onFechar={onFechar}
      titulo={e.assunto || "(sem assunto)"}
      subtitulo={<><PilulaStatus mapa={STATUS_ENVIO_MAP} valor={e.status} /><span>{e.dominio}</span><Avatar email={e.operador} comNome /></>}
      acoes={<BotoesEnvio e={e} pedir={pedir} />}
    >
      {e.status === "bloqueado" && <div className="nota-alerta"><b>Bloqueado:</b> {motivoTexto(e.motivo_bloqueio) || "motivo não informado"}</div>}
      {e.erro && <div className="nota-erro"><b>Erro no envio:</b> {e.erro}</div>}
      <Secao titulo="Dados">
        <Campos itens={[
          ["Para", e.para],
          ["Tipo", TIPO_ENVIO[e.tipo_envio] || e.tipo_envio],
          ["Rodada", e.rodada ? `R${e.rodada}` : null],
          ["Anexos", (e.anexos || []).join(", ")],
          ["Em resposta a", e.in_reply_to],
          ["Enviar após", e.enviar_apos && fmtData(e.enviar_apos)],
          ["Enviado em", e.enviado_em && fmtData(e.enviado_em)],
          ["Message-ID", e.message_id && <code key="m">{e.message_id}</code>],
          ["Criado", fmtData(e.criado_em)],
          ["Tarefa", e.tarefa_id && <code key="t">{e.tarefa_id}</code>],
        ]} />
      </Secao>
      <Secao titulo="Prévia do e-mail">
        <div className="email-cab">
          <div><b>Para:</b> {e.para}</div>
          <div><b>Assunto:</b> {e.assunto}</div>
        </div>
        <PreviaEmail html={e.corpo_html} altura={420} />
      </Secao>
    </Gaveta>
  );
}

export default function Envios() {
  const { operadorFiltro, busca } = useApp();
  const [status, setStatus] = useState("");
  const [abertoId, setAbertoId] = useState(null);
  const [pedir, modal] = useAcoesEnvio();
  const { dados, erro, carregando, recarregar } = useDados(() => api.envios({ operador: operadorFiltro, status }), [operadorFiltro, status]);
  const envios = lista(dados, "envios").filter((e) => contem(`${e.dominio} ${e.para} ${e.assunto}`, busca));
  const porStatus = {};
  for (const e of envios) (porStatus[e.status] ||= []).push(e);
  const aberto = abertoId && envios.find((e) => e.id === abertoId);

  return (
    <div className="view">
      <div className="view-cab">
        <div>
          <h1>Envios</h1>
          <p className="muted">Cada rascunho do bot passa pelas regras do operador (teto, intervalo, rodada, janela, estágio) antes de sair pelo n8n.</p>
        </div>
        <div className="barra-ferramentas">
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filtrar por status">
            <option value="">Todos os status</option>
            {STATUS_ENVIO.map((s) => <option key={s.chave} value={s.chave}>{s.label}</option>)}
          </select>
        </div>
      </div>
      <ErroBox erro={erro} onTentar={recarregar} />
      {!dados && carregando && <Carregando />}
      {dados && !envios.length && <Vazio>Nenhum envio.</Vazio>}
      {STATUS_ENVIO.filter((s) => porStatus[s.chave]?.length).map((s) => (
        <Grupo key={s.chave} titulo={s.label} cor={s.cor} contagem={porStatus[s.chave].length} abertoInicial={!["cancelado"].includes(s.chave)}>
          <Tabela larguras={[null, 190, 70, 110, 110, 170, 120, 90]}>
              <thead>
                <tr>
                  <th className="col-titulo">Assunto</th>
                  <th>Lead / para</th>
                  <th>Tipo</th>
                  <th>Operador</th>
                  <th className="col-status">Status</th>
                  <th>Motivo do bloqueio</th>
                  <th>Quando</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {porStatus[s.chave].map((e) => {
                  const q = quando(e);
                  return (
                    <tr key={e.id} className="linha-clicavel" onClick={() => setAbertoId(e.id)} tabIndex={0} onKeyDown={(ev) => ev.key === "Enter" && setAbertoId(e.id)}>
                      <td className="col-titulo"><span className="titulo-celula">{e.assunto || "(sem assunto)"}</span></td>
                      <td><div>{e.dominio}</div><div className="muted pequeno">{e.para}</div></td>
                      <td>{e.tipo_envio}</td>
                      <td><Avatar email={e.operador} comNome /></td>
                      <td className="celula-status"><PilulaStatus mapa={STATUS_ENVIO_MAP} valor={e.status} cheia /></td>
                      <td>{motivoTexto(e.motivo_bloqueio) || (e.erro ? <span className="texto-erro">{e.erro}</span> : <span className="muted">—</span>)}</td>
                      <td title={fmtData(q.iso)}><span className="muted pequeno">{q.rotulo}</span> {tempoRelativo(q.iso)}</td>
                      <td><BotoesEnvio e={e} pedir={pedir} compacto /></td>
                    </tr>
                  );
                })}
              </tbody>
            </Tabela>
        </Grupo>
      ))}
      {aberto && <EnvioDetalhe envio={aberto} onFechar={() => setAbertoId(null)} pedir={pedir} />}
      {modal}
    </div>
  );
}
