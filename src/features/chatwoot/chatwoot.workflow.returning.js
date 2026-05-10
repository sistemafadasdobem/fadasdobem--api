'use strict';

const evolutionClient = require('../../providers/evolution/evolution.client');
const chatwootClient = require('../../providers/chatwoot/chatwoot.client');
const wfStore = require('./chatwoot.workflow.store');
const P = require('./chatwoot.workflow.prompts');
const { User, Client, PricingLevel } = require('../../models');
const returningSvc = require('./chatwoot.returning.service');
const paymentsService = require('../payments/payments.service');

const S = P.STATES;
const R = P.RETURN;

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
    console.warn('[chatwoot:workflow:return][mirror]', e.message || e);
  }
}

function captionsShort(s, max) {
  return `${s ?? ''}`.slice(0, max);
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

function nickFromSlots(sl) {
  const base = `${sl?.display_name || 'Cliente'}`.trim() || 'Cliente';
  return captionsShort(base.split(/\s+/)[0] || 'Cliente', 40);
}

function normalizeYes(norm) {
  return ['sim', 'confirmo', 'continuar', 'ok', 'pode'].some((s) => norm.includes(s));
}

/** Estados do fluxo 03d (lead nova) — substituídos ao reconhecer cliente no telefone. */
function isLeadNovoState(stKey) {
  const k = `${stKey || ''}`;
  const lead = new Set([
    P.STATES.ENTRY,
    P.STATES.T2,
    P.STATES.T2V,
    P.STATES.T3,
    P.STATES.T4,
    P.STATES.T5,
    P.STATES.T6,
    P.STATES.T7,
    P.STATES.T7_PRIVACY,
    P.STATES.T8_PLATFORM,
    P.STATES.T8_PHONE,
    P.STATES.RETURNING_NEED_HUMAN,
    P.STATES.HANDOFF_WHATSAPP,
  ]);
  return lead.has(k);
}

function mentionsPriceComplaint(norm) {
  return (
    norm.includes('caro') ||
    norm.includes('cara') ||
    norm.includes('preco') ||
    norm.includes('preço') ||
    norm.includes('valor alto') ||
    norm.includes('absurdo')
  );
}

function buildReturnPackageRows(snapshot, modality /* 'tv' | 'vd' */) {
  const rows = [];
  if (modality === 'tv') {
    const ppm = snapshot.price_text_voice_per_min;
    for (const m of [15, 30, 60]) {
      const total = returningSvc.roundMoney(m * ppm);
      rows.push({
        rowId: `fsm:e4:tv:${m}`,
        title: `⏱ ${m} min`,
        description: `${returningSvc.formatBrl(total)} · texto ou voz`,
      });
    }
  } else {
    const pv = snapshot.price_video_per_min;
    for (const m of [30, 40, 60]) {
      const total = returningSvc.roundMoney(m * pv);
      rows.push({
        rowId: `fsm:e4:vd:${m}`,
        title: `🎥 ${m} min`,
        description: `${returningSvc.formatBrl(total)} · vídeo`,
      });
    }
  }
  return rows;
}

function parseE4Row(raw) {
  let m = raw.match(/fsm:e4:(tv|vd):(\d+)/);
  if (m) return { kind: m[1], minutes: Number(m[2]) };
  m = raw.match(/fsm:e4:goto:(tv|vd)/);
  if (m) return { section: m[1] };
  return null;
}

/**
 * @param {{ accountId: string, conversationId: string, parsed: object, inboundText: string, identity: { kind: string, user: import('sequelize').Model } }} ctx
 */
async function handleReturningFsmInbound(ctx) {
  const { accountId, conversationId, parsed, inboundText, identity } = ctx;
  const digits = extractPhoneDigitsFromParsed(parsed || {});
  const inst = evolutionInstance();
  const warn = [];
  const norm = normalizeInbound(inboundText);
  const raw = `${inboundText ?? ''}`;

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

  const fullUser = await User.findByPk(identity.user.id, {
    paranoid: true,
    include: [
      {
        model: Client,
        as: 'client_profile',
        required: true,
        include: [{ model: PricingLevel, as: 'pricing_level', required: false }],
      },
    ],
  });

  if (!fullUser?.client_profile) {
    return { handled: true, mode: 'returning_fsm_blocked', reason: 'sem_perfil_cliente' };
  }

  const snapshot = await returningSvc.buildReturningClientSnapshot(fullUser);
  if (!snapshot) {
    return { handled: true, mode: 'returning_fsm_blocked', reason: 'snapshot_null' };
  }

  let bag = await wfStore.load(accountId, conversationId);
  let { current_state: st, slots } = bag || { current_state: null, slots: {} };
  slots = slots || {};

  if (bag && isLeadNovoState(st)) {
    await wfStore.save(accountId, conversationId, {
      current_state: S.E1_RETURN_WELCOME,
      slots: {
        ...slots,
        return_user_id: snapshot.user_id,
        return_client_id: snapshot.client_id,
        display_name: snapshot.nome_exibicao,
        customer_whatsapp_e164_digits: digits || slots.customer_whatsapp_e164_digits,
        return_welcome_pending: true,
      },
    });
    bag = await wfStore.load(accountId, conversationId);
    st = bag.current_state;
    slots = bag.slots || {};
  }

  const mergeSlots = (patch) => ({
    ...slots,
    return_user_id: snapshot.user_id,
    return_client_id: snapshot.client_id,
    display_name: snapshot.nome_exibicao,
    ...(digits ? { customer_whatsapp_e164_digits: digits } : {}),
    ...(patch || {}),
  });

  const apply = async (next, nextSlotsPatch, emitFn) => {
    const merged = mergeSlots({ ...(digits ? { customer_whatsapp_e164_digits: digits } : {}), ...(nextSlotsPatch || {}) });
    await wfStore.save(accountId, conversationId, { current_state: next, slots: merged });
    slots = merged;
    st = next;
    if (emitFn) await emitFn();
    return merged;
  };

  /** Primeira mensagem — reentry ou E1 (ou migração 03d → 03e). */
  if (!bag || slots.return_welcome_pending) {
    const re = await returningSvc.detectReturnReentry(snapshot.client_id);
    const patch = {
      welcome_emitted_at: Date.now(),
      return_welcome_pending: false,
      return_snapshot_cache: {
        balance: snapshot.display_balance_brl,
        nivel: snapshot.pricing_level_label,
      },
    };
    if (re.active) {
      await wfStore.save(accountId, conversationId, {
        current_state: S.E0_REENTRY,
        slots: mergeSlots({
          ...patch,
          reentry_kind: re.kind,
          reentry_ref_id: re.queue_id || re.session_id || null,
        }),
      });
      bag = await wfStore.load(accountId, conversationId);
      st = bag.current_state;
      slots = bag.slots;
      await evolveOrMirror(
        async (i, d, aid, cid) => {
          const msg = R.E0.resumePrompt({ firstName: nickFromSlots(slots) });
          await evolveSendText(i, d, msg);
          await mirrorChat(aid, cid, `[Retorno 03e]\n${msg}`);
          await pause(400);
          await evolveSendBt(i, d, { title: 'Retomar?', description: ' ', footer: '\u2060' }, R.E0.buttons);
        },
        '[Cliente retorno — re-entry]'
      );
      return { handled: true, mode: 'returning_fsm', state: st, warning: warn };
    }

    await wfStore.save(accountId, conversationId, {
      current_state: S.E1_RETURN_WELCOME,
      slots: mergeSlots(patch),
    });
    bag = await wfStore.load(accountId, conversationId);
    st = bag.current_state;
    slots = bag.slots;

    await evolveOrMirror(
      async (i, d, aid, cid) => {
        const wmsg = R.E1.welcome({ displayName: snapshot.nome_exibicao });
        await evolveSendText(i, d, wmsg);
        await mirrorChat(aid, cid, `[Retorno 03e · E1]\n${wmsg}`);
        await pause(450);
        await evolveSendBt(
          i,
          d,
          { title: 'Continuar', description: ' ', footer: '\u2060' },
          [R.E1.toBalanceBtn]
        );
        const note = returningSvc.buildAttendantPrivateNote(snapshot);
        if (note)
          await chatwootClient.postPrivateNote(
            accountId,
            conversationId,
            `🔔 **Cliente identificada (03e)** — nota automática.\n${note}`
          );
      },
      R.E1.welcome({ displayName: snapshot.nome_exibicao })
    );
    return { handled: true, mode: 'returning_fsm', state: st, warning: warn, note: 'welcome_emitted' };
  }

  /** Queixas de preço */
  if (mentionsPriceComplaint(norm)) {
    if (slots.price_complaint_count >= 1) {
      await chatwootClient.postPrivateNote(accountId, conversationId, R.E4.priceComplaintEscalationNote);
      await evolveOrMirror((i, d) => evolveSendText(i, d, 'Entendi 💜 Vou pedir para **alguém da equipe** te responder aqui sobre valores.'), '');
      return { handled: true, mode: 'returning_fsm_human', state: st };
    }
    await wfStore.save(accountId, conversationId, {
      current_state: st,
      slots: mergeSlots({ price_complaint_count: (slots.price_complaint_count || 0) + 1 }),
    });
    await evolveOrMirror((i, d) => evolveSendText(i, d, R.E4.priceComplaint), '');
    return { handled: true, mode: 'returning_fsm', state: st };
  }

  switch (st) {
    case S.E0_REENTRY: {
      if (raw.includes('fsm:e0:resume_yes')) {
        await apply(S.E3_CHECK_BALANCE, {}, async () =>
          evolveOrMirror(async (i, d, aid, cid) => {
            const sn = await returningSvc.buildReturningClientSnapshot(fullUser);
            const intro = R.E3.balanceIntro({
              firstName: nickFromSlots(slots),
              balanceLabel: sn.display_balance_brl,
            });
            await evolveSendText(i, d, intro);
            await mirrorChat(aid, cid, intro);
            await pause(400);
            await evolveSendBt(
              i,
              d,
              { title: 'Saldo', description: ' ', footer: '\u2060' },
              R.E3.buttons
            );
          }, '')
        );
      } else if (raw.includes('fsm:e0:human')) {
        await chatwootClient.postPrivateNote(accountId, conversationId, 'Cliente pediu **equipe** na retomada (E0).');
        await evolveOrMirror((i, d) => evolveSendText(i, d, 'Combinado 💜 Já peço para **alguém da equipe** continuar por aqui.'), '');
      } else {
        await evolveOrMirror(
          async (i, d, aid, cid) => {
            const msg = R.E0.resumePrompt({ firstName: nickFromSlots(slots) });
            await evolveSendText(i, d, msg);
            await evolveSendBt(i, d, { title: 'Retomar?', description: ' ', footer: '\u2060' }, R.E0.buttons);
          },
          ''
        );
      }
      return { handled: true, mode: 'returning_fsm', state: st, warning: warn };
    }

    case S.E1_RETURN_WELCOME: {
      if (raw.includes('fsm:e1:to_balance') || normalizeYes(norm)) {
        await apply(S.E3_CHECK_BALANCE, {}, async () =>
          evolveOrMirror(async (i, d, aid, cid) => {
            const sn = await returningSvc.buildReturningClientSnapshot(fullUser);
            const intro = R.E3.balanceIntro({
              firstName: nickFromSlots(slots),
              balanceLabel: sn.display_balance_brl,
            });
            await evolveSendText(i, d, intro);
            await mirrorChat(aid, cid, intro);
            await pause(400);
            await evolveSendBt(i, d, { title: 'Saldo', description: ' ', footer: '\u2060' }, R.E3.buttons);
          }, '')
        );
      } else {
        await evolveOrMirror(
          async (i, d, aid, cid) => {
            const sn = await returningSvc.buildReturningClientSnapshot(fullUser);
            await evolveSendText(
              i,
              d,
              R.E1.welcome({ displayName: sn.nome_exibicao }) + '\n\n_Toque em **Ver saldo e continuar** quando quiser 💜_'
            );
            await evolveSendBt(
              i,
              d,
              { title: 'Continuar', description: ' ', footer: '\u2060' },
              [R.E1.toBalanceBtn]
            );
          },
          ''
        );
      }
      return { handled: true, mode: 'returning_fsm', state: st, warning: warn };
    }

    case S.E3_CHECK_BALANCE: {
      if (raw.includes('fsm:e3:use_balance')) {
        await apply(S.E5_RETURN_MODALITY, { return_path: 'use_balance' }, async () =>
          evolveOrMirror(
            async (i, d, aid, cid) =>
              evolveSendBt(
                i,
                d,
                { title: 'Modalidade', description: R.E5.intro, footer: '\u2060' },
                R.E5.buttons
              ),
            R.E5.intro
          )
        );
        return { handled: true, mode: 'returning_fsm', state: st, warning: warn };
      }
      if (raw.includes('fsm:e3:add_time')) {
        const hasMin = snapshot.has_fifteen_plus_minutes;
        await apply(S.E4_RETURN_PRICING, { pricing_section: 'tv' }, async () =>
          evolveOrMirror(async (i, d, aid, cid) => {
            const sn = await returningSvc.buildReturningClientSnapshot(fullUser);
            const rows = buildReturnPackageRows(sn, 'tv');
            await evolveSendList(i, d, {
              title: captionsShort(R.E4.list.title, 60),
              description:
                (hasMin
                  ? `Seu saldo cobre pelo menos **15 min** ao seu nível 💜\n\n`
                  : `Vamos **adicionar tempo** — pacotes conforme seu **nível tarifário** 💜\n\n`) + `Saldo: **${sn.display_balance_brl}**`,
              buttonText: R.E4.list.buttonText.slice(0, 18),
              footerText: R.E4.list.footerText,
              values: [{ title: R.E4.list.sectionTitle, rows }],
            });
            await evolveSendBt(
              i,
              d,
              { title: 'Vídeo', description: 'Ver pacotes de vídeo', footer: '\u2060' },
              [{ title: 'reply', displayText: '🎥 Pacotes vídeo', id: 'fsm:e4:goto:vd' }]
            );
          }, 'Pacotes retorno')
        );
        return { handled: true, mode: 'returning_fsm', state: st, warning: warn };
      }
      await evolveOrMirror(
        async (i, d, aid, cid) => {
          const sn = await returningSvc.buildReturningClientSnapshot(fullUser);
          const intro = R.E3.balanceIntro({
            firstName: nickFromSlots(slots),
            balanceLabel: sn.display_balance_brl,
          });
          await evolveSendText(i, d, intro);
          await evolveSendBt(i, d, { title: 'Saldo', description: ' ', footer: '\u2060' }, R.E3.buttons);
        },
        ''
      );
      return { handled: true, mode: 'returning_fsm', state: st, warning: warn };
    }

    default:
      break;
  }

  if (st === S.E4_RETURN_PRICING) {
    const snap = await returningSvc.buildReturningClientSnapshot(fullUser);
    const section = `${slots.pricing_section || 'tv'}` === 'vd' ? 'vd' : 'tv';

    if (raw.includes('fsm:e4:goto:tv')) {
      await wfStore.save(accountId, conversationId, {
        current_state: S.E4_RETURN_PRICING,
        slots: mergeSlots({ pricing_section: 'tv' }),
      });
      slots = (await wfStore.load(accountId, conversationId)).slots;
      st = S.E4_RETURN_PRICING;
      await evolveOrMirror(async (i, d) => {
        const rows = buildReturnPackageRows(snap, 'tv');
        await evolveSendList(i, d, {
          title: captionsShort(R.E4.list.title, 60),
          description: `Texto ou voz · Saldo: **${snap.display_balance_brl}**`,
          buttonText: R.E4.list.buttonText.slice(0, 18),
          footerText: R.E4.list.footerText,
          values: [{ title: R.E4.list.sectionTitle, rows }],
        });
      }, '');
      return { handled: true, mode: 'returning_fsm', state: st };
    }

    if (raw.includes('fsm:e4:goto:vd')) {
      await wfStore.save(accountId, conversationId, {
        current_state: S.E4_RETURN_PRICING,
        slots: mergeSlots({ pricing_section: 'vd' }),
      });
      slots = (await wfStore.load(accountId, conversationId)).slots;
      await evolveOrMirror(async (i, d) => {
        const rows = buildReturnPackageRows(snap, 'vd');
        await evolveSendList(i, d, {
          title: '🎥 Vídeo',
          description: `Preço fixo por minuto ao seu cadastro 💜\nSaldo: **${snap.display_balance_brl}**`,
          buttonText: R.E4.list.buttonText.slice(0, 18),
          footerText: R.E4.list.footerText,
          values: [{ title: R.E4.listVideoSection, rows }],
        });
      }, '');
      return { handled: true, mode: 'returning_fsm', state: st };
    }

    const pick = parseE4Row(raw);
    if (pick && pick.kind && pick.minutes) {
      const ppm = pick.kind === 'tv' ? snap.price_text_voice_per_min : snap.price_video_per_min;
      const total = returningSvc.roundMoney(pick.minutes * ppm);
      const diff = Math.max(0, returningSvc.roundMoney(total - snap.usable_brl_total));

      await wfStore.save(accountId, conversationId, {
        current_state: S.E4_RETURN_PRICING,
        slots: mergeSlots({
          return_pending_pkg: `${pick.kind}:${pick.minutes}`,
          return_pending_total_brl: total,
          return_pending_diff_brl: diff,
        }),
      });

      if (diff <= 0.01) {
        await chatwootClient.postPrivateNote(
          accountId,
          conversationId,
          `PIX não necessário — saldo cobre **${returningSvc.formatBrl(total)}** (${pick.minutes} min · ${pick.kind}).`
        );
        await evolveOrMirror(
          (i, d) =>
            evolveSendText(
              i,
              d,
              `Perfeito 💜 O pacote de **${pick.minutes} min** entra pelo seu **saldo atual** (${snap.display_balance_brl}).\n\n` +
                `Em instantes o app libera o **link da consulta** — se não abrir, diga **continuar** aqui.`
            ),
          ''
        );
        return { handled: true, mode: 'returning_fsm', state: st };
      }

      try {
        const mp = await paymentsService.createPixCheckout(fullUser, {
          amount: diff,
          label: `Complemento retorno ${pick.minutes} min (${pick.kind})`,
          credit_type: 'PACOTE_SESSAO_UNICA',
        });
        const pix = mp.pix?.qr_code ? `${mp.pix.qr_code}`.trim() : '';
        await chatwootClient.postPrivateNote(
          accountId,
          conversationId,
          `PIX retorno 03e: diff **${returningSvc.formatBrl(diff)}** / pacote **${returningSvc.formatBrl(total)}** · conv \`${conversationId}\`.`
        );
        await evolveOrMirror(async (i, d, aid, cid) => {
          await evolveSendText(
            i,
            d,
            `Para fechar os **${pick.minutes} min**, falta **${returningSvc.formatBrl(diff)}** no seu saldo 💜\n\n` +
              `Geramos o PIX abaixo. Quando o banco confirmar, continuo automaticamente com o **link da consulta**.`
          );
          if (pix) await evolveSendText(i, d, `Copia-e-Cola PIX:\n\n${pix}`);
          const b64 = `${mp.pix?.qr_code_base64 || ''}`.trim();
          if (b64 && evolutionClient.sendMessageMedia) {
            const media = b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
            try {
              await evolutionClient.sendMessageMedia(i, {
                number: d,
                mediatype: 'image',
                mimetype: 'image/png',
                caption: 'QR Code PIX — complemento',
                media,
              });
            } catch (e) {
              console.warn('[returning:pix_qr]', e.message || e);
            }
          }
        }, '');
      } catch (e) {
        console.warn('[returning:createPixCheckout]', e.message || e);
        await chatwootClient.postPrivateNote(
          accountId,
          conversationId,
          `Falha ao gerar PIX retorno: ${e.message || e}`
        );
        await evolveOrMirror(
          (i, d) =>
            evolveSendText(
              i,
              d,
              `Precisamos de **${returningSvc.formatBrl(diff)}** para completar o pacote 💜 A equipe pode te enviar o PIX manualmente nesta conversa.`
            ),
          ''
        );
      }
      return { handled: true, mode: 'returning_fsm', state: st };
    }

    await evolveOrMirror(async (i, d) => {
      const rows = buildReturnPackageRows(snap, section === 'vd' ? 'vd' : 'tv');
      await evolveSendList(i, d, {
        title: section === 'vd' ? '🎥 Vídeo' : captionsShort(R.E4.list.title, 60),
        description: `Saldo: **${snap.display_balance_brl}**`,
        buttonText: R.E4.list.buttonText.slice(0, 18),
        footerText: R.E4.list.footerText,
        values: [
          {
            title: section === 'vd' ? R.E4.listVideoSection : R.E4.list.sectionTitle,
            rows,
          },
        ],
      });
    }, '');
    return { handled: true, mode: 'returning_fsm', state: st };
  }

  if (st === S.E5_RETURN_MODALITY) {
    let line = 'Registrei sua preferência 💜 Em breve você recebe o link no app.';
    if (raw.includes('fsm:e5:texto')) line = '💬 **Chat texto** — vamos te encaminhar para a sala certa 💜';
    if (raw.includes('fsm:e5:voz')) line = '📞 **Voz** — combinado! A equipe alinha o melhor canal 💜';
    if (raw.includes('fsm:e5:video')) line = '🎥 **Vídeo** — somente pela **plataforma** (privacidade) 💜';

    if (raw.includes('fsm:e5:')) {
      await chatwootClient.postPrivateNote(accountId, conversationId, `Modalidade retorno 03e: \`${raw}\``);
      await evolveOrMirror((i, d) => evolveSendText(i, d, `${line}\n\n_Se precisar de humano, diga **equipe**._`), '');
      return { handled: true, mode: 'returning_fsm', state: st };
    }

    await evolveOrMirror(
      async (i, d) =>
        evolveSendBt(
          i,
          d,
          { title: 'Modalidade', description: R.E5.intro, footer: '\u2060' },
          R.E5.buttons
        ),
      ''
    );
    return { handled: true, mode: 'returning_fsm', state: st };
  }

  await evolveOrMirror(
    (i, d) =>
      evolveSendText(
        i,
        d,
        'Não consegui encaixar sua mensagem no fluxo de retorno 💜 Diga **menu** ou peça **equipe**.'
      ),
    ''
  );
  return { handled: true, mode: 'returning_fsm_reprompt', state: st, warning: warn };
}

module.exports = {
  handleReturningFsmInbound,
};
