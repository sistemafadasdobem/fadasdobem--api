# Feature `queues/`

**Propósito:** **fila inteligente** por taróloga — REST para entrar/sair/consultar `WAITING` + **tempo estimado**, e pushes em tempo real via **Socket.io** (`queue_updated`, `turn_started`).

**Pasta:** `src/features/queues/`

| HTTP | Auth | Destino |
|------|------|---------|
| `POST /api/v1/queues/` | Cliente JWT | Entrar (`specialist_id`, `preferred_modality`) — taróloga **não** pode estar `ONLINE` nem `OFFLINE` |
| `POST /api/v1/queues/:id/leave` | Cliente JWT | Sai — `status` → **`CANCELLED_BY_CLIENT`** (modelo Sequelize) |
| `GET /api/v1/queues/specialist/:specialistId` | Público | Lista `WAITING` + ETA de referência (média das últimas 10 sessões telecom `COMPLETED`, ou **15 min**) |

**Integração:** ao passar `sessions.telecom_status` de outro valor para **`COMPLETED`** (`sessions.service.js`: NCS Agora 104, Intelbras hangup, hard cut de billing), chama-se `promoteFirstWaitingAfterSessionEnded` — primeiro `WAITING` → **`INVITED`**, **`turn_started`** (site) + **`queue_updated`** (site).

**Chatwoot (regra produto — sem disparo WhatsApp Evolution ao cliente desde a fila):** é criada **nota privada** (`postPrivateNote`) na conversa `users.chatwoot_conversation_id`, com texto de [`queue.constants.js`](../../features/queues/queue.constants.js) (`MSG_PRIVATE_NOTE_ATTENDANT`) para a atendente human validar antes de usar os atalhos `MSG_QUEUE_PAID` / `MSG_QUEUE_*` aos visitantes.

**Templates (atalhantes/bot/agenda/absenteísmo):** mesmos constantes (`MSG_LEADS_AGENDA_BOT`, `MSG_ABSENT_RETURN_BOT`, `MSG_GENERIC_AVAILABLE_BOT`, …) ficam disponíveis para motor Chatwoot/flows sob integração própria.

**Socket:** ver [`documentacao/providers/Socket.md`](../providers/Socket.md).
