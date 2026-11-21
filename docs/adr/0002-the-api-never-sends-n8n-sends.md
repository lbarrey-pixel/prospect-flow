# 0002. The API never sends email; n8n sends

## Context
Sending needs SMTP credentials per mailbox, attachments, and conversation headers. Putting that in the API would turn it into a point where secrets leak and would tie it to a host that is always on.

## Decision
The bot returns a draft. The API validates the operator's rules and marks the send as `aprovado`, `agendado`, or `bloqueado`. n8n pulls the approved ones (`GET /orquestrador/envios/prontos`), sends by SMTP, and returns the result (`POST .../resultado`). Only then does the API record the action with the round.

## Consequences
- SMTP secrets exist only in the n8n environment.
- No email goes out without passing validation, and there is no record of an email that did not go out. If recording the result fails, the send stays `enviando` and shows up on the panel.
- Sending depends on n8n being up; the accumulated queue is sent when it comes back, respecting the window.
