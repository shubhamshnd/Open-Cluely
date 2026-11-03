// ============================================================================
// PROVIDER MODEL LISTS
// ============================================================================
// Fetch available models where the vendor API allows it (settings "Fetch"
// buttons). OpenAI: models.list(); Bedrock: ListFoundationModels. Anthropic has
// no public list call, so it stays on the curated list in src/config.js.
// `factories` is injectable so tests never touch the network or SDKs.
// ============================================================================

const OpenAIService = require('./openai-service');
const BedrockService = require('./bedrock-service');

const FETCHABLE_PROVIDERS = ['openai', 'bedrock'];

const defaultFactories = {
  openai: ({ apiKey }) => new OpenAIService(apiKey),
  bedrock: ({ region, authMode, profile, accessKeyId, secretAccessKey, sessionToken, apiKey }) =>
    new BedrockService({ region, authMode, profile, accessKeyId, secretAccessKey, sessionToken, apiKey })
};

function str(value) {
  return String(value ?? '').trim();
}

// Never surface credentials: SDK errors can echo request details.
function safeMessage(error) {
  const message = String(error?.message || 'request failed');
  return message.replace(/(sk-[A-Za-z0-9_-]{6,}|AKIA[A-Z0-9]{8,})/g, '[redacted]');
}

async function fetchProviderModels(provider, params = {}, factories = defaultFactories) {
  const name = str(provider).toLowerCase();
  if (!FETCHABLE_PROVIDERS.includes(name)) {
    return { success: false, error: `Model listing is not available for ${name || 'this provider'}.` };
  }

  try {
    const service = factories[name]({
      apiKey: str(params.apiKey),
      region: str(params.region),
      authMode: str(params.authMode),
      profile: str(params.profile),
      accessKeyId: str(params.accessKeyId),
      secretAccessKey: str(params.secretAccessKey),
      sessionToken: str(params.sessionToken)
    });

    if (!service.ready()) {
      return {
        success: false,
        error: name === 'openai'
          ? 'Enter your OpenAI API key first.'
          : 'Complete the AWS credentials in Settings (or pick Default to use the AWS credential chain).'
      };
    }

    const models = await service.listModels();
    if (!Array.isArray(models) || models.length === 0) {
      return { success: false, error: 'No models were returned for this account.' };
    }
    return { success: true, models };
  } catch (error) {
    return { success: false, error: safeMessage(error) };
  }
}

module.exports = { fetchProviderModels, FETCHABLE_PROVIDERS };
