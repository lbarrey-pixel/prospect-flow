// Vocabulário do contrato (docs/api.md) com rótulos e cores do painel.

function mapa(lista) {
  return Object.fromEntries(lista.map((x) => [x.chave, x]));
}

// Ordem = ordem dos grupos no quadro (abertos primeiro).
export const STATUS_TAREFA = [
  { chave: "pendente", label: "Pendente", cor: "#797e87" },
  { chave: "entregue", label: "Entregue", cor: "#3d9ad6" },
  { chave: "em_andamento", label: "Em andamento", cor: "#f59a23" },
  { chave: "bloqueado_humano", label: "Bloqueado (humano)", cor: "#b07d00" },
  { chave: "adiou", label: "Adiou", cor: "#9d50dd" },
  { chave: "parcial", label: "Parcial", cor: "#7cb83a" },
  { chave: "executou", label: "Executou", cor: "#00a35c" },
  { chave: "recusou", label: "Recusou", cor: "#e2445c" },
  { chave: "falhou", label: "Falhou", cor: "#8f1d2c" },
  { chave: "cancelada", label: "Cancelada", cor: "#4b4f56" },
];
export const STATUS_TAREFA_MAP = mapa(STATUS_TAREFA);
export const STATUS_TAREFA_ABERTOS = ["pendente", "entregue", "em_andamento", "bloqueado_humano", "adiou"];
// Grupos que começam fechados no quadro (histórico).
export const STATUS_TAREFA_FECHADOS_PADRAO = ["executou", "cancelada"];

export const TIPO_TAREFA = [
  { chave: "envio_diario", label: "Envio diário", icone: "Send" },
  { chave: "tratar_resposta", label: "Tratar resposta", icone: "Reply" },
  { chave: "campainha", label: "Campainha", icone: "BellRing" },
  { chave: "acompanhamento", label: "Acompanhamento", icone: "CalendarClock" },
  { chave: "resposta_operador", label: "Resposta do operador", icone: "MessageSquareReply" },
  { chave: "pergunta", label: "Pergunta", icone: "HelpCircle" },
];
export const TIPO_TAREFA_MAP = mapa(TIPO_TAREFA);

export const PRIORIDADE = [
  { chave: "normal", label: "Normal", cor: "#579bfc" },
  { chave: "urgente", label: "Urgente", cor: "#e2445c" },
];
export const PRIORIDADE_MAP = mapa(PRIORIDADE);

export const MOTIVO_DECISAO = {
  licitacao_plena: "Licitação plena",
  sem_ok_humano: "Sem OK humano",
  teto_diario: "Teto diário",
  regra_ambigua: "Regra ambígua",
  contexto_lead: "Contexto do lead",
  outro: "Outro",
};

export const STATUS_ENVIO = [
  { chave: "bloqueado", label: "Bloqueado", cor: "#e2445c" },
  { chave: "agendado", label: "Agendado", cor: "#9d50dd" },
  { chave: "aprovado", label: "Aprovado", cor: "#3d9ad6" },
  { chave: "enviando", label: "Enviando", cor: "#f59a23" },
  { chave: "falhou", label: "Falhou", cor: "#8f1d2c" },
  { chave: "enviado", label: "Enviado", cor: "#00a35c" },
  { chave: "cancelado", label: "Cancelado", cor: "#4b4f56" },
];
export const STATUS_ENVIO_MAP = mapa(STATUS_ENVIO);

export const TIPO_ENVIO = {
  R1: "R1 (1º toque)",
  R2: "R2 (2º toque)",
  R3: "R3 (3º toque)",
  reenvio_pos_bounce: "Reenvio pós-bounce",
  redirect_auto_reply: "Redirect de auto-reply",
  resposta_in_thread: "Resposta na thread",
};

export const MOTIVO_BLOQUEIO = {
  teto_diario: "Teto diário atingido",
  intervalo: "Intervalo mínimo entre toques",
  rodada: "Rodada máxima atingida",
  estagio: "Estágio do lead não permite envio",
  ciclo: "Dentro do ciclo de 90 dias",
  janela: "Fora da janela de envio",
  descartado: "Lead descartado",
};

export const ESTAGIOS = [
  { chave: "frio", label: "Frio", cor: "#64748b" },
  { chave: "aquecendo", label: "Aquecendo", cor: "#d97706" },
  { chave: "respondeu", label: "Respondeu", cor: "#2563eb" },
  { chave: "qualificado", label: "Qualificado", cor: "#7c3aed" },
  { chave: "proposta_enviada", label: "Proposta enviada", cor: "#0891b2" },
  { chave: "convertido", label: "Convertido", cor: "#059669" },
  { chave: "descartado", label: "Descartado", cor: "#b91c1c" },
];
export const ESTAGIO_MAP = mapa(ESTAGIOS);

export const TIPO_RELATO = [
  { chave: "info", label: "Informação", icone: "Info", cor: "#3d9ad6" },
  { chave: "alerta", label: "Alerta", icone: "AlertTriangle", cor: "#f59a23" },
  { chave: "pergunta", label: "Pergunta", icone: "HelpCircle", cor: "#9d50dd" },
  { chave: "pedido_autorizacao", label: "Solicitação de autorização", icone: "ShieldQuestion", cor: "#b07d00" },
];
export const TIPO_RELATO_MAP = mapa(TIPO_RELATO);

export const STATUS_DIRETRIZ = [
  { chave: "proposta", label: "Proposta", cor: "#f59a23" },
  { chave: "ativa", label: "Ativa", cor: "#00a35c" },
  { chave: "rejeitada", label: "Rejeitada", cor: "#e2445c" },
  { chave: "substituida", label: "Substituída", cor: "#797e87" },
];
export const STATUS_DIRETRIZ_MAP = mapa(STATUS_DIRETRIZ);

export const TIPO_CAMPAINHA = {
  dominio: "Domínio",
  remetente: "Remetente",
  assunto: "Assunto",
};

export const STATUS_ACOMPANHAMENTO = [
  { chave: "agendado", label: "Agendado", cor: "#3d9ad6" },
  { chave: "disparado", label: "Disparado", cor: "#f59a23" },
  { chave: "concluido", label: "Concluído", cor: "#00a35c" },
  { chave: "cancelado", label: "Desativado", cor: "#4b4f56" },
];
export const STATUS_ACOMPANHAMENTO_MAP = mapa(STATUS_ACOMPANHAMENTO);

export const AREAS = [
  { chave: "board", label: "Board", icone: "PieChart" },
  { chave: "tarefas", label: "Quadro de tarefas", icone: "LayoutGrid" },
  { chave: "diario", label: "Diário", icone: "BookOpen" },
  { chave: "envios", label: "Envios", icone: "Send" },
  { chave: "campainhas", label: "Campainhas", icone: "BellRing" },
  { chave: "acompanhamentos", label: "Acompanhamentos", icone: "CalendarClock" },
  { chave: "relatos", label: "Relatos", icone: "Inbox" },
  { chave: "diretrizes", label: "Diretrizes", icone: "ScrollText" },
  { chave: "leads", label: "Leads", icone: "Building2" },
  { chave: "atividade", label: "Atividade", icone: "Activity" },
];

// Cores fixas por posição do operador (avatar).
export const CORES_OPERADOR = ["#0073ea", "#e2445c", "#00a35c", "#9d50dd", "#f59a23"];

export const INTERVALO_POLLING_MS = 15000;
