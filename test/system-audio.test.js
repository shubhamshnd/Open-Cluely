'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ERRORS_MODULE_URL = '../src/windows/assistant/renderer/features/assembly-ai/system-audio-errors.js';
const PIPELINE_MODULE_URL = '../src/windows/assistant/renderer/features/assembly-ai/audio-pipeline.js';
const MANAGER_MODULE_URL = '../src/windows/assistant/renderer/features/transcription/transcription-manager.js';

const LINUX_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Open Cluely/1.0.0 Chrome/120.0.0.0 Electron/28.0.0 Safari/537.36';
const WINDOWS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Electron/28.0.0 Safari/537.36';

async function loadModules() {
  const errors = await import(ERRORS_MODULE_URL);
  const pipeline = await import(PIPELINE_MODULE_URL);
  const manager = await import(MANAGER_MODULE_URL);
  return { errors, pipeline, manager };
}

function createFakeStream({ audioTrackStates, videoTrackStates = [] }) {
  const stopped = [];
  const makeTracks = (states) =>
    states.map((state) => ({ readyState: state, stop: () => stopped.push(state) }));
  const audioTracks = makeTracks(audioTrackStates);
  const videoTracks = makeTracks(videoTrackStates);
  return {
    stream: {
      getAudioTracks: () => audioTracks,
      getVideoTracks: () => videoTracks,
      getTracks: () => [...audioTracks, ...videoTracks]
    },
    stopped
  };
}

test('system-audio error helpers mark and explain the typed error', async () => {
  const { errors } = await loadModules();

  const detail = new Error('NotSupportedError');
  const error = errors.createSystemAudioUnsupportedError(detail);

  assert.equal(error.code, errors.SYSTEM_AUDIO_UNSUPPORTED);
  assert.equal(error.cause, detail);
  assert.ok(errors.isSystemAudioUnsupportedError(error));
  assert.equal(errors.isSystemAudioUnsupportedError(new Error('generic')), false);
  assert.equal(errors.isSystemAudioUnsupportedError(null), false);
  assert.equal(errors.isSystemAudioUnsupportedError(undefined), false);

  const linuxMessage = errors.getSystemAudioUnsupportedMessage(LINUX_UA);
  assert.match(linuxMessage, /isn't supported by Chromium on Linux/i);
  assert.match(linuxMessage, /Monitor of/);
  assert.match(linuxMessage, /Mic source/);

  const windowsMessage = errors.getSystemAudioUnsupportedMessage(WINDOWS_UA);
  assert.doesNotMatch(windowsMessage, /Linux/);
  assert.match(windowsMessage, /Mic source/);
});

test('audio pipeline: mandatory desktop constraints succeed → stream returned, one attempt', async () => {
  const { errors, pipeline } = await loadModules();
  const { stream } = createFakeStream({ audioTrackStates: ['live'] });
  const attempts = [];
  const audioPipeline = pipeline.createAudioPipeline({
    sendAudioChunk: () => {},
    addMonitorLog: () => {},
    getUserMedia: async (constraints) => {
      attempts.push(constraints);
      return stream;
    }
  });

  const result = await audioPipeline.getSystemAudioStream('screen:0');

  assert.equal(result, stream);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].audio.mandatory.chromeMediaSource, 'desktop');
});

test('audio pipeline: mandatory constraints rejected → flat syntax tried once', async () => {
  const { errors, pipeline } = await loadModules();
  const { stream } = createFakeStream({ audioTrackStates: ['live'] });
  const attempts = [];
  const monitorLogs = [];
  const audioPipeline = pipeline.createAudioPipeline({
    sendAudioChunk: () => {},
    addMonitorLog: (...args) => monitorLogs.push(args),
    getUserMedia: async (constraints) => {
      attempts.push(constraints);
      if (constraints.audio.mandatory) {
        throw new Error('TypeError: malformed constraints');
      }
      return stream;
    }
  });

  const result = await audioPipeline.getSystemAudioStream('screen:0');

  assert.equal(result, stream);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1].audio.chromeMediaSource, 'desktop');
  assert.ok(monitorLogs.some((args) => args[1] === 'desktop-constraints-fallback'));
});

test('audio pipeline: both getUserMedia attempts fail → typed error, no listening', async () => {
  const { errors, pipeline } = await loadModules();
  const attempts = [];
  const monitorLogs = [];
  const audioPipeline = pipeline.createAudioPipeline({
    sendAudioChunk: () => {},
    addMonitorLog: (...args) => monitorLogs.push(args),
    getUserMedia: async (constraints) => {
      attempts.push(constraints);
      throw new Error('NotSupportedError');
    }
  });

  await assert.rejects(audioPipeline.getSystemAudioStream('screen:0'), (error) => {
    assert.ok(errors.isSystemAudioUnsupportedError(error));
    assert.equal(error.cause.message, 'NotSupportedError');
    return true;
  });
  assert.equal(attempts.length, 2);
  assert.ok(monitorLogs.some((args) => args[1] === 'desktop-constraints-fallback'));
});

test('audio pipeline: stream with no audio tracks → typed error and tracks stopped', async () => {
  const { errors, pipeline } = await loadModules();
  const { stream, stopped } = createFakeStream({ audioTrackStates: [], videoTrackStates: ['live'] });
  const audioPipeline = pipeline.createAudioPipeline({
    sendAudioChunk: () => {},
    addMonitorLog: () => {},
    getUserMedia: async () => stream
  });

  await assert.rejects(audioPipeline.getSystemAudioStream('screen:0'), (error) => {
    assert.ok(errors.isSystemAudioUnsupportedError(error));
    assert.match(error.cause, /no usable audio track/);
    return true;
  });
  assert.deepEqual(stopped, ['live']);
});

test('audio pipeline: audio track already ended → typed error', async () => {
  const { errors, pipeline } = await loadModules();
  const { stream, stopped } = createFakeStream({ audioTrackStates: ['ended'] });
  const audioPipeline = pipeline.createAudioPipeline({
    sendAudioChunk: () => {},
    addMonitorLog: () => {},
    getUserMedia: async () => stream
  });

  await assert.rejects(audioPipeline.getSystemAudioStream('screen:0'), (error) => {
    assert.ok(errors.isSystemAudioUnsupportedError(error));
    return true;
  });
  assert.deepEqual(stopped, ['ended']);
});

function buildManagerHarness({ managerModule, systemAudioFailure }) {
  const recorded = {
    chat: [],
    feedback: [],
    active: [],
    monitorRows: []
  };
  const sourceStatuses = { system: 'off', mic: 'off' };
  const selectedSources = { system: true, mic: false };
  const stopCalls = [];

  globalThis.document = {
    createElement: () => ({ className: '', textContent: '', style: {} })
  };
  const monitorLogList = {
    innerHTML: '',
    appendChild: (row) => recorded.monitorRows.push(row.textContent)
  };

  globalThis.window = {
    navigator: { userAgent: LINUX_UA },
    electronAPI: {
      getDesktopSources: async () => [{ id: 'screen:0', name: 'Entire Screen' }],
      startVoiceRecognition: async () => ({}),
      stopVoiceRecognition: async (source) => stopCalls.push(source)
    }
  };

  const transcriptionManager = managerModule.createTranscriptionManager({
    transcriptionSourceState: {
      selectedSources,
      sourceStatuses,
      setSourceActive: (source, active) => recorded.active.push([source, active]),
      setSourceStatus: (source, status, liveText) => {
        sourceStatuses[source] = status;
      },
      setSourceSelected: () => {},
      isAnySourceConnecting: () => false
    },
    normalizeSourceRule: (source) => (source === 'system' ? 'system' : 'mic'),
    sourceLabelRule: (source) => (source === 'system' ? 'Host' : 'Mic'),
    audioPipeline: {
      getSystemAudioStream: async () => {
        throw systemAudioFailure;
      },
      resetSourceSampleQueue: () => {},
      stopAudioResources: () => {},
      isLikelyCameraTrack: () => false,
      buildAudioProcessor: async () => ({}),
      resetChunkCounter: () => {},
      drainSourceSampleQueue: () => {}
    },
    transcriptBufferManager: {
      resetFinalTranscriptBuffer: () => {},
      queueFinalTranscript: () => {},
      flushFinalTranscript: () => {},
      flushAllFinalTranscripts: () => {}
    },
    chatMessagesElement: null,
    transcriptionToggle: null,
    sourceSystemToggle: null,
    sourceMicToggle: null,
    monitorMasterState: null,
    monitorStatusSystem: null,
    monitorStatusMic: null,
    monitorLiveSystem: null,
    monitorLiveMic: null,
    monitorLogList,
    addChatMessage: (type, content) => recorded.chat.push([type, content]),
    showFeedback: (message, type) => recorded.feedback.push([message, type])
  });

  return { transcriptionManager, recorded, sourceStatuses, stopCalls };
}

function cleanupManagerGlobals() {
  delete globalThis.window;
  delete globalThis.document;
}

test('transcription manager: unsupported host audio → clear message, never listening', async (t) => {
  const { errors, manager: managerModule } = await loadModules();
  t.after(() => cleanupManagerGlobals());

  const unsupportedError = errors.createSystemAudioUnsupportedError(new Error('NotSupportedError'));
  const { transcriptionManager, recorded, sourceStatuses, stopCalls } = buildManagerHarness({
    managerModule,
    systemAudioFailure: unsupportedError
  });

  await transcriptionManager.toggleMasterTranscription();

  const expectedMessage = errors.getSystemAudioUnsupportedMessage(LINUX_UA);

  assert.deepEqual(recorded.feedback, [[expectedMessage, 'error']]);
  assert.ok(recorded.chat.some(([type, content]) => type === 'system' && content === expectedMessage));
  assert.ok(
    recorded.monitorRows.some((text) => text.includes('system-audio-unsupported'))
  );
  assert.equal(sourceStatuses.system, 'error');
  assert.notEqual(sourceStatuses.system, 'listening');
  assert.ok(recorded.active.some(([source, active]) => source === 'system' && active === false));
  assert.ok(!recorded.active.some(([source, active]) => source === 'system' && active === true));
  assert.ok(!recorded.chat.some(([type, content]) => /Listening to host audio/i.test(content)));
  assert.deepEqual(stopCalls, ['system']);
});

test('transcription manager: generic failure keeps the existing error copy', async (t) => {
  const { errors, manager: managerModule } = await loadModules();
  t.after(() => cleanupManagerGlobals());

  const { transcriptionManager, recorded, sourceStatuses, stopCalls } = buildManagerHarness({
    managerModule,
    systemAudioFailure: new Error('Vosk connection refused')
  });

  await transcriptionManager.toggleMasterTranscription();

  assert.deepEqual(recorded.feedback, [['System audio failed: Vosk connection refused', 'error']]);
  assert.ok(
    recorded.monitorRows.some((text) => text.includes('source-failed'))
  );
  assert.equal(sourceStatuses.system, 'error');
  const unsupportedMessage = errors.getSystemAudioUnsupportedMessage(LINUX_UA);
  assert.ok(!recorded.chat.some(([type, content]) => content === unsupportedMessage));
  assert.deepEqual(stopCalls, ['system']);
});
