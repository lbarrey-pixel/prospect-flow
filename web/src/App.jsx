// Painel web do Prospect Flow. Contrato da API: docs/api.md.
//
// Autenticação: ID token do Google (Google Identity Services) como Bearer. Quem pode entrar é decidido pela API (`crm.operadores`),
// via GET /eu. No MODO MOCK não há login: entra como um operador admin fictício.
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, aoPerderAcesso, definirToken, GOOGLE_CLIENT_ID, MOCK } from "./api.js";
import { AppCtx, useApp, useDados } from "./contexto.jsx";
import { AREAS, INTERVALO_POLLING_MS } from "./constants.js";
import { lista } from "./util.js";
import Login, { carregarGoogle, decodeJwtPayload, iniciarGoogle } from "./components/Login.jsx";
import Sidebar from "./components/Sidebar.jsx";
import Topo from "./components/Topo.jsx";
import { Carregando, ErroBox } from "./components/Estados.jsx";
import Tarefas from "./views/Tarefas.jsx";
import Envios from "./views/Envios.jsx";
import Campainhas from "./views/Campainhas.jsx";
import Acompanhamentos from "./views/Acompanhamentos.jsx";
import Relatos from "./views/Relatos.jsx";
import Diretrizes from "./views/Diretrizes.jsx";
import Leads from "./views/Leads.jsx";
import Atividade from "./views/Atividade.jsx";
import Diario from "./views/Diario.jsx";
import Board from "./views/Board.jsx";

const CHAVE_TOKEN = "pf_web_token";
const CHAVE_USUARIO = "pf_web_usuario";

const ler = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const gravar = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* sem storage */ } };

function tokenValido(t) {
  if (!t) return false;
  if (t.startsWith("dev:")) return true;
  try { return decodeJwtPayload(t).exp * 1000 > Date.now() + 30e3; } catch { return false; }
}

const USUARIO_MOCK = { nome: "Ana (demo)", email: "ana@example.com", foto: null };

export default function App() {
  const [token, setToken] = useState(() => {
    if (MOCK) return null;
    const t = ler(CHAVE_TOKEN);
    return tokenValido(t) ? t : null;
  });
  const [usuario, setUsuario] = useState(() => {
    if (MOCK) return USUARIO_MOCK;
    try { return JSON.parse(ler(CHAVE_USUARIO) || "null"); } catch { return null; }
  });
  const [authErro, setAuthErro] = useState("");
  definirToken(token);

  const sair = useCallback((msg) => {
    gravar(CHAVE_TOKEN, null);
    gravar(CHAVE_USUARIO, null);
    try { window.google?.accounts.id.disableAutoSelect(); } catch { /* ok */ }
    definirToken(null);
    setToken(null);
    setUsuario(null);
    if (typeof msg === "string") setAuthErro(msg);
  }, []);

  const aoLogar = useCallback((response) => {
    const credential = response.credential;
    let p;
    try { p = decodeJwtPayload(credential); } catch { setAuthErro("Resposta do Google inválida."); return; }
    const u = { nome: p.name, email: p.email, foto: p.picture };
    setAuthErro("");
    definirToken(credential);
    setToken(credential);
    setUsuario(u);
    gravar(CHAVE_TOKEN, credential);
    gravar(CHAVE_USUARIO, JSON.stringify(u));
  }, []);

  const aoLogarDev = useCallback((email) => {
    const t = `dev:${email}`;
    const u = { nome: email, email, foto: null };
    setAuthErro("");
    definirToken(t);
    setToken(t);
    setUsuario(u);
    gravar(CHAVE_TOKEN, t);
    gravar(CHAVE_USUARIO, JSON.stringify(u));
  }, []);

  useEffect(() => { aoPerderAcesso(() => sair("Acesso expirado ou negado. Entre de novo.")); }, [sair]);

  // Renovação silenciosa do ID token ~5 min antes de expirar .
  useEffect(() => {
    if (MOCK || !token || token.startsWith("dev:") || !GOOGLE_CLIENT_ID) return undefined;
    let exp = 0;
    try { exp = decodeJwtPayload(token).exp * 1000; } catch { return undefined; }
    const em = Math.max(exp - Date.now() - 5 * 60e3, 5000);
    const t = setTimeout(() => {
      carregarGoogle().then(() => { iniciarGoogle(aoLogar); window.google.accounts.id.prompt(() => {}); }).catch(() => {});
    }, em);
    return () => clearTimeout(t);
  }, [token, aoLogar]);

  if (!MOCK && (!token || !usuario)) return <Login onLogin={aoLogar} onDevLogin={aoLogarDev} erro={authErro} />;
  return <Shell usuario={usuario} onSair={() => sair()} />;
}

function areaDoHash() {
  const h = (window.location.hash || "").replace(/^#\/?/, "");
  return AREAS.some((a) => a.chave === h) ? h : "tarefas";
}

// Provedor do contexto: quem sou eu, operadores, filtros, polling e avisos.
function Shell({ usuario, onSair }) {
  const [eu, setEu] = useState(null);
  const [operadores, setOperadores] = useState([]);
  const [erroInicial, setErroInicial] = useState("");
  const [operadorFiltro, setOperadorFiltro] = useState(() => ler("pf_web_operador") || "");
  const [busca, setBusca] = useState("");
  const [tick, setTick] = useState(0);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState(null);
  const [avisos, setAvisos] = useState([]);

  const carregarInicio = useCallback(async () => {
    setErroInicial("");
    try {
      const [e, ops] = await Promise.all([api.eu(), api.operadores()]);
      setEu(e);
      setOperadores(lista(ops, "operadores"));
    } catch (err) {
      setErroInicial(err.status === 403 ? `Acesso negado: ${err.message}` : err.message);
    }
  }, []);
  useEffect(() => { carregarInicio(); }, [carregarInicio]);

  useEffect(() => { gravar("pf_web_operador", operadorFiltro || null); }, [operadorFiltro]);

  // Polling simples: um tick a cada 15 s (pausa com a aba escondida e volta ao reaparecer).
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) setTick((n) => n + 1); }, INTERVALO_POLLING_MS);
    const vis = () => { if (!document.hidden) setTick((n) => n + 1); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, []);

  const recarregar = useCallback(() => setTick((n) => n + 1), []);
  const marcarAtualizado = useCallback(() => setUltimaAtualizacao(Date.now()), []);
  const avisar = useCallback((texto, tipo = "ok") => {
    const id = Math.random().toString(36).slice(2);
    setAvisos((a) => [...a, { id, texto, tipo }]);
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), tipo === "erro" ? 7000 : 3500);
  }, []);

  const nomeOp = useCallback((email) => {
    if (!email) return "Padrão";
    return operadores.find((o) => o.email === email)?.nome || email;
  }, [operadores]);
  const podeEditar = useCallback((dono) => !!eu && (eu.admin || eu.email === dono), [eu]);

  const ctx = useMemo(() => ({
    eu, usuario, operadores, nomeOp, podeEditar,
    operadorFiltro, setOperadorFiltro, busca, setBusca,
    tick, recarregar, ultimaAtualizacao, marcarAtualizado, avisar,
  }), [eu, usuario, operadores, nomeOp, podeEditar, operadorFiltro, busca, tick, recarregar, ultimaAtualizacao, marcarAtualizado, avisar]);

  if (!eu) {
    return (
      <div className="login-tela">
        <div className="login-card">
          {erroInicial ? (
            <>
              <ErroBox erro={erroInicial} onTentar={carregarInicio} />
              {!MOCK && <button className="btn" onClick={onSair}>Sair</button>}
            </>
          ) : <Carregando texto="Conectando à API…" />}
        </div>
      </div>
    );
  }

  return (
    <AppCtx.Provider value={ctx}>
      <Layout onSair={onSair} />
      <div className="avisos" aria-live="polite">
        {avisos.map((a) => <div key={a.id} className={`aviso aviso-${a.tipo}`}>{a.texto}</div>)}
      </div>
    </AppCtx.Provider>
  );
}

function Layout({ onSair }) {
  const { operadorFiltro } = useApp();
  const [area, setArea] = useState(areaDoHash);
  const [menuAberto, setMenuAberto] = useState(false);

  useEffect(() => {
    const h = () => setArea(areaDoHash());
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  const irPara = (a) => { window.location.hash = `/${a}`; setArea(a); };

  const { dados: painel, carregando } = useDados(() => api.painel(operadorFiltro), [operadorFiltro]);
  const faltaContagemDiretrizes = painel && typeof painel.diretrizes_propostas !== "number";
  const { dados: propostas } = useDados(
    async () => (faltaContagemDiretrizes ? lista(await api.diretrizes(operadorFiltro), "diretrizes").filter((d) => d.status === "proposta").length : null),
    [operadorFiltro, faltaContagemDiretrizes],
  );

  const nPropostas = typeof painel?.diretrizes_propostas === "number" ? painel.diretrizes_propostas : propostas;
  const badges = {
    tarefas: painel?.tarefas_urgentes ? { n: painel.tarefas_urgentes, urgente: true, title: "Tarefas urgentes abertas" } : null,
    envios: painel?.envios_hoje?.bloqueado ? { n: painel.envios_hoje.bloqueado, urgente: true, title: "Envios bloqueados hoje" } : null,
    relatos: painel?.relatos_nao_lidos ? { n: painel.relatos_nao_lidos, title: "Relatos não lidos" } : null,
    diretrizes: nPropostas ? { n: nPropostas, urgente: true, title: "Propostas de diretriz aguardando decisão" } : null,
  };

  const VIEWS = { board: Board, tarefas: Tarefas, diario: Diario, envios: Envios, campainhas: Campainhas, acompanhamentos: Acompanhamentos, relatos: Relatos, diretrizes: Diretrizes, leads: Leads, atividade: Atividade };
  const View = VIEWS[area] || Tarefas;
  const titulo = AREAS.find((a) => a.chave === area)?.label;

  useEffect(() => { document.title = `${titulo} · Prospect Flow`; }, [titulo]);

  return (
    <div className="app">
      <Sidebar area={area} onArea={irPara} badges={badges} aberta={menuAberto} onFechar={() => setMenuAberto(false)} />
      <div className="principal">
        <Topo painel={painel} onMenu={() => setMenuAberto(true)} onSair={onSair} carregando={carregando} />
        <main className="conteudo">
          <View key={area} painel={painel} irPara={irPara} />
        </main>
      </div>
    </div>
  );
}
