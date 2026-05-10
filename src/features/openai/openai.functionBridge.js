/** Execuções locais disparadas pelo Assistant (nome → objeto JSON já materializado). */
async function execByName(toolName /* , unused parsed JSON */) {
  if (toolName === 'trigger_crisis_intervention') {
    return {
      ok: true,
      status:
        'Sucesso no alerta (OpenAI bridge: sem post automático ao Chatwoot — use ACTIVE_AI_PROVIDER=anthropic neste webhook para disparo supervisores)',
      alert_dispatched_chatwoot: false,
      orientacao_para_sua_resposta_publica:
        'Finalize com mensagem breve acolhendo-o; mencione CVV **188**, gratuito **24 horas**.',
    };
  }
  if (toolName === 'check_balance') {
    // Placeholder até o serviço de carteira/ledger ficar disponível nos tools.
    return {
      currency: 'BRL',
      balance_decimal: '0.0000',
      simulated: true,
      message: 'Snapshot fictício até integração com ledger real.',
    };
  }
  throw new Error(`Ferramenta não implementada no bridge: ${toolName}`);
}

/**
 * Interpreta outputs OpenAI Runs `function.arguments` ou corpo já parseado.
 */
async function fulfillToolOutputs(toolCalls) {
  const results = [];
  for (const call of toolCalls) {
    const name = call.function.name;
    let args = {};
    if (call.function.arguments) {
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch (_) {
        args = {};
      }
    }
    // eslint-disable-next-line no-await-in-loop
    const payload = await execByName(name, args);
    results.push({
      tool_call_id: call.id,
      output: JSON.stringify(payload),
    });
  }
  return results;
}

module.exports = { fulfillToolOutputs, execByName };
