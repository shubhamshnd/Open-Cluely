// ============================================================================
// SHARED AI PROVIDER CONTRACT
// ============================================================================
// Every AI provider service (Gemini, OpenAI, Anthropic, Bedrock, Ollama)
// implements the same surface so the runtime can swap providers transparently:
//
// Configuration / state:
//   updateConfiguration(options)  -> { apiKeyChanged, modelChanged, programmingLanguageChanged }
//   ready()                       -> boolean: provider has everything it needs to run
//   supportsImages                -> boolean property: active model accepts image input
//
// Conversation history:
//   addToHistory(role, content)
//   clearHistory()
//   getContextString()
//
// Actions (all accept an optional { onChunk({ text, index }) } streaming callback):
//   askAiWithSessionContext(options)
//   askAiWithSessionContextAndScreenshots(imageParts, options)
//   analyzeScreenshots(imageParts, additionalContext, options)
//   suggestResponse(context, options)
//   generateMeetingNotes(options)
//   generateFollowUpEmail(options)
//   getConversationInsights(options)
//   answerQuestion(question, options)
//
// Error classification:
//   isAuthenticationError(error)  -> boolean
//
// Image parts always arrive in the Gemini shape the screenshot manager builds:
//   { inlineData: { mimeType: 'image/png', data: '<base64>' } }
// Each provider maps those parts to its own SDK format internally via
// splitImageParts(); callers never build provider-specific payloads.
// ============================================================================

const PROVIDER_METHODS = [
  'updateConfiguration',
  'ready',
  'addToHistory',
  'clearHistory',
  'getContextString',
  'askAiWithSessionContext',
  'askAiWithSessionContextAndScreenshots',
  'analyzeScreenshots',
  'suggestResponse',
  'generateMeetingNotes',
  'generateFollowUpEmail',
  'getConversationInsights',
  'answerQuestion',
  'isAuthenticationError'
];

// Verify an object satisfies the provider contract. Throws on the first
// missing member so tests fail loudly instead of drifting out of sync.
function assertProvider(instance, label = 'provider') {
  if (!instance || typeof instance !== 'object') {
    throw new Error(`${label}: expected an object, got ${instance === null ? 'null' : typeof instance}`);
  }

  for (const methodName of PROVIDER_METHODS) {
    if (typeof instance[methodName] !== 'function') {
      throw new Error(`${label}: missing required method "${methodName}"`);
    }
  }

  if (typeof instance.supportsImages !== 'boolean') {
    throw new Error(`${label}: missing required boolean property "supportsImages"`);
  }

  return true;
}

// ---------------------------------------------------------------------------
// Cross-provider error classification.
// Returns one of 'auth' | 'quota' | 'timeout' | 'connection' | null.
// Used by the provider fallback logic: only these four classes justify
// switching to another provider mid-session.
// ---------------------------------------------------------------------------
const AUTH_ERROR_NAMES = new Set([
  'UnrecognizedClientException',
  'InvalidSignatureException',
  'AccessDeniedException',
  'AuthenticationError',
  'PermissionDeniedError'
]);

const QUOTA_ERROR_NAMES = new Set([
  'ThrottlingException',
  'TooManyRequestsException',
  'ServiceQuotaExceededException',
  'RateLimitError'
]);

const TIMEOUT_ERROR_NAMES = new Set([
  'ModelTimeoutException',
  'RequestTimeoutException',
  'APIConnectionTimeoutError',
  'TimeoutError'
]);

const CONNECTION_ERROR_NAMES = new Set([
  'APIConnectionError',
  'NetworkingError'
]);

const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT'
]);

function classifyProviderError(error) {
  if (!error) {
    return null;
  }

  const status = Number(
    error.status ??
    error.statusCode ??
    error.$metadata?.httpStatusCode ??
    error.response?.status
  );
  const name = String(error.name || '');
  const code = String(error.code || '');
  const message = String(error.message || '').toLowerCase();

  if (
    status === 401 ||
    status === 403 ||
    AUTH_ERROR_NAMES.has(name) ||
    message.includes('invalid api key') ||
    message.includes('api key not valid') ||
    message.includes('api_key_invalid') ||
    message.includes('incorrect api key') ||
    message.includes('unauthorized') ||
    message.includes('permission denied') ||
    message.includes('authentication_error')
  ) {
    return 'auth';
  }

  if (
    status === 429 ||
    QUOTA_ERROR_NAMES.has(name) ||
    message.includes('rate limit') ||
    message.includes('rate_limit') ||
    message.includes('quota') ||
    message.includes('throttl') ||
    message.includes('daily request limit')
  ) {
    return 'quota';
  }

  if (
    status === 408 ||
    code === 'ETIMEDOUT' ||
    TIMEOUT_ERROR_NAMES.has(name) ||
    message.includes('timed out') ||
    message.includes('timeout')
  ) {
    return 'timeout';
  }

  if (
    CONNECTION_ERROR_CODES.has(code) ||
    CONNECTION_ERROR_NAMES.has(name) ||
    message.includes('fetch failed') ||
    message.includes('econnrefused') ||
    message.includes('enotfound') ||
    message.includes('socket hang up') ||
    message.includes('network error')
  ) {
    return 'connection';
  }

  return null;
}

// Split Gemini-shaped content parts into plain text and normalized images.
// Returns { texts: string[], images: [{ mimeType, data, bytes }] } where
// `data` is base64 and `bytes` is a Buffer (Bedrock wants raw bytes).
function splitImageParts(parts) {
  const texts = [];
  const images = [];

  const list = Array.isArray(parts) ? parts : [parts];
  for (const part of list) {
    if (typeof part === 'string') {
      if (part) texts.push(part);
      continue;
    }
    if (!part || typeof part !== 'object') {
      continue;
    }
    if (typeof part.text === 'string') {
      if (part.text) texts.push(part.text);
      continue;
    }
    const inline = part.inlineData || part.inline_data;
    if (inline && typeof inline.data === 'string' && inline.data) {
      const mimeType = inline.mimeType || inline.mime_type || 'image/png';
      images.push({
        mimeType,
        data: inline.data,
        bytes: Buffer.from(inline.data, 'base64')
      });
    }
  }

  return { texts, images };
}

module.exports = {
  PROVIDER_METHODS,
  assertProvider,
  classifyProviderError,
  splitImageParts
};
