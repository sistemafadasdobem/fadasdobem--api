# Tabela `leads`

Representa um **contacto pré-pagamento** oriundo do Chatwoot (WhatsApp / *widget* / outros canais), **antes** da existência de uma linha em `users`/`clients`. Separa prospectos de clientes pagantes mantendo **origem**, **UTM JSON** e **timeline de interação** preparados para PIX / Mercado Pago nas fases seguintes.

| Coluna | Tipo / Enum | Null | Observação |
|--------|-------------|-----|------------|
| `id` | UUID PK | não | Identificador interno |
| `chatwoot_contact_id` | STRING(64) | não | Id do contacto Chatwoot — **único entre registos não apagados** (`deleted_at IS NULL`) |
| `chatwoot_conversation_id` | STRING(64) | sim | Conversa actual ou última conhecida (actualizada a cada mensagem webhook) |
| `phone` | STRING(32) | sim | Telefone quando disponível no *payload* |
| `status` | `NEW` \| `QUALIFIED` \| `CONVERTED` \| `ABANDONED` | não | Estado do funil; novo contacto nasce em `NEW`; conversão formal → `CONVERTED` |
| `source` | STRING(64) | não | Canal macro deduzido (ex.: `whatsapp`, `website_widget`, `direct`) |
| `utm_data` | JSONB | não | `{ utm_* , gclid , fbclid … }` acumulado pelo webhook |
| `last_interaction_at` | TIMESTAMPTZ | sim | Actualizado em cada mensagem tratada pelo fluxo inbound |
| `pix_key_suggested` | STRING(256) | sim | Rascunho opcional solicitado antes do cadastro (check-out antecipado) |
| `openai_thread_id` | STRING(128) | sim | Continuidade **Threads API** (alias ao campo homónimo em `users`) antes da conversão |

## Segurança e auditoria

- **`paranoid: true`** — preserva histórico de tentativas e abandono para remarketing/análise; não remove linhas fisicamente nos *soft deletes*.

## Conversão para cliente

A função **`convertLeadToClient(leadId, userData)`** em `auth.service.js` executa transacção com:

1. Criação de `User` (+ `Client`) com `chatwoot_contact_id`, `chatwoot_conversation_id` e `openai_thread_id` copiados do *lead*.
2. Estado do *lead* → `CONVERTED`.
3. Opcional: `sessions` cuja `chatwoot_conversation_id` coincida passam a referenciar o novo `clients.id` quando existir conversa conhecida.

O **histórico literal de mensagens** permanece no Chatwoot; a plataforma só materializa o elo em `users.chatwoot_*`.

## Relação com `sessions`

Sem FK directa de `leads` para `sessions`: após conversão, **`sessions.client_id`** resolve o cliente real; o rasto de aquisição pode ser reconstruído via `users.chatwoot_contact_id` alinhado ao *lead* pré-conversão. Detalhe em `Relacionamentos_FKs.md`.
