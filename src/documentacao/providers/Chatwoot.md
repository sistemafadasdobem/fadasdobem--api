# Provider `chatwoot/`

**Ficheiro:** `src/providers/chatwoot/chatwoot.client.js`

**Propósito:** chamadas autenticadas à **API REST Chatwoot** (conversas, contactos, mensagens) reutilizadas pelo webhook, histórico para IA e **notas privadas à equipa** (ex.: fila em `queues.service.js`).

**Funções destacadas:**
- `postConversationOutgoingMessage(accountId, conversationId, text, isPrivate)` — `private: true` gera **nota de equipa** (amarela).
- `postPrivateNote(accountId, conversationId, text)` — atalho com `private: true`.
- `postTextReply` — saída pública (`private: false`).

**Feature:** `documentacao/features/Chatwoot.md`

**Variáveis:** `CHATWOOT_BASE_URL`, `CHATWOOT_ACCOUNT_ID`, `CHATWOOT_API_ACCESS_TOKEN`.
