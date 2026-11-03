'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createScreenshotCapture } = require('../src/main-process/features/assistant/screenshot-manager');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'screenshot-capture-test-'));
}

test('uses the CLI capture alone when it succeeds', async () => {
  const dir = makeTempDir();
  const target = path.join(dir, 'shot.png');
  const calls = [];
  const capture = createScreenshotCapture({
    platform: 'linux',
    capturePrimary: async (screenshotPath) => {
      calls.push(['primary', screenshotPath]);
      fs.writeFileSync(screenshotPath, 'png');
    },
    captureFallback: async () => {
      calls.push(['fallback']);
    }
  });

  await capture(target);

  assert.deepEqual(calls, [['primary', target]]);
  assert.equal(fs.readFileSync(target, 'utf8'), 'png');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('falls back to the Electron capture once when the CLI capture fails on Linux', async () => {
  const dir = makeTempDir();
  const target = path.join(dir, 'shot.png');
  const calls = [];
  const capture = createScreenshotCapture({
    platform: 'linux',
    capturePrimary: async () => {
      calls.push('primary');
      throw new Error('spawn xrandr ENOENT');
    },
    captureFallback: async (screenshotPath) => {
      calls.push('fallback');
      fs.writeFileSync(screenshotPath, 'fallback-png');
    }
  });

  await capture(target);

  assert.deepEqual(calls, ['primary', 'fallback']);
  assert.equal(fs.readFileSync(target, 'utf8'), 'fallback-png');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('falls back when the CLI capture completes without writing a file', async () => {
  const dir = makeTempDir();
  const target = path.join(dir, 'shot.png');
  const calls = [];
  const capture = createScreenshotCapture({
    platform: 'linux',
    capturePrimary: async () => {
      calls.push('primary');
    },
    captureFallback: async (screenshotPath) => {
      calls.push('fallback');
      fs.writeFileSync(screenshotPath, 'fallback-png');
    }
  });

  await capture(target);

  assert.deepEqual(calls, ['primary', 'fallback']);
  assert.equal(fs.readFileSync(target, 'utf8'), 'fallback-png');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('times out a hung CLI capture and falls back', async () => {
  const dir = makeTempDir();
  const target = path.join(dir, 'shot.png');
  const capture = createScreenshotCapture({
    platform: 'linux',
    cliTimeoutMs: 25,
    capturePrimary: () => new Promise(() => {}),
    captureFallback: async (screenshotPath) => {
      fs.writeFileSync(screenshotPath, 'fallback-png');
    }
  });

  await capture(target);

  assert.equal(fs.readFileSync(target, 'utf8'), 'fallback-png');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('rethrows the CLI error without trying the fallback on non-Linux platforms', async () => {
  const calls = [];
  const capture = createScreenshotCapture({
    platform: 'win32',
    capturePrimary: async () => {
      calls.push('primary');
      throw new Error('spawn ENOENT');
    },
    captureFallback: async () => {
      calls.push('fallback');
    }
  });

  await assert.rejects(capture('unused.png'), /spawn ENOENT/);
  assert.deepEqual(calls, ['primary']);
});

test('reports a clear install-hint message when both captures fail on Linux', async () => {
  const capture = createScreenshotCapture({
    platform: 'linux',
    capturePrimary: async () => {
      throw new Error('spawn ENOENT');
    },
    captureFallback: async () => {
      throw new Error('desktopCapturer returned no screen sources');
    }
  });

  await assert.rejects(capture('unused.png'), (error) => {
    assert.match(error.message, /No screenshot method available/);
    assert.match(error.message, /gnome-screenshot/);
    assert.match(error.message, /scrot/);
    assert.equal(error.cause && error.cause.message, 'desktopCapturer returned no screen sources');
    return true;
  });
});
