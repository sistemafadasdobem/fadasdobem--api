# Motor de Fluxo Claude (Anthropic × Chatwoot)

Este documento descreve a arquitectura **Flow Engine**: passos configuráveis em ficheiro, persistência por conversa Chatwoot, e texto de produto separado para facilitar alterações pela equipa.

## Visão geral

| Camada | Ficheiro | Responsabilidade |
|--------|-----------|------------------|
| Configuração de estados | `anthropic.workflow.config.js` | Estados **T1…T9**, **T1b**, **T1c**, **T2v**, **T3b**, **T3c**, **T8wa**, **`leads_agenda`** e **`CONVERSATION_LIVRE`**, espelhando o documento **03d-A · Lead Nova Cliente · WhatsApp** (HTML versão 1.2). |
| Guiões + placeholders | `anthropic.messages.js` | **`FLOW_MESSAGES`** (03d-A): texto + **`buttons`**. **`getMessage(state, context)`** (`{{valor_pagamento}}`, `{{pix_email}}`, …). |
| Persistência | `src/features/anthropic/anthropic.workflow.store.js` | **Postgres** como fonte de verdade (`bot_conversation_flow_states`). **Redis** opcional como cache quando `REDIS_URL` ou `REDIS_HOST` existe. |
| Interpretação | `anthropic.workflow.engine.js` | Resolve estado, chama **`getMessage(messageKey)`** + placeholders (`opts.context`), monta **`system`** e valida transições. |
| Orquestração Claude | `src/features/anthropic/anthropic.service.js` | `generateReplyForChatwoot(...)` — carrega estado, monta tools (incl. `set_flow_state` dinâmico), ciclo Messages API + Tool Use. |
| Ferramentas (schema Anthropic) | `src/providers/anthropic/anthropic.tools.js` | Registo (`check_balance`, construtor de `set_flow_state` com `enum` dos `next_states` do passo). |
| Entrada HTTP | `src/features/chatwoot/chatwoot.service.js` | Chama `getCurrentFlowState` (log) e `generateReplyForChatwoot` quando `ACTIVE_AI_PROVIDER=anthropic`. |

## Transições

- O modelo só pode avançar com a tool **`set_flow_state`** com `next_state` **permitido em** `next_states` do estado actual.
- Critério de “quando mudar” combina **`next_states`** (permitidos) com o mapa **`transition_after_message_completed`** / `NEXT_STATE_AFTER_MESSAGE` (**happy path** sugerido após guião cumprido). A IA só grava quando chama **`set_flow_state`**.
- Dados opcionais são acumulados em `slots.transition_notes` quando o modelo envia `notes_for_slots`.

## Alterar o fluxo sem reescrever o serviço

1. **Novo passo:** adicionar chave em `anthropic.workflow.config.js` → `states` e ligar `next_states` aos estados vizinhos.
2. **Nova copy:** editar `anthropic.messages.js` e/ou o `system_prompt` do estado na config.
3. **Nova ferramenta:** registar em `anthropic.tools.js` (`TOOL_REGISTRY`) e referenciar pelo nome no array `tools` do estado.

Redeploy da API aplica a config; migrações só são necessárias se o esquema persistido mudar.

## Compatibilidade OpenAI e chamadas sem Chatwoot

- **`generateReply(historico, mensagemUsuario)`** (Anthropic) usa o estado conceptual `CONVERSATION_LIVRE` **sem** injecção de `set_flow_state` — evita persistir transições sem `accountId/conversationId`.
- O webhook Chatwoot usa **`generateReplyForChatwoot`** com estado persistido.

## Referência de dados — `bot_conversation_flow_states`

Índice único `(account_id, conversation_id, provider)`. Ver migração `20260306120000-create-bot-conversation-flow-states.js`.
