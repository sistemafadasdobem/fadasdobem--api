const { User, Specialist } = require('../../models');
const { responderSucesso } = require('../../utils/response.util');
const { catchAsyncRoute } = require('../../utils/catchAsync.util');
const { API_VERSION_SEMVER } = require('../../config/version');
const { normalizeEmail } = require('../auth/auth.constants');

const DEFAULT_CLIENT_EMAIL = 'homolog@fadasdobem.test';
const DEFAULT_SPECIALIST_USER_EMAIL = 'tarologa.homolog@fadasdobem.test';

/** Alinhado a `sessions.service.js` — só para o cliente decidir UX (WideVoice vs Agora legacy). */
function resolveSessionVideoTelecomDriverPublic() {
  const raw = `${process.env.SESSION_VIDEO_TELECOM_DRIVER || 'WIDE_VOICE_VIDEO'}`.trim().toUpperCase();
  if (raw === 'AGORA_RTC' || raw === 'AGORA_IO' || raw === 'AGORA') return 'AGORA_RTC';
  return 'WIDE_VOICE_VIDEO';
}

/**
 * GET /api/v1/config/public
 * Sem segredos. Agora App ID é público no cliente; specialist_id vem da BD após `seed:homolog`.
 */
const getPublic = catchAsyncRoute(async (req, res) => {
  const agoraAppId = `${process.env.AGORA_APP_ID || ''}`.trim();
  const homologLoginEmail = `${process.env.SEED_HOMOLOG_EMAIL || DEFAULT_CLIENT_EMAIL}`.trim();
  const homologEmailNorm = normalizeEmail(homologLoginEmail);

  const homologClientRow = await User.findOne({
    where: { email: homologEmailNorm },
    attributes: ['id', 'password_hash'],
  });
  const homolog_login_ready = Boolean(homologClientRow && homologClientRow.password_hash);

  let homologSpecialistId = null;
  const specialistUserEmail = `${process.env.SEED_HOMOLOG_SPECIALIST_EMAIL || DEFAULT_SPECIALIST_USER_EMAIL}`.trim();
  const specialistEmailNorm = normalizeEmail(specialistUserEmail);
  const specUser = await User.findOne({
    where: { email: specialistEmailNorm },
    attributes: ['id', 'password_hash'],
  });
  const homolog_specialist_ready = Boolean(specUser && specUser.password_hash);
  if (specUser) {
    const row = await Specialist.findOne({
      where: { user_id: specUser.id },
      attributes: ['id'],
      paranoid: true,
    });
    homologSpecialistId = row ? row.id : null;
  }

  return responderSucesso(
    res,
    {
      agora_app_id: agoraAppId,
      session_video_telecom_driver: resolveSessionVideoTelecomDriverPublic(),
      api_version: API_VERSION_SEMVER,
      api_base_path: '/api/v1',
      homolog_login_email: homologLoginEmail,
      homolog_login_ready,
      homolog_specialist_email: specialistUserEmail,
      homolog_specialist_ready,
      homolog_specialist_id: homologSpecialistId,
    },
    'Configuração pública.',
    200
  );
});

module.exports = { getPublic };
