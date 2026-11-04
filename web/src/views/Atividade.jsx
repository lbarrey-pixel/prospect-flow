// Atividade: feed cronológico de GET /eventos (toda escrita gera um evento).
import { useState } from "react";
import { api } from "../api.js";
import { useApp, useDados } from "../contexto.jsx";
import { contem, fmtDia, lista } from "../util.js";
import { Carregando, ErroBox, Vazio } from "../components/Estados.jsx";
import LinhaDoTempo from "../components/LinhaDoTempo.jsx";
import TarefaDetalhe from "./TarefaDetalhe.jsx";

const ENTIDADES = [
  ["", "Tudo"],
  ["tarefa", "Tarefas"],
  ["envio", "Envios"],
  ["campainha", "Campainhas"],
  ["acompanhamento", "Acompanhamentos"],
  ["relato", "Relatos"],
  ["diretriz", "Diretrizes"],
  ["lead", "Leads"],
  ["operador", "Operadores"],
];

export default function Atividade() {
  const { operadorFiltro, busca } = useApp();
  const [entidade, setEntidade] = useState("");
  const [tarefaAberta, setTarefaAberta] = useState(null);
  const { dados, erro, carregando, recarregar } = useDados(() => api.eventos({ operador: operadorFiltro, entidade, limite: 200 }), [operadorFiltro, entidade]);
  const eventos = lista(dados, "eventos")
    .filter((e) => contem(`${e.resumo || ""} ${e.acao || ""} ${e.dominio || ""} ${e.ator || ""}`, busca))
    .sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)));

  const dias = [];
  for (const e of eventos) {
    const d = fmtDia(e.criado_em);
    if (!dias.length || dias[dias.length - 1].dia !== d) dias.push({ dia: d, itens: [] });
    dias[dias.length - 1].itens.push(e);
  }

  return (
    <div className="view">
      <div className="view-cab">
        <div>
          <h1>Atividade</h1>
          <p className="muted">Tudo o que foi escrito no CRM, por quem e quando (bot, operador ou sistema).</p>
        </div>
        <div className="barra-ferramentas">
          <select value={entidade} onChange={(e) => setEntidade(e.target.value)} aria-label="Filtrar por entidade">
            {ENTIDADES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>
      <ErroBox erro={erro} onTentar={recarregar} />
      {!dados && carregando && <Carregando />}
      {dados && !eventos.length && <Vazio>Nenhum evento.</Vazio>}
      {dias.map((d) => (
        <section key={d.dia} className="feed-dia">
          <h2 className="feed-dia-titulo">{d.dia}</h2>
          <div className="feed-caixa">
            <LinhaDoTempo
              eventos={d.itens}
              mostrarEntidade
              podeAbrir={(ev) => ev.entidade === "tarefa"}
              onAbrir={(ev) => { if (ev.entidade === "tarefa") setTarefaAberta(ev.entidade_id); }}
            />
          </div>
        </section>
      ))}
      {tarefaAberta && <TarefaDetalhe id={tarefaAberta} onFechar={() => setTarefaAberta(null)} />}
    </div>
  );
}
