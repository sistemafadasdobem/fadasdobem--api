# Feature `evolution/`

**Propósito:** proxies administrativos e diagnóstico para **Evolution API** (instâncias WhatsApp): listagem, estado de integração e pedidos de reconnect.

**Pasta:** `src/features/evolution/`

| Ficheiro | Papel |
|----------|--------|
| `evolution.routes.js` | Rotas sob `/v1/evolution-admin` |
| `evolution.controller.js` | HTTP |
| `evolution.service.js` | Chamadas HTTP à Evolution usando `EVOLUTION_*` |

**Variáveis:** `EVOLUTION_API_BASE_URL`, `EVOLUTION_GLOBAL_API_KEY`, opcionalmente `EVOLUTION_WEBHOOK_GLOBAL_URL`.

**Notas:** em PRD deve haver política explícita de quem pode chamar estas rotas (hoje não há middleware de Gestora obrigatório em todas — alinhar com produto antes de exposição ampla).
