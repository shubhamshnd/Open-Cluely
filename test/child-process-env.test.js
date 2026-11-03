'use strict';

// Spawned helpers (pw-record, gsettings) must not inherit API keys through
// the process environment.

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

const { SECRET_ENV_VARS, scrubSecretEnvVars } = require('../src/main-process/shared/child-process-env.js');
const { createLinuxMonitorCapture } = require('../src/services/assembly-ai/linux-monitor-capture.js');
const { createGnomeShortcutInstaller } = require('../src/main-process/shared/shortcut-actions.js');

const SECRET_FILLED_ENV = {
  PATH: '/usr/bin',
  XDG_CURRENT_DESKTOP: 'GNOME',
  DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
  GEMINI_API_KEY: 'FAKE-KEY-123',
  ASSEMBLY_AI_API_KEY: 'FAKE-KEY-123',
  OPENAI_API_KEY: 'FAKE-KEY-123',
  ANTHROPIC_API_KEY: 'FAKE-KEY-123',
  AWS_ACCESS_KEY_ID: 'AKIAFAKEKEY0000000',
  AWS_SECRET_ACCESS_KEY: 'fakeSecretKeyfakeSecretKeyfakeSec',
  AWS_SESSION_TOKEN: 'FAKE-KEY-123',
  BEDROCK_API_KEY: 'FAKE-KEY-123'
};

test('scrubSecretEnvVars removes every known secret var and keeps the rest', () => {
  const scrubbed = scrubSecretEnvVars(SECRET_FILLED_ENV);
  for (const name of SECRET_ENV_VARS) {
    assert.ok(!(name in scrubbed), `${name} must not reach child processes`);
  }
  assert.equal(scrubbed.PATH, '/usr/bin');
  assert.equal(scrubbed.XDG_CURRENT_DESKTOP, 'GNOME');
  // Input object is not mutated.
  assert.equal(SECRET_FILLED_ENV.GEMINI_API_KEY, 'FAKE-KEY-123');
});

function createFakePwRecordChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {
    queueMicrotask(() => child.emit('close', 0, null));
    return true;
  };
  return child;
}

test('pw-record is spawned with a scrubbed environment', async () => {
  let seenOptions = null;
  const capture = createLinuxMonitorCapture({
    platform: 'linux',
    startupTimeoutMs: 50,
    spawnFn: (cmd, args, options) => {
      seenOptions = options;
      return createFakePwRecordChild();
    }
  });

  const originalEnv = process.env;
  process.env = { ...SECRET_FILLED_ENV };
  try {
    await capture.start(() => {});
  } finally {
    process.env = originalEnv;
    await capture.dispose();
  }

  assert.ok(seenOptions, 'spawn options captured');
  assert.ok(seenOptions.env, 'spawn receives an explicit scrubbed env');
  for (const name of SECRET_ENV_VARS) {
    assert.ok(!(name in seenOptions.env), `${name} must not reach pw-record`);
  }
  assert.equal(seenOptions.env.PATH, '/usr/bin', 'non-secret vars survive');
});

test('gsettings is execFiled with a scrubbed environment', async () => {
  let seenOptions = null;
  const installer = createGnomeShortcutInstaller({
    platform: 'linux',
    env: SECRET_FILLED_ENV,
    procEnviron: { XDG_CURRENT_DESKTOP: 'GNOME' },
    execPath: '/usr/bin/electron',
    appPath: '/app',
    shortcuts: [{ id: 'toggleStealth', name: 'Open Cluely: Toggle Stealth', accelerator: 'Alt+Shift+H' }],
    execFileImpl: (file, args, options) => {
      seenOptions = options;
      if (args[0] === 'get') {
        return Promise.resolve('@as []');
      }
      return Promise.resolve('');
    }
  });

  const result = await installer.install();
  assert.equal(result.success, true);
  assert.ok(seenOptions, 'execFile options captured');
  assert.ok(seenOptions.env, 'gsettings receives an explicit scrubbed env');
  for (const name of SECRET_ENV_VARS) {
    assert.ok(!(name in seenOptions.env), `${name} must not reach gsettings`);
  }
  assert.equal(seenOptions.env.PATH, '/usr/bin', 'non-secret vars survive');
});
