# 0003. Idempotency with SKIP LOCKED and deduplication keys

## Context
The clock fires every few minutes, n8n retries calls that fail, and the same message can arrive twice through the inbox. Duplicating a task or a send is the worst defect of this system: it is a repeated email to a potential customer.

## Decision
- Tasks have a unique `chave_dedup` (for example `envio_diario:<operador>:<data>` and `inbound:<message_id>`); creating again returns "duplicado" instead of an error.
- Interactions and bell firings have a unique index on `message_id`.
- Whoever reserves work (`envios/prontos`, due follow-ups) uses `FOR UPDATE SKIP LOCKED`, so two concurrent executions never take the same row.
- The send result is idempotent: repeating it does not record the action twice.

## Consequences
- n8n can have retry turned on for every call.
- The cost is one extra unique index and the discipline of defining the key when creating any automatic task.
