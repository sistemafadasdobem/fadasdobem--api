# `BotConversationFlowState` (`bot_conversation_flow_states`)

Persistência do **estado conceptual** do Motor de Fluxo Claude por conversa Chatwoot.

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | UUID | Chave primária. |
| `account_id` | STRING(32) | Conta Chatwoot (`CHATWOOT_ACCOUNT_ID`). |
| `conversation_id` | STRING(64) | Identificador da conversa no canal (mesmo usado na API outbound). |
| `provider` | STRING(32) | Por defeito `anthropic` — permite evoluir outros provedores. |
| `current_state` | STRING(64) | Chave do estado no motor 03d-A (`T1`, `T2`, `T4`, `T4b`, … ver `anthropic.workflow.config.js`). |
| `slots` | JSONB | Metadados opcionais (ex.: `transition_notes`). |

**Unicidade:** `(account_id, conversation_id, provider)` — ver migração `20260306120000-create-bot-conversation-flow-states.js`.

**Cache:** Redis opcional em `anthropic.workflow.store.js` (TTL longo); escrita actualiza Postgres e cache.
