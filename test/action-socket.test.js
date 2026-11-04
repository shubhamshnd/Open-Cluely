'use strict';

// GNOME keybinding fast path: the keybinding runs a generated sh script that
// writes the action id to the running app's private Unix socket, instead of
// launching a second Electron process per keypress (~0.8 s, which made users
// press repeatedly so toggles cancelled out).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const {
  buildGnomeShortcutScript,
  getActionSocketPath,
  startActionSocketServer
} = require('../src/main-process/shared/action-socket');
const { createGnomeShortcutInstaller } = require('../src/main-process/shared/shortcut-actions');

const linuxOnly = { skip: process.platform !== 'linux' };
const quietLog = { warn() {}, error() {} };

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'oc-sock-'));
}

test('generated script is valid sh and quotes paths with spaces and quotes', linuxOnly, () => {
  const dir = tmpDir();
  const script = buildGnomeShortcutScript({
    socketPath: path.join(dir, "a b'c", 'action.sock'),
    fallbackArgv: ['/opt/Open Cluely/app.AppImage']
  });
  const file = path.join(dir, 's.sh');
  fs.writeFileSync(file, script);
  execFileSync('sh', ['-n', file]); // syntax check throws on error
  assert.match(script, /SOCK='.*a b'\\''c\/action\.sock'/);
  assert.match(script, /exec '\/opt\/Open Cluely\/app\.AppImage' --action="\$ACTION"/);
});

test('socket server: known action runs, unknown/injected ignored, mode 0600', linuxOnly, async () => {
  const dir = tmpDir();
  const socketPath = getActionSocketPath(dir);
  const ran = [];
  const server = await startActionSocketServer({
    socketPath,
    isKnownAction: (id) => id === 'toggleStealth',
    onAction: (id) => ran.push(id),
    log: quietLog
  });
  try {
    assert.equal(fs.statSync(socketPath).mode & 0o777, 0o600);
    const send = (payload) => new Promise((resolve) => {
      const c = require('net').connect(socketPath, () => c.end(payload));
      c.on('close', resolve);
    });
    await send('toggleStealth\n');
    await send('constructor');
    await send('toggleStealth; rm -rf /');
    await send('x'.repeat(500));
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(ran, ['toggleStealth']);
  } finally {
    server.close();
  }
  assert.equal(fs.existsSync(socketPath), false, 'socket removed on close');
});

test('end to end: generated script + python3 reaches the server quickly', linuxOnly, async (t) => {
  if (spawnSync('sh', ['-c', 'command -v python3']).status !== 0) {
    t.skip('python3 not available');
    return;
  }
  const dir = tmpDir();
  const socketPath = getActionSocketPath(dir);
  const ran = [];
  const server = await startActionSocketServer({
    socketPath,
    isKnownAction: (id) => id === 'moveWindowLeft',
    onAction: (id) => ran.push(id),
    log: quietLog
  });
  const script = path.join(dir, 'gnome-shortcut.sh');
  // Fallback must NOT run when the socket works: point it at `false`.
  fs.writeFileSync(script, buildGnomeShortcutScript({ socketPath, fallbackArgv: ['false'] }), { mode: 0o700 });
  try {
    const started = Date.now();
    const result = await new Promise((resolve) => {
      require('child_process').execFile('sh', [script, 'moveWindowLeft'], (error) => resolve(error));
    });
    const ms = Date.now() - started;
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(result, null, 'script exits 0 via the socket, not the fallback');
    assert.deepEqual(ran, ['moveWindowLeft']);
    assert.ok(ms < 500, `fast path took ${ms} ms`);
    // Bad action ids are rejected by the script itself.
    const bad = spawnSync('sh', [script, 'a;b']);
    assert.equal(bad.status, 2);
  } finally {
    server.close();
  }
});

test('installer writes the script, points GNOME at it, and removes it', async () => {
  const calls = [];
  const writes = [];
  const removed = [];
  let list = "['/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/']";
  const installer = createGnomeShortcutInstaller({
    platform: 'linux',
    env: {},
    procEnviron: { XDG_CURRENT_DESKTOP: 'GNOME' },
    execPath: '/x/electron',
    appPath: '/x/app',
    userDataPath: '/home/u/.config/open-cluely',
    shortcuts: [{ id: 'toggleStealth', name: 'Open Cluely: Toggle', accelerator: 'Alt+Shift+H' }],
    writeScriptImpl: (file, content) => writes.push({ file, content }),
    removeScriptImpl: (file) => removed.push(file),
    execFileImpl: async (_file, args) => {
      calls.push(args);
      if (args[0] === 'get') return list;
      if (args[0] === 'set' && args[2] === 'custom-keybindings') list = args[3];
      return '';
    }
  });

  const added = await installer.install();
  assert.equal(added.success, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].file, '/home/u/.config/open-cluely/gnome-shortcut.sh');
  assert.match(writes[0].content, /exec '\/x\/electron' '\/x\/app' '--no-sandbox' --action="\$ACTION"/);
  const commandSet = calls.find((a) => a[0] === 'set' && a[2] === 'command');
  assert.equal(commandSet[3], `'"/home/u/.config/open-cluely/gnome-shortcut.sh" toggleStealth'`);
  assert.match(list, /custom0/);

  const gone = await installer.remove();
  assert.equal(gone.success, true);
  assert.deepEqual(removed, ['/home/u/.config/open-cluely/gnome-shortcut.sh']);
  assert.equal(list, "['/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/']");
});

test('installer from a packaged .deb writes a script whose fallback is execPath alone', async () => {
  const writes = [];
  const installer = createGnomeShortcutInstaller({
    platform: 'linux',
    env: {},
    procEnviron: { XDG_CURRENT_DESKTOP: 'GNOME' },
    execPath: '/opt/Open Cluely/open-cluely',
    appPath: '/opt/Open Cluely/resources/app.asar',
    isPackaged: true,
    userDataPath: '/home/u/.config/open-cluely',
    shortcuts: [{ id: 'toggleStealth', name: 'Open Cluely: Toggle', accelerator: 'Alt+Shift+H' }],
    writeScriptImpl: (file, content) => writes.push({ file, content }),
    execFileImpl: async (_file, args) => (args[0] === 'get' ? '@as []' : '')
  });

  const added = await installer.install();
  assert.equal(added.success, true);
  assert.equal(writes.length, 1);
  assert.match(writes[0].content, /exec '\/opt\/Open Cluely\/open-cluely' --action="\$ACTION"/);
  assert.ok(!writes[0].content.includes('--no-sandbox'), 'a SUID-sandboxed .deb must not force --no-sandbox');
  assert.ok(!writes[0].content.includes('app.asar'), 'packaged installs must not pass the app path');
});

test('the SystemIdleProcess process-title disguise is gone', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main-process', 'start-application.js'), 'utf8');
  assert.doesNotMatch(src, /SystemIdleProcess|process\.title\s*=/);
});
