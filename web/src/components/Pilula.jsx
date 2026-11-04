// Pílulas de status (cor sólida, texto branco) em estilo de quadro.
import { cx } from "../util.js";

export function Pilula({ cor, children, title, cheia = false, pequena = false }) {
  return (
    <span className={cx("pilula", cheia && "pilula-cheia", pequena && "pilula-pequena")} style={{ background: cor }} title={title}>
      {children}
    </span>
  );
}

// `mapa` = {chave: {label, cor}} vindo de constants.js.
export function PilulaStatus({ mapa, valor, cheia, pequena }) {
  const item = mapa[valor];
  return (
    <Pilula cor={item?.cor || "#797e87"} cheia={cheia} pequena={pequena} title={valor}>
      {item?.label || valor || "—"}
    </Pilula>
  );
}

export function Etiqueta({ children, tom = "neutro", title }) {
  return <span className={cx("etiqueta", `etiqueta-${tom}`)} title={title}>{children}</span>;
}
