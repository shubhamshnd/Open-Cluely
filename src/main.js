const { app, dialog, desktopCapturer, globalShortcut, ipcMain, screen } = require('electron');
const WebSocket = require('ws');

const fs = require('fs');
const path = require('path');
const screenshot = require('screenshot-desktop');
const {
  loadApplicationEnvironment,
  saveApplicationEnvironment
} = require('./bootstrap/environment');
const {
  getAssemblyAiSpeechModels,
  getDefaultAssemblyAiSpeechModel,
  getGeminiModels,
  getDefaultGeminiModel,
  getDefaultProgrammingLanguage,
  getProgrammingLanguages,
  resolveAssemblyAiSpeechModel,
  resolveGeminiModel,
  resolveProgrammingLanguage
} = require('./config');
const GeminiService = require('./services/ai/gemini-service');
const { getAppStatePath, loadAppState, saveAppState } = require('./services/state/app-state');
const { createAssistantWindow } = require('./windows/assistant/window');

(async () => {

let mainWindow;
let screenshots = [];
let chatContext = [];
const WINDOW_DEFAULT_WIDTH = 900;
const WINDOW_DEFAULT_HEIGHT = 400;
const WINDOW_MIN_WIDTH = 600;
const WINDOW_MIN_HEIGHT = 250;
const WINDOW_OPACITY_LEVEL_MIN = 1;
const WINDOW_OPACITY_LEVEL_MAX = 10;
const DEFAULT_WINDOW_OPACITY_LEVEL = 10;
const STEALTH_OPACITY_LEVEL_DELTA = 4;
const GEMINI_MODELS = getGeminiModels();
const DEFAULT_GEMINI_MODEL = getDefaultGeminiModel();
const ASSEMBLY_AI_SPEECH_MODELS = getAssemblyAiSpeechModels();
const DEFAULT_ASSEMBLY_AI_SPEECH_MODEL = getDefaultAssemblyAiSpeechModel();
const PROGRAMMING_LANGUAGES = getProgrammingLanguages();
const DEFAULT_PROGRAMMING_LANGUAGE = getDefaultProgrammingLanguage();

// AssemblyAI streaming transcription — one WebSocket per audio source
let assemblyWsMic = null;
let assemblyWsSystem = null;
let isStreamingMic = false;
let isStreamingSystem = false;
const ASSEMBLY_AI_SAMPLE_RATE = 16000;

// Initialize Gemini Service with rate limiting
let geminiService = null;
let activeGeminiModel = DEFAULT_GEMINI_MODEL;
let activeAssemblyAiSpeechModel = DEFAULT_ASSEMBLY_AI_SPEECH_MODEL;
let activeProgrammingLanguage = DEFAULT_PROGRAMMING_LANGUAGE;
let activeWindowOpacityLevel = DEFAULT_WINDOW_OPACITY_LEVEL;
let appState = null;
let appEnvironment = null;
let isShuttingDown = false;
let isVisible = true;
let autoHideTimer = null;
const sttChunkCounters = { mic: 0, system: 0 };
const sttDroppedChunkCounters = { mic: 0, system: 0 };
let isRecoveryReloadInProgress = false;
let lastRecoveryReloadAt = 0;
const RECOVERY_RELOAD_COOLDOWN_MS = 5000;

function initializeGeminiService(
  apiKey,
  modelName = activeGeminiModel,
  programmingLanguage = activeProgrammingLanguage
) {
  activeGeminiModel = resolveGeminiModel(modelName);
  activeProgrammingLanguage = resolveProgrammingLanguage(programmingLanguage);

  try {
    if (!apiKey) {
      console.error('GEMINI_API_KEY not found in environment variables');
      geminiService = null;
      return;
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
  } catch (error) {
    geminiService = null;
    console.error('Failed to initialize Gemini AI Service:', error);
  }
}

function loadPersistedAppState() {
  appState = loadAppState(app);
  activeGeminiModel = resolveGeminiModel(appState.geminiModel);
  activeAssemblyAiSpeechModel = resolveAssemblyAiSpeechModel(appState.assemblyAiSpeechModel);
  activeProgrammingLanguage = resolveProgrammingLanguage(appState.programmingLanguage);
  activeWindowOpacityLevel = clampWindowOpacityLevel(appState.windowOpacityLevel);

  if (
    appState.geminiModel !== activeGeminiModel ||
    appState.assemblyAiSpeechModel !== activeAssemblyAiSpeechModel ||
    appState.programmingLanguage !== activeProgrammingLanguage ||
    appState.windowOpacityLevel !== activeWindowOpacityLevel
  ) {
    appState = saveAppState(app, {
      geminiModel: activeGeminiModel,
      assemblyAiSpeechModel: activeAssemblyAiSpeechModel,
      programmingLanguage: activeProgrammingLanguage,
      windowOpacityLevel: activeWindowOpacityLevel
    });
  }

  console.log('Loaded app state from:', getAppStatePath(app));
  console.log('Restored Gemini model from app state:', activeGeminiModel);
  console.log('Restored AssemblyAI speech model from app state:', activeAssemblyAiSpeechModel);
  console.log('Restored programming language from app state:', activeProgrammingLanguage);
  console.log(`Restored window opacity level from app state: ${activeWindowOpacityLevel}/10`);
}

function logStartupConfiguration() {
  console.log('Loaded .env from:', appEnvironment.envPath);
  console.log('Startup configuration:');
  console.log(`  GEMINI_API_KEY: ${appEnvironment.geminiApiKey ? 'present' : 'missing'}`);
  console.log(`  ASSEMBLY_AI_API_KEY: ${appEnvironment.assemblyAiApiKey ? 'present' : 'missing'}`);
  console.log(`  HIDE_FROM_SCREEN_CAPTURE: ${appEnvironment.hideFromScreenCapture}`);
  console.log(`  MAX_SCREENSHOTS: ${appEnvironment.maxScreenshots}`);
  console.log(`  SCREENSHOT_DELAY: ${appEnvironment.screenshotDelay}`);
  console.log(`  NODE_ENV: ${appEnvironment.nodeEnv}`);
  console.log(`  NODE_OPTIONS: ${appEnvironment.nodeOptions}`);
  console.log(`  Default Gemini model: ${DEFAULT_GEMINI_MODEL}`);
  console.log(`  Gemini models: ${GEMINI_MODELS.join(', ')}`);
  console.log(`  Default AssemblyAI speech model: ${DEFAULT_ASSEMBLY_AI_SPEECH_MODEL}`);
  console.log(`  AssemblyAI speech models: ${ASSEMBLY_AI_SPEECH_MODELS.join(', ')}`);
  console.log(`  Default programming language: ${DEFAULT_PROGRAMMING_LANGUAGE}`);
  console.log(`  Programming languages: ${PROGRAMMING_LANGUAGES.join(', ')}`);
}

function cleanupAssemblyWs(ws) {
  if (!ws) return;
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'Terminate' }));
    }
    ws.terminate();
  } catch (error) {
    console.error('Error cleaning up AssemblyAI WebSocket:', error);
  }
}

function cleanupTransientResources() {
  cleanupAssemblyWs(assemblyWsMic);
  assemblyWsMic = null;
  cleanupAssemblyWs(assemblyWsSystem);
  assemblyWsSystem = null;
  isStreamingMic = false;
  isStreamingSystem = false;
  sttChunkCounters.mic = 0;
  sttChunkCounters.system = 0;
  sttDroppedChunkCounters.mic = 0;
  sttDroppedChunkCounters.system = 0;
  globalShortcut.unregisterAll();

  screenshots.forEach((screenshotPath) => {
    if (fs.existsSync(screenshotPath)) {
      fs.unlinkSync(screenshotPath);
    }
  });

  screenshots = [];
}

function quitApplication() {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  cleanupTransientResources();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setClosable(true);
    mainWindow.destroy();
  }

  setTimeout(() => {
    app.exit(0);
  }, 50);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function clampWindowOpacityLevel(level) {
  const parsedLevel = Number.parseInt(String(level ?? ''), 10);

  if (!Number.isFinite(parsedLevel)) {
    return DEFAULT_WINDOW_OPACITY_LEVEL;
  }

  return clamp(parsedLevel, WINDOW_OPACITY_LEVEL_MIN, WINDOW_OPACITY_LEVEL_MAX);
}

function getWindowOpacityFromLevel(level) {
  return clampWindowOpacityLevel(level) / 10;
}

function getVisibleWindowOpacity() {
  return getWindowOpacityFromLevel(activeWindowOpacityLevel);
}

function getStealthWindowOpacity() {
  return getWindowOpacityFromLevel(activeWindowOpacityLevel - STEALTH_OPACITY_LEVEL_DELTA);
}

function getCurrentWindowOpacity() {
  return isVisible ? getVisibleWindowOpacity() : getStealthWindowOpacity();
}

function applyWindowOpacity() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.setOpacity(getCurrentWindowOpacity());
}

function recoverMainWindowVisibility(reason, { reload = false } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  console.warn(`Window recovery triggered: ${reason}`);
  emitSttDebug({
    level: 'error',
    event: 'window-recovery',
    message: reason
  });

  try {
    if (autoHideTimer) {
      clearTimeout(autoHideTimer);
      autoHideTimer = null;
    }

    isVisible = true;
    mainWindow.setOpacity(getVisibleWindowOpacity());
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    sendToRenderer('set-stealth-mode', false);
  } catch (error) {
    console.error('Window visibility recovery failed:', error);
  }

  if (!reload || !mainWindow.webContents || mainWindow.webContents.isDestroyed()) {
    return;
  }

  const now = Date.now();
  if (isRecoveryReloadInProgress || now - lastRecoveryReloadAt < RECOVERY_RELOAD_COOLDOWN_MS) {
    return;
  }

  isRecoveryReloadInProgress = true;
  lastRecoveryReloadAt = now;
  try {
    mainWindow.webContents.reload();
    emitSttDebug({
      event: 'window-reload',
      message: 'Triggered guarded renderer reload'
    });
  } catch (error) {
    console.error('Window recovery reload failed:', error);
    isRecoveryReloadInProgress = false;
    return;
  }

  setTimeout(() => {
    isRecoveryReloadInProgress = false;
  }, 1500);
}

function attachWindowRecoveryHandlers() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.on('unresponsive', () => {
    console.error('Main window became unresponsive');
    recoverMainWindowVisibility('window-unresponsive', { reload: true });
  });

  const contents = mainWindow.webContents;
  if (!contents || contents.isDestroyed()) {
    return;
  }

  contents.on('render-process-gone', (event, details) => {
    console.error('Renderer process gone:', details);
    recoverMainWindowVisibility('render-process-gone', { reload: true });
  });

  contents.on('unresponsive', () => {
    console.error('WebContents became unresponsive');
    recoverMainWindowVisibility('webcontents-unresponsive', { reload: true });
  });

  contents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error('WebContents did-fail-load:', {
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame
    });
    recoverMainWindowVisibility('did-fail-load', { reload: !!isMainFrame });
  });

  contents.on('did-finish-load', () => {
    isRecoveryReloadInProgress = false;
  });
}

function getSafeWindowBounds(nextBounds = {}) {
  const currentBounds = mainWindow ? mainWindow.getBounds() : {
    x: 0,
    y: 0,
    width: WINDOW_DEFAULT_WIDTH,
    height: WINDOW_DEFAULT_HEIGHT
  };

  const rawBounds = {
    x: Number.isFinite(nextBounds.x) ? Math.round(nextBounds.x) : currentBounds.x,
    y: Number.isFinite(nextBounds.y) ? Math.round(nextBounds.y) : currentBounds.y,
    width: Number.isFinite(nextBounds.width) ? Math.round(nextBounds.width) : currentBounds.width,
    height: Number.isFinite(nextBounds.height) ? Math.round(nextBounds.height) : currentBounds.height
  };

  const display = screen.getDisplayMatching(rawBounds);
  const workArea = display && display.workArea ? display.workArea : screen.getPrimaryDisplay().workArea;

  const width = clamp(rawBounds.width, WINDOW_MIN_WIDTH, workArea.width);
  const height = clamp(rawBounds.height, WINDOW_MIN_HEIGHT, workArea.height);
  const x = clamp(rawBounds.x, workArea.x, workArea.x + workArea.width - width);
  const y = clamp(rawBounds.y, workArea.y, workArea.y + workArea.height - height);

  return { x, y, width, height };
}

function createStealthWindow() {
  mainWindow = createAssistantWindow({
    app,
    screen,
    defaultWidth: WINDOW_DEFAULT_WIDTH,
    defaultHeight: WINDOW_DEFAULT_HEIGHT,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    hideFromScreenCapture: appEnvironment.hideFromScreenCapture,
    initialOpacity: getVisibleWindowOpacity(),
    nodeEnv: appEnvironment.nodeEnv
  });
  attachWindowRecoveryHandlers();
}

function registerStealthShortcuts() {
  globalShortcut.register('CommandOrControl+Alt+Shift+H', () => {
    toggleStealthMode();
  });

  globalShortcut.register('CommandOrControl+Alt+Shift+S', async () => {
    await takeStealthScreenshot();
  });

  globalShortcut.register('CommandOrControl+Alt+Shift+A', async () => {
    if (screenshots.length > 0) {
      await analyzeForMeeting();
    }
  });

  globalShortcut.register('CommandOrControl+Alt+Shift+X', () => {
    emergencyHide();
  });

  globalShortcut.register('CommandOrControl+Alt+Shift+V', () => {
    emitSttDebug({
      event: 'shortcut-toggle',
      message: 'Global transcription shortcut triggered'
    });
    sendToRenderer('toggle-voice-recognition');
  });

  globalShortcut.register('CommandOrControl+Alt+Shift+Left', () => {
    moveToPosition('left');
  });
  
  globalShortcut.register('CommandOrControl+Alt+Shift+Right', () => {
    moveToPosition('right');
  });
  
  globalShortcut.register('CommandOrControl+Alt+Shift+Up', () => {
    moveToPosition('top');
  });
  
  globalShortcut.register('CommandOrControl+Alt+Shift+Down', () => {
    moveToPosition('bottom');
  });
}

function toggleStealthMode() {
  if (autoHideTimer) {
    clearTimeout(autoHideTimer);
    autoHideTimer = null;
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const stealthModeEnabled = isVisible;
  isVisible = !stealthModeEnabled;
  applyWindowOpacity();
  sendToRenderer('set-stealth-mode', stealthModeEnabled);
}

function emergencyHide() {
  if (autoHideTimer) {
    clearTimeout(autoHideTimer);
    autoHideTimer = null;
  }

  mainWindow.setOpacity(0.01);
  sendToRenderer('emergency-clear');
  
  autoHideTimer = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      isVisible = true;
      applyWindowOpacity();
      sendToRenderer('set-stealth-mode', false);
    }
    autoHideTimer = null;
  }, 2000);
}

function moveToPosition(position) {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const windowBounds = mainWindow.getBounds();
  
  let x, y;
  
  switch (position) {
    case 'left':
      x = 20;
      y = windowBounds.y;
      break;
    case 'right':
      x = width - windowBounds.width - 20;
      y = windowBounds.y;
      break;
    case 'top':
      x = Math.floor((width - windowBounds.width) / 2);
      y = 40;
      break;
    case 'bottom':
      x = Math.floor((width - windowBounds.width) / 2);
      y = height - windowBounds.height - 40;
      break;
    default:
      return;
  }
  
  mainWindow.setPosition(x, y);
}

async function takeStealthScreenshot() {
  try {
    console.log('Taking stealth screenshot...');
    const currentOpacity = mainWindow.getOpacity();
    const screenshotDelay = appEnvironment?.screenshotDelay || 300;
    
    mainWindow.setOpacity(0.01);
    
    await new Promise(resolve => setTimeout(resolve, screenshotDelay));

    const screenshotsDir = app.isPackaged
      ? path.join(app.getPath('userData'), '.stealth_screenshots')
      : path.join(__dirname, '..', '.stealth_screenshots');

    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
    
    const screenshotPath = path.join(screenshotsDir, `stealth-${Date.now()}.png`);
    await screenshot({ filename: screenshotPath });
    
    screenshots.push(screenshotPath);
    if (screenshots.length > appEnvironment.maxScreenshots) {
      const oldPath = screenshots.shift();
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }
    
    mainWindow.setOpacity(currentOpacity);
    
    console.log(`Screenshot saved: ${screenshotPath}`);
    console.log(`Total screenshots: ${screenshots.length}`);
    
    sendToRenderer('screenshot-taken-stealth', screenshots.length);
    
    return screenshotPath;
  } catch (error) {
    mainWindow.setOpacity(1.0);
    console.error('Stealth screenshot error:', error);
    throw error;
  }
}

async function analyzeForMeetingWithContext(context = '') {
  console.log('Starting context-aware analysis...');
  console.log('Context length:', context.length);
  console.log('API Key exists:', !!appEnvironment.geminiApiKey);
  console.log('Model initialized:', !!(geminiService && geminiService.model));
  console.log('Programming language preference:', activeProgrammingLanguage);
  console.log('Screenshots count:', screenshots.length);

  if (!appEnvironment.geminiApiKey) {
    console.error('No GEMINI_API_KEY found');
    sendToRenderer('analysis-result', {
      error: 'No API key configured. Please add GEMINI_API_KEY to your .env file.'
    });
    return;
  }

  if (!geminiService || !geminiService.model) {
    console.error('Gemini model not initialized');
    sendToRenderer('analysis-result', {
      error: 'AI model not initialized. Please check your API key.'
    });
    return;
  }

  if (screenshots.length === 0) {
    console.error('No screenshots to analyze');
    sendToRenderer('analysis-result', {
      error: 'No screenshots to analyze. Take a screenshot first.'
    });
    return;
  }

  try {
    console.log('Sending analysis start signal...');
    sendToRenderer('analysis-start');
    
    console.log('Processing screenshots...');
    const imageParts = await Promise.all(
      screenshots.map(async (path) => {
        console.log(`Processing screenshot: ${path}`);
        
        if (!fs.existsSync(path)) {
          console.error(`Screenshot file not found: ${path}`);
          throw new Error(`Screenshot file not found: ${path}`);
        }
        
        const imageData = fs.readFileSync(path);
        console.log(`Image data size: ${imageData.length} bytes`);
        
        return {
          inlineData: {
            data: imageData.toString('base64'),
            mimeType: 'image/png'
          }
        };
      })
    );

    console.log(`Prepared ${imageParts.length} image parts for analysis`);
    /*

• [Important insight 1]
• [Important insight 2]
• [Important insight 3]

    */
    console.log('Sending request to Gemini with rate limiting...');
    const text = await geminiService.analyzeScreenshots(imageParts, context);
    console.log('Received response from Gemini');
    
    console.log('Generated text length:', text.length);
    console.log('Generated text preview:', text.substring(0, 200) + '...');

    chatContext.push({
      type: 'analysis',
      content: text,
      timestamp: new Date().toISOString(),
      screenshotCount: screenshots.length
    });

    sendToRenderer('analysis-result', { text });
    console.log('Analysis result sent to renderer');
    
  } catch (error) {
    console.error('Analysis error details:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    let errorMessage = 'Analysis failed';
    
    if (error.message.includes('API_KEY')) {
      errorMessage = 'Invalid API key. Please check your GEMINI_API_KEY.';
    } else if (error.message.includes('quota')) {
      errorMessage = 'API quota exceeded. Please try again later.';
    } else if (error.message.includes('network') || error.message.includes('fetch')) {
      errorMessage = 'Network error. Please check your internet connection.';
    } else if (error.message.includes('model')) {
      errorMessage = 'AI model error. Please try a different model.';
    } else {
      errorMessage = `Analysis failed: ${error.message}`;
    }
    
    sendToRenderer('analysis-result', {
      error: errorMessage
    });
  }
}

async function analyzeForMeeting() {
  await analyzeForMeetingWithContext();
}

// IPC handlers
ipcMain.handle('get-screenshots-count', () => {
  console.log('IPC: get-screenshots-count called, returning:', screenshots.length);
  return screenshots.length;
});

ipcMain.handle('get-window-bounds', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { error: 'Main window not available' };
  }

  return mainWindow.getBounds();
});

ipcMain.handle('set-window-bounds', (event, nextBounds) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { error: 'Main window not available' };
  }

  const safeBounds = getSafeWindowBounds(nextBounds);
  mainWindow.setBounds(safeBounds, false);
  return mainWindow.getBounds();
});

ipcMain.handle('toggle-stealth', () => {
  console.log('IPC: toggle-stealth called');
  return toggleStealthMode();
});

ipcMain.handle('emergency-hide', () => {
  console.log('IPC: emergency-hide called');
  return emergencyHide();
});

ipcMain.handle('take-stealth-screenshot', async () => {
  console.log('IPC: take-stealth-screenshot called');
  return await takeStealthScreenshot();
});

ipcMain.handle('analyze-stealth', async () => {
  console.log('IPC: analyze-stealth called');
  return await analyzeForMeeting();
});

ipcMain.handle('analyze-stealth-with-context', async (event, context) => {
  console.log('IPC: analyze-stealth-with-context called with context length:', context.length);
  return await analyzeForMeetingWithContext(context);
});

ipcMain.handle('clear-stealth', () => {
  console.log('IPC: clear-stealth called');
  screenshots.forEach(path => {
    if (fs.existsSync(path)) {
      fs.unlinkSync(path);
      console.log(`Deleted screenshot: ${path}`);
    }
  });
  screenshots = [];
  chatContext = [];
  console.log('All screenshots and context cleared');
  return { success: true };
});

ipcMain.handle('close-app', () => {
  console.log('IPC: close-app called');
  setTimeout(() => {
    quitApplication();
  }, 0);
  return { success: true };
});

// Safe wrapper — avoids "Render frame was disposed" if the window closes mid-stream
function sendToRenderer(channel, data) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;

  const contents = mainWindow.webContents;
  if (!contents || contents.isDestroyed()) return false;

  if (typeof contents.isCrashed === 'function' && contents.isCrashed()) {
    return false;
  }

  const frame = contents.mainFrame;
  if (frame && typeof frame.isDestroyed === 'function' && frame.isDestroyed()) {
    return false;
  }

  try {
    contents.send(channel, data);
    return true;
  } catch (error) {
    console.error(`Failed to send renderer event "${channel}":`, error.message);
  }
  return false;
}

function emitSttDebug({ source = null, level = 'info', event = 'event', message = '', meta = null } = {}) {
  const payload = {
    ts: new Date().toISOString(),
    source: source === 'mic' || source === 'system' ? source : null,
    level,
    event,
    message,
    meta
  };
  sendToRenderer('stt-debug', payload);
}

// Shared helper: open an AssemblyAI WebSocket for a given audio source ('mic' | 'system')
function startAssemblyAiStream(source) {
  const apiKey = appEnvironment.assemblyAiApiKey;
  if (!apiKey) {
    console.error('ASSEMBLY_AI_API_KEY not found');
    emitSttDebug({
      source,
      level: 'error',
      event: 'missing-api-key',
      message: 'ASSEMBLY_AI_API_KEY not configured'
    });
    sendToRenderer('vosk-error', { source, error: 'ASSEMBLY_AI_API_KEY not configured in .env' });
    return { success: false, error: 'ASSEMBLY_AI_API_KEY not configured' };
  }

  // Guard against double-start
  if (source === 'mic' && isStreamingMic) {
    emitSttDebug({
      source,
      event: 'start-skipped',
      message: 'Start requested while source is already streaming'
    });
    return { success: true, message: 'Mic already streaming' };
  }
  if (source === 'system' && isStreamingSystem) {
    emitSttDebug({
      source,
      event: 'start-skipped',
      message: 'Start requested while source is already streaming'
    });
    return { success: true, message: 'System audio already streaming' };
  }

  try {
    const queryParams = new URLSearchParams({
      sample_rate: String(ASSEMBLY_AI_SAMPLE_RATE),
      format_turns: 'true',
      speech_model: activeAssemblyAiSpeechModel
    });
    const wsUrl = `wss://streaming.assemblyai.com/v3/ws?${queryParams.toString()}`;

    console.log(`Connecting to AssemblyAI for source: ${source}`);
    emitSttDebug({
      source,
      event: 'start-request',
      message: 'Opening AssemblyAI WebSocket',
      meta: { speechModel: activeAssemblyAiSpeechModel }
    });
    sttChunkCounters[source] = 0;
    sttDroppedChunkCounters[source] = 0;
    sendToRenderer('vosk-status', {
      source,
      status: 'loading',
      message: `Connecting (${source})...`
    });

    const ws = new WebSocket(wsUrl, { headers: { Authorization: apiKey } });

    if (source === 'mic') assemblyWsMic = ws;
    else assemblyWsSystem = ws;

    ws.on('open', () => {
      console.log(`AssemblyAI WebSocket connected [${source}]`);
      if (source === 'mic') isStreamingMic = true;
      else isStreamingSystem = true;
      emitSttDebug({
        source,
        event: 'ws-open',
        message: 'AssemblyAI WebSocket connected'
      });
    });

    ws.on('message', (rawMessage) => {
      try {
        const msg = JSON.parse(rawMessage.toString());

        switch (msg.type) {
          case 'Begin':
            console.log(`AssemblyAI session started [${source}]:`, msg.id);
            emitSttDebug({
              source,
              event: 'session-begin',
              message: 'AssemblyAI session started',
              meta: { id: msg.id }
            });
            sendToRenderer('vosk-status', {
              source,
              status: 'listening',
              message: `Listening (${source === 'system' ? 'Host' : 'You'})...`
            });
            break;

          case 'Turn':
            if (msg.transcript) {
              if (msg.end_of_turn) {
                console.log(`AssemblyAI final [${source}]:`, msg.transcript);
                emitSttDebug({
                  source,
                  event: 'turn-final',
                  message: 'Final transcript received',
                  meta: { chars: msg.transcript.length }
                });
                sendToRenderer('vosk-final', { source, text: msg.transcript });
                if (geminiService) {
                  const label = source === 'system' ? 'Host' : 'You';
                  geminiService.addToHistory('user', `${label}: ${msg.transcript}`);
                }
              } else {
                sendToRenderer('vosk-partial', { source, text: msg.transcript });
              }
            }
            break;

          case 'Termination':
            console.log(`AssemblyAI terminated [${source}]. Duration:`, msg.audio_duration_seconds, 's');
            emitSttDebug({
              source,
              event: 'termination',
              message: 'AssemblyAI stream terminated',
              meta: { durationSeconds: msg.audio_duration_seconds }
            });
            if (source === 'mic') { isStreamingMic = false; assemblyWsMic = null; }
            else { isStreamingSystem = false; assemblyWsSystem = null; }
            sendToRenderer('vosk-stopped', { source });
            break;

          default:
            console.log(`AssemblyAI message [${source}]:`, msg.type);
        }
      } catch (parseError) {
        console.error(`Failed to parse AssemblyAI message [${source}]:`, parseError);
        emitSttDebug({
          source,
          level: 'error',
          event: 'parse-error',
          message: parseError.message
        });
      }
    });

    ws.on('error', (error) => {
      console.error(`AssemblyAI WebSocket error [${source}]:`, error.message);
      emitSttDebug({
        source,
        level: 'error',
        event: 'ws-error',
        message: error.message
      });
      sendToRenderer('vosk-error', { source, error: `Connection error (${source}): ${error.message}` });
      if (source === 'mic') { isStreamingMic = false; assemblyWsMic = null; }
      else { isStreamingSystem = false; assemblyWsSystem = null; }
    });

    ws.on('close', (code, reason) => {
      console.log(`AssemblyAI WebSocket closed [${source}]:`, code, reason?.toString());
      emitSttDebug({
        source,
        event: 'ws-close',
        message: 'AssemblyAI WebSocket closed',
        meta: { code, reason: reason?.toString() || '' }
      });
      const stillActive = source === 'mic' ? isStreamingMic : isStreamingSystem;
      if (stillActive) {
        if (source === 'mic') { isStreamingMic = false; assemblyWsMic = null; }
        else { isStreamingSystem = false; assemblyWsSystem = null; }
        sendToRenderer('vosk-stopped', { source });
      }
    });

    return { success: true };

  } catch (error) {
    console.error(`Error starting AssemblyAI stream [${source}]:`, error.message);
    emitSttDebug({
      source,
      level: 'error',
      event: 'start-failed',
      message: error.message
    });
    if (source === 'mic') isStreamingMic = false;
    else isStreamingSystem = false;
    return { success: false, error: error.message };
  }
}

// Start AssemblyAI streaming for a specific source
ipcMain.handle('start-voice-recognition', (event, { source } = {}) => {
  const resolvedSource = source === 'system' ? 'system' : 'mic';
  console.log(`IPC: start-voice-recognition [${resolvedSource}]`);
  emitSttDebug({
    source: resolvedSource,
    event: 'ipc-start',
    message: 'Renderer requested source start'
  });
  return startAssemblyAiStream(resolvedSource);
});

// Receive audio chunks from renderer and forward to the correct AssemblyAI WebSocket
ipcMain.on('audio-chunk', (event, { source, data }) => {
  const resolvedSource = source === 'system' ? 'system' : 'mic';
  const ws = resolvedSource === 'system' ? assemblyWsSystem : assemblyWsMic;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(Buffer.from(data));
    sttChunkCounters[resolvedSource] += 1;
    if (sttChunkCounters[resolvedSource] % 50 === 0) {
      emitSttDebug({
        source: resolvedSource,
        event: 'chunk-heartbeat',
        message: 'Streaming audio chunks',
        meta: {
          chunks: sttChunkCounters[resolvedSource],
          dropped: sttDroppedChunkCounters[resolvedSource]
        }
      });
    }
  } else {
    sttDroppedChunkCounters[resolvedSource] += 1;
    if (sttDroppedChunkCounters[resolvedSource] % 25 === 0) {
      emitSttDebug({
        source: resolvedSource,
        level: 'error',
        event: 'chunk-dropped',
        message: 'Audio chunk dropped because WebSocket is not open',
        meta: {
          dropped: sttDroppedChunkCounters[resolvedSource],
          readyState: ws ? ws.readyState : 'no-ws'
        }
      });
    }
  }
});

// Stop AssemblyAI streaming for a specific source (or 'all')
ipcMain.handle('stop-voice-recognition', (event, { source } = {}) => {
  console.log(`IPC: stop-voice-recognition [${source}]`);
  emitSttDebug({
    source: source === 'system' || source === 'mic' ? source : null,
    event: 'ipc-stop',
    message: `Stop requested for ${source || 'default'}`
  });

  const stopSource = (src) => {
    const ws = src === 'system' ? assemblyWsSystem : assemblyWsMic;
    if (!ws) {
      emitSttDebug({
        source: src,
        event: 'stop-noop',
        message: 'Stop requested but no active socket found'
      });
      sttChunkCounters[src] = 0;
      sttDroppedChunkCounters[src] = 0;
      return;
    }
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'Terminate' }));
      }
    } catch (e) {
      console.error(`Error stopping [${src}]:`, e.message);
      emitSttDebug({
        source: src,
        level: 'error',
        event: 'stop-error',
        message: e.message
      });
    }
    sendToRenderer('vosk-status', { source: src, status: 'stopped', message: 'Stopped' });
    if (src === 'mic') isStreamingMic = false;
    else isStreamingSystem = false;
    sttChunkCounters[src] = 0;
    sttDroppedChunkCounters[src] = 0;
    emitSttDebug({
      source: src,
      event: 'stop-issued',
      message: 'Terminate frame sent to AssemblyAI'
    });
  };

  if (source === 'all') {
    stopSource('mic');
    stopSource('system');
  } else {
    stopSource(source === 'system' ? 'system' : 'mic');
  }

  return { success: true };
});

// Provide desktop capture source IDs to renderer for system audio capture
ipcMain.handle('get-desktop-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    return sources.map(s => ({ id: s.id, name: s.name }));
  } catch (error) {
    console.error('Error getting desktop sources:', error.message);
    return [];
  }
});

// Transcribe audio file using AssemblyAI async API
ipcMain.handle('transcribe-audio', async (event, base64Audio) => {
  console.log('IPC: transcribe-audio called, size:', base64Audio.length);

  const apiKey = appEnvironment.assemblyAiApiKey;
  if (!apiKey) {
    return { success: false, error: 'ASSEMBLY_AI_API_KEY not configured in .env' };
  }

  try {
    const audioBuffer = Buffer.from(base64Audio, 'base64');

    // Step 1: Upload audio to AssemblyAI
    console.log('Uploading audio to AssemblyAI...');
    const https = require('https');

    const uploadUrl = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.assemblyai.com',
        path: '/v2/upload',
        method: 'POST',
        headers: {
          Authorization: apiKey,
          'Content-Type': 'application/octet-stream',
          'Content-Length': audioBuffer.length
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result.upload_url) {
              resolve(result.upload_url);
            } else {
              reject(new Error(result.error || 'Upload failed'));
            }
          } catch (e) {
            reject(new Error('Failed to parse upload response'));
          }
        });
      });
      req.on('error', reject);
      req.write(audioBuffer);
      req.end();
    });

    console.log('Audio uploaded, creating transcript...');

    // Step 2: Create transcript
    const transcriptId = await new Promise((resolve, reject) => {
      const body = JSON.stringify({ audio_url: uploadUrl, language_code: 'en' });
      const req = https.request({
        hostname: 'api.assemblyai.com',
        path: '/v2/transcript',
        method: 'POST',
        headers: {
          Authorization: apiKey,
          'Content-Type': 'application/json'
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result.id) {
              resolve(result.id);
            } else {
              reject(new Error(result.error || 'Transcript creation failed'));
            }
          } catch (e) {
            reject(new Error('Failed to parse transcript response'));
          }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    console.log('Transcript created, polling for result...');

    // Step 3: Poll for result
    const pollTranscript = () => new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.assemblyai.com',
        path: `/v2/transcript/${transcriptId}`,
        method: 'GET',
        headers: { Authorization: apiKey }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Failed to parse poll response'));
          }
        });
      });
      req.on('error', reject);
      req.end();
    });

    let transcript;
    while (true) {
      transcript = await pollTranscript();
      if (transcript.status === 'completed') break;
      if (transcript.status === 'error') {
        throw new Error(transcript.error || 'Transcription failed');
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    console.log('Transcription complete:', transcript.text);

    // Add to Gemini history
    if (transcript.text && geminiService) {
      geminiService.addToHistory('user', transcript.text.trim());
    }

    return { success: true, transcript: transcript.text || '' };

  } catch (error) {
    console.error('Error in transcribe-audio:', error.message);
    return { success: false, error: error.message };
  }
});

// Add voice transcript to history
ipcMain.handle('add-voice-transcript', async (event, transcript) => {
  console.log('IPC: add-voice-transcript called');
  if (geminiService) {
    geminiService.addToHistory('user', transcript);
  }
  return { success: true };
});

// "What should I say?" feature
ipcMain.handle('suggest-response', async (event, context) => {
  console.log('IPC: suggest-response called');
  try {
    if (!geminiService) {
      throw new Error('Gemini service not initialized');
    }
    const suggestions = await geminiService.suggestResponse(context);
    return { success: true, suggestions };
  } catch (error) {
    console.error('Error generating suggestions:', error);
    return { success: false, error: error.message };
  }
});

// Generate meeting notes
ipcMain.handle('generate-meeting-notes', async () => {
  console.log('IPC: generate-meeting-notes called');
  try {
    if (!geminiService) {
      throw new Error('Gemini service not initialized');
    }
    const notes = await geminiService.generateMeetingNotes();
    return { success: true, notes };
  } catch (error) {
    console.error('Error generating meeting notes:', error);
    return { success: false, error: error.message };
  }
});

// Generate follow-up email
ipcMain.handle('generate-follow-up-email', async () => {
  console.log('IPC: generate-follow-up-email called');
  try {
    if (!geminiService) {
      throw new Error('Gemini service not initialized');
    }
    const email = await geminiService.generateFollowUpEmail();
    return { success: true, email };
  } catch (error) {
    console.error('Error generating email:', error);
    return { success: false, error: error.message };
  }
});

// Answer specific question
ipcMain.handle('answer-question', async (event, question) => {
  console.log('IPC: answer-question called');
  try {
    if (!geminiService) {
      throw new Error('Gemini service not initialized');
    }
    const answer = await geminiService.answerQuestion(question);
    return { success: true, answer };
  } catch (error) {
    console.error('Error answering question:', error);
    return { success: false, error: error.message };
  }
});

// Get conversation insights
ipcMain.handle('get-conversation-insights', async () => {
  console.log('IPC: get-conversation-insights called');
  try {
    if (!geminiService) {
      throw new Error('Gemini service not initialized');
    }
    const insights = await geminiService.getConversationInsights();
    return { success: true, insights };
  } catch (error) {
    console.error('Error getting insights:', error);
    return { success: false, error: error.message };
  }
});

// Clear conversation history
ipcMain.handle('clear-conversation-history', async () => {
  console.log('IPC: clear-conversation-history called');
  try {
    if (geminiService) {
      geminiService.clearHistory();
    }
    chatContext = [];
    return { success: true };
  } catch (error) {
    console.error('Error clearing history:', error);
    return { success: false, error: error.message };
  }
});

// Get conversation history
ipcMain.handle('get-conversation-history', async () => {
  console.log('IPC: get-conversation-history called');
  try {
    if (!geminiService) {
      return { success: true, history: [] };
    }
    return { success: true, history: geminiService.conversationHistory };
  } catch (error) {
    console.error('Error getting history:', error);
    return { success: false, error: error.message };
  }
});

// Get current settings (API keys + runtime preferences)
ipcMain.handle('get-settings', () => {
  return {
    geminiApiKey: appEnvironment.geminiApiKey,
    assemblyAiApiKey: appEnvironment.assemblyAiApiKey,
    geminiModel: activeGeminiModel,
    geminiModels: GEMINI_MODELS,
    defaultGeminiModel: DEFAULT_GEMINI_MODEL,
    programmingLanguage: activeProgrammingLanguage,
    programmingLanguages: PROGRAMMING_LANGUAGES,
    defaultProgrammingLanguage: DEFAULT_PROGRAMMING_LANGUAGE,
    assemblyAiSpeechModels: ASSEMBLY_AI_SPEECH_MODELS,
    defaultAssemblyAiSpeechModel: DEFAULT_ASSEMBLY_AI_SPEECH_MODEL,
    assemblyAiSpeechModel: activeAssemblyAiSpeechModel,
    hideFromScreenCapture: appEnvironment.hideFromScreenCapture,
    windowOpacityLevel: activeWindowOpacityLevel
  };
});

// Save settings to .env file and apply them
ipcMain.handle('save-settings', async (event, settings) => {
    console.log('IPC: save-settings called');
  try {
    activeGeminiModel = resolveGeminiModel(settings.geminiModel);
    activeAssemblyAiSpeechModel = resolveAssemblyAiSpeechModel(
      settings.assemblyAiSpeechModel,
      activeAssemblyAiSpeechModel
    );
    activeProgrammingLanguage = resolveProgrammingLanguage(settings.programmingLanguage);
    activeWindowOpacityLevel = clampWindowOpacityLevel(settings.windowOpacityLevel);
    appEnvironment = saveApplicationEnvironment(app, {
      geminiApiKey: settings.geminiApiKey || '',
      assemblyAiApiKey: settings.assemblyAiApiKey || '',
      hideFromScreenCapture: appEnvironment.hideFromScreenCapture,
      maxScreenshots: appEnvironment.maxScreenshots,
      screenshotDelay: appEnvironment.screenshotDelay,
      nodeEnv: appEnvironment.nodeEnv,
      nodeOptions: appEnvironment.nodeOptions
    });
    appState = saveAppState(app, {
      geminiModel: activeGeminiModel,
      assemblyAiSpeechModel: activeAssemblyAiSpeechModel,
      programmingLanguage: activeProgrammingLanguage,
      windowOpacityLevel: activeWindowOpacityLevel
    });
    console.log('Saved app state to:', getAppStatePath(app));
    console.log('Settings saved to:', appEnvironment.envPath);
    console.log('Applied programming language:', activeProgrammingLanguage);
    console.log(`Applied window opacity level: ${activeWindowOpacityLevel}/10`);

    applyWindowOpacity();

    // Re-initialize Gemini service with new key/model/language
    initializeGeminiService(
      appEnvironment.geminiApiKey,
      activeGeminiModel,
      activeProgrammingLanguage
    );

    return { success: true };
  } catch (error) {
    console.error('Error saving settings:', error);
    return { success: false, error: error.message };
  }
});

// App event handlers
app.whenReady().then(() => {
  try {
    appEnvironment = loadApplicationEnvironment(app);
  } catch (error) {
    console.error('Failed to load application environment:', error);
    dialog.showErrorBox('Open-Cluely Configuration Error', error.message);
    app.exit(1);
    return;
  }

  logStartupConfiguration();
  loadPersistedAppState();
  initializeGeminiService(
    appEnvironment.geminiApiKey,
    activeGeminiModel,
    activeProgrammingLanguage
  );
  console.log('App is ready, creating window...');
  createStealthWindow();
  registerStealthShortcuts();
  // Add to app.whenReady() or before createWindow
  app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder');
  app.commandLine.appendSwitch('ignore-certificate-errors');
  app.commandLine.appendSwitch('allow-running-insecure-content');
  app.commandLine.appendSwitch('disable-web-security');
  app.commandLine.appendSwitch('enable-media-stream');
  
  isVisible = true;
  
  console.log('Window setup complete - will show after content loads');
});

app.on('window-all-closed', () => {
  // Keep running in background for stealth operation
});

app.on('activate', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createStealthWindow();
  }
});

app.on('will-quit', () => {
  cleanupTransientResources();
});

app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, navigationUrl) => {
    event.preventDefault();
  });
  
  contents.on('will-navigate', (event, navigationUrl) => {
    if (navigationUrl !== mainWindow.webContents.getURL()) {
      event.preventDefault();
    }
  });
});

process.title = 'SystemIdleProcess';
})();
