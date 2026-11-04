# 0001. O n8n é uma lista de tarefas, não o cérebro

## Contexto
Um agente de prospecção precisa de relógio, leitura de caixas de entrada, envio de e-mail e avisos. O n8n faz tudo isso bem. A tentação é também codificar ali a tática: quem contatar, o que escrever, quando insistir.

## Decisão
O n8n acorda o bot e entrega tarefa e contexto. Quem decide texto, horário e ângulo é o bot, que também pode não executar uma tarefa. Toda decisão (executou, adiou, recusou, com motivo) é gravada em `crm.tarefas` e aparece no quadro. As regras que podem ser verificadas (teto, intervalo, rodada, janela) ficam na API.

## Consequências
- Trocar o agente ou o modelo não exige mexer nos workflows.
- Os workflows são curtos e viram JSON gerado por `n8n/gerar_workflows.py`, com revisão de diff legível.
- A auditoria não depende do histórico de execuções do n8n.
- A tática perde a previsibilidade de um fluxo desenhado nó a nó; em troca ganha adaptação ao contexto de cada lead.
