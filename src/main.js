const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const screenshot = require('screenshot-desktop');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

let mainWindow;
let screenshots = [];
let chatContext = [];
const MAX_SCREENSHOTS = 3;

// Initialize Gemini AI with better error handling
let genAI = null;
let model = null;

try {
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY not found in environment variables');
  } else {
    console.log('Initializing Gemini AI...');
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
    console.log('Gemini AI initialized successfully');
  }
} catch (error) {
  console.error('Failed to initialize Gemini AI:', error);
}

function createStealthWindow() {
  console.log('Creating stealth window...');
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  
  // Adjusted window size for chat interface
  const windowWidth = 400;
  const windowHeight = 600;
  const x = Math.floor((width - windowWidth) / 2);
  const y = 40;
  
  console.log(`Window position: ${x}, ${y}, size: ${windowWidth}x${windowHeight}`);
  
  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: x,
    y: y,
    webPreferences: {
      nodeIntegration: false,          // Disable for security
      contextIsolation: true,          // Enable for security
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
      offscreen: false,
      webSecurity: false,              // CHANGED: Disable for microphone access
      allowRunningInsecureContent: true, // CHANGED: Allow for media access
      experimentalFeatures: false,
      enableRemoteModule: false,
      sandbox: false                   // Keep disabled for dynamic imports
    },
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    focusable: true,
    show: false,
    opacity: 1.0,
    type: 'toolbar',
    acceptFirstMouse: false,
    disableAutoHideCursor: true,
    enableLargerThanScreen: false,
    hasShadow: false,
    thickFrame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#00000000'
  });

  console.log('BrowserWindow created');
  
  const htmlPath = path.join(__dirname, 'renderer.html');
  console.log('Loading HTML from:', htmlPath);
  mainWindow.loadFile(htmlPath);
  
  // ADDED: Set up microphone permissions
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    console.log('Permission requested:', permission);
    if (permission === 'microphone' || permission === 'media') {
      console.log('Granting microphone permission');
      callback(true);
    } else {
      console.log('Denying permission:', permission);
      callback(false);
    }
  });

  // ADDED: Set permissions policy for media access
  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    console.log('Permission check:', permission, requestingOrigin);
    if (permission === 'microphone' || permission === 'media') {
      return true;
    }
    return false;
  });

  // ADDED: Override permissions for media devices
  mainWindow.webContents.session.protocol.registerFileProtocol('file', (request, callback) => {
    const pathname = decodeURI(request.url.replace('file:///', ''));
    callback(pathname);
  });
  
  // Apply stealth settings
  if (process.platform === 'darwin') {
    mainWindow.setVisibleOnAllWorkspaces(true, { 
      visibleOnFullScreen: true,
      skipTransformProcessType: true 
    });
    mainWindow.setAlwaysOnTop(true, 'pop-up-menu', 1);
    app.dock.hide();
    mainWindow.setHiddenInMissionControl(true);
  } else if (process.platform === 'win32') {
    console.log('Applying Windows stealth settings');
    mainWindow.setSkipTaskbar(true);
    mainWindow.setAlwaysOnTop(true, 'pop-up-menu');
    mainWindow.setAppDetails({
      appId: 'SystemProcess',
      appIconPath: '',
      relaunchCommand: '',
      relaunchDisplayName: ''
    });
  } else if (process.platform === 'linux') {
    mainWindow.setSkipTaskbar(true);
    if (mainWindow.setHasShadow) {
      mainWindow.setHasShadow(false);
    }
  }
  
  mainWindow.setContentProtection(true);
  console.log('Content protection enabled for stealth');
  
  mainWindow.setIgnoreMouseEvents(false);
  
  mainWindow.webContents.on('dom-ready', () => {
    console.log('DOM is ready');
  });
  
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('HTML finished loading');
    
    mainWindow.webContents.executeJavaScript(`
      console.log('Content check...');
      console.log('Document title:', document.title);
      console.log('Body exists:', !!document.body);
      console.log('App element exists:', !!document.getElementById('app'));
      console.log('Glass container exists:', !!document.querySelector('.glass-container'));
      
      document.body.style.background = 'transparent';
      
      if (document.body) {
        document.body.style.visibility = 'visible';
        document.body.style.display = 'block';
        console.log('Body made visible');
      }
      
      const app = document.getElementById('app');
      if (app) {
        app.style.visibility = 'visible';
        app.style.display = 'block';
        console.log('App container made visible');
      }
      
      'Content visibility check complete';
    `).then((result) => {
      console.log('JavaScript result:', result);
      mainWindow.show();
      mainWindow.focus();
      console.log('Window shown with transparent background');
    }).catch((error) => {
      console.log('JavaScript execution failed:', error);
      mainWindow.show();
    });
  });
  
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
  });
  
  // Handle console messages from renderer
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`Renderer console.${level}: ${message}`);
  });
  
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
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

let isVisible = true;
let autoHideTimer = null;

function toggleStealthMode() {
  if (autoHideTimer) {
    clearTimeout(autoHideTimer);
    autoHideTimer = null;
  }

  if (isVisible) {
    mainWindow.setOpacity(0.6);
    mainWindow.webContents.send('set-stealth-mode', true);
    isVisible = false;
  } else {
    mainWindow.setOpacity(1.0);
    mainWindow.webContents.send('set-stealth-mode', false);
    isVisible = true;
  }
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
      mainWindow.setOpacity(1.0);
      isVisible = true;
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
    
    mainWindow.setOpacity(0.01);
    
    await new Promise(resolve => setTimeout(resolve, 200));
    
    const screenshotsDir = path.join(__dirname, '..', '.stealth_screenshots');
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
    
    const screenshotPath = path.join(screenshotsDir, `stealth-${Date.now()}.png`);
    await screenshot({ filename: screenshotPath });
    
    screenshots.push(screenshotPath);
    if (screenshots.length > MAX_SCREENSHOTS) {
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
  console.log('API Key exists:', !!process.env.GEMINI_API_KEY);
  console.log('Model initialized:', !!model);
  console.log('Screenshots count:', screenshots.length);

  if (!process.env.GEMINI_API_KEY) {
    console.error('No GEMINI_API_KEY found');
    mainWindow.webContents.send('analysis-result', {
      error: 'No API key configured. Please add GEMINI_API_KEY to your .env file.'
    });
    return;
  }

  if (!model) {
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

    console.log('Sending request to Gemini...');
    const result = await model.generateContent([prompt, ...imageParts]);
    console.log('Received response from Gemini');
    
    const response = await result.response;
    const text = response.text();
    
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

ipcMain.handle('start-voice-recognition', () => {
  console.log('IPC: start-voice-recognition called');
  return { success: true };
});

ipcMain.handle('stop-voice-recognition', () => {
  console.log('IPC: stop-voice-recognition called');
  return { success: true };
});

// App event handlers
app.whenReady().then(() => {
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
  if (BrowserWindow.getAllWindows().length === 0) {
    createStealthWindow();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  
  screenshots.forEach(path => {
    if (fs.existsSync(path)) fs.unlinkSync(path);
  });
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