const {
  app,
  dialog,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  screen
} = require('electron');
const WebSocket = require('ws');

const {
  loadApplicationEnvironment,
  normalizeGeminiApiKeys
} = require('../bootstrap/environment');
const {
  getAssemblyAiSpeechModels,
  getDefaultAssemblyAiSpeechModel,
  getKeyboardShortcuts,
  resolveAssemblyAiSpeechModel
} = require('../config');
const {
  getAppStatePath,
  loadAppState,
  saveAppState
} = require('../services/state/app-state');
const { createAssistantWindow } = require('../windows/assistant/window');
const { createSafeSender } = require('./shared/safe-send');
const { createGeminiRuntime } = require('./features/assistant/gemini-runtime');
const { createScreenshotManager } = require('./features/assistant/screenshot-manager');
const { registerAssistantIpc } = require('./features/assistant/ipc');
const { createAssemblyAiService } = require('../services/assembly-ai/service');
const { createOcrService } = require('../services/ocr/service');
const { registerAssemblyAiIpc } = require('../services/assembly-ai/ipc');
const { createLinuxMonitorCapture } = require('../services/assembly-ai/linux-monitor-capture');
const { registerSettingsIpc } = require('./features/settings/ipc');
const { createWindowController } = require('./features/window/window-controller');
const { parseShortcutActionArg } = require('./shared/shortcut-actions');
const { getActionSocketPath, startActionSocketServer } = require('./shared/action-socket');
const { DEFAULT_WINDOW_OPACITY_LEVEL } = require('./features/window/window-constants');
const { logStartupConfiguration, warnLinuxContentProtectionOnce } = require('./startup-logging');
const { createMobileServer } = require('./features/mobile-server/server');

function resolveStartupOptions(argv = process.argv) {
  const normalizedArgs = Array.isArray(argv)
    ? argv.map((value) => String(value || '').trim().toLowerCase())
    : [];

  const hasFlag = (flag) => normalizedArgs.includes(flag);

  return {
    startHidden: hasFlag('--start-hidden') || hasFlag('--background')
  };
}

async function startApplication() {
  // Single instance: a launch with `--action=<shortcutId>` (e.g. from a GNOME
  // custom keybinding on Wayland, where global shortcuts cannot fire while a
  // native Wayland window is focused) is forwarded to the already-running
  // instance via 'second-instance'; this second instance exits immediately.
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  let appEnvironment = null;
  let appState = null;
  let isShuttingDown = false;
  const startupOptions = resolveStartupOptions();

  const geminiRuntime = createGeminiRuntime();

  const assemblyAiSpeechModels = getAssemblyAiSpeechModels();
  const defaultAssemblyAiSpeechModel = getDefaultAssemblyAiSpeechModel();
  const keyboardShortcuts = getKeyboardShortcuts();
  let activeAssemblyAiSpeechModel = defaultAssemblyAiSpeechModel;

  let screenshotManager = null;
  let windowController = null;
  const ocrService = createOcrService();

  const baseSendToRenderer = createSafeSender(() => {
    if (!windowController) {
      return null;
    }

    return windowController.getMainWindow();
  });

  // Mobile server reports its own status (listening, URLs, client count) to
  // the desktop renderer via the un-augmented sender — we don't want it
  // bouncing back to mobile clients.
  const mobileServer = createMobileServer({
    getGeminiRuntime:    () => geminiRuntime,
    getScreenshotManager: () => screenshotManager,
    notifyDesktop:        baseSendToRenderer
  });

  // Augmented sender: events flow to both the Electron renderer and all
  // connected mobile WebSocket clients simultaneously.
  const sendToRenderer = (channel, data) => {
    baseSendToRenderer(channel, data);
    mobileServer.broadcast(channel, data);
  };

  const linuxMonitorCapture = createLinuxMonitorCapture();
  const assemblyAiService = createAssemblyAiService({
    WebSocket,
    desktopCapturer,
    getAssemblyApiKey: () => appState?.assemblyAiApiKey || '',
    getSpeechModel: () => activeAssemblyAiSpeechModel,
    getGeminiService: () => geminiRuntime.getService(),
    sendToRenderer
  });

  windowController = createWindowController({
    app,
    screen,
    globalShortcut,
    createAssistantWindow,
    getAppEnvironment: () => appEnvironment,
    emitSttDebug: assemblyAiService.emitSttDebug,
    sendToRenderer,
    onTakeStealthScreenshot: async () => {
      if (screenshotManager) {
        await screenshotManager.takeStealthScreenshot();
      }
    }
  });

  screenshotManager = createScreenshotManager({
    app,
    getMainWindow: () => windowController.getMainWindow(),
    getAppEnvironment: () => appEnvironment,
    sendToRenderer
  });

  // A second instance launched with `--action=<shortcutId>` runs the same
  // handler its globalShortcut registration uses. A first launch carrying
  // `--action` simply starts normally and ignores it (nothing reads it here).
  app.on('second-instance', (_event, secondInstanceArgv) => {
    const actionId = parseShortcutActionArg(secondInstanceArgv);
    if (actionId && windowController) {
      windowController.runShortcutAction(actionId);
    }
  });

  // Linux fast path for GNOME custom keybindings: a private Unix socket in
  // userData that accepts a shortcut action id (see shared/action-socket.js).
  let actionSocket = null;
  if (process.platform === 'linux') {
    app.whenReady().then(async () => {
      try {
        const knownActions = new Set(windowController.getShortcutActionIds());
        actionSocket = await startActionSocketServer({
          socketPath: getActionSocketPath(app.getPath('userData')),
          isKnownAction: (id) => knownActions.has(id),
          onAction: (id) => windowController.runShortcutAction(id)
        });
      } catch (error) {
        console.warn('[ActionSocket] Fast shortcut path unavailable:', error && error.message);
      }
    });
    app.on('will-quit', () => {
      if (actionSocket) {
        actionSocket.close();
        actionSocket = null;
      }
    });
  }

  function loadPersistedAppState() {
    appState = loadAppState(app);

    const activeAiProvider = geminiRuntime.setActiveAiProvider(appState.aiProvider);
    const keyState = geminiRuntime.setKeys(
      normalizeGeminiApiKeys(appState?.geminiApiKey),
      appState.geminiApiKeyIndex
    );
    const activeGeminiModel = geminiRuntime.setActiveGeminiModel(appState.geminiModel);
    const activeOllamaBaseUrl = geminiRuntime.setActiveOllamaBaseUrl(appState.ollamaBaseUrl);
    const activeOllamaModel = geminiRuntime.setActiveOllamaModel(appState.ollamaModel);
    geminiRuntime.setProviderFallback(appState.providerFallback);
    geminiRuntime.setProviderSettings('openai', {
      apiKey: appState.openaiApiKey,
      modelName: appState.openaiModel
    });
    geminiRuntime.setProviderSettings('anthropic', {
      apiKey: appState.anthropicApiKey,
      modelName: appState.anthropicModel
    });
    geminiRuntime.setProviderSettings('bedrock', {
      region: appState.bedrockRegion,
      accessKeyId: appState.bedrockAccessKeyId,
      secretAccessKey: appState.bedrockSecretAccessKey,
      modelId: appState.bedrockModelId
    });
    activeAssemblyAiSpeechModel = resolveAssemblyAiSpeechModel(appState.assemblyAiSpeechModel);
    const activeProgrammingLanguage = geminiRuntime.setActiveProgrammingLanguage(appState.programmingLanguage);
    const activeWindowOpacityLevel = windowController.setWindowOpacityLevel(appState.windowOpacityLevel);

    if (
      appState.aiProvider !== activeAiProvider ||
      appState.geminiApiKeyIndex !== keyState.activeApiKeyIndex ||
      appState.geminiModel !== activeGeminiModel ||
      appState.ollamaBaseUrl !== activeOllamaBaseUrl ||
      appState.ollamaModel !== activeOllamaModel ||
      appState.assemblyAiSpeechModel !== activeAssemblyAiSpeechModel ||
      appState.programmingLanguage !== activeProgrammingLanguage ||
      appState.windowOpacityLevel !== activeWindowOpacityLevel
    ) {
      appState = saveAppState(app, {
        aiProvider: activeAiProvider,
        geminiApiKeyIndex: keyState.activeApiKeyIndex,
        geminiModel: activeGeminiModel,
        ollamaBaseUrl: activeOllamaBaseUrl,
        ollamaModel: activeOllamaModel,
        assemblyAiSpeechModel: activeAssemblyAiSpeechModel,
        programmingLanguage: activeProgrammingLanguage,
        windowOpacityLevel: activeWindowOpacityLevel
      });
    }

    // Capture/startup toggles: on first run seed app state from .env /
    // built-in defaults, then let app state own the values. Packaged builds
    // cannot write into process.resourcesPath, so .env is dev-only from here on.
    const captureStartupSeed = {};
    for (const key of ['hideFromScreenCapture', 'startHidden', 'maxScreenshots', 'screenshotDelay']) {
      if (appState[key] == null) {
        captureStartupSeed[key] = appEnvironment[key];
      }
    }
    if (Object.keys(captureStartupSeed).length > 0) {
      appState = saveAppState(app, captureStartupSeed);
      console.log('Migrated capture/startup settings from environment into app state:', Object.keys(captureStartupSeed).join(', '));
    }

    appEnvironment = {
      ...appEnvironment,
      hideFromScreenCapture: appState.hideFromScreenCapture,
      startHidden: appState.startHidden,
      maxScreenshots: appState.maxScreenshots,
      screenshotDelay: appState.screenshotDelay
    };
    process.env.HIDE_FROM_SCREEN_CAPTURE = String(appEnvironment.hideFromScreenCapture);
    process.env.START_HIDDEN = String(appEnvironment.startHidden);
    process.env.MAX_SCREENSHOTS = String(appEnvironment.maxScreenshots);
    process.env.SCREENSHOT_DELAY = String(appEnvironment.screenshotDelay);

    console.log('Loaded app state from:', getAppStatePath(app));
    console.log('Restored AI provider from app state:', activeAiProvider);
    console.log('Restored capture/startup settings from app state:', {
      hideFromScreenCapture: appEnvironment.hideFromScreenCapture,
      startHidden: appEnvironment.startHidden,
      maxScreenshots: appEnvironment.maxScreenshots,
      screenshotDelay: appEnvironment.screenshotDelay
    });
    console.log(`Restored Gemini API key index from app state: ${keyState.activeApiKeyIndex + 1}/${keyState.geminiApiKeys.length}`);
    console.log('Restored Gemini model from app state:', activeGeminiModel);
    console.log('Restored Ollama config from app state:', activeOllamaModel, 'at', activeOllamaBaseUrl);
    console.log('Restored AssemblyAI speech model from app state:', activeAssemblyAiSpeechModel);
    console.log('Restored programming language from app state:', activeProgrammingLanguage);
    console.log(`Restored window opacity level from app state: ${activeWindowOpacityLevel}/10`);
  }

  function cleanupTransientResources() {
    // dispose() resolves only once every owned pw-record child actually exited
    // (SIGTERM escalated to SIGKILL after its grace period), so quit can wait
    // for it instead of exiting under a child that ignored SIGTERM.
    const captureDisposed = Promise.resolve(linuxMonitorCapture.dispose());
    assemblyAiService.dispose();
    screenshotManager.cleanupTransientResources();
    ocrService.dispose().catch((error) => {
      console.error('Failed to dispose OCR worker:', error);
    });
    windowController.unregisterShortcuts();
    mobileServer.close();
    return captureDisposed;
  }

  function quitApplication() {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;

    const captureDisposed = cleanupTransientResources();
    windowController.destroyWindow();

    // Exit only after the capture child is really gone (its SIGKILL escalation
    // is ~1.5 s); the hard cap keeps a wedged child from hanging quit forever.
    const forceExitTimer = setTimeout(() => app.exit(0), 5000);
    forceExitTimer.unref?.();
    Promise.resolve(captureDisposed).then(() => {
      clearTimeout(forceExitTimer);
      app.exit(0);
    });
  }

  ipcMain.handle('mobile-server-get-status', () => mobileServer.getStatus());

  registerAssistantIpc({
    ipcMain,
    screenshotManager,
    ocrService,
    windowController,
    geminiRuntime,
    assemblyAiService,
    sendToRenderer,
    quitApplication
  });

  registerAssemblyAiIpc({
    ipcMain,
    assemblyAiService,
    linuxMonitorCapture,
    sendToRenderer
  });

  registerSettingsIpc({
    ipcMain,
    app,
    getAppEnvironment: () => appEnvironment,
    getAppState: () => appState,
    setAppState: (nextAppState) => {
      appState = nextAppState;
    },
    getAppStatePath,
    saveAppState,
    geminiRuntime,
    windowController,
    getAssemblyAiSpeechModel: () => activeAssemblyAiSpeechModel,
    setAssemblyAiSpeechModel: (nextModel) => {
      activeAssemblyAiSpeechModel = resolveAssemblyAiSpeechModel(nextModel, activeAssemblyAiSpeechModel);
      return activeAssemblyAiSpeechModel;
    },
    keyboardShortcuts,
    assemblyAiSpeechModels,
    defaultAssemblyAiSpeechModel
  });

  app.whenReady().then(() => {
    try {
      appEnvironment = loadApplicationEnvironment(app);
    } catch (error) {
      console.error('Failed to load application environment:', error);
      dialog.showErrorBox('Open-Cluely Configuration Error', error.message);
      app.exit(1);
      return;
    }

    loadPersistedAppState();

    logStartupConfiguration({
      appEnvironment,
      appState,
      geminiModels: geminiRuntime.getGeminiModels(),
      defaultGeminiModel: geminiRuntime.getDefaultGeminiModel(),
      assemblyAiSpeechModels,
      defaultAssemblyAiSpeechModel,
      programmingLanguages: geminiRuntime.getProgrammingLanguages(),
      defaultProgrammingLanguage: geminiRuntime.getDefaultProgrammingLanguage()
    });

    // Electron only implements setContentProtection on Windows and macOS;
    // on Linux the assistant window stays visible in screen shares and
    // recordings even when HIDE_FROM_SCREEN_CAPTURE is enabled.
    warnLinuxContentProtectionOnce();

    geminiRuntime.setActiveKeyIndexChangeHandler((nextIndex) => {
      if (!appState || appState.geminiApiKeyIndex === nextIndex) {
        return;
      }

      appState = saveAppState(app, { geminiApiKeyIndex: nextIndex });
      console.log(`Persisted Gemini API key index: ${nextIndex + 1}/${geminiRuntime.getApiKeys().length}`);
    });

    geminiRuntime.initializeAiService();

    app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder');
    app.commandLine.appendSwitch('ignore-certificate-errors');
    app.commandLine.appendSwitch('allow-running-insecure-content');
    app.commandLine.appendSwitch('disable-web-security');
    app.commandLine.appendSwitch('enable-media-stream');

    const launchHidden = startupOptions.startHidden || appEnvironment.startHidden;
    console.log('App is ready, creating window...');
    console.log(`Startup mode: ${launchHidden ? 'hidden' : 'visible'}`);
    windowController.createWindow({ launchHidden });
    windowController.registerShortcuts();

    if (!launchHidden) {
      windowController.markVisible();
    }

    if (appState?.windowOpacityLevel == null) {
      windowController.setWindowOpacityLevel(DEFAULT_WINDOW_OPACITY_LEVEL);
    }

    console.log(`Window setup complete (${launchHidden ? 'hidden launch' : 'visible launch'})`);
  });

  app.on('window-all-closed', () => {
    // Keep running in background for stealth operation
  });

  app.on('activate', () => {
    if (!windowController.hasWindow()) {
      windowController.createWindow();
      windowController.markVisible();
    }
  });

  app.on('will-quit', () => {
    cleanupTransientResources();
  });

  app.on('web-contents-created', (_event, contents) => {
    contents.on('new-window', (event) => {
      event.preventDefault();
    });

    contents.on('will-navigate', (event, navigationUrl) => {
      const mainWindow = windowController.getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }

      if (navigationUrl !== mainWindow.webContents.getURL()) {
        event.preventDefault();
      }
    });
  });

}

module.exports = {
  startApplication
};
