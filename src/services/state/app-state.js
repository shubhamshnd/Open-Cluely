const fs = require('fs');
const path = require('path');

const APP_STATE_DIR_NAME = 'cache';
const APP_STATE_FILE_NAME = 'app-state.json';

function getDefaultAppState() {
  return {
    aiProvider: null,
    geminiApiKey: null,
    assemblyAiApiKey: null,
    geminiApiKeyIndex: 0,
    geminiModel: null,
    ollamaBaseUrl: null,
    ollamaModel: null,
    assemblyAiSpeechModel: null,
    programmingLanguage: null,
    windowOpacityLevel: 10,
    themePreference: null
  };
}

function sanitizeAppState(state) {
  const nextState = getDefaultAppState();

  if (state && typeof state === 'object' && !Array.isArray(state)) {
    const aiProvider = String(state.aiProvider ?? '').trim().toLowerCase();
    if (aiProvider === 'gemini' || aiProvider === 'ollama') {
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
  }

  return nextState;
}

function getAppStateBaseDir(app) {
  if (app && !app.isPackaged) {
    return path.join(__dirname, '..', '..', '..');
  }

  if (app) {
    return path.dirname(app.getPath('exe'));
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
  saveAppState
};
