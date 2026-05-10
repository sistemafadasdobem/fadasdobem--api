# Rotas HTTP `/api/v1/*` (consolidado)

Referência rápida. Detalhes por domínio nos ficheiros da mesma pasta.

| Método | Caminho (após `/api`) | Feature | Notas |
|--------|------------------------|---------|--------|
| POST | `/v1/auth/register` | auth | Rate limits |
| POST | `/v1/auth/login` | auth | |
| POST | `/v1/auth/refresh-token` | auth | |
| POST | `/v1/auth/forgot-password` | auth | |
| POST | `/v1/auth/reset-password` | auth | |
| GET | `/v1/auth/verify-email` | auth | |
| GET/PATCH | `/v1/auth/me` | auth | Bearer |
| POST | `/v1/auth/logout` | auth | Bearer |
| POST | `/v1/auth/resend-verification` | auth | Bearer |
| GET | `/v1/config/public` | config | Público |
| POST | `/v1/chatwoot/webhook` | chatwoot | Público (Chatwoot → API) |
| GET | `/v1/evolution-admin/integrations/status` | evolution | |
| GET | `/v1/evolution-admin/instances` | evolution | |
| POST | `/v1/evolution-admin/instances/:instanceName/reconnect` | evolution | |
| GET | `/v1/specialists` | specialists | Vitrine — lista (campos públicos; sem PIX / `user_id` / integrações) |
| GET | `/v1/specialists/:id` | specialists | Vitrine — perfil + modalidades + oráculos + `agenda_horarios` activos (ordenados dia/hora) |
| PATCH | `/v1/specialists/me/profile` | specialists | Bearer **`TARÓLOGA`** (`auth` + `tarologaRole`) — bio, mídias, experiência, TZ |
| PATCH | `/v1/specialists/me/status` | specialists | Bearer **`TARÓLOGA`** — `individualHooks` no `Specialist.update` → `specialist_status_logs` |
| PUT | `/v1/specialists/me/schedule` | specialists | Bearer **`TARÓLOGA`** — substituição transaccional da agenda (`destroy` + `bulkCreate`) |
| POST | `/v1/queues/` | queues | Bearer **CLIENTE** — entrar na fila (`specialist_id`, `preferred_modality`) |
| POST | `/v1/queues/:id/leave` | queues | Bearer **CLIENTE** — `CANCELLED_BY_CLIENT` |
| GET | `/v1/queues/specialist/:specialistId` | queues | Público — fila `WAITING` + referência de ETA (média últimas sessões) |
| POST | `/v1/sessions` | sessions | Bearer — criar sessão |
| GET | `/v1/sessions/:id/token` | sessions | Bearer — token Agora |
| POST | `/v1/sessions/agora-webhook` | sessions | NCS Agora |
| POST | `/v1/sessions/intelbras-webhook` | sessions | Wide Voice |
| POST | `/v1/payments/pix` | payments | Bearer |
| POST | `/v1/payments/card` | payments | Bearer |
| GET/HEAD | `/v1/payments/webhook` | payments | Probe |
| POST | `/v1/payments/webhook` | payments | Mercado Pago + assinatura |

*WebSocket (fila inteligente):* Socket.io no mesmo host/porta que a API; handshake JWT e eventos `queue_updated` / `turn_started` — ver `documentacao/providers/Socket.md`.

*Probes:* `GET /health` e `GET /ping` na raiz da app (`app.js`); em `/api`: `GET /api/ping`, `GET /api/health`, `GET /api/v1/health` (`src/routes/index.js`).
