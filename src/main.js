const { app, dialog, globalShortcut, ipcMain, screen } = require('electron');
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
  resolveAssemblyAiSpeechModel,
  resolveGeminiModel
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

// AssemblyAI streaming transcription
let assemblyWs = null;
let isStreamingSTT = false;
const ASSEMBLY_AI_SAMPLE_RATE = 16000;

// Initialize Gemini Service with rate limiting
let geminiService = null;
let activeGeminiModel = DEFAULT_GEMINI_MODEL;
let activeAssemblyAiSpeechModel = DEFAULT_ASSEMBLY_AI_SPEECH_MODEL;
let activeWindowOpacityLevel = DEFAULT_WINDOW_OPACITY_LEVEL;
let appState = null;
let appEnvironment = null;
let isShuttingDown = false;
let isVisible = true;
let autoHideTimer = null;

function initializeGeminiService(apiKey, modelName = activeGeminiModel) {
  activeGeminiModel = resolveGeminiModel(modelName);

  try {
    if (!apiKey) {
      console.error('GEMINI_API_KEY not found in environment variables');
      geminiService = null;
      return;
    }

    console.log('Initializing Gemini AI Service with model:', activeGeminiModel);
    geminiService = new GeminiService(apiKey, activeGeminiModel);
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
  activeWindowOpacityLevel = clampWindowOpacityLevel(appState.windowOpacityLevel);

  if (
    appState.geminiModel !== activeGeminiModel ||
    appState.assemblyAiSpeechModel !== activeAssemblyAiSpeechModel ||
    appState.windowOpacityLevel !== activeWindowOpacityLevel
  ) {
    appState = saveAppState(app, {
      geminiModel: activeGeminiModel,
      assemblyAiSpeechModel: activeAssemblyAiSpeechModel,
      windowOpacityLevel: activeWindowOpacityLevel
    });
  }

  console.log('Loaded app state from:', getAppStatePath(app));
  console.log('Restored Gemini model from app state:', activeGeminiModel);
  console.log('Restored AssemblyAI speech model from app state:', activeAssemblyAiSpeechModel);
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
}

function cleanupTransientResources() {
  if (assemblyWs) {
    try {
      if (assemblyWs.readyState === WebSocket.OPEN) {
        assemblyWs.send(JSON.stringify({ type: 'Terminate' }));
      }

      assemblyWs.terminate();
    } catch (error) {
      console.error('Error cleaning up AssemblyAI WebSocket:', error);
    }

    assemblyWs = null;
  }

  isStreamingSTT = false;
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
    mainWindow.webContents.send('toggle-voice-recognition');
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
  mainWindow.webContents.send('set-stealth-mode', stealthModeEnabled);
}

function emergencyHide() {
  if (autoHideTimer) {
    clearTimeout(autoHideTimer);
    autoHideTimer = null;
  }

  mainWindow.setOpacity(0.01);
  mainWindow.webContents.send('emergency-clear');
  
  autoHideTimer = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      isVisible = true;
      applyWindowOpacity();
      mainWindow.webContents.send('set-stealth-mode', false);
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
    
    mainWindow.webContents.send('screenshot-taken-stealth', screenshots.length);
    
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
  console.log('Screenshots count:', screenshots.length);

  if (!appEnvironment.geminiApiKey) {
    console.error('No GEMINI_API_KEY found');
    mainWindow.webContents.send('analysis-result', {
      error: 'No API key configured. Please add GEMINI_API_KEY to your .env file.'
    });
    return;
  }

  if (!geminiService || !geminiService.model) {
    console.error('Gemini model not initialized');
    mainWindow.webContents.send('analysis-result', {
      error: 'AI model not initialized. Please check your API key.'
    });
    return;
  }

  if (screenshots.length === 0) {
    console.error('No screenshots to analyze');
    mainWindow.webContents.send('analysis-result', {
      error: 'No screenshots to analyze. Take a screenshot first.'
    });
    return;
  }

  try {
    console.log('Sending analysis start signal...');
    mainWindow.webContents.send('analysis-start');
    
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

    const contextPrompt = context ? `
    
CONVERSATION CONTEXT:
${context}

Based on the conversation context above and the screenshots provided, please:
1. Answer any questions that were asked in the conversation
2. Provide relevant insights about what's shown in the screenshots
3. If there are specific questions in the context, focus on answering those
4. Be concise but comprehensive

FORMAT YOUR RESPONSE AS:
    ` : '';

    const prompt = `You are an expert AI assistant for technical meetings and interviews. Analyze the provided screenshots and conversation context.

${contextPrompt}

**CODE SOLUTION:**
\`\`\`[language]
[Your complete, working code solution here - if applicable]
\`\`\`

**ANALYSIS:**
[Clear explanation of what you see in the screenshots and answers to any questions from the conversation]

**KEY INSIGHTS:**
• [Important insight 1]
• [Important insight 2]
• [Important insight 3]

Rules:
1. If there are questions in the conversation context, answer them directly
2. Provide code solutions if the screenshots show coding problems
3. Be concise but complete
4. Focus on actionable insights
5. If it's a meeting/presentation, summarize key points
6. Include time/space complexity for coding solutions

Analyze the screenshots and conversation context:`;

    console.log('Sending request to Gemini with rate limiting...');
    const text = await geminiService.generateMultimodal([prompt, ...imageParts]);
    console.log('Received response from Gemini');
    
    console.log('Generated text length:', text.length);
    console.log('Generated text preview:', text.substring(0, 200) + '...');

    chatContext.push({
      type: 'analysis',
      content: text,
      timestamp: new Date().toISOString(),
      screenshotCount: screenshots.length
    });

    mainWindow.webContents.send('analysis-result', { text });
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
    
    mainWindow.webContents.send('analysis-result', {
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

// Start AssemblyAI streaming transcription via WebSocket
ipcMain.handle('start-voice-recognition', () => {
  console.log('IPC: start-voice-recognition called');

  if (isStreamingSTT) {
    console.log('AssemblyAI streaming already running');
    return { success: true, message: 'Already running' };
  }

  const apiKey = appEnvironment.assemblyAiApiKey;
  if (!apiKey) {
    console.error('ASSEMBLY_AI_API_KEY not found');
    mainWindow.webContents.send('vosk-error', { error: 'ASSEMBLY_AI_API_KEY not configured in .env' });
    return { success: false, error: 'ASSEMBLY_AI_API_KEY not configured' };
  }

  try {
    const speechModel = activeAssemblyAiSpeechModel;
    const queryParams = new URLSearchParams({
      sample_rate: String(ASSEMBLY_AI_SAMPLE_RATE),
      format_turns: 'true',
      speech_model: speechModel
    });
    const wsUrl = `wss://streaming.assemblyai.com/v3/ws?${queryParams.toString()}`;

    console.log('Connecting to AssemblyAI streaming API...');
    mainWindow.webContents.send('vosk-status', {
      status: 'loading',
      message: 'Connecting to AssemblyAI...'
    });

    assemblyWs = new WebSocket(wsUrl, {
      headers: { Authorization: apiKey }
    });

    assemblyWs.on('open', () => {
      console.log('AssemblyAI WebSocket connected');
      isStreamingSTT = true;
      // Don't send 'listening' yet - wait for Begin message
    });

    assemblyWs.on('message', (rawMessage) => {
      try {
        const msg = JSON.parse(rawMessage.toString());

        switch (msg.type) {
          case 'Begin':
            console.log('AssemblyAI session started:', msg.id);
            mainWindow.webContents.send('vosk-status', {
              status: 'listening',
              message: 'Listening via AssemblyAI...'
            });
            break;

          case 'Turn':
            if (msg.transcript) {
              if (msg.end_of_turn) {
                // Final result for this turn
                console.log('AssemblyAI final:', msg.transcript);
                mainWindow.webContents.send('vosk-final', { text: msg.transcript });

                // Add to Gemini history
                if (geminiService && msg.transcript) {
                  geminiService.addToHistory('user', msg.transcript);
                }
              } else {
                // Partial / in-progress result
                mainWindow.webContents.send('vosk-partial', { text: msg.transcript });
              }
            }
            break;

          case 'Termination':
            console.log('AssemblyAI session terminated. Audio duration:', msg.audio_duration_seconds, 's');
            isStreamingSTT = false;
            assemblyWs = null;
            mainWindow.webContents.send('vosk-stopped');
            break;

          default:
            console.log('AssemblyAI message:', msg.type);
            break;
        }
      } catch (parseError) {
        console.error('Failed to parse AssemblyAI message:', parseError);
      }
    });

    assemblyWs.on('error', (error) => {
      console.error('AssemblyAI WebSocket error:', error.message);
      mainWindow.webContents.send('vosk-error', { error: `AssemblyAI connection error: ${error.message}` });
      isStreamingSTT = false;
      assemblyWs = null;
    });

    assemblyWs.on('close', (code, reason) => {
      console.log('AssemblyAI WebSocket closed:', code, reason?.toString());
      if (isStreamingSTT) {
        isStreamingSTT = false;
        assemblyWs = null;
        mainWindow.webContents.send('vosk-stopped');
      }
    });

    return { success: true };

  } catch (error) {
    console.error('Error starting AssemblyAI streaming:', error.message);
    isStreamingSTT = false;
    return { success: false, error: error.message };
  }
});

// Receive audio chunks from renderer and forward to AssemblyAI
ipcMain.on('audio-chunk', (event, audioData) => {
  if (assemblyWs && assemblyWs.readyState === WebSocket.OPEN) {
    assemblyWs.send(Buffer.from(audioData));
  }
});

// Stop AssemblyAI streaming transcription
ipcMain.handle('stop-voice-recognition', () => {
  console.log('IPC: stop-voice-recognition called');

  if (!isStreamingSTT || !assemblyWs) {
    return { success: true, message: 'Not running' };
  }

  try {
    // Send graceful terminate message
    if (assemblyWs.readyState === WebSocket.OPEN) {
      assemblyWs.send(JSON.stringify({ type: 'Terminate' }));
    }
    // The WebSocket 'close' or 'Termination' message handler will clean up

    mainWindow.webContents.send('vosk-status', {
      status: 'stopped',
      message: 'Stopped listening'
    });

    isStreamingSTT = false;
    return { success: true };
  } catch (error) {
    console.error('Error stopping AssemblyAI:', error.message);
    return { success: false, error: error.message };
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

// Get current settings (API keys + models)
ipcMain.handle('get-settings', () => {
  return {
    geminiApiKey: appEnvironment.geminiApiKey,
    assemblyAiApiKey: appEnvironment.assemblyAiApiKey,
    geminiModel: activeGeminiModel,
    geminiModels: GEMINI_MODELS,
    defaultGeminiModel: DEFAULT_GEMINI_MODEL,
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
      windowOpacityLevel: activeWindowOpacityLevel
    });
    console.log('Saved app state to:', getAppStatePath(app));
    console.log('Settings saved to:', appEnvironment.envPath);
    console.log(`Applied window opacity level: ${activeWindowOpacityLevel}/10`);

    applyWindowOpacity();

    // Re-initialize Gemini service with new key/model
    initializeGeminiService(appEnvironment.geminiApiKey, activeGeminiModel);

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
  initializeGeminiService(appEnvironment.geminiApiKey, activeGeminiModel);
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
