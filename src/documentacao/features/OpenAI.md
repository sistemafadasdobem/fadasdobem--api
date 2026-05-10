# Feature `openai/`

**Propósito:** camada **OpenAI Assistants / Runs** e orquestração de *function bridge* quando o produto usa GPT em vez de Claude — activado conforme `ACTIVE_AI_PROVIDER`.

**Pasta:** `src/features/openai/`

Sem rotas HTTP dedicadas sob `features/openai`. O aquecimento de assistentes chama **`src/providers/openai/openai.setup.js`** desde a raiz `app.js` (`warmupAssistantsSilent`).

| Ficheiro | Papel (resumo) |
|----------|----------------|
| `openai.service.js` | Serviço de alto nível (threads, assistants) |
| `openai.workflow.js` | Fluxo conversacional próprio ao domínio Fadas |
| `openai.functionBridge.js` | Ponte instrumentos ↔ OpenAI Functions |

**Variáveis:** `OPENAI_API_KEY`, `OPENAI_ASSISTANT_*`, `OPENAI_RUN_POLL_MS`, etc.

**Relação com documentação externa:** ficheiros em `src/documentacao-externa/` sobre OpenAI quando existirem.
