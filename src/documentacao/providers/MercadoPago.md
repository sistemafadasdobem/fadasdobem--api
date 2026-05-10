# Provider `mercadopago/`

**Ficheiro:** `src/providers/mercadopago/mercadopago.client.js`

**Propósito:** cliente HTTP para **Mercado Pago** (criar pagamento, consultar por ID, estorno quando aplicável). Escolha de **access token** por ambiente via `MP_ENV` (`sandbox` vs `production`).

**Feature:** `documentacao/features/Payments.md`

**Middleware associado:** `documentacao/middlewares/Registo_Middlewares.md` → `mpSignature.middleware.js`

**Models:** `documentacao/models/PaymentOrder.md`, ledger e lotes de crédito.
