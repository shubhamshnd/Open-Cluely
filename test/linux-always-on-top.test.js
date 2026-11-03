'use strict';

// On Linux the window had no _NET_WM_STATE_ABOVE hint (window.js only called
// setAlwaysOnTop for win32/darwin). After the show/hide shortcut the window came
// back BEHIND the focused browser/Meet window, so it looked like nothing
// happened. The hint must be set at creation, on every 'show', and after the
// opacity helper re-shows the window.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { setWindowOpacity } = require('../src/main-process/shared/window-opacity');

test('opacity helper re-asserts always-on-top after showing on Linux', async () => {
  const calls = [];
  let shown = false;
  const win = {
    isDestroyed: () => false,
    isVisible: () => shown,
    hide: () => { shown = false; },
    showInactive: () => { shown = true; calls.push('showInactive'); },
    setAlwaysOnTop: (v) => calls.push(`alwaysOnTop:${v}`),
    webContents: { isDestroyed: () => false, insertCSS: async () => 'k', removeInsertedCSS: async () => {} }
  };
  setWindowOpacity(win, 1, { platform: 'linux' });
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(calls[0], 'showInactive');
  assert.ok(calls.filter((c) => c === 'alwaysOnTop:true').length >= 2, 'immediate and delayed re-assert');
});

test('window.js sets always-on-top on Linux at creation and on every show', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'windows', 'assistant', 'window.js'), 'utf8');
  assert.match(src, /process\.platform === 'linux'[\s\S]{0,600}setAlwaysOnTop\(true\)/);
  assert.match(src, /mainWindow\.on\('show'/);
});
