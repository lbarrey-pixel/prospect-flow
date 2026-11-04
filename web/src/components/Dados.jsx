// Exibição legível de payload/resposta (com alternância para o JSON cru) e prévia de e-mail.
import { Fragment, useState } from "react";
import { Code, Copy, Eye, Mail } from "lucide-react";
import { fmtData, humanizar, jsonBonito, pareceData } from "../util.js";
import {
  ESTAGIO_MAP, MOTIVO_DECISAO, PRIORIDADE_MAP, STATUS_ENVIO_MAP, STATUS_TAREFA_MAP, TIPO_ENVIO,
} from "../constants.js";
import { PilulaStatus } from "./Pilula.jsx";

// Prévia de e-mail isolada: sandbox vazio = sem script, sem formulário, sem navegação.
export function PreviaEmail({ html, altura = 320 }) {
  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{margin:12px;background:#fff;color:#222;font-family:Arial,sans-serif}</style></head><body>${html || ""}</body></html>`;
  return <iframe className="previa-email" title="Prévia do e-mail" sandbox="" srcDoc={doc} style={{ height: altura }} />;
}

function PreviaRecolhida({ html }) {
  const [aberta, setAberta] = useState(false);
  return (
    <div>
      <button type="button" className="btn btn-pequeno" onClick={() => setAberta((v) => !v)}>
        <Mail size={14} /> {aberta ? "Esconder e-mail" : "Ver e-mail"}
      </button>
      {aberta && <PreviaEmail html={html} altura={260} />}
    </div>
  );
}

const ePrimitivo = (v) => v === null || ["string", "number", "boolean"].includes(typeof v);

// Valores com vocabulário conhecido viram pílula ou rótulo.
function valorEspecial(chave, v) {
  if (typeof v !== "string") return null;
  if ((chave === "status" || chave === "decisao") && STATUS_TAREFA_MAP[v]) return <PilulaStatus mapa={STATUS_TAREFA_MAP} valor={v} pequena />;
  if (chave === "status" && STATUS_ENVIO_MAP[v]) return <PilulaStatus mapa={STATUS_ENVIO_MAP} valor={v} pequena />;
  if ((chave === "estagio" || chave === "estagio_sugerido" || chave === "estagio_funil") && ESTAGIO_MAP[v]) return <PilulaStatus mapa={ESTAGIO_MAP} valor={v} pequena />;
  if (chave === "prioridade" && PRIORIDADE_MAP[v]) return <PilulaStatus mapa={PRIORIDADE_MAP} valor={v} pequena />;
  if (chave === "motivo" && MOTIVO_DECISAO[v]) return MOTIVO_DECISAO[v];
  if ((chave === "tipo_envio" || chave === "proxima_rodada") && TIPO_ENVIO[v]) return TIPO_ENVIO[v];
  if (chave === "corpo_html") return <PreviaRecolhida html={v} />;
  return null;
}

export function ValorLegivel({ valor, chave = "", nivel = 0 }) {
  const esp = valorEspecial(chave, valor);
  if (esp) return esp;
  if (valor === null || valor === undefined || valor === "") return <span className="muted">—</span>;
  if (typeof valor === "boolean") return valor ? "Sim" : "Não";
  if (typeof valor === "number") return valor.toLocaleString("pt-BR");
  if (typeof valor === "string") {
    if (pareceData(valor)) return <span title={valor}>{fmtData(valor)}</span>;
    if (valor.length > 120 || valor.includes("\n")) return <div className="texto-longo">{valor}</div>;
    return valor;
  }
  if (Array.isArray(valor)) {
    if (!valor.length) return <span className="muted">(nenhum)</span>;
    if (valor.every(ePrimitivo)) {
      return <span className="chips">{valor.map((v, i) => <span key={i} className="chip">{String(v)}</span>)}</span>;
    }
    return (
      <div className="lista-objs">
        {valor.map((v, i) => (
          <div className="obj-card" key={i}>
            <div className="obj-card-num">{i + 1}</div>
            <ValorLegivel valor={v} nivel={nivel + 1} />
          </div>
        ))}
      </div>
    );
  }
  const entradas = Object.entries(valor);
  if (!entradas.length) return <span className="muted">(vazio)</span>;
  return (
    <dl className={nivel === 0 ? "kv" : "kv kv-interno"}>
      {entradas.map(([k, v]) => (
        <Fragment key={k}>
          <dt>{humanizar(k)}</dt>
          <dd><ValorLegivel valor={v} chave={k} nivel={nivel + 1} /></dd>
        </Fragment>
      ))}
    </dl>
  );
}

// Bloco com título, versão formatada (padrão) e botão "ver JSON".
export function BlocoDados({ titulo, valor, vazio = "Sem dados." }) {
  const [json, setJson] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const temValor = valor !== null && valor !== undefined && !(typeof valor === "object" && !Array.isArray(valor) && !Object.keys(valor).length);
  async function copiar() {
    try { await navigator.clipboard.writeText(jsonBonito(valor)); setCopiado(true); setTimeout(() => setCopiado(false), 1500); } catch { /* sem permissão */ }
  }
  return (
    <section className="secao">
      <div className="secao-cab">
        <h3>{titulo}</h3>
        {temValor && (
          <div className="secao-botoes">
            {json && <button className="btn btn-pequeno" onClick={copiar}><Copy size={14} /> {copiado ? "Copiado" : "Copiar"}</button>}
            <button className="btn btn-pequeno" onClick={() => setJson((v) => !v)}>
              {json ? <><Eye size={14} /> Ver formatado</> : <><Code size={14} /> Ver JSON</>}
            </button>
          </div>
        )}
      </div>
      {!temValor ? <div className="muted">{vazio}</div> : json ? <pre className="json">{jsonBonito(valor)}</pre> : <ValorLegivel valor={valor} />}
    </section>
  );
}
