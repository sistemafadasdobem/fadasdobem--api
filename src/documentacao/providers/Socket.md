# Provider `socket/`

**Ficheiros:** [`socket.gateway.js`](../../providers/socket/socket.gateway.js)

**Propósito:** **Socket.io** sobre o mesmo `http.Server` que o Express (`app.js` → `createServer`). Autenticação no **handshake** com JWT (`auth.token` ou `Authorization` Bearer).

**Eventos servidor → cliente:**
- `queue_updated` — payload com `specialist_id`, `fila_espera`, `timestamp` (via `emitQueueUpdate`).
- `turn_started` — convite quando a sessão da frente fecha (`sessions` telecom `COMPLETED` → primeiro `WAITING` passa `INVITED`).

**Cliente → servidor (subscrições):**
- `subscribe_specialist_queue` `{ specialist_uuid }`
- `unsubscribe_specialist_queue` `{ specialist_uuid }`

**Variáveis:** `SOCKET_CORS_ORIGIN` (default `*` se vazio).

**Handshake (exemplo):** `const socket = io(baseUrl, { auth: { token: accessJwt } });` — mesmo emissor JWT que REST (`JWT_SECRET`, `jwtVerifyOptions`).

Namespace padrão do motor; path HTTP long-polling fallback: **`/socket.io/`**.
