const path = require('path');
const { BrowserWindow } = require('electron');
const { resolveAllowedFilePath } = require('./file-protocol-guard');

// Electron implements setContentProtection (hiding the window from screen
// capture/sharing) only on Windows and macOS; on Linux the call is a no-op.
// Warn once per process instead of silently overclaiming stealth.
const { warnLinuxContentProtectionOnce } = require('../../main-process/startup-logging');

function createAssistantWindow({
  app,
  screen,
  defaultWidth,
  defaultHeight,
  minWidth,
  minHeight,
  hideFromScreenCapture,
  initialOpacity,
  launchHidden,
  nodeEnv
}) {
  console.log('Creating assistant window...');
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const x = Math.floor((width - defaultWidth) / 2);
  const y = 40;
  const windowOpacity = Number.isFinite(initialOpacity) ? initialOpacity : 1;

  console.log(`Window position: ${x}, ${y}, size: ${defaultWidth}x${defaultHeight}`);

  const mainWindow = new BrowserWindow({
    width: defaultWidth,
    height: defaultHeight,
    minWidth,
    minHeight,
    maxWidth: width,
    maxHeight: height,
    x,
    y,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
      offscreen: false,
      // webSecurity must stay off: Settings fetches the Ollama model list
      // (http://localhost:11434) from this file:// page, which needs a CORS
      // exemption no localhost origin reliably grants. Renderer JS never sees
      // stored secrets anyway (get-settings masks them) and the file:
      // protocol handler below only serves app resources, so the remaining
      // exposure is bounded.
      webSecurity: false,
      experimentalFeatures: false,
      enableRemoteModule: false,
      sandbox: false
    },
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    closable: false,
    focusable: true,
    show: false,
    opacity: windowOpacity,
    type: 'toolbar',
    acceptFirstMouse: false,
    disableAutoHideCursor: true,
    enableLargerThanScreen: false,
    hasShadow: false,
    thickFrame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#00000000'
  });

  const htmlPath = path.join(__dirname, 'renderer.html');
  console.log('Loading HTML from:', htmlPath);
  mainWindow.loadFile(htmlPath);

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

  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    console.log('Permission check:', permission, requestingOrigin);
    return permission === 'microphone' || permission === 'media';
  });

  // The file: scheme is restricted to the app's own src/ directory: the
  // renderer bundle (html/css/js/worklet) lives there, and nothing else the
  // window loads comes from file:. This must be interceptFileProtocol —
  // registerFileProtocol on the standard file scheme does NOT intercept
  // fetch/XHR/subresource loads, so without interception any renderer script
  // (webSecurity is off) could fetch() arbitrary local files, including the
  // API keys in app-state.json.
  const appSrcRoot = path.resolve(__dirname, '..', '..');
  mainWindow.webContents.session.protocol.interceptFileProtocol('file', (request, callback) => {
    const allowedPath = resolveAllowedFilePath(request.url, appSrcRoot);
    if (!allowedPath) {
      console.warn('[Security] Blocked file: access outside app resources:', request.url);
      callback({ error: -6 }); // ERR_FILE_NOT_FOUND
      return;
    }
    callback(allowedPath);
  });

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
      appId: 'com.opencluely.app'
    });
  }
  if (process.platform === 'linux') {
    // Without this the window is mapped but has no _NET_WM_STATE_ABOVE hint, so
    // after Alt+Shift+H the window reappears BEHIND the focused browser/Meet
    // window and looks like the shortcut did nothing.
    mainWindow.setAlwaysOnTop(true);
    // Electron applies the hint reliably only once the window is mapped, so
    // re-assert it whenever the window is shown.
    mainWindow.on('show', () => {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(true);
      }, 50);
    });
  }

  mainWindow.setContentProtection(hideFromScreenCapture);
  console.log(
    `Content protection ${hideFromScreenCapture ? 'enabled' : 'disabled'} (HIDE_FROM_SCREEN_CAPTURE=${hideFromScreenCapture})`
  );

  if (hideFromScreenCapture) {
    // Shared once-guard with the startup warning: one line per process.
    warnLinuxContentProtectionOnce();
  }

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
        app.style.display = 'flex';
        console.log('App container made visible');
      }

      'Content visibility check complete';
    `).then((result) => {
      console.log('JavaScript result:', result);
      if (launchHidden) {
        console.log('Window initialized in hidden launch mode');
        return;
      }

      mainWindow.showInactive();
      console.log('Window shown in inactive mode with transparent background');
    }).catch((error) => {
      console.log('JavaScript execution failed:', error);
      if (!launchHidden) {
        mainWindow.showInactive();
      }
    });
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
  });

  mainWindow.webContents.on('console-message', (event, level, message) => {
    console.log(`Renderer console.${level}: ${message}`);
  });

  if (nodeEnv === 'development') {
    mainWindow.webContents.openDevTools();
  }

  return mainWindow;
}

module.exports = {
  createAssistantWindow
};
