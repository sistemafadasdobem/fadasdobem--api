'use strict';

const { Op, Sequelize } = require('sequelize');
const {
  User,
  Client,
  Specialist,
  LedgerAccount,
  ClientCreditLot,
  Session,
  PricingLevel,
} = require('../../models');
const chatwootClient = require('../../providers/chatwoot/chatwoot.client');
const sessionsService = require('../sessions/sessions.service');
const paymentsService = require('../payments/payments.service');
const { loadPackageCatalog } = require('../payments/payments.constants');
const AppError = require('../../utils/AppError');

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SLASH_HELP =
  '`/buscar_cliente`, `/lancar_pagamento …`, `/ver_tarologas`, `/gerar_link [uuid_tarologa]`';

function coerceConversationRecord(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const p0 = Array.isArray(raw.payload) ? raw.payload[0] : null;
  if (p0 && typeof p0 === 'object') return p0;
  if (raw.payload && typeof raw.payload === 'object' && !Array.isArray(raw.payload)) {
    return raw.payload;
  }
  return raw;
}

/** @param {unknown} raw */
function extractAssigneeFromConversationApi(raw) {
  const p = coerceConversationRecord(raw);
  return (
    p?.meta?.assignee ||
    raw?.meta?.assignee ||
    p?.conversation?.meta?.assignee ||
    p?.conversation?.details?.contact?.contact_inbox?.assignee ||
    null
  );
}

function fmtBrl(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return x.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function roundMoney4(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return NaN;
  return Math.round(x * 10000) / 10000;
}

function noteError(accountId, conversationId, prefix, error) {
  const msg =
    error instanceof AppError && error.message
      ? `${prefix}: ${error.message}`
      : error && typeof error.message === 'string' && error.message.trim()
      ? `${prefix}: ${error.message.trim()}`
      : `${prefix}: falha inesperada.`;
  return chatwootClient.postPrivateNote(`${accountId}`.trim(), `${conversationId}`.trim(), msg);
}

/**
 * Associa UUID da taróloga pelo assignee Chatwoot: e-mail igual ao `User.email` com `specialist_profile`.
 */
async function resolveSpecialistIdFromConversationAssignee(accountId, conversationId) {
  const raw = await chatwootClient.fetchConversation(accountId, conversationId);
  const assignee = extractAssigneeFromConversationApi(raw);
  const emailNorm = `${assignee?.email || ''}`.trim().toLowerCase();
  if (!emailNorm || !`${assignee.email || ''}`.includes('@')) {
    return null;
  }

  const user = await User.findOne({
    where: Sequelize.where(Sequelize.fn('LOWER', Sequelize.col('email')), emailNorm),
    include: [{ model: Specialist, as: 'specialist_profile', attributes: ['id'], required: true }],
    paranoid: true,
  });

  const sid = user?.specialist_profile?.id;
  return sid ? String(sid) : null;
}

async function gerarLink({ accountId, conversationId, contactId, restArgs }) {
  const firstArg = `${(restArgs && restArgs[0]) || ''}`.trim();
  /** Só usa assignee quando a atendente **não** enviou argumento; UUID inválido não herda fallback. */
  let specialistRaw = '';
  if (firstArg && UUID.test(firstArg.toLowerCase())) {
    specialistRaw = firstArg.toLowerCase();
  } else if (!firstArg) {
    try {
      const inferred = await resolveSpecialistIdFromConversationAssignee(
        accountId,
        conversationId
      );
      if (inferred && UUID.test(String(inferred).toLowerCase())) {
        specialistRaw = String(inferred).toLowerCase();
      }
    } catch (e) {
      console.warn('[chatwoot:commands] /gerar_link assignee fallback falhou:', e?.message || e);
    }
  } else {
    await chatwootClient.postPrivateNote(
      accountId,
      conversationId,
      'UUID da taróloga inválido. Envie `/gerar_link` só com taróloga **atribuída** ao ticket ou `/gerar_link <uuid>`.'
    );
    return;
  }

  if (!UUID.test(specialistRaw)) {
    await chatwootClient.postPrivateNote(
      accountId,
      conversationId,
      'Uso: `/gerar_link` (com taróloga atribuída à conversa) **ou** `/gerar_link <uuid_da_tarologa>`.\n' +
        'Não conseguimos ler o assignee no Chatwoot ou o utilizador não tem perfil tarólogo na plataforma — envie o UUID.'
    );
    return;
  }

  const specialist_id = specialistRaw;

  const cidChatwoot = `${contactId || ''}`.trim();
  const user = await User.findOne({
    where: { chatwoot_contact_id: cidChatwoot },
    include: [{ model: Client, as: 'client_profile', required: true }],
    paranoid: true,
  });

  if (!user || !user.client_profile) {
    await chatwootClient.postPrivateNote(
      accountId,
      conversationId,
      'Erro ao gerar link: não há conta de cliente registada ligada a este contacto Chatwoot (user + perfil cliente).'
    );
    return;
  }

  if (`${user.role || ''}`.trim().toUpperCase() !== 'CLIENTE') {
    await chatwootClient.postPrivateNote(
      accountId,
      conversationId,
      'Erro ao gerar link: o utilizador associado não está com papel CLIENTE.'
    );
    return;
  }

  const frontendBaseRaw = `${process.env.FRONTEND_URL || ''}`.trim();
  if (!frontendBaseRaw) {
    await chatwootClient.postPrivateNote(
      accountId,
      conversationId,
      'Erro ao gerar link: `FRONTEND_URL` não está configurado no servidor.'
    );
    return;
  }

  const sessionPlain = await sessionsService.createSession(user, {
    specialist_id,
    modality: 'VIDEO',
    status: 'READY',
  });

  const tokenPack = await sessionsService.getRtcTokenForAuthenticatedUser(
    `${sessionPlain.id}`,
    user.id,
    { expiresInSeconds: 3600 }
  );

  const base = frontendBaseRaw.replace(/\/+$/, '');
  const channel = tokenPack.channelName || tokenPack.channel_name;
  const url = `${base}/sala?channel=${encodeURIComponent(`${channel}`)}&token=${encodeURIComponent(
    tokenPack.token || ''
  )}&uid=${encodeURIComponent(String(tokenPack.uid ?? ''))}`;

  const linhas = [
    'Link VIDEO (copie para o cliente quando for o momento adequado)',
    '',
    url,
    '',
    `session_id: ${sessionPlain.id}`,
    `specialist_id: ${specialist_id}`,
    `contact_id (Chatwoot): ${cidChatwoot}`,
  ].join('\n');

  await chatwootClient.postPrivateNote(accountId, conversationId, linhas);

  console.log('[chatwoot:commands] /gerar_link ok', {
    conversationId,
    sessionId: sessionPlain.id,
    userId: user.id,
    specialist_id,
  });
}

async function buscarCliente({ accountId, conversationId, contactId }) {
  const cidChatwoot = `${contactId || ''}`.trim();

  const user = await User.findOne({
    where: { chatwoot_contact_id: cidChatwoot },
    include: [
      {
        model: Client,
        as: 'client_profile',
        required: false,
        include: [
          {
            model: PricingLevel,
            as: 'pricing_level',
            attributes: ['id', 'name', 'code', 'price_video'],
            required: false,
          },
        ],
      },
    ],
    paranoid: true,
  });

  const client = user?.client_profile;
  const nomeCandidates = [
    `${client?.nome || ''}`.trim(),
    `${client?.tratar_por || ''}`.trim(),
    `${user?.email || ''}`.trim(),
  ].filter(Boolean);
  const nome = nomeCandidates[0] || '—';

  const nivelNome = client?.pricing_level?.name
    ? `${client.pricing_level.name}${client.pricing_level.code ? ` (${client.pricing_level.code})` : ''}`
    : 'Sem nível de preço';

  let saldoLedger = '—';
  if (client?.id) {
    const wallet = await LedgerAccount.findOne({
      where: { client_id: client.id, account_type: 'CLIENT_WALLET' },
      attributes: ['cached_balance'],
    });
    saldoLedger = fmtBrl(wallet?.cached_balance);
  }

  let minutosPct = '—';
  if (client?.id) {
    const lotAgg = await ClientCreditLot.sum('remaining_amount', {
      where: {
        client_id: client.id,
        credit_type: 'PACOTE_SESSAO_UNICA',
        is_locked: false,
      },
    });
    const brlPacote = Number(lotAgg);
    const priceVidRaw = client?.pricing_level?.price_video;
    const priceVid = Number.parseFloat(`${priceVidRaw ?? ''}`);
    if (Number.isFinite(brlPacote) && brlPacote > 0 && Number.isFinite(priceVid) && priceVid > 0) {
      minutosPct = `${Math.floor(brlPacote / priceVid)} min (aprox.: saldo PACOTE × preço vídeo do nível)`;
    } else if (Number.isFinite(brlPacote) && brlPacote > 0) {
      minutosPct = `saldo PACOTE ${fmtBrl(brlPacote)} — defina nível de preço no cliente para estimar minutos`;
    } else {
      minutosPct = '0 min (sem PACOTE_SESSAO_UNICA ativo)';
    }
  }

  const texto =
    [
      '📋 **Ficha da Cliente:**',
      '',
      `- Nome: **${nome}**`,
      `- Nível: **${nivelNome}**`,
      `- Saldo Atual: R$ ${saldoLedger}`,
      `- Minutos (Sessão Única): **${minutosPct}**`,
    ].join('\n') +
    (user && user.email_verified_at == null ? '\n\n⚠️ E-mail pendente de verificação' : '');

  await chatwootClient.postPrivateNote(accountId, conversationId, texto);
}

function looksLikeBareAmountToken(tok) {
  const t = `${tok ?? ''}`.trim();
  if (!t) return false;
  return /^\d+([.,]\d{1,4})?$/.test(t);
}

function parseAmountFragmentBeforePackage(tokensBeforeLast) {
  const raw = tokensBeforeLast.join(' ').trim();
  if (!raw) return NaN;
  const compact = raw.replace(/\s/g, '');
  if (compact.includes(',')) {
    const noThousandsDots = compact.replace(/\./g, '');
    const n = Number(noThousandsDots.replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  }
  const n = Number(compact);
  return Number.isFinite(n) ? n : NaN;
}

function buildPaymentsBodyFromLancarArgs(restArgs) {
  if (!restArgs.length) return null;

  if (restArgs.length === 1) {
    if (looksLikeBareAmountToken(restArgs[0])) {
      const n = parseAmountFragmentBeforePackage([restArgs[0]]);
      if (!Number.isFinite(n) || n <= 0) return { error: 'Valor inválido.' };
      return { body: { amount: n }, amountDisplay: fmtBrl(n) };
    }
    return {
      body: { package_id: `${restArgs[0]}`.trim() },
      amountDisplay: '(pacote)',
    };
  }

  const catalog = loadPackageCatalog();
  const packageId = `${restArgs[restArgs.length - 1]}`.trim();
  const amtN = parseAmountFragmentBeforePackage(restArgs.slice(0, -1));

  if (!Number.isFinite(amtN) || amtN <= 0) {
    return { error: 'Primeiro argumento deve ser o valor positivo (ex.: 50 ou 49,99).' };
  }

  const pkg = catalog[packageId];
  if (!pkg) return { error: `Pacote desconhecido: "${packageId}".` };

  const expected = roundMoney4(Number(pkg.amount_brl));
  if (!Number.isFinite(expected) || expected <= 0) {
    return { error: `Pacote "${packageId}" sem valor de catálogo válido.` };
  }

  const got = roundMoney4(amtN);
  if (Math.abs(expected - got) > 0.01) {
    return {
      error: `Valor R$ ${fmtBrl(got)} não confere com o pacote **${packageId}** (R$ ${fmtBrl(expected)}).`,
    };
  }

  return { body: { package_id: packageId }, amountDisplay: fmtBrl(expected) };
}

async function lancarPagamento({ accountId, conversationId, contactId, restArgs }) {
  const parsed = buildPaymentsBodyFromLancarArgs(restArgs || []);
  if (!parsed || parsed.error) {
    await chatwootClient.postPrivateNote(
      accountId,
      conversationId,
      [
        'Uso: `/lancar_pagamento <valor_em_R$>` ou `/lancar_pagamento <pacote_id>` ou',
        '`/lancar_pagamento <valor_em_R$> <pacote_id>` (valor igual ao catálogo).',
        '',
        parsed?.error ? `⚠️ ${parsed.error}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    );
    return;
  }

  const cidChatwoot = `${contactId || ''}`.trim();
  const user = await User.findOne({
    where: { chatwoot_contact_id: cidChatwoot },
    include: [{ model: Client, as: 'client_profile', required: true }],
    paranoid: true,
  });

  if (!user || !user.client_profile) {
    await chatwootClient.postPrivateNote(
      accountId,
      conversationId,
      'Não há cliente registado ligado a este contacto Chatwoot — não é possível lançar pagamento.'
    );
    return;
  }

  if (`${user.role || ''}`.trim().toUpperCase() !== 'CLIENTE') {
    await chatwootClient.postPrivateNote(
      accountId,
      conversationId,
      'O utilizador associado não é CLIENTE — operação não permitida.'
    );
    return;
  }

  const result = await paymentsService.approveManualAttendancePayment(user, parsed.body || {});

  const valorFinal = fmtBrl(result.amount_brl ?? parsed.amountDisplay);
  await chatwootClient.postPrivateNote(
    accountId,
    conversationId,
    `✅ Pagamento de R$ ${valorFinal} lançado manualmente com sucesso!\n(order: ${result.payment_order_id}).`
  );
}

async function verTarologas({ accountId, conversationId }) {
  const specs = await Specialist.findAll({
    where: {
      status: { [Op.ne]: 'OFFLINE' },
    },
    attributes: ['id', 'display_name', 'status', 'user_id', 'is_blocked'],
    include: [{ model: User, as: 'user', attributes: ['email'], required: false }],
    order: [['display_name', 'ASC']],
    paranoid: true,
  });

  if (!specs.length) {
    await chatwootClient.postPrivateNote(
      accountId,
      conversationId,
      '_Nenhuma taróloga com status≠OFFLINE encontrada_.'
    );
    return;
  }

  const ids = specs.map((s) => s.id);
  const activeSessions = await Session.findAll({
    attributes: ['specialist_id', 'telecom_status', 'status', 'modality'],
    where: {
      specialist_id: { [Op.in]: ids },
      telecom_status: { [Op.in]: ['PENDING', 'ACTIVE', 'WARNING', 'ERROR'] },
    },
    order: [['updated_at', 'DESC']],
    paranoid: true,
  });

  /** @type {Record<string, import('sequelize').Model>} */
  const telecomBySpec = {};
  for (const row of activeSessions) {
    const sid = `${row.specialist_id}`;
    if (!telecomBySpec[sid]) telecomBySpec[sid] = row;
  }

  const lines = specs.map((s) => {
    const label =
      `${s.display_name || ''}`.trim() || `${s.user?.email || ''}`.trim() || s.id.slice(0, 8);
    const bloc = s.is_blocked ? ' [bloqueada]' : '';
    const telecomRow = telecomBySpec[s.id];
    const telecom = telecomRow
      ? `${telecomRow.telecom_status}${telecomRow.status ? ` — sessão \`${telecomRow.status}\` · ${telecomRow.modality}` : ''}`
      : '— sem sessão com telecom activa';
    return `- **${label}**${bloc} · estado: \`${s.status}\` · telecom sessão: ${telecom}`;
  });

  const texto = ['🔮 **Tarólogas (≠ OFFLINE)**', '', ...lines].join('\n');

  await chatwootClient.postPrivateNote(accountId, conversationId, texto);
}

/**
 * Comandos de atendente (mensagem iniciada por `/` no Chatwoot).
 * Falhas comunicam por nota privada na conversa quando possível.
 *
 * @param {string} messageContent
 * @param {string} accountId
 * @param {string} conversationId
 * @param {string} contactId
 */
async function handleCommand(messageContent, accountId, conversationId, contactId) {
  const raw = `${messageContent || ''}`.trim();
  if (!raw.startsWith('/')) {
    return { handled: false };
  }

  const parts = raw.split(/\s+/).filter(Boolean);
  const verb = `${parts[0] || ''}`.toLowerCase();
  const rest = parts.slice(1);

  try {
    switch (verb) {
      case '/gerar_link':
        await gerarLink({ accountId, conversationId, contactId, restArgs: rest });
        break;

      case '/buscar_cliente':
        await buscarCliente({ accountId, conversationId, contactId });
        break;

      case '/lancar_pagamento':
        await lancarPagamento({ accountId, conversationId, contactId, restArgs: rest });
        break;

      case '/ver_tarologas':
        await verTarologas({ accountId, conversationId });
        break;

      default:
        await chatwootClient.postPrivateNote(
          accountId,
          conversationId,
          `Comando desconhecido: \`${verb}\`.\nComandos: ${SLASH_HELP}.`
        );
    }
    return { handled: true };
  } catch (err) {
    console.error('[chatwoot:commands] handleCommand erro:', verb, err?.stack || err?.message || err);
    try {
      await noteError(accountId, conversationId, 'Erro ao executar comando', err);
    } catch (_) {
      // já logado acima
    }
    return { handled: true, error: true };
  }
}

module.exports = {
  handleCommand,
};
