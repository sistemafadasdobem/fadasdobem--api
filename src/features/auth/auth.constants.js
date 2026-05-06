const AppError = require('../../utils/AppError');

/**
 * Parâmetros de negócio e integração técnica do módulo Auth.
 * Alterações de texto de UX ficam em `AUTH_MESSAGES`.
 */
const AUTH_CONFIG = {
  minPasswordLength: 8,
  /** A partir deste comprimento (com demais critérios) favorece o nível "boa". */
  minPasswordLengthForTierBoost: 12,
  bcryptCostPassword: 12,

  maxEmailLength: 320,
  minEmailTldLength: 2,

  otpPurposeResetPassword: 'RESET_PASSWORD',
  otpPurposeEmailVerify: 'EMAIL_VERIFY',
  otpDigits: 6,
  otpTtlMinutes: 10,
  maxOtpAttempts: 5,
  emailVerifyTtlHours: 24,
  webDeviceTokenPrefix: 'web:',
  otpDeliveryChannelEmail: 'EMAIL',

  profileNomeMaxLength: 160,
  profileTratarPorMaxLength: 120,

  onboardingStepAfterRegister: 1,
  /** Papel inicial no registo público cliente. Alinhado ao ENUM do modelo `User`. */
  roleClienteNoRegistro: 'CLIENTE',
};

/** Mensagens exibidas em `AppError` e em respostas de domínio (copy única por chave). */
const AUTH_MESSAGES = {
  LOGIN_CREDENTIALS_GENERIC: 'Email ou senha incorretos.',

  EMAIL_REQUIRED: 'Informe um endereço de e-mail.',
  EMAIL_INVALID_FORMAT: 'O formato do e-mail é inválido.',

  EMAIL_DISPOSABLE:
    'Não aceitamos emails descartáveis — use seu email pessoal',

  TERMS_ACCEPTANCE_REQUIRED:
    'Aceite de termos (`accepted_terms_version`) é obrigatório.',

  EMAIL_ALREADY_REGISTERED: 'Este e-mail já está cadastrado.',

  ACCOUNT_UNAVAILABLE_LOGIN: 'Conta indisponível para login.',

  REFRESH_TOKEN_REQUIRED: 'Refresh token é obrigatório.',
  REFRESH_TOKEN_INVALID_OR_EXPIRED: 'Refresh token inválido ou expirado.',
  REFRESH_TOKEN_MALFORMED: 'Token de renovação malformado.',
  REFRESH_SESSION_INVALID: 'Sessão de refresh inválida ou revogada.',
  ACCOUNT_UNAVAILABLE_REFRESH: 'Conta indisponível para renovar sessão.',

  LOGOUT_REFRESH_REQUIRED:
    'Informe o refresh token no corpo para encerrar a sessão com segurança.',
  LOGOUT_REFRESH_INVALID: 'Refresh token inválido.',
  LOGOUT_REFRESH_WRONG_SUBJECT:
    'Refresh token não pertence à sessão atual.',

  FORGOT_PASSWORD_GENERIC_SHORT:
    'Se o e-mail existir em nossa base, você receberá instruções para redefinir a senha.',

  FORGOT_PASSWORD_GENERIC_LONG:
    'Se o e-mail existir em nossa base, você receberá instruções para redefinir a senha nos próximos minutos.',

  RESET_INSUFFICIENT_DATA: 'Dados insuficientes para redefinir a senha.',
  RESET_CODE_INVALID_OR_EXPIRED: 'Código inválido ou expirado.',
  RESET_OTP_MAX_ATTEMPTS: 'Número máximo de tentativas para este código foi excedido.',

  VERIFY_EMAIL_BAD_TOKEN: 'Link de confirmação inválido ou expirado.',
  VERIFY_EMAIL_SUCCESS: 'E-mail confirmado com sucesso.',

  USER_NOT_FOUND: 'Usuário não encontrado.',
  PROFILE_NOT_CLIENT_EDITABLE:
    'Esta conta não possui perfil de cliente editável por esta rota.',
  PROFILE_PATCH_NO_FIELDS:
    'Nenhum campo permitido enviado (nome, tratar_por, data_nascimento).',

  LEAD_NOT_FOUND: 'Lead não encontrado.',
  LEAD_ALREADY_CONVERTED: 'Este lead já foi convertido em cliente.',
  CHATWOOT_CONTACT_USER_EXISTS:
    'Já existe conta de utilizador associada a este contacto Chatwoot; utilize o login.',
};

function normalizeEmail(email) {
  return `${email || ''}`.trim().toLowerCase();
}

/**
 * Validador de formato (R3). Unicidade e fluxo debounced tratam-se no cliente + 409 no registo.
 */
function isValidEmailFormat(email, cfg = AUTH_CONFIG) {
  const s = `${email ?? ''}`.trim();
  if (!s || s.length > cfg.maxEmailLength) return false;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return false;
  const [local, domain] = s.split('@');
  if (!local || !domain || !domain.includes('.')) return false;
  const tld = domain.split('.').pop();
  return tld.length >= cfg.minEmailTldLength;
}

function assertEmailFormat(email) {
  const raw = `${email ?? ''}`.trim();
  if (!raw) {
    throw new AppError(AUTH_MESSAGES.EMAIL_REQUIRED, 400, null, true);
  }
  if (!isValidEmailFormat(raw)) {
    throw new AppError(AUTH_MESSAGES.EMAIL_INVALID_FORMAT, 400, null, true);
  }
}

/**
 * Força em 4 níveis (R4): fraca(1), regular(2), boa(3), forte(4).
 * Registo/redefinição exigem nível ≥ 3.
 */
function evaluatePasswordStrength(password, cfg = AUTH_CONFIG) {
  const pw = `${password ?? ''}`;
  const len = pw.length;
  const minLen = cfg.minPasswordLength;
  const tierBoostLen = cfg.minPasswordLengthForTierBoost;

  const hasLetter = /[A-Za-zÀ-ÿ]/.test(pw);
  const hasDigit = /\d/.test(pw);
  const hasLower = /[a-z]/.test(pw);
  const hasUpper = /[A-Z]/.test(pw);
  const hasSpecial = /[^A-Za-z0-9À-ÿ]/.test(pw);

  if (len < minLen || !hasLetter || !hasDigit) {
    return { level: 1, key: 'fraca', acceptsRegistration: false };
  }

  const mixedCase = hasLower && hasUpper;

  let level = 2;
  let key = 'regular';

  if (mixedCase || hasSpecial || len >= tierBoostLen) {
    level = 3;
    key = 'boa';
  }

  if (len >= tierBoostLen && mixedCase && hasDigit && hasSpecial) {
    level = 4;
    key = 'forte';
  }

  return {
    level,
    key,
    acceptsRegistration: level >= 3,
  };
}

/** Mensagem de violação da política de senha — alinhada a `AUTH_CONFIG.minPasswordLength` e `minPasswordLengthForTierBoost`. */
function passwordPolicyViolationMessage(cfg = AUTH_CONFIG) {
  return (
    `A senha deve ter no mínimo ${cfg.minPasswordLength} caracteres, incluir letras e números, ` +
    `e atingir pelo menos o nível "boa" ou "forte" (combine maiúsculas e minúsculas, símbolos ou use ` +
    `${cfg.minPasswordLengthForTierBoost} ou mais caracteres conforme as regras de complexidade).`
  );
}

function assertPasswordPolicy(plainPassword) {
  const r = evaluatePasswordStrength(plainPassword);
  if (!r.acceptsRegistration) {
    throw new AppError(passwordPolicyViolationMessage(), 400, { forca_nivel: r.level, forca_chave: r.key }, true);
  }
}

module.exports = {
  AUTH_CONFIG,
  AUTH_MESSAGES,
  normalizeEmail,
  isValidEmailFormat,
  assertEmailFormat,
  evaluatePasswordStrength,
  assertPasswordPolicy,
  passwordPolicyViolationMessage,
};
