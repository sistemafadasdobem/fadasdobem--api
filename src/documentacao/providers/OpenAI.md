# Provider `openai/`

**Pasta:** `src/providers/openai/`

| Ficheiro | Papel |
|----------|--------|
| `openai.client.js` | Cliente API OpenAI |
| `openai.setup.js` | Aquecimento de assistentes (`warmupAssistantsSilent`) — invocado em `app.js` à raiz do pacote |
| `openai.prompts.js` | *Prompts* partilhados |
| `openai.tools.js` | Ferramentas / function definitions |

**Feature:** `documentacao/features/OpenAI.md` + consumo indirecto em Chatwoot quando `ACTIVE_AI_PROVIDER` aponta para OpenAI.

**Variáveis:** `OPENAI_API_KEY`, IDs de assistente, etc.
