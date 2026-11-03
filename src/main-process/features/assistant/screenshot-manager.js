const fs = require('fs');
const path = require('path');
const screenshot = require('screenshot-desktop');

// screenshot-desktop's Linux backend never wires its internal listDisplays()
// (xrandr) rejection into the returned promise, so when xrandr or the capture
// tool is missing the promise can stay pending forever instead of rejecting.
// Race it against a timeout so the fallback below actually gets to run.
const SCREENSHOT_CLI_TIMEOUT_MS = 5000;

const NO_SCREENSHOT_METHOD_MESSAGE =
  'No screenshot method available — install `gnome-screenshot`, `scrot`, ' +
  'ImageMagick (`import`), or run on Wayland with XDG portal support';

// Electron-native capture: no external CLI binary needed. Works on X11 and on
// Wayland via the XDG desktop portal that Chromium already uses for
// desktopCapturer. Used as a fallback on Linux when screenshot-desktop cannot
// find gnome-screenshot/scrot/import/grim on the host.
async function captureWithDesktopCapturer(screenshotPath) {
  const { desktopCapturer, screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const scaleFactor = primaryDisplay.scaleFactor || 1;
  const { width, height } = primaryDisplay.size;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.floor(width * scaleFactor),
      height: Math.floor(height * scaleFactor)
    }
  });
  if (!sources || sources.length === 0) {
    throw new Error('desktopCapturer returned no screen sources');
  }
  const pngBuffer = sources[0].thumbnail.toPNG();
  if (!pngBuffer || pngBuffer.length === 0) {
    throw new Error('desktopCapturer returned an empty thumbnail');
  }
  fs.writeFileSync(screenshotPath, pngBuffer);
}

// Builds the capture chain: primary (screenshot-desktop CLI) first, then — on
// Linux only — one retry with the Electron-native capture. Split out as a
// factory so the fallback order can be unit-tested with stubbed captures.
function createScreenshotCapture({
  capturePrimary,
  captureFallback = captureWithDesktopCapturer,
  platform = process.platform,
  cliTimeoutMs = SCREENSHOT_CLI_TIMEOUT_MS,
  log = console.warn
} = {}) {
  if (typeof capturePrimary !== 'function') {
    throw new Error('createScreenshotCapture requires a capturePrimary function');
  }

  return async function captureScreenshot(screenshotPath) {
    let primaryError = null;
    let timeoutHandle = null;

    try {
      const primaryPromise = Promise.resolve(capturePrimary(screenshotPath));
      // If the timeout wins the race below, a late CLI rejection must not
      // surface as an unhandled rejection.
      primaryPromise.catch(() => {});
      const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`screenshot-desktop timed out after ${cliTimeoutMs}ms`)),
          cliTimeoutMs
        );
      });

      try {
        await Promise.race([primaryPromise, timeoutPromise]);
      } finally {
        clearTimeout(timeoutHandle);
      }

      if (!fs.existsSync(screenshotPath) || fs.statSync(screenshotPath).size === 0) {
        primaryError = new Error('screenshot-desktop completed but produced no file');
      }
    } catch (error) {
      primaryError = error;
    }

    if (!primaryError) {
      return;
    }

    if (platform !== 'linux') {
      throw primaryError;
    }

    log(
      `screenshot-desktop failed on Linux (${primaryError.message}), retrying with Electron desktopCapturer`
    );

    try {
      await captureFallback(screenshotPath);
    } catch (fallbackError) {
      const combinedError = new Error(NO_SCREENSHOT_METHOD_MESSAGE);
      combinedError.cause = fallbackError;
      throw combinedError;
    }
  };
}

function createScreenshotManager({ app, getMainWindow, getAppEnvironment, sendToRenderer }) {
  let screenshots = [];
  let screenshotSequence = 0;
  let screenshotInProgress = false;

  function nextScreenshotId() {
    screenshotSequence += 1;
    return `ss-${Date.now()}-${screenshotSequence}`;
  }

  function normalizeScreenshotEntry(entry) {
    if (!entry) return null;

    if (typeof entry === 'string') {
      return {
        id: null,
        path: entry,
        timestamp: null
      };
    }

    if (typeof entry.path === 'string') {
      return {
        id: typeof entry.id === 'string' ? entry.id : null,
        path: entry.path,
        timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : null
      };
    }

    return null;
  }

  function getScreenshotsDir() {
    return app.isPackaged
      ? path.join(app.getPath('userData'), '.stealth_screenshots')
      : path.join(__dirname, '..', '..', '..', '..', '.stealth_screenshots');
  }

  function ensureScreenshotsDir() {
    const screenshotsDir = getScreenshotsDir();
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
    return screenshotsDir;
  }

  const captureScreenshot = createScreenshotCapture({
    capturePrimary: (screenshotPath) => screenshot({ filename: screenshotPath })
  });

  function cleanupScreenshotFile(entry) {
    const normalizedEntry = normalizeScreenshotEntry(entry);
    if (normalizedEntry && fs.existsSync(normalizedEntry.path)) {
      fs.unlinkSync(normalizedEntry.path);
    }
  }

  async function takeStealthScreenshot() {
    if (screenshotInProgress) {
      console.log('Screenshot already in progress, skipping');
      return null;
    }

    const mainWindow = getMainWindow();
    const appEnvironment = getAppEnvironment();

    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('Main window not available');
    }

    screenshotInProgress = true;
    try {
      console.log('Taking stealth screenshot...');
      const currentOpacity = mainWindow.getOpacity();
      const screenshotDelay = appEnvironment?.screenshotDelay || 300;

      mainWindow.setOpacity(0.01);
      await new Promise((resolve) => setTimeout(resolve, screenshotDelay));

      const screenshotsDir = ensureScreenshotsDir();
      const screenshotPath = path.join(screenshotsDir, `stealth-${Date.now()}.png`);

      await captureScreenshot(screenshotPath);

      const screenshotEntry = {
        id: nextScreenshotId(),
        path: screenshotPath,
        timestamp: new Date().toISOString()
      };

      screenshots.push(screenshotEntry);
      if (screenshots.length > appEnvironment.maxScreenshots) {
        cleanupScreenshotFile(screenshots.shift());
      }

      mainWindow.setOpacity(currentOpacity);

      console.log(`Screenshot saved: ${screenshotPath}`);
      console.log(`Total screenshots: ${screenshots.length}`);

      sendToRenderer('screenshot-taken-stealth', {
        count: screenshots.length,
        screenshotId: screenshotEntry.id,
        timestamp: screenshotEntry.timestamp
      });

      return screenshotPath;
    } catch (error) {
      try {
        mainWindow.setOpacity(1.0);
      } catch (_) {
        // no-op
      }
      console.error('Stealth screenshot error:', error);
      sendToRenderer('screenshot-error', {
        message: error && error.message ? error.message : 'Screenshot capture failed'
      });
      throw error;
    } finally {
      screenshotInProgress = false;
    }
  }

  async function buildImagePartsFromScreenshots({ strict = true, includeIds = null } = {}) {
    const includeIdSet = Array.isArray(includeIds)
      ? new Set(includeIds.filter((id) => typeof id === 'string' && id.trim().length > 0))
      : null;

    const usableEntries = [];

    for (const entry of screenshots) {
      const normalizedEntry = normalizeScreenshotEntry(entry);
      if (!normalizedEntry) continue;

      if (includeIdSet && (!normalizedEntry.id || !includeIdSet.has(normalizedEntry.id))) {
        continue;
      }

      if (fs.existsSync(normalizedEntry.path)) {
        usableEntries.push(normalizedEntry);
        continue;
      }

      console.error(`Screenshot file not found: ${normalizedEntry.path}`);
      if (strict) {
        throw new Error(`Screenshot file not found: ${normalizedEntry.path}`);
      }
    }

    const imageParts = usableEntries.map((entry) => {
      const imageData = fs.readFileSync(entry.path);
      return {
        inlineData: {
          data: imageData.toString('base64'),
          mimeType: 'image/png'
        }
      };
    });

    return {
      imageParts,
      entries: usableEntries
    };
  }

  function clearStealth() {
    screenshots.forEach((entry) => {
      cleanupScreenshotFile(entry);
    });

    screenshots = [];
    screenshotSequence = 0;

    console.log('All screenshots and context cleared');
    return { success: true };
  }

  function cleanupTransientResources() {
    screenshots.forEach((entry) => {
      cleanupScreenshotFile(entry);
    });

    screenshots = [];
    screenshotSequence = 0;
  }

  function getScreenshotsCount() {
    return screenshots.length;
  }

  function hasScreenshots() {
    return screenshots.length > 0;
  }

  return {
    buildImagePartsFromScreenshots,
    cleanupTransientResources,
    clearStealth,
    getScreenshotsCount,
    hasScreenshots,
    takeStealthScreenshot
  };
}

module.exports = {
  createScreenshotCapture,
  createScreenshotManager
};
