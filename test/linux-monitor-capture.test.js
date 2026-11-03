'use strict';

// Main-process Linux Host capture: `pw-record -P '{ stream.capture.sink=true }'`
// (audio-only monitor of the default sink, no screencast). OS pieces are
// injected so these tests are deterministic and need no PipeWire.

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { createLinuxMonitorCapture, PW_RECORD_ARGS } = require('../src/services/assembly-ai/linux-monitor-capture.js');

const tick = () => new Promise((resolve) => setImmediate(resolve));

function createFakeChild({ closeOnSigterm = true } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killCalls = [];
  child.kill = (signal) => {
    child.killCalls.push(signal || 'SIGTERM');
    if (signal === 'SIGKILL' || closeOnSigterm) {
      setImmediate(() => child.emit('close', null, signal || 'SIGTERM'));
    }
    return true;
  };
  return child;
}

function createHarness({ children = [], platform = 'linux', ...options } = {}) {
  const spawnCalls = [];
  const made = [];
  const capture = createLinuxMonitorCapture({
    platform,
    spawnFn: (cmd, args, spawnOptions) => {
      spawnCalls.push({ cmd, args, spawnOptions });
      const child = children.length > 0 ? children.shift() : createFakeChild();
      made.push(child);
      return child;
    },
    ...options
  });
  return { capture, spawnCalls, made };
}

async function startRunning(harness, handlers = {}) {
  const promise = harness.capture.start({ onChunk: () => {}, ...handlers });
  await tick();
  const child = harness.made[harness.made.length - 1];
  child.stdout.emit('data', Buffer.alloc(3200, 1));
  const result = await promise;
  return { result, child };
}

test('args target the default sink monitor via stream.capture.sink, raw s16 16k mono to stdout', () => {
  assert.deepEqual(PW_RECORD_ARGS, [
    '-P', '{ stream.capture.sink=true }',
    '--raw', '--rate', '16000', '--channels', '1', '--format', 's16', '-'
  ]);
});

test('start: spawns pw-record, frames stdout into 3200-byte chunks, resolves on first frame', async () => {
  const harness = createHarness();
  const chunks = [];
  const promise = harness.capture.start({ onChunk: (frame) => chunks.push(frame) });
  await tick();

  assert.equal(harness.spawnCalls.length, 1);
  assert.equal(harness.spawnCalls[0].cmd, 'pw-record');
  assert.deepEqual(harness.spawnCalls[0].args, [...PW_RECORD_ARGS]);

  let settled = false;
  promise.then(() => { settled = true; });
  harness.made[0].stdout.emit('data', Buffer.alloc(1000, 3));
  await tick();
  assert.equal(settled, false, 'no full frame yet');

  harness.made[0].stdout.emit('data', Buffer.alloc(4000, 3));
  const result = await promise;
  assert.equal(result.success, true);
  assert.ok(result.token);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].length, 3200);

  harness.made[0].stdout.emit('data', Buffer.alloc(1400, 9));
  assert.equal(chunks.length, 2);

  await harness.capture.stop({ token: result.token });
});

test('start: non-Linux refuses without spawning', async () => {
  const harness = createHarness({ platform: 'win32' });
  const result = await harness.capture.start({ onChunk: () => {} });
  assert.equal(result.success, false);
  assert.match(result.error, /linux/i);
  assert.equal(harness.spawnCalls.length, 0);
});

test('start failures (spawn error, early exit, timeout) report the cause and kill the child', async () => {
  let harness = createHarness();
  let promise = harness.capture.start({ onChunk: () => {} });
  await tick();
  harness.made[0].emit('error', new Error('spawn pw-record ENOENT'));
  let result = await promise;
  assert.equal(result.success, false);
  assert.match(result.error, /ENOENT/);

  harness = createHarness();
  promise = harness.capture.start({ onChunk: () => {} });
  await tick();
  harness.made[0].stderr.emit('data', Buffer.from('connect failed'));
  harness.made[0].emit('close', 1, null);
  result = await promise;
  assert.equal(result.success, false);
  assert.match(result.error, /exited.*connect failed/);

  harness = createHarness({ startupTimeoutMs: 20 });
  result = await harness.capture.start({ onChunk: () => {} });
  assert.equal(result.success, false);
  assert.match(result.error, /timed out/);
  assert.ok(harness.made[0].killCalls.includes('SIGTERM'));
});

test('stop: token must match; stale token and double stop are no-ops; stop({}) stops current', async () => {
  const harness = createHarness();
  const { result, child } = await startRunning(harness);

  assert.deepEqual(await harness.capture.stop({ token: 'stale' }), { stopped: false });
  assert.equal(child.killCalls.length, 0);

  assert.deepEqual(await harness.capture.stop({ token: result.token }), { stopped: true });
  assert.deepEqual(child.killCalls, ['SIGTERM']);
  assert.deepEqual(await harness.capture.stop({ token: result.token }), { stopped: false });
  assert.deepEqual(await harness.capture.stop({}), { stopped: false });

  const second = await startRunning(harness);
  assert.deepEqual(await harness.capture.stop({}), { stopped: true });
  assert.deepEqual(second.child.killCalls, ['SIGTERM']);
});

test('stop: escalates to SIGKILL when SIGTERM is ignored', async () => {
  const stubborn = createFakeChild({ closeOnSigterm: false });
  const harness = createHarness({ children: [stubborn], killGraceMs: 20 });
  const { result } = await startRunning(harness);
  assert.deepEqual(await harness.capture.stop({ token: result.token }), { stopped: true });
  assert.deepEqual(stubborn.killCalls, ['SIGTERM', 'SIGKILL']);
});

test('canceled init: stop({}) while start is pending kills the child, start resolves canceled, no chunks leak', async () => {
  const harness = createHarness();
  const chunks = [];
  const promise = harness.capture.start({ onChunk: (frame) => chunks.push(frame) });
  await tick();

  await harness.capture.stop({});
  const result = await promise;
  assert.equal(result.success, false);
  assert.match(result.error, /cancel/i);
  assert.deepEqual(harness.made[0].killCalls, ['SIGTERM']);

  harness.made[0].stdout.emit('data', Buffer.alloc(6400));
  assert.equal(chunks.length, 0);
});

test('canceled init: stop() that lands while the previous child is still exiting prevents the spawn', async () => {
  const harness = createHarness();
  await startRunning(harness);

  const restart = harness.capture.start({ onChunk: () => {} });
  await harness.capture.stop({});
  const result = await restart;
  assert.equal(result.success, false);
  assert.equal(harness.spawnCalls.length, 1, 'no second pw-record may be spawned after Stop');
});

test('restart: a new start supersedes the running capture (old killed, new token)', async () => {
  const harness = createHarness();
  const first = await startRunning(harness);
  const second = await startRunning(harness);

  assert.deepEqual(first.child.killCalls, ['SIGTERM']);
  assert.equal(harness.spawnCalls.length, 2);
  assert.notEqual(first.result.token, second.result.token);
  assert.deepEqual(await harness.capture.stop({ token: first.result.token }), { stopped: false });
  assert.equal(second.child.killCalls.length, 0);

  await harness.capture.stop({ token: second.result.token });
});

test('unexpected exit after start notifies onEnded and clears state', async () => {
  const harness = createHarness();
  let ended = null;
  const { child } = await startRunning(harness, { onEnded: (info) => { ended = info; } });
  child.emit('close', 1, null);
  assert.equal(ended.code, 1);
  assert.deepEqual(await harness.capture.stop({}), { stopped: false });

  const again = await startRunning(harness);
  assert.equal(again.result.success, true);
  await harness.capture.stop({});
});

test('requested stop does not fire onEnded', async () => {
  const harness = createHarness();
  let endedCalls = 0;
  const { result } = await startRunning(harness, { onEnded: () => { endedCalls += 1; } });
  await harness.capture.stop({ token: result.token });
  assert.equal(endedCalls, 0);
});

test('dispose: synchronously kills the active capture once', async () => {
  const harness = createHarness();
  const { child } = await startRunning(harness);
  harness.capture.dispose();
  assert.deepEqual(child.killCalls, ['SIGTERM']);
  harness.capture.dispose();
  assert.equal(child.killCalls.length, 1);
  await tick();
});

test('dispose while start is pending cancels it', async () => {
  const harness = createHarness();
  const promise = harness.capture.start({ onChunk: () => {} });
  await tick();
  harness.capture.dispose();
  const result = await promise;
  assert.equal(result.success, false);
  assert.deepEqual(harness.made[0].killCalls, ['SIGTERM']);
});

test('REGRESSION ownership: a restart cannot spawn while the stopping predecessor is still alive', async () => {
  const stubborn = createFakeChild({ closeOnSigterm: false });
  const harness = createHarness({ children: [stubborn], killGraceMs: 1000 });
  const first = await startRunning(harness);

  const stopping = harness.capture.stop({ token: first.result.token });
  const restarting = harness.capture.start({ onChunk: () => {} });
  await tick();

  assert.equal(harness.spawnCalls.length, 1, 'the replacement must wait for the terminating child to exit');
  assert.deepEqual(stubborn.killCalls, ['SIGTERM']);

  stubborn.emit('close', 0, null);
  await stopping;
  await tick();

  assert.equal(harness.spawnCalls.length, 2, 'the replacement spawns once the predecessor exited');
  const secondChild = harness.made[harness.made.length - 1];
  assert.notEqual(secondChild, stubborn);
  secondChild.stdout.emit('data', Buffer.alloc(3200, 1));
  const second = await restarting;
  assert.equal(second.success, true);
  await harness.capture.stop({ token: second.token });
});

test('REGRESSION ownership: Stop while a restart is queued behind the terminating predecessor cancels the spawn', async () => {
  const stubborn = createFakeChild({ closeOnSigterm: false });
  const harness = createHarness({ children: [stubborn], killGraceMs: 1000 });
  await startRunning(harness);

  const restarting = harness.capture.start({ onChunk: () => {} });
  assert.equal(harness.spawnCalls.length, 1);

  const stopping = harness.capture.stop({});
  stubborn.emit('close', 0, null);
  assert.deepEqual(await stopping, { stopped: true }, 'Stop owns and cancels the pending start');

  const result = await restarting;
  assert.equal(result.success, false);
  assert.match(result.error, /cancel/i);
  await tick();
  assert.equal(harness.spawnCalls.length, 1, 'no replacement may spawn after Stop');
});

test('REGRESSION ownership: dispose awaits the SIGKILL escalation of a child ignoring SIGTERM', async () => {
  const stubborn = createFakeChild({ closeOnSigterm: false }); // closes only on SIGKILL
  const harness = createHarness({ children: [stubborn], killGraceMs: 30 });
  await startRunning(harness);

  let disposed = false;
  const disposing = Promise.resolve(harness.capture.dispose()).then(() => {
    disposed = true;
  });
  await tick();
  assert.deepEqual(stubborn.killCalls, ['SIGTERM']);
  assert.equal(disposed, false, 'dispose must wait until the child actually exited');

  await new Promise((resolve) => setTimeout(resolve, 80)); // killGraceMs elapses → SIGKILL → close
  await disposing;
  assert.deepEqual(stubborn.killCalls, ['SIGTERM', 'SIGKILL']);
  assert.equal(disposed, true);
});

test('dispose also covers a child whose stop is already in flight', async () => {
  const stubborn = createFakeChild({ closeOnSigterm: false });
  const harness = createHarness({ children: [stubborn], killGraceMs: 30 });
  const first = await startRunning(harness);

  const stopping = harness.capture.stop({ token: first.result.token });
  const disposing = Promise.resolve(harness.capture.dispose());
  stubborn.emit('close', 0, null);
  await stopping;
  await disposing; // must resolve, not hang on an already-terminating child
});
