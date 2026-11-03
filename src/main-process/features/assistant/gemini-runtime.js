const GeminiService = require('../../../services/ai/gemini-service');
const { createProviderRegistry } = require('../../../services/ai/provider-registry');
const {
  resolveAiProvider,
  getAiProviders,
  getDefaultAiProvider,
  getDefaultOllamaBaseUrl,
  getDefaultOllamaModel,
  resolveGeminiModel,
  resolveProgrammingLanguage,
  getGeminiModels,
  getDefaultGeminiModel,
  getProgrammingLanguages,
  getDefaultProgrammingLanguage
} = require('../../../config');

const GEMINI_ALL_KEYS_UNAVAILABLE_ERROR_CODE = 'GEMINI_ALL_KEYS_UNAVAILABLE';

function normalizeGeminiApiKeys(keys) {
  const sourceValues = Array.isArray(keys)
    ? keys
    : String(keys ?? '').split(',');
  const seen = new Set();
  const nextKeys = [];

  for (const rawValue of sourceValues) {
    const key = String(rawValue || '').trim();
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    nextKeys.push(key);
  }

  return nextKeys;
}

function createGeminiRuntime() {
  let geminiService = null;
  const providerRegistry = createProviderRegistry();
  // Settings for the non-Gemini providers (keys/models live in app state and
  // are pushed in via setProviderSettings). Gemini keeps its own key rotation.
  const providerSettings = {
    openai: { apiKey: '', modelName: '' },
    anthropic: { apiKey: '', modelName: '' },
    bedrock: { region: '', accessKeyId: '', secretAccessKey: '', modelId: '' }
  };
  let activeAiProvider = getDefaultAiProvider();
  let activeGeminiModel = getDefaultGeminiModel();
  let activeProgrammingLanguage = getDefaultProgrammingLanguage();
  let activeOllamaBaseUrl = getDefaultOllamaBaseUrl();
  let activeOllamaModel = getDefaultOllamaModel();
  let geminiApiKeys = [];
  let activeApiKeyIndex = 0;
  let activeKeyIndexChangeHandler = null;

  function notifyActiveKeyIndexChanged(index) {
    if (typeof activeKeyIndexChangeHandler !== 'function') {
      return;
    }

    try {
      activeKeyIndexChangeHandler(index);
    } catch (error) {
      console.error('Failed to persist active Gemini API key index:', error);
    }
  }

  function normalizeKeyIndex(index) {
    if (geminiApiKeys.length === 0) {
      return 0;
    }

    const parsedIndex = Number.parseInt(String(index ?? ''), 10);
    const safeIndex = Number.isFinite(parsedIndex) ? parsedIndex : 0;
    const maxIndex = geminiApiKeys.length - 1;

    return Math.min(Math.max(safeIndex, 0), maxIndex);
  }

  function setActiveApiKeyIndex(index, options = {}) {
    const nextIndex = normalizeKeyIndex(index);
    const shouldNotify = options.notify !== false;
    const changed = nextIndex !== activeApiKeyIndex;
    activeApiKeyIndex = nextIndex;

    if (changed && shouldNotify) {
      notifyActiveKeyIndexChanged(activeApiKeyIndex);
    }

    return activeApiKeyIndex;
  }

  function getActiveApiKey() {
    if (geminiApiKeys.length === 0) {
      return '';
    }

    return geminiApiKeys[activeApiKeyIndex] || '';
  }

  function hasApiKeys() {
    return geminiApiKeys.length > 0;
  }

  function buildRegistrySettings() {
    return {
      programmingLanguage: activeProgrammingLanguage,
      gemini: { apiKey: getActiveApiKey(), modelName: activeGeminiModel },
      openai: { ...providerSettings.openai },
      anthropic: { ...providerSettings.anthropic },
      bedrock: { ...providerSettings.bedrock },
      ollama: { baseUrl: activeOllamaBaseUrl, modelName: activeOllamaModel }
    };
  }

  // Provider-agnostic readiness gate; replaces the Gemini-only hasApiKeys()
  // check in assistant IPC and the mobile server.
  function isReady(providerName = activeAiProvider) {
    return providerRegistry.isReady(providerName, buildRegistrySettings());
  }

  function setProviderSettings(providerName, values = {}) {
    if (!providerSettings[providerName]) {
      throw new Error(`No configurable settings for provider "${providerName}".`);
    }
    for (const key of Object.keys(providerSettings[providerName])) {
      if (values[key] !== undefined) {
        providerSettings[providerName][key] = String(values[key] ?? '').trim();
      }
    }
    return { ...providerSettings[providerName] };
  }

  function getProviderSettings(providerName) {
    return providerSettings[providerName] ? { ...providerSettings[providerName] } : null;
  }

  // Model id for the "Provider · model" label in the top bar.
  function getActiveModelName() {
    return providerRegistry.getModel(activeAiProvider, buildRegistrySettings());
  }

  function initializeGeminiService(
    apiKey = getActiveApiKey(),
    modelName = activeGeminiModel,
    programmingLanguage = activeProgrammingLanguage
  ) {
    activeGeminiModel = resolveGeminiModel(modelName);
    activeProgrammingLanguage = resolveProgrammingLanguage(programmingLanguage);

    try {
      if (!apiKey) {
        console.error('Gemini API key not configured in app settings');
        geminiService = null;
        return null;
      }

      console.log(
        'Initializing Gemini AI Service with model and language:',
        activeGeminiModel,
        activeProgrammingLanguage
      );

      if (geminiService) {
        geminiService.updateConfiguration({
          apiKey,
          modelName: activeGeminiModel,
          programmingLanguage: activeProgrammingLanguage
        });
      } else {
        geminiService = new GeminiService(apiKey, {
          modelName: activeGeminiModel,
          programmingLanguage: activeProgrammingLanguage
        });
      }

      console.log('Gemini AI Service initialized successfully');
      return geminiService;
    } catch (error) {
      geminiService = null;
      console.error('Failed to initialize Gemini AI Service:', error);
      return null;
    }
  }

  function setKeys(apiKeys, preferredIndex = 0) {
    geminiApiKeys = normalizeGeminiApiKeys(apiKeys);

    if (!hasApiKeys()) {
      setActiveApiKeyIndex(0);
      geminiService = null;
      return {
        geminiApiKeys: [],
        activeApiKeyIndex: 0,
        activeApiKey: ''
      };
    }

    setActiveApiKeyIndex(preferredIndex);

    return {
      geminiApiKeys: [...geminiApiKeys],
      activeApiKeyIndex,
      activeApiKey: getActiveApiKey()
    };
  }

  function getApiKeys() {
    return [...geminiApiKeys];
  }

  function switchToNextKey() {
    if (!hasApiKeys()) {
      return {
        switched: false,
        activeApiKeyIndex,
        activeApiKey: ''
      };
    }

    if (geminiApiKeys.length === 1) {
      return {
        switched: false,
        activeApiKeyIndex,
        activeApiKey: getActiveApiKey()
      };
    }

    const previousIndex = activeApiKeyIndex;
    const nextIndex = (activeApiKeyIndex + 1) % geminiApiKeys.length;
    setActiveApiKeyIndex(nextIndex);

    if (nextIndex === previousIndex) {
      return {
        switched: false,
        activeApiKeyIndex,
        activeApiKey: getActiveApiKey()
      };
    }

    initializeGeminiService(getActiveApiKey(), activeGeminiModel, activeProgrammingLanguage);

    return {
      switched: true,
      activeApiKeyIndex,
      activeApiKey: getActiveApiKey()
    };
  }

  function isSwitchEligibleError(error) {
    if (!error) {
      return false;
    }

    if (geminiService?.isQuotaExhaustedError?.(error)) {
      return true;
    }

    if (geminiService?.isAuthenticationError?.(error)) {
      return true;
    }

    const message = String(error?.message || '').toLowerCase();
    return (
      message.includes('quota exceeded') ||
      message.includes('api key not valid') ||
      message.includes('invalid api key') ||
      message.includes('permission denied') ||
      message.includes('401') ||
      message.includes('403') ||
      message.includes('unauthorized') ||
      message.includes('forbidden')
    );
  }

  function createAllKeysUnavailableError(cause) {
    const allKeysUnavailableError = new Error(
      'All configured Gemini API keys are currently unavailable due to quota or authentication errors.'
    );

    allKeysUnavailableError.code = GEMINI_ALL_KEYS_UNAVAILABLE_ERROR_CODE;
    allKeysUnavailableError.isAllKeysUnavailable = true;
    if (cause) {
      allKeysUnavailableError.cause = cause;
    }

    return allKeysUnavailableError;
  }

  function isAllKeysUnavailableError(error) {
    return Boolean(
      error && (
        error.code === GEMINI_ALL_KEYS_UNAVAILABLE_ERROR_CODE ||
        error.isAllKeysUnavailable === true
      )
    );
  }

  async function executeWithKeyFailover(operation) {
    if (typeof operation !== 'function') {
      throw new Error('AI failover operation must be a function.');
    }

    // Non-Gemini providers have no key rotation — resolve via the registry.
    if (activeAiProvider !== 'gemini') {
      const service = providerRegistry.getService(activeAiProvider, buildRegistrySettings());
      if (!service) {
        throw new Error(`${activeAiProvider} is not configured. Add its credentials in Settings.`);
      }
      return await operation(service, {
        activeApiKeyIndex: 0,
        activeApiKey: '',
        attempt: 1,
        totalKeys: 0
      });
    }

    if (!hasApiKeys()) {
      throw new Error('No Gemini API key configured. Add it in Settings.');
    }

    const totalKeys = geminiApiKeys.length;
    const startIndex = activeApiKeyIndex;
    let attemptedKeys = 0;
    let lastSwitchEligibleError = null;

    while (attemptedKeys < totalKeys) {
      const activeApiKey = getActiveApiKey();
      if (!activeApiKey) {
        break;
      }

      if (!geminiService || geminiService.apiKey !== activeApiKey) {
        initializeGeminiService(activeApiKey, activeGeminiModel, activeProgrammingLanguage);
      }

      try {
        return await operation(geminiService, {
          activeApiKeyIndex,
          activeApiKey,
          attempt: attemptedKeys + 1,
          totalKeys
        });
      } catch (error) {
        if (!isSwitchEligibleError(error)) {
          throw error;
        }

        lastSwitchEligibleError = error;
        attemptedKeys += 1;

        if (attemptedKeys >= totalKeys) {
          if (activeApiKeyIndex !== startIndex) {
            setActiveApiKeyIndex(startIndex);
            initializeGeminiService(getActiveApiKey(), activeGeminiModel, activeProgrammingLanguage);
          }

          throw createAllKeysUnavailableError(lastSwitchEligibleError);
        }

        switchToNextKey();
      }
    }

    throw createAllKeysUnavailableError(lastSwitchEligibleError);
  }

  function initializeOllamaService(
    baseUrl = activeOllamaBaseUrl,
    modelName = activeOllamaModel,
    programmingLanguage = activeProgrammingLanguage
  ) {
    activeOllamaBaseUrl = String(baseUrl || getDefaultOllamaBaseUrl()).replace(/\/+$/, '');
    activeOllamaModel = String(modelName || getDefaultOllamaModel()).trim();
    activeProgrammingLanguage = resolveProgrammingLanguage(programmingLanguage);

    try {
      return providerRegistry.getService('ollama', buildRegistrySettings());
    } catch (error) {
      providerRegistry.reset('ollama');
      console.error('Failed to initialize Ollama AI Service:', error);
      return null;
    }
  }

  function initializeAiService() {
    if (activeAiProvider === 'gemini') {
      return initializeGeminiService(getActiveApiKey(), activeGeminiModel, activeProgrammingLanguage);
    }
    try {
      return providerRegistry.getService(activeAiProvider, buildRegistrySettings());
    } catch (error) {
      providerRegistry.reset(activeAiProvider);
      console.error(`Failed to initialize ${activeAiProvider} AI Service:`, error);
      return null;
    }
  }

  function setActiveAiProvider(providerName) {
    activeAiProvider = resolveAiProvider(providerName);
    return activeAiProvider;
  }

  function getActiveAiProvider() {
    return activeAiProvider;
  }

  function setActiveOllamaBaseUrl(baseUrl) {
    activeOllamaBaseUrl = String(baseUrl || getDefaultOllamaBaseUrl()).replace(/\/+$/, '');
    return activeOllamaBaseUrl;
  }

  function getActiveOllamaBaseUrl() {
    return activeOllamaBaseUrl;
  }

  function setActiveOllamaModel(modelName) {
    activeOllamaModel = String(modelName || getDefaultOllamaModel()).trim();
    return activeOllamaModel;
  }

  function getActiveOllamaModel() {
    return activeOllamaModel;
  }

  function getService() {
    if (activeAiProvider === 'gemini') {
      return geminiService;
    }
    return providerRegistry.peek(activeAiProvider);
  }

  function getActiveGeminiModel() {
    return activeGeminiModel;
  }

  function getActiveProgrammingLanguage() {
    return activeProgrammingLanguage;
  }

  function setActiveGeminiModel(modelName) {
    activeGeminiModel = resolveGeminiModel(modelName);
    return activeGeminiModel;
  }

  function setActiveProgrammingLanguage(language) {
    activeProgrammingLanguage = resolveProgrammingLanguage(language);
    return activeProgrammingLanguage;
  }

  function setActiveKeyIndexChangeHandler(handler) {
    activeKeyIndexChangeHandler = typeof handler === 'function' ? handler : null;
  }

  return {
    initializeGeminiService,
    initializeOllamaService,
    initializeAiService,
    setKeys,
    getApiKeys,
    hasApiKeys,
    isReady,
    setProviderSettings,
    getProviderSettings,
    getActiveModelName,
    getActiveApiKey,
    getActiveApiKeyIndex: () => activeApiKeyIndex,
    switchToNextKey,
    executeWithKeyFailover,
    isAllKeysUnavailableError,
    setActiveKeyIndexChangeHandler,
    getService,
    getAiProviders,
    getDefaultAiProvider,
    getActiveAiProvider,
    setActiveAiProvider,
    getGeminiModels,
    getDefaultGeminiModel,
    getActiveGeminiModel,
    setActiveGeminiModel,
    getDefaultOllamaBaseUrl,
    getDefaultOllamaModel,
    getActiveOllamaBaseUrl,
    setActiveOllamaBaseUrl,
    getActiveOllamaModel,
    setActiveOllamaModel,
    getProgrammingLanguages,
    getDefaultProgrammingLanguage,
    getActiveProgrammingLanguage,
    setActiveProgrammingLanguage
  };
}

module.exports = {
  GEMINI_ALL_KEYS_UNAVAILABLE_ERROR_CODE,
  createGeminiRuntime
};
