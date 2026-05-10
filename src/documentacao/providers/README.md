# Documentação dos *providers* (`src/providers/`)

Integrações externas isoladas por pasta: HTTP/SDK, templates e ferramentas reutilizáveis pelas **features** e pela app. Contrato habitual: cliente fino aqui; regra de negócio e modelo em **`src/features/*`** ou **`sessions.service`** etc.

| Documento | Código (`src/providers/`) | Consumo típico |
|-----------|---------------------------|----------------|
| [Agora.md](./Agora.md) | `agora/` | Sessões VIDEO / NCS |
| [MercadoPago.md](./MercadoPago.md) | `mercadopago/` | Pagamentos PIX/cartão + API |
| [Intelbras.md](./Intelbras.md) | `intelbras/` | VOZ (Wide Voice REST) |
| [Evolution.md](./Evolution.md) | `evolution/` | Feature `evolution-admin` |
| [Chatwoot.md](./Chatwoot.md) | `chatwoot/` | Cliente REST Chatwoot |
| [Mail.md](./Mail.md) | `mail/` | Resend + templates Auth |
| [Anthropic.md](./Anthropic.md) | `anthropic/` | Claude + tools/prompts |
| [OpenAI.md](./OpenAI.md) | `openai/` | Assistants / client API |
| [Socket.md](./Socket.md) | `socket/` | Filas em tempo real (Socket.io + JWT) |

Fluxos HTTP expostos ao utilizador ficam descritos em **`documentacao/features/`** e **`Integração_Rotas_v1.md`**.
