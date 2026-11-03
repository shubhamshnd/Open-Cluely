'use strict';

// app-state.json holds every API key the user saved in Settings. The file
// must not be world/group-readable: mode 0600, and its directory 0700.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadAppState, saveAppState, getAppStatePath } = require('../src/services/state/app-state.js');

function createTmpApp() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'opencluely-state-perms-'));
  return {
    userData,
    app: {
      isPackaged: true,
      getPath: (name) => (name === 'userData' ? userData : userData)
    }
  };
}

function modeOf(target) {
  return fs.statSync(target).mode & 0o777;
}

test('app-state.json is written 0600 and its directory 0700', () => {
  const { app, userData } = createTmpApp();
  try {
    saveAppState(app, { geminiApiKey: 'FAKE-KEY-123' });

    const statePath = getAppStatePath(app);
    const stateDir = path.dirname(statePath);
    assert.ok(fs.existsSync(statePath), 'state file exists after save');
    assert.equal(modeOf(statePath), 0o600, `state file mode must be 0600, got ${modeOf(statePath).toString(8)}`);
    assert.equal(modeOf(stateDir), 0o700, `state dir mode must be 0700, got ${modeOf(stateDir).toString(8)}`);
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('an existing wide-open state file is tightened on the next load', () => {
  const { app, userData } = createTmpApp();
  try {
    const statePath = getAppStatePath(app);
    fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o755 });
    fs.writeFileSync(statePath, `${JSON.stringify({ geminiApiKey: 'FAKE-KEY-123' })}\n`, { mode: 0o644 });
    fs.chmodSync(path.dirname(statePath), 0o755);

    loadAppState(app); // load rewrites the sanitized state

    assert.equal(modeOf(statePath), 0o600, 'load must tighten the file to 0600');
    assert.equal(modeOf(path.dirname(statePath)), 0o700, 'load must tighten the dir to 0700');
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('saved content still round-trips after permission hardening', () => {
  const { app, userData } = createTmpApp();
  try {
    saveAppState(app, { geminiApiKey: 'FAKE-KEY-123', awsAuthMode: 'default' });
    const loaded = loadAppState(app);
    assert.equal(loaded.geminiApiKey, 'FAKE-KEY-123');
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
