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
