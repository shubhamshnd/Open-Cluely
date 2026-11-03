const { fetchProviderModels } = require('../../../services/ai/model-lists');
const { listAwsProfiles, resolveAwsAuth } = require('../../../services/aws/credentials');
const {
  createOrUpdateVocabulary,
  defaultCreateClient
} = require('../../../services/stt/transcribe-vocabulary');
const {
  getAiProviderLabel,
  getOpenAIModels,
  getAnthropicModels,
  getBedrockModels,
  getDefaultBedrockRegion,
  getAwsAuthModes,
  getAwsAuthModeLabels,
  resolveAwsAuthMode,
  getSttProviders,
  getSttProviderLabels,
  resolveSttProvider,
  getTranscribeLanguages,
  getDefaultTranscribeRegion,
  resolveTranscribeRegion,
  resolveTranscribeLanguage
} = require('../../../config');
const { createGnomeShortcutInstaller } = require('../../shared/shortcut-actions');
const {
  maskSecretValue,
  maskSecretList,
  resolveSecretOnSave,
  resolveSecretListOnSave
} = require('../../../services/state/secret-masking');

function registerSettingsIpc({
  ipcMain,
  app,
  getAppEnvironment,
  getAppState,
  setAppState,
  getAppStatePath,
  saveAppState,
  geminiRuntime,
  windowController,
  getAssemblyAiSpeechModel,
  setAssemblyAiSpeechModel,
  keyboardShortcuts,
  assemblyAiSpeechModels,
  defaultAssemblyAiSpeechModel,
  // Injectable for tests: (clientConfig) => TranscribeClient-like.
  createTranscribeClient = defaultCreateClient
}) {
  // GNOME Wayland: global shortcuts cannot fire while a native Wayland window
  // has focus, so the user can opt into real GNOME keybindings. Only
  // handler-backed shortcuts are installable; entries are written only when
  // the user clicks Add in Settings → Shortcuts.
  const installableActionIds = new Set(windowController.getShortcutActionIds());
  const gnomeShortcutInstaller = createGnomeShortcutInstaller({
    platform: process.platform,
    env: process.env,
    execPath: process.execPath,
    appPath: app.getAppPath(),
    userDataPath: process.platform === 'linux' ? app.getPath('userData') : '',
    shortcuts: (Array.isArray(keyboardShortcuts) ? keyboardShortcuts : [])
      .filter((shortcut) => installableActionIds.has(shortcut.id))
      .map((shortcut) => ({
        id: shortcut.id,
        name: `Open Cluely: ${shortcut.buttonLabel || shortcut.id}`,
        accelerator: shortcut.accelerator
      }))
  });

  ipcMain.handle('gnome-shortcuts-install', () => gnomeShortcutInstaller.install());
  ipcMain.handle('gnome-shortcuts-remove', () => gnomeShortcutInstaller.remove());

  ipcMain.handle('get-settings', async () => {
    const appEnvironment = getAppEnvironment();
    const appState = getAppState();
    const geminiApiKey = typeof appState?.geminiApiKey === 'string' ? appState.geminiApiKey : '';
    const assemblyAiApiKey = typeof appState?.assemblyAiApiKey === 'string' ? appState.assemblyAiApiKey : '';

    return {
      aiProvider: geminiRuntime.getActiveAiProvider(),
      geminiApiKey: maskSecretList(geminiApiKey),
      assemblyAiApiKey: maskSecretValue(assemblyAiApiKey),
      hasGeminiApiKeys: geminiApiKey.split(',').map((value) => value.trim()).filter(Boolean).length > 0,
      hasAssemblyAiApiKey: assemblyAiApiKey.length > 0,
      geminiModel: geminiRuntime.getActiveGeminiModel(),
      geminiModels: geminiRuntime.getGeminiModels(),
      defaultGeminiModel: geminiRuntime.getDefaultGeminiModel(),
      aiProviders: geminiRuntime.getAiProviders(),
      aiProviderLabels: Object.fromEntries(
        geminiRuntime.getAiProviders().map((name) => [name, getAiProviderLabel(name)])
      ),
      activeModelName: geminiRuntime.getActiveModelName(),
      aiReady: geminiRuntime.isReady(),
      openaiApiKey: maskSecretValue(geminiRuntime.getProviderSettings('openai').apiKey),
      openaiModel: geminiRuntime.getProviderSettings('openai').modelName,
      openaiModels: getOpenAIModels(),
      anthropicApiKey: maskSecretValue(geminiRuntime.getProviderSettings('anthropic').apiKey),
      anthropicModel: geminiRuntime.getProviderSettings('anthropic').modelName,
      anthropicModels: getAnthropicModels(),
      bedrockRegion: geminiRuntime.getProviderSettings('bedrock').region,
      bedrockModelId: geminiRuntime.getProviderSettings('bedrock').modelId,
      bedrockModels: getBedrockModels(),
      defaultBedrockRegion: getDefaultBedrockRegion(),
      // AWS auth (shared by Bedrock and Amazon Transcribe). Profile listing
      // returns NAMES only — credential values are never read by the app.
      awsAuthMode: resolveAwsAuthMode(appState?.awsAuthMode),
      awsAuthModes: getAwsAuthModes(),
      awsAuthModeLabels: getAwsAuthModeLabels(),
      awsProfile: typeof appState?.awsProfile === 'string' ? appState.awsProfile : '',
      awsProfiles: listAwsProfiles().profiles,
      awsAccessKeyId: maskSecretValue(appState?.awsAccessKeyId),
      awsSecretAccessKey: maskSecretValue(appState?.awsSecretAccessKey),
      awsSessionToken: maskSecretValue(appState?.awsSessionToken),
      bedrockApiKey: maskSecretValue(appState?.bedrockApiKey),
      // Speech-to-text provider + Amazon Transcribe settings.
      sttProvider: resolveSttProvider(appState?.sttProvider),
      sttProviders: getSttProviders(),
      sttProviderLabels: getSttProviderLabels(),
      transcribeRegion: resolveTranscribeRegion(appState?.transcribeRegion),
      defaultTranscribeRegion: getDefaultTranscribeRegion(),
      transcribeLanguage: resolveTranscribeLanguage(appState?.transcribeLanguage),
      transcribeLanguages: getTranscribeLanguages(),
      transcribeVocabularyName: typeof appState?.transcribeVocabularyName === 'string' ? appState.transcribeVocabularyName : '',
      providerFallback: Array.isArray(appState?.providerFallback) ? appState.providerFallback : [],
      ollamaBaseUrl: geminiRuntime.getActiveOllamaBaseUrl(),
      ollamaModel: geminiRuntime.getActiveOllamaModel(),
      defaultOllamaBaseUrl: geminiRuntime.getDefaultOllamaBaseUrl(),
      defaultOllamaModel: geminiRuntime.getDefaultOllamaModel(),
      programmingLanguage: geminiRuntime.getActiveProgrammingLanguage(),
      programmingLanguages: geminiRuntime.getProgrammingLanguages(),
      defaultProgrammingLanguage: geminiRuntime.getDefaultProgrammingLanguage(),
      assemblyAiSpeechModels,
      defaultAssemblyAiSpeechModel,
      assemblyAiSpeechModel: getAssemblyAiSpeechModel(),
      keyboardShortcuts,
      hideFromScreenCapture: appEnvironment.hideFromScreenCapture,
      startHidden: appEnvironment.startHidden,
      windowOpacityLevel: windowController.getWindowOpacityLevel(),
      gnomeShortcuts: {
        available: gnomeShortcutInstaller.isAvailable(),
        installed: await gnomeShortcutInstaller.isInstalled()
      },
      themePreference: appState?.themePreference === 'dark' || appState?.themePreference === 'light'
        ? appState.themePreference
        : null
    };
  });

  // Settings "Fetch" buttons: list models with the values currently typed in
  // the form (not yet saved). Falls back to saved credentials when blank.
  ipcMain.handle('list-provider-models', async (_event, payload = {}) => {
    const provider = String(payload?.provider || '').trim().toLowerCase();
    const saved = geminiRuntime.getProviderSettings(provider) || {};
    const appState = typeof getAppState === 'function' ? getAppState() : null;
    return fetchProviderModels(provider, {
      apiKey: resolveSecretOnSave(payload?.apiKey, saved.apiKey),
      region: payload?.region || saved.region,
      authMode: payload?.authMode ?? appState?.awsAuthMode ?? saved.authMode,
      profile: payload?.profile ?? appState?.awsProfile ?? saved.profile,
      accessKeyId: resolveSecretOnSave(payload?.accessKeyId, appState?.awsAccessKeyId ?? saved.accessKeyId),
      secretAccessKey: resolveSecretOnSave(payload?.secretAccessKey, appState?.awsSecretAccessKey ?? saved.secretAccessKey),
      sessionToken: resolveSecretOnSave(payload?.sessionToken, appState?.awsSessionToken ?? saved.sessionToken)
    });
  });

  // Settings AWS profile dropdown Refresh: names only, never values.
  ipcMain.handle('list-aws-profiles', async () => listAwsProfiles());

  // Settings "Create / update vocabulary" (Amazon Transcribe custom words).
  // Uses the auth values currently in the form (falling back to saved state),
  // polls until READY/FAILED, and persists the vocabulary name on success.
  ipcMain.handle('transcribe-vocabulary-save', async (_event, payload = {}) => {
    try {
      const appState = typeof getAppState === 'function' ? getAppState() : null;
      const auth = resolveAwsAuth({
        awsAuthMode: payload?.awsAuthMode ?? appState?.awsAuthMode,
        awsProfile: payload?.awsProfile ?? appState?.awsProfile,
        awsAccessKeyId: resolveSecretOnSave(payload?.awsAccessKeyId, appState?.awsAccessKeyId),
        awsSecretAccessKey: resolveSecretOnSave(payload?.awsSecretAccessKey, appState?.awsSecretAccessKey),
        awsSessionToken: resolveSecretOnSave(payload?.awsSessionToken, appState?.awsSessionToken),
        bedrockApiKey: appState?.bedrockApiKey
      }, { purpose: 'transcribe' });
      if (auth.error) {
        return { success: false, error: auth.error };
      }

      const region = resolveTranscribeRegion(payload?.region ?? appState?.transcribeRegion);
      const clientConfig = { region };
      if (auth.credentials) {
        clientConfig.credentials = auth.credentials;
      }
      const client = createTranscribeClient(clientConfig);

      const result = await createOrUpdateVocabulary({
        client,
        language: payload?.language,
        phrasesText: payload?.phrasesText
      });
      if (!result.success) {
        return result;
      }

      const updatedAppState = saveAppState(app, { transcribeVocabularyName: result.vocabularyName });
      setAppState(updatedAppState);
      console.log('Saved Transcribe custom vocabulary name:', result.vocabularyName);
      return { success: true, vocabularyName: result.vocabularyName, state: result.state };
    } catch (error) {
      console.error('Error saving Transcribe vocabulary:', error?.message);
      return { success: false, error: error?.message || 'Vocabulary save failed.' };
    }
  });

  ipcMain.handle('set-theme-preference', (_event, payload = {}) => {
    try {
      const requestedTheme = typeof payload === 'string'
        ? payload
        : payload?.theme;
      const normalizedTheme = String(requestedTheme || '').trim().toLowerCase();
      const themePreference = normalizedTheme === 'dark' ? 'dark' : 'light';

      const updatedAppState = saveAppState(app, { themePreference });
      setAppState(updatedAppState);

      return { success: true, themePreference };
    } catch (error) {
      console.error('Error saving theme preference:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('save-settings', async (_event, settings = {}) => {
    console.log('IPC: save-settings called');

    try {
      const appEnvironment = getAppEnvironment();
      // Secret fields arrive masked (get-settings never sends cleartext); a
      // blank or still-masked field means "keep the stored value".
      const storedState = typeof getAppState === 'function' ? (getAppState() || {}) : {};
      const nextAiProvider = geminiRuntime.setActiveAiProvider(settings.aiProvider);
      const nextGeminiApiKey = resolveSecretListOnSave(settings.geminiApiKey, storedState.geminiApiKey);
      const nextAssemblyAiApiKey = resolveSecretOnSave(settings.assemblyAiApiKey, storedState.assemblyAiApiKey);
      const nextGeminiModel = geminiRuntime.setActiveGeminiModel(settings.geminiModel);
      const nextOllamaBaseUrl = geminiRuntime.setActiveOllamaBaseUrl(settings.ollamaBaseUrl);
      const nextOllamaModel = geminiRuntime.setActiveOllamaModel(settings.ollamaModel);
      const nextOpenai = geminiRuntime.setProviderSettings('openai', {
        apiKey: resolveSecretOnSave(settings.openaiApiKey, storedState.openaiApiKey),
        modelName: settings.openaiModel
      });
      const nextAnthropic = geminiRuntime.setProviderSettings('anthropic', {
        apiKey: resolveSecretOnSave(settings.anthropicApiKey, storedState.anthropicApiKey),
        modelName: settings.anthropicModel
      });
      const nextAwsAuthMode = resolveAwsAuthMode(settings.awsAuthMode);
      const nextBedrock = geminiRuntime.setProviderSettings('bedrock', {
        region: settings.bedrockRegion,
        authMode: nextAwsAuthMode,
        profile: settings.awsProfile,
        accessKeyId: resolveSecretOnSave(settings.awsAccessKeyId, storedState.awsAccessKeyId),
        secretAccessKey: resolveSecretOnSave(settings.awsSecretAccessKey, storedState.awsSecretAccessKey),
        sessionToken: resolveSecretOnSave(settings.awsSessionToken, storedState.awsSessionToken),
        apiKey: resolveSecretOnSave(settings.bedrockApiKey, storedState.bedrockApiKey),
        modelId: settings.bedrockModelId
      });
      const nextProviderFallback = (Array.isArray(settings.providerFallback) ? settings.providerFallback : [])
        .map((name) => String(name || '').trim().toLowerCase())
        .filter((name, index, list) => geminiRuntime.getAiProviders().includes(name) && list.indexOf(name) === index);
      geminiRuntime.setProviderFallback(nextProviderFallback);
      const nextAssemblyModel = setAssemblyAiSpeechModel(settings.assemblyAiSpeechModel);
      const nextProgrammingLanguage = geminiRuntime.setActiveProgrammingLanguage(settings.programmingLanguage);
      const nextWindowOpacityLevel = windowController.setWindowOpacityLevel(settings.windowOpacityLevel);

      const keyState = geminiRuntime.setKeys(nextGeminiApiKey, 0);
      // Capture/startup toggles persist in app state — never in a bundled
      // .env (packaged builds mount process.resourcesPath read-only, so
      // writing .env there fails on AppImage and would ship keys if bundled).
      const updatedAppState = saveAppState(app, {
        aiProvider: nextAiProvider,
        geminiApiKey: nextGeminiApiKey,
        assemblyAiApiKey: nextAssemblyAiApiKey,
        geminiApiKeyIndex: keyState.activeApiKeyIndex,
        geminiModel: nextGeminiModel,
        openaiApiKey: nextOpenai.apiKey || null,
        openaiModel: nextOpenai.modelName || null,
        anthropicApiKey: nextAnthropic.apiKey || null,
        anthropicModel: nextAnthropic.modelName || null,
        bedrockRegion: nextBedrock.region || null,
        // Legacy Bedrock key fields: superseded by the shared AWS auth state,
        // cleared here so the one-time migration cannot resurrect them.
        bedrockAccessKeyId: null,
        bedrockSecretAccessKey: null,
        bedrockModelId: nextBedrock.modelId || null,
        awsAuthMode: nextAwsAuthMode,
        awsProfile: nextBedrock.profile || null,
        awsAccessKeyId: nextBedrock.accessKeyId || null,
        awsSecretAccessKey: nextBedrock.secretAccessKey || null,
        awsSessionToken: nextBedrock.sessionToken || null,
        bedrockApiKey: nextBedrock.apiKey || null,
        sttProvider: resolveSttProvider(settings.sttProvider),
        transcribeRegion: String(settings.transcribeRegion || '').trim() || null,
        transcribeLanguage: resolveTranscribeLanguage(settings.transcribeLanguage),
        transcribeVocabularyName: String(settings.transcribeVocabularyName || '').trim() || null,
        providerFallback: nextProviderFallback,
        ollamaBaseUrl: nextOllamaBaseUrl,
        ollamaModel: nextOllamaModel,
        assemblyAiSpeechModel: nextAssemblyModel,
        programmingLanguage: nextProgrammingLanguage,
        windowOpacityLevel: nextWindowOpacityLevel,
        hideFromScreenCapture: appEnvironment.hideFromScreenCapture,
        startHidden: appEnvironment.startHidden,
        maxScreenshots: appEnvironment.maxScreenshots,
        screenshotDelay: appEnvironment.screenshotDelay
      });

      setAppState(updatedAppState);

      console.log('Saved app state to:', getAppStatePath(app));
      console.log('Applied AI provider:', nextAiProvider);
      console.log('Applied programming language:', nextProgrammingLanguage);
      console.log(`Applied window opacity level: ${nextWindowOpacityLevel}/10`);

      if (nextAiProvider === 'gemini') {
        console.log(`Applied Gemini API key index: ${keyState.activeApiKeyIndex + 1}/${keyState.geminiApiKeys.length}`);
        geminiRuntime.initializeGeminiService(
          keyState.activeApiKey,
          nextGeminiModel,
          nextProgrammingLanguage
        );
      } else {
        console.log(`Applied ${nextAiProvider} provider`);
        geminiRuntime.initializeAiService();
      }

      return { success: true };
    } catch (error) {
      console.error('Error saving settings:', error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = {
  registerSettingsIpc
};
