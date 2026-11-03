'use strict';

// Linux Host capture IPC ownership: the main-process capture is tied to the
// renderer document that requested it. Reload/navigation, render-process loss
// and window destruction must release it; another sender's lifecycle and a
// superseded owner's cleanup must not touch the live capture.

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { registerAssemblyAiIpc } = require('../src/services/assembly-ai/ipc.js');

function createIpcHarness({ captureOverrides = {} } = {}) {
  const handlers = new Map();
  const ipcMain = {
    handle: (channel, fn) => handlers.set(channel, fn),
    on: () => {}
  };
  const stops = [];
  let tokenCounter = 0;
  const capture = {
    start: async () => {
      tokenCounter += 1;
      return { success: true, token: `tok-${tokenCounter}` };
    },
    stop: async (args) => {
      stops.push(args);
      return { stopped: true };
    },
    dispose: () => {},
    ...captureOverrides
  };
  const service = {
    handleAudioChunk: () => {},
    emitSttDebug: () => {},
    startAssemblyAiStream: () => ({}),
    stopVoiceRecognition: () => ({}),
    getDesktopSources: async () => [],
    transcribeAudio: async () => ({})
  };
  const sent = [];
  registerAssemblyAiIpc({
    ipcMain,
    assemblyAiService: service,
    linuxMonitorCapture: capture,
    sendToRenderer: (channel, data) => sent.push([channel, data])
  });
  return { handlers, stops, sent };
}

const invoke = (handlers, channel, sender, payload) => handlers.get(channel)({ sender }, payload);

function createSender() {
  return new EventEmitter();
}

test('ipc: a full main-frame navigation (reload) stops the owned capture by token', async () => {
  const { handlers, stops } = createIpcHarness();
  const sender = createSender();

  const start = await invoke(handlers, 'start-linux-monitor-capture', sender);
  assert.equal(start.success, true);
  assert.equal(stops.length, 0);

  // webContents 'did-start-navigation': (event, url, isInPlace, isMainFrame)
  sender.emit('did-start-navigation', {}, 'https://app.local/', false, true);
  assert.deepEqual(stops, [{ token: 'tok-1' }]);
});

test('ipc: in-place and non-main-frame navigations keep the capture running', async () => {
  const { handlers, stops } = createIpcHarness();
  const sender = createSender();

  await invoke(handlers, 'start-linux-monitor-capture', sender);
  sender.emit('did-start-navigation', {}, 'https://app.local/#section', true, true); // same document
  sender.emit('did-start-navigation', {}, 'https://frame.local/', false, false); // subframe
  assert.deepEqual(stops, []);

  sender.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.deepEqual(stops, [{ token: 'tok-1' }], 'renderer loss releases the capture');
});

test('ipc: window destroy stops the owned capture; another sender cannot stop it', async () => {
  const { handlers, stops } = createIpcHarness();
  const owner = createSender();
  const intruder = createSender();

  await invoke(handlers, 'start-linux-monitor-capture', owner);
  intruder.emit('did-start-navigation', {}, 'https://other/', false, true);
  intruder.emit('destroyed');
  assert.deepEqual(stops, [], 'an unrelated sender lifecycle must not stop the capture');

  owner.emit('destroyed');
  assert.deepEqual(stops, [{ token: 'tok-1' }]);
});

test('ipc: cleanup from a superseded owner cannot stop the replacement capture', async () => {
  const { handlers, stops } = createIpcHarness();
  const first = createSender();
  const second = createSender();

  await invoke(handlers, 'start-linux-monitor-capture', first); // tok-1
  await invoke(handlers, 'start-linux-monitor-capture', second); // tok-2 supersedes

  first.emit('did-start-navigation', {}, 'https://app.local/', false, true);
  first.emit('destroyed');
  assert.deepEqual(stops, [], 'the old owner must not stop the replacement');

  second.emit('destroyed');
  assert.deepEqual(stops, [{ token: 'tok-2' }]);
});

test('ipc: navigation while the start is still pending cancels it with a token-less stop', async () => {
  let releaseStart;
  const pending = new Promise((resolve) => {
    releaseStart = resolve;
  });
  let startCalls = 0;
  const { handlers, stops } = createIpcHarness({
    captureOverrides: {
      start: async () => {
        startCalls += 1;
        if (startCalls === 1) {
          return pending; // first start hangs until the test releases it
        }
        return { success: true, token: 'tok-2' };
      }
    }
  });
  const sender = createSender();

  const starting = invoke(handlers, 'start-linux-monitor-capture', sender);
  sender.emit('did-start-navigation', {}, 'https://app.local/', false, true);
  assert.deepEqual(stops, [{}], 'a pending start has no token yet, so it is canceled token-less');

  releaseStart({ success: false, error: 'Host audio capture was canceled' });
  await starting;

  // The replacement document (same webContents) can start a new capture.
  const restart = await invoke(handlers, 'start-linux-monitor-capture', sender);
  assert.equal(restart.success, true);
});

test('ipc: an explicit stop releases ownership; a later navigation does not stop again', async () => {
  const { handlers, stops } = createIpcHarness();
  const sender = createSender();

  const start = await invoke(handlers, 'start-linux-monitor-capture', sender);
  await invoke(handlers, 'stop-linux-monitor-capture', sender, { token: start.token });
  assert.deepEqual(stops, [{ token: 'tok-1' }]);

  sender.emit('did-start-navigation', {}, 'https://app.local/', false, true);
  assert.equal(stops.length, 1, 'no double stop after the renderer already stopped it');
});

test('ipc: a stale token stop cannot release ownership of the live capture', async () => {
  const { handlers, stops } = createIpcHarness({
    captureOverrides: {
      stop: async (args) => {
        stops.push(args);
        return { stopped: false }; // capture module rejects the mismatched token
      }
    }
  });
  const sender = createSender();

  await invoke(handlers, 'start-linux-monitor-capture', sender);
  await invoke(handlers, 'stop-linux-monitor-capture', sender, { token: 'stale' });
  sender.emit('destroyed');
  assert.deepEqual(stops, [{ token: 'stale' }, { token: 'tok-1' }], 'ownership survived the stale stop');
});

test('ipc: a renderer-owned attempt id becomes the capture token and correlates the death error', async () => {
  const seen = [];
  let ended;
  const { handlers, sent, stops } = createIpcHarness({
    captureOverrides: {
      start: async (options) => {
        seen.push(options);
        ended = options.onEnded;
        return { success: true, token: options.token };
      }
    }
  });
  const sender = createSender();

  const start = await invoke(handlers, 'start-linux-monitor-capture', sender, { attemptId: 'att-1' });
  assert.equal(start.token, 'att-1', 'the capture adopts the renderer-owned attempt id as its token');
  assert.equal(seen[0].token, 'att-1');

  ended({ code: 1 });
  assert.deepEqual(sent, [
    [
      'vosk-error',
      {
        source: 'system',
        error: 'Host audio capture stopped unexpectedly (pw-record exit code 1)',
        captureToken: 'att-1',
        attemptId: 'att-1'
      }
    ]
  ]);

  // Ownership was released with the death: no later stop from owner cleanup.
  sender.emit('destroyed');
  assert.equal(stops.length, 0);
});

test('ipc: a pending start with a renderer attempt id is canceled by that token, not token-less', async () => {
  let releaseStart;
  const pending = new Promise((resolve) => {
    releaseStart = resolve;
  });
  const { handlers, stops } = createIpcHarness({
    captureOverrides: {
      start: async () => pending
    }
  });
  const sender = createSender();

  const starting = invoke(handlers, 'start-linux-monitor-capture', sender, { attemptId: 'att-1' });
  sender.emit('did-start-navigation', {}, 'https://app.local/', false, true);
  assert.deepEqual(stops, [{ token: 'att-1' }], 'an attempt-scoped owner cancels by its own token');

  releaseStart({ success: false, error: 'Host audio capture was canceled' });
  await starting;
});

test('ipc: an unexpected end of the owned capture reports a token-correlated vosk-error and releases ownership', async () => {
  let ended;
  const { handlers, sent, stops } = createIpcHarness({
    captureOverrides: {
      start: async ({ onEnded }) => {
        ended = onEnded;
        return { success: true, token: 'tok-1' };
      }
    }
  });
  const sender = createSender();

  await invoke(handlers, 'start-linux-monitor-capture', sender);
  ended({ code: 1 });

  assert.deepEqual(sent, [
    [
      'vosk-error',
      {
        source: 'system',
        error: 'Host audio capture stopped unexpectedly (pw-record exit code 1)',
        captureToken: 'tok-1'
      }
    ]
  ]);

  // Ownership was released: a later navigation must not stop the dead capture again.
  sender.emit('did-start-navigation', {}, 'https://app.local/', false, true);
  assert.equal(stops.length, 0);
});

test('ipc: a superseded owner capture end is not reported to the live session', async () => {
  const endings = [];
  const { handlers, sent } = createIpcHarness({
    captureOverrides: {
      start: async ({ onEnded }) => {
        endings.push(onEnded);
        return { success: true, token: `tok-${endings.length}` };
      }
    }
  });
  const first = createSender();
  const second = createSender();

  await invoke(handlers, 'start-linux-monitor-capture', first); // tok-1
  await invoke(handlers, 'start-linux-monitor-capture', second); // tok-2 supersedes

  endings[0]({ code: 1 }); // the old capture dies late
  assert.deepEqual(sent, [], 'a superseded capture end must not error the live session');

  endings[1]({ code: 1 }); // the live capture's end is reported with its own token
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 'vosk-error');
  assert.equal(sent[0][1].captureToken, 'tok-2');
});
