# Documentação das *features* (`src/features/`)

Espelho conceitual da pasta **`src/features/`**: cada domínio de negócio / integração exposto em código (routes, controller, service) está descrito aqui, à semelhança de `src/documentacao/models/` para as tabelas Sequelize.

**Prefixo HTTP global:** `app.js` monta `router` em `/api` → rotas versionadas em `/api/v1/...`.

| Documento | Pasta em código | Prefixo mount (`src/routes/index.js`) |
|-----------|-----------------|--------------------------------------|
| [Auth.md](./Auth.md) | `auth/` | `/v1/auth` |
| [Config.md](./Config.md) | `config/` | `/v1/config` |
| [Chatwoot.md](./Chatwoot.md) | `chatwoot/` | `/v1/chatwoot` |
| [Evolution.md](./Evolution.md) | `evolution/` | `/v1/evolution-admin` |
| [Specialists.md](./Specialists.md) | `specialists/` | `/v1/specialists` |
| [Sessions.md](./Sessions.md) | `sessions/` | `/v1/sessions` |
| [Payments.md](./Payments.md) | `payments/` | `/v1/payments` |
| [Anthropic.md](./Anthropic.md) | `anthropic/` | *(sem rotas — consumo interno)* |
| [OpenAI.md](./OpenAI.md) | `openai/` | *(sem rotas — consumo interno)* |

Ver também: [Integração_Rotas_v1.md](./Integração_Rotas_v1.md) (mapa consolidado de endpoints).

**Clean Architecture (prática neste repo):** *feature* = fatia vertical; `routes` → `controller` (HTTP / `catchAsync`) → `service` (regras + modelos); *providers* em `src/providers/` quando a integração é partilhada ou substituível.
