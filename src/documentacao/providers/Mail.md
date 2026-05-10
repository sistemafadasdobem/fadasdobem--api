# Provider `mail/`

**Pasta:** `src/providers/mail/`

| Ficheiro | Papel |
|----------|--------|
| `resend.client.js` | Transporte via **Resend** |
| `mail.service.js` | API de alto nível (envio por tipo de e-mail) |
| `templates/verifyEmail.template.js` | Corpo HTML verificação |
| `templates/welcome.template.js` | Boas-vindas |
| `templates/otp.template.js` | OTP / códigos |

**Feature:** Auth (e outros pontos que invoquem `mail.service`).

**Variáveis:** `RESEND_API_KEY`, remetentes e URLs de app conforme `auth` / `.env.example`.
