// Gaveta de detalhe da tarefa: dados, decisão do bot, payload/resposta legíveis,
// envios gerados, linha do tempo e ações (cancelar, reenviar).
import { useState } from "react";
import { AlertTriangle, Ban, RotateCcw } from "lucide-react";
import { api } from "../api.js";
import { useAcao, useApp, useDados } from "../contexto.jsx";
import {
  MOTIVO_BLOQUEIO, MOTIVO_DECISAO, PRIORIDADE_MAP, STATUS_ENVIO_MAP, STATUS_TAREFA_MAP, TIPO_ENVIO, TIPO_TAREFA_MAP,
} from "../constants.js";
import { fmtData, tempoRelativo } from "../util.js";
import Gaveta, { Campos, Secao } from "../components/Gaveta.jsx";
import { PilulaStatus } from "../components/Pilula.jsx";
import { Avatar, SeloAutor } from "../components/Operador.jsx";
import { BlocoDados, PreviaEmail } from "../components/Dados.jsx";
import LinhaDoTempo from "../components/LinhaDoTempo.jsx";
import { Carregando, ErroBox } from "../components/Estados.jsx";
import { ConfirmarComTexto } from "../components/Modal.jsx";
import Icone from "../components/Icone.jsx";

// Decisões de UI (o contrato não restringe): cancelar só o que ainda está aberto;
// reenviar o que não está em execução nem concluído com sucesso.
export const PODE_CANCELAR = ["pendente", "entregue", "em_andamento", "adiou", "bloqueado_humano"];
export const PODE_REENVIAR = ["pendente", "entregue", "falhou", "bloqueado_humano", "recusou", "adiou", "cancelada"];

function EnvioGerado({ e }) {
  const [aberto, setAberto] = useState(false);
  return (
    <li className="envio-gerado">
      <div className="envio-gerado-topo">
        <PilulaStatus mapa={STATUS_ENVIO_MAP} valor={e.status} pequena />
        <b>{e.dominio}</b>
        <span className="muted">{TIPO_ENVIO[e.tipo_envio] || e.tipo_envio}</span>
        <button className="btn btn-pequeno" onClick={() => setAberto((v) => !v)}>{aberto ? "Esconder" : "Prévia"}</button>
      </div>
      <div className="muted">Para {e.para} · {e.assunto}</div>
      {e.motivo_bloqueio && <div className="nota-alerta">Bloqueado: {MOTIVO_BLOQUEIO[e.motivo_bloqueio] || e.motivo_bloqueio}</div>}
      {e.erro && <div className="nota-erro">Erro: {e.erro}</div>}
      {aberto && <PreviaEmail html={e.corpo_html} altura={260} />}
    </li>
  );
}

export default function TarefaDetalhe({ id, onFechar }) {
  const { podeEditar } = useApp();
  const { dados, erro, carregando, recarregar } = useDados(() => api.tarefa(id), [id]);
  const [executar] = useAcao();
  const [confirmar, setConfirmar] = useState(null); // "cancelar" | "reenviar"

  const t = dados ? (dados.tarefa || dados) : null;
  const eventos = dados?.eventos || [];
  const envios = dados?.envios || [];
  const editavel = t && podeEditar(t.operador);

  const acoes = t && (
    <>
      <button className="btn" disabled={!editavel || !PODE_REENVIAR.includes(t.status)} onClick={() => setConfirmar("reenviar")}
        title={!editavel ? "Só o dono da tarefa ou o admin" : "Volta para pendente e tenta o webhook de novo"}>
        <RotateCcw size={15} /> Reenviar
      </button>
      <button className="btn btn-perigo-suave" disabled={!editavel || !PODE_CANCELAR.includes(t.status)} onClick={() => setConfirmar("cancelar")}
        title={!editavel ? "Só o dono da tarefa ou o admin" : "Cancelar a tarefa"}>
        <Ban size={15} /> Cancelar
      </button>
    </>
  );

  return (
    <Gaveta
      onFechar={onFechar}
      titulo={t ? t.titulo || "(sem título)" : "Tarefa"}
      subtitulo={t && (
        <>
          <PilulaStatus mapa={STATUS_TAREFA_MAP} valor={t.status} />
          <span className="tipo-tarefa"><Icone nome={TIPO_TAREFA_MAP[t.tipo]?.icone} size={14} /> {TIPO_TAREFA_MAP[t.tipo]?.label || t.tipo}</span>
          {t.prioridade === "urgente" && <PilulaStatus mapa={PRIORIDADE_MAP} valor="urgente" pequena />}
          <Avatar email={t.operador} comNome />
        </>
      )}
      acoes={acoes}
    >
      {!dados && carregando && <Carregando />}
      <ErroBox erro={erro} onTentar={recarregar} />
      {t && (
        <>
          {(t.motivo || t.detalhe || t.reagendar_em) && (
            <div className={`decisao-box decisao-${t.status}`}>
              <div className="decisao-titulo">Decisão do bot</div>
              {t.motivo && <div><b>Motivo:</b> {MOTIVO_DECISAO[t.motivo] || t.motivo}</div>}
              {t.detalhe && <div>{t.detalhe}</div>}
              {t.reagendar_em && <div><b>Reagendada para:</b> {fmtData(t.reagendar_em)} ({tempoRelativo(t.reagendar_em)})</div>}
            </div>
          )}
          {t.ultimo_erro_entrega && (
            <div className="nota-erro">
              <AlertTriangle size={14} /> Entrega ao bot: {t.ultimo_erro_entrega} ({t.tentativas_entrega} tentativa{t.tentativas_entrega === 1 ? "" : "s"})
            </div>
          )}

          <Secao titulo="Dados">
            <Campos itens={[
              ["Lead", t.dominio],
              ["Origem", <SeloAutor key="o" autor={t.criada_por} autorTipo={t.origem === "operador" ? "operador" : t.origem === "bot" ? "bot" : t.origem ? "sistema" : undefined} />],
              ["Criada", fmtData(t.criada_em)],
              ["Entregue ao bot", fmtData(t.entregue_em)],
              ["Iniciada", fmtData(t.iniciada_em)],
              ["Concluída", fmtData(t.concluida_em)],
              ["Prazo", t.prazo && fmtData(t.prazo)],
              ["Tentativas de entrega", String(t.tentativas_entrega ?? 0)],
              t.origem_ref?.campainha_id && ["Campainha", t.origem_ref.campainha_id],
              t.origem_ref?.acompanhamento_id && ["Acompanhamento", t.origem_ref.acompanhamento_id],
              t.origem_ref?.relato_id && ["Relato", t.origem_ref.relato_id],
              ["ID", <code key="id">{t.id}</code>],
            ]} />
          </Secao>

          <BlocoDados titulo="O que foi pedido (payload)" valor={t.payload} vazio="Sem payload." />
          <BlocoDados titulo="Resposta do bot" valor={t.resposta} vazio="O bot ainda não respondeu." />

          <Secao titulo={`Envios gerados (${envios.length})`}>
            {envios.length ? <ul className="lista-envios">{envios.map((e) => <EnvioGerado key={e.id} e={e} />)}</ul> : <div className="muted">Nenhum envio gerado por esta tarefa.</div>}
          </Secao>

          <Secao titulo="Linha do tempo">
            <LinhaDoTempo eventos={eventos} />
          </Secao>
        </>
      )}

      {confirmar === "cancelar" && (
        <ConfirmarComTexto
          titulo="Cancelar tarefa"
          texto="A tarefa sai da fila do bot. O motivo fica registrado na linha do tempo."
          rotulo="Motivo"
          obrigatorio
          perigo
          botao="Cancelar tarefa"
          onFechar={() => setConfirmar(null)}
          onConfirmar={async (motivo) => { await executar(() => api.cancelarTarefa(t.id, motivo), "Tarefa cancelada"); setConfirmar(null); recarregar(); }}
        />
      )}
      {confirmar === "reenviar" && (
        <ConfirmarComTexto
          titulo="Reenviar tarefa"
          texto="A tarefa volta para pendente e a API tenta o webhook do bot de novo."
          botao="Reenviar"
          onFechar={() => setConfirmar(null)}
          onConfirmar={async () => { await executar(() => api.reenviarTarefa(t.id), "Tarefa reenviada"); setConfirmar(null); recarregar(); }}
        />
      )}
    </Gaveta>
  );
}
