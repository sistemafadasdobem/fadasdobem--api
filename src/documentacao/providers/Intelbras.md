# Provider `intelbras/`

**Ficheiros:** `src/providers/intelbras/intelbras.client.js` · `intelbras.service.js`

**Propósito:** chamadas **REST Wide Voice** (axios ao `POST` JSON em `/api.php`) — `clicktocall`, `liberarramal`, `statusramais`, etc., credenciais `INTELBRAS_WIDEVOICE_*`.

**Feature:** `documentacao/features/Sessions.md` (webhook + `telecom.manager`).

---

## WideVoice hospedado (ex.: `*.intelbrasvoice.com.br`)

O que o backend envia (**`acao`**, **`login`**, **`token`** da conta HTTP, **`origem`**, **`destino`**) segue o manual Intelbras. O que **não** vai no JSON REST:

- **Perfil/permissões do ramal** (inclui se o número pode originar chamada externa).
- **`função telefonista`** (ou equivalente no menu do utilizador/logins do painel WideVoice): indicação comum **do parceiro/suporte** — o utilizador marca no **painel web** ao configurar ou editar ramal/perfil; **não** existe campo exposto pelo `api.php` típico para isso neste projeto.
- Ramais apenas “internos” ou sem permissão de saída tendem a devolver comportamento estranho mesmo com **`CHAMADA OK`** — usar ramal já preparado pela conta (ex. fila/atendimento) e **`origem`** alinhada ao que está no painel.

**Feature de laboratório:** `INTELBRAS_LAB_ORIGEM_RAMAL` / `specialists.intelbras_ramal` devem apontar para um ramal **autorizado** e, se a conta exigir, com **telefonista** activo conforme o menu descrito pelo suporte.

