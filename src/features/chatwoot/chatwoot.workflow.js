'use strict';

const crypto = require('crypto');
const evolutionClient = require('../../providers/evolution/evolution.client');
const chatwootClient = require('../../providers/chatwoot/chatwoot.client');
const wfStore = require('./chatwoot.workflow.store');
const P = require('./chatwoot.workflow.prompts');
const queuesService = require('../queues/queues.service');
const anthropicService = require('../anthropic/anthropic.service');
const AppError = require('../../utils/AppError');
const { User, Client } = require('../../models');
const returningSvc = require('./chatwoot.returning.service');
const returningFsm = require('./chatwoot.workflow.returning');
const identityUtil = require('../auth/identity.util');

const S = P.STATES;

function normalizeInbound(s) {
  return `${s ?? ''}`
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function envTruth(name) {
  const v = `${process.env[name] || ''}`.trim().toLowerCase();
  return ['1', 'true', 'yes', 'on', 'sim'].includes(v);
}

function evolutionInstance() {
  return `${process.env.EVOLUTION_WHATSAPP_INSTANCE_NAME || process.env.CHATWOOT_EVOLUTION_INSTANCE_NAME || process.env.EVOLUTION_INSTANCE_NAME || ''}`.trim();
}

function extractPhoneDigitsFromParsed(parsed) {
  const cands = [
    parsed?.contact?.phone_number,
    parsed?.sender?.phone_number,
    parsed?.message?.sender?.phone_number,
    parsed?.conversation?.meta?.sender?.phone_number,
  ];
  for (const x of cands) {
    const d = `${x ?? ''}`.replace(/\D/g, '');
    if (d.length >= 10 && d.length <= 15) return d;
  }
  const alt = `${parsed?.contact?.identifier || parsed?.sender?.identifier || ''}`;
  const head = alt.split('@')[0];
  const digits = `${head || ''}`.replace(/\D/g, '');
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return '';
}

async function pause(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function mirrorChat(accountId, convId, text) {
  if (!envTruth('CHATWOOT_LEAD_FSM_MIRROR_TO_CHATWOOT')) return;
  try {
    await chatwootClient.postTextReply(accountId, convId, `${text}`.slice(0, 12_000));
  } catch (e) {
    console.warn('[chatwoot:workflow][mirror]', e.message || e);
  }
}

const PKG = {
  'fsm:t2:cv15': { id: P.PACKAGE_IDS.cv15, modality: 'text_voice', minutes: 15, amount: '44,40' },
  'fsm:t2:cv30': { id: P.PACKAGE_IDS.cv30, modality: 'text_voice', minutes: 30, amount: '88,80' },
  'fsm:t2:cv60': { id: P.PACKAGE_IDS.cv60, modality: 'text_voice', minutes: 60, amount: '159,90' },
  'fsm:t2v:vd30': { id: P.PACKAGE_IDS.vd30, modality: 'video', minutes: 30, amount: '159,90' },
  'fsm:t2v:vd40': { id: P.PACKAGE_IDS.vd40, modality: 'video', minutes: 40, amount: '199,90' },
  'fsm:t2v:vd60': { id: P.PACKAGE_IDS.vd60, modality: 'video', minutes: 60, amount: '279,90' },
};

function parseFsmDisplayedBrlToDecimal(amountSlot) {
  const raw = `${amountSlot ?? ''}`.trim().replace(/[^\d.,]/g, '');
  if (!raw) return null;
  const norm = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const n = Number(norm);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isoDateToDdMmYyyy(iso) {
  const s = `${iso ?? ''}`.trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function mentionsWhatsappHandoff(norm /* normalized */) {
  if (norm.includes('whatsapp')) return true;
  if (norm.includes('whats app')) return true;
  if (/\bzap\b/.test(norm)) return true;
  if (/\bwpp\b/.test(norm)) return true;
  if (norm.includes('whats')) return true;
  return false;
}

function bootstrapPasswordLeadFsm() {
  return `Fdb${crypto.randomUUID().replace(/-/g, '')}!a9`;
}

async function convertFsmLeadOnT8Choice(leadId, slots, phoneDigits) {
  if (`${slots.lead_fsm_converted_user_id || ''}`.trim()) {
    return { ok: true, userId: `${slots.lead_fsm_converted_user_id}`.trim(), already: true };
  }
  if (!leadId) {
    return {
      ok: false,
      userMessage:
        'Não consegui finalizar o cadastro técnico agora 💜 Vou pedir para a equipe continuar por aqui.',
    };
  }
  const email = `${slots.extracted_email || ''}`.trim();
  const nome = `${slots.extracted_name || ''}`.trim();
  const birthIso = `${slots.extracted_birthdate_iso || ''}`.trim();
  if (!email || !nome || !birthIso) {
    return {
      ok: false,
      userMessage:
        'Faltam dados confirmados 💜 Toque em “Quero corrigir” na etapa anterior ou peça ajuda à equipe.',
    };
  }

  const terms = `${process.env.LEAD_FSM_ACCEPTED_TERMS_VERSION || 'lead-fsm-v1'}`.trim();
  const pwd = bootstrapPasswordLeadFsm();

  // eslint-disable-next-line global-require, import/no-dynamic-require
  const authService = require('../auth/auth.service');

  try {
    const out = await authService.convertLeadToClient(
      leadId,
      {
        email,
        password: pwd,
        accepted_terms_version: terms,
        nome_completo: nome,
        data_nascimento: birthIso,
        phone: phoneDigits && phoneDigits.length >= 10 ? phoneDigits : undefined,
      },
      {}
    );
    const uid = `${out?.usuario?.id || ''}`.trim();
    if (!uid) return { ok: false, userMessage: 'Cadastro quase pronto — a equipe vai concluir por aqui 💜' };
    return { ok: true, userId: uid, already: false };
  } catch (e) {
    const msg = e instanceof AppError ? `${e.message || ''}`.trim() : '';
    if (msg && /já está cadastrado|já cadastrado|email/i.test(msg)) {
      return {
        ok: false,
        userMessage:
          'Esse e-mail já tem cadastro 💜 Use “Quero corrigir” para informar outro e-mail, ou peça login à equipe.',
      };
    }
    console.warn('[chatwoot:workflow][lead_convert]', e?.message || e);
    return {
      ok: false,
      userMessage: 'Não conseguimos concluir o cadastro agora 💜 A equipe vai te ajudar nesta conversa.',
    };
  }
}

async function ensureLeadFsmPixDelivered(inst, digits, accountId, convId, slots, leadId) {
  const paymentsService = require('../payments/payments.service');
  const { PaymentOrder } = require('../../models');

  const bag = await wfStore.load(accountId, convId);
  const baseSlots = { ...(bag?.slots || {}), ...(slots || {}) };
  const existingPid = `${baseSlots.lead_fsm_payment_order_id || ''}`.trim();

  if (existingPid) {
    const row = await PaymentOrder.findByPk(existingPid, { paranoid: true });
    const code = row?.pix_qr_code ? `${row.pix_qr_code}`.trim() : '';
    if (code) {
      await evolveSendText(
        inst,
        digits,
        'Seu PIX já está gerado 💜 Segue de novo o Copia-e-Cola (se precisar, posso mandar o QR em seguida).'
      );
      await mirrorChat(accountId, convId, `[Bot Lead][PIX reenvio]\n${code.slice(0, 800)}…`);
      await evolveSendText(inst, digits, `Copia-e-Cola:\n\n${code}`);
      const b64 = row?.pix_qr_code_base64 ? `${row.pix_qr_code_base64}`.trim() : '';
      if (b64) {
        const media = b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
        try {
          await evolutionClient.sendMessageMedia(inst, {
            number: digits,
            mediatype: 'image',
            mimetype: 'image/png',
            caption: 'QR Code PIX — Fadas do Bem',
            media,
          });
        } catch (e) {
          console.warn('[chatwoot:workflow][pix_qr_resend]', e.message || e);
        }
      }
    } else {
      await evolveSendText(
        inst,
        digits,
        'Aguardando confirmação do pagamento no sistema 💜 Assim que for aprovado, seguimos automaticamente.'
      );
    }
    return;
  }

  if (!leadId) {
    await evolveSendText(
      inst,
      digits,
      'Quase lá 💜 Não encontrei o cadastro-técnico do lead para gerar o PIX. A equipe vai te ajudar nesta conversa.'
    );
    await chatwootClient.postPrivateNote(
      accountId,
      convId,
      'Lead FSM: `leadId` ausente ao gerar PIX — verificar webhook Chatwoot / vínculo Lead.'
    );
    return;
  }

  const amt = parseFsmDisplayedBrlToDecimal(baseSlots.amount);
  if (!amt) {
    await evolveSendText(
      inst,
      digits,
      'Não consegui ler o valor do pacote 💜 Volte e escolha o pacote novamente, ou peça ajuda à equipe.'
    );
    return;
  }

  const label = `WhatsApp Lead · ${baseSlots.minutes ?? '?'} min`;
  const created = await paymentsService.createPixCheckoutForLeadFsm({
    leadId,
    amountBrlDecimal: amt,
    label,
    packageIdFsm: baseSlots.selected_package_id || null,
    chatwootAccountId: accountId,
    conversationId: convId,
  });

  const merged = {
    ...baseSlots,
    ...(digits ? { customer_whatsapp_e164_digits: digits } : {}),
    lead_fsm_payment_order_id: created.payment_order_id,
    lead_fsm_pix_mp_id: created.mp_payment_id,
    amount_display_for_copy: baseSlots.amount ? `R$${baseSlots.amount}` : undefined,
  };
  await wfStore.save(accountId, convId, { current_state: S.T4, slots: merged });

  const pixText = `${created?.pix?.qr_code || ''}`.trim();
  const intro = typeof P.T4.intro === 'string' ? P.T4.intro : '';
  await evolveSendText(inst, digits, intro);
  await mirrorChat(accountId, convId, `[Bot Lead][PIX gerado]\n${intro}\n\nCopia-e-Cola:\n${pixText.slice(0, 1200)}`);
  if (pixText) await evolveSendText(inst, digits, `Copia-e-Cola PIX:\n\n${pixText}`);

  const exp = created?.pix?.expires_at;
  if (exp) {
    const d = new Date(exp);
    if (Number.isFinite(d.getTime())) {
      await evolveSendText(
        inst,
        digits,
        `Validade aproximada do PIX: ${d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} 💜`
      );
    }
  }

  const b64 = `${created?.pix?.qr_code_base64 || ''}`.trim();
  if (b64) {
    const media = b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
    try {
      await evolutionClient.sendMessageMedia(inst, {
        number: digits,
        mediatype: 'image',
        mimetype: 'image/png',
        caption: 'QR Code PIX — escaneie no app do banco',
        media,
      });
    } catch (e) {
      console.warn('[chatwoot:workflow][pix_qr_send]', e.message || e);
      await evolveSendText(
        inst,
        digits,
        'Não consegui enviar a imagem do QR no WhatsApp 💜 Use o Copia-e-Cola acima no app do banco.'
      );
    }
  }

  await evolveSendText(
    inst,
    digits,
    'Assim que o pagamento for confirmado, eu aviso aqui automaticamente 💜'
  );
}

function pickPackageFromInbound(rawNorm, rawOriginal) {
  const blob = `${rawOriginal}`.trim();
  for (const k of Object.keys(PKG)) if (blob.includes(k) || rawNorm.includes(normalizeInbound(k))) return PKG[k];
  for (const k of Object.keys(PKG))
    if (rawNorm.includes(`min`) && PKG[k].minutes && blob.includes(`${PKG[k].minutes}`)) return PKG[k];
  return null;
}

function buttonsPayload(number, caption, defs) {
  return {
    number: evolutionClient.normalizeWhatsappNumber(number),
    title: captionsShort(caption.title, 1024),
    description: captionsShort(caption.description, 1024),
    footer: captionsShort(caption.footer || ' ', 60),
    buttons: defs.slice(0, 3),
  };
}

function captionsShort(s, max) {
  const t = `${s ?? ''}`;
  return t.slice(0, max);
}

async function evolveSendText(inst, digits, txt) {
  return evolutionClient.sendMessageText(inst, { number: digits, text: `${txt}`.slice(0, 4000) });
}

async function evolveSendBt(inst, digits, caption, buttons) {
  return evolutionClient.sendButtons(inst, buttonsPayload(digits, caption, buttons));
}

async function evolveSendList(inst, digits, spec) {
  const body = {
    number: evolutionClient.normalizeWhatsappNumber(digits),
    title: spec.title.slice(0, 60),
    description: spec.description.slice(0, 4096),
    buttonText: spec.buttonText.slice(0, 20),
    footerText: spec.footerText.slice(0, 60),
    values: spec.values.map((sec) => ({
      title: sec.title.slice(0, 24),
      rows: sec.rows.map((r) => ({
        title: `${r.title}`.slice(0, 24),
        description: `${r.description || ''}`.slice(0, 72),
        rowId: r.rowId.slice(0, 200),
      })),
    })),
  };
  return evolutionClient.sendList(inst, body);
}

async function emitT1(ctx, inst, digits, accountId, convId) {
  await evolveSendText(inst, digits, P.T1.intro);
  await mirrorChat(accountId, convId, `[Bot Lead] ${P.T1.intro}`);
  await evolveSendBt(
    inst,
    digits,
    { title: 'Fadas do Bem', description: 'Como você se identifica?', footer: '💜' },
    P.T1.buttons.map((b) => ({ title: b.title, displayText: captionsShort(b.displayText, 60), id: b.id }))
  );
}

async function emitT2(ctx, inst, digits, accountId, convId) {
  await evolveSendText(inst, digits, P.T2.intro);
  await mirrorChat(accountId, convId, `[Bot Lead]\n${P.T2.intro}`);
  await evolveSendList(inst, digits, {
    title: captionsShort(P.T2.list.title, 60),
    description: captionsShort(`${P.T2.intro}\n\nEscolha o tempo abaixo.`, 4096),
    buttonText: P.T2.list.buttonText.slice(0, 18),
    footerText: P.T2.list.footerText,
    values: [{ title: P.T2.list.sectionTitle, rows: P.T2.list.rows }],
  });
  await pause(600);
  await evolveSendBt(
    inst,
    digits,
    { title: '🎬 Vídeo', description: 'Quer valores de vídeo?', footer: '\u2060' },
    [{ title: 'reply', displayText: captionsShort(P.T2.videoButtonTitle, 60), id: P.T2.videoBtnId }]
  );
}

async function emitT2v(inst, digits, accountId, convId) {
  await evolveSendText(inst, digits, P.T2V.intro);
  await mirrorChat(accountId, convId, `[Bot Lead]\n${P.T2V.intro}`);
  await evolveSendList(inst, digits, {
    title: captionsShort(P.T2V.list.title, 60),
    description: captionsShort(`${P.T2V.intro}\n\nEscolha o tempo (vídeo).`, 4096),
    buttonText: P.T2V.list.buttonText.slice(0, 18),
    footerText: P.T2V.list.footerText,
    values: [{ title: P.T2V.list.sectionTitle, rows: P.T2V.list.rows }],
  });
  await pause(550);
  await evolveSendBt(
    inst,
    digits,
    { title: 'Navegar', description: 'Voltar?', footer: '\u2060' },
    [
      {
        title: 'reply',
        displayText: captionsShort(P.T2V.backBtn.displayText, 55),
        id: P.T2V.backBtn.id,
      },
    ]
  );
}

async function emitT3(inst, digits, accountId, convId, slots) {
  const fleet = await queuesService.estimateFleetWaitForLeadFsmWhatsApp();
  const minutes = slots.minutes ?? 30;
  const total = slots.amount ?? '?';
  const bodyText =
    fleet.available_count > 0
      ? P.T3_MESSAGES.available({
          minutes,
          totalBrl: total,
          count: fleet.available_count,
        })
      : P.T3_MESSAGES.busy({
          minutes,
          totalBrl: total,
          eta: fleet.estimated_wait_minutes,
        });

  slots.lead_fsm_fleet_tarologas_livres = fleet.available_count;
  slots.wait_eta_minutes_hint = fleet.estimated_wait_minutes;

  await evolveSendText(inst, digits, bodyText);
  await mirrorChat(accountId, convId, `[Bot Lead]\n${bodyText}`);
  await pause(550);
  await evolveSendBt(
    inst,
    digits,
    { title: 'Confirme', description: 'Deseja obter PIX?', footer: '\u2060' },
    P.T3_MESSAGES.buttonsConfirm.map((b) => ({
      title: b.title,
      displayText: captionsShort(b.displayText, 56),
      id: b.id,
    }))
  );
}

async function emitT5(inst, digits, accountId, convId, amountFormatted) {
  const t = typeof P.T5 === 'function' ? P.T5({ amountFormatted }) : P.T5;
  await evolveSendText(inst, digits, t);
  await mirrorChat(accountId, convId, `[Bot Lead]\n${t}`);
}

async function emitT6(inst, digits, accountId, convId, slots) {
  const birthShow =
    `${slots.extracted_birthdate_display || ''}`.trim() ||
    isoDateToDdMmYyyy(slots.extracted_birthdate_iso) ||
    `${slots.extracted_birthdate || ''}`.trim();
  const txt = P.T6({
    name: slots.extracted_name || '',
    birth: birthShow,
    email: slots.extracted_email || '',
  });
  await evolveSendText(inst, digits, txt);
  await mirrorChat(accountId, convId, `[Bot Lead]\n${txt}`);
  await evolveSendBt(
    inst,
    digits,
    { title: 'Dados OK?', description: 'Confirme', footer: '\u2060' },
    P.T6_BUTTONS.map((b) => ({ title: b.title, displayText: captionsShort(b.displayText, 50), id: b.id }))
  );
}

async function emitT7(inst, digits, accountId, convId) {
  await evolveSendText(inst, digits, P.T7.intro);
  await mirrorChat(accountId, convId, `[Bot Lead]\n${P.T7.intro}`);
  await evolveSendBt(
    inst,
    digits,
    { title: 'Modalidade', description: 'Preferência?', footer: '\u2060' },
    P.T7.buttonsPrimary.map((b) => ({ title: b.title, displayText: captionsShort(b.displayText, 55), id: b.id }))
  );
}

async function emitT7Privacy(inst, digits, accountId, convId) {
  await evolveSendText(inst, digits, P.T7.privacyExplanation);
  await mirrorChat(accountId, convId, `[Bot Lead]\n${P.T7.privacyExplanation}`);
  await evolveSendBt(
    inst,
    digits,
    { title: 'WhatsApp', description: 'Como?', footer: '\u2060' },
    P.T7.privacyButtons.map((b) => ({ title: b.title, displayText: captionsShort(b.displayText, 45), id: b.id }))
  );
}

async function emitT8Platform(inst, digits, accountId, convId, slots) {
  const first = captionsShort(slots.extracted_first_name || slots.extracted_name?.split(/\s+/)[0] || 'Cliente', 40);
  const msg = P.T8.platform({ clientFirstName: first });
  await evolveSendText(inst, digits, msg);
  await mirrorChat(accountId, convId, `[Bot Lead][Plataforma]\n${msg}`);
}

async function emitT8Phone(inst, digits, accountId, convId, slots) {
  const first = captionsShort(slots.extracted_first_name || slots.extracted_name?.split(/\s+/)[0] || 'Cliente', 40);
  const blk = `${P.T8.phone({ clientFirstName: first })}\n\n${P.DEMO_SPECIALIST.phoneDial}`;
  await evolveSendText(inst, digits, blk);
  await mirrorChat(accountId, convId, `[Bot Lead][Tel]\n${blk}`);
}

async function emitWhatsAppHandoff(inst, digits, accountId, convId) {
  await evolveSendText(inst, digits, P.T8.whatsappHandoff);
  await mirrorChat(accountId, convId, `[Bot Lead][Handoff]\n${P.T8.whatsappHandoff}`);
}

function matchesReturning(txtNorm, raw) {
  if (raw.includes('fsm:t1:return')) return true;
  const b = P.T1.buttons[1];
  if (normalizeInbound(raw).includes(normalizeInbound(b.displayText))) return true;
  return ['consultei antes', 'ja me consultei', 'consultei antes', 'consultei antes'].some((x) =>
    txtNorm.includes(x)
  )
    ? true
    : b.labelMatch.some((m) => txtNorm.includes(normalizeInbound(m))) && txtNorm.includes('sim');
}

function matchesNewClient(txtNorm, raw) {
  if (raw.includes('fsm:t1:new')) return true;
  const b = P.T1.buttons[0];
  if (normalizeInbound(raw).includes(normalizeInbound(b.displayText))) return true;
  return txtNorm.includes('primeira') || txtNorm.includes('primeira vez') || txtNorm.includes('nova');
}

function isoDateLabelPt(iso) {
  const m = `${iso || ''}`.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return `${iso}`;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function normalizeYes(norm) {
  return ['sim', 'esta correto', 'correto', 'isso', 'confirmo'].some((s) => norm.includes(s));
}

/**
 * Fluxo WhatsApp Evolution + estado em Postgres (`bot_conversation_flow_states`).
 * Chamado apenas para **Lead** quando `CHATWOOT_LEAD_FSM_ENABLED` está ligado.
 */
async function handleLeadFsmInbound({ accountId, conversationId, parsed, inboundText, leadId, contactId }) {
  const digits = extractPhoneDigitsFromParsed(parsed || {});
  const inst = evolutionInstance();

  const warn = [];

  async function evolveOrMirror(fn, fallbackTxt) {
    if (!digits) {
      warn.push('phone_missing');
      if (fallbackTxt && accountId && conversationId) await mirrorChat(accountId, conversationId, fallbackTxt);
      return;
    }
    if (!inst || `${process.env.EVOLUTION_API_BASE_URL || ''}`.trim().length < 8) {
      warn.push('evolution_unconfigured');
      if (fallbackTxt && accountId && conversationId)
        await chatwootClient.postTextReply(accountId, conversationId, fallbackTxt.slice(0, 12_000));
      return;
    }
    await fn(inst, digits, accountId, conversationId);
  }

  let bag = await wfStore.load(accountId, conversationId);

  /** Primeira interação ou reset manual (sem linha prévia): abre em T1. */
  if (!bag) {
    await wfStore.save(accountId, conversationId, {
      current_state: S.ENTRY,
      slots: {
        welcome_emitted_at: Date.now(),
        ...(digits ? { customer_whatsapp_e164_digits: digits } : {}),
      },
    });
    bag = await wfStore.load(accountId, conversationId);
    await evolveOrMirror(
      (...a) => emitT1(null, ...a),
      `[Bot Lead — configure Evolution]` + P.T1.intro
    );
    return {
      handled: true,
      mode: 'lead_fsm',
      state: bag.current_state,
      warning: warn,
      note: 'welcome_emitted — ignore extra opening text até próxima volta',
    };
  }

  const norm = normalizeInbound(inboundText);
  const raw = `${inboundText ?? ''}`;
  let { current_state: st, slots } = bag;

  const apply = async (next, nextSlotsPatch, emitFn) => {
    const merged = {
      ...slots,
      ...(digits ? { customer_whatsapp_e164_digits: digits } : {}),
      ...(nextSlotsPatch || {}),
    };
    await wfStore.save(accountId, conversationId, { current_state: next, slots: merged });
    slots = merged;
    st = next;
    if (emitFn) await emitFn();
    return merged;
  };

  switch (st) {
    case S.ENTRY: {
      if (matchesReturning(norm, raw)) {
        const userMatch = await returningSvc.findUserClienteByPhoneDigits(digits);
        if (userMatch) {
          let ch;
          try {
            ch = await identityUtil.generateIdentityChallenge(userMatch.id);
          } catch (e) {
            console.warn('[fsm:identity_dob]', e.message || e);
            await wfStore.save(accountId, conversationId, {
              current_state: S.RETURNING_NEED_HUMAN,
              slots: { ...slots, is_returning_client: true, identity_dob_error: `${e.message || e}` },
            });
            await chatwootClient.postPrivateNote(
              accountId,
              conversationId,
              `${P.RETURNING_TEAM_NOTE_PT}\n(Erro desafio identidade: ${e.message || e})`
            );
            await evolveOrMirror(
              async (i, d, aid, cid) =>
                evolveSendText(i, d, 'Um momento 💜 já peço pra alguém da equipe reconhecer seu cadastro.'),
              ''
            );
            return { handled: true, mode: 'lead_fsm', state: S.RETURNING_NEED_HUMAN };
          }
          await apply(
            S.IDENTITY_CHALLENGE_DOB,
            {
              identity_user_id: userMatch.id,
              identity_dob_expected_iso: ch.canonical_iso,
            },
            async () =>
              evolveOrMirror(async (i, d, aid, cid) => {
                const rows = ch.options.map((o) => ({
                  rowId: `fsm:iden:dob:${o.iso}`,
                  title: `${isoDateLabelPt(o.iso)}`,
                  description: ' ',
                }));
                await evolveSendList(i, d, {
                  title: P.RETURN.IDENTITY.dobListTitle.slice(0, 60),
                  description: P.RETURN.IDENTITY.dobListDescription,
                  buttonText: P.RETURN.IDENTITY.dobListButton.slice(0, 20),
                  footerText: '\u2060',
                  values: [{ title: P.RETURN.IDENTITY.dobSection.slice(0, 24), rows }],
                });
              }, '')
          );
          return { handled: true, mode: 'lead_fsm', state: S.IDENTITY_CHALLENGE_DOB };
        }
        await wfStore.save(accountId, conversationId, {
          current_state: S.RETURNING_NEED_HUMAN,
          slots: { ...slots, is_returning_client: true },
        });
        await chatwootClient.postPrivateNote(accountId, conversationId, `${P.RETURNING_TEAM_NOTE_PT}\n(conv ${conversationId})`);
        await evolveOrMirror(
          async (i, d, aid, cid) =>
            evolveSendText(i, d, 'Um momento 💜 já peço pra alguém da equipe reconhecer seu cadastro.'),
          'Cliente retorno — equipe será acionada.'
        );
        return { handled: true, mode: 'lead_fsm', state: S.RETURNING_NEED_HUMAN };
      }
      if (matchesNewClient(norm, raw)) {
        slots.is_new_client = true;
        await apply(S.T2, { is_new_client: true }, async () =>
          evolveOrMirror((i, d, aid, cid) => emitT2(null, i, d, aid, cid), `[T2 texto]\n${P.T2.intro}`)
        );
        return { handled: true, mode: 'lead_fsm', state: S.T2 };
      }
      await evolveOrMirror((...a) => emitT1(null, ...a), P.T1.intro);
      return { handled: true, mode: 'lead_fsm', state: st, recycled: true };
    }

    case S.IDENTITY_CHALLENGE_DOB: {
      const picked = (raw.match(/fsm:iden:dob:([0-9]{4}-[0-9]{2}-[0-9]{2})/) || [])[1];
      if (picked && `${picked}` === `${slots.identity_dob_expected_iso}`) {
        const userRow = await User.findByPk(slots.identity_user_id, { paranoid: true });
        if (!userRow) {
          await wfStore.save(accountId, conversationId, {
            current_state: S.RETURNING_NEED_HUMAN,
            slots: { ...slots, identity_missing_user: true },
          });
          return { handled: true, mode: 'lead_fsm', state: S.RETURNING_NEED_HUMAN };
        }
        let phCh;
        try {
          phCh = identityUtil.generatePhoneTailChallenge(userRow.phone || digits);
        } catch (e) {
          console.warn('[fsm:identity_ph]', e.message || e);
          await wfStore.save(accountId, conversationId, {
            current_state: S.RETURNING_NEED_HUMAN,
            slots: { ...slots, identity_phone_gen_error: true },
          });
          await chatwootClient.postPrivateNote(accountId, conversationId, `${P.RETURNING_TEAM_NOTE_PT}\n(${e.message || e})`);
          await evolveOrMirror(
            async (i, d) => evolveSendText(i, d, 'Um momento 💜 já peço para a equipe continuar.'),
            ''
          );
          return { handled: true, mode: 'lead_fsm', state: S.RETURNING_NEED_HUMAN };
        }
        await apply(
          S.IDENTITY_CHALLENGE_PHONE,
          { identity_phone_correct_row: phCh.correct_row_id },
          async () =>
            evolveOrMirror(async (i, d, aid, cid) => {
              const rows = phCh.options.map((o) => ({
                rowId: o.rowId,
                title: o.label.slice(0, 24),
                description: ' ',
              }));
              await evolveSendList(i, d, {
                title: P.RETURN.IDENTITY.phoneListTitle.slice(0, 60),
                description: P.RETURN.IDENTITY.phoneListDescription,
                buttonText: P.RETURN.IDENTITY.phoneListButton.slice(0, 20),
                footerText: '\u2060',
                values: [{ title: P.RETURN.IDENTITY.phoneSection.slice(0, 24), rows }],
              });
            }, '')
        );
        return { handled: true, mode: 'lead_fsm', state: S.IDENTITY_CHALLENGE_PHONE };
      }
      await evolveOrMirror((i, d) => evolveSendText(i, d, P.RETURN.IDENTITY.fail), '');
      await wfStore.save(accountId, conversationId, {
        current_state: S.RETURNING_NEED_HUMAN,
        slots: { ...slots, identity_dob_fail: true },
      });
      return { handled: true, mode: 'lead_fsm', state: S.RETURNING_NEED_HUMAN };
    }

    case S.IDENTITY_CHALLENGE_PHONE: {
      if (`${slots.identity_phone_correct_row || ''}` && raw.includes(`${slots.identity_phone_correct_row}`)) {
        const uid = slots.identity_user_id;
        const cidContact = `${contactId || ''}`.trim();
        if (cidContact && uid) {
          await User.update(
            {
              chatwoot_contact_id: cidContact,
              chatwoot_conversation_id: `${conversationId || ''}`.trim() || null,
            },
            { where: { id: uid } }
          );
        }
        await chatwootClient.postPrivateNote(accountId, conversationId, P.RETURN.IDENTITY.successNote);
        await wfStore.destroy(accountId, conversationId);
        const reloaded = await User.findByPk(uid, {
          paranoid: true,
          include: [{ model: Client, as: 'client_profile', required: false }],
        });
        return returningFsm.handleReturningFsmInbound({
          accountId,
          conversationId,
          parsed,
          inboundText,
          identity: { kind: 'user', user: reloaded },
        });
      }
      await evolveOrMirror((i, d) => evolveSendText(i, d, P.RETURN.IDENTITY.fail), '');
      await wfStore.save(accountId, conversationId, {
        current_state: S.RETURNING_NEED_HUMAN,
        slots: { ...slots, identity_phone_fail: true },
      });
      return { handled: true, mode: 'lead_fsm', state: S.RETURNING_NEED_HUMAN };
    }

    case S.T2: {
      const pkg = pickPackageFromInbound(norm, raw);
      if (
        raw.includes(P.T2.videoBtnId) ||
        norm.includes('pacotes de video') ||
        (norm.includes('video') && (norm.includes('pacote') || norm.includes('ver')))
      )
        await apply(S.T2V, {}, async () =>
          evolveOrMirror((i, d, aid, cid) => emitT2v(i, d, aid, cid), P.T2V.intro)
        );
      else if (pkg)
        await apply(
          S.T3,
          {
            selected_package_id: pkg.id,
            modality: pkg.modality,
            minutes: pkg.minutes,
            amount: pkg.amount,
          },
          async () => evolveOrMirror((i, d, aid, cid) => emitT3(i, d, aid, cid, slots), 'Confirme seu pacote')
        );
      else await evolveOrMirror((i, d, aid, cid) => emitT2(null, i, d, aid, cid), P.T2.intro);
      return { handled: true, mode: 'lead_fsm', state: st };
    }

    case S.T2V: {
      if (raw.includes('fsm:t2v:back:t2'))
        await apply(S.T2, {}, async () => evolveOrMirror((i, d, aid, cid) => emitT2(null, i, d, aid, cid), 'Voltamos ao texto/voz.'));
      else {
        const pkg = pickPackageFromInbound(norm, raw);
        if (pkg)
          await apply(
            S.T3,
            {
              selected_package_id: pkg.id,
              modality: pkg.modality,
              minutes: pkg.minutes,
              amount: pkg.amount,
            },
            async () => evolveOrMirror((i, d, aid, cid) => emitT3(i, d, aid, cid, slots), 'Pacote vídeo.')
          );
        else await evolveOrMirror((i, d, aid, cid) => emitT2v(i, d, aid, cid), 'Escolha um pacote de vídeo na lista 💜');
      }
      return { handled: true, mode: 'lead_fsm', state: st };
    }

    case S.T3: {
      if (raw.includes('fsm:t3:change_pkg')) {
        const back = `${slots.modality || ''}` === 'video' ? S.T2V : S.T2;
        await apply(back, {}, async () =>
          evolveOrMirror(async (i, d, aid, cid) =>
            back === S.T2V ? emitT2v(i, d, aid, cid) : emitT2(null, i, d, aid, cid)
          )
        );
        return { handled: true, mode: 'lead_fsm', state: back };
      }
      if (raw.includes('fsm:t3:confirm_pix'))
        await apply(S.T4, {}, async () =>
          evolveOrMirror(
            async (inst, digits, aid, cid) =>
              ensureLeadFsmPixDelivered(inst, digits, aid, cid, slots, leadId || null),
            P.T4.intro
          )
        );
      else
        await evolveOrMirror((i, d, aid, cid) => emitT3(i, d, aid, cid, slots), '');
      return { handled: true, mode: 'lead_fsm', state: st };
    }

    case S.T4: {
      if (envTruth('CHATWOOT_LEAD_FSM_DEV_CONFIRM_PAY')) {
        const fmt = `${slots.amount || 'valor'}`.includes(',')
          ? `R$${slots.amount}`
          : `R$${slots.amount ?? '—'}`;
        await apply(S.T5, { payment_confirmed_at: Date.now() }, async () =>
          evolveOrMirror((i, d, aid, cid) => emitT5(i, d, aid, cid, fmt), P.T5({ amountFormatted: fmt }))
        );
        return { handled: true, mode: 'lead_fsm', dev: true };
      }
      await evolveOrMirror(
        async (inst, digits, aid, cid) => ensureLeadFsmPixDelivered(inst, digits, aid, cid, slots, leadId || null),
        'Aguardando pagamento PIX'
      );
      return { handled: true, mode: 'lead_fsm', state: S.T4 };
    }

    case S.T5: {
      const extracted = await anthropicService.extractFsmLeadClienteProfile(raw);
      const okEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(`${extracted.email || ''}`);
      const okName =
        `${extracted.nome_completo || ''}`.trim().length > 5;
      const okIso = Boolean(`${extracted.data_nascimento_iso || ''}`.trim());

      const okAi = extracted.ok === true && okEmail && okName && okIso;
      if (!okAi) {
        const hint =
          extracted.erro === 'ia_offline'
            ? 'Não consegui acionar o assistente agora 💜 Envie junto na mesma mensagem: nome completo, data (DD/MM/AAAA ou AAAA-MM-DD) e e-mail.'
            : 'Não consegui extrair seus dados 💜 Preciso do **nome completo**, da **data de nascimento** (DD/MM/AAAA ou AAAA-MM-DD) e de um **e-mail válidos**, todos na mesma mensagem.';
        await evolveOrMirror((i, d, aid, cid) => evolveSendText(i, d, hint), 'Faltam dados (FSM IA)');
      } else {
        const iso = `${extracted.data_nascimento_iso || ''}`.trim();
        const br = isoDateToDdMmYyyy(iso);
        const first =
          `${(extracted.nome_completo || '').trim().split(/\s+/)[0] || ''}`.replace(/[^\p{L}'-]/gu, '') ||
          'Querida';
        await wfStore.save(accountId, conversationId, {
          current_state: S.T6,
          slots: {
            ...slots,
            ...(digits ? { customer_whatsapp_e164_digits: digits } : {}),
            extracted_name: `${extracted.nome_completo || ''}`.trim(),
            extracted_birthdate_iso: iso,
            extracted_birthdate_display: br,
            extracted_email: `${extracted.email || ''}`.trim().toLowerCase(),
            extracted_first_name: first,
          },
        });
        const fresh = await wfStore.load(accountId, conversationId);
        slots = fresh.slots;
        st = fresh.current_state;
        await evolveOrMirror(async (i, d, aid, cid) => emitT6(i, d, aid, cid, slots), '');
      }
      return { handled: true, mode: 'lead_fsm', state: st };
    }

    default:
      /** fallthrough below */
      break;
  }

  /** Pós-merge T6+: re-load fresh */
  bag = await wfStore.load(accountId, conversationId);
  st = bag.current_state;
  slots = bag.slots;

  if (st === S.T6) {
    if (raw.includes('fsm:t6:fix') || norm.includes('corrig'))
      await apply(S.T5, {}, async () => {
        const fmt =
          `${slots.amount_display_for_copy || ''}`.trim() ||
          `${slots.amount || '?'}`;
        await evolveOrMirror((i, d, aid, cid) => emitT5(i, d, aid, cid, fmt.startsWith('R$') ? fmt : `R$${fmt}`), 'Corrigir dados');
      });
    else if (normalizeYes(norm) || raw.includes('fsm:t6:ok'))
      await apply(S.T7, {}, async () => evolveOrMirror((i, d, aid, cid) => emitT7(i, d, aid, cid), P.T7.intro));
    else await evolveOrMirror((i, d, aid, cid) => emitT6(i, d, aid, cid, slots), '');
    return { handled: true, mode: 'lead_fsm', state: st };
  }

  if (st === S.T7) {
    const mod = `${slots.modality || ''}`;
    if (`${mod}` === 'video' && mentionsWhatsappHandoff(norm)) {
      await evolveOrMirror((i, d, aid, cid) => evolveSendText(i, d, P.T7.videoWhatsappBlocked), '');
      return { handled: true, mode: 'lead_fsm', state: S.T7 };
    }
    if (!(raw.includes('fsm:t7:platform') || raw.includes('fsm:t7:phone')) && mentionsWhatsappHandoff(norm)) {
      await apply(S.T7_PRIVACY, {}, async () =>
        evolveOrMirror((i, d, aid, cid) => emitT7Privacy(i, d, aid, cid), P.T7.privacyExplanation)
      );
      return { handled: true, mode: 'lead_fsm', state: S.T7_PRIVACY };
    }
    if (raw.includes('fsm:t7:platform')) {
      const fin = await convertFsmLeadOnT8Choice(leadId || null, slots, digits);
      if (!fin.ok) {
        await evolveOrMirror((i, d, aid, cid) => evolveSendText(i, d, fin.userMessage), '');
        return { handled: true, mode: 'lead_fsm', state: S.T7 };
      }
      await apply(
        S.T8_PLATFORM,
        { selected_delivery_method: 'platform_chat', lead_fsm_converted_user_id: fin.userId },
        async () => evolveOrMirror((i, d, aid, cid) => emitT8Platform(i, d, aid, cid, slots), '')
      );
      if (!fin.already && accountId && conversationId) {
        await chatwootClient.postPrivateNote(
          accountId,
          conversationId,
          `✅ Lead convertido para User (${fin.userId}) — fluxo WhatsApp plataforma.`
        );
      }
    } else if (raw.includes('fsm:t7:phone')) {
      const fin = await convertFsmLeadOnT8Choice(leadId || null, slots, digits);
      if (!fin.ok) {
        await evolveOrMirror((i, d, aid, cid) => evolveSendText(i, d, fin.userMessage), '');
        return { handled: true, mode: 'lead_fsm', state: S.T7 };
      }
      await apply(
        S.T8_PHONE,
        { selected_delivery_method: 'phone', lead_fsm_converted_user_id: fin.userId },
        async () => evolveOrMirror((i, d, aid, cid) => emitT8Phone(i, d, aid, cid, slots), '')
      );
      if (!fin.already && accountId && conversationId) {
        await chatwootClient.postPrivateNote(
          accountId,
          conversationId,
          `✅ Lead convertido para User (${fin.userId}) — fluxo WhatsApp telefone.`
        );
      }
    }
    else await evolveOrMirror((i, d, aid, cid) => emitT7(i, d, aid, cid), '');
    return { handled: true, mode: 'lead_fsm', state: st };
  }

  if (st === S.T7_PRIVACY) {
    const del =
      raw.includes('fsm:t7:wa_text') ||
      normalizeInbound(raw).includes(normalizeInbound('💬 whatsapp texto'))
        ? 'whatsapp_text'
        : raw.includes('fsm:t7:wa_voice') ||
            normalizeInbound(raw).includes(normalizeInbound('🎙 whatsapp áudio'))
          ? 'whatsapp_audio'
          : null;
    if (del) {
      await chatwootClient.postPrivateNote(accountId, conversationId, P.HANDOFF_TEAM_NOTE_PT);
      await wfStore.save(accountId, conversationId, {
        current_state: S.HANDOFF_WHATSAPP,
        slots: { ...slots, selected_delivery_method: del, bot_human_handoff: true },
      });
      await evolveOrMirror(async (i, d, aid, cid) => emitWhatsAppHandoff(i, d, aid, cid), '');
    } else await evolveOrMirror((i, d, aid, cid) => emitT7Privacy(i, d, aid, cid), '');
    return { handled: true, mode: 'lead_fsm', state: st };
  }

  if (st === S.T8_PLATFORM || st === S.T8_PHONE || st === S.HANDOFF_WHATSAPP || st === S.RETURNING_NEED_HUMAN) {
    return { handled: true, mode: 'lead_fsm_terminal', state: st };
  }

  await evolveOrMirror(
    async (i, d, aid, cid) =>
      evolveSendText(
        i,
        d,
        'Recebi algo que não consigo ligar aos botões 💜 Posso repetir esta etapa já já — ou mande só o número da lista/botão exibidos.'
      ),
    '[Bot Lead] Estado sem rota textual clara.'
  );
  return { handled: true, mode: 'lead_fsm_reprompt', state: st };
}

/**
 * Ligado pelo webhook **Mercado Pago** quando o pagamento ficar autorizado —
 * faz transição automática para coleta `T5` sem depender de texto da cliente.
 * @param {{ amountFormatted?: string }} [opts]
 */
async function advancePaymentCaptured(accountId, conversationId, opts = {}) {
  const bag = await wfStore.load(accountId, conversationId);
  if (!bag || `${bag.current_state}` !== `${S.T4}`) return { advanced: false, reason: 'not_in_pix_state' };

  const fmt =
    `${opts.amountFormatted || ''}`.trim() ||
    (bag.slots.amount ? `R$${bag.slots.amount}` : 'R$value');

  await wfStore.save(accountId, conversationId, {
    current_state: S.T5,
    slots: { ...bag.slots, payment_captured_iso: new Date().toISOString(), amount_display_for_copy: fmt },
  });

  const after = await wfStore.load(accountId, conversationId);
  const phoneStored = `${after?.slots?.customer_whatsapp_e164_digits || ''}`.trim();

  await mirrorChat(accountId, conversationId, `[Pagamento reconhecido] ${P.T5({ amountFormatted: fmt })}`);
  /** WhatsApp outbound real se já tínhamos o número guardado anteriormente nos slots */
  const inst = evolutionInstance();
  if (inst && phoneStored.length >= 10) await evolveSendText(inst, phoneStored, `${P.T5({ amountFormatted: fmt })}`);

  return { advanced: true, state: S.T5 };
}

function shouldRunLeadFsm(identityKind) {
  return identityKind === 'lead' && envTruth('CHATWOOT_LEAD_FSM_ENABLED');
}

/** Lead nova (03d) **ou** cliente `CLIENTE` identificada (03e). */
function shouldRunWhatsAppFsm(identity) {
  if (!envTruth('CHATWOOT_LEAD_FSM_ENABLED')) return false;
  if (!identity || !identity.kind) return false;
  if (identity.kind === 'lead') return true;
  if (identity.kind === 'user' && `${identity.user?.role || ''}`.toUpperCase() === 'CLIENTE') return true;
  return false;
}

async function handleWhatsAppFsmInbound(params) {
  const id = params.identity;
  if (id?.kind === 'user' && `${id.user?.role || ''}`.toUpperCase() === 'CLIENTE') {
    return returningFsm.handleReturningFsmInbound(params);
  }
  return handleLeadFsmInbound({
    accountId: params.accountId,
    conversationId: params.conversationId,
    parsed: params.parsed,
    inboundText: params.inboundText,
    leadId: params.leadId,
    contactId: params.contactId,
  });
}

module.exports = {
  WORKFLOW_PROVIDER: P.WORKFLOW_PROVIDER,
  shouldRunLeadFsm,
  shouldRunWhatsAppFsm,
  handleWhatsAppFsmInbound,
  handleLeadFsmInbound,
  advancePaymentCaptured,
};

