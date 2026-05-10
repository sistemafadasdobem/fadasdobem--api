# Feature `specialists/`

**Propósito:** **Vitrine pública** (lista e perfil por id) e **painel da taróloga** (perfil, estado operacional, agenda semanal) — com saneamento de campos sensíveis nas respostas públicas.

**Pasta:** `src/features/specialists/`

| Ficheiro | Papel |
|----------|--------|
| `specialists.routes.js` | Ordem: rotas `/me/*` com `auth` + `tarologaRole` **antes** de `GET /:id` |
| `specialists.controller.js` | `catchAsyncRoute` + `responderSucesso` |
| `specialists.service.js` | Listagem, detalhe público, `PATCH` perfil, `PATCH` status (`individualHooks: true`), `PUT` agenda em transação |

**Middlewares:** `auth.middleware.js` + `tarologaRole.middleware.js` (403 se `req.user.role !== 'TAROLOGA'`).

**Models:** `Specialist`, `SpecialistModality`, `SpecialistOracle`, `SpecialistSchedule`, `SpecialistStatusLog` (último via hooks em `models/index.js` ao mudar `status`).

**Postman:** pasta **Public — Especialistas (vitrine)** e **Fase 3 — Painel da Taróloga** em `src/postman/collections/FadasDoBem.postman_collection.json`.
