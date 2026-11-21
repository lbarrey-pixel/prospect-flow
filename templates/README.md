# Email templates

- `modelo_email.html`: the email shell. The `{{CORPO}}` placeholder receives the draft HTML.
- `anexos/catalogo.pdf`, `anexos/ficha_cadastral.pdf`: attachments the bot can request by name (`catalogo`, `ficha_cadastral`).

docker-compose mounts this folder at `/templates` in n8n. Replace them with your files; the workflow
`03_enviar_emails` ignores an attachment whose file does not exist.
