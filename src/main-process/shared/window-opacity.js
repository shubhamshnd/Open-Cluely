'use strict';

// BrowserWindow.setOpacity()/getOpacity() only work on Windows and macOS
// (Electron docs: @platform win32,darwin). On Linux they are silent no-ops, so
// the show/hide shortcut (Alt+Shift+H), the quick hide (Alt+Shift+X), the
// opacity setting, and "fade the app out of its own screenshot" did nothing.
//
// This helper keeps the native call on Windows/macOS and emulates it on Linux:
//   - opacity at or below HIDE_THRESHOLD  -> win.hide()
//   - otherwise                            -> make sure the window is shown
//                                             (without stealing focus) and apply
//                                             the opacity to the page with CSS.

const HIDE_THRESHOLD = 0.05;

const lastOpacity = new WeakMap();
const insertedCssKey = new WeakMap();

function clampOpacity(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0, n));
}

function isUsable(win) {
  return !!win && !(typeof win.isDestroyed === 'function' && win.isDestroyed());
}

async function applyCssOpacity(win, opacity) {
  const contents = win.webContents;
  if (!contents || (typeof contents.isDestroyed === 'function' && contents.isDestroyed())) return;

  const previousKey = insertedCssKey.get(win);
  insertedCssKey.delete(win);
  if (previousKey && typeof contents.removeInsertedCSS === 'function') {
    try { await contents.removeInsertedCSS(previousKey); } catch (_) { /* page reloaded: key gone */ }
  }

  if (opacity < 1 && typeof contents.insertCSS === 'function') {
    const key = await contents.insertCSS(`html { opacity: ${opacity.toFixed(2)} !important; }`);
    insertedCssKey.set(win, key);
  }
}

function setWindowOpacity(win, value, { platform = process.platform } = {}) {
  if (!isUsable(win)) return;
  const opacity = clampOpacity(value);
  lastOpacity.set(win, opacity);

  if (platform !== 'linux') {
    win.setOpacity(opacity);
    return;
  }

  if (opacity <= HIDE_THRESHOLD) {
    if (win.isVisible()) win.hide();
    return;
  }

  if (!win.isVisible()) {
    win.showInactive();
    // Re-assert the always-on-top hint: it can be dropped across hide/show, and
    // without it the window comes back behind the focused app.
    if (typeof win.setAlwaysOnTop === 'function') {
      win.setAlwaysOnTop(true);
      setTimeout(() => {
        if (!(typeof win.isDestroyed === 'function' && win.isDestroyed())) win.setAlwaysOnTop(true);
      }, 50);
    }
  }
  applyCssOpacity(win, opacity).catch((error) => {
    console.warn('[WindowOpacity] Could not apply page opacity on Linux:', error && error.message);
  });
}

function getWindowOpacity(win, { platform = process.platform } = {}) {
  if (!isUsable(win)) return 1;
  if (platform !== 'linux') return win.getOpacity();
  return lastOpacity.has(win) ? lastOpacity.get(win) : 1;
}

module.exports = { setWindowOpacity, getWindowOpacity, HIDE_THRESHOLD };
