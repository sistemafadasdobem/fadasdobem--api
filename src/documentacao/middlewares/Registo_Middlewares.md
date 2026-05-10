# Registo — `src/middlewares/*.js`

| Ficheiro | Responsabilidade | Notas |
|----------|------------------|--------|
| `auth.middleware.js` | `Authorization: Bearer <access>` → `jwt.verify` com `JWT_SECRET` / `jwtVerifyOptions()`; carrega `User` + `client_profile`; exige `token_use === 'access'` e conta ativa. | Usado em rotas protegidas (ex.: `GET/PATCH /v1/auth/me`, `POST /v1/sessions`). |
| `rateLimit.middleware.js` | Limitadores `express-rate-limit` para login, registo, *forgot password* (chave IP e/ou e-mail normalizado). | `AUTH_RATE_LIMIT_DISABLED=true` ignora limites em homolog. Exporta vários middlewares nomeados (`loginRegisterIpLimiter`, etc.). |
| `mpSignature.middleware.js` | Valida cabeçalho `x-signature` Mercado Pago (HMAC SHA-256 sobre *manifest* com `data.id`, `request-id`, `ts`). | Aplicado ao **POST** `/v1/payments/webhook`. Pode falhar antes do controller se assinatura inválida (`AppError`). |
| `notFound.middleware.js` | Resposta 404 padronizada para rotas não coincidentes. | Registado **depois** de todas as rotas em `app.js`. |
| `errorHandler.middleware.js` | Captura erros (incl. `AppError`): status, mensagem segura ao cliente, log em desenvolvimento. | Último middleware da cadeia. |
| `tarologaRole.middleware.js` | Exige `req.user.role === 'TAROLOGA'` (após `auth.middleware`). | Rotas `PATCH/PUT /v1/specialists/me/*`. |

**Imports frequentes:** `AppError`, `responderErro` / helpers de `src/utils/response.util.js`.
