// Backend fictício em memória para o MODO MOCK.
//
// Responde as mesmas rotas de docs/api.md, com os mesmos formatos que o painel
// espera. Todos os dados são inventados (domínios de exemplo, operadores com
// e-mail @example.com). As escritas alteram o estado e geram eventos, como a
// API real faria. Recarregar a página volta ao estado inicial.
import { ApiError } from "./util.js";

const AGORA = Date.now();
const H = 3600e3;
const D = 24 * H;
const iso = (ms) => new Date(ms).toISOString();
const atras = (horas) => iso(AGORA - horas * H);
const adiante = (horas) => iso(AGORA + horas * H);
const agora = () => new Date().toISOString();

let seq = 1000;
const uid = (pref = "") => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  seq += 1;
  return `${pref}${seq}-${Math.random().toString(16).slice(2, 10)}`;
};
const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

// ---------------------------------------------------------------- operadores
const ANA = "ana@example.com";
const BRU = "bruno@example.com";
const CAR = "carla@example.com";

const REGRAS_PADRAO = {
  teto_frios: 20,
  teto_respondeu: 5,
  intervalo_dias_uteis: 5,
  max_rodadas: 3,
  ciclo_dias: 90,
  janela: { dias: [1, 2, 3, 4, 5], inicio: "08:00", fim: "17:00", tz: "America/Sao_Paulo" },
  contam_no_teto: ["R1", "R2", "R3"],
  estagios_nutriveis: ["frio", "aquecendo", "respondeu"],
};

const db = {
  operadores: [
    { email: ANA, nome: "Ana", admin: true, regras: clone(REGRAS_PADRAO), bcc: "registro@example.com", caixa: ANA },
    { email: BRU, nome: "Bruno", admin: false, regras: { ...clone(REGRAS_PADRAO), teto_frios: 15 }, bcc: "registro@example.com", caixa: BRU },
    { email: CAR, nome: "Carla", admin: false, regras: clone(REGRAS_PADRAO), bcc: "registro@example.com", caixa: CAR },
  ],
  leads: [],
  contatos: {},
  interacoes: {},
  acoes: {},
  tarefas: [],
  envios: [],
  campainhas: [],
  disparos: {},
  acompanhamentos: [],
  relatos: [],
  diretrizes: [],
  eventos: [],
};
const EU = { email: ANA, nome: "Ana (demo)", tipo: "operador", admin: true, operador: ANA };
const nomeOp = (email) => db.operadores.find((o) => o.email === email)?.nome || email;

function evento(entidade, entidade_id, acao, resumo, extra = {}) {
  const e = {
    id: uid("ev"),
    criado_em: extra.criado_em || agora(),
    entidade,
    entidade_id,
    acao,
    resumo,
    ator: extra.ator || EU.email,
    ator_tipo: extra.ator_tipo || "operador",
    operador: extra.operador || null,
    dominio: extra.dominio || null,
    dados: extra.dados || null,
  };
  db.eventos.push(e);
  return e;
}

// --------------------------------------------------------------------- leads
const LEADS = [
  ["exemplo.example", "Exemplo Indústria Ltda.", ANA, "aquecendo", false, 2, 50, 70],
  ["acme.example", "Acme Industrial S.A.", ANA, "respondeu", true, 2, 30, 20],
  ["metalurgica-alfa.example", "Metalúrgica Alfa", ANA, "frio", false, 1, 200, 24],
  ["construtora-beta.example", "Construtora Beta", BRU, "qualificado", true, 3, 120, 48],
  ["plasticos-gama.example", "Plásticos Gama", BRU, "frio", false, 0, null, null],
  ["usina-delta.example", "Usina Delta Energia", ANA, "frio", false, 1, 400, -10],
  ["ferragens-omega.example", "Ferragens Ômega", CAR, "aquecendo", false, 2, 90, 30],
  ["eletro-sigma.example", "Eletro Sigma", CAR, "proposta_enviada", true, 3, 300, 72],
  ["quimica-zeta.example", "Química Zeta", BRU, "descartado", true, 3, 900, null],
  ["logistica-kappa.example", "Logística Kappa", ANA, "convertido", true, 3, 1500, null],
  ["madeireira-lambda.example", "Madeireira Lambda", CAR, "frio", false, 1, 160, 8],
  ["agro-teta.example", "Agro Teta", BRU, "respondeu", true, 2, 40, 6],
  ["textil-epsilon.example", "Têxtil Épsilon", ANA, "aquecendo", false, 2, 100, 60],
  ["hospital-iota.example", "Hospital Iota", CAR, "frio", false, 0, null, null],
  ["municipio-exemplo.example", "Prefeitura de Município Exemplo", ANA, "frio", false, 0, null, null],
  ["mineracao-rho.example", "Mineração Rho", BRU, "aquecendo", false, 1, 75, 40],
];
const NOMES = ["Ana Souza", "Bruno Lima", "Carla Dias", "Diego Rocha", "Elisa Prado", "Fernando Reis", "Gabriela Melo", "Hugo Nunes"];

LEADS.forEach(([dominio, empresa, dono, estagio, resp, rodada, ultEnvioH, followH], i) => {
  const id = `lead-${i + 1}`;
  db.leads.push({
    id,
    dominio,
    empresa,
    cnpj: null,
    dono_email: dono,
    estagio_funil: estagio,
    teve_resposta: resp,
    rodada,
    primeiro_envio: ultEnvioH ? atras(ultEnvioH + rodada * 7 * 24) : null,
    ultimo_envio: ultEnvioH ? atras(ultEnvioH) : null,
    proximo_followup_em: followH === null ? null : adiante(followH),
    observacao: estagio === "descartado" ? "Pediu para não ser contatado." : "",
    criado_em: atras(2000 + i * 10),
    atualizado_em: atras(ultEnvioH || 500),
  });
  const n1 = NOMES[i % NOMES.length];
  db.contatos[dominio] = [
    { id: `ct-${i}-1`, nome: n1, email: `compras@${dominio}`, cargo: "Compras" },
    ...(i % 3 === 0 ? [{ id: `ct-${i}-2`, nome: NOMES[(i + 3) % NOMES.length], email: `suprimentos@${dominio}`, cargo: "Suprimentos" }] : []),
  ];
  db.interacoes[dominio] = [];
  db.acoes[dominio] = [];
  for (let r = 1; r <= rodada; r++) {
    const quando = atras((ultEnvioH || 0) + (rodada - r) * 7 * 24);
    db.interacoes[dominio].push({
      id: `in-${i}-${r}`, canal: "email", direcao: "enviado", email: `compras@${dominio}`, nome: n1,
      assunto: r === 1 ? `Nortec Distribuidora | apresentação para ${empresa}` : `Re: Nortec Distribuidora | apresentação para ${empresa}`,
      trecho: "Olá! Somos a Nortec Distribuidora. Segue nosso catálogo; se fizer sentido, é só pedir um orçamento por aqui.",
      data_interacao: quando,
    });
    db.acoes[dominio].push({ id: `ac-${i}-${r}`, tipo_acao: "mensagem_enviada", descricao: `R${r} enviado por e-mail`, rodada: r, criado_em: quando, proxima_acao_em: null, tarefa_id: null });
  }
  if (resp) {
    db.interacoes[dominio].push({
      id: `in-${i}-resp`, canal: "email", direcao: "recebido", email: `compras@${dominio}`, nome: n1,
      assunto: `Re: Nortec Distribuidora | apresentação para ${empresa}`,
      trecho: estagio === "descartado" ? "Por favor, retirem nosso e-mail da lista." : "Obrigado pelo contato. Podem mandar mais detalhes sobre os itens do catálogo?",
      data_interacao: atras((ultEnvioH || 10) - 2),
    });
  }
});

// ------------------------------------------------------------------- tarefas
function tarefa(dados) {
  const t = {
    id: uid("t"),
    operador: ANA,
    tipo: "pergunta",
    status: "pendente",
    prioridade: "normal",
    titulo: "",
    dominio: null,
    payload: {},
    resposta: null,
    motivo: null,
    detalhe: null,
    origem: "orquestrador",
    criada_por: "n8n",
    criada_em: agora(),
    entregue_em: null,
    iniciada_em: null,
    concluida_em: null,
    reagendar_em: null,
    prazo: null,
    tentativas_entrega: 0,
    ultimo_erro_entrega: null,
    origem_ref: { campainha_id: null, acompanhamento_id: null, relato_id: null },
    ...dados,
  };
  db.tarefas.push(t);
  const ev = (acao, resumo, quando, ator = "n8n", ator_tipo = "orquestrador") =>
    evento("tarefa", t.id, acao, resumo, { criado_em: quando, ator, ator_tipo, operador: t.operador, dominio: t.dominio });
  ev("criada", `Tarefa criada: ${t.titulo}`, t.criada_em, t.criada_por, t.origem === "operador" ? "operador" : t.origem === "bot" ? "bot" : "orquestrador");
  if (t.entregue_em) ev("entregue", "Webhook do bot respondeu 2xx", t.entregue_em, "sistema", "sistema");
  if (t.iniciada_em) ev("iniciada", "Bot iniciou a tarefa", t.iniciada_em, `bot:${nomeOp(t.operador)}`, "bot");
  if (t.concluida_em) ev("resultado", `Bot devolveu: ${t.status}${t.motivo ? ` (${t.motivo})` : ""}`, t.concluida_em, `bot:${nomeOp(t.operador)}`, "bot");
  return t;
}

const corpoR1 = (empresa, nome, op) => `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.5">
<p>Olá, ${nome.split(" ")[0]}!</p>
<p>Sou o ${op}, da <b>Nortec Distribuidora</b>. Atendemos indústrias como a ${empresa} com itens de manutenção e consumo, com entrega programada.</p>
<p>Deixo nosso catálogo em anexo. Se algum item fizer sentido, é só responder este e-mail com a lista que eu monto o orçamento.</p>
<p>Abraço,<br><b>${op}</b><br>Nortec Distribuidora</p>
</div>`;

const leadPorDominio = (d) => db.leads.find((l) => l.dominio === d);

function rascunho(dominio, tipo_envio, op) {
  const lead = leadPorDominio(dominio);
  const contato = db.contatos[dominio][0];
  return {
    para: contato.email,
    assunto: tipo_envio === "R1" ? `Nortec Distribuidora | apresentação para ${lead.empresa}` : `Re: Nortec Distribuidora | apresentação para ${lead.empresa}`,
    corpo_html: corpoR1(lead.empresa, contato.nome, nomeOp(op)),
    anexos: ["catalogo"],
    in_reply_to: null,
    enviar_apos: null,
  };
}

function envio(t, dominio, tipo_envio, status, extra = {}) {
  const r = rascunho(dominio, tipo_envio, t.operador);
  const e = {
    id: uid("e"),
    tarefa_id: t.id,
    operador: t.operador,
    dominio,
    tipo_envio,
    rodada: tipo_envio.startsWith("R") ? Number(tipo_envio.slice(1)) : null,
    para: r.para,
    assunto: r.assunto,
    corpo_html: r.corpo_html,
    anexos: r.anexos,
    in_reply_to: null,
    status,
    motivo_bloqueio: null,
    enviar_apos: null,
    message_id: status === "enviado" ? `<${Math.random().toString(16).slice(2)}@example.com>` : null,
    enviado_em: status === "enviado" ? t.concluida_em : null,
    erro: null,
    criado_em: t.concluida_em || agora(),
    ...extra,
  };
  db.envios.push(e);
  evento("envio", e.id, "criado", `Envio ${tipo_envio} para ${dominio}: ${status}`, { criado_em: e.criado_em, ator: "api", ator_tipo: "sistema", operador: t.operador, dominio });
  return e;
}

// Envio diário de hoje (Ana) já executado, com um recusado e envios em vários status.
{
  const t = tarefa({
    operador: ANA, tipo: "envio_diario", status: "executou", titulo: `Envios de ${new Date(AGORA).toLocaleDateString("pt-BR")}`,
    criada_em: atras(5), entregue_em: atras(4.98), iniciada_em: atras(4.9), concluida_em: atras(4.6),
    payload: {
      data: new Date(AGORA).toISOString().slice(0, 10),
      saldo_teto: { frios: 20, respondeu: 5 },
      candidatos: [
        { dominio: "exemplo.example", estagio: "aquecendo", proxima_rodada: "R3", ultimo_envio: atras(50), contato: "compras@exemplo.example" },
        { dominio: "metalurgica-alfa.example", estagio: "frio", proxima_rodada: "R2", ultimo_envio: atras(200), contato: "compras@metalurgica-alfa.example" },
        { dominio: "usina-delta.example", estagio: "frio", proxima_rodada: "R2", ultimo_envio: atras(400), contato: "compras@usina-delta.example" },
        { dominio: "textil-epsilon.example", estagio: "aquecendo", proxima_rodada: "R3", ultimo_envio: atras(100), contato: "compras@textil-epsilon.example" },
        { dominio: "municipio-exemplo.example", estagio: "frio", proxima_rodada: "R1", ultimo_envio: null, contato: "compras@municipio-exemplo.example" },
      ],
    },
    resposta: {
      status: "executou", motivo: null, detalhe: "3 e-mails montados, 1 recusado por licitação e 1 adiado.",
      reagendar_em: null,
      decisoes: [
        { dominio: "exemplo.example", decisao: "executou", tipo_envio: "R3", rascunho: rascunho("exemplo.example", "R3", ANA), proxima_acao_em: adiante(170), estagio_sugerido: null },
        { dominio: "metalurgica-alfa.example", decisao: "executou", tipo_envio: "R2", rascunho: rascunho("metalurgica-alfa.example", "R2", ANA), proxima_acao_em: adiante(170), estagio_sugerido: "aquecendo" },
        { dominio: "textil-epsilon.example", decisao: "executou", tipo_envio: "R3", rascunho: rascunho("textil-epsilon.example", "R3", ANA), proxima_acao_em: adiante(170), estagio_sugerido: null },
        { dominio: "municipio-exemplo.example", decisao: "recusou", motivo: "licitacao_plena", detalhe: "Compra só por pregão eletrônico; não cabe e-mail frio." },
        { dominio: "usina-delta.example", decisao: "adiou", motivo: "contexto_lead", detalhe: "Site em manutenção; tento de novo semana que vem.", proxima_acao_em: adiante(120) },
      ],
    },
  });
  envio(t, "exemplo.example", "R3", "enviado");
  envio(t, "metalurgica-alfa.example", "R2", "bloqueado", { motivo_bloqueio: "intervalo" });
  envio(t, "textil-epsilon.example", "R3", "agendado", { enviar_apos: adiante(16) });
}
{
  const t = tarefa({
    operador: BRU, tipo: "envio_diario", status: "parcial", motivo: "teto_diario", detalhe: "Teto de frios atingido; 2 candidatos ficaram para amanhã.",
    titulo: `Envios de ${new Date(AGORA).toLocaleDateString("pt-BR")}`,
    criada_em: atras(5), entregue_em: atras(4.9), iniciada_em: atras(4.5), concluida_em: atras(4.2),
    payload: { data: new Date(AGORA).toISOString().slice(0, 10), saldo_teto: { frios: 2, respondeu: 5 }, candidatos: [
      { dominio: "plasticos-gama.example", estagio: "frio", proxima_rodada: "R1", contato: "compras@plasticos-gama.example" },
      { dominio: "mineracao-rho.example", estagio: "aquecendo", proxima_rodada: "R2", contato: "compras@mineracao-rho.example" },
    ] },
    resposta: { status: "parcial", motivo: "teto_diario", detalhe: "Teto de frios atingido.", decisoes: [
      { dominio: "plasticos-gama.example", decisao: "executou", tipo_envio: "R1", rascunho: rascunho("plasticos-gama.example", "R1", BRU), proxima_acao_em: adiante(168) },
      { dominio: "mineracao-rho.example", decisao: "executou", tipo_envio: "R2", rascunho: rascunho("mineracao-rho.example", "R2", BRU), proxima_acao_em: adiante(168) },
    ] },
  });
  envio(t, "plasticos-gama.example", "R1", "enviado");
  envio(t, "mineracao-rho.example", "R2", "bloqueado", { motivo_bloqueio: "teto_diario" });
}
{
  const t = tarefa({
    operador: CAR, tipo: "envio_diario", status: "em_andamento", titulo: `Envios de ${new Date(AGORA).toLocaleDateString("pt-BR")}`,
    criada_em: atras(1), entregue_em: atras(0.98), iniciada_em: atras(0.5),
    payload: { data: new Date(AGORA).toISOString().slice(0, 10), saldo_teto: { frios: 20, respondeu: 5 }, candidatos: [
      { dominio: "madeireira-lambda.example", estagio: "frio", proxima_rodada: "R2", contato: "compras@madeireira-lambda.example" },
      { dominio: "hospital-iota.example", estagio: "frio", proxima_rodada: "R1", contato: "compras@hospital-iota.example" },
    ] },
  });
  void t;
}
{
  const t = tarefa({
    operador: ANA, tipo: "envio_diario", status: "executou", titulo: `Envios de ${new Date(AGORA - D).toLocaleDateString("pt-BR")}`,
    criada_em: atras(29), entregue_em: atras(28.9), iniciada_em: atras(28.8), concluida_em: atras(28.5),
    payload: { data: new Date(AGORA - D).toISOString().slice(0, 10), saldo_teto: { frios: 20, respondeu: 5 }, candidatos: [{ dominio: "acme.example", estagio: "respondeu", proxima_rodada: "R2" }] },
    resposta: { status: "executou", detalhe: "1 e-mail.", decisoes: [{ dominio: "acme.example", decisao: "executou", tipo_envio: "R2", rascunho: rascunho("acme.example", "R2", ANA) }] },
  });
  envio(t, "acme.example", "R2", "enviado");
}
{
  const t = tarefa({
    operador: CAR, tipo: "envio_diario", status: "executou", titulo: `Envios de ${new Date(AGORA - D).toLocaleDateString("pt-BR")}`,
    criada_em: atras(29), entregue_em: atras(28.9), iniciada_em: atras(28.7), concluida_em: atras(28.4),
    payload: { data: new Date(AGORA - D).toISOString().slice(0, 10), candidatos: [{ dominio: "ferragens-omega.example", estagio: "aquecendo", proxima_rodada: "R2" }] },
    resposta: { status: "executou", decisoes: [{ dominio: "ferragens-omega.example", decisao: "executou", tipo_envio: "R2", rascunho: rascunho("ferragens-omega.example", "R2", CAR) }] },
  });
  envio(t, "ferragens-omega.example", "R2", "falhou", { erro: "SMTP 550: caixa do destinatário cheia" });
  envio(t, "ferragens-omega.example", "reenvio_pos_bounce", "aprovado", { para: "suprimentos@ferragens-omega.example" });
}

tarefa({
  operador: ANA, tipo: "tratar_resposta", status: "pendente", prioridade: "urgente", dominio: "acme.example",
  titulo: "Resposta de acme.ind.br", criada_em: atras(0.3), tentativas_entrega: 2,
  ultimo_erro_entrega: "Webhook respondeu 502 (bot fora do ar?)",
  payload: { caixa: ANA, de: "compras@acme.example", assunto: "Re: Nortec Distribuidora | apresentação para Acme Industrial S.A.", classe: "humano",
    trecho: "Bom dia! Temos interesse nos itens da página 4. Conseguem mandar orçamento para 200 unidades?", interesse_detectado: true },
});
tarefa({
  operador: BRU, tipo: "tratar_resposta", status: "entregue", dominio: "agro-teta.example",
  titulo: "Auto-reply de agro-teta.com.br", criada_em: atras(2), entregue_em: atras(1.99),
  payload: { caixa: BRU, de: "compras@agro-teta.example", assunto: "Resposta automática: fora do escritório", classe: "redirect",
    redirect_para: "suprimentos@agro-teta.example", trecho: "Estou de férias até o dia 15. Para assuntos urgentes, falar com suprimentos@agro-teta.example." },
});
tarefa({
  operador: ANA, tipo: "tratar_resposta", status: "bloqueado_humano", motivo: "sem_ok_humano", dominio: "textil-epsilon.example",
  detalhe: "Pediram condição de pagamento; isso é com o operador.", titulo: "Resposta de textil-epsilon.ind.br",
  criada_em: atras(20), entregue_em: atras(19.9), iniciada_em: atras(19.8), concluida_em: atras(19.7),
  payload: { caixa: ANA, de: "compras@textil-epsilon.example", classe: "humano", assunto: "Re: catálogo", trecho: "Qual o prazo de pagamento de vocês? Trabalham com 60 dias?" },
  resposta: { status: "bloqueado_humano", motivo: "sem_ok_humano", detalhe: "Pergunta sobre condição comercial. Não respondo isso; deixei relato para a Ana." },
});
tarefa({
  operador: CAR, tipo: "tratar_resposta", status: "falhou", dominio: "eletro-sigma.example",
  titulo: "Resposta de eletro-sigma.com.br", criada_em: atras(30), tentativas_entrega: 5,
  ultimo_erro_entrega: "Timeout após 10 s (5ª tentativa)",
  payload: { caixa: CAR, de: "compras@eletro-sigma.example", classe: "humano", trecho: "Recebemos a proposta, vamos avaliar." },
});
const tCamp = tarefa({
  operador: ANA, tipo: "campainha", status: "em_andamento", prioridade: "urgente", dominio: "construtora-beta.example",
  titulo: "Campainha: Construtora Beta escreveu", criada_em: atras(0.8), entregue_em: atras(0.79), iniciada_em: atras(0.7),
  payload: { campainha: "Construtora Beta (qualquer e-mail)", de: "engenharia@construtora-beta.example", assunto: "Cotação obra Zona Sul", trecho: "Precisamos de cotação até sexta." },
});
tarefa({
  operador: ANA, tipo: "acompanhamento", status: "adiou", dominio: "exemplo.example",
  titulo: "Retomar exemplo.com.br depois da feira", criada_em: atras(26), entregue_em: atras(25.9), iniciada_em: atras(25.8), concluida_em: atras(25.7),
  reagendar_em: adiante(46), detalhe: "Comprador está na feira até quarta.", origem: "bot", criada_por: "bot:Ana",
  payload: { instrucao: "Mandar R3 curto lembrando do catálogo." },
  resposta: { status: "adiou", detalhe: "Comprador está na feira até quarta.", reagendar_em: adiante(46) },
});
tarefa({
  operador: BRU, tipo: "pergunta", status: "recusou", motivo: "regra_ambigua",
  titulo: "Mandar promoção de fim de mês para os frios", criada_em: atras(50), entregue_em: atras(49.9), iniciada_em: atras(49.8), concluida_em: atras(49.7),
  origem: "operador", criada_por: BRU, detalhe: "Promoção implica preço; a diretriz proíbe.",
  payload: { instrucao: "Mandar a promoção de fim de mês para todos os frios." },
  resposta: { status: "recusou", motivo: "regra_ambigua", detalhe: "Promoção implica preço/desconto, e a diretriz proíbe. Sugiro um texto sem valores; mandei relato." },
});
tarefa({
  operador: CAR, tipo: "resposta_operador", status: "executou", titulo: "Resposta do Carla ao relato sobre Hospital Iota",
  criada_em: atras(70), entregue_em: atras(69.9), iniciada_em: atras(69.8), concluida_em: atras(69.5), origem: "operador", criada_por: CAR,
  dominio: "hospital-iota.example",
  payload: { pergunta: "Hospital pode receber R1 mesmo sendo filantrópico?", resposta: "Pode, compra é direta, sem licitação." },
  resposta: { status: "executou", detalhe: "Anotado; entra no próximo envio diário." },
});
tarefa({
  operador: ANA, tipo: "pergunta", status: "cancelada", titulo: "Levantar contatos de compras no LinkedIn",
  criada_em: atras(80), origem: "operador", criada_por: ANA, motivo: "outro", detalhe: "Cancelada pelo operador: LinkedIn sem API.",
  payload: { instrucao: "Levantar contatos de compras dos frios via LinkedIn." },
});
tarefa({
  operador: BRU, tipo: "acompanhamento", status: "pendente", dominio: "construtora-beta.example",
  titulo: "Ligar para Construtora Beta sobre a proposta", criada_em: atras(0.1), origem: "sistema", criada_por: "tick",
  payload: { instrucao: "Gerar tarefa humana: ligação de follow-up da proposta.", tarefa_humana: true },
});

// -------------------------------------------------------------------- relatos
function relato(d) {
  const r = { id: uid("r"), operador: ANA, tipo: "info", titulo: "", corpo: "", dominio: null, tarefa_id: null, urgente: false,
    criado_em: agora(), lido_em: null, resposta: null, respondido_em: null, respondido_por: null, ...d };
  db.relatos.push(r);
  evento("relato", r.id, "criado", `Relato (${r.tipo}): ${r.titulo}`, { criado_em: r.criado_em, ator: `bot:${nomeOp(r.operador)}`, ator_tipo: "bot", operador: r.operador, dominio: r.dominio });
  return r;
}
relato({ tipo: "pedido_autorizacao", urgente: true, dominio: "acme.example", titulo: "Acme pediu orçamento de 200 unidades",
  corpo: "O comprador da Acme respondeu pedindo orçamento dos itens da página 4 (200 un.).\n\nPelas diretrizes eu não informo preço. Posso responder agradecendo e dizendo que a Ana envia o orçamento hoje?",
  criado_em: atras(0.25) });
relato({ tipo: "pergunta", dominio: "textil-epsilon.example", titulo: "Têxtil Épsilon perguntou prazo de pagamento",
  corpo: "Perguntaram se trabalhamos com 60 dias. Bloqueei a tarefa (condição comercial). Como quer seguir?",
  criado_em: atras(19.6) });
relato({ tipo: "alerta", operador: CAR, dominio: "ferragens-omega.example", titulo: "Bounce em ferragens-omega.com.br",
  corpo: "O R2 voltou com 'caixa cheia'. Montei um reenvio para suprimentos@ (não conta no teto).", criado_em: atras(27), lido_em: atras(20) });
relato({ tipo: "info", operador: BRU, titulo: "Teto diário atingido às 9h12",
  corpo: "Dois candidatos ficaram para amanhã. Se quiser, aumente o teto_frios nas suas regras.", criado_em: atras(4.1) });
relato({ tipo: "pergunta", operador: CAR, dominio: "hospital-iota.example", titulo: "Hospital filantrópico conta como licitação?",
  corpo: "Hospital Iota é filantrópico. Posso mandar R1 ou trato como órgão público?", criado_em: atras(72), lido_em: atras(71),
  resposta: "Pode, compra é direta, sem licitação.", respondido_em: atras(70), respondido_por: CAR });
relato({ tipo: "alerta", urgente: true, operador: BRU, dominio: "construtora-beta.example", titulo: "Construtora Beta quer cotação até sexta",
  corpo: "Lead qualificado pediu cotação da obra Zona Sul com prazo até sexta. É com você, Bruno.", criado_em: atras(0.7) });
relato({ tipo: "info", titulo: "Proposta de diretriz enviada", corpo: "Mandei uma proposta de ajuste na cadência (redirect de auto-reply no mesmo dia). Detalhes em Diretrizes.", criado_em: atras(3) });

// ----------------------------------------------------------------- campainhas
function campainha(d) {
  const c = { id: uid("c"), operador: ANA, nome: "", tipo: "dominio", padrao: "", caixa: ANA, prioridade: "urgente", instrucao: "",
    dominio_lead: null, ativa: true, criada_por: ANA, criada_em: atras(100), arquivada_em: null, arquivada_por: null,
    expira_em: null, disparos: 0, ultimo_disparo_em: null, ...d };
  db.campainhas.push(c);
  db.disparos[c.id] = [];
  for (let k = 0; k < c.disparos; k++) {
    db.disparos[c.id].push({ id: uid("d"), message_id: `<m${k}@${c.dominio_lead || "exemplo.example"}>`, de: `contato@${c.dominio_lead || "exemplo.example"}`,
      assunto: k === 0 ? "Cotação obra Zona Sul" : "Re: catálogo", trecho: "Mensagem que tocou a campainha.", recebido_em: atras(0.8 + k * 30), tarefa_id: k === 0 ? tCamp.id : null });
  }
  evento("campainha", c.id, "criada", `Campainha criada: ${c.nome}`, { criado_em: c.criada_em, ator: c.criada_por, ator_tipo: c.criada_por.startsWith("bot") ? "bot" : "operador", operador: c.operador });
  return c;
}
campainha({ nome: "Construtora Beta (qualquer e-mail)", padrao: "construtora-beta.example", dominio_lead: "construtora-beta.example",
  instrucao: "Lead qualificado: avisar na hora e não responder sozinho.", disparos: 3, ultimo_disparo_em: atras(0.8) });
campainha({ nome: "Orçamento no assunto", tipo: "assunto", padrao: "orçamento|cotação", prioridade: "urgente",
  instrucao: "Qualquer e-mail com orçamento/cotação no assunto vira tarefa urgente.", criada_por: "bot:Ana", criada_em: atras(60), disparos: 1, ultimo_disparo_em: atras(30) });
campainha({ operador: BRU, caixa: BRU, nome: "Comprador da Agro Teta", tipo: "remetente", padrao: "compras@agro-teta.example", dominio_lead: "agro-teta.example",
  prioridade: "normal", instrucao: "Respondeu ao R2; acompanhar.", criada_por: "bot:Bruno", expira_em: adiante(24 * 20) });
campainha({ operador: CAR, caixa: CAR, nome: "Eletro Sigma (proposta)", padrao: "eletro-sigma.example", dominio_lead: "eletro-sigma.example",
  instrucao: "Proposta enviada; qualquer resposta é urgente.", criada_por: CAR, disparos: 1, ultimo_disparo_em: atras(30) });
campainha({ nome: "Feira de outubro", tipo: "assunto", padrao: "feira", prioridade: "normal", ativa: false, instrucao: "Desligada até a próxima feira.", criada_por: "bot:Ana" });
campainha({ operador: BRU, caixa: BRU, nome: "Química Zeta (antiga)", padrao: "quimica-zeta.example", ativa: false, arquivada_em: atras(200), arquivada_por: BRU, criada_por: BRU });

// ----------------------------------------------------------- acompanhamentos
function acompanhamento(d) {
  const a = { id: uid("a"), operador: ANA, dominio: null, titulo: "", instrucao: "", agendado_para: adiante(24), repetir_dias: null,
    status: "agendado", criado_por: ANA, criado_em: atras(48), ultimo_disparo_em: null, tarefa_id: null, arquivado_em: null, ...d };
  db.acompanhamentos.push(a);
  evento("acompanhamento", a.id, "criado", `Acompanhamento criado: ${a.titulo}`, { criado_em: a.criado_em, ator: a.criado_por, ator_tipo: a.criado_por.startsWith("bot") ? "bot" : "operador", operador: a.operador, dominio: a.dominio });
  return a;
}
acompanhamento({ dominio: "exemplo.example", titulo: "Retomar depois da feira", instrucao: "Mandar R3 curto lembrando do catálogo.", agendado_para: adiante(46), criado_por: "bot:Ana" });
acompanhamento({ titulo: "Revisar teto diário toda segunda", instrucao: "Olhar os bloqueios da semana e sugerir ajuste de teto.", agendado_para: adiante(80), repetir_dias: 7, criado_por: ANA });
acompanhamento({ operador: BRU, dominio: "construtora-beta.example", titulo: "Ligar sobre a proposta", instrucao: "Tarefa humana: ligação de follow-up.", agendado_para: atras(0.1), status: "disparado", ultimo_disparo_em: atras(0.1), criado_por: BRU });
acompanhamento({ operador: CAR, dominio: "eletro-sigma.example", titulo: "Checar se a proposta virou pedido", instrucao: "Consultar o ERP e, se não virou, perguntar ao comprador.", agendado_para: adiante(72), criado_por: "bot:Carla" });
acompanhamento({ operador: CAR, dominio: "hospital-iota.example", titulo: "Primeiro contato com Hospital Iota", instrucao: "Incluir no envio diário.", agendado_para: atras(60), status: "concluido", ultimo_disparo_em: atras(60), criado_por: "bot:Carla" });
acompanhamento({ dominio: "usina-delta.example", titulo: "Ver se o site da Usina voltou", instrucao: "Se voltou, buscar contato de compras.", agendado_para: adiante(120), status: "cancelado", criado_por: "bot:Ana" });

// ---------------------------------------------------------------- diretrizes
const DIR_PADRAO = `# Diretrizes do bot (padrão)

## Objetivo
- Fazer o lead pedir orçamento.

## Nunca
- Informar preço, prazo, condição comercial ou desconto.
- Insistir depois de um "não me contate mais": marcar descartado.

## Cadência
- R1, R2 e R3 com 5 dias úteis de intervalo.
- Depois do R3 sem resposta, propor descarte.

## Registro
- Toda decisão vai para /acoes com proxima_acao_em.`;

const DIR_LEO_V1 = `# Diretrizes do bot (Ana)

## Objetivo
- Fazer o lead pedir orçamento.

## Nunca
- Informar preço, prazo, condição comercial ou desconto.
- Insistir depois de um "não me contate mais": marcar descartado.

## Tom
- Direto e cordial, sem jargão.

## Cadência
- R1, R2 e R3 com 5 dias úteis de intervalo.
- Depois do R3 sem resposta, propor descarte.`;

const DIR_LEO_V2 = `# Diretrizes do bot (Ana)

## Objetivo
- Fazer o lead pedir orçamento.

## Nunca
- Informar preço, prazo, condição comercial ou desconto.
- Insistir depois de um "não me contate mais": marcar descartado.

## Tom
- Direto e cordial, sem jargão.
- Assinar como Ana, Nortec Distribuidora.

## Cadência
- R1, R2 e R3 com 5 dias úteis de intervalo.
- Depois do R3 sem resposta, propor descarte.

## Licitação
- Órgão público que só compra por licitação: não enviar, registrar e seguir.`;

const DIR_LEO_V3 = `# Diretrizes do bot (Ana)

## Objetivo
- Fazer o lead pedir orçamento.

## Nunca
- Informar preço, prazo, condição comercial ou desconto.
- Insistir depois de um "não me contate mais": marcar descartado.

## Tom
- Direto e cordial, sem jargão.
- Assinar como Ana, Nortec Distribuidora.

## Cadência
- R1, R2 e R3 com 5 dias úteis de intervalo.
- Auto-reply que indica outro contato: redirect no mesmo dia (não conta no teto).
- Depois do R3 sem resposta, propor descarte.

## Licitação
- Órgão público que só compra por licitação: não enviar, registrar e seguir.`;

function diretriz(d) {
  const x = { id: uid("dir"), operador: null, versao: 1, status: "ativa", conteudo: "", regras: clone(REGRAS_PADRAO), autor: ANA, autor_tipo: "operador",
    motivo: null, base_versao: null, decidida_por: null, decidida_em: null, nota_decisao: null, criada_em: atras(500), ...d };
  db.diretrizes.push(x);
  evento("diretriz", x.id, x.status === "proposta" ? "proposta" : "publicada", `Diretriz v${x.versao} (${x.operador ? nomeOp(x.operador) : "padrão"}): ${x.status}`,
    { criado_em: x.criada_em, ator: x.autor, ator_tipo: x.autor_tipo, operador: x.operador });
  return x;
}
diretriz({ operador: null, versao: 1, conteudo: DIR_PADRAO, criada_em: atras(900) });
diretriz({ operador: ANA, versao: 1, status: "substituida", conteudo: DIR_LEO_V1, criada_em: atras(600) });
diretriz({ operador: ANA, versao: 2, status: "ativa", conteudo: DIR_LEO_V2, base_versao: 1, criada_em: atras(200), motivo: "Incluí licitação e assinatura." });
diretriz({ operador: ANA, versao: 3, status: "proposta", conteudo: DIR_LEO_V3, base_versao: 2, autor: "bot:Ana", autor_tipo: "bot",
  regras: { ...clone(REGRAS_PADRAO), contam_no_teto: ["R1", "R2", "R3"], teto_respondeu: 6 },
  motivo: "Três leads mandaram auto-reply de férias indicando outro contato. Esperar o ciclo normal atrasou o contato em cerca de uma semana. Proponho fazer o redirect no mesmo dia e subir o teto de 'respondeu' de 5 para 6.",
  criada_em: atras(3) });
diretriz({ operador: BRU, versao: 1, status: "ativa", conteudo: DIR_PADRAO.replace("(padrão)", "(Bruno)"), regras: { ...clone(REGRAS_PADRAO), teto_frios: 15 }, autor: BRU, criada_em: atras(300) });
diretriz({ operador: CAR, versao: 1, status: "rejeitada", conteudo: DIR_PADRAO.replace("(padrão)", "(Carla)").replace("5 dias úteis", "3 dias úteis"),
  base_versao: null, autor: "bot:Carla", autor_tipo: "bot", motivo: "Leads de hospital respondem rápido; encurtar o intervalo.",
  decidida_por: CAR, decidida_em: atras(100), nota_decisao: "Prefiro manter 5 dias; hospital também recebe muito e-mail.", criada_em: atras(110) });

// ------------------------------------------------------------- simulação viva
// Tarefas criadas pelo painel neste acesso (nova tarefa, resposta a relato, reenviar)
// andam um passo a cada ~15 s, quando o painel consulta /painel: assim dá para ver o
// polling funcionando sem bagunçar os exemplos iniciais.
const simuladas = new Set();
let ultimaSimulacao = Date.now();
function simular() {
  if (Date.now() - ultimaSimulacao < 14000) return;
  ultimaSimulacao = Date.now();
  const bot = (t) => `bot:${nomeOp(t.operador)}`;
  const simuladasAgora = db.tarefas.filter((t) => simuladas.has(t.id));
  const emAndamento = simuladasAgora.find((t) => t.status === "em_andamento");
  const entregue = simuladasAgora.find((t) => t.status === "entregue");
  const pendente = simuladasAgora.find((t) => t.status === "pendente");
  if (pendente) {
    pendente.status = "entregue"; pendente.entregue_em = agora();
    evento("tarefa", pendente.id, "entregue", "Webhook do bot respondeu 2xx", { ator: "sistema", ator_tipo: "sistema", operador: pendente.operador, dominio: pendente.dominio });
  } else if (entregue) {
    entregue.status = "em_andamento"; entregue.iniciada_em = agora();
    evento("tarefa", entregue.id, "iniciada", "Bot iniciou a tarefa", { ator: bot(entregue), ator_tipo: "bot", operador: entregue.operador, dominio: entregue.dominio });
  } else if (emAndamento) {
    emAndamento.status = "executou"; emAndamento.concluida_em = agora();
    emAndamento.resposta = { status: "executou", detalhe: "Concluída na simulação do modo demonstração." };
    simuladas.delete(emAndamento.id);
    evento("tarefa", emAndamento.id, "resultado", "Bot devolveu: executou", { ator: bot(emAndamento), ator_tipo: "bot", operador: emAndamento.operador, dominio: emAndamento.dominio });
  }
}

// --------------------------------------------------------------------- rotas
const porOp = (lista, operador, campo = "operador") => (operador ? lista.filter((x) => x[campo] === operador) : lista);
const recentes = (lista, campo) => [...lista].sort((a, b) => String(b[campo] || "").localeCompare(String(a[campo] || "")));
const achar = (lista, id, nome) => {
  const x = lista.find((i) => i.id === id);
  if (!x) throw new ApiError(404, `${nome} não encontrado(a)`);
  return x;
};
const exigir = (cond, msg, status = 422) => { if (!cond) throw new ApiError(status, msg); };
const ABERTOS = ["pendente", "entregue", "em_andamento", "bloqueado_humano", "adiou"];
const hoje = () => new Date().toDateString();

function criarTarefaManual(b, extra = {}) {
  exigir(b.titulo, "titulo é obrigatório");
  const t = {
    id: uid("t"), operador: b.operador || EU.email, tipo: b.tipo || "pergunta", status: "pendente", prioridade: b.prioridade || "normal",
    titulo: b.titulo, dominio: b.dominio || null, payload: { instrucao: b.instrucao || "", ...(b.payload || {}) }, resposta: null, motivo: null, detalhe: null,
    origem: "operador", criada_por: EU.email, criada_em: agora(), entregue_em: null, iniciada_em: null, concluida_em: null,
    reagendar_em: null, prazo: b.prazo || null, tentativas_entrega: 0, ultimo_erro_entrega: null,
    origem_ref: { campainha_id: null, acompanhamento_id: null, relato_id: null }, ...extra,
  };
  db.tarefas.push(t);
  simuladas.add(t.id);
  evento("tarefa", t.id, "criada", `Tarefa criada: ${t.titulo}`, { operador: t.operador, dominio: t.dominio });
  return t;
}

const rotas = [
  ["GET", /^\/saude$/, () => ({ ok: true, versao: "mock" })],
  ["GET", /^\/eu$/, () => EU],
  ["GET", /^\/operadores$/, () => db.operadores],
  ["PATCH", /^\/operadores\/([^/]+)$/, ({ p, b }) => {
    const o = db.operadores.find((x) => x.email === p[0]);
    exigir(o, "operador não encontrado", 404);
    for (const k of ["regras", "bcc", "caixa"]) if (k in b) o[k] = b[k];
    evento("operador", o.email, "alterado", `Configuração de ${o.nome} alterada`, { operador: o.email });
    return o;
  }],

  ["GET", /^\/painel$/, ({ q }) => {
    simular();
    const op = q.operador;
    const leads = porOp(db.leads, op, "dono_email");
    const por_estagio = {};
    for (const l of leads) por_estagio[l.estagio_funil] = (por_estagio[l.estagio_funil] || 0) + 1;
    const tarefas = porOp(db.tarefas, op);
    const enviosHoje = porOp(db.envios, op).filter((e) => new Date(e.criado_em).toDateString() === hoje() || (e.enviado_em && new Date(e.enviado_em).toDateString() === hoje()));
    const envios_hoje = { total: enviosHoje.length };
    for (const e of enviosHoje) envios_hoje[e.status] = (envios_hoje[e.status] || 0) + 1;
    return {
      total: leads.length,
      por_estagio,
      tarefas_abertas: tarefas.filter((t) => ABERTOS.includes(t.status)).length,
      tarefas_urgentes: tarefas.filter((t) => ABERTOS.includes(t.status) && t.prioridade === "urgente").length,
      relatos_nao_lidos: porOp(db.relatos, op).filter((r) => !r.lido_em).length,
      diretrizes_propostas: porOp(db.diretrizes, op).filter((d) => d.status === "proposta").length,
      envios_hoje,
    };
  }],
  ["GET", /^\/eventos$/, ({ q }) => {
    let l = porOp(db.eventos, q.operador);
    if (q.entidade) l = l.filter((e) => e.entidade === q.entidade);
    return { eventos: recentes(l, "criado_em").slice(0, Number(q.limite) || 200) };
  }],

  // tarefas
  ["GET", /^\/tarefas$/, ({ q }) => {
    let l = porOp(db.tarefas, q.operador);
    if (q.status) { const s = q.status.split(","); l = l.filter((t) => s.includes(t.status)); }
    if (q.tipo) l = l.filter((t) => t.tipo === q.tipo);
    if (q.dominio) l = l.filter((t) => t.dominio === q.dominio);
    if (q.desde) l = l.filter((t) => t.criada_em >= q.desde);
    const contagem = {};
    for (const t of l) contagem[t.status] = (contagem[t.status] || 0) + 1;
    return { tarefas: recentes(l, "criada_em").slice(0, Number(q.limite) || 200), contagem };
  }],
  ["GET", /^\/tarefas\/([^/]+)$/, ({ p }) => {
    const t = achar(db.tarefas, p[0], "tarefa");
    return { ...t, eventos: db.eventos.filter((e) => e.entidade === "tarefa" && e.entidade_id === t.id).sort((a, b) => a.criado_em.localeCompare(b.criado_em)),
      envios: db.envios.filter((e) => e.tarefa_id === t.id) };
  }],
  ["POST", /^\/tarefas$/, ({ b }) => {
    exigir(b.operador && b.tipo, "operador e tipo são obrigatórios");
    return criarTarefaManual(b);
  }],
  ["POST", /^\/tarefas\/([^/]+)\/cancelar$/, ({ p, b }) => {
    const t = achar(db.tarefas, p[0], "tarefa");
    exigir(!["executou", "parcial", "cancelada"].includes(t.status), `tarefa já está ${t.status}`, 409);
    t.status = "cancelada"; t.motivo = "outro"; t.detalhe = b.motivo || "Cancelada pelo operador"; t.concluida_em = agora();
    evento("tarefa", t.id, "cancelada", `Cancelada: ${t.detalhe}`, { operador: t.operador, dominio: t.dominio });
    return t;
  }],
  ["POST", /^\/tarefas\/([^/]+)\/reenviar$/, ({ p }) => {
    const t = achar(db.tarefas, p[0], "tarefa");
    exigir(!["em_andamento", "executou", "parcial"].includes(t.status), `tarefa ${t.status} não pode ser reenviada`, 409);
    t.status = "pendente"; t.tentativas_entrega = 0; t.ultimo_erro_entrega = null; t.entregue_em = null; t.iniciada_em = null; t.concluida_em = null;
    simuladas.add(t.id);
    evento("tarefa", t.id, "reenviada", "Reenviada pelo operador (volta para pendente)", { operador: t.operador, dominio: t.dominio });
    return t;
  }],

  // envios
  ["GET", /^\/envios$/, ({ q }) => {
    let l = porOp(db.envios, q.operador);
    if (q.status) { const s = q.status.split(","); l = l.filter((e) => s.includes(e.status)); }
    if (q.desde) l = l.filter((e) => e.criado_em >= q.desde);
    return { envios: recentes(l, "criado_em") };
  }],
  ["POST", /^\/envios\/([^/]+)\/liberar$/, ({ p, b }) => {
    const e = achar(db.envios, p[0], "envio");
    exigir(e.status === "bloqueado", "só envio bloqueado pode ser liberado", 409);
    e.status = "aprovado"; e.liberado_por = EU.email; e.liberado_em = agora(); e.nota_liberacao = b.nota || null;
    evento("envio", e.id, "liberado", `Envio para ${e.dominio} liberado (exceção humana: ${e.motivo_bloqueio})`, { operador: e.operador, dominio: e.dominio, dados: { nota: b.nota || null } });
    return e;
  }],
  ["POST", /^\/envios\/([^/]+)\/cancelar$/, ({ p }) => {
    const e = achar(db.envios, p[0], "envio");
    exigir(["aprovado", "agendado", "bloqueado"].includes(e.status), `envio ${e.status} não pode ser cancelado`, 409);
    e.status = "cancelado";
    evento("envio", e.id, "cancelado", `Envio para ${e.dominio} cancelado`, { operador: e.operador, dominio: e.dominio });
    return e;
  }],

  // campainhas
  ["GET", /^\/campainhas$/, ({ q }) => {
    let l = porOp(db.campainhas, q.operador);
    if (q.ativas === "1") l = l.filter((c) => c.ativa && !c.arquivada_em);
    return { campainhas: recentes(l, "criada_em") };
  }],
  ["POST", /^\/campainhas$/, ({ b }) => {
    exigir(b.nome && b.padrao, "nome e padrao são obrigatórios");
    const c = { id: uid("c"), operador: b.operador || EU.email, nome: b.nome, tipo: b.tipo || "dominio", padrao: b.padrao, caixa: b.caixa || b.operador || EU.email,
      prioridade: b.prioridade || "urgente", instrucao: b.instrucao || "", dominio_lead: b.dominio_lead || null, ativa: b.ativa ?? true,
      criada_por: EU.email, criada_em: agora(), arquivada_em: null, arquivada_por: null, expira_em: b.expira_em || null, disparos: 0, ultimo_disparo_em: null };
    db.campainhas.push(c); db.disparos[c.id] = [];
    evento("campainha", c.id, "criada", `Campainha criada: ${c.nome}`, { operador: c.operador });
    return c;
  }],
  ["PATCH", /^\/campainhas\/([^/]+)$/, ({ p, b }) => {
    const c = achar(db.campainhas, p[0], "campainha");
    for (const k of ["nome", "tipo", "padrao", "caixa", "prioridade", "instrucao", "dominio_lead", "ativa", "expira_em"]) if (k in b) c[k] = b[k];
    const resumo = Object.keys(b).length === 1 && "ativa" in b ? (b.ativa ? "ativada" : "desativada") : "editada";
    evento("campainha", c.id, resumo, `Campainha ${resumo}: ${c.nome}`, { operador: c.operador });
    return c;
  }],
  ["DELETE", /^\/campainhas\/([^/]+)$/, ({ p }) => {
    const c = achar(db.campainhas, p[0], "campainha");
    c.ativa = false; c.arquivada_em = agora(); c.arquivada_por = EU.email;
    evento("campainha", c.id, "arquivada", `Campainha arquivada: ${c.nome}`, { operador: c.operador });
    return c;
  }],
  ["GET", /^\/campainhas\/([^/]+)\/disparos$/, ({ p }) => ({ disparos: recentes(db.disparos[p[0]] || [], "recebido_em") })],

  // acompanhamentos
  ["GET", /^\/acompanhamentos$/, ({ q }) => ({ acompanhamentos: [...porOp(db.acompanhamentos, q.operador)].sort((a, b) => a.agendado_para.localeCompare(b.agendado_para)) })],
  ["POST", /^\/acompanhamentos$/, ({ b }) => {
    exigir(b.titulo && b.agendado_para, "titulo e agendado_para são obrigatórios");
    const a = { id: uid("a"), operador: b.operador || EU.email, dominio: b.dominio || null, titulo: b.titulo, instrucao: b.instrucao || "",
      agendado_para: b.agendado_para, repetir_dias: b.repetir_dias || null, status: "agendado", criado_por: EU.email, criado_em: agora(),
      ultimo_disparo_em: null, tarefa_id: null, arquivado_em: null };
    db.acompanhamentos.push(a);
    evento("acompanhamento", a.id, "criado", `Acompanhamento criado: ${a.titulo}`, { operador: a.operador, dominio: a.dominio });
    return a;
  }],
  ["PATCH", /^\/acompanhamentos\/([^/]+)$/, ({ p, b }) => {
    const a = achar(db.acompanhamentos, p[0], "acompanhamento");
    for (const k of ["dominio", "titulo", "instrucao", "agendado_para", "repetir_dias", "status"]) if (k in b) a[k] = b[k];
    evento("acompanhamento", a.id, "editado", `Acompanhamento alterado: ${a.titulo}${b.status ? ` (${b.status})` : ""}`, { operador: a.operador, dominio: a.dominio });
    return a;
  }],
  ["DELETE", /^\/acompanhamentos\/([^/]+)$/, ({ p }) => {
    const a = achar(db.acompanhamentos, p[0], "acompanhamento");
    a.arquivado_em = agora(); if (a.status === "agendado") a.status = "cancelado";
    evento("acompanhamento", a.id, "arquivado", `Acompanhamento arquivado: ${a.titulo}`, { operador: a.operador, dominio: a.dominio });
    return a;
  }],

  // relatos
  ["GET", /^\/relatos$/, ({ q }) => {
    let l = porOp(db.relatos, q.operador);
    if (q.nao_lidos === "1") l = l.filter((r) => !r.lido_em);
    return { relatos: recentes(l, "criado_em") };
  }],
  ["POST", /^\/relatos\/([^/]+)\/lido$/, ({ p }) => {
    const r = achar(db.relatos, p[0], "relato");
    if (!r.lido_em) { r.lido_em = agora(); evento("relato", r.id, "lido", `Relato lido: ${r.titulo}`, { operador: r.operador, dominio: r.dominio }); }
    return r;
  }],
  ["POST", /^\/relatos\/([^/]+)\/responder$/, ({ p, b }) => {
    const r = achar(db.relatos, p[0], "relato");
    exigir((b.resposta || "").trim(), "resposta vazia");
    r.resposta = b.resposta; r.respondido_em = agora(); r.respondido_por = EU.email; r.lido_em = r.lido_em || agora();
    const t = criarTarefaManual({ operador: r.operador, tipo: "resposta_operador", titulo: `Resposta ao relato: ${r.titulo}`, dominio: r.dominio,
      payload: { relato_id: r.id, relato: r.titulo, resposta: b.resposta } }, { origem_ref: { campainha_id: null, acompanhamento_id: null, relato_id: r.id } });
    evento("relato", r.id, "respondido", `Relato respondido: ${r.titulo}`, { operador: r.operador, dominio: r.dominio });
    return { ...r, tarefa_id: t.id };
  }],

  // diretrizes
  ["GET", /^\/diretrizes$/, ({ q }) => {
    const l = q.operador ? db.diretrizes.filter((d) => d.operador === q.operador || d.operador === null) : db.diretrizes;
    return { diretrizes: recentes(l, "criada_em") };
  }],
  ["GET", /^\/diretrizes\/([^/]+)$/, ({ p }) => achar(db.diretrizes, p[0], "diretriz")],
  ["POST", /^\/diretrizes$/, ({ b }) => {
    exigir(b.conteudo, "conteudo é obrigatório");
    const op = b.operador === undefined ? EU.email : b.operador;
    const doOp = db.diretrizes.filter((d) => d.operador === op);
    const ativa = doOp.find((d) => d.status === "ativa");
    const versao = Math.max(0, ...doOp.map((d) => d.versao)) + 1;
    if (ativa) ativa.status = "substituida";
    const d = { id: uid("dir"), operador: op, versao, status: "ativa", conteudo: b.conteudo, regras: b.regras || ativa?.regras || clone(REGRAS_PADRAO),
      autor: EU.email, autor_tipo: "operador", motivo: b.motivo || null, base_versao: ativa?.versao ?? null, decidida_por: EU.email, decidida_em: agora(),
      nota_decisao: null, criada_em: agora() };
    db.diretrizes.push(d);
    evento("diretriz", d.id, "publicada", `Diretriz v${versao} publicada`, { operador: op });
    return d;
  }],
  ["POST", /^\/diretrizes\/([^/]+)\/aprovar$/, ({ p, b }) => {
    const d = achar(db.diretrizes, p[0], "diretriz");
    exigir(d.status === "proposta", "só proposta pode ser aprovada", 409);
    const ativa = db.diretrizes.find((x) => x.operador === d.operador && x.status === "ativa");
    if (ativa) ativa.status = "substituida";
    d.status = "ativa"; d.decidida_por = EU.email; d.decidida_em = agora(); d.nota_decisao = b.nota || null;
    const o = db.operadores.find((x) => x.email === d.operador);
    if (o && d.regras) o.regras = clone(d.regras);
    evento("diretriz", d.id, "aprovada", `Diretriz v${d.versao} aprovada`, { operador: d.operador });
    return d;
  }],
  ["POST", /^\/diretrizes\/([^/]+)\/rejeitar$/, ({ p, b }) => {
    const d = achar(db.diretrizes, p[0], "diretriz");
    exigir(d.status === "proposta", "só proposta pode ser rejeitada", 409);
    d.status = "rejeitada"; d.decidida_por = EU.email; d.decidida_em = agora(); d.nota_decisao = b.nota || null;
    evento("diretriz", d.id, "rejeitada", `Diretriz v${d.versao} rejeitada`, { operador: d.operador });
    return d;
  }],

  // leads
  ["GET", /^\/leads$/, ({ q }) => {
    let l = porOp(db.leads, q.operador, "dono_email");
    if (q.estagio) l = l.filter((x) => x.estagio_funil === q.estagio);
    if (q.teve_resposta === "1") l = l.filter((x) => x.teve_resposta);
    if (q.teve_resposta === "0") l = l.filter((x) => !x.teve_resposta);
    if (q.busca) { const s = q.busca.toLowerCase(); l = l.filter((x) => x.dominio.includes(s) || (x.empresa || "").toLowerCase().includes(s)); }
    const campo = q.ordenar || "ultimo_envio";
    const cres = q.crescente === "1";
    l = [...l].sort((a, b) => {
      const va = a[campo]; const vb = b[campo];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return cres ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
    const offset = Number(q.offset) || 0;
    const limite = Number(q.limite) || 200;
    return { leads: l.slice(offset, offset + limite), total: l.length, limite, offset };
  }],
  ["GET", /^\/leads\/([^/]+)$/, ({ p }) => {
    const lead = leadPorDominio(p[0]);
    exigir(lead, "lead não encontrado", 404);
    return {
      lead,
      contatos: db.contatos[lead.dominio] || [],
      interacoes: recentes(db.interacoes[lead.dominio] || [], "data_interacao"),
      acoes: recentes(db.acoes[lead.dominio] || [], "criado_em"),
      tarefas: recentes(db.tarefas.filter((t) => t.dominio === lead.dominio), "criada_em"),
    };
  }],
  ["POST", /^\/leads\/([^/]+)\/estagio$/, ({ p, b }) => {
    const lead = leadPorDominio(p[0]);
    exigir(lead, "lead não encontrado", 404);
    exigir(b.estagio_funil, "estagio_funil é obrigatório");
    const antes = lead.estagio_funil;
    lead.estagio_funil = b.estagio_funil;
    if ("proximo_followup_em" in b) lead.proximo_followup_em = b.proximo_followup_em;
    if ("observacao" in b) lead.observacao = b.observacao;
    lead.atualizado_em = agora();
    evento("lead", lead.id, "estagio", `${lead.dominio}: ${antes} → ${lead.estagio_funil}`, { operador: lead.dono_email, dominio: lead.dominio });
    return { ok: true, dominio: lead.dominio, estagio_funil: lead.estagio_funil };
  }],
];


// ---------------------------------------------------------------- diário (mock)
// Gera um dia fictício e estável (mesmo dia = mesmos cartões) a partir dos leads.
function rnd(semente) {
  let x = 0;
  for (const c of semente) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return () => ((x = (x * 1103515245 + 12345) >>> 0) / 4294967296);
}
function diarioMock(dia, op) {
  const r = rnd(`${dia}|${op || ""}`);
  const sem = new Date(`${dia}T12:00:00`).getDay();
  const leads = porOp(db.leads, op, "dono_email");
  if (!leads.length) return [];
  const n = sem === 0 || sem === 6 ? Math.floor(r() * 3) : 8 + Math.floor(r() * 14);
  const itens = [];
  for (let i = 0; i < n; i++) {
    const l = leads[Math.floor(r() * leads.length)];
    const h = 8 + Math.floor(r() * 9), m = Math.floor(r() * 60);
    const em = new Date(`${dia}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`).toISOString();
    const base = { id: `mock:${dia}:${i}`, em, dominio: l.dominio, empresa: l.empresa, operador: l.dono_email, origem: "acao" };
    const k = r();
    if (k < 0.55) {
      const rod = 1 + Math.floor(r() * 3);
      itens.push({ ...base, tipo: "email_enviado", rodada: rod, titulo: `R${rod}`, para: `compras@${l.dominio}`,
        assunto: `${l.empresa.split(" ")[0]}: ${rod === 1 ? "cadastro de fornecedor" : "seguindo nosso contato"}`,
        detalhe: rod === 1 ? "apresentação + gancho de segmento + catálogo" : "ângulo novo na mesma conversa" });
    } else if (k < 0.72) {
      const real = r() < 0.3;
      itens.push({ ...base, origem: "interacao", tipo: "resposta", de: `contato@${l.dominio}`, interesse: real ? "real" : "generico",
        titulo: real ? "interesse real" : "resposta", assunto: "RE: cadastro de fornecedor",
        trecho: real ? "Pode nos enviar o catálogo e uma cotação para os itens abaixo?" : "Obrigado, encaminhei ao setor de compras." });
    } else if (k < 0.82) {
      itens.push({ ...base, tipo: "bounce", titulo: "e-mail não entregue", para: `antigo@${l.dominio}`, detalhe: "550 mailbox unavailable" });
    } else if (k < 0.94) {
      itens.push({ ...base, tipo: "nota", titulo: "nota", detalhe: "Lead pediu retorno em novembro; follow-up ajustado." });
    } else {
      itens.push({ ...base, tipo: "decisao", titulo: "adiou", detalhe: "contexto_lead – licitação em andamento, retomar depois" });
    }
  }
  return itens.sort((a, b) => b.em.localeCompare(a.em));
}
function resumoMock(itens) {
  const c = (t) => itens.filter((x) => x.tipo === t).length;
  return { emails_enviados: c("email_enviado"), rodadas: itens.filter((x) => x.tipo === "email_enviado" && x.rodada).length,
    respostas: c("resposta"), interesse_real: itens.filter((x) => x.interesse === "real").length, bounces: c("bounce"),
    notas: c("nota"), decisoes: c("decisao"), tarefas: 0, outros: 0 };
}
rotas.push(
  ["GET", /^\/diario$/, ({ q }) => {
    const dia = q.dia || new Date().toISOString().slice(0, 10);
    const itens = diarioMock(dia, q.operador);
    return { dia, operador: q.operador || null, resumo: resumoMock(itens), itens };
  }],
  ["GET", /^\/diario\/dias$/, ({ q }) => {
    const n = Number(q.dias) || 30;
    const dias = [];
    for (let k = n - 1; k >= 0; k--) {
      const d = new Date(); d.setDate(d.getDate() - k);
      const dia = d.toISOString().slice(0, 10);
      const it = diarioMock(dia, q.operador);
      dias.push({ dia, emails: it.filter((x) => x.tipo === "email_enviado").length,
        respostas: it.filter((x) => x.tipo === "resposta").length, bounces: it.filter((x) => x.tipo === "bounce").length });
    }
    return { dias };
  }],
);

// ---------------------------------------------------------------- board (mock)
// Números fictícios, estáveis e na escala de uma prospecção real de poucas semanas.
const BASE_BOARD = {
  [ANA]: { carteira: 327, prospectados: 231, responderam: 26, real: 15, qualificados: 12, propostas: 3, convertidos: 1, conv_carteira: 9, ritmo: 14 },
  [BRU]: { carteira: 244, prospectados: 148, responderam: 17, real: 9, qualificados: 7, propostas: 2, convertidos: 1, conv_carteira: 12, ritmo: 9 },
  [CAR]: { carteira: 134, prospectados: 86, responderam: 8, real: 5, qualificados: 4, propostas: 1, convertidos: 0, conv_carteira: 10, ritmo: 6 },
};
function boardMock(dias, op) {
  const ops = op ? [op] : Object.keys(BASE_BOARD);
  const soma = (k) => ops.reduce((t, o) => t + (BASE_BOARD[o]?.[k] || 0), 0);
  const ritmo = soma("ritmo");
  const serieDe = (n, desloc) => {
    const out = [];
    for (let k = n - 1; k >= 0; k--) {
      const d = new Date(); d.setDate(d.getDate() - k - desloc);
      const dia = d.toISOString().slice(0, 10);
      const r = rnd(`board|${dia}|${op || ""}`);
      const sem = d.getDay();
      const util = sem !== 0 && sem !== 6;
      const cresce = 0.55 + 0.45 * (1 - (k + desloc) / (n + desloc + 30));
      const emails = util ? Math.round(ritmo * cresce * (0.7 + r() * 0.6)) : 0;
      out.push({ dia, emails, respostas: Math.round(emails * (0.04 + r() * 0.1)), bounces: Math.round(emails * r() * 0.12) });
    }
    return out;
  };
  const serie = serieDe(dias, 0);
  const anteriorSerie = serieDe(dias, dias);
  const tot = (sr, k) => sr.reduce((t, d) => t + d[k], 0);
  const per = { emails: tot(serie, "emails"), respostas: tot(serie, "respostas"), bounces: tot(serie, "bounces") };
  const ant = { emails: tot(anteriorSerie, "emails"), respostas: tot(anteriorSerie, "respostas"), bounces: tot(anteriorSerie, "bounces") };
  per.interesse_real = Math.round(per.respostas * 0.45); ant.interesse_real = Math.round(ant.respostas * 0.4);
  per.novos_leads = Math.round(per.emails * 0.62); ant.novos_leads = Math.round(ant.emails * 0.7);
  const tx = (a, b) => (b ? Math.round((a / b) * 10000) / 10000 : null);
  const emailsTotal = Math.max(Math.round(soma("prospectados") * 1.52), per.emails + Math.round(ant.emails * 0.3));
  const bouncesTotal = Math.round(emailsTotal * 0.13);
  const f = (k) => soma(k);
  const estagios = { frio: 0, aquecendo: 0, respondeu: 0, qualificado: 0, proposta_enviada: 0, convertido: 0, descartado: 0 };
  ops.forEach((o) => {
    const b = BASE_BOARD[o];
    estagios.convertido += b.conv_carteira; estagios.qualificado += b.qualificados - b.propostas;
    estagios.proposta_enviada += b.propostas - b.convertidos; estagios.descartado += Math.round(b.carteira * 0.01);
    estagios.aquecendo += Math.round(b.carteira * 0.06);
    estagios.respondeu += Math.round(b.carteira * 0.42);
  });
  const total = soma("carteira");
  estagios.frio = total - Object.entries(estagios).reduce((t, [k, v]) => t + (k === "frio" ? 0 : v), 0);
  const quentes = db.leads.filter((l) => (!op || l.dono_email === op) && ["respondeu", "qualificado", "proposta_enviada", "aquecendo"].includes(l.estagio_funil))
    .map((l, i) => ({ dominio: l.dominio, empresa: l.empresa, operador: l.dono_email, estagio: l.estagio_funil,
      interesse: ["qualificado", "proposta_enviada"].includes(l.estagio_funil) || i % 3 === 0 ? "real" : "generico",
      respondeu_em: atras(6 + i * 19), assunto: `Re: Nortec Distribuidora | apresentação para ${l.empresa}`,
      trecho: i % 2 ? "Podem nos enviar o catálogo completo e uma cotação para os itens de manutenção?" : "Obrigado pelo contato, encaminhei ao setor de compras. Retornamos em breve.",
      proximo_followup_em: l.proximo_followup_em }))
    .sort((a, b) => (b.interesse === "real") - (a.interesse === "real")).slice(0, 8);
  const convertidos = db.leads.filter((l) => (!op || l.dono_email === op) && l.estagio_funil === "convertido")
    .map((l, i) => ({ dominio: l.dominio, empresa: l.empresa, operador: l.dono_email, em: atras(30 + i * 50) }));
  return {
    operador: op || null, dias, de: serie[0].dia, ate: serie[serie.length - 1].dia, inicio_prospeccao: atras(24 * 16),
    periodo: { ...per, rodadas: { R1: per.novos_leads, R2: Math.round((per.emails - per.novos_leads) * 0.62), R3: Math.round((per.emails - per.novos_leads) * 0.3),
      outros: per.emails - per.novos_leads - Math.round((per.emails - per.novos_leads) * 0.62) - Math.round((per.emails - per.novos_leads) * 0.3) },
      taxa_bounce: tx(per.bounces, per.emails), taxa_resposta: tx(per.respostas, per.emails) },
    anterior: { ...ant, taxa_bounce: tx(ant.bounces, ant.emails), taxa_resposta: tx(ant.respostas, ant.emails) },
    acumulado: { emails: emailsTotal, bounces: bouncesTotal, taxa_bounce: tx(bouncesTotal, emailsTotal),
      taxa_retorno: tx(f("responderam"), f("prospectados")), taxa_qualificacao: tx(f("qualificados"), f("responderam")),
      taxa_proposta: tx(f("propostas"), f("responderam")), taxa_conversao: tx(f("convertidos"), f("prospectados")),
      mediana_horas_ate_resposta: 31.5 },
    funil: [["prospectados", "prospectados"], ["responderam", "responderam"], ["interesse_real", "real"], ["qualificados", "qualificados"],
      ["propostas", "propostas"], ["convertidos", "convertidos"]].map(([etapa, k]) => ({ etapa, n: f(k) })),
    carteira: { total, estagios },
    serie,
    operadores: ops.map((o) => {
      const b = BASE_BOARD[o];
      return { operador: o, nome: nomeOp(o), carteira: b.carteira, prospectados: b.prospectados, emails: Math.round(b.prospectados * 1.52),
        emails_periodo: Math.round(per.emails * (b.ritmo / ritmo)), responderam: b.responderam, taxa_retorno: tx(b.responderam, b.prospectados),
        qualificados: b.qualificados, propostas: b.propostas, convertidos: b.convertidos, convertidos_carteira: b.conv_carteira };
    }),
    operacao: { tarefas_status: { executou: 38, parcial: 4, adiou: 6, recusou: 2, bloqueado_humano: 1, pendente: 2, em_andamento: 1 },
      tarefas_tipo: {}, envios_status: { enviado: per.emails, bloqueado: 3, agendado: 4 },
      relatos_nao_lidos: porOp(db.relatos, op).filter((r) => !r.lido_em).length,
      campainhas_ativas: porOp(db.campainhas, op).filter((c) => c.ativa && !c.arquivada_em).length,
      acompanhamentos_agendados: porOp(db.acompanhamentos, op).filter((a) => a.status === "agendado").length, followups_7d: 23 },
    quentes,
    convertidos_recentes: convertidos,
  };
}
rotas.push(["GET", /^\/board$/, ({ q }) => boardMock(Math.max(7, Math.min(Number(q.dias) || 30, 180)), q.operador)]);

export async function mockRequest(method, path, body) {
  await new Promise((r) => setTimeout(r, 120 + Math.random() * 180));
  const url = new URL(path, "http://mock.local");
  const q = Object.fromEntries(url.searchParams);
  for (const [m, re, fn] of rotas) {
    if (m !== method) continue;
    const casou = url.pathname.match(re);
    if (casou) return clone(fn({ q, b: clone(body) || {}, p: casou.slice(1).map(decodeURIComponent) }));
  }
  throw new ApiError(404, `Rota não implementada no modo demonstração: ${method} ${url.pathname}`);
}
