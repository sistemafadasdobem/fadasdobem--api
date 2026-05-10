const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Op, UniqueConstraintError } = require('sequelize');
const {
  sequelize,
  User,
  Client,
  Lead,
  OTP,
  RefreshToken,
  UserDevice,
  Session,
} = require('../../models');
const {
  assertJwtSecretsLoaded,
  jwtSignOptionsAccess,
  jwtSignOptionsRefresh,
  jwtVerifyOptions,
} = require('../../config/auth.config');
const AppError = require('../../utils/AppError');
const mailService = require('../../providers/mail/mail.service');
const {
  AUTH_CONFIG,
  AUTH_MESSAGES,
  normalizeEmail,
  isValidEmailFormat,
  assertEmailFormat,
  assertPasswordPolicy,
} = require('./auth.constants');
const { isDisposableEmailAddress } = require('../../config/disposableEmails.config');
const { recordAuthSecurityAudit } = require('./auth.audit.util');
const { generateIdentityChallenge } = require('./identity.util');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function tokenExpiresInSecondsFromJwt(token) {
  const decoded = jwt.decode(token);
  if (!decoded || !decoded.exp) return null;
  const now = Math.floor(Date.now() / 1000);
  return Math.max(0, decoded.exp - now);
}

function sanitizeUserRecord(userInstance) {
  if (!userInstance) return null;
  const plain = userInstance.get({ plain: true });
  delete plain.password_hash;
  return plain;
}

async function issueTokenPairForUser(userRecord, opts = {}) {
  assertJwtSecretsLoaded();
  const subject = userRecord.id;
  const accessExtra =
    opts &&
    opts.accessTokenClaims &&
    typeof opts.accessTokenClaims === 'object' &&
    !Array.isArray(opts.accessTokenClaims)
      ? opts.accessTokenClaims
      : {};
  const accessToken = jwt.sign(
    { sub: subject, token_use: 'access', ...accessExtra },
    process.env.JWT_SECRET,
    jwtSignOptionsAccess()
  );
  const jti = crypto.randomUUID();
  const refreshToken = jwt.sign(
    { sub: subject, token_use: 'refresh', jti },
    process.env.JWT_REFRESH_SECRET,
    jwtSignOptionsRefresh()
  );
  const decodedRefresh = jwt.decode(refreshToken);
  const expiresAt = new Date(decodedRefresh.exp * 1000);

  await RefreshToken.create({
    user_id: subject,
    jti,
    expires_at: expiresAt,
  });

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    access_expires_in: tokenExpiresInSecondsFromJwt(accessToken),
    refresh_expires_in: tokenExpiresInSecondsFromJwt(refreshToken),
  };
}

async function revokeRefreshByJti(jti) {
  const [affected] = await RefreshToken.update(
    { revoked_at: new Date() },
    {
      where: {
        jti,
        revoked_at: null,
      },
    }
  );
  return affected;
}

async function revokeAllRefreshTokensForUser(userId) {
  await RefreshToken.update(
    { revoked_at: new Date() },
    {
      where: {
        user_id: userId,
        revoked_at: null,
      },
    }
  );
}

/** R8.1 — registo/leitura de sessão WEB por IP/User-Agent */
async function recordWebLoginDevice(userId, ip, userAgent) {
  const ua = `${userAgent || ''}`.trim();
  const ipStr = `${ip || ''}`.slice(0, 45);
  const hash = crypto
    .createHash('sha256')
    .update(`${userId}|${ipStr}|${ua}`)
    .digest('hex')
    .slice(0, 48);
  const token = `${AUTH_CONFIG.webDeviceTokenPrefix}${hash}`;

  const [device] = await UserDevice.findOrCreate({
    where: { user_id: userId, push_token: token },
    defaults: {
      user_id: userId,
      push_token: token,
      platform: 'WEB',
      device_name: ua ? ua.slice(0, 128) : 'Web',
      last_seen_at: new Date(),
      is_active: true,
    },
  });

  await device.update({
    last_seen_at: new Date(),
    ...(ua ? { device_name: ua.slice(0, 128) } : {}),
  });
}

/** R7 — token OTP com id explícito (evita varreduras na BD). */
async function enqueueEmailVerification(userId, mail, reqMeta = {}) {
  await OTP.update(
    { consumed_at: new Date() },
    {
      where: {
        user_id: userId,
        purpose: AUTH_CONFIG.otpPurposeEmailVerify,
        consumed_at: null,
      },
    }
  );

  const secret = crypto.randomBytes(32).toString('base64url');
  const row = await OTP.create({
    user_id: userId,
    purpose: AUTH_CONFIG.otpPurposeEmailVerify,
    code: await bcrypt.hash(secret, AUTH_CONFIG.bcryptCostPassword),
    expires_at: new Date(Date.now() + AUTH_CONFIG.emailVerifyTtlHours * 3600 * 1000),
    attempts_count: 0,
    max_attempts: 5,
    delivery_channel: AUTH_CONFIG.otpDeliveryChannelEmail,
    ip_address_created: reqMeta.ip || null,
    user_agent_created: reqMeta.userAgent || null,
  });

  const payload = JSON.stringify({ otpId: row.id, s: secret });
  const encoded = Buffer.from(payload, 'utf8').toString('base64url');
  const query = `token=${encodeURIComponent(encoded)}`;
  const basePublic = `${process.env.API_PUBLIC_URL || ''}`.trim().replace(/\/+$/, '');
  const url = basePublic
    ? `${basePublic}/api/v1/auth/verify-email?${query}`
    : `http://localhost:${process.env.PORT || 3000}/api/v1/auth/verify-email?${query}`;
  void mailService.sendVerificationEmail(mail, url);
}

/** Marca contas há mais de 7 dias sem e-mail confirmado (R7). */
async function syncEmailPendingReviewFlags() {
  const cutoff = new Date(Date.now() - SEVEN_DAYS_MS);
  const [affected] = await User.update(
    { email_pending_review: true },
    {
      where: {
        email_verified_at: null,
        email_pending_review: false,
        created_at: { [Op.lt]: cutoff },
      },
    }
  );
  return affected;
}

async function verifyEmailFromToken(tokenRaw, reqMeta = {}) {
  let parsed;
  try {
    const decoded = Buffer.from(`${tokenRaw || ''}`, 'base64url').toString('utf8');
    parsed = JSON.parse(decoded);
  } catch {
    throw new AppError(AUTH_MESSAGES.VERIFY_EMAIL_BAD_TOKEN, 400, null, true);
  }

  const row = await OTP.findOne({
    where: {
      id: parsed.otpId,
      purpose: AUTH_CONFIG.otpPurposeEmailVerify,
      consumed_at: null,
      expires_at: { [Op.gt]: new Date() },
    },
  });

  if (!row || !parsed.s) {
    throw new AppError(AUTH_MESSAGES.VERIFY_EMAIL_BAD_TOKEN, 400, null, true);
  }

  const ok = await bcrypt.compare(`${parsed.s}`, row.code);
  if (!ok) {
    throw new AppError(AUTH_MESSAGES.VERIFY_EMAIL_BAD_TOKEN, 400, null, true);
  }

  await sequelize.transaction(async (t) => {
    await row.update({ consumed_at: new Date() }, { transaction: t });
    await User.update(
      { email_verified_at: new Date(), email_pending_review: false },
      { where: { id: row.user_id }, transaction: t }
    );
  });

  await recordAuthSecurityAudit({
    action: 'AUTH_EMAIL_VERIFIED',
    userId: row.user_id,
    ip: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    metadata: { otp_id: row.id },
  });

  return { verificado: true, mensagem: AUTH_MESSAGES.VERIFY_EMAIL_SUCCESS };
}

async function resendVerificationEmail(accessUser, reqMeta = {}) {
  if (accessUser.email_verified_at) {
    return { enviado: false, motivo: 'already_verified' };
  }
  const mail = normalizeEmail(accessUser.email);
  await enqueueEmailVerification(accessUser.id, mail, reqMeta);
  return { enviado: true };
}

/** POST /register */
async function register({ email, password, accepted_terms_version }, reqMeta = {}) {
  assertEmailFormat(email);
  const mail = normalizeEmail(email);

  if (isDisposableEmailAddress(mail)) {
    throw new AppError(AUTH_MESSAGES.EMAIL_DISPOSABLE, 400, null, true);
  }

  assertPasswordPolicy(password);

  if (accepted_terms_version === undefined || accepted_terms_version === null) {
    throw new AppError(AUTH_MESSAGES.TERMS_ACCEPTANCE_REQUIRED, 400, null, true);
  }
  const terms = `${accepted_terms_version}`.trim();
  if (!terms) {
    throw new AppError(AUTH_MESSAGES.TERMS_ACCEPTANCE_REQUIRED, 400, null, true);
  }

  const exists = await User.findOne({ where: { email: mail } });
  if (exists) {
    throw new AppError(AUTH_MESSAGES.EMAIL_ALREADY_REGISTERED, 409, null, true);
  }

  const password_hash = await bcrypt.hash(password, AUTH_CONFIG.bcryptCostPassword);

  let user;
  try {
    await sequelize.transaction(async (t) => {
      user = await User.create(
        {
          email: mail,
          password_hash,
          role: AUTH_CONFIG.roleClienteNoRegistro,
          email_verified_at: null,
          email_pending_review: false,
          accepted_terms_version: terms,
          accepted_terms_at: new Date(),
          onboarding_step: AUTH_CONFIG.onboardingStepAfterRegister,
          is_active: true,
        },
        { transaction: t }
      );

      await Client.create(
        {
          user_id: user.id,
        },
        { transaction: t }
      );
    });
  } catch (err) {
    if (err instanceof UniqueConstraintError || err.name === 'SequelizeUniqueConstraintError') {
      throw new AppError(AUTH_MESSAGES.EMAIL_ALREADY_REGISTERED, 409, null, true);
    }
    throw err;
  }

  user = await User.findByPk(user.id, {
    include: [{ model: Client, as: 'client_profile', required: false }],
  });

  await recordAuthSecurityAudit({
    action: 'AUTH_REGISTER_SUCCESS',
    userId: user.id,
    ip: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    metadata: { terms_version: terms },
  });

  void mailService.sendWelcomeEmail(mail);
  void enqueueEmailVerification(user.id, mail, reqMeta);

  const tokens = await issueTokenPairForUser(user);
  return {
    ...tokens,
    usuario: sanitizeUserRecord(user),
  };
}

/** POST /login */
async function login({ email, password }, reqMeta = {}) {
  assertEmailFormat(email);
  const mail = normalizeEmail(email);
  const user = await User.findOne({
    where: { email: mail },
    include: [{ model: Client, as: 'client_profile', required: false }],
  });

  if (!user || !user.password_hash) {
    await recordAuthSecurityAudit({
      action: 'AUTH_LOGIN_FAILURE',
      userId: null,
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
      metadata: { reason: 'unknown_user_or_no_password' },
    });
    throw new AppError(AUTH_MESSAGES.LOGIN_CREDENTIALS_GENERIC, 401, null, true);
  }
  if (!user.is_active || user.blocked_at) {
    await recordAuthSecurityAudit({
      action: 'AUTH_LOGIN_FAILURE',
      userId: user.id,
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
      metadata: { reason: 'inactive_or_blocked' },
    });
    throw new AppError(AUTH_MESSAGES.ACCOUNT_UNAVAILABLE_LOGIN, 403, null, true);
  }

  const ok = await bcrypt.compare(`${password ?? ''}`, user.password_hash);
  if (!ok) {
    await recordAuthSecurityAudit({
      action: 'AUTH_LOGIN_FAILURE',
      userId: user.id,
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
      metadata: { reason: 'bad_password' },
    });
    throw new AppError(AUTH_MESSAGES.LOGIN_CREDENTIALS_GENERIC, 401, null, true);
  }

  await user.update({ last_login_at: new Date() });
  await recordWebLoginDevice(user.id, reqMeta.ip, reqMeta.userAgent);
  await recordAuthSecurityAudit({
    action: 'AUTH_LOGIN_SUCCESS',
    userId: user.id,
    ip: reqMeta.ip,
    userAgent: reqMeta.userAgent,
  });

  const tokens = await issueTokenPairForUser(user);
  return {
    ...tokens,
    usuario: sanitizeUserRecord(user),
  };
}

/** POST /refresh-token */
async function refreshToken({ refresh_token }) {
  const raw = `${refresh_token ?? ''}`.trim();
  if (!raw) {
    throw new AppError(AUTH_MESSAGES.REFRESH_TOKEN_REQUIRED, 400, null, true);
  }

  assertJwtSecretsLoaded();
  let payload;
  try {
    payload = jwt.verify(raw, process.env.JWT_REFRESH_SECRET, jwtVerifyOptions());
  } catch (_) {
    throw new AppError(AUTH_MESSAGES.REFRESH_TOKEN_INVALID_OR_EXPIRED, 401, null, true);
  }

  if (payload.token_use !== 'refresh' || !payload.jti) {
    throw new AppError(AUTH_MESSAGES.REFRESH_TOKEN_MALFORMED, 401, null, true);
  }

  const row = await RefreshToken.findOne({
    where: {
      jti: payload.jti,
      user_id: payload.sub,
      revoked_at: null,
      expires_at: { [Op.gt]: new Date() },
    },
  });

  if (!row) {
    throw new AppError(AUTH_MESSAGES.REFRESH_SESSION_INVALID, 401, null, true);
  }

  await row.update({ revoked_at: new Date() });

  const user = await User.findByPk(payload.sub, {
    include: [{ model: Client, as: 'client_profile', required: false }],
  });

  if (!user || !user.is_active || user.blocked_at) {
    throw new AppError(AUTH_MESSAGES.ACCOUNT_UNAVAILABLE_REFRESH, 403, null, true);
  }

  const tokens = await issueTokenPairForUser(user);
  return {
    ...tokens,
    usuario: sanitizeUserRecord(user),
  };
}

/** POST /logout — exige access válido + corpo com refresh. */
async function logout({ refresh_token }, accessUser) {
  const raw = `${refresh_token ?? ''}`.trim();
  if (!raw) {
    throw new AppError(AUTH_MESSAGES.LOGOUT_REFRESH_REQUIRED, 400, null, true);
  }

  assertJwtSecretsLoaded();
  let payload;
  try {
    payload = jwt.verify(raw, process.env.JWT_REFRESH_SECRET, jwtVerifyOptions());
  } catch (_) {
    throw new AppError(AUTH_MESSAGES.LOGOUT_REFRESH_INVALID, 401, null, true);
  }

  if (payload.token_use !== 'refresh' || `${payload.sub}` !== `${accessUser.id}`) {
    throw new AppError(AUTH_MESSAGES.LOGOUT_REFRESH_WRONG_SUBJECT, 403, null, true);
  }

  await revokeRefreshByJti(payload.jti);
  return { encerrado: true };
}

function buildNumericOtpCode() {
  const n = AUTH_CONFIG.otpDigits;
  const max = 10 ** n;
  return crypto.randomInt(0, max).toString().padStart(n, '0');
}

/** POST /forgot-password — resposta sempre genérica. */
async function forgotPassword({ email }, reqMeta = {}) {
  const mail = normalizeEmail(email);
  if (!mail || !isValidEmailFormat(mail)) {
    return {
      enviado: true,
      mensagem_simulada: AUTH_MESSAGES.FORGOT_PASSWORD_GENERIC_SHORT,
    };
  }

  const user = await User.findOne({ where: { email: mail } });
  if (user && user.is_active && !user.blocked_at) {
    await OTP.update(
      { consumed_at: new Date() },
      {
        where: {
          user_id: user.id,
          purpose: AUTH_CONFIG.otpPurposeResetPassword,
          consumed_at: null,
        },
      }
    );

    const plainOtp = buildNumericOtpCode();
    const codeHash = await bcrypt.hash(plainOtp, AUTH_CONFIG.bcryptCostPassword);
    const expiresAt = new Date(Date.now() + AUTH_CONFIG.otpTtlMinutes * 60 * 1000);

    await OTP.create({
      user_id: user.id,
      purpose: AUTH_CONFIG.otpPurposeResetPassword,
      code: codeHash,
      expires_at: expiresAt,
      attempts_count: 0,
      max_attempts: AUTH_CONFIG.maxOtpAttempts,
      delivery_channel: AUTH_CONFIG.otpDeliveryChannelEmail,
      ip_address_created: reqMeta.ip || null,
      user_agent_created: reqMeta.userAgent || null,
    });

    void mailService.sendOtpEmail(mail, plainOtp);

    await recordAuthSecurityAudit({
      action: 'AUTH_FORGOT_PASSWORD_SEND',
      userId: user.id,
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });
  }

  return {
    enviado: true,
    mensagem_simulada: AUTH_MESSAGES.FORGOT_PASSWORD_GENERIC_LONG,
  };
}

/** POST /reset-password */
async function resetPassword({ email, otp, new_password }, reqMeta = {}) {
  assertEmailFormat(email);
  const mail = normalizeEmail(email);
  const plainOtp = `${otp ?? ''}`.trim();
  assertPasswordPolicy(new_password);

  if (!mail || !plainOtp) {
    throw new AppError(AUTH_MESSAGES.RESET_INSUFFICIENT_DATA, 400, null, true);
  }

  const user = await User.findOne({ where: { email: mail } });
  if (!user) {
    throw new AppError(AUTH_MESSAGES.RESET_CODE_INVALID_OR_EXPIRED, 400, null, true);
  }
  if (!user.is_active || user.blocked_at) {
    throw new AppError(AUTH_MESSAGES.RESET_CODE_INVALID_OR_EXPIRED, 400, null, true);
  }

  const otpRow = await OTP.findOne({
    where: {
      user_id: user.id,
      purpose: AUTH_CONFIG.otpPurposeResetPassword,
      consumed_at: null,
      expires_at: { [Op.gt]: new Date() },
    },
    order: [['created_at', 'DESC']],
  });

  if (!otpRow) {
    throw new AppError(AUTH_MESSAGES.RESET_CODE_INVALID_OR_EXPIRED, 400, null, true);
  }

  if (otpRow.attempts_count >= otpRow.max_attempts) {
    throw new AppError(AUTH_MESSAGES.RESET_OTP_MAX_ATTEMPTS, 429, null, true);
  }

  const match = await bcrypt.compare(plainOtp, otpRow.code);
  if (!match) {
    await otpRow.increment('attempts_count');
    await otpRow.reload();
    if (otpRow.attempts_count >= otpRow.max_attempts) {
      throw new AppError(AUTH_MESSAGES.RESET_OTP_MAX_ATTEMPTS, 429, null, true);
    }
    throw new AppError(AUTH_MESSAGES.RESET_CODE_INVALID_OR_EXPIRED, 400, null, true);
  }

  const password_hash = await bcrypt.hash(new_password, AUTH_CONFIG.bcryptCostPassword);
  await sequelize.transaction(async (t) => {
    await user.update({ password_hash }, { transaction: t });
    await otpRow.update({ consumed_at: new Date() }, { transaction: t });
  });

  await revokeAllRefreshTokensForUser(user.id);

  await recordAuthSecurityAudit({
    action: 'AUTH_PASSWORD_RESET_SUCCESS',
    userId: user.id,
    ip: reqMeta.ip,
    userAgent: reqMeta.userAgent,
  });

  return { redefinido: true };
}

/** GET /me */
async function getMe(userId) {
  const user = await User.findByPk(userId, {
    include: [{ model: Client, as: 'client_profile', required: false }],
  });
  if (!user) {
    throw new AppError(AUTH_MESSAGES.USER_NOT_FOUND, 404, null, true);
  }
  return { usuario: sanitizeUserRecord(user) };
}

/** PATCH /me */
async function patchMeProfile(userId, body) {
  const user = await User.findByPk(userId, {
    include: [{ model: Client, as: 'client_profile', required: false }],
  });
  if (!user) {
    throw new AppError(AUTH_MESSAGES.USER_NOT_FOUND, 404, null, true);
  }
  if (user.role !== AUTH_CONFIG.roleClienteNoRegistro || !user.client_profile) {
    throw new AppError(AUTH_MESSAGES.PROFILE_NOT_CLIENT_EDITABLE, 403, null, true);
  }

  const maxNome = AUTH_CONFIG.profileNomeMaxLength;
  const maxTratarPor = AUTH_CONFIG.profileTratarPorMaxLength;

  const allowed = {};
  if (typeof body.nome !== 'undefined') allowed.nome = body.nome == null ? null : `${body.nome}`.trim().slice(0, maxNome);
  if (typeof body.tratar_por !== 'undefined') {
    allowed.tratar_por = body.tratar_por == null ? null : `${body.tratar_por}`.trim().slice(0, maxTratarPor);
  }
  if (typeof body.data_nascimento !== 'undefined') {
    allowed.data_nascimento = body.data_nascimento == null || body.data_nascimento === '' ? null : body.data_nascimento;
  }

  if (Object.keys(allowed).length === 0) {
    throw new AppError(AUTH_MESSAGES.PROFILE_PATCH_NO_FIELDS, 400, null, true);
  }

  await user.client_profile.update(allowed);

  await user.reload({
    include: [{ model: Client, as: 'client_profile', required: false }],
  });

  return { usuario: sanitizeUserRecord(user) };
}

/**
 * Converte um lead Chatwoot em conta `User` + `Client` (transacção atómica).
 * O histórico de mensagens permanece no Chatwoot; o vínculo operacional é reposto em `users.chatwoot_*`.
 * Se existir `Session` com o mesmo `chatwoot_conversation_id` (cenários futuros), o `client_id` é actualizado.
 *
 * @param {string} leadId
 * @param {{
 *   email: string,
 *   password: string,
 *   accepted_terms_version: string,
 *   nome?: string|null,
 *   nome_completo?: string|null,
 *   data_nascimento?: string|null,
 *   phone?: string|null,
 * }} userData
 */
async function convertLeadToClient(leadId, userData, reqMeta = {}) {
  assertEmailFormat(userData.email);
  const mail = normalizeEmail(userData.email);

  if (isDisposableEmailAddress(mail)) {
    throw new AppError(AUTH_MESSAGES.EMAIL_DISPOSABLE, 400, null, true);
  }

  assertPasswordPolicy(userData.password);

  if (userData.accepted_terms_version === undefined || userData.accepted_terms_version === null) {
    throw new AppError(AUTH_MESSAGES.TERMS_ACCEPTANCE_REQUIRED, 400, null, true);
  }
  const terms = `${userData.accepted_terms_version}`.trim();
  if (!terms) {
    throw new AppError(AUTH_MESSAGES.TERMS_ACCEPTANCE_REQUIRED, 400, null, true);
  }

  const emailTaken = await User.findOne({ where: { email: mail } });
  if (emailTaken) {
    throw new AppError(AUTH_MESSAGES.EMAIL_ALREADY_REGISTERED, 409, null, true);
  }

  const password_hash = await bcrypt.hash(userData.password, AUTH_CONFIG.bcryptCostPassword);

  let user;
  let leadRef;

  try {
    await sequelize.transaction(async (t) => {
      const lead = await Lead.findByPk(leadId, { transaction: t });
      if (!lead) {
        throw new AppError(AUTH_MESSAGES.LEAD_NOT_FOUND, 404, null, true);
      }
      if (lead.status === 'CONVERTED') {
        throw new AppError(AUTH_MESSAGES.LEAD_ALREADY_CONVERTED, 409, null, true);
      }

      const existingUserForContact = await User.findOne({
        where: { chatwoot_contact_id: lead.chatwoot_contact_id },
        transaction: t,
      });
      if (existingUserForContact) {
        throw new AppError(AUTH_MESSAGES.CHATWOOT_CONTACT_USER_EXISTS, 409, null, true);
      }

      const pixNote =
        lead.pix_key_suggested && `${lead.pix_key_suggested}`.trim()
          ? `PIX (rascunho lead): ${`${lead.pix_key_suggested}`.trim()}`
          : null;

      user = await User.create(
        {
          email: mail,
          password_hash,
          role: AUTH_CONFIG.roleClienteNoRegistro,
          email_verified_at: null,
          email_pending_review: false,
          accepted_terms_version: terms,
          accepted_terms_at: new Date(),
          onboarding_step: AUTH_CONFIG.onboardingStepAfterRegister,
          is_active: true,
          phone: userData.phone != null && `${userData.phone}`.trim() ? `${userData.phone}`.trim() : lead.phone,
          chatwoot_contact_id: lead.chatwoot_contact_id,
          chatwoot_conversation_id: lead.chatwoot_conversation_id,
          openai_thread_id: lead.openai_thread_id || null,
        },
        { transaction: t }
      );

      const nomeFullCandidate = (() => {
        if (userData.nome_completo != null && `${userData.nome_completo}`.trim()) {
          return `${userData.nome_completo}`.trim().slice(0, AUTH_CONFIG.profileNomeMaxLength);
        }
        if (userData.nome != null && `${userData.nome}`.trim()) {
          return `${userData.nome}`.trim().slice(0, AUTH_CONFIG.profileNomeMaxLength);
        }
        return '';
      })();

      let dataNasc = null;
      if (userData.data_nascimento != null && `${userData.data_nascimento}`.trim() !== '') {
        dataNasc = `${userData.data_nascimento}`.trim();
      }

      const clientProfile = await Client.create(
        {
          user_id: user.id,
          nome_completo: nomeFullCandidate || null,
          nome: nomeFullCandidate || null,
          data_nascimento: dataNasc,
          internal_notes: pixNote,
        },
        { transaction: t }
      );

      await lead.update(
        {
          status: 'CONVERTED',
          last_interaction_at: new Date(),
        },
        { transaction: t }
      );

      leadRef = lead;

      const convId = `${lead.chatwoot_conversation_id ?? ''}`.trim();
      if (convId) {
        await Session.update(
          { client_id: clientProfile.id },
          {
            where: { chatwoot_conversation_id: convId },
            transaction: t,
          }
        );
      }

      // eslint-disable-next-line global-require, import/no-dynamic-require
      const paymentsService = require('../payments/payments.service');
      await paymentsService.reconcileLeadFsmPaymentsAfterConversion(lead.id, clientProfile.id, t);
    });
  } catch (err) {
    if (err instanceof UniqueConstraintError || err.name === 'SequelizeUniqueConstraintError') {
      throw new AppError(AUTH_MESSAGES.EMAIL_ALREADY_REGISTERED, 409, null, true);
    }
    throw err;
  }

  user = await User.findByPk(user.id, {
    include: [{ model: Client, as: 'client_profile', required: false }],
  });

  await recordAuthSecurityAudit({
    action: 'AUTH_LEAD_CONVERTED',
    userId: user.id,
    ip: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    metadata: {
      lead_id: leadRef?.id ?? null,
      chatwoot_contact_id: leadRef?.chatwoot_contact_id ?? null,
      conversation_id: leadRef?.chatwoot_conversation_id ?? null,
    },
  });

  void mailService.sendWelcomeEmail(mail);
  void enqueueEmailVerification(user.id, mail, reqMeta);

  const tokens = await issueTokenPairForUser(user);
  return {
    ...tokens,
    usuario: sanitizeUserRecord(user),
  };
}

module.exports = {
  register,
  login,
  refreshToken,
  logout,
  forgotPassword,
  resetPassword,
  getMe,
  patchMeProfile,
  verifyEmailFromToken,
  resendVerificationEmail,
  syncEmailPendingReviewFlags,
  convertLeadToClient,
  generateIdentityChallenge,
};
