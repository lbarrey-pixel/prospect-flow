# Templates de e-mail

- `modelo_email.html`: casca do e-mail. O marcador `{{CORPO}}` recebe o HTML do rascunho.
- `anexos/catalogo.pdf`, `anexos/ficha_cadastral.pdf`: anexos que o bot pode pedir pelo nome (`catalogo`, `ficha_cadastral`).

O docker-compose monta esta pasta em `/templates` no n8n. Troque pelos seus arquivos; o workflow
`03_enviar_emails` ignora anexo cujo arquivo não existe.
