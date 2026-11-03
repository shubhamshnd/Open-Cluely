const fs = require('fs');
const path = require('path');
const {
  isConfiguredAiProvider,
  isConfiguredAwsAuthMode,
  isConfiguredSttProvider,
  isConfiguredTranscribeLanguage
} = require('../../config');

const APP_STATE_DIR_NAME = 'cache';
const APP_STATE_FILE_NAME = 'app-state.json';

function getDefaultAppState() {
  return {
    aiProvider: null,
    geminiApiKey: null,
    assemblyAiApiKey: null,
    geminiApiKeyIndex: 0,
    geminiModel: null,
    openaiApiKey: null,
    openaiModel: null,
    anthropicApiKey: null,
    anthropicModel: null,
    bedrockRegion: null,
    bedrockAccessKeyId: null,
    bedrockSecretAccessKey: null,
    bedrockModelId: null,
    // AWS auth, shared by Bedrock and Amazon Transcribe. `awsAuthMode: null`
    // means "not migrated yet": sanitizeAppState derives it once from the
    // legacy bedrockAccessKeyId/bedrockSecretAccessKey pair.
    awsAuthMode: null,
    awsProfile: null,
    awsAccessKeyId: null,
    awsSecretAccessKey: null,
    awsSessionToken: null,
    bedrockApiKey: null,
    // Speech-to-text provider ('assemblyai' default) + Amazon Transcribe.
    sttProvider: 'assemblyai',
    transcribeRegion: null,
    transcribeLanguage: null,
    transcribeVocabularyName: null,
    // Ordered provider names tried when the active provider fails with an
    // auth, quota, timeout or connection error. Empty = no fallback.
    providerFallback: [],
    ollamaBaseUrl: null,
    ollamaModel: null,
    assemblyAiSpeechModel: null,
    programmingLanguage: null,
    windowOpacityLevel: 10,
    themePreference: null,
    // Capture/startup toggles. `null` = "not migrated yet": on launch the
    // value is seeded once from .env/built-in defaults, then owned by app
    // state (packaged builds cannot write into process.resourcesPath).
    hideFromScreenCapture: null,
    startHidden: null,
    maxScreenshots: null,
    screenshotDelay: null
  };
}

function sanitizeAppState(state) {
  const nextState = getDefaultAppState();

  if (state && typeof state === 'object' && !Array.isArray(state)) {
    const aiProvider = String(state.aiProvider ?? '').trim().toLowerCase();
    if (isConfiguredAiProvider(aiProvider)) {
      nextState.aiProvider = aiProvider;
    }

    if (typeof state.geminiApiKey === 'string') {
      const geminiApiKey = state.geminiApiKey.trim();
      nextState.geminiApiKey = geminiApiKey || null;
    }

    if (typeof state.assemblyAiApiKey === 'string') {
      const assemblyAiApiKey = state.assemblyAiApiKey.trim();
      nextState.assemblyAiApiKey = assemblyAiApiKey || null;
    }

    const geminiApiKeyIndex = Number.parseInt(String(state.geminiApiKeyIndex ?? ''), 10);
    if (Number.isFinite(geminiApiKeyIndex) && geminiApiKeyIndex >= 0) {
      nextState.geminiApiKeyIndex = geminiApiKeyIndex;
    }

    if (typeof state.geminiModel === 'string' && state.geminiModel.trim()) {
      nextState.geminiModel = state.geminiModel.trim();
    }

    for (const key of [
      'openaiApiKey',
      'openaiModel',
      'anthropicApiKey',
      'anthropicModel',
      'bedrockRegion',
      'bedrockAccessKeyId',
      'bedrockSecretAccessKey',
      'bedrockModelId',
      'awsProfile',
      'awsAccessKeyId',
      'awsSecretAccessKey',
      'awsSessionToken',
      'bedrockApiKey',
      'transcribeRegion',
      'transcribeVocabularyName'
    ]) {
      if (typeof state[key] === 'string' && state[key].trim()) {
        nextState[key] = state[key].trim();
      }
    }

    // AWS auth mode. One-time migration: a state file with the legacy Bedrock
    // key pair but no auth mode yet becomes mode 'keys' with those values;
    // anything else without a mode becomes 'default'. Once a mode is set it
    // is always kept, so the migration can never re-trigger.
    const savedAuthMode = typeof state.awsAuthMode === 'string' ? state.awsAuthMode.trim() : '';
    const legacyAccessKeyId = typeof state.bedrockAccessKeyId === 'string' ? state.bedrockAccessKeyId.trim() : '';
    const legacySecretAccessKey = typeof state.bedrockSecretAccessKey === 'string' ? state.bedrockSecretAccessKey.trim() : '';
    if (isConfiguredAwsAuthMode(savedAuthMode)) {
      nextState.awsAuthMode = savedAuthMode;
    } else if (legacyAccessKeyId && legacySecretAccessKey) {
      nextState.awsAuthMode = 'keys';
      if (!nextState.awsAccessKeyId) {
        nextState.awsAccessKeyId = legacyAccessKeyId;
      }
      if (!nextState.awsSecretAccessKey) {
        nextState.awsSecretAccessKey = legacySecretAccessKey;
      }
    } else {
      nextState.awsAuthMode = 'default';
    }

    if (typeof state.sttProvider === 'string' && isConfiguredSttProvider(state.sttProvider.trim())) {
      nextState.sttProvider = state.sttProvider.trim();
    }

    if (typeof state.transcribeLanguage === 'string' && isConfiguredTranscribeLanguage(state.transcribeLanguage.trim())) {
      nextState.transcribeLanguage = state.transcribeLanguage.trim();
    }

    if (Array.isArray(state.providerFallback)) {
      nextState.providerFallback = state.providerFallback
        .map((entry) => String(entry ?? '').trim().toLowerCase())
        .filter((entry, index, list) => isConfiguredAiProvider(entry) && list.indexOf(entry) === index);
    }

    if (typeof state.ollamaBaseUrl === 'string' && state.ollamaBaseUrl.trim()) {
      nextState.ollamaBaseUrl = state.ollamaBaseUrl.trim();
    }

    if (typeof state.ollamaModel === 'string' && state.ollamaModel.trim()) {
      nextState.ollamaModel = state.ollamaModel.trim();
    }

    if (typeof state.assemblyAiSpeechModel === 'string' && state.assemblyAiSpeechModel.trim()) {
      nextState.assemblyAiSpeechModel = state.assemblyAiSpeechModel.trim();
    }

    if (typeof state.programmingLanguage === 'string' && state.programmingLanguage.trim()) {
      nextState.programmingLanguage = state.programmingLanguage.trim();
    }

    const windowOpacityLevel = Number.parseInt(String(state.windowOpacityLevel ?? ''), 10);
    if (Number.isFinite(windowOpacityLevel)) {
      nextState.windowOpacityLevel = Math.min(Math.max(windowOpacityLevel, 1), 10);
    }

    const themePreference = String(state.themePreference ?? '').trim().toLowerCase();
    if (themePreference === 'dark' || themePreference === 'light') {
      nextState.themePreference = themePreference;
    }

    if (typeof state.hideFromScreenCapture === 'boolean') {
      nextState.hideFromScreenCapture = state.hideFromScreenCapture;
    }

    if (typeof state.startHidden === 'boolean') {
      nextState.startHidden = state.startHidden;
    }

    const maxScreenshots = Number.parseInt(String(state.maxScreenshots ?? ''), 10);
    if (Number.isFinite(maxScreenshots) && maxScreenshots > 0) {
      nextState.maxScreenshots = maxScreenshots;
    }

    const screenshotDelay = Number.parseInt(String(state.screenshotDelay ?? ''), 10);
    if (Number.isFinite(screenshotDelay) && screenshotDelay >= 0) {
      nextState.screenshotDelay = screenshotDelay;
    }
  }

  return nextState;
}

function getAppStateBaseDir(app) {
  // Dev: project root next to package.json so devs can inspect state easily.
  if (app && !app.isPackaged) {
    return path.join(__dirname, '..', '..', '..');
  }

  // Packaged: userData (e.g. %APPDATA%/<productName> on Windows). Critical for
  // portable builds — the EXE extracts to a temp dir each launch, so writing
  // beside the EXE means state is wiped every run.
  if (app) {
    return app.getPath('userData');
  }

  return path.join(__dirname, '..', '..', '..');
}

function getAppStateDir(app) {
  return path.join(getAppStateBaseDir(app), APP_STATE_DIR_NAME);
}

function getAppStatePath(app) {
  return path.join(getAppStateDir(app), APP_STATE_FILE_NAME);
}

function ensureAppStateDir(app) {
  fs.mkdirSync(getAppStateDir(app), { recursive: true });
}

function writeAppStateFile(app, state) {
  ensureAppStateDir(app);
  fs.writeFileSync(
    getAppStatePath(app),
    `${JSON.stringify(state, null, 2)}\n`,
    'utf8'
  );
}

function loadAppState(app) {
  const appStatePath = getAppStatePath(app);

  try {
    ensureAppStateDir(app);

    if (!fs.existsSync(appStatePath)) {
      const defaultState = getDefaultAppState();
      writeAppStateFile(app, defaultState);
      return defaultState;
    }

    const fileContent = fs.readFileSync(appStatePath, 'utf8');
    const sanitizedState = sanitizeAppState(JSON.parse(fileContent));
    writeAppStateFile(app, sanitizedState);
    return sanitizedState;
  } catch (error) {
    console.error('Failed to load app state:', error);
    return getDefaultAppState();
  }
}

function saveAppState(app, partialState = {}) {
  ensureAppStateDir(app);

  const currentState = loadAppState(app);
  const nextState = sanitizeAppState({
    ...currentState,
    ...partialState
  });

  writeAppStateFile(app, nextState);

  return nextState;
}

module.exports = {
  getDefaultAppState,
  getAppStatePath,
  loadAppState,
  saveAppState,
  // Exported for tests; the migration/normalization rules all live here.
  sanitizeAppState
};
