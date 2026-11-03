const {
  getAiProviderLabel,
  getOpenAIModels,
  getAnthropicModels,
  getBedrockModels,
  getDefaultBedrockRegion
} = require('../../../config');

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
  defaultAssemblyAiSpeechModel
}) {
  ipcMain.handle('get-settings', () => {
    const appEnvironment = getAppEnvironment();
    const appState = getAppState();
    const geminiApiKey = typeof appState?.geminiApiKey === 'string' ? appState.geminiApiKey : '';
    const assemblyAiApiKey = typeof appState?.assemblyAiApiKey === 'string' ? appState.assemblyAiApiKey : '';

    return {
      aiProvider: geminiRuntime.getActiveAiProvider(),
      geminiApiKey,
      assemblyAiApiKey,
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
      openaiApiKey: geminiRuntime.getProviderSettings('openai').apiKey,
      openaiModel: geminiRuntime.getProviderSettings('openai').modelName,
      openaiModels: getOpenAIModels(),
      anthropicApiKey: geminiRuntime.getProviderSettings('anthropic').apiKey,
      anthropicModel: geminiRuntime.getProviderSettings('anthropic').modelName,
      anthropicModels: getAnthropicModels(),
      bedrockRegion: geminiRuntime.getProviderSettings('bedrock').region,
      bedrockAccessKeyId: geminiRuntime.getProviderSettings('bedrock').accessKeyId,
      bedrockSecretAccessKey: geminiRuntime.getProviderSettings('bedrock').secretAccessKey,
      bedrockModelId: geminiRuntime.getProviderSettings('bedrock').modelId,
      bedrockModels: getBedrockModels(),
      defaultBedrockRegion: getDefaultBedrockRegion(),
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
      themePreference: appState?.themePreference === 'dark' || appState?.themePreference === 'light'
        ? appState.themePreference
        : null
    };
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
      const nextAiProvider = geminiRuntime.setActiveAiProvider(settings.aiProvider);
      const nextGeminiApiKey = String(settings.geminiApiKey || '').trim();
      const nextAssemblyAiApiKey = String(settings.assemblyAiApiKey || '').trim();
      const nextGeminiModel = geminiRuntime.setActiveGeminiModel(settings.geminiModel);
      const nextOllamaBaseUrl = geminiRuntime.setActiveOllamaBaseUrl(settings.ollamaBaseUrl);
      const nextOllamaModel = geminiRuntime.setActiveOllamaModel(settings.ollamaModel);
      const nextOpenai = geminiRuntime.setProviderSettings('openai', {
        apiKey: settings.openaiApiKey,
        modelName: settings.openaiModel
      });
      const nextAnthropic = geminiRuntime.setProviderSettings('anthropic', {
        apiKey: settings.anthropicApiKey,
        modelName: settings.anthropicModel
      });
      const nextBedrock = geminiRuntime.setProviderSettings('bedrock', {
        region: settings.bedrockRegion,
        accessKeyId: settings.bedrockAccessKeyId,
        secretAccessKey: settings.bedrockSecretAccessKey,
        modelId: settings.bedrockModelId
      });
      const nextProviderFallback = (Array.isArray(settings.providerFallback) ? settings.providerFallback : [])
        .map((name) => String(name || '').trim().toLowerCase())
        .filter((name, index, list) => geminiRuntime.getAiProviders().includes(name) && list.indexOf(name) === index);
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
        bedrockAccessKeyId: nextBedrock.accessKeyId || null,
        bedrockSecretAccessKey: nextBedrock.secretAccessKey || null,
        bedrockModelId: nextBedrock.modelId || null,
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
