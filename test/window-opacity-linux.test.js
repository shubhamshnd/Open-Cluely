'use strict';

// BrowserWindow.setOpacity is a no-op on Linux (Electron: win32/darwin only), so
// show/hide (Alt+Shift+H), quick hide and the opacity setting did nothing there.
// window-opacity.js emulates it on Linux with hide()/showInactive() + page CSS.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { setWindowOpacity, getWindowOpacity } = require('../src/main-process/shared/window-opacity');

function fakeWindow({ visible = true } = {}) {
  const calls = [];
  let shown = visible;
  let nextKey = 0;
  const win = {
    calls,
    isDestroyed: () => false,
    isVisible: () => shown,
    hide: () => { calls.push('hide'); shown = false; },
    showInactive: () => { calls.push('showInactive'); shown = true; },
    setOpacity: (o) => calls.push(`setOpacity:${o}`),
    getOpacity: () => 0.7,
    webContents: {
      isDestroyed: () => false,
      insertCSS: async (css) => { calls.push(`insertCSS:${css}`); return `k${++nextKey}`; },
      removeInsertedCSS: async (key) => { calls.push(`removeCSS:${key}`); }
    }
  };
  return win;
}

const tick = () => new Promise((r) => setImmediate(r));

test('Windows/macOS keep the native setOpacity call', () => {
  for (const platform of ['win32', 'darwin']) {
    const win = fakeWindow();
    setWindowOpacity(win, 0.02, { platform });
    assert.deepEqual(win.calls, ['setOpacity:0.02']);
    assert.equal(getWindowOpacity(win, { platform }), 0.7);
  }
});

test('Linux: stealth-level opacity hides the window instead of a no-op', () => {
  const win = fakeWindow();
  setWindowOpacity(win, 0.02, { platform: 'linux' });
  assert.deepEqual(win.calls, ['hide']);
  assert.equal(win.isVisible(), false);
  assert.equal(getWindowOpacity(win, { platform: 'linux' }), 0.02);
});

test('Linux: showing again uses showInactive and full opacity adds no CSS', async () => {
  const win = fakeWindow({ visible: false });
  setWindowOpacity(win, 1, { platform: 'linux' });
  await tick();
  assert.deepEqual(win.calls, ['showInactive']);
  assert.equal(win.isVisible(), true);
});

test('Linux: partial opacity is applied as page CSS and replaced, not stacked', async () => {
  const win = fakeWindow();
  setWindowOpacity(win, 0.6, { platform: 'linux' });
  await tick();
  setWindowOpacity(win, 1, { platform: 'linux' });
  await tick(); await tick();
  assert.ok(win.calls.some((c) => c.startsWith('insertCSS:') && c.includes('opacity: 0.60')));
  assert.ok(win.calls.includes('removeCSS:k1'), 'previous CSS removed when opacity changes');
  assert.ok(!win.calls.some((c) => c.startsWith('setOpacity')), 'no native no-op call on Linux');
});

test('no remaining direct setOpacity/getOpacity calls in main-process code', () => {
  const root = path.join(__dirname, '..', 'src', 'main-process');
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (p.endsWith('.js') && !p.endsWith('window-opacity.js')) {
        const src = fs.readFileSync(p, 'utf8');
        if (/\.(setOpacity|getOpacity)\(/.test(src)) offenders.push(path.relative(root, p));
      }
    }
  };
  walk(root);
  assert.deepEqual(offenders, []);
});
