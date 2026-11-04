# 0004. Credenciais de API guardadas só como hash

## Contexto
Bots e o orquestrador autenticam com chaves de API. Um dump do banco não pode entregar chaves utilizáveis.

## Decisão
A chave (`pf_` + 32 bytes aleatórios em base64 url-safe) é mostrada uma única vez por `scripts/gerar_chave.py`. O banco guarda o SHA-256, o prefixo para reconhecer na tela, o escopo (`bot`, `orquestrador`, `leitura`) e o operador. Chaves de bot só enxergam e alteram o que é do próprio operador. O cache de autenticação em memória é indexado pelo hash do token, tem TTL e tamanho máximo, e remove os mais antigos quando enche. Revogar uma chave só vale depois do TTL do cache (5 minutos).

O segredo HMAC do webhook do bot é a exceção: precisa estar em claro para assinar o corpo. Ele só é devolvido uma vez, na criação, e nunca aparece nas listagens.

## Consequências
- Perder a chave exige gerar outra; não há recuperação.
- SHA-256 simples basta porque a chave tem entropia alta; para senhas escolhidas por pessoas seria preciso um hash lento.
