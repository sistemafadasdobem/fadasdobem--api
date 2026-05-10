# Feature `auth/`

**Propósito:** registo, login JWT (access + refresh), verificação de e-mail, recuperação de password, perfil `me`, logout e limites de taxa em rotas sensíveis.

**Pasta:** `src/features/auth/`

| Ficheiro | Papel |
|----------|--------|
| `auth.routes.js` | Montagem Express em `/v1/auth` |
| `auth.controller.js` | Handlers HTTP + `catchAsyncRoute` |
| `auth.service.js` | Regras de negócio, Sequelize `User` / `Client` / tokens |
| `auth.constants.js` | Constantes (ex.: custo bcrypt, nomes de cookies se usados) |
| `auth.audit.util.js` | Utilitários de auditoria ligados a auth |
| `auth.emailPending.job.js` | Job agendado (rever e-mails pendentes de confirmação) |

**Dependências típicas:** `User`, `Client`, `RefreshToken`, `OTP`, `StaffProfile` (conforme fluxo), middlewares `rateLimit.middleware`, `auth.middleware` (para rotas protegidas).

**Variáveis de ambiente (exemplos):** `JWT_SECRET`, `JWT_EXPIRES_IN`, `JWT_REFRESH_*`, `RESEND_*`, `AUTH_RATE_LIMIT_DISABLED` (homolog).

**Documentação relacionada:** modelos em `documentacao/models/User.md`, `Client.md`, `OAuthAccount.md`, `OTP.md`, `RefreshToken.md`.
