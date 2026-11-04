// Estado global do painel (quem está logado, filtro de operador, busca, polling)
// e os hooks de carga/ação usados pelas telas.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

// Carrega dados e recarrega a cada tick do polling (15 s) ou depois de uma ação.
export function useDados(carregar, deps = []) {
  const { tick, marcarAtualizado } = useApp();
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const fnRef = useRef(carregar);
  fnRef.current = carregar;
  const seqRef = useRef(0);

  const executar = useCallback(async () => {
    const meu = ++seqRef.current;
    setCarregando(true);
    try {
      const r = await fnRef.current();
      if (meu !== seqRef.current) return;
      setDados(r);
      setErro("");
      marcarAtualizado();
    } catch (e) {
      if (meu !== seqRef.current) return;
      setErro(e.message || String(e));
    } finally {
      if (meu === seqRef.current) setCarregando(false);
    }
  }, [marcarAtualizado]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { executar(); }, [tick, executar, ...deps]);

  return { dados, erro, carregando, recarregar: executar };
}

// Executa uma escrita, mostra aviso e força recarga de tudo.
export function useAcao() {
  const { avisar, recarregar } = useApp();
  const [ocupado, setOcupado] = useState(false);
  const executar = useCallback(async (fn, msgOk) => {
    setOcupado(true);
    try {
      const r = await fn();
      if (msgOk) avisar(msgOk, "ok");
      recarregar();
      return r;
    } catch (e) {
      avisar(e.message || String(e), "erro");
      return undefined;
    } finally {
      setOcupado(false);
    }
  }, [avisar, recarregar]);
  return [executar, ocupado];
}

// Re-renderiza a cada `ms` (para textos "há X s").
export function useRelogio(ms = 1000) {
  const [, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export function useTecla(tecla, fn, ativo = true) {
  useEffect(() => {
    if (!ativo) return;
    const h = (e) => { if (e.key === tecla) fn(e); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [tecla, fn, ativo]);
}
