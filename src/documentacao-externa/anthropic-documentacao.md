# Manual de Integração Técnica — Anthropic Messages API
**Versão:** Maio 2026 | **SDK:** `@anthropic-ai/sdk` | **Plataforma:** Node.js / Express

> Este documento é a **fonte de verdade** para integração do Claude como agente autônomo de atendimento com suporte a Function Calling. Baseado na documentação oficial da Anthropic (platform.claude.com/docs).

---

## Índice

1. [Modelos Disponíveis e Recomendados](#1-modelos-disponíveis-e-recomendados)
2. [Messages API — Estrutura de Requisição](#2-messages-api--estrutura-de-requisição)
3. [Function Calling (Tools)](#3-function-calling-tools)
4. [Gerenciamento de Contexto (Stateless)](#4-gerenciamento-de-contexto-stateless)
5. [Tratamento de Erros e Retry](#5-tratamento-de-erros-e-retry)
6. [Streaming de Resposta](#6-streaming-de-resposta)
7. [Exemplo Completo em Node.js](#7-exemplo-completo-em-nodejs)

---

## 1. Modelos Disponíveis e Recomendados

| Modelo | API ID | Uso ideal | Latência | Contexto | Preço (input/output por MTok) |
|---|---|---|---|---|---|
| **Claude Opus 4.7** | `claude-opus-4-7` | Tarefas complexas, raciocínio profundo, agentes | Moderada | 1M tokens | $5 / $25 |
| **Claude Sonnet 4.6** ✅ | `claude-sonnet-4-6` | **Melhor custo-benefício para agentes de atendimento** | Rápida | 1M tokens | $3 / $15 |
| **Claude Haiku 4.5** | `claude-haiku-4-5-20251001` | Triagem, respostas simples, alta frequência | Mais rápida | 200k tokens | $1 / $5 |

### Recomendação para seu caso de uso

Para um **agente de atendimento com Function Calling**, use **`claude-sonnet-4-6`**:
- Excelente compreensão de contexto longo (histórico do Chatwoot)
- Rápido o suficiente para tempo real
- Suporta até 64k tokens de output
- Custo viável em produção

```js
const MODEL = 'claude-sonnet-4-6'; // Use este como padrão
```

---

## 2. Messages API — Estrutura de Requisição

### Endpoint

```
POST https://api.anthropic.com/v1/messages
```

### Headers obrigatórios

```http
x-api-key: sk-ant-...
anthropic-version: 2023-06-01
Content-Type: application/json
```

### Estrutura completa da requisição

```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 4096,
  "system": "Você é um agente de atendimento da Fadas do Bem...",
  "messages": [
    { "role": "user",      "content": "Olá, qual meu saldo?" },
    { "role": "assistant", "content": "Deixa eu verificar para você." },
    { "role": "user",      "content": "Meu CPF é 123.456.789-00" }
  ],
  "tools": [...],
  "tool_choice": { "type": "auto" }
}
```

### Regras críticas do array `messages`

**1. Alternância obrigatória `user` → `assistant` → `user`**

```js
// ✅ CORRETO
messages = [
  { role: 'user',      content: 'Pergunta 1' },
  { role: 'assistant', content: 'Resposta 1' },
  { role: 'user',      content: 'Pergunta 2' },
]

// ❌ ERRO — dois roles iguais em sequência
messages = [
  { role: 'user', content: 'Pergunta 1' },
  { role: 'user', content: 'Pergunta 2' }, // 400: invalid role sequence
]
```

**2. A última mensagem SEMPRE deve ser `role: "user"`**

O Claude responde à última mensagem do usuário. Nunca envie o histórico terminando em `assistant`.

**3. O `system` prompt fica FORA do array `messages`**

```js
// ✅ CORRETO — system é um campo separado
{
  system: "Você é um agente de atendimento...",
  messages: [{ role: 'user', content: '...' }]
}

// ❌ ERRADO — system dentro do array
{
  messages: [
    { role: 'system', content: '...' }, // Não existe esse role
    { role: 'user', content: '...' }
  ]
}
```

**4. Content pode ser string ou array de blocos**

```js
// Forma simples (string)
{ role: 'user', content: 'Texto simples' }

// Forma completa (array de blocos) — necessária para tool_result
{ role: 'user', content: [
  { type: 'text', text: 'Texto' }
]}
```

---

## 3. Function Calling (Tools)

### 3.1 — Definindo uma Tool (JSON Schema)

```js
const tools = [
  {
    name: 'check_balance',
    description: 'Consulta o saldo e extrato de um cliente pelo CPF. Use quando o cliente perguntar sobre saldo, extrato ou movimentações.',
    input_schema: {
      type: 'object',
      properties: {
        cpf: {
          type: 'string',
          description: 'CPF do cliente no formato 000.000.000-00 ou apenas dígitos'
        },
        period: {
          type: 'string',
          enum: ['last_7_days', 'last_30_days', 'last_90_days'],
          description: 'Período do extrato. Padrão: last_30_days'
        }
      },
      required: ['cpf']
    }
  }
];
```

> **Dica:** Descrições claras e detalhadas fazem toda a diferença. O Claude decide SE e QUANDO usar a tool com base na `description`.

Adicione `strict: true` para garantir conformidade exata com o schema:

```js
{
  name: 'check_balance',
  strict: true, // Claude sempre segue o schema à risca
  description: '...',
  input_schema: { ... }
}
```

---

### 3.2 — Detectando `stop_reason: "tool_use"`

Quando o Claude decide usar uma tool, a resposta tem essa estrutura:

```json
{
  "id": "msg_01...",
  "type": "message",
  "role": "assistant",
  "stop_reason": "tool_use",
  "content": [
    {
      "type": "text",
      "text": "Vou verificar seu saldo agora."
    },
    {
      "type": "tool_use",
      "id": "toolu_01XyZ...",
      "name": "check_balance",
      "input": {
        "cpf": "123.456.789-00",
        "period": "last_30_days"
      }
    }
  ]
}
```

**Como detectar no código:**

```js
if (response.stop_reason === 'tool_use') {
  const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
  // Pode haver múltiplas tools em paralelo
  for (const toolUse of toolUseBlocks) {
    const result = await executeTool(toolUse.name, toolUse.input);
    // ... retornar para o Claude
  }
}
```

---

### 3.3 — Retornando o `tool_result` (fluxo correto)

Após executar a função, você deve enviar o resultado de volta ao Claude adicionando **duas mensagens** ao histórico:

1. A resposta do Claude (que contém o `tool_use`) — role `assistant`
2. O resultado da tool — role `user` com `tool_result`

```js
// Passo 1: Adicionar a resposta do Claude ao histórico
messages.push({
  role: 'assistant',
  content: response.content  // array de blocos original
});

// Passo 2: Adicionar o resultado da tool
messages.push({
  role: 'user',
  content: [
    {
      type: 'tool_result',
      tool_use_id: 'toolu_01XyZ...',  // ID do bloco tool_use original
      content: JSON.stringify({
        balance: 1250.75,
        currency: 'BRL',
        last_transaction: '2026-05-05'
      })
    }
  ]
});

// Passo 3: Chamar a API novamente para o Claude finalizar
const finalResponse = await anthropic.messages.create({
  model: MODEL,
  max_tokens: 4096,
  system: systemPrompt,
  tools: tools,
  messages: messages
});
```

**⚠️ Regra crítica de formatação do `tool_result`:**

```js
// ✅ CORRETO — tool_result ANTES de qualquer texto
{
  role: 'user',
  content: [
    { type: 'tool_result', tool_use_id: 'toolu_01...', content: '...' },
    { type: 'text', text: 'Texto adicional opcional depois' }
  ]
}

// ❌ ERRO — texto antes do tool_result gera 400
{
  role: 'user',
  content: [
    { type: 'text', text: 'Aqui está o resultado:' }, // ❌
    { type: 'tool_result', tool_use_id: 'toolu_01...', content: '...' }
  ]
}
```

**Retornando erro de tool:**

```js
{
  type: 'tool_result',
  tool_use_id: 'toolu_01...',
  is_error: true,
  content: 'Erro: CPF não encontrado no sistema. Verifique o número informado.'
}
```

---

### 3.4 — Multi-turn: Claude chama várias tools em sequência

O loop agentico continua enquanto `stop_reason === 'tool_use'`. O padrão correto é um loop:

```js
async function runAgentLoop(userMessage, history, systemPrompt) {
  const messages = [
    ...history,
    { role: 'user', content: userMessage }
  ];

  let MAX_ITERATIONS = 10; // segurança anti-loop infinito

  while (MAX_ITERATIONS-- > 0) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      tools: tools,
      messages
    });

    // Adiciona resposta do Claude ao histórico
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      // Claude terminou — extrair texto da resposta final
      const text = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');
      return { text, messages };
    }

    if (response.stop_reason === 'tool_use') {
      const toolResults = [];

      for (const block of response.content.filter(b => b.type === 'tool_use')) {
        let result;
        try {
          result = await executeTool(block.name, block.input);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result)
          });
        } catch (err) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            is_error: true,
            content: `Erro ao executar ${block.name}: ${err.message}`
          });
        }
      }

      // Adiciona todos os tool_results como uma única mensagem user
      messages.push({ role: 'user', content: toolResults });
      continue; // próxima iteração
    }

    // stop_reason inesperado (max_tokens, etc)
    break;
  }

  throw new Error('Agent loop exceeded max iterations or unexpected stop_reason');
}
```

---

### 3.5 — `tool_choice`: controlando quando usar tools

```js
// auto (padrão) — Claude decide se usa ou não
tool_choice: { type: 'auto' }

// any — Claude DEVE usar alguma tool
tool_choice: { type: 'any' }

// tool específica — forçar uso de uma tool específica
tool_choice: { type: 'tool', name: 'check_balance' }

// none — Claude nunca usa tools nessa chamada
tool_choice: { type: 'none' }
```

---

## 4. Gerenciamento de Contexto (Stateless)

A API é **stateless**: você deve enviar o histórico completo em cada requisição.

### 4.1 — Formatando histórico do Chatwoot

Ao buscar mensagens da API do Chatwoot, converta para o formato do Claude:

```js
function formatChatwootHistory(chatwootMessages) {
  const formatted = [];

  for (const msg of chatwootMessages) {
    // message_type: 0 = incoming (cliente), 1 = outgoing (agente/bot)
    // Ignore mensagens privadas (private: true) — são notas internas
    if (msg.private) continue;

    const role = msg.message_type === 0 ? 'user' : 'assistant';
    const content = msg.content?.trim();

    if (!content) continue;

    // Evitar duplicata de role — merge com anterior se igual
    const last = formatted[formatted.length - 1];
    if (last && last.role === role) {
      // Concatena ao bloco anterior em vez de criar novo
      last.content += `\n${content}`;
      continue;
    }

    formatted.push({ role, content });
  }

  // REGRA CRÍTICA: histórico nunca pode terminar em 'assistant'
  // A nova mensagem do usuário será adicionada depois
  while (formatted.length > 0 && formatted[formatted.length - 1].role === 'assistant') {
    formatted.pop();
  }

  return formatted;
}
```

### 4.2 — Injetando nova mensagem do usuário

```js
async function handleIncomingMessage(chatwootConversation, newUserMessage) {
  const history = formatChatwootHistory(chatwootConversation.messages);

  // A nova mensagem do usuário é adicionada no loop do agente
  const { text, messages } = await runAgentLoop(
    newUserMessage,
    history,
    SYSTEM_PROMPT
  );

  return text;
}
```

### 4.3 — Limitar tamanho do histórico (janela deslizante)

Para evitar estouro de contexto em conversas longas:

```js
function limitHistory(messages, maxMessages = 40) {
  // Mantém as N mensagens mais recentes
  // Garante que a primeira mensagem seja sempre 'user'
  let sliced = messages.slice(-maxMessages);
  while (sliced.length > 0 && sliced[0].role !== 'user') {
    sliced = sliced.slice(1);
  }
  return sliced;
}
```

---

## 5. Tratamento de Erros e Retry

### 5.1 — Erros HTTP esperados da Anthropic

| HTTP | Código | Causa | Ação |
|---|---|---|---|
| `400` | `invalid_request_error` | JSON malformado, role inválido, tool_result fora de ordem | **Não retry** — corrigir código |
| `401` | `authentication_error` | API key inválida ou expirada | **Não retry** — verificar key |
| `403` | `permission_error` | Sem acesso ao modelo ou feature | **Não retry** — verificar plano |
| `404` | `not_found_error` | Modelo inexistente | **Não retry** — corrigir model ID |
| `429` | `rate_limit_error` | Rate limit atingido | **Retry com backoff** |
| `500` | `api_error` | Erro interno Anthropic | **Retry** |
| `529` | `overloaded_error` | API sobrecarregada | **Retry com backoff maior** |

### 5.2 — Implementação de Retry com Exponential Backoff

```js
async function callAnthropicWithRetry(params, maxRetries = 3) {
  const RETRYABLE_STATUS = [429, 500, 502, 503, 529];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await anthropic.messages.create(params);
    } catch (err) {
      const status = err.status;
      const isRetryable = RETRYABLE_STATUS.includes(status);

      if (!isRetryable || attempt === maxRetries) {
        // Log do erro para debug
        console.error(`Anthropic API Error [${status}]:`, err.message, {
          error_type: err.error?.type,
          request_id: err.headers?.['request-id']
        });
        throw err;
      }

      // Exponential backoff: 1s, 2s, 4s
      const delay = Math.pow(2, attempt) * 1000;

      // Respeitar o header Retry-After se disponível (rate limit)
      const retryAfter = err.headers?.['retry-after'];
      const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : delay;

      console.warn(`Anthropic retry ${attempt + 1}/${maxRetries} em ${waitMs}ms (status ${status})`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
}
```

### 5.3 — Extrair `request-id` para suporte

```js
try {
  const response = await anthropic.messages.create(params);
} catch (err) {
  // Sempre logar o request-id para diagnóstico com a Anthropic
  const requestId = err.headers?.['request-id'] ?? err.request_id;
  console.error('Anthropic error. Request ID:', requestId);
}
```

---

## 6. Streaming de Resposta

Use streaming quando quiser enviar a resposta ao usuário em tempo real (reduz percepção de latência).

```js
const stream = anthropic.messages.stream({
  model: MODEL,
  max_tokens: 4096,
  system: SYSTEM_PROMPT,
  messages: messages,
  tools: tools
});

// Receber chunks de texto
stream.on('text', (text) => {
  process.stdout.write(text); // ou enviar via SSE/WebSocket
});

// Resposta completa ao final
const finalResponse = await stream.finalMessage();

if (finalResponse.stop_reason === 'tool_use') {
  // Processar tool use normalmente (veja seção 3)
}
```

> Para atendimento via Chatwoot, **streaming geralmente não é necessário** — o Chatwoot recebe a mensagem completa. Use apenas se implementar um chat em tempo real próprio.

---

## 7. Exemplo Completo em Node.js

```bash
npm install @anthropic-ai/sdk
```

```js
// agent.js
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const MODEL = 'claude-sonnet-4-6';

// ─────────────────────────────────────────
// SYSTEM PROMPT
// ─────────────────────────────────────────
const SYSTEM_PROMPT = `Você é um agente de atendimento da Fadas do Bem.
Seu objetivo é ajudar os clientes de forma clara, educada e eficiente.
Quando precisar de informações sobre saldo ou conta do cliente, use as ferramentas disponíveis.
Sempre confirme os dados antes de executar qualquer operação.
Responda sempre em português brasileiro.`;

// ─────────────────────────────────────────
// DEFINIÇÃO DAS TOOLS
// ─────────────────────────────────────────
const tools = [
  {
    name: 'check_balance',
    description: 'Consulta saldo e extrato do cliente pelo CPF. Use quando o cliente perguntar sobre saldo, extrato ou movimentações financeiras.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        cpf: {
          type: 'string',
          description: 'CPF do cliente (apenas dígitos ou formato 000.000.000-00)'
        },
        period: {
          type: 'string',
          enum: ['last_7_days', 'last_30_days', 'last_90_days'],
          description: 'Período do extrato. Default: last_30_days'
        }
      },
      required: ['cpf']
    }
  },
  {
    name: 'get_order_status',
    description: 'Consulta o status de um pedido pelo número do pedido.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        order_id: {
          type: 'string',
          description: 'Número do pedido (ex: PED-12345)'
        }
      },
      required: ['order_id']
    }
  }
];

// ─────────────────────────────────────────
// IMPLEMENTAÇÃO DAS TOOLS (sua lógica de negócio)
// ─────────────────────────────────────────
async function executeTool(name, input) {
  switch (name) {
    case 'check_balance': {
      // Aqui você faz a chamada real ao seu sistema
      // Exemplo mockado:
      const cpf = input.cpf.replace(/\D/g, '');
      return {
        cpf: cpf,
        name: 'Maria Silva',
        balance: 1250.75,
        currency: 'BRL',
        period: input.period ?? 'last_30_days',
        transactions: [
          { date: '2026-05-05', description: 'Compra Online', amount: -89.90 },
          { date: '2026-05-03', description: 'Recebimento', amount: 1500.00 }
        ]
      };
    }

    case 'get_order_status': {
      return {
        order_id: input.order_id,
        status: 'em_transporte',
        estimated_delivery: '2026-05-08',
        tracking_code: 'BR123456789BR'
      };
    }

    default:
      throw new Error(`Tool desconhecida: ${name}`);
  }
}

// ─────────────────────────────────────────
// RETRY WRAPPER
// ─────────────────────────────────────────
async function callAnthropicWithRetry(params, maxRetries = 3) {
  const RETRYABLE = [429, 500, 502, 503, 529];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await anthropic.messages.create(params);
    } catch (err) {
      if (!RETRYABLE.includes(err.status) || attempt === maxRetries) throw err;
      const delay = Math.pow(2, attempt) * 1000;
      const waitMs = err.headers?.['retry-after']
        ? parseInt(err.headers['retry-after']) * 1000
        : delay;
      console.warn(`Retry ${attempt + 1}/${maxRetries} em ${waitMs}ms`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
}

// ─────────────────────────────────────────
// LOOP AGENTICO PRINCIPAL
// ─────────────────────────────────────────
async function runAgentLoop(userMessage, history = []) {
  const messages = [
    ...history,
    { role: 'user', content: userMessage }
  ];

  let iterations = 0;
  const MAX_ITERATIONS = 10;

  while (iterations++ < MAX_ITERATIONS) {
    const response = await callAnthropicWithRetry({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: tools,
      tool_choice: { type: 'auto' },
      messages
    });

    // Adiciona resposta do Claude ao histórico local
    messages.push({ role: 'assistant', content: response.content });

    // ── Resposta final ──
    if (response.stop_reason === 'end_turn') {
      const text = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');
      return { text, messages };
    }

    // ── Claude quer usar tools ──
    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      const toolResults = [];

      for (const block of toolUseBlocks) {
        console.log(`[Tool] Executando: ${block.name}`, block.input);

        try {
          const result = await executeTool(block.name, block.input);
          console.log(`[Tool] Resultado: ${block.name}`, result);

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result)
          });
        } catch (err) {
          console.error(`[Tool] Erro em ${block.name}:`, err.message);

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            is_error: true,
            content: `Erro: ${err.message}`
          });
        }
      }

      // tool_results SEMPRE devem ser o primeiro item do content
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // stop_reason inesperado (ex: max_tokens)
    console.warn('stop_reason inesperado:', response.stop_reason);
    break;
  }

  throw new Error('Agent loop: máximo de iterações atingido');
}

// ─────────────────────────────────────────
// FORMATADOR DE HISTÓRICO DO CHATWOOT
// ─────────────────────────────────────────
function formatChatwootHistory(chatwootMessages) {
  const formatted = [];

  for (const msg of chatwootMessages) {
    if (msg.private) continue; // ignorar notas internas
    const content = msg.content?.trim();
    if (!content) continue;

    // message_type 0 = cliente (user), 1 = agente/bot (assistant)
    const role = msg.message_type === 0 ? 'user' : 'assistant';

    const last = formatted[formatted.length - 1];
    if (last && last.role === role) {
      last.content += `\n${content}`;
      continue;
    }

    formatted.push({ role, content });
  }

  // Histórico nunca pode terminar em 'assistant'
  while (formatted.length && formatted.at(-1).role === 'assistant') {
    formatted.pop();
  }

  // Limitar a últimas 40 mensagens
  return formatted.slice(-40);
}

// ─────────────────────────────────────────
// EXEMPLO DE USO (simula recebimento do Chatwoot)
// ─────────────────────────────────────────
async function main() {
  // Histórico vindo do Chatwoot (mockado)
  const chatwootMessages = [
    { message_type: 0, content: 'Oi, preciso de ajuda', private: false },
    { message_type: 1, content: 'Olá! Como posso ajudar?', private: false },
    { message_type: 0, content: 'Quero saber meu saldo', private: false },
    { message_type: 1, content: 'Me informe seu CPF por favor.', private: false },
  ];

  const history = formatChatwootHistory(chatwootMessages);
  const newMessage = 'Meu CPF é 123.456.789-00';

  console.log('─── Iniciando agente ───');
  console.log('Usuário:', newMessage);
  console.log('');

  try {
    const { text } = await runAgentLoop(newMessage, history);
    console.log('─── Resposta final do agente ───');
    console.log(text);
  } catch (err) {
    console.error('Erro no agente:', err.message);
  }
}

main();
```

---

## Referência Rápida — Erros Comuns

| Erro | Causa provável | Solução |
|---|---|---|
| `invalid role sequence` | Dois `user` ou `assistant` consecutivos | Usar `formatChatwootHistory` com merge |
| `tool_use ids found without tool_result` | tool_result não foi enviado após tool_use | Sempre fechar o loop no próximo turn |
| `text before tool_result` | Texto vindo antes do tool_result no content | Colocar tool_result SEMPRE primeiro |
| `400 invalid_request_error` | Schema incorreto ou campo faltando | Conferir `input_schema` e `required` |
| `529 overloaded_error` | API da Anthropic sobrecarregada | Retry com backoff de até 30s |

---

## Links de Referência

- Documentação oficial: https://platform.claude.com/docs
- Models overview: https://platform.claude.com/docs/en/about-claude/models/overview
- Tool use: https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview
- Handle tool calls: https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls
- Streaming: https://platform.claude.com/docs/en/build-with-claude/streaming
- SDK npm: https://www.npmjs.com/package/@anthropic-ai/sdk