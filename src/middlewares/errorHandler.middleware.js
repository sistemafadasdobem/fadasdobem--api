const { ValidationError, UniqueConstraintError, DatabaseError } = require('sequelize');
const axios = require('axios');
const { APIError, APIConnectionError, APIConnectionTimeoutError } = require('openai');
const AppError = require('../utils/AppError');
const { responderErro } = require('../utils/response.util');

function classifySequelize(err) {
  if (err instanceof ValidationError) {
    const errosDetalhes = err.errors?.map((e) => ({
      campo: e.path,
      validacao: e.validatorKey,
      valor: e.value,
      mensagem: e.message,
    }));
    return {
      statusCode: 400,
      mensagem: 'Dados inválidos conforme validação.',
      dados: { erros: errosDetalhes || [] },
    };
  }
  if (err instanceof UniqueConstraintError) {
    return {
      statusCode: 409,
      mensagem: 'Conflito: registro duplicado não permitido.',
      dados: { campos: err.fields || null },
    };
  }
  if (err instanceof DatabaseError) {
    return {
      statusCode: 503,
      mensagem: 'Falha temporária ao acessar o banco de dados. Tente novamente em instantes.',
      dados: null,
    };
  }
  if (err.name === 'SequelizeTimeoutError' || err.parent?.timeout) {
    return {
      statusCode: 504,
      mensagem: 'Tempo máximo ao consultar o banco foi excedido.',
      dados: null,
    };
  }
  const parentName = err.parent?.constructor?.name;
  if ((parentName && parentName.endsWith('Error')) || err.sql) {
    return {
      statusCode: 503,
      mensagem: 'Erro na persistência ao processar dados.',
      dados: null,
    };
  }
  return null;
}

function sanitizeEnvPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  try {
    return JSON.stringify(payload).slice(0, 400);
  } catch (_) {
    return null;
  }
}

function classifyAxios(err) {
  if (!axios.isAxiosError(err)) return null;
  const upstreamStatus = typeof err.response?.status === 'number' ? err.response.status : undefined;
  const payloadDev =
    process.env.NODE_ENV === 'production'
      ? null
      : typeof err.response?.data === 'string'
        ? err.response.data.slice(0, 480)
        : err.response?.data && typeof err.response.data === 'object'
          ? err.response.data
          : null;

  if (upstreamStatus === 429) {
    return {
      statusCode: 429,
      mensagem: 'Limite da API externa atingido. Aguarde e tente novamente.',
      dados: null,
    };
  }
  if (!upstreamStatus && (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT')) {
    return { statusCode: 504, mensagem: 'Timeout ao contatar serviço externo.', dados: null };
  }
  if (!upstreamStatus && (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED')) {
    return {
      statusCode: 503,
      mensagem: 'Serviço externo indisponível ou não alcançável.',
      dados: null,
    };
  }
  if (upstreamStatus && upstreamStatus < 500) {
    return {
      statusCode: 503,
      mensagem: 'A integração com o sistema externo rejeitou a requisição. Revise payloads ou credenciais.',
      dados: payloadDev,
    };
  }
  return {
    statusCode: upstreamStatus && upstreamStatus >= 502 ? upstreamStatus : 502,
    mensagem: 'Falha inesperada ao consultar sistema externo.',
    dados: payloadDev,
  };
}

function classifyOpenAI(err) {
  if (err instanceof APIConnectionTimeoutError) {
    return { statusCode: 504, mensagem: 'Timeout ao conectar com a OpenAI.', dados: null };
  }
  if (err instanceof APIConnectionError) {
    return {
      statusCode: 503,
      mensagem: 'Falha de rede ao contactar OpenAI.',
      dados: sanitizeEnvPayload(err?.cause ?? null),
    };
  }
  if (!(err instanceof APIError)) return null;

  const raw = typeof err.status === 'number' ? err.status : 502;
  let statusCode = 502;
  if (raw >= 400 && raw < 500) {
    if (raw === 401) statusCode = 401;
    else if (raw === 404) statusCode = 404;
    else if (raw === 409) statusCode = 409;
    else if (raw === 429) statusCode = 429;
    else statusCode = 422;
  } else if (raw >= 500 && raw <= 599) {
    statusCode = 503;
  }

  let mensagem = 'Falha ao usar o recurso Assistants/OpenAI.';
  if (statusCode === 401) mensagem = 'Credenciais OpenAI inválidas.';
  else if (statusCode === 404) mensagem = 'Recurso solicitado não existe mais na OpenAI.';
  else if (statusCode === 429) mensagem = 'OpenAI solicitou espera por limite de taxa (rate limit).';

  const dadosDev =
    process.env.NODE_ENV !== 'production' ? { codigoErroOpenAI: err.code, tipo: err.type } : null;

  return { statusCode, mensagem, dados: dadosDev };
}

module.exports = function errorHandlerMiddleware(err, req, res, next) {
  if (res.headersSent) return next(err);

  const quietOperational4xx =
    err instanceof AppError &&
    err.isOperational &&
    typeof err.statusCode === 'number' &&
    err.statusCode >= 400 &&
    err.statusCode < 500;
  if (!quietOperational4xx) {
    console.error('[erro-central]', req.method, req.originalUrl, err);
  }

  if (err instanceof AppError) {
    const status = typeof err.statusCode === 'number' ? err.statusCode : 500;
    return responderErro(res, status, String(err.message), err.dados);
  }

  if (err instanceof SyntaxError && typeof err.status === 'number' && err.status === 400 && 'body' in err) {
    return responderErro(res, 400, 'JSON inválido no corpo da requisição.');
  }

  const sequelizeHit = classifySequelize(err);
  if (sequelizeHit) {
    return responderErro(res, sequelizeHit.statusCode, sequelizeHit.mensagem, sequelizeHit.dados);
  }

  const ax = classifyAxios(err);
  if (ax) return responderErro(res, ax.statusCode, ax.mensagem, ax.dados);

  const openAiHit = classifyOpenAI(err);
  if (openAiHit) return responderErro(res, openAiHit.statusCode, openAiHit.mensagem, openAiHit.dados);

  return responderErro(res, 500, 'Erro interno inesperado. Consulte logs do servidor.', null);
};
