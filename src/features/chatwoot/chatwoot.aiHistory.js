/**
 * Construção de histórico em turnos { role, content } a partir de mensagens Chatwoot.
 * Usado pelo webhook (Strategy IA) e desacoplado dos provedores Anthropic/OpenAI.
 */

function stripHtml(raw) {
  if (raw == null) return '';
  return String(raw)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeWhitespace(s) {
  return stripHtml(s).replace(/\s+/g, ' ').trim().toLowerCase();
}

function mergeAdjacentSameRole(items) {
  const out = [];
  for (const item of items) {
    const prev = out[out.length - 1];
    if (prev && prev.role === item.role) {
      prev.content = `${prev.content}\n\n${item.content}`.trim();
    } else {
      out.push({ role: item.role, content: item.content });
    }
  }
  return out;
}

function mapChatwootRowToAiTurn(m) {
  if (!m || m.private) return null;
  if (Number(m.message_type) === 2) return null;
  const body = stripHtml(m.content || m.processed_message_content || '');
  if (!body.trim()) return null;
  if (Number(m.message_type) === 0) {
    return { role: 'user', content: body.trim() };
  }
  if (Number(m.message_type) === 1) {
    return { role: 'assistant', content: body.trim() };
  }
  return null;
}

function ensureOpensWithUser(turns) {
  const cloned = [...turns];
  while (cloned.length && cloned[0].role === 'assistant') {
    cloned.shift();
  }
  if (!cloned.length) {
    cloned.push({
      role: 'user',
      content:
        '[Sistema] Início da conversa — contextualize com acolhimento até o próximo texto do visitante.',
    });
  }
  return cloned;
}

/**
 * Converte linhas Chatwoot (cronológicas) + última mensagem inbound do webhook em turnos user/assistant.
 */
function buildTurnsFromChatwootRows(rows, latestInboundPlaintext) {
  const mapped = [];
  for (const row of rows) {
    const turn = mapChatwootRowToAiTurn(row);
    if (turn && (turn.role === 'user' || turn.role === 'assistant')) mapped.push(turn);
  }
  let merged = mergeAdjacentSameRole(mapped);
  merged = ensureOpensWithUser(merged);

  const target = normalizeWhitespace(latestInboundPlaintext);
  const lastUser = [...merged].reverse().find((m) => m.role === 'user');
  if (!lastUser || normalizeWhitespace(lastUser.content) !== target) {
    merged.push({ role: 'user', content: `${latestInboundPlaintext}`.trim() });
    merged = mergeAdjacentSameRole(merged);
  }

  return ensureOpensWithUser(merged);
}

/**
 * Separa o último turno do utilizador (mensagem corrente) do contexto anterior — contrato do `generateReply`.
 */
function splitHistoryForGenerateReply(turns) {
  const t = Array.isArray(turns) ? turns : [];
  if (!t.length) return { history: [], latest: '' };
  const last = t[t.length - 1];
  if (last.role !== 'user') {
    return { history: t, latest: '' };
  }
  return { history: t.slice(0, -1), latest: last.content };
}

module.exports = {
  stripHtml,
  buildTurnsFromChatwootRows,
  splitHistoryForGenerateReply,
  mergeAdjacentSameRole,
  ensureOpensWithUser,
};
