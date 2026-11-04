// ============================================================================
// AI PROVIDER REGISTRY
// ============================================================================
// Maps a provider name to a factory and a readiness check, replacing the old
// gemini/ollama if-branches. The registry caches one service instance per
// provider and reconfigures it in place when settings change.
//
// `settings` shape (all fields optional):
//   { programmingLanguage,
//     gemini:    { apiKey, modelName },
//     openai:    { apiKey, modelName },
//     anthropic: { apiKey, modelName },
//     bedrock:   { region, authMode, profile, accessKeyId, secretAccessKey,
//                  sessionToken, apiKey, modelId },
//     ollama:    { baseUrl, modelName } }
// ============================================================================

const GeminiService = require('./gemini-service');
const OpenAIService = require('./openai-service');
const AnthropicService = require('./anthropic-service');
const BedrockService = require('./bedrock-service');
const OllamaService = require('./ollama-service');
const { isAwsAuthReady } = require('../aws/credentials');
const {
  getAiProviders,
  resolveAiProvider,
  resolveGeminiModel,
  resolveOpenAIModel,
  resolveAnthropicModel,
  resolveBedrockModel,
  getDefaultOllamaModel
} = require('../../config');

function str(value) {
  return String(value ?? '').trim();
}

const PROVIDER_DEFINITIONS = {
  gemini: {
    // Readiness is checked before a service exists, so it works on settings.
    isConfigured: (s) => str(s.gemini?.apiKey).length > 0,
    create: (s) =>
      new GeminiService(str(s.gemini?.apiKey), {
        modelName: s.gemini?.modelName,
        programmingLanguage: s.programmingLanguage
      }),
    configure: (service, s) =>
      service.updateConfiguration({
        apiKey: str(s.gemini?.apiKey),
        modelName: s.gemini?.modelName,
        programmingLanguage: s.programmingLanguage
      }),
    modelOf: (s) => resolveGeminiModel(s.gemini?.modelName)
  },
  openai: {
    isConfigured: (s) => str(s.openai?.apiKey).length > 0,
    create: (s) =>
      new OpenAIService(str(s.openai?.apiKey), {
        modelName: s.openai?.modelName,
        programmingLanguage: s.programmingLanguage
      }),
    configure: (service, s) =>
      service.updateConfiguration({
        apiKey: str(s.openai?.apiKey),
        modelName: s.openai?.modelName,
        programmingLanguage: s.programmingLanguage
      }),
    modelOf: (s) => resolveOpenAIModel(s.openai?.modelName)
  },
  anthropic: {
    isConfigured: (s) => str(s.anthropic?.apiKey).length > 0,
    create: (s) =>
      new AnthropicService(str(s.anthropic?.apiKey), {
        modelName: s.anthropic?.modelName,
        programmingLanguage: s.programmingLanguage
      }),
    configure: (service, s) =>
      service.updateConfiguration({
        apiKey: str(s.anthropic?.apiKey),
        modelName: s.anthropic?.modelName,
        programmingLanguage: s.programmingLanguage
      }),
    modelOf: (s) => resolveAnthropicModel(s.anthropic?.modelName)
  },
  bedrock: {
    // Readiness comes from the shared AWS auth resolver: default chain needs
    // nothing, profile needs a name, keys need both parts, apiKey needs the
    // key. An unset mode with key material keeps the legacy keys behavior.
    isConfigured: (s) => {
      const mode = str(s.bedrock?.authMode);
      if (!mode && (str(s.bedrock?.accessKeyId) || str(s.bedrock?.secretAccessKey))) {
        // Legacy shape: both key parts, or neither (default chain).
        return str(s.bedrock?.accessKeyId).length > 0 && str(s.bedrock?.secretAccessKey).length > 0;
      }
      return isAwsAuthReady({
        awsAuthMode: s.bedrock?.authMode,
        awsProfile: s.bedrock?.profile,
        awsAccessKeyId: s.bedrock?.accessKeyId,
        awsSecretAccessKey: s.bedrock?.secretAccessKey,
        awsSessionToken: s.bedrock?.sessionToken,
        bedrockApiKey: s.bedrock?.apiKey
      }, { purpose: 'bedrock' });
    },
    create: (s) =>
      new BedrockService({
        region: s.bedrock?.region,
        authMode: s.bedrock?.authMode,
        profile: s.bedrock?.profile,
        accessKeyId: s.bedrock?.accessKeyId,
        secretAccessKey: s.bedrock?.secretAccessKey,
        sessionToken: s.bedrock?.sessionToken,
        apiKey: s.bedrock?.apiKey,
        modelId: s.bedrock?.modelId,
        programmingLanguage: s.programmingLanguage
      }),
    configure: (service, s) =>
      service.updateConfiguration({
        region: s.bedrock?.region,
        authMode: s.bedrock?.authMode,
        profile: s.bedrock?.profile,
        accessKeyId: s.bedrock?.accessKeyId,
        secretAccessKey: s.bedrock?.secretAccessKey,
        sessionToken: s.bedrock?.sessionToken,
        apiKey: s.bedrock?.apiKey,
        modelId: s.bedrock?.modelId,
        programmingLanguage: s.programmingLanguage
      }),
    modelOf: (s) => resolveBedrockModel(s.bedrock?.modelId)
  },
  ollama: {
    isConfigured: () => true,
    create: (s) =>
      new OllamaService({
        baseUrl: s.ollama?.baseUrl,
        modelName: s.ollama?.modelName,
        programmingLanguage: s.programmingLanguage
      }),
    configure: (service, s) =>
      service.updateConfiguration({
        baseUrl: s.ollama?.baseUrl,
        modelName: s.ollama?.modelName,
        programmingLanguage: s.programmingLanguage
      }),
    modelOf: (s) => str(s.ollama?.modelName) || getDefaultOllamaModel()
  }
};

// Providers the registry knows must exactly match the configured list.
for (const name of getAiProviders()) {
  if (!PROVIDER_DEFINITIONS[name]) {
    throw new Error(`Provider registry has no definition for "${name}".`);
  }
}

// `definitions` is injectable so tests can use fake providers without SDKs.
function createProviderRegistry(definitions = PROVIDER_DEFINITIONS) {
  const services = new Map();

  function definitionFor(name) {
    const providerName = resolveAiProvider(name);
    const definition = definitions[providerName];
    if (!definition) {
      throw new Error(`Unknown AI provider: ${name}`);
    }
    return { providerName, definition };
  }

  // True when `name` has the settings it needs to run. This is the single
  // gate that replaces the Gemini-only hasApiKeys() check.
  function isReady(name, settings = {}) {
    const { definition } = definitionFor(name);
    return definition.isConfigured(settings) === true;
  }

  // Returns the cached service for `name`, creating or reconfiguring it from
  // `settings`. Returns null when the provider is not ready.
  function getService(name, settings = {}) {
    const { providerName, definition } = definitionFor(name);
    if (!definition.isConfigured(settings)) {
      services.delete(providerName);
      return null;
    }

    let service = services.get(providerName);
    if (service) {
      definition.configure(service, settings);
    } else {
      service = definition.create(settings);
      services.set(providerName, service);
    }
    return service;
  }

  function peek(name) {
    return services.get(resolveAiProvider(name)) || null;
  }

  function reset(name) {
    if (name === undefined) {
      services.clear();
      return;
    }
    services.delete(resolveAiProvider(name));
  }

  function getModel(name, settings = {}) {
    const { definition } = definitionFor(name);
    return str(definition.modelOf?.(settings));
  }

  return { isReady, getService, peek, reset, getModel };
}

module.exports = { createProviderRegistry, PROVIDER_DEFINITIONS };
