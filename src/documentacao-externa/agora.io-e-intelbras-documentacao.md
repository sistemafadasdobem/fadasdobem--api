# Guia Técnico: Controle de Estado e Tempo de Chamadas
## Agora.io + Intelbras Wide Cloud — Backend Node.js/Express

---

## PARTE 1 — AGORA.IO (Video/Voice SDK)

---

### 1.1 — Geração de RTC Token no Backend (Node.js)

O Agora usa o conceito de **AccessToken2** (versão atual). A biblioteca oficial é o pacote `agora-access-token`.

**Instalação:**
```bash
npm install agora-access-token
```

**Código de exemplo — endpoint de geração de token:**

```javascript
// tokenService.js
const { RtcTokenBuilder, RtcRole } = require('agora-access-token');

const APP_ID = process.env.AGORA_APP_ID;
const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE;

/**
 * Gera um RTC Token para um usuário específico em um canal específico.
 * @param {string} channelName - Nome do canal (ex: "consulta_user123")
 * @param {number} uid - UID numérico do usuário (integer)
 * @param {'publisher'|'audience'} role - Role do usuário
 * @param {number} expirationSecs - Tempo de vida do token em segundos
 */
function generateRtcToken(channelName, uid, role = 'publisher', expirationSecs = 3600) {
  const rtcRole = role === 'publisher' ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;

  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpiredTs = currentTimestamp + expirationSecs;

  const token = RtcTokenBuilder.buildTokenWithUid(
    APP_ID,
    APP_CERTIFICATE,
    channelName,
    uid,
    rtcRole,
    privilegeExpiredTs
  );

  return token;
}

// Express route
app.get('/api/token', (req, res) => {
  const { channelName, uid, role } = req.query;

  if (!channelName || !uid) {
    return res.status(400).json({ error: 'channelName e uid são obrigatórios' });
  }

  const token = generateRtcToken(channelName, parseInt(uid), role);

  return res.json({
    token,
    channelName,
    uid: parseInt(uid),
    expiresAt: Math.floor(Date.now() / 1000) + 3600
  });
});
```

**Pontos críticos:**
- O token é válido **somente para o par `channelName + uid`** com que foi gerado.
- Use um `uid` numérico e guarde o mapeamento `uid → userId` no banco para correlacionar com webhooks.
- Gere tokens com expiração curta (ex: 3600s) e implemente renovação pelo cliente antes de expirar.

---

### 1.2 — Webhooks NCS (Notification Center Service)

O NCS é configurado no **Agora Console** (aba Notifications do projeto). Você fornece uma URL HTTPS e escolhe os eventos. O Agora envia um `POST` HTTPS para o seu webhook, e o servidor deve responder com `200 OK` em até 10 segundos — caso contrário o Agora reenvia a notificação imediatamente.

**Eventos relevantes para o perfil COMMUNICATION:**

| eventType | Significado | Ação no Backend |
|---|---|---|
| `103` | Usuário **entrou** no canal | **Inicia cronômetro** |
| `104` | Usuário **saiu/desconectou** do canal | **Para cronômetro** |
| `111` | Canal criado (primeiro usuário entrou) | Registrar sessão |
| `112` | Canal destruído (último usuário saiu) | Finalizar sessão |

**Estrutura do payload (eventos 103 e 104):**

```json
{
  "noticeId": "2000001428:4330:103",
  "productId": 1,
  "eventType": 103,
  "notifyMs": 1712345678000,
  "payload": {
    "channelName": "consulta_user123",
    "uid": 589517928,
    "platform": 1,
    "clientType": 1,
    "clientSeq": 1,
    "ts": 1712345678
  }
}
```

Para o evento `104` (saída), o payload inclui adicionalmente o campo `reason`:

| reason | Significado |
|---|---|
| `1` | Saída normal (usuário desligou) |
| `3` | Timeout de conectividade (queda de internet) |
| `4` | Banido pelo servidor (kick via API — saldo zerado) |

**Handler Node.js com verificação de assinatura:**

```javascript
const crypto = require('crypto');

const NCS_SECRET = process.env.AGORA_NCS_SECRET;

// Middleware de verificação de assinatura Agora
function verifyAgoraSignature(req, res, next) {
  const signature = req.headers['agora-signature-v2'];
  const rawBody = req.rawBody; // requer middleware que preserve rawBody

  const expectedSig = crypto
    .createHmac('sha256', NCS_SECRET)
    .update(rawBody)
    .digest('hex');

  if (signature !== expectedSig) {
    return res.status(401).json({ error: 'Assinatura inválida' });
  }
  next();
}

app.post('/webhooks/agora/ncs', verifyAgoraSignature, async (req, res) => {
  // IMPORTANTE: responder 200 imediatamente para o Agora
  res.status(200).json({ ok: true });

  const { eventType, payload } = req.body;
  const { channelName, uid, ts } = payload;

  if (eventType === 103) {
    await handleUserJoined(channelName, uid, ts);
  } else if (eventType === 104) {
    await handleUserLeft(channelName, uid, ts, payload.reason);
  }
});

async function handleUserJoined(channelName, uid, ts) {
  const session = await SessionModel.findOne({ channelName, agoraUid: uid });
  if (!session) return;

  await SessionModel.updateOne(
    { _id: session._id },
    { startedAt: new Date(ts * 1000), status: 'ACTIVE' }
  );
  console.log(`[BILLING] Sessão iniciada: ${channelName}, uid: ${uid}`);
}

async function handleUserLeft(channelName, uid, ts, reason) {
  const session = await SessionModel.findOne({ channelName, agoraUid: uid, status: 'ACTIVE' });
  if (!session) return;

  const durationSeconds = ts - Math.floor(session.startedAt.getTime() / 1000);
  const minutesBilled = Math.ceil(durationSeconds / 60);

  await SessionModel.updateOne(
    { _id: session._id },
    {
      endedAt: new Date(ts * 1000),
      durationSeconds,
      minutesBilled,
      endReason: reason,
      status: 'COMPLETED'
    }
  );

  await UserWallet.decrementBalance(session.userId, minutesBilled * PRICE_PER_MINUTE);
  console.log(`[BILLING] Sessão encerrada: ${durationSeconds}s, ${minutesBilled} min debitados`);
}
```

> ⚠️ **Atenção:** Use o campo `clientSeq` para ordenar eventos que cheguem fora de sequência. Se `clientSeq` do novo evento for menor que o do último processado, ignore-o.

---

### 1.3 — Kickar/Desconectar um Usuário Remotamente (Saldo Zerado)

O endpoint oficial é `POST https://api.sd-rtn.com/dev/v1/kicking-rule`. O usuário recebe o callback `CONNECTION_CHANGED_BANNED_BY_SERVER` no SDK do cliente imediatamente.

**Estratégia:** `cname + uid` com `time = 0` — derruba imediatamente sem banimento permanente (pode entrar novamente).

```javascript
const axios = require('axios');

const AGORA_CUSTOMER_ID = process.env.AGORA_CUSTOMER_ID;
const AGORA_CUSTOMER_SECRET = process.env.AGORA_CUSTOMER_SECRET;
const AGORA_APP_ID = process.env.AGORA_APP_ID;

function getAgoraAuthHeader() {
  const credentials = Buffer.from(`${AGORA_CUSTOMER_ID}:${AGORA_CUSTOMER_SECRET}`).toString('base64');
  return `Basic ${credentials}`;
}

/**
 * Expulsa um usuário específico de um canal específico.
 * time = 0 → kick imediato, sem banimento permanente.
 */
async function kickUserFromChannel(channelName, uid) {
  try {
    const response = await axios.post(
      'https://api.sd-rtn.com/dev/v1/kicking-rule',
      {
        appid: AGORA_APP_ID,
        cname: channelName,
        uid: uid,           // integer
        ip: '',
        time: 0,            // 0 = kick imediato
        privileges: ['join_channel']
      },
      {
        headers: {
          'Authorization': getAgoraAuthHeader(),
          'Content-Type': 'application/json'
        },
        timeout: 20000 // Agora recomenda >= 20s de timeout para este endpoint
      }
    );

    console.log(`[KICK] uid=${uid} expulso do canal=${channelName}. RuleID: ${response.data.id}`);
    return response.data;
  } catch (err) {
    console.error('[KICK] Falha ao expulsar usuário:', err.response?.data || err.message);
    throw err;
  }
}

// Motor de cobrança:
async function billingTick(sessionId) {
  const session = await SessionModel.findById(sessionId);
  const wallet = await UserWallet.findOne({ userId: session.userId });

  if (wallet.balance <= 0) {
    console.log(`[BILLING] Saldo zerado para userId=${session.userId}. Encerrando chamada.`);
    await kickUserFromChannel(session.channelName, session.agoraUid);
    // O NCS vai disparar o evento 104 → que finaliza a sessão e debita o saldo
  }
}
```

> ⚠️ **Salve o `ruleId`** retornado pelo POST para poder deletar ou atualizar a regra posteriormente. O kick via API deve ser tratado como medida de último recurso — notifique o usuário via signaling antes de derrubar.

---

## PARTE 2 — INTELBRAS WIDE CLOUD (Telefonia PABX)

---

### 2.1 — Aviso Importante: Limitação da API Pública da Intelbras

Após pesquisa na documentação oficial (INC Cloud API v1.0.0, abril/2025), a API pública Intelbras cobre exclusivamente **gerenciamento de rede Wi-Fi e dispositivos** — não há API REST pública para click-to-call, controle de chamadas ou webhooks de estado.

O Wide Cloud é construído sobre **Asterisk**, e o caminho de integração programática é via:

- **AMI (Asterisk Manager Interface)** — socket TCP na porta `5038`
- **ARI (Asterisk REST Interface)** — se habilitado na instalação

> 💡 **Recomendação:** Para produção com SLA, avalie **Twilio**, **Vonage** ou **Zenvia**, que oferecem webhooks REST nativos para todos os estados de chamada. Se o cliente já tem infraestrutura Wide Cloud, use o guia AMI abaixo.

---

### 2.2 — Click-to-Call via AMI (Originate)

```bash
npm install asterisk-ami
```

```javascript
const AmiClient = require('asterisk-ami');

const ami = new AmiClient({
  host: process.env.WIDECLOUD_AMI_HOST,
  port: 5038,
  login: process.env.WIDECLOUD_AMI_USER,
  password: process.env.WIDECLOUD_AMI_PASS,
  reconnect: true,
  reconnectTimeout: 5000
});

ami.connect();

/**
 * Origina uma chamada click-to-call:
 * 1. Liga para o ramal da taróloga (Channel)
 * 2. Quando ela atender, o sistema liga para o cliente (Exten)
 */
async function originateCall(tarologaExtension, clientPhoneNumber, uniqueCallId) {
  return new Promise((resolve, reject) => {
    ami.action({
      Action: 'Originate',
      Channel: `SIP/${tarologaExtension}`,        // Ramal da taróloga
      Context: 'from-internal',                    // Contexto do dialplan
      Exten: clientPhoneNumber,                    // Número do cliente
      Priority: 1,
      CallerID: `Consulta <${tarologaExtension}>`,
      Timeout: 30000,                              // 30s timeout de ringback
      Variable: `CALL_SESSION_ID=${uniqueCallId}`,
      Async: 'true',
      ActionID: `orig-${uniqueCallId}`
    }, (err, response) => {
      if (err) return reject(err);
      resolve(response);
    });
  });
}
```

---

### 2.3 — Webhooks de Estado via AMI Events

Os eventos AMI substituem webhooks HTTP para a Intelbras. Os eventos críticos para o motor de cobrança são:

| Evento AMI | Significado | Ação no Backend |
|---|---|---|
| `DialBegin` | Ramal da taróloga está tocando | Log / notificação |
| `Bridge` | **Chamada atendida — ambos conectados** | **Inicia cronômetro** |
| `Hangup` | **Chamada encerrada** | **Para cronômetro + debita** |

```javascript
ami.on('event', (event) => {
  switch (event.Event) {
    case 'DialBegin':
      console.log(`[CALL] Ramal chamando: ${event.Channel}`);
      break;

    case 'Bridge':
      // MOMENTO CRÍTICO: taróloga atendeu — iniciar cobrança
      handleCallAnswered(event);
      break;

    case 'Hangup':
      // MOMENTO CRÍTICO: chamada encerrada — finalizar sessão
      handleCallHangup(event);
      break;
  }
});

async function handleCallAnswered(event) {
  await CallSession.updateOne(
    { asteriskUniqueId: event.Uniqueid },
    {
      answeredAt: new Date(),
      status: 'ACTIVE',
      asteriskChannel: event.Channel,
      bridgeId: event.BridgeUniqueid
    }
  );
  console.log(`[BILLING] Chamada atendida. UniqueID: ${event.Uniqueid}`);
}

async function handleCallHangup(event) {
  const session = await CallSession.findOne({
    asteriskUniqueId: event.Uniqueid,
    status: 'ACTIVE'
  });
  if (!session) return;

  const durationSeconds = Math.floor((Date.now() - session.answeredAt.getTime()) / 1000);
  const minutesBilled = Math.ceil(durationSeconds / 60);

  await CallSession.updateOne(
    { _id: session._id },
    {
      endedAt: new Date(),
      durationSeconds,
      minutesBilled,
      hangupCause: event.Cause,
      hangupCauseTxt: event['Cause-txt'],
      status: 'COMPLETED'
    }
  );

  await UserWallet.decrementBalance(session.userId, minutesBilled * PRICE_PER_MINUTE);
  console.log(`[BILLING] Encerrada. Causa: ${event['Cause-txt']}. ${minutesBilled} min cobrados.`);
}
```

**Payload real do evento `Hangup` via AMI:**
```json
{
  "Event": "Hangup",
  "Channel": "SIP/200-00000a6a",
  "ChannelState": "6",
  "ChannelStateDesc": "Up",
  "CallerIDNum": "11999991234",
  "Uniqueid": "1712345678.42",
  "Linkedid": "1712345678.42",
  "Cause": "16",
  "Cause-txt": "Normal Clearing"
}
```

**Códigos de causa Q.850 relevantes:**

| Código | Significado |
|---|---|
| `16` | Normal Clearing (desligamento normal) |
| `17` | User Busy (ocupado) |
| `19` | No Answer (não atendeu) |
| `31` | Normal, Unspecified (queda/problema de rede) |

---

### 2.4 — Desligar Chamada Remotamente (Saldo Zerado)

```javascript
/**
 * Derruba uma chamada ativa pelo nome do canal Asterisk.
 * O evento Hangup AMI será disparado automaticamente → finalizando a sessão.
 */
async function hangupCall(channelName) {
  return new Promise((resolve, reject) => {
    ami.action({
      Action: 'Hangup',
      Channel: channelName,   // Ex: "SIP/200-00000a6a" — obtido no evento Bridge
      ActionID: `hangup-${Date.now()}`
    }, (err, response) => {
      if (err) return reject(err);
      console.log(`[HANGUP] Canal ${channelName} derrubado:`, response.Message);
      resolve(response);
    });
  });
}

// Motor de cobrança (roda a cada 10-30s via setInterval ou job)
async function billingTick(sessionId) {
  const session = await CallSession.findById(sessionId);
  const wallet = await UserWallet.findOne({ userId: session.userId });

  if (wallet.balance <= 0) {
    console.log(`[BILLING] Saldo zerado! Derrubando: ${session.asteriskChannel}`);
    await hangupCall(session.asteriskChannel);
    // Evento Hangup AMI → aciona handleCallHangup automaticamente
  }
}
```

---

## PARTE 3 — Arquitetura de Estado Unificada

```
                       ┌─────────────────────────────────────────────┐
                       │           MOTOR DE BILLING (Node.js)        │
                       │                                              │
  Agora NCS ──────►    │  eventType=103 → startSession(uid, channel)  │
  (evento 103/104)     │  eventType=104 → endSession(uid, channel)    │
                       │                                              │
  AMI Events ──────►   │  Bridge    → startSession(uniqueid)          │
  (Bridge/Hangup)      │  Hangup    → endSession(uniqueid)            │
                       │                                              │
                       │  ┌────────────────────────────────────────┐ │
                       │  │  Billing Interval (setInterval ~10s)   │ │
                       │  │  → Checar saldo de sessões ativas      │ │
                       │  │  → Se balance ≤ 0:                     │ │
                       │  │    Agora:     POST /kicking-rule        │ │
                       │  │    Intelbras: AMI Action Hangup         │ │
                       │  └────────────────────────────────────────┘ │
                       └─────────────────────────────────────────────┘
```

---

### Schema MongoDB Unificado (`CallSession`)

```javascript
// models/CallSession.js
const schema = new mongoose.Schema({
  userId:   { type: ObjectId, ref: 'User', required: true },
  platform: { type: String, enum: ['agora', 'intelbras'], required: true },

  // Agora
  channelName: String,
  agoraUid:    Number,

  // Intelbras AMI
  asteriskUniqueId: String,
  asteriskChannel:  String,   // Ex: "SIP/200-00000a6a"
  bridgeId:         String,

  // Estado e cobrança
  status: {
    type: String,
    enum: ['PENDING', 'ACTIVE', 'COMPLETED', 'ERROR'],
    default: 'PENDING'
  },
  startedAt:      Date,
  answeredAt:     Date,   // Para Intelbras: quando a taróloga atendeu
  endedAt:        Date,
  durationSeconds: Number,
  minutesBilled:   Number,
  pricePerMinute:  Number,
  totalCharged:    Number,
  endReason:       Number, // Agora: reason code | Intelbras: Q.850 cause
});
```

---

## Resumo de Endpoints e Eventos por Plataforma

| Ação | Agora.io | Intelbras Wide Cloud |
|---|---|---|
| Gerar credencial de acesso | `RtcTokenBuilder.buildTokenWithUid()` | Credenciais AMI em `manager.conf` |
| Iniciar chamada | Cliente faz join no canal com o token | `AMI Action: Originate` |
| Detectar início da chamada | NCS `eventType=103` | `AMI Event: Bridge` |
| Detectar fim da chamada | NCS `eventType=104` | `AMI Event: Hangup` |
| Derrubar usuário remotamente | `POST /dev/v1/kicking-rule` | `AMI Action: Hangup` |
| Autenticação | `Basic Auth` (CustomerId:Secret em Base64) | Login/senha no socket TCP |
| Verificação de webhook | `HMAC-SHA256` no header `Agora-Signature-V2` | N/A (conexão socket persistente) |

---

> **Fontes consultadas:**
> - Agora Docs — Voice Calling: Receive notifications / Channel event types / Ban user privileges (docs.agora.io, 2025)
> - Agora Node Token Server GitHub — AgoraIO-Community/Agora-Node-TokenServer
> - Intelbras INC Cloud API v1.0.0 (backend.intelbras.com, abril/2025)
> - Asterisk AMI Documentation (docs.asterisk.org)