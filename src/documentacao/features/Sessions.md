# Feature `sessions/`

**Propósito:** ciclo de **sessões ao vivo**: criação (modalidade TEXTO | VOZ | VIDEO), telecom unificado (**Agora** RTC para vídeo; **Intelbras** Wide Voice via webhook REST), bilhetagem **2+X+2**, encerramento forçado via `telecom.manager` + webhooks externos.

**Pasta:** `src/features/sessions/`

| Ficheiro | Papel |
|----------|--------|
| `sessions.routes.js` | Rotas HTTP `/v1/sessions` |
| `sessions.controller.js` | Auth, webhook Agora/NCS sem auth, webhook Intelbras |
| `sessions.service.js` | `createSession`, token Agora, NCS async, webhook Intelbras, `runBillingTickSweep` |
| `session.constants.js` | Cortesia inicial, restantes minutos WARNING, intervalo billing |
| `telecom.manager.js` | Estratégia única para **disconnect** por `telecom_provider` (kick Agora / hangup Intelbras REST) |

**Rotas destacadas:**
- `POST /` — Bearer, corpo `specialist_id`, `modality`; VIDEO → Agora UIDs/channels.
- `GET /:id/token` — token RTC apenas sessões `telecom_provider = AGORA`.
- `POST /agora-webhook` — payload NCS; resposta **200 imediato**, processamento assíncrono.
- `POST /intelbras-webhook` — Wide Voice / telefonia; **200 imediato** + async.

**Motores paralelos:**
- Cronômetro: `runBillingTickSweep` (interval em `app.js` via constantes CHRONO).

**Variáveis (exemplos):** Agora (`AGORA_*`), Intelbras REST (`INTELBRAS_REST_*`), `INTELBRAS_REST_URL`/`LOGIN`/`TOKEN`.

**Models:** ver `documentacao/models/Session.md`; créditos e carteiras em ledger para o tick quando sessão ACTIVE.
