'use strict';

// Regression: when port 7823 is already taken (a second copy of the app, or any
// other program), the mobile companion must report the error and stay disabled
// instead of crashing the main process with an uncaught 'error' event from the
// ws WebSocketServer that wraps the HTTP server.

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');

const { createMobileServer } = require('../src/main-process/features/mobile-server/server');

const MOBILE_PORT = 7823;

function occupyPort(port) {
  return new Promise((resolve) => {
    const blocker = net.createServer();
    blocker.once('error', () => resolve(null)); // already taken by something else: still a valid repro
    blocker.listen(port, '0.0.0.0', () => resolve(blocker));
  });
}

test('mobile server survives EADDRINUSE without an uncaught exception', async () => {
  const blocker = await occupyPort(MOBILE_PORT);
  const uncaught = [];
  const onUncaught = (err) => uncaught.push(err);
  process.on('uncaughtException', onUncaught);

  const statuses = [];
  let server;
  try {
    server = createMobileServer({
      getGeminiRuntime: () => null,
      getScreenshotManager: () => null,
      notifyDesktop: (channel, payload) => {
        if (channel === 'mobile-server-status') statuses.push(payload);
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 300));

    assert.equal(uncaught.length, 0, `uncaught: ${uncaught.map((e) => e.message).join('; ')}`);
    const last = server.getStatus();
    assert.equal(last.listening, false);
    assert.match(String(last.error), /EADDRINUSE/);
    assert.ok(statuses.some((s) => s.listening === false && /EADDRINUSE/.test(String(s.error))));
  } finally {
    process.removeListener('uncaughtException', onUncaught);
    if (server) server.close();
    if (blocker) await new Promise((resolve) => blocker.close(resolve));
  }
});
