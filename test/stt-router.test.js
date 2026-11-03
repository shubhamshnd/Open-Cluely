'use strict';

// STT provider router: streaming calls follow the Settings STT provider,
// 'all' stops fan out to both providers, history flush/reset hits both, and
// the AssemblyAI-only features (desktop sources, batch transcribe) always
// route to AssemblyAI.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createSttRouter } = require('../src/services/stt/stt-router.js');

function createSpyService(name) {
  const calls = [];
  return {
    calls,
    emitSttDebug: (payload) => calls.push(['emitSttDebug', payload]),
    handleAudioChunk: (payload) => calls.push(['handleAudioChunk', payload]),
    startAssemblyAiStream: (source, options) => {
      calls.push(['startAssemblyAiStream', source, options]);
      return { success: true, provider: name };
    },
    stopVoiceRecognition: (options) => {
      calls.push(['stopVoiceRecognition', options]);
      return { success: true, provider: name };
    },
    getDesktopSources: async () => {
      calls.push(['getDesktopSources']);
      return [{ id: `${name}-source` }];
    },
    transcribeAudio: async (audio) => {
      calls.push(['transcribeAudio', audio]);
      return { success: true, provider: name };
    },
    flushAllSttHistoryBuffers: (reason) => calls.push(['flushAllSttHistoryBuffers', reason]),
    resetSttHistoryBuffers: () => calls.push(['resetSttHistoryBuffers']),
    dispose: () => calls.push(['dispose'])
  };
}

function createHarness(initialProvider = 'assemblyai') {
  let provider = initialProvider;
  const assemblyai = createSpyService('assemblyai');
  const transcribe = createSpyService('transcribe');
  const router = createSttRouter({
    getSttProvider: () => provider,
    services: { assemblyai, transcribe }
  });
  return {
    router,
    assemblyai,
    transcribe,
    setProvider: (next) => {
      provider = next;
    }
  };
}

test('streaming calls route to the provider selected at call time', () => {
  const { router, assemblyai, transcribe, setProvider } = createHarness('assemblyai');

  router.startAssemblyAiStream('system', { attemptId: 'a1' });
  router.handleAudioChunk({ source: 'system', data: Buffer.alloc(2) });
  assert.equal(assemblyai.calls.length, 2);
  assert.equal(transcribe.calls.length, 0);

  setProvider('transcribe');
  const start = router.startAssemblyAiStream('mic', { attemptId: 'a2' });
  router.handleAudioChunk({ source: 'mic', data: Buffer.alloc(2) });
  router.stopVoiceRecognition({ source: 'mic', attemptId: 'a2' });

  assert.equal(start.provider, 'transcribe');
  assert.equal(assemblyai.calls.length, 2, 'no new AssemblyAI calls after the switch');
  assert.deepEqual(
    transcribe.calls.map((call) => call[0]),
    ['startAssemblyAiStream', 'handleAudioChunk', 'stopVoiceRecognition']
  );
});

test('an unknown/invalid provider value falls back to AssemblyAI', () => {
  const { router, assemblyai, setProvider } = createHarness('assemblyai');
  setProvider('klingon');
  const start = router.startAssemblyAiStream('mic');
  assert.equal(start.provider, 'assemblyai');
  assert.equal(assemblyai.calls.length, 1);
});

test("stopVoiceRecognition('all') fans out to both providers", () => {
  const { router, assemblyai, transcribe } = createHarness('transcribe');
  const result = router.stopVoiceRecognition({ source: 'all' });
  assert.equal(result.success, true);
  assert.deepEqual(assemblyai.calls.map((call) => call[0]), ['stopVoiceRecognition']);
  assert.deepEqual(transcribe.calls.map((call) => call[0]), ['stopVoiceRecognition']);
  assert.deepEqual(assemblyai.calls[0][1], { source: 'all' });
  assert.deepEqual(transcribe.calls[0][1], { source: 'all' });
});

test('history flush/reset and dispose hit BOTH providers', () => {
  const { router, assemblyai, transcribe } = createHarness('assemblyai');
  router.flushAllSttHistoryBuffers('pre-ask-ai');
  router.resetSttHistoryBuffers();
  router.dispose();

  assert.deepEqual(
    assemblyai.calls.map((call) => call[0]),
    ['flushAllSttHistoryBuffers', 'resetSttHistoryBuffers', 'dispose']
  );
  assert.deepEqual(
    transcribe.calls.map((call) => call[0]),
    ['flushAllSttHistoryBuffers', 'resetSttHistoryBuffers', 'dispose']
  );
});

test('desktop sources and batch transcribeAudio are AssemblyAI features regardless of provider', async () => {
  const { router, assemblyai, transcribe } = createHarness('transcribe');
  const sources = await router.getDesktopSources();
  const batch = await router.transcribeAudio('base64-audio');

  assert.deepEqual(sources, [{ id: 'assemblyai-source' }]);
  assert.equal(batch.provider, 'assemblyai');
  assert.equal(transcribe.calls.length, 0);
});

test('the router requires both provider services', () => {
  assert.throws(() => createSttRouter({ getSttProvider: () => 'assemblyai', services: { assemblyai: {} } }), /both services/);
});
