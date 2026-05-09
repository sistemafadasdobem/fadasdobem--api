const { User, Specialist } = require('../../models');
const { responderSucesso } = require('../../utils/response.util');
const { catchAsyncRoute } = require('../../utils/catchAsync.util');
const { API_VERSION_SEMVER } = require('../../config/version');

const DEFAULT_CLIENT_EMAIL = 'homolog@fadasdobem.test';
const DEFAULT_SPECIALIST_USER_EMAIL = 'tarologa.homolog@fadasdobem.test';

/**
 * GET /api/v1/config/public
 * Sem segredos. Agora App ID é público no cliente; specialist_id vem da BD após `seed:homolog`.
 */
const getPublic = catchAsyncRoute(async (req, res) => {
  const agoraAppId = `${process.env.AGORA_APP_ID || ''}`.trim();
  const homologLoginEmail = `${process.env.SEED_HOMOLOG_EMAIL || DEFAULT_CLIENT_EMAIL}`.trim();

  let homologSpecialistId = null;
  const specialistUserEmail = `${process.env.SEED_HOMOLOG_SPECIALIST_EMAIL || DEFAULT_SPECIALIST_USER_EMAIL}`.trim();
  const specUser = await User.findOne({
    where: { email: specialistUserEmail },
    attributes: ['id'],
  });
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
      api_version: API_VERSION_SEMVER,
      api_base_path: '/api/v1',
      homolog_login_email: homologLoginEmail,
      homolog_specialist_id: homologSpecialistId,
    },
    'Configuração pública.',
    200
  );
});

module.exports = { getPublic };
