# Feature `chatwoot/`

**Propósito:** receptor de **webhooks** do Chatwoot (mensagens, conversas) e encaminhamento para IA / lógica de atendimento (histórico, resposta automática opcional conforme `.env`).

**Pasta:** `src/features/chatwoot/`

| Ficheiro | Papel |
|----------|--------|
| `chatwoot.routes.js` | `POST /webhook` (público) |
| `chatwoot.controller.js` | Parsing do body, disparo do service |
| `chatwoot.service.js` | Resolução de contacto/usuário, chamada Claude/OpenAI quando ativo |
| `chatwoot.aiHistory.js` | Busca/normalização do histórico no Chatwoot para contexto IA |

**Integração IA:** quando `ACTIVE_AI_PROVIDER` e flags Chatwoot o permitem, o fluxo pode invocar `anthropic/` ou `openai/` indirectamente através do service.

**Variáveis (exemplos):** `CHATWOOT_BASE_URL`, `CHATWOOT_ACCOUNT_ID`, `CHATWOOT_API_ACCESS_TOKEN`, `CHATWOOT_IA_AUTO_REPLY`, `CHATWOOT_IA_HISTORY_N`.

**Models frequentes:** `User` ( vínculo `chatwoot_contact_id` ), leads/sessões segundo o fluxo documentado em `Relacionamentos_FKs.md`.
