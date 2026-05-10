# Tabela `specialist_schedules`

**Propósito:** **agenda semanal editável** por especialista — blocos de disponibilidade recorrentes. Um mesmo `(specialist_id, day_of_week)` pode aparecer **N vezes** (ex.: 09h–12h e 14h–18h).

**Model Sequelize:** `SpecialistSchedule` · **tabela:** `specialist_schedules`

---

| Campo | Tipo | Nulo | Observação |
|-------|------|------|------------|
| `id` | UUID | Não | PK `gen_random_uuid()`. |
| `specialist_id` | UUID | Não | FK → `specialists.id` (**ON DELETE CASCADE**). |
| `day_of_week` | SMALLINT | Não | **0 = Domingo … 6 = Sábado** (convenção `Date.prototype.getDay` em JS). Constraint `CHECK` 0–6. |
| `start_time` | TIME | Não | Início do bloco (*wall-clock* no fuso `specialists.timezone`). |
| `end_time` | TIME | Não | Fim **estritamente** maior que `start_time` (`CHECK end_time > start_time`). |
| `is_active` | BOOLEAN | Não | Predefinição `true`; desativa bloco sem apagar histórico. Índice parcial em `specialist_id` só quando **ativo** acelera leituras de agenda “válida”. |
| `created_at`, `updated_at` | TIMESTAMPTZ | Não | Rasto de última edição da linha na app. |

---

## Índices

- `(specialist_id, day_of_week)` — filtros típicos UI / API.
- Parcial `(specialist_id) WHERE is_active = true`.

---

## Não garantido pela BD

- Sobreposição de intervalos entre blocos ou cruzamentos com folgas pontuais: validar na camada serviço (Fase 3 API) antes de gravar ou expor ferramentas de *shift* pontual em tabela futura.

---

Ver também: [`Specialist.md`](./Specialist.md) (`timezone`), [`Relacionamentos_FKs.md`](./Relacionamentos_FKs.md).
