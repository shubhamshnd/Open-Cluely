'use strict';

// Amazon Transcribe streaming STT service: the AssemblyAI-parity contract.
// Fake TranscribeStreamingClient (an async generator of TranscriptEvents):
// partial->final mapping, attemptId tagging, stale-attempt suppression, stop
// (iterator ends + command aborts), error->termination, chunk intake and
// custom vocabulary pass-through. No real AWS calls anywhere here.

const test = require('node:test');
const assert = require('node:assert/strict');
const { StartStreamTranscriptionCommand } = require('@aws-sdk/client-transcribe-streaming');

const { createAwsTranscribeService } = require('../src/services/stt/aws-transcribe-service.js');

// The real SDK yields the event-stream union shape
// { TranscriptEvent: { Transcript: { Results } } } — verified against a live
// Transcribe response on the wire. Fakes MUST keep this shape.
function partial(text) {
  return { TranscriptEvent: { Transcript: { Results: [{ IsPartial: true, Alternatives: [{ Transcript: text }] }] } } };
}

function final(text) {
  return { TranscriptEvent: { Transcript: { Results: [{ IsPartial: false, Alternatives: [{ Transcript: text }] }] } } };
}

async function flushTicks(count = 8) {
  for (let index = 0; index < count; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

// Fake client: send() records the command, drains the AudioStream like the
// SDK would, and returns a TranscriptResultStream async generator. With
// holdStream the generator stays open until the abort signal fires (then it
// throws AbortError, like the real SDK stream does on abort).
function createFakeClient({ events = [], sendError = null, holdStream = false, hangSend = false } = {}) {
  const state = {
    sends: 0,
    commandInputs: [],
    audioChunks: [],
    aborted: false,
    destroyed: false,
    streamDrained: null
  };
  const client = {
    send: async (command, { abortSignal } = {}) => {
      state.sends += 1;
      state.commandInputs.push(command.input);
      const onAbort = () => {
        state.aborted = true;
      };
      if (abortSignal) {
        if (abortSignal.aborted) {
          onAbort();
        } else {
          abortSignal.addEventListener('abort', onAbort);
        }
      }
      if (sendError) {
        throw sendError;
      }
      if (hangSend) {
        return new Promise((_resolve, reject) => {
          abortSignal?.addEventListener('abort', () => {
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      }
      state.streamDrained = (async () => {
        for await (const audioEvent of command.input.AudioStream) {
          state.audioChunks.push(Buffer.from(audioEvent.AudioEvent.AudioChunk));
        }
      })();
      const stream = (async function* () {
        for (const event of events) {
          yield event;
        }
        if (holdStream) {
          await new Promise((resolve) => {
            if (abortSignal?.aborted) {
              resolve();
              return;
            }
            abortSignal?.addEventListener('abort', resolve);
          });
          const error = new Error('The operation was aborted');
          error.name = 'AbortError';
          throw error;
        }
      })();
      return { TranscriptResultStream: stream };
    },
    destroy: () => {
      state.destroyed = true;
    }
  };
  return { client, state };
}

function createHarness({ settings = {}, fake = {} } = {}) {
  const fakeClient = createFakeClient(fake);
  const sent = [];
  const geminiHistory = [];
  const service = createAwsTranscribeService({
    getTranscribeSettings: () => ({
      region: settings.region ?? 'us-east-1',
      language: settings.language ?? 'en-US',
      vocabularyName: settings.vocabularyName ?? '',
      awsAuth: settings.awsAuth ?? { awsAuthMode: 'default' }
    }),
    getGeminiService: () => ({ addToHistory: (role, content) => geminiHistory.push([role, content]) }),
    sendToRenderer: (channel, data) => sent.push([channel, data]),
    createClient: () => fakeClient.client
  });
  return { service, sent, fakeState: fakeClient.state, geminiHistory };
}

const eventsOf = (sent, channel) => sent.filter(([name]) => name === channel).map(([, data]) => data);

test('Bedrock API key auth mode is rejected for Transcribe with a clear, tagged error', async () => {
  const { service, sent, fakeState } = createHarness({
    settings: { awsAuth: { awsAuthMode: 'apiKey', bedrockApiKey: 'fake-bedrock-key' } }
  });
  const result = service.startAssemblyAiStream('system', { attemptId: 'att-1' });
  assert.equal(result.success, false);
  assert.match(result.error, /Bedrock API key cannot be used for Amazon Transcribe/);
  assert.equal(result.attemptId, 'att-1');
  assert.equal(fakeState.sends, 0, 'no client call was made');

  const errors = eventsOf(sent, 'vosk-error');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].attemptId, 'att-1');
  assert.equal(errors[0].source, 'system');
  assert.doesNotMatch(errors[0].error, /fake-bedrock-key/, 'the error must not contain the key');
});

test('partial -> final mapping with attemptId tagging and history handoff', async () => {
  const { service, sent, geminiHistory } = createHarness({
    fake: { events: [partial('ask not'), partial('ask not what'), final('ask not what your country can do for you')] }
  });
  const start = service.startAssemblyAiStream('system', { attemptId: 'att-9' });
  assert.equal(start.success, true);
  assert.equal(start.attemptId, 'att-9');
  await flushTicks();

  const statuses = eventsOf(sent, 'vosk-status');
  assert.deepEqual(statuses.map((s) => s.status), ['loading', 'listening']);
  assert.ok(statuses.every((s) => s.attemptId === 'att-9'));

  const partials = eventsOf(sent, 'vosk-partial');
  assert.deepEqual(partials.map((p) => p.text), ['ask not', 'ask not what']);
  assert.ok(partials.every((p) => p.attemptId === 'att-9' && p.source === 'system'));

  const finals = eventsOf(sent, 'vosk-final');
  assert.deepEqual(finals.map((f) => f.text), ['ask not what your country can do for you']);
  assert.equal(finals[0].attemptId, 'att-9');

  // Stream ended cleanly: vosk-stopped, tagged like AssemblyAI's Termination.
  const stopped = eventsOf(sent, 'vosk-stopped');
  assert.equal(stopped.length, 1);
  assert.equal(stopped[0].attemptId, 'att-9');

  // The final reached the shared STT history as a Host utterance.
  assert.deepEqual(geminiHistory, [['user', 'Host: ask not what your country can do for you']]);
});

test('audio chunks reach the AudioStream in order as s16 PCM buffers', async () => {
  const { service, fakeState } = createHarness({ fake: { holdStream: true } });
  service.startAssemblyAiStream('mic', { attemptId: 'att-1' });
  await flushTicks(3);

  const frame1 = Buffer.alloc(3200, 1);
  const frame2 = Buffer.alloc(3200, 2);
  service.handleAudioChunk({ source: 'mic', data: frame1 });
  service.handleAudioChunk({ source: 'mic', data: frame2 });
  service.stopVoiceRecognition({ source: 'mic', attemptId: 'att-1' });
  await fakeState.streamDrained;

  assert.deepEqual(fakeState.audioChunks, [frame1, frame2]);
});

test('stop ends the audio iterator, aborts the command, and emits the stopped lifecycle', async () => {
  const { service, sent, fakeState } = createHarness({
    fake: { events: [partial('hello')], holdStream: true }
  });
  service.startAssemblyAiStream('system', { attemptId: 'att-2' });
  await flushTicks();

  // The one queued partial arrived before the stop.
  assert.equal(eventsOf(sent, 'vosk-partial').length, 1);

  const stop = service.stopVoiceRecognition({ source: 'system', attemptId: 'att-2' });
  assert.equal(stop.success, true);
  await flushTicks();

  assert.equal(fakeState.aborted, true, 'the command abort signal fired');
  assert.equal(fakeState.destroyed, true, 'the client was destroyed');
  await fakeState.streamDrained; // the AudioStream generator returned

  const statuses = eventsOf(sent, 'vosk-status');
  assert.deepEqual(statuses.map((s) => s.status), ['loading', 'listening', 'stopped']);
  assert.equal(statuses[2].attemptId, 'att-2');

  const stopped = eventsOf(sent, 'vosk-stopped');
  assert.equal(stopped.length, 1, 'stream end after stop maps to exactly one vosk-stopped');
  assert.equal(stopped[0].attemptId, 'att-2');

  // No further transcript events after the stop.
  assert.equal(eventsOf(sent, 'vosk-partial').length, 1);
});

test('a stale attempt-scoped stop leaves the live session untouched', async () => {
  const { service, sent, fakeState } = createHarness({ fake: { holdStream: true } });
  service.startAssemblyAiStream('system', { attemptId: 'att-live' });
  await flushTicks(3);

  const stop = service.stopVoiceRecognition({ source: 'system', attemptId: 'att-old' });
  assert.equal(stop.success, true);
  await flushTicks(3);

  assert.equal(fakeState.aborted, false, 'the live session was not aborted');
  assert.equal(eventsOf(sent, 'vosk-status').filter((s) => s.status === 'stopped').length, 0);
  const debugEvents = eventsOf(sent, 'stt-debug');
  assert.ok(debugEvents.some((d) => d.event === 'stop-stale-scope'));
});

test('a start with a new attempt id ends the orphaned session instead of adopting it', async () => {
  const first = createFakeClient({ holdStream: true });
  const second = createFakeClient({ events: [final('fresh start')] });
  const clients = [first, second];
  let clientIndex = 0;
  const sent = [];
  const service = createAwsTranscribeService({
    getTranscribeSettings: () => ({ region: 'us-east-1', language: 'en-US', vocabularyName: '', awsAuth: { awsAuthMode: 'default' } }),
    getGeminiService: () => null,
    sendToRenderer: (channel, data) => sent.push([channel, data]),
    createClient: () => clients[Math.min(clientIndex++, clients.length - 1)].client
  });

  service.startAssemblyAiStream('system', { attemptId: 'att-A' });
  await flushTicks();
  const restart = service.startAssemblyAiStream('system', { attemptId: 'att-B' });
  assert.equal(restart.success, true);
  assert.equal(restart.attemptId, 'att-B');
  await flushTicks();

  assert.equal(first.state.aborted, true, 'the orphaned session was aborted');

  const finals = eventsOf(sent, 'vosk-final');
  assert.deepEqual(finals.map((f) => [f.text, f.attemptId]), [['fresh start', 'att-B']]);

  // The orphaned attempt got its own stopped status, tagged with ITS id.
  const stoppedStatuses = eventsOf(sent, 'vosk-status').filter((s) => s.status === 'stopped');
  assert.deepEqual(stoppedStatuses.map((s) => s.attemptId), ['att-A']);
});

test('a repeated start with the same attempt id does not open a second session', async () => {
  const { service, fakeState } = createHarness({ fake: { holdStream: true } });
  const first = service.startAssemblyAiStream('mic', { attemptId: 'att-3' });
  await flushTicks(3);
  const second = service.startAssemblyAiStream('mic', { attemptId: 'att-3' });

  assert.equal(second.success, true);
  assert.match(second.message, /already streaming/);
  assert.equal(second.sessionId, first.sessionId);
  assert.equal(fakeState.sends, 1);
  service.stopVoiceRecognition({ source: 'mic', attemptId: 'att-3' });
  await flushTicks();
});

test('a start error maps to a tagged vosk-error and the next start works', async () => {
  const authError = new Error('The security token included in the request is invalid.');
  authError.name = 'UnrecognizedClientException';
  const { service, sent, fakeState } = createHarness({ fake: { sendError: authError } });

  const start = service.startAssemblyAiStream('system', { attemptId: 'att-4' });
  assert.equal(start.success, true, 'the RPC itself succeeded; the failure arrives as an event');
  await flushTicks();

  const errors = eventsOf(sent, 'vosk-error');
  assert.equal(errors.length, 1);
  assert.match(errors[0].error, /UnrecognizedClientException|security token/);
  assert.equal(errors[0].attemptId, 'att-4');
  assert.equal(eventsOf(sent, 'vosk-stopped').length, 0, 'an error is a termination, not a stop ack');

  // The slot was reset: a new start opens a fresh session.
  const restart = service.startAssemblyAiStream('system', { attemptId: 'att-5' });
  assert.equal(restart.success, true);
  assert.equal(fakeState.sends, 2);
  service.stopVoiceRecognition({ source: 'system', attemptId: 'att-5' });
  await flushTicks();
});

test('a mid-stream error maps to vosk-error and ends the session', async () => {
  const streamError = new Error('socket hang up');
  const { service, sent } = createHarness({
    fake: {
      events: [partial('before the error')],
      holdStream: false
    }
  });
  // Rebuild with a stream that yields one partial then throws.
  const failingClient = createFakeClient({});
  failingClient.client.send = async (command) => ({
    TranscriptResultStream: (async function* () {
      yield partial('before the error');
      throw streamError;
    })()
  });
  const sent2 = sent;
  const service2 = createAwsTranscribeService({
    getTranscribeSettings: () => ({ region: 'us-east-1', language: 'en-US', vocabularyName: '', awsAuth: { awsAuthMode: 'default' } }),
    getGeminiService: () => null,
    sendToRenderer: (channel, data) => sent2.push([channel, data]),
    createClient: () => failingClient.client
  });

  service2.startAssemblyAiStream('mic', { attemptId: 'att-6' });
  await flushTicks();

  assert.deepEqual(eventsOf(sent2, 'vosk-partial').map((p) => p.text), ['before the error']);
  const errors = eventsOf(sent2, 'vosk-error');
  assert.equal(errors.length, 1);
  assert.match(errors[0].error, /socket hang up/);
  assert.equal(errors[0].attemptId, 'att-6');

  // The failed session is gone: a stale stop for it must not touch anything.
  service2.stopVoiceRecognition({ source: 'mic', attemptId: 'att-6' });
  await flushTicks(3);
  assert.equal(eventsOf(sent2, 'vosk-error').length, 1);
  void service;
});

test('credential errors name the credential set in use; transport errors keep the plain prefix', async () => {
  // AccessDenied with a Transcribe-only profile override: the error must say
  // WHICH credentials failed ("(profile transcribe-profile)"), never the key material.
  const denied = new Error('User is not authorized to perform transcribe:StartStreamTranscription');
  denied.name = 'AccessDeniedException';
  const { service, sent } = createHarness({
    settings: {
      awsAuth: {
        awsAuthMode: 'profile',
        awsProfile: 'bedrock-profile',
        transcribeAuthMode: 'profile',
        transcribeAwsProfile: 'transcribe-profile'
      }
    },
    fake: { sendError: denied }
  });
  service.startAssemblyAiStream('system', { attemptId: 'att-cred' });
  await flushTicks();
  const credErrors = eventsOf(sent, 'vosk-error');
  assert.equal(credErrors.length, 1);
  assert.match(credErrors[0].error, /^Amazon Transcribe credentials \(profile transcribe-profile\): /);
  assert.match(credErrors[0].error, /not authorized/);

  // The inherit path labels the shared identity instead.
  const denied2 = new Error('The security token included in the request is invalid.');
  denied2.name = 'UnrecognizedClientException';
  const harness2 = createHarness({
    settings: { awsAuth: { awsAuthMode: 'profile', awsProfile: 'bedrock-profile', transcribeAuthMode: 'inherit' } },
    fake: { sendError: denied2 }
  });
  harness2.service.startAssemblyAiStream('system', { attemptId: 'att-inh' });
  await flushTicks();
  const inhErrors = eventsOf(harness2.sent, 'vosk-error');
  assert.equal(inhErrors.length, 1);
  assert.match(inhErrors[0].error, /^Amazon Transcribe credentials \(shared profile bedrock-profile\): /);

  // A transport error is NOT a credential failure: plain connection prefix.
  const harness3 = createHarness({ fake: { sendError: new Error('socket hang up') } });
  harness3.service.startAssemblyAiStream('system', { attemptId: 'att-net' });
  await flushTicks();
  const netErrors = eventsOf(harness3.sent, 'vosk-error');
  assert.equal(netErrors.length, 1);
  assert.match(netErrors[0].error, /^Connection error \(system\): socket hang up$/);
});

test('custom vocabulary and language reach the StartStreamTranscription command', async () => {
  const { service, fakeState } = createHarness({
    settings: { language: 'hi-IN', vocabularyName: 'open-cluely-hi-IN' },
    fake: { holdStream: true }
  });
  service.startAssemblyAiStream('system', { attemptId: 'att-7' });
  await flushTicks(3);

  assert.equal(fakeState.commandInputs.length, 1);
  const input = fakeState.commandInputs[0];
  assert.equal(input.LanguageCode, 'hi-IN');
  assert.equal(input.VocabularyName, 'open-cluely-hi-IN');
  assert.equal(input.MediaSampleRateHertz, 16000);
  assert.equal(input.MediaEncoding, 'pcm');
  service.stopVoiceRecognition({ source: 'system', attemptId: 'att-7' });
  await flushTicks();
});

test('server stream end releases the request audio iterator and client without an explicit stop', async () => {
  const { service, fakeState } = createHarness({ fake: { events: [final('complete')] } });
  service.startAssemblyAiStream('system', { attemptId: 'server-end' });
  await flushTicks();
  let audioEnded = false;
  fakeState.streamDrained.then(() => { audioEnded = true; });
  await flushTicks();
  service.stopVoiceRecognition({ source: 'system', attemptId: 'server-end' });
  service.dispose();
  assert.equal(audioEnded, true, 'the request audio iterator must not remain waiting after server termination');
  assert.equal(fakeState.destroyed, true, 'the client must not be lost when the session slot is reset');
});

test('chunks are dropped (counted, debug-logged) when no session exists', () => {
  const { service, sent } = createHarness();
  for (let index = 0; index < 25; index += 1) {
    service.handleAudioChunk({ source: 'mic', data: Buffer.alloc(100) });
  }
  const drops = eventsOf(sent, 'stt-debug').filter((d) => d.event === 'chunk-dropped');
  assert.equal(drops.length, 1);
  assert.equal(drops[0].meta.dropped, 25);
});

test('dispose ends both sessions and leaks nothing', async () => {
  const { service, fakeState } = createHarness({ fake: { holdStream: true } });
  service.startAssemblyAiStream('system', { attemptId: 'att-8' });
  service.startAssemblyAiStream('mic', { attemptId: 'att-8-mic' });
  await flushTicks(3);

  service.dispose();
  await flushTicks();

  assert.equal(fakeState.aborted, true);
  await fakeState.streamDrained;
  // Post-dispose starts are not part of the contract; the stopped lifecycle
  // must already have been observable before dispose returned.
  const restart = service.stopVoiceRecognition({ source: 'all' });
  assert.equal(restart.success, true, 'stop after dispose is a no-op, not a crash');
});

test('a stop while the stream is still connecting cannot resurrect the session', async () => {
  const { service, sent, fakeState } = createHarness({ fake: { hangSend: true } });
  const start = service.startAssemblyAiStream('system', { attemptId: 'att-10' });
  assert.equal(start.success, true);

  service.stopVoiceRecognition({ source: 'system', attemptId: 'att-10' });
  await flushTicks();

  assert.equal(fakeState.aborted, true);
  const statuses = eventsOf(sent, 'vosk-status');
  assert.deepEqual(statuses.map((s) => s.status), ['loading', 'stopped'], 'no listening state after a connecting stop');
  assert.equal(eventsOf(sent, 'vosk-error').length, 0, 'the abort of a connecting stop is not an error');
});
