// Tabela com larguras fixas por coluna, para os grupos do quadro ficarem alinhados entre si
// (estilo quadro). `larguras`: px por coluna; null = coluna flexível (título).
export default function Tabela({ larguras, children }) {
  const minimo = larguras.reduce((s, w) => s + (w || 200), 0);
  return (
    <div className="tabela-rolagem">
      <table className="tabela" style={{ minWidth: minimo }}>
        <colgroup>
          {larguras.map((w, i) => <col key={i} style={w ? { width: w } : undefined} />)}
        </colgroup>
        {children}
      </table>
    </div>
  );
}
