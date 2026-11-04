// Diretrizes: versões por operador. Propostas do bot aparecem em destaque, com motivo e diff
// contra a versão base. Proposta só vale depois de aprovada pelo operador.
import { useState } from "react";
import { Check, GitCompare, Plus, ShieldAlert, X } from "lucide-react";
import { api } from "../api.js";
import { useAcao, useApp, useDados } from "../contexto.jsx";
import { STATUS_DIRETRIZ_MAP } from "../constants.js";
import { contem, fmtData, jsonBonito, lista, tempoRelativo } from "../util.js";
import { PilulaStatus } from "../components/Pilula.jsx";
import { SeloAutor } from "../components/Operador.jsx";
import Tabela from "../components/Tabela.jsx";
import { Carregando, ErroBox, Vazio } from "../components/Estados.jsx";
import Grupo from "../components/Grupo.jsx";
import Gaveta, { Campos, Secao } from "../components/Gaveta.jsx";
import Modal from "../components/Modal.jsx";
import Diff from "../components/Diff.jsx";
import { Campo } from "../components/Form.jsx";

// `base_versao` é só um número. Procuramos primeiro a versão do mesmo operador; se não
// houver, a do padrão (operador null), porque o bot sem diretriz própria usa o padrão.
function acharBase(d, todas) {
  if (d.base_versao === null || d.base_versao === undefined) {
    return todas.find((x) => x.operador === d.operador && x.status === "ativa" && x.id !== d.id)
      || todas.find((x) => x.operador === null && x.status === "ativa") || null;
  }
  return todas.find((x) => x.operador === d.operador && x.versao === d.base_versao && x.id !== d.id)
    || todas.find((x) => x.operador === null && x.versao === d.base_versao) || null;
}

const rotuloVersao = (d, nomeOp) => (d ? `v${d.versao} ${d.operador ? `(${nomeOp(d.operador)})` : "(padrão)"}` : "—");

function Comparacao({ d, base }) {
  const { nomeOp } = useApp();
  const regrasMudaram = base && jsonBonito(base.regras) !== jsonBonito(d.regras);
  if (!base) {
    return <div className="muted">Sem versão base para comparar: mostrando o texto completo.<pre className="texto-diretriz">{d.conteudo}</pre></div>;
  }
  return (
    <>
      <h4 className="sub">Texto</h4>
      <Diff antes={base.conteudo} depois={d.conteudo} rotuloAntes={rotuloVersao(base, nomeOp)} rotuloDepois={`v${d.versao}`} />
      <h4 className="sub">Regras (limites)</h4>
      {regrasMudaram || d.regras ? (
        <Diff antes={jsonBonito(base.regras)} depois={jsonBonito(d.regras)} rotuloAntes={rotuloVersao(base, nomeOp)} rotuloDepois={`v${d.versao}`} />
      ) : <div className="muted">Sem mudança nas regras.</div>}
    </>
  );
}

function CartaoProposta({ d, base }) {
  const { podeEditar, nomeOp } = useApp();
  const [executar, ocupado] = useAcao();
  const [nota, setNota] = useState("");
  const ed = podeEditar(d.operador);
  return (
    <article className="proposta">
      <header className="proposta-cab">
        <div className="proposta-aviso">
          <ShieldAlert size={18} />
          <div>
            <b>Proposta aguardando sua decisão. Ainda não vale.</b>
            <div>O bot continua seguindo {base ? rotuloVersao(base, nomeOp) : "a versão ativa"} até você aprovar.</div>
          </div>
        </div>
        <div className="proposta-meta">
          <PilulaStatus mapa={STATUS_DIRETRIZ_MAP} valor="proposta" />
          <span className="proposta-versao">v{d.versao} · {d.operador ? nomeOp(d.operador) : "padrão"}</span>
          <SeloAutor autor={d.autor} autorTipo={d.autor_tipo} />
          <span className="muted" title={fmtData(d.criada_em)}>{tempoRelativo(d.criada_em)}</span>
        </div>
      </header>
      <div className="proposta-motivo">
        <div className="rotulo">Motivo do bot</div>
        <div className="texto-longo">{d.motivo || "(sem motivo informado)"}</div>
      </div>
      <Comparacao d={d} base={base} />
      <div className="proposta-decisao">
        <label className="form-campo">
          <span>Nota para o bot (obrigatória para rejeitar)</span>
          <textarea rows={2} value={nota} onChange={(e) => setNota(e.target.value)} disabled={!ed} placeholder="O bot lê esta nota." />
        </label>
        <div className="form-botoes">
          <button className="btn btn-perigo" disabled={!ed || ocupado || !nota.trim()} onClick={() => executar(() => api.rejeitarDiretriz(d.id, nota.trim()), "Proposta rejeitada")}>
            <X size={15} /> Rejeitar
          </button>
          <button className="btn btn-sucesso" disabled={!ed || ocupado} onClick={() => executar(() => api.aprovarDiretriz(d.id, nota.trim() || null), "Proposta aprovada: agora é a versão ativa")}>
            <Check size={15} /> Aprovar e ativar
          </button>
        </div>
        {!ed && <div className="muted pequeno">Só o dono ({d.operador ? nomeOp(d.operador) : "admin"}) ou o admin decide.</div>}
      </div>
    </article>
  );
}

function NovaVersao({ operador, ativa, onFechar }) {
  const { nomeOp } = useApp();
  const [executar, ocupado] = useAcao();
  const [conteudo, setConteudo] = useState(ativa?.conteudo || "");
  const [regras, setRegras] = useState(jsonBonito(ativa?.regras || {}));
  const [motivo, setMotivo] = useState("");
  const [erroJson, setErroJson] = useState("");
  async function salvar(e) {
    e.preventDefault();
    let r;
    try { r = JSON.parse(regras || "{}"); setErroJson(""); } catch (err) { setErroJson(`Regras não é um JSON válido: ${err.message}`); return; }
    const ok = await executar(() => api.publicarDiretriz({ operador, conteudo, regras: r, motivo: motivo || null }), "Nova versão publicada e ativa");
    if (ok) onFechar();
  }
  return (
    <Modal titulo={`Nova versão: ${nomeOp(operador)}`} onFechar={onFechar} largura={820}>
      <form className="form" onSubmit={salvar}>
        <div className="modal-texto">Publicada pelo operador, a versão já entra <b>ativa</b> e a atual fica substituída.</div>
        <Campo rotulo="Texto da diretriz" largo><textarea className="mono" rows={14} value={conteudo} onChange={(e) => setConteudo(e.target.value)} required /></Campo>
        <Campo rotulo="Regras (JSON)" largo dica="Limites do operador: teto, intervalo, rodadas, janela…"><textarea className="mono" rows={8} value={regras} onChange={(e) => setRegras(e.target.value)} /></Campo>
        {erroJson && <ErroBox erro={erroJson} />}
        <Campo rotulo="Motivo (opcional)" largo><input value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
        {ativa && (
          <details className="detalhes">
            <summary><GitCompare size={14} /> Ver diferenças contra v{ativa.versao}</summary>
            <Diff antes={ativa.conteudo} depois={conteudo} rotuloAntes={`v${ativa.versao}`} rotuloDepois="nova" />
          </details>
        )}
        <div className="form-botoes">
          <button type="button" className="btn" onClick={onFechar}>Cancelar</button>
          <button type="submit" className="btn btn-primario" disabled={ocupado}>Publicar</button>
        </div>
      </form>
    </Modal>
  );
}

function DiretrizDetalhe({ d, todas, onFechar }) {
  const { nomeOp } = useApp();
  const base = acharBase(d, todas);
  return (
    <Gaveta
      onFechar={onFechar}
      titulo={`Diretriz v${d.versao} · ${d.operador ? nomeOp(d.operador) : "padrão"}`}
      subtitulo={<><PilulaStatus mapa={STATUS_DIRETRIZ_MAP} valor={d.status} /><SeloAutor autor={d.autor} autorTipo={d.autor_tipo} /></>}
    >
      <Secao titulo="Dados">
        <Campos itens={[
          ["Criada", fmtData(d.criada_em)],
          ["Versão base", d.base_versao ? `v${d.base_versao}` : null],
          ["Motivo", d.motivo],
          ["Decidida por", d.decidida_por && nomeOp(d.decidida_por)],
          ["Decidida em", d.decidida_em && fmtData(d.decidida_em)],
          ["Nota da decisão", d.nota_decisao],
        ]} />
      </Secao>
      {base && d.base_versao ? (
        <Secao titulo={`Mudanças contra ${rotuloVersao(base, nomeOp)}`}><Comparacao d={d} base={base} /></Secao>
      ) : null}
      <Secao titulo="Texto completo"><pre className="texto-diretriz">{d.conteudo}</pre></Secao>
      <Secao titulo="Regras"><pre className="json">{jsonBonito(d.regras)}</pre></Secao>
    </Gaveta>
  );
}

export default function Diretrizes() {
  const { operadorFiltro, operadores, nomeOp, busca, podeEditar } = useApp();
  const [abertoId, setAbertoId] = useState(null);
  const [nova, setNova] = useState(null);
  const { dados, erro, carregando, recarregar } = useDados(() => api.diretrizes(operadorFiltro), [operadorFiltro]);
  const todas = lista(dados, "diretrizes");
  const visiveis = todas.filter((d) => contem(`${d.conteudo} ${d.motivo || ""} v${d.versao}`, busca));
  const propostas = visiveis.filter((d) => d.status === "proposta");

  // Grupos: padrão + cada operador (respeitando o filtro do topo).
  const chaves = [null, ...operadores.map((o) => o.email)].filter((op) => !operadorFiltro || op === operadorFiltro || op === null);
  const grupos = chaves.map((op) => ({
    op,
    itens: visiveis.filter((d) => d.operador === op).sort((a, b) => b.versao - a.versao),
    ativa: todas.find((d) => d.operador === op && d.status === "ativa"),
  })).filter((g) => g.itens.length || g.op);
  const aberto = abertoId && todas.find((d) => d.id === abertoId);

  return (
    <div className="view">
      <div className="view-cab">
        <div>
          <h1>Diretrizes</h1>
          <p className="muted">O bot pode propor mudanças, mas elas só valem depois da sua aprovação. O operador é a hierarquia superior.</p>
        </div>
      </div>
      <ErroBox erro={erro} onTentar={recarregar} />
      {!dados && carregando && <Carregando />}

      {propostas.length > 0 && (
        <section className="propostas">
          <h2 className="titulo-secao">Propostas pendentes ({propostas.length})</h2>
          {propostas.map((d) => <CartaoProposta key={d.id} d={d} base={acharBase(d, todas)} />)}
        </section>
      )}

      {dados && !todas.length && <Vazio>Nenhuma diretriz cadastrada.</Vazio>}
      {dados && grupos.map((g) => (
        <Grupo
          key={g.op || "padrao"}
          titulo={g.op ? nomeOp(g.op) : "Padrão (bots sem diretriz própria)"}
          cor={g.op ? "#0073ea" : "#797e87"}
          contagem={g.itens.length}
          extra={g.op && podeEditar(g.op) ? (
            <button className="btn btn-pequeno" onClick={() => setNova({ op: g.op, ativa: g.ativa || todas.find((d) => d.operador === null && d.status === "ativa") })}>
              <Plus size={14} /> Nova versão
            </button>
          ) : null}
        >
          {!g.itens.length ? <div className="grupo-vazio muted">Sem versão própria: este bot segue o padrão.</div> : (
            <Tabela larguras={[110, 130, 150, null, 100, 190]}>
                <thead>
                  <tr>
                    <th>Versão</th>
                    <th className="col-status">Status</th>
                    <th>Autor</th>
                    <th className="col-titulo">Motivo</th>
                    <th>Criada</th>
                    <th>Decisão</th>
                  </tr>
                </thead>
                <tbody>
                  {g.itens.map((d) => (
                    <tr key={d.id} className="linha-clicavel" onClick={() => setAbertoId(d.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setAbertoId(d.id)}>
                      <td><b>v{d.versao}</b>{d.base_versao ? <span className="muted pequeno"> (base v{d.base_versao})</span> : null}</td>
                      <td className="celula-status"><PilulaStatus mapa={STATUS_DIRETRIZ_MAP} valor={d.status} cheia /></td>
                      <td><SeloAutor autor={d.autor} autorTipo={d.autor_tipo} /></td>
                      <td className="col-titulo"><span className="titulo-celula">{d.motivo || <span className="muted">—</span>}</span></td>
                      <td title={fmtData(d.criada_em)}>{tempoRelativo(d.criada_em)}</td>
                      <td>{d.decidida_por ? <span title={d.nota_decisao || ""}>{nomeOp(d.decidida_por)} · {tempoRelativo(d.decidida_em)}</span> : <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </Tabela>
          )}
        </Grupo>
      ))}

      {aberto && <DiretrizDetalhe d={aberto} todas={todas} onFechar={() => setAbertoId(null)} />}
      {nova && <NovaVersao operador={nova.op} ativa={nova.ativa} onFechar={() => setNova(null)} />}
    </div>
  );
}
