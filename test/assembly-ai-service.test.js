'use strict';

// STT backend session correlation: events from a superseded WebSocket must not
// tear down or mutate the session that replaced it.

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { createAssemblyAiService } = require('../src/services/assembly-ai/service.js');

function createHarness() {
  const events = [];
  const sockets = [];

  class FakeWebSocket extends EventEmitter {
    static OPEN = 1;

    constructor(url) {
      super();
      this.url = url;
      this.readyState = FakeWebSocket.OPEN;
      this.sent = [];
      sockets.push(this);
    }

    send(data) {
      this.sent.push(data);
    }

    terminate() {
      this.readyState = 3;
    }
  }

  const service = createAssemblyAiService({
    WebSocket: FakeWebSocket,
    desktopCapturer: { getSources: async () => [] },
    getAssemblyApiKey: () => 'test-key',
    getSpeechModel: () => 'test-model',
    getGeminiService: () => null,
    sendToRenderer: (channel, payload) => events.push([channel, payload])
  });

  return { service, events, sockets };
}

const terminationFrame = () => JSON.stringify({ type: 'Termination', audio_duration_seconds: 1 });
const voskEvents = (events, channel) => events.filter(([name]) => name === channel);

test('service: events from a superseded socket cannot stop or mutate the live session', () => {
  const { service, events, sockets } = createHarness();

  service.startAssemblyAiStream('system');
  sockets[0].emit('open');
  service.stopVoiceRecognition({ source: 'system' }); // Terminate sent to socket 1

  service.startAssemblyAiStream('system');
  sockets[1].emit('open');
  assert.equal(sockets.length, 2);

  // Late Termination + close + transcripts from the old socket arrive now.
  sockets[0].emit('message', terminationFrame());
  sockets[0].emit('message', JSON.stringify({ type: 'Turn', transcript: 'stale words', end_of_turn: true }));
  sockets[0].emit('error', new Error('old socket boom'));
  sockets[0].emit('close', 1006, Buffer.from(''));

  assert.deepEqual(voskEvents(events, 'vosk-stopped'), [], 'stale Termination must not emit vosk-stopped');
  assert.deepEqual(voskEvents(events, 'vosk-error'), [], 'stale error must not emit vosk-error');
  assert.deepEqual(voskEvents(events, 'vosk-final'), [], 'stale transcript must not be delivered');

  // The live session still streams and still terminates exactly once.
  service.handleAudioChunk({ source: 'system', data: Buffer.alloc(4) });
  assert.ok(sockets[1].sent.some((frame) => Buffer.isBuffer(frame)), 'live socket still receives audio');

  sockets[1].emit('message', terminationFrame());
  assert.equal(voskEvents(events, 'vosk-stopped').length, 1, 'live session terminates exactly once');
});

test('service: an acknowledged stop still emits vosk-stopped when the socket was not replaced', () => {
  const { service, events, sockets } = createHarness();

  service.startAssemblyAiStream('system');
  sockets[0].emit('open');
  service.stopVoiceRecognition({ source: 'system' });
  sockets[0].emit('message', terminationFrame());

  assert.equal(voskEvents(events, 'vosk-stopped').length, 1);
});

test('service: an error on the live socket is reported once and later close does not re-stop', () => {
  const { service, events, sockets } = createHarness();

  service.startAssemblyAiStream('system');
  sockets[0].emit('open');
  sockets[0].emit('error', new Error('connection reset'));
  sockets[0].emit('close', 1006, Buffer.from(''));

  assert.equal(voskEvents(events, 'vosk-error').length, 1);
  assert.deepEqual(voskEvents(events, 'vosk-stopped'), [], 'error already terminated the session');
});

test('service: backend events carry the session id of their owning session', () => {
  const { service, events, sockets } = createHarness();

  const first = service.startAssemblyAiStream('system');
  assert.equal(first.sessionId, 1);
  sockets[0].emit('open');
  sockets[0].emit('message', JSON.stringify({ type: 'Begin', id: 's1' }));
  const listening = voskEvents(events, 'vosk-status').find(([, payload]) => payload.status === 'listening');
  assert.equal(listening[1].sessionId, 1, 'the listening status belongs to session 1');

  sockets[0].emit('message', terminationFrame());
  assert.equal(voskEvents(events, 'vosk-stopped')[0][1].sessionId, 1);

  const second = service.startAssemblyAiStream('system');
  assert.equal(second.sessionId, 2, 'each start is a new session');
  sockets[1].emit('open');

  // An already-streaming start reports the live session id and opens no socket.
  const skipped = service.startAssemblyAiStream('system');
  assert.equal(skipped.sessionId, 2);
  assert.equal(sockets.length, 2);

  sockets[1].emit('error', new Error('boom'));
  assert.equal(voskEvents(events, 'vosk-error')[0][1].sessionId, 2);
});

test('service: the stopped status carries the id of the session being stopped', () => {
  const { service, events, sockets } = createHarness();

  service.startAssemblyAiStream('system');
  sockets[0].emit('open');
  service.stopVoiceRecognition({ source: 'system' });

  const stopped = voskEvents(events, 'vosk-status').find(([, payload]) => payload.status === 'stopped');
  assert.equal(stopped[1].sessionId, 1);
});

test('service: a superseded socket open cannot mark the replacement streaming or block the next start', () => {
  const { service, sockets } = createHarness();

  service.startAssemblyAiStream('system');
  service.stopVoiceRecognition({ source: 'system' });
  service.startAssemblyAiStream('system');
  service.stopVoiceRecognition({ source: 'system' });

  sockets[0].emit('open'); // the original connection completes after its replacement was stopped
  service.startAssemblyAiStream('system');
  assert.equal(sockets.length, 3, 'a superseded open must not make a new start skip');
});

test('service: a stopped socket late open does not resurrect streaming', () => {
  const { service, sockets } = createHarness();

  service.startAssemblyAiStream('system');
  service.stopVoiceRecognition({ source: 'system' });

  sockets[0].emit('open'); // stopped while connecting; the connection completes late
  assert.equal(sockets[0].readyState, 3, 'the late-opened stopped socket is terminated');

  service.startAssemblyAiStream('system');
  assert.equal(sockets.length, 2, 'a stopped open must not make a new start skip');
});
