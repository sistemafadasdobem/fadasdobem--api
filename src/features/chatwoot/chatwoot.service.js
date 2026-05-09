const axios = require('axios');
const { UniqueConstraintError } = require('sequelize');
const { User, Lead } = require('../../models');
const AppError = require('../../utils/AppError');
const { catchAsyncService } = require('../../utils/catchAsync.util');
const chatwootClient = require('../../providers/chatwoot/chatwoot.client');
const chatwootAiHistory = require('./chatwoot.aiHistory');
const openaiService = require('../openai/openai.service');
const anthropicService = require('../anthropic/anthropic.service');

/** Logs do webhook: só desliga com CHATWOOT_WEBHOOK_LOG=false (explicito). Omitir env = sempre log por defeito em PRD atual. */
function chatwootWebhookLog(summary, fields = {}) {
  if (`${process.env.CHATWOOT_WEBHOOK_LOG || ''}`.trim().toLowerCase() === 'false') return;
  const extra = Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : '';
  console.log(`[chatwoot:webhook] ${summary}${extra}`);
}

function extractPayloadShape(body) {
  const envelope = typeof body?.payload !== 'undefined' ? body.payload : body;
  return envelope || {};
}

function isMessageCreatedEvent(eventStr) {
  return `${eventStr}`.trim().toLowerCase() === 'message_created';
}

function isIncomingVisitorMessage(parsed) {
  const msg = parsed.message || parsed;
  const mt = msg?.message_type ?? msg?.type;
  if (mt === 'outgoing' || mt === 1 || mt === '1') return false;
  const senderType =
    msg?.sender?.type ?? parsed.sender?.type ?? parsed.conversation?.meta?.sender?.type;
  if (String(senderType || '').toLowerCase() !== 'contact') return false;
  return true;
}

function extractContactId(parsed) {
  const fromSender =
    parsed.sender?.id ??
    parsed.sender?.identifier ??
    parsed.contact?.source_id ??
    parsed.contact?.identifier;
  if (fromSender != null && fromSender !== '') return String(fromSender);
  const fromConv = parsed.conversation?.meta?.sender?.id;
  if (fromConv != null) return String(fromConv);
  const contactBlock = parsed.conversation?.contacts?.[0]?.id;
  if (contactBlock != null) return String(contactBlock);
  return null;
}

function extractConversationId(parsed) {
  const c = parsed.conversation;
  const id =
    c?.id ?? parsed.conversation_id ?? parsed.message?.conversation_id ?? parsed.conversationId;
  if (id != null && id !== '') return String(id);
  return null;
}

function extractInboundText(parsed) {
  const msg = parsed.message || parsed;
  if (typeof msg?.content === 'string') return msg.content;
  if (Array.isArray(msg?.attachments) && msg.attachments.length) {
    const first = msg.attachments[0];
    if (first?.fallback_title) return first.fallback_title;
  }
  if (parsed.content) return String(parsed.content);
  return '';
}

function extractLeadPhone(parsed) {
  const c = `${parsed.contact?.phone_number ?? ''}`.trim();
  if (c) return c.slice(0, 32);
  const m = `${parsed.sender?.phone_number ?? ''}`.trim();
  if (m) return m.slice(0, 32);
  const meta = `${parsed.conversation?.meta?.sender?.phone_number ?? ''}`.trim();
  return meta ? meta.slice(0, 32) : null;
}

function phoneDigitsOnly(s) {
  return String(s || '').replace(/\D/g, '');
}

/**
 * Lista de dígitos permitidos apenas quando `CHATWOOT_IA_PHONE_WHITELIST` existe no ambiente e não é wildcard.
 * **Sem esta variável** → todos os inbound contact são permitidos para a IA (não dependemos de `.env` para funcionar).
 * Para reativar teste só com um número no futuro, defina a variável ou volte ao hardcode temporário aqui em baixo.
 */
function getIaPhoneWhitelistDigits() {
  if (process.env.CHATWOOT_IA_PHONE_WHITELIST === undefined || process.env.CHATWOOT_IA_PHONE_WHITELIST === null) {
    return null;
  }
  const raw = `${process.env.CHATWOOT_IA_PHONE_WHITELIST}`.trim().toLowerCase();
  if (raw === '' || raw === '*' || raw === 'off' || raw === 'any') {
    return null;
  }
  const parts = raw.split(',').map((p) => phoneDigitsOnly(p.trim())).filter(Boolean);
  return parts.length ? parts : null;
}

/** Compara dois conjuntos apenas de dígitos (igual / sufixo / prefixo completo onde fizer sentido). */
function digitsMatchAllowedVariant(inboundDigits, allowedToken) {
  if (!inboundDigits || !allowedToken) return false;
  if (inboundDigits === allowedToken) return true;
  if (inboundDigits.endsWith(allowedToken)) return true;
  if (allowedToken.endsWith(inboundDigits) && inboundDigits.length >= 8) return true;
  return false;
}

/**
 * Só deixa a IA responder se o contacto tiver telefone reconhecido na whitelist (quando activa).
 */
function isInboundContactPhoneAllowedForIa(parsed) {
  const tokens = getIaPhoneWhitelistDigits();
  if (tokens === null) return true;
  if (!tokens.length) return false;

  const candidates = new Set();
  for (const v of [
    extractLeadPhone(parsed),
    parsed.contact?.phone_number,
    parsed.sender?.phone_number,
    parsed.message?.sender?.phone_number,
    parsed.conversation?.meta?.sender?.phone_number,
  ]) {
    const d = phoneDigitsOnly(v);
    if (d) candidates.add(d);
  }

  for (const idField of [parsed.contact?.identifier, parsed.sender?.identifier, parsed.message?.sender?.identifier]) {
    if (!idField) continue;
    const head = `${idField}`.split('@')[0];
    const d = phoneDigitsOnly(head);
    if (d) candidates.add(d);
  }

  for (const d of candidates) {
    for (const t of tokens) {
      if (digitsMatchAllowedVariant(d, t)) return true;
    }
  }

  return false;
}

/** JID de grupo WhatsApp (Evolution / Baileys): contém `@g.us` (chats 1:1 usam `@s.whatsapp.net` / `@c.us`). */
function stringLooksLikeWhatsappGroupJid(s) {
  if (!s || typeof s !== 'string') return false;
  return s.toLowerCase().includes('@g.us');
}

/**
 * Bloqueia IA em conversas de grupo (WhatsApp e metadados que o Chatwoot possa expor).
 * Não altera o 200 do webhook — só não chama Claude nem faz upsert de lead para estes eventos.
 */
function isInboundGroupConversationForIa(parsed) {
  const convAdd = parsed.conversation?.additional_attributes;
  if (convAdd && typeof convAdd === 'object') {
    if (convAdd.group === true || convAdd.is_group === true) return true;
    const ct = `${convAdd.chat_type || convAdd.type || convAdd.conversation_type || ''}`.toLowerCase();
    if (['group', 'supergroup', 'channel'].includes(ct)) return true;
  }

  const msg = parsed.message || parsed;
  const stringsToScan = [];

  for (const v of [
    parsed.contact?.identifier,
    parsed.sender?.identifier,
    msg.sender?.identifier,
    parsed.conversation?.identifier,
    parsed.conversation?.contact_inbox?.source_id,
    parsed.contact_inbox?.source_id,
    msg.source_id,
    parsed.source_id,
    parsed.conversation?.meta?.sender?.identifier,
  ]) {
    if (v != null && `${v}`.trim()) stringsToScan.push(`${v}`.trim());
  }

  const shallowAttrs = [convAdd, msg.additional_attributes, parsed.contact?.additional_attributes];
  for (const bag of shallowAttrs) {
    if (!bag || typeof bag !== 'object') continue;
    for (const val of Object.values(bag)) {
      if (typeof val === 'string' && val.includes('@')) stringsToScan.push(val.trim());
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        for (const inner of Object.values(val)) {
          if (typeof inner === 'string' && inner.includes('@')) stringsToScan.push(inner.trim());
        }
      }
    }
  }

  for (const s of stringsToScan) {
    if (stringLooksLikeWhatsappGroupJid(s)) return true;
  }
  return false;
}

function mergeUtmData(existing, incoming) {
  const a = existing && typeof existing === 'object' && !Array.isArray(existing) ? { ...existing } : {};
  const b = incoming && typeof incoming === 'object' && !Array.isArray(incoming) ? incoming : {};
  return { ...a, ...b };
}

function parseUtmFromUrl(urlStr) {
  const out = {};
  if (!urlStr || typeof urlStr !== 'string') return out;
  try {
    const u = new URL(urlStr, 'https://placeholder.invalid');
    for (const [k, v] of u.searchParams.entries()) {
      const lower = k.toLowerCase();
      if (
        lower.startsWith('utm_') ||
        lower === 'gclid' ||
        lower === 'fbclid' ||
        lower === 'msclkid'
      ) {
        out[k] = v;
      }
    }
  } catch {
    // URL inválida — ignorar
  }
  return out;
}

/**
 * Extrai parâmetros de campanha / atribuição de contacto, mensagem ou conversa.
 */
function extractUtmPayloadFromWebhook(parsed) {
  const merged = {};

  const conv = parsed.conversation || {};
  const addl = conv.additional_attributes || {};
  const refCandidates = [
    addl.referer,
    addl.referrer,
    addl.ref_url,
    conv.referer,
    parsed.contact?.additional_attributes?.referer_url,
    parsed.contact?.additional_attributes?.referrer,
  ].filter(Boolean);

  for (const url of refCandidates) {
    Object.assign(merged, parseUtmFromUrl(`${url}`));
  }

  const custom = parsed.contact?.custom_attributes;
  if (custom && typeof custom === 'object') {
    for (const [key, raw] of Object.entries(custom)) {
      const lk = `${key}`.toLowerCase();
      if (
        lk.startsWith('utm_') ||
        lk === 'gclid' ||
        lk === 'fbclid' ||
        lk === 'msclkid'
      ) {
        merged[key] = raw;
      }
    }
  }

  const msg = parsed.message || parsed;
  const ma = msg?.additional_attributes;
  if (ma && typeof ma === 'object' && ma.utm && typeof ma.utm === 'object') {
    Object.assign(merged, ma.utm);
  }

  return merged;
}

/**
 * Canal macro (source) deduzido da caixa ou metadatos.
 */
function extractSourceChannelFromWebhook(parsed) {
  const ca = parsed.contact?.custom_attributes;
  if (ca && typeof ca.source === 'string' && ca.source.trim()) {
    return ca.source.trim().slice(0, 64);
  }

  const inbox = parsed.inbox || parsed.conversation?.inbox;
  const raw = `${inbox?.channel_type || inbox?.type || ''}`.toLowerCase();
  if (raw.includes('whatsapp')) return 'whatsapp';
  if (raw.includes('telegram')) return 'telegram';
  if (raw.includes('facebook')) return 'facebook';
  if (raw.includes('instagram')) return 'instagram';
  if (raw.includes('line')) return 'line';
  if (raw.includes('sms') || raw.includes('twilio')) return 'sms';
  if (raw.includes('email') || raw.includes('mail')) return 'email';
  if (raw.includes('widget') || raw.includes('web')) return 'website_widget';

  if (parsed.conversation?.additional_attributes?.browser_language) {
    return 'website_widget';
  }

  return 'direct';
}

/**
 * Strategy de IA no webhook: mesma interface `generateReply(historico, mensagemUsuario)`.
 */
function resolveWebhookAiStrategy() {
  const raw = (process.env.ACTIVE_AI_PROVIDER || 'anthropic').trim().toLowerCase();
  if (raw === 'anthropic') return anthropicService;
  if (raw === 'openai') return openaiService;
  throw new AppError(
    `Configuração ACTIVE_AI_PROVIDER inválida ("${process.env.ACTIVE_AI_PROVIDER}"). Use openai ou anthropic.`,
    500,
    null,
    true
  );
}

async function fetchWebhookConversationRows(accountId, conversationId) {
  const n = Number(process.env.CHATWOOT_IA_HISTORY_N);
  const targetCount = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 100) : 30;
  try {
    return await chatwootClient.fetchRecentConversationMessagesAscending(
      accountId,
      conversationId,
      targetCount
    );
  } catch (err) {
    if (!axios.isAxiosError(err)) throw err;
    const st = err.response?.status;
    const hint =
      st === 401 || st === 403
        ? 'Token ou permissões insuficientes para ler mensagens no Chatwoot.'
        : 'Não foi possível obter o histórico desta conversa no Chatwoot.';
    const statusCode = typeof st === 'number' && st >= 400 && st < 600 ? (st === 404 ? 404 : 502) : 502;
    throw new AppError(hint, statusCode, null, true);
  }
}

/** Liga/desliga envio da resposta IA ao Chatwoot (`true`/`1`/`yes`/`on` = ativo). */
function isChatwootIaAutoReplyEnabled() {
  const raw = `${process.env.CHATWOOT_IA_AUTO_REPLY || ''}`.trim().toLowerCase();
  if (!raw) return false;
  if (['false', '0', 'no', 'off'].includes(raw)) return false;
  return ['true', '1', 'yes', 'on'].includes(raw);
}

/**
 * Sem `User` para o contacto Chatwoot: garante `Lead` (findOrCreate) com origem/inactividade atualizadas.
 *
 * @returns {{ kind: 'user', user: import('sequelize').Model }}
 *          | {{ kind: 'lead', lead: import('sequelize').Model }}
 */
async function findUserOrUpsertLeadByChatwoot(contactId, conversationId, parsed) {
  const cid = `${contactId}`.trim();
  const conv = `${conversationId || ''}`.trim();

  const user = await User.findOne({
    where: { chatwoot_contact_id: cid },
  });
  if (user) {
    if (conv) {
      await user.update({ chatwoot_conversation_id: conv });
    }
    return { kind: 'user', user };
  }

  const source = extractSourceChannelFromWebhook(parsed);
  const utmPatch = extractUtmPayloadFromWebhook(parsed);
  const phone = extractLeadPhone(parsed);
  const now = new Date();

  let lead = await Lead.findOne({
    where: { chatwoot_contact_id: cid },
  });

  if (lead) {
    const nextUtm = mergeUtmData(lead.utm_data, utmPatch);
    await lead.update({
      chatwoot_conversation_id: conv || lead.chatwoot_conversation_id,
      last_interaction_at: now,
      source: source !== 'direct' ? source : lead.source,
      utm_data: nextUtm,
      phone: phone || lead.phone,
    });
    return { kind: 'lead', lead };
  }

  try {
    lead = await Lead.create({
      chatwoot_contact_id: cid,
      chatwoot_conversation_id: conv || null,
      phone,
      status: 'NEW',
      source,
      utm_data: utmPatch,
      last_interaction_at: now,
    });
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      lead = await Lead.findOne({ where: { chatwoot_contact_id: cid } });
      if (lead) {
        const nextUtm = mergeUtmData(lead.utm_data, utmPatch);
        await lead.update({
          chatwoot_conversation_id: conv || lead.chatwoot_conversation_id,
          last_interaction_at: now,
          source: source !== 'direct' ? source : lead.source,
          utm_data: nextUtm,
          phone: phone || lead.phone,
        });
        return { kind: 'lead', lead };
      }
    }
    throw err;
  }

  return { kind: 'lead', lead };
}

/**
 * Fluxo webhook Chatwoot → IA (OpenAI **ou** Anthropic) → resposta ao canal.
 * Contactos sem `User` são materializados como `Lead` (paranoid) até à conversão formal.
 */
async function processWebhookEnvelopeImpl(rawBody) {
  const envelope = typeof rawBody === 'object' ? rawBody : {};
  const event = envelope.event || envelope.meta?.event;
  const parsed = extractPayloadShape(envelope);

  if (!event || !isMessageCreatedEvent(event)) {
    chatwootWebhookLog('skipped', { why: 'evento_nao_message_created', event: event || null });
    return { skipped: true, reason: 'evento não é message_created' };
  }

  const textContent = extractInboundText(parsed).trim();
  const conversationId = extractConversationId(parsed);
  const contactId = extractContactId(parsed);

  if (!conversationId || !contactId) {
    chatwootWebhookLog('skipped', {
      why: 'ids_ausentes',
      conversationId: conversationId || null,
      contactId: contactId || null,
    });
    return { skipped: true, reason: 'ids ausentes' };
  }
  if (!isIncomingVisitorMessage(parsed)) {
    chatwootWebhookLog('skipped', { why: 'mensagem_nao_inbound_contact', conversationId });
    return { skipped: true, reason: 'ignoramos mensagens de agente/outgoing ou sender ≠ contact' };
  }
  if (isInboundGroupConversationForIa(parsed)) {
    chatwootWebhookLog('skipped', { why: 'conversa_grupo_ou_canal', conversationId });
    return {
      skipped: true,
      reason: 'conversa de grupo/canal — IA não responde (ex.: WhatsApp @g.us)',
      ia_group_skipped: true,
    };
  }
  if (!textContent) {
    chatwootWebhookLog('skipped', { why: 'sem_texto', conversationId });
    return { skipped: true, reason: 'mensagem sem texto utilizável' };
  }

  if (!isChatwootIaAutoReplyEnabled()) {
    chatwootWebhookLog('skipped', { why: 'CHATWOOT_IA_AUTO_REPLY_off', conversationId });
    return {
      skipped: true,
      reason: 'CHATWOOT_IA_AUTO_REPLY não habilitado (defina true no .env para a IA responder)',
      ia_auto_reply: false,
    };
  }

  const identity = await findUserOrUpsertLeadByChatwoot(contactId, conversationId, parsed);

  if (!isInboundContactPhoneAllowedForIa(parsed)) {
    chatwootWebhookLog('skipped', {
      why: 'phone_whitelist',
      conversationId,
      hint: 'defina CHATWOOT_IA_PHONE_WHITELIST=* ou inclua o dígito do contacto',
    });
    return {
      skipped: true,
      reason: 'telefone do contacto fora da whitelist de testes IA (CHATWOOT_IA_PHONE_WHITELIST)',
      ia_phone_blocked: true,
    };
  }

  const accountId = `${process.env.CHATWOOT_ACCOUNT_ID || ''}`.trim();
  if (!accountId) {
    throw new AppError('CHATWOOT_ACCOUNT_ID não configurado.', 500, null, true);
  }

  const rows = await fetchWebhookConversationRows(accountId, conversationId);
  const turns = chatwootAiHistory.buildTurnsFromChatwootRows(rows, textContent);
  const { history, latest } = chatwootAiHistory.splitHistoryForGenerateReply(turns);

  const provedor = (process.env.ACTIVE_AI_PROVIDER || 'anthropic').trim().toLowerCase();
  const iaService = resolveWebhookAiStrategy();

  let flowSnapshot = null;
  if (provedor === 'anthropic' && typeof anthropicService.getCurrentFlowState === 'function') {
    flowSnapshot = await anthropicService.getCurrentFlowState(accountId, conversationId);
  }

  chatwootWebhookLog('ia_request', {
    conversationId,
    contactId,
    identity: identity.kind,
    provedor,
    flow_state: flowSnapshot?.stateKey ?? undefined,
    historico_turnos: history.length,
    ultima_msg_chars: latest.length,
    chatwoot_rows: rows.length,
  });

  const t0 = Date.now();
  const reply =
    provedor === 'anthropic' && typeof anthropicService.generateReplyForChatwoot === 'function'
      ? await anthropicService.generateReplyForChatwoot(history, latest, { accountId, conversationId })
      : await iaService.generateReply(history, latest);
  const msIa = Date.now() - t0;

  chatwootWebhookLog('ia_response', {
    conversationId,
    provedor,
    ms: msIa,
    reply_chars: `${reply || ''}`.length,
    fallback_ia:
      `${reply || ''}`.includes('Não consegui contatar') || `${reply || ''}`.includes('nossa IA')
        ? true
        : undefined,
  });

  try {
    await chatwootClient.postTextReply(accountId, conversationId, reply);
  } catch (err) {
    if (!axios.isAxiosError(err)) throw err;
    throw new AppError(
      'Não conseguimos publicar a resposta da IA nesta conversa do Chatwoot.',
      502,
      null,
      true
    );
  }

  chatwootWebhookLog('posted', { conversationId });

  return {
    replied: true,
    provedor_ia: provedor,
    identity_kind: identity.kind,
    userId: identity.kind === 'user' ? identity.user.id : null,
    leadId: identity.kind === 'lead' ? identity.lead.id : null,
    conversationId,
  };
}

const processWebhookEnvelope = catchAsyncService(processWebhookEnvelopeImpl);

module.exports = {
  processWebhookEnvelope,
  findUserOrUpsertLeadByChatwoot,
};
