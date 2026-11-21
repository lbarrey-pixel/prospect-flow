# 0004. API credentials stored only as a hash

## Context
Bots and the orchestrator authenticate with API keys. A database dump must not hand over usable keys.

## Decision
The key (`pf_` + 32 random bytes in url-safe base64) is shown a single time by `scripts/gerar_chave.py`. The database stores the SHA-256, the prefix for recognizing it on screen, the scope (`bot`, `orquestrador`, `leitura`), and the operator. Bot keys only see and change what belongs to their own operator. The in-memory authentication cache is indexed by the token's hash, has a TTL and a maximum size, and drops the oldest ones when it fills up. Revoking a key takes effect only after the cache TTL (5 minutes).

The bot webhook's HMAC secret is the exception: it needs to be in the clear to sign the body. It is returned only once, at creation, and it never appears in listings.

## Consequences
- Losing the key requires generating another one; there is no recovery.
- Plain SHA-256 is enough because the key has high entropy; passwords chosen by people would need a slow hash.
