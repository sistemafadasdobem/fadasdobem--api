# Feature `payments/`

**Propósito:** **Fase financeira** integrada ao **Mercado Pago** — checkout transparente **PIX** e **cartão** (token do front); **webhooks** assinados (`x-signature`); créditos em `PaymentOrder`, `TransactionLedger`, `ClientCreditLot`; estorno/chargeback conforme estado do pagamento MP.

**Pasta:** `src/features/payments/`

| Ficheiro | Papel |
|----------|--------|
| `payments.routes.js` | `/pix`, `/card`, `/webhook` (GET/HEAD probe + POST) |
| `payments.controller.js` | Auth nos checkouts; webhook 200 rápido + logs; `setImmediate` → service |
| `payments.service.js` | Criação de pedido MP, webhook async, cofre `raw_webhook_payload`, carteira suspense, trava production vs `live_mode` |
| `payments.constants.js` | Catálogo de pacotes default + `MP_PACKAGES_JSON` |

**Middleware externo:** `src/middlewares/mpSignature.middleware.js` (antes do POST webhook).

**Provider:** `src/providers/mercadopago/mercadopago.client.js` — token por `MP_ENV` (`MP_ACCESS_TOKEN_SANDBOX` / `*_PRODUCTION`).

**Variáveis:** `MP_ENV`, `MP_ACCESS_TOKEN_*`, `MP_PUBLIC_KEY_*`, `MP_WEBHOOK_SECRET`, `MP_WEBHOOK_VERBOSE`, `MP_WEBHOOK_VERIFY_DISABLED` (dev), `API_PUBLIC_URL` / `MP_NOTIFICATION_URL`.

**Models:** `documentacao/models/PaymentOrder.md`, `ClientCreditLot.md`, `TransactionLedger.md`, `LedgerAccount.md`.
