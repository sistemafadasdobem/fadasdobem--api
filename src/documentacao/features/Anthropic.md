# Feature `anthropic/`

**Propósito:** integração **Claude Messages API** (Anthropic SDK) como *provedor IA* paralelo ao OpenAI — usado especialmente quando `ACTIVE_AI_PROVIDER=anthropic` no fluxo Chatwoot e extensível a outros pontos da API.

**Pasta:** `src/features/anthropic/`

Esta pasta **não define rotas Express** próprias; é consumida por `chatwoot.service.js` ou serviços similares.

| Ficheiro | Papel (resumo) |
|----------|----------------|
| `anthropic.service.js` | Chamadas ao modelo, tools, erro operacional padronizado |
| `anthropic.messages.js` | Construção de mensagens / system prompts de domínio |
| `anthropic.workflow.engine.js` | Motor de passos/workflows conversacionais |
| `anthropic.workflow.store.js` | Persistência de estado de fluxo quando aplicável |
| `anthropic.workflow.config.js` | Configuração declarativa de fluxos |

**Variáveis:** `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_MAX_*`, `ANTHROPIC_SERVICE_LOG`, etc.

**Provider partilhado:** `src/providers/anthropic/` (`anthropic.client.js`, ferramentas e *prompts* de domínio) — utilizado para chamadas ao API Anthropic paralelamente aos fluxos em `features/anthropic/`.
