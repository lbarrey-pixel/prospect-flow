# 0002. A API nunca envia e-mail; o n8n envia

## Contexto
O envio precisa de credenciais SMTP por caixa, de anexos e de cabeçalhos de conversa. Colocar isso na API a transformaria em ponto de vazamento de segredos e a prenderia a um host sempre ligado.

## Decisão
O bot devolve um rascunho. A API valida as regras do operador e marca o envio como `aprovado`, `agendado` ou `bloqueado`. O n8n puxa os aprovados (`GET /orquestrador/envios/prontos`), envia por SMTP e devolve o resultado (`POST .../resultado`). Só então a API grava a ação com a rodada.

## Consequências
- Segredos de SMTP existem apenas no ambiente do n8n.
- Nenhum e-mail sai sem passar pela validação, e não há registro de e-mail que não saiu. Se o registro do resultado falhar, o envio fica `enviando` e aparece no painel.
- O envio depende de o n8n estar no ar; fila acumulada é enviada quando ele volta, respeitando a janela.
