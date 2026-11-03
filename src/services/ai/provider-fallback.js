// ============================================================================
// PROVIDER FALLBACK
// ============================================================================
// Optional fallback across configured providers. A request moves to the next
// provider only for auth, quota, timeout, or connection failures — never for
// a normal bad answer. Providers that are not ready() are skipped.
// Pure functions, no SDKs: the runtime passes in `run` and `isReady`.
// ============================================================================

const { classifyProviderError } = require('./provider-contract');
const { getAiProviderLabel } = require('../../config');

const FALLBACK_REASONS = new Set(['auth', 'quota', 'timeout', 'connection']);

// Gemini key rotation reports "all keys unavailable" once every key is
// exhausted or rejected; that is an auth/quota failure for the provider.
function classifyForFallback(error) {
  if (!error) {
    return null;
  }
  if (error.isAllKeysUnavailable === true || error.code === 'GEMINI_ALL_KEYS_UNAVAILABLE') {
    return 'quota';
  }
  const reason = classifyProviderError(error);
  return FALLBACK_REASONS.has(reason) ? reason : null;
}

function isFallbackEligible(error) {
  return classifyForFallback(error) !== null;
}

const REASON_PHRASES = {
  auth: 'rejected its credentials',
  quota: 'was rate-limited',
  timeout: 'timed out',
  connection: 'could not be reached'
};

function buildFallbackNotice(fromProvider, toProvider, reason) {
  const phrase = REASON_PHRASES[reason] || 'failed';
  const from = getAiProviderLabel(fromProvider);
  const to = getAiProviderLabel(toProvider);
  return `${from} ${phrase}, continuing with ${to}.`;
}

// order: [active, ...fallbacks]. run(providerName) performs the request.
async function runWithFallback({ order, isReady, run, onSwitch }) {
  const providers = (Array.isArray(order) ? order : []).filter(
    (name, index, list) => name && list.indexOf(name) === index
  );
  if (providers.length === 0) {
    throw new Error('No AI provider configured.');
  }

  let index = 0;
  for (;;) {
    const current = providers[index];
    try {
      return await run(current);
    } catch (error) {
      const reason = classifyForFallback(error);
      if (!reason) {
        throw error;
      }

      let nextIndex = index + 1;
      while (nextIndex < providers.length && !isReady(providers[nextIndex])) {
        nextIndex += 1;
      }
      if (nextIndex >= providers.length) {
        throw error;
      }

      const next = providers[nextIndex];
      if (typeof onSwitch === 'function') {
        try {
          onSwitch({ from: current, to: next, reason, error, notice: buildFallbackNotice(current, next, reason) });
        } catch (switchError) {
          console.error('Provider switch handler failed:', switchError);
        }
      }
      index = nextIndex;
    }
  }
}

module.exports = {
  classifyForFallback,
  isFallbackEligible,
  buildFallbackNotice,
  runWithFallback
};
