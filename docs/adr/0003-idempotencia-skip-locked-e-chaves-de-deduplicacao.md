# 0003. Idempotência com SKIP LOCKED e chaves de deduplicação

## Contexto
O relógio dispara a cada poucos minutos, o n8n repete chamadas que falham e a mesma mensagem pode chegar duas vezes pela caixa de entrada. Duplicar tarefa ou envio é o pior defeito deste sistema: é um e-mail repetido para um cliente potencial.

## Decisão
- Tarefas têm `chave_dedup` única (por exemplo `envio_diario:<operador>:<data>` e `inbound:<message_id>`); criar de novo devolve "duplicado" em vez de erro.
- Interações e disparos de campainha têm índice único em `message_id`.
- Quem reserva trabalho (`envios/prontos`, acompanhamentos vencidos) usa `FOR UPDATE SKIP LOCKED`, então duas execuções simultâneas nunca pegam a mesma linha.
- O resultado de envio é idempotente: repetir não grava a ação duas vezes.

## Consequências
- O n8n pode ter retentativa ligada em todas as chamadas.
- O custo é um índice único a mais e a disciplina de definir a chave ao criar qualquer tarefa automática.
