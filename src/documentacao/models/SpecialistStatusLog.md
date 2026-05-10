# Tabela `specialist_status_logs`

**Propósito:** **auditoria de status em tempo quase-real** — rasto de períodos ONLINE/OFFLINE (e estados intermediários) para SLA, tempo de presença e disputas contractuais. Complementar a `audit_logs` (foco segurança / acções administrativas).

**Model Sequelize:** `SpecialistStatusLog` · **tabela:** `specialist_status_logs`  
**Natureza:** apenas **INSERT** (sem actualização posterior; timestamps Sequelize desativados).

---

| Campo | Tipo | Nulo | Observação |
|-------|------|------|------------|
| `id` | UUID | Não | PK. |
| `specialist_id` | UUID | Não | FK → `specialists.id` (**ON DELETE CASCADE**). |
| `previous_status` | VARCHAR(24) | Sim | Estado antes da mudança; `NULL` quando não há pré‑estado (ex.: primeira gravação após onboarding). |
| `new_status` | VARCHAR(24) | Não | Valores alinhados ao enum da taróloga (`ONLINE`, `EM_ATENDIMENTO`, `AUSENTE`, `OFFLINE`). Constraint impedido *no-op*: se `previous_status` não é nulo, tem de ser diferente do `new_status`. |
| `changed_at` | TIMESTAMPTZ | Não | Momento registado pelo servidor (`NOW()`). |

---

## Índice principal

`(specialist_id, changed_at DESC)` — relatórios de janela temporal por profissional.

---

## Produção das linhas

1. Hooks **`Specialist.afterCreate`** e **`Specialist.afterUpdate`** em **`src/models/index.js`**, desde que Sequelize veja mudança real de `status`.
2. **Actualizações em massa** sem `individualHooks: true` **não geram auditoria**: alinhar a API antes de usar *bulk UPDATE* sobre `specialists`.

---

## Dados antes da Fase 3

Perfis já existentes **não** recebem retroactivo automático; o histórico começa quando a primeira transição ocorrer após a migração (ou mediante *script* pontual opcional).
