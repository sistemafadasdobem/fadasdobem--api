# Relacionamentos, FKs e índices críticos (canônico)

Fonte declarada em código: associações em `src/models/index.js` **e** convenções das colunas `*_id` descritas abaixo.  
**Importante:** Sequelize não cria todas as FKs físicas até que migrações/manual `references` sejam aplicados em PRD — trate estas colunas sempre como obrigações contratuais de integridade.

---

## Diagrama textual (macro-domínios)

```mermaid
erDiagram
  leads }o--o| users : mesmo_chatwoot_contact_apos_conversao
  users ||--o| clients : perfil-cliente-(1-a-1)
  users ||--o| specialists : perfil-tarologa
  users ||--o| staff_profiles : perfil-interno
  clients }o--|| pricing_levels : pricing_level_id
  specialists ||--|{ specialist_modalities : modality
  specialists ||--|{ specialist_schedules : agenda_semanal
  specialists ||--o{ specialist_status_logs : auditoria_presenca
  specialists }o--o{ oracles : specialist_oracles
  clients ||--|{ queues : fila_espera
  specialists ||--o{ queues : reserva-fixa_opcional
  queues ||--o{ sessions : origem_opcional
  clients ||--|{ sessions : cliente
  specialists ||--|{ sessions : tarologa
  sessions ||--o| reviews : avaliacao_opcional_(1-max)
  clients ||--|{ payment_orders : pagamentos-mp
  users ||--o{ payment_orders : pagador_terceiros
  payment_orders ||--o{ client_credit_lots : financiamento
  clients ||--|{ ledger_accounts : carteira
  specialists ||--|{ ledger_accounts : comissoes
  transaction_ledger }o--|| ledger_accounts : debito
  transaction_ledger }o--|| ledger_accounts : credito
  specialists ||--|{ payout_requests : repasses
```

> **Nota `leads` → `sessions`:** não existe FK física. Um *lead* só se liga a **`sessions`** indirectamente: na **conversão** preenchem-se `users.chatwoot_contact_id` / `users.chatwoot_conversation_id`; `sessions` continuam a partir de `clients` via `sessions.client_id`. Quando existir `chatwoot_conversation_id` igual ao do *lead* resolvido na conversão, a rotina transaccional pode **actualizar** linhas de `sessions` já criadas para apontar para o novo `clients.id`.

---

## Matriz de colunas FK (lógicas)

| Tabela origem | Coluna | Card. | Referência esperada |
|---------------|--------|-------|---------------------|
| `leads` | — | — | Sem FK para `users` (*match* lógico por `chatwoot_contact_id` após conversão) |
| `clients` | `user_id` | N:1 | `users.id` |
| `clients` | `pricing_level_id` | N:1 | `pricing_levels.id` |
| `specialists` | `user_id` | N:1 | `users.id` |
| `specialists` | `reserved_by_client_id` | N:1 opcional | `clients.id` |
| `oauth_accounts` | `user_id` | N:1 | `users.id` |
| `user_devices` | `user_id` | N:1 | `users.id` |
| `staff_profiles` | `user_id` | 1:1 | `users.id` |
| `specialist_modalities` | `specialist_id` | N:1 | `specialists.id` |
| `specialist_oracles` | `specialist_id` | N:1 | `specialists.id` |
| `specialist_oracles` | `oracle_id` | N:1 | `oracles.id` |
| `specialist_schedules` | `specialist_id` | N:1 | `specialists.id` |
| `specialist_status_logs` | `specialist_id` | N:1 | `specialists.id` |
| `ledger_accounts` | `client_id` | N:1 opcional | `clients.id` |
| `ledger_accounts` | `specialist_id` | N:1 opcional | `specialists.id` |
| `transaction_ledger` | `debit_account_id` | N:1 | `ledger_accounts.id` |
| `transaction_ledger` | `credit_account_id` | N:1 | `ledger_accounts.id` |
| `transaction_ledger` | `created_by_user_id` | N:1 opcional | `users.id` |
| `client_credit_lots` | `client_id` | N:1 | `clients.id` |
| `client_credit_lots` | `payment_order_id` | N:1 opcional | `payment_orders.id` |
| `payment_orders` | `client_id` | N:1 | `clients.id` |
| `payment_orders` | `user_id` | N:1 opcional | `users.id` |
| `payout_requests` | `specialist_id` | N:1 | `specialists.id` |
| `payout_requests` | `processed_by_user_id` | N:1 opcional | `users.id` |
| `queues` | `client_id` | N:1 | `clients.id` |
| `queues` | `specialist_id` | N:1 opcional | `specialists.id` |
| `sessions` | `queue_id` | N:1 opcional | `queues.id` |
| `sessions` | `client_id` | N:1 | `clients.id` |
| `sessions` | `specialist_id` | N:1 | `specialists.id` |
| `reviews` | `session_id` | 1 por sessão (ativa) | `sessions.id` |
| `reviews` | `client_id` | N:1 | `clients.id` |
| `reviews` | `specialist_id` | N:1 | `specialists.id` |
| `otps` | `user_id` | N:1 | `users.id` |
| `audit_logs` | `admin_id` | N:1 | `users.id` |

---

## Unicidades parciais (soft delete paranóico em PostgreSQL)

Registros com `deleted_at` preenchido **não devem impedir reuso de chaves de negócio**. Os models passaram a remover `unique: true` em colunas sujeitas ao `paranoid` e usar **índice único parcial** sempre que `deleted_at IS NULL`:

| Model / tabela | Coluna(ns) | Regra quando `deleted_at` IS NULL |
|----------------|-------------|------------------------------------|
| `users` | `email` | Único entre contas vivas |
| `clients` | `user_id` | 1 perfil ativo por usuário cliente |
| `clients` | `cpf` | Único somente quando `cpf` não é nulo |
| `specialists` | `user_id` | Idem ao perfil de taróloga |
| `staff_profiles` | `user_id` | Idem equipe interna |
| `oauth_accounts` | (`provider`,`provider_user_id`) | Ligação social vivo |
| `pricing_levels` | `code` | Código vivo comercial estável |
| `oracles` | `slug` | Slugs publicáveis vivas |
| `payment_orders` | `external_reference` | Idempotência externa garantida apenas em pedidos vivas |
| `payment_orders` | `idempotency_key_internal` | Idempotência interna apenas quando campo preenchido |
| `sessions` | `magic_link_token` | Token curto apenas quando existe |
| `reviews` | `session_id` | Uma avaliação ativa máxima por sessão |
| `leads` | `chatwoot_contact_id` | Único entre *leads* com `deleted_at` nulo |

> **PostgreSQL apenas:** esse padrão exige DDL parcial compatível (`CREATE UNIQUE INDEX ... WHERE ...`). Se outro dialecto aparecer futuramente, re-adaptar migrações.

---

## Fluxos destacados

### Pagamentos (`payment_orders`)

- `external_reference` continua sendo a âncora idempotente da plataforma (mercado de correlação com webhooks `data.id` / `external_reference` dependendo do produto API usado).
- Campos `mp_*` espelham fielmente o snapshot necessário para suporte (status, detalhe, IDs oficiais, PIX, cartão, chargeback, taxas e líquido).
- `raw_webhook_payload` armazena o histórico bruto — o serviço deve **anexar** cada entrega (array ou envelope versionado) antes de mutar estados derivados.
- `mp_nfe_status` + `mp_nfe_url` rastreiam NFS-e automatizada retornada pelo ecossistema MP.

### Sessões (`sessions`)

- `minute_price_applied_snapshot`, `specialist_commission_pct_snapshot`, `platform_fee_amount_snapshot` e `specialist_commission_amount_snapshot` congelam o contrato financeiro vigente no encerramento.
- `ended_reason_code` enumera fechamentos operacionais (hard cut saldo, timeout, desconexão, etc.).
- **Vínculo com aquisição (*lead*):** após `convertLeadToClient`, linhas futuras ou existentes com o mesmo `chatwoot_conversation_id` podem ser reconciliadas ao `clients.id` correcto na transaccão de conversão; o rasto de marketing permanece na linha histórica `leads`.

### Ledger

- `transaction_ledger.amount` segue `DECIMAL(14,4)` para alinhar com pedidos e lotes de crédito.

---

## Manutenção

Sempre que um novo `belongsTo`/`hasMany` for adicionado em `index.js` **ou** surgir novo `*_id` em algum Model, atualizar a matriz de FK deste ficheiro (coluna + destino esperado).

**Presença / SLA:** linhas em `specialist_status_logs` vêm sobretudo dos hooks de `Specialist` definidos em `src/models/index.js`. `Specialist.update({ ... }, { where })` só dispara `afterUpdate` por linha quando `individualHooks: true`; caso contrário, completar auditoria ao persistir sempre via instâncias (`reload` + `save`) ou garantir esse *flag*.

O atalho em `src/documentacao/Relacionamentos_FKs.md` não duplica conteúdo; serve apenas para redirects de documentação legada.
