'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { createAssemblyAiService } = require('../src/services/assembly-ai/service.js');

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
  assert.match(linuxMessage, /pw-record/);
  assert.match(linuxMessage, /PipeWire/);
  assert.match(linuxMessage, /Use the Mic source/);
  assert.doesNotMatch(linuxMessage, /Monitor of/);

  const windowsMessage = errors.getSystemAudioUnsupportedMessage(WINDOWS_UA);
  assert.doesNotMatch(windowsMessage, /Linux/);
  assert.match(windowsMessage, /Mic source/);
});

test('audio pipeline: native monitor capture starts via the main process and stop releases it by token', async () => {
  const { pipeline } = await loadModules();
  const calls = [];
  const logs = [];
  const audioPipeline = pipeline.createAudioPipeline({
    sendAudioChunk: () => {},
    addMonitorLog: (...args) => logs.push(args),
    nativeMonitor: {
      start: async () => {
        calls.push(['start']);
        return { success: true, token: 'tok-1' };
      },
      stop: async (token) => {
        calls.push(['stop', token]);
        return { stopped: true };
      }
    },
    getUserMedia: async () => {
      throw new Error('getUserMedia must not be used for native monitor capture');
    }
  });

  const handle = await audioPipeline.startNativeMonitorCapture();
  assert.equal(handle.token, 'tok-1');
  assert.deepEqual(calls, [['start']]);

  await handle.stop();
  await handle.stop(); // idempotent
  assert.deepEqual(calls, [['start'], ['stop', 'tok-1']]);
  assert.ok(logs.some((args) => args[1] === 'monitor-capture'));
});

test('audio pipeline: native monitor start failure → typed unsupported error carrying the cause', async () => {
  const { errors, pipeline } = await loadModules();
  const audioPipeline = pipeline.createAudioPipeline({
    sendAudioChunk: () => {},
    addMonitorLog: () => {},
    nativeMonitor: {
      start: async () => ({ success: false, error: 'spawn pw-record ENOENT' }),
      stop: async () => ({ stopped: false })
    }
  });

  await assert.rejects(audioPipeline.startNativeMonitorCapture(), (error) => {
    assert.ok(errors.isSystemAudioUnsupportedError(error));
    assert.match(error.cause, /ENOENT/);
    return true;
  });
});

test('audio pipeline: stopAudioResources stops every track and releases context and processor', async () => {
  const { pipeline } = await loadModules();
  const audioPipeline = pipeline.createAudioPipeline({
    sendAudioChunk: () => {},
    addMonitorLog: () => {}
  });

  const stopped = [];
  const stream = {
    getTracks: () => [
      { readyState: 'live', stop: () => stopped.push('audio') },
      { readyState: 'live', stop: () => stopped.push('video') }
    ]
  };
  const calls = [];
  const context = { close: () => calls.push('close') };
  const processor = { disconnect: () => calls.push('disconnect') };

  audioPipeline.stopAudioResources(context, stream, processor);

  assert.deepEqual(stopped, ['audio', 'video']);
  assert.deepEqual(calls.sort(), ['close', 'disconnect']);

  // Tolerates already-cleared resources.
  audioPipeline.stopAudioResources(null, null, null);
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

// ---------------------------------------------------------------------------
// Linux Host source (native pw-record capture owned by the main process) and
// start/stop cancellation. Every async startup step is gated by a deferred so
// a Stop can land at an exact point.
// ---------------------------------------------------------------------------

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function buildHostHarness({ managerModule, platform = 'linux', gates = {}, nativeFailure = null }) {
  const recorded = { chat: [], feedback: [], active: [], monitorRows: [] };
  const sourceStatuses = { system: 'off', mic: 'off' };
  const selectedSources = { system: true, mic: false };
  const events = [];
  let nativeCounter = 0;
  let backendSessionCounter = 0;
  // Renderer-owned correlation ids, captured as the manager hands them to the
  // two start RPCs (backend socket start and native capture start).
  const backendAttemptIds = [];
  const nativeAttemptIds = [];

  globalThis.document = { createElement: () => ({ className: '', textContent: '', style: {} }) };
  globalThis.AudioContext = class {
    async resume() {}
    async close() {}
  };

  const lateStream = {
    getAudioTracks: () => [{ readyState: 'live' }],
    getVideoTracks: () => [],
    getTracks: () => [{ readyState: 'live' }]
  };

  globalThis.window = {
    navigator: { userAgent: LINUX_UA },
    electronAPI: {
      platform,
      getDesktopSources: async () => {
        events.push('getDesktopSources');
        if (gates.desktopSources) await gates.desktopSources.promise;
        return [{ id: 'screen:0', name: 'Entire Screen' }];
      },
      startVoiceRecognition: async (source, opts) => {
        events.push(`startVoiceRecognition:${source}`);
        if (opts?.attemptId) backendAttemptIds.push(opts.attemptId);
        if (gates.startVoice) await gates.startVoice.promise;
        backendSessionCounter += 1;
        return { sessionId: backendSessionCounter, attemptId: opts?.attemptId };
      },
      stopVoiceRecognition: async (source) => {
        events.push(`stopVoiceRecognition:${source}`);
      }
    }
  };

  const transcriptionManager = managerModule.createTranscriptionManager({
    transcriptionSourceState: {
      selectedSources,
      sourceStatuses,
      setSourceActive: (source, active) => recorded.active.push([source, active]),
      setSourceStatus: (source, status) => {
        sourceStatuses[source] = status;
      },
      setSourceSelected: () => {},
      isAnySourceConnecting: () => Object.values(sourceStatuses).includes('connecting')
    },
    normalizeSourceRule: (source) => (source === 'system' ? 'system' : 'mic'),
    sourceLabelRule: (source) => (source === 'system' ? 'Host' : 'Mic'),
    audioPipeline: {
      getSystemAudioStream: async () => {
        events.push('getSystemAudioStream');
        if (gates.desktopStream) await gates.desktopStream.promise;
        return lateStream;
      },
      startNativeMonitorCapture: async (opts) => {
        nativeCounter += 1;
        const id = nativeCounter;
        events.push(`nativeStart:${id}`);
        if (opts?.attemptId) nativeAttemptIds.push(opts.attemptId);
        if (gates.nativeStart && id === (gates.nativeStartId || 1)) await gates.nativeStart.promise;
        if (nativeFailure) throw nativeFailure;
        let stopped = false;
        return {
          token: `tok-${id}`,
          stop: async () => {
            if (!stopped) {
              stopped = true;
              events.push(`nativeStop:${id}`);
            }
          }
        };
      },
      resetSourceSampleQueue: () => {},
      stopAudioResources: (ctx, stream) => {
        if (stream) events.push('streamStopped');
      },
      isLikelyCameraTrack: () => false,
      buildAudioProcessor: async () => {
        if (gates.buildProcessor) await gates.buildProcessor.promise;
        return {};
      },
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
    monitorLogList: { innerHTML: '', appendChild: (row) => recorded.monitorRows.push(row.textContent) },
    addChatMessage: (type, content) => recorded.chat.push([type, content]),
    showFeedback: (message, type) => recorded.feedback.push([message, type])
  });

  return { transcriptionManager, recorded, sourceStatuses, events, backendAttemptIds, nativeAttemptIds };
}

function afterHostTest(t) {
  t.after(() => {
    cleanupManagerGlobals();
    delete globalThis.AudioContext;
  });
}

const everActivated = (recorded) => recorded.active.some(([source, active]) => source === 'system' && active === true);

test('transcription manager: on Linux the host source uses native monitor capture, never desktop sources', async (t) => {
  const { manager: managerModule } = await loadModules();
  afterHostTest(t);
  const { transcriptionManager, recorded, sourceStatuses, events } = buildHostHarness({ managerModule });

  await transcriptionManager.toggleMasterTranscription();

  assert.ok(!events.includes('getDesktopSources'));
  assert.ok(!events.includes('getSystemAudioStream'));
  assert.deepEqual(events.filter((e) => e.startsWith('native')), ['nativeStart:1']);
  assert.deepEqual(recorded.feedback, [['System audio on', 'success']]);
  assert.ok(recorded.chat.some(([type, content]) => type === 'system' && /Listening to host audio/i.test(content)));
  assert.ok(everActivated(recorded));
  assert.equal(sourceStatuses.system, 'connecting');

  await transcriptionManager.toggleMasterTranscription();

  assert.ok(events.includes('nativeStop:1'));
  assert.ok(events.includes('stopVoiceRecognition:system'));
  assert.equal(sourceStatuses.system, 'off');
  assert.ok(recorded.active.some(([source, active]) => source === 'system' && active === false));
});

test('transcription manager: native capture failure → typed message, session cleaned up, never active', async (t) => {
  const { errors, manager: managerModule } = await loadModules();
  afterHostTest(t);
  const { transcriptionManager, recorded, sourceStatuses, events } = buildHostHarness({
    managerModule,
    nativeFailure: errors.createSystemAudioUnsupportedError('pw-record exited (code 1) before producing audio')
  });

  await transcriptionManager.toggleMasterTranscription();

  assert.equal(sourceStatuses.system, 'error');
  assert.ok(!everActivated(recorded));
  assert.ok(recorded.monitorRows.some((text) => text.includes('system-audio-unsupported')));
  assert.ok(events.includes('stopVoiceRecognition:system'));
  assert.ok(!events.some((e) => e.startsWith('nativeStop')), 'nothing was acquired, nothing to stop');
});

test('REGRESSION cancel: Stop while native monitor start is pending → late capture stopped, session never activates', async (t) => {
  const { manager: managerModule } = await loadModules();
  afterHostTest(t);
  const gate = deferred();
  const { transcriptionManager, recorded, sourceStatuses, events } = buildHostHarness({
    managerModule,
    gates: { nativeStart: gate }
  });

  const starting = transcriptionManager.toggleMasterTranscription();
  await flush();
  assert.equal(sourceStatuses.system, 'connecting');
  assert.ok(events.includes('nativeStart:1'));

  await transcriptionManager.toggleMasterTranscription(); // Stop while pending
  assert.equal(sourceStatuses.system, 'off');

  gate.resolve(); // the stream arrives late
  await starting;
  await flush();

  assert.ok(events.includes('nativeStop:1'), 'late capture must be stopped immediately');
  assert.ok(!everActivated(recorded), 'late capture must not reactivate the session');
  assert.equal(sourceStatuses.system, 'off');
  assert.ok(!recorded.chat.some(([, content]) => /Listening to host audio/i.test(content)));
});

test('REGRESSION cancel: Stop while startVoiceRecognition is pending → no capture is acquired afterwards', async (t) => {
  const { manager: managerModule } = await loadModules();
  afterHostTest(t);
  const gate = deferred();
  const { transcriptionManager, recorded, sourceStatuses, events } = buildHostHarness({
    managerModule,
    gates: { startVoice: gate }
  });

  const starting = transcriptionManager.toggleMasterTranscription();
  await flush();
  await transcriptionManager.toggleMasterTranscription(); // Stop

  gate.resolve();
  await starting;
  await flush();

  assert.ok(!events.some((e) => e.startsWith('nativeStart')));
  assert.ok(!everActivated(recorded));
  assert.equal(sourceStatuses.system, 'off');
});

test('REGRESSION cancel: Stop while desktop stream is pending (non-Linux) → late stream stopped, not activated', async (t) => {
  const { manager: managerModule } = await loadModules();
  afterHostTest(t);
  const gate = deferred();
  const { transcriptionManager, recorded, sourceStatuses, events } = buildHostHarness({
    managerModule,
    platform: 'win32',
    gates: { desktopStream: gate }
  });

  const starting = transcriptionManager.toggleMasterTranscription();
  await flush();
  assert.ok(events.includes('getSystemAudioStream'));
  await transcriptionManager.toggleMasterTranscription(); // Stop

  gate.resolve();
  await starting;
  await flush();

  assert.ok(events.includes('streamStopped'), 'late desktop stream must be stopped immediately');
  assert.ok(!everActivated(recorded));
  assert.equal(sourceStatuses.system, 'off');
});

test('REGRESSION cancel: Stop while the audio processor is being built (non-Linux) → resources released, not activated', async (t) => {
  const { manager: managerModule } = await loadModules();
  afterHostTest(t);
  const gate = deferred();
  const { transcriptionManager, recorded, events } = buildHostHarness({
    managerModule,
    platform: 'win32',
    gates: { buildProcessor: gate }
  });

  const starting = transcriptionManager.toggleMasterTranscription();
  await flush();
  await transcriptionManager.toggleMasterTranscription(); // Stop

  gate.resolve();
  await starting;
  await flush();

  assert.ok(events.includes('streamStopped'));
  assert.ok(!everActivated(recorded));
});

test('transcription manager: Stop then immediate restart → stale capture stopped, only the new session activates', async (t) => {
  const { manager: managerModule } = await loadModules();
  afterHostTest(t);
  const gate = deferred();
  const { transcriptionManager, recorded, sourceStatuses, events } = buildHostHarness({
    managerModule,
    gates: { nativeStart: gate } // only the first native start is gated
  });

  const first = transcriptionManager.toggleMasterTranscription();
  await flush();
  await transcriptionManager.toggleMasterTranscription(); // Stop
  await transcriptionManager.toggleMasterTranscription(); // Start again
  assert.ok(events.includes('nativeStart:2'));
  assert.ok(everActivated(recorded), 'second session is active');

  gate.resolve(); // stale first capture arrives late
  await first;
  await flush();

  assert.ok(events.includes('nativeStop:1'));
  assert.ok(!events.includes('nativeStop:2'), 'the live session must not be killed by the stale one');
  assert.equal(sourceStatuses.system, 'connecting');

  await transcriptionManager.toggleMasterTranscription();
  assert.ok(events.includes('nativeStop:2'));
});

test('transcription manager: backend error/stop events release the native capture', async (t) => {
  const { manager: managerModule } = await loadModules();
  afterHostTest(t);
  const { transcriptionManager, events } = buildHostHarness({ managerModule });

  await transcriptionManager.toggleMasterTranscription();
  transcriptionManager.handleVoskError({ source: 'system', error: 'Host audio capture stopped unexpectedly' });
  await flush();
  assert.ok(events.includes('nativeStop:1'));

  await transcriptionManager.toggleMasterTranscription();
  transcriptionManager.handleVoskStopped({ source: 'system' });
  await flush();
  assert.ok(events.includes('nativeStop:2'));
});

test('REGRESSION: backend error while the native acquisition is still pending cancels the start', async (t) => {
  const { manager: managerModule } = await loadModules();
  afterHostTest(t);
  const gate = deferred();
  const { transcriptionManager, recorded, sourceStatuses, events } = buildHostHarness({
    managerModule,
    gates: { nativeStart: gate }
  });

  const starting = transcriptionManager.toggleMasterTranscription();
  await flush();
  assert.equal(sourceStatuses.system, 'connecting');

  transcriptionManager.handleVoskError({ source: 'system', error: 'Connection lost while starting' });
  gate.resolve(); // the capture arrives after the session was terminated
  await starting;
  await flush();

  assert.ok(!everActivated(recorded), 'backend error must prevent late activation');
  assert.ok(events.includes('nativeStop:1'), 'the late capture must be released immediately');
  assert.equal(sourceStatuses.system, 'error');
  assert.ok(!recorded.chat.some(([, content]) => /Listening to host audio/i.test(content)));
});

test('REGRESSION: backend stopped acknowledgement while the native acquisition is still pending cancels the start', async (t) => {
  const { manager: managerModule } = await loadModules();
  afterHostTest(t);
  const gate = deferred();
  const { transcriptionManager, recorded, sourceStatuses, events } = buildHostHarness({
    managerModule,
    gates: { nativeStart: gate }
  });

  const starting = transcriptionManager.toggleMasterTranscription();
  await flush();
  transcriptionManager.handleVoskStopped({ source: 'system' });
  gate.resolve();
  await starting;
  await flush();

  assert.ok(!everActivated(recorded));
  assert.ok(events.includes('nativeStop:1'));
  assert.equal(sourceStatuses.system, 'off');
});

test('REGRESSION: a stopped event carrying a superseded attempt id must not tear down the new session', async (t) => {
  const { manager: managerModule } = await loadModules();
  afterHostTest(t);
  const { transcriptionManager, recorded, sourceStatuses, events, backendAttemptIds } = buildHostHarness({ managerModule });

  await transcriptionManager.toggleMasterTranscription(); // attempt A active
  await transcriptionManager.toggleMasterTranscription(); // explicit Stop
  assert.ok(events.includes('nativeStop:1'));

  await transcriptionManager.toggleMasterTranscription(); // attempt B active
  assert.ok(events.includes('nativeStart:2'));
  const [attemptA, attemptB] = backendAttemptIds;
  assert.ok(attemptA && attemptB && attemptA !== attemptB, 'each start owns a distinct renderer attempt id');

  transcriptionManager.handleVoskStopped({ source: 'system', attemptId: attemptA }); // late ack for attempt A
  await flush();

  assert.ok(!events.includes('nativeStop:2'), 'stale ack must not stop the live capture');
  assert.equal(sourceStatuses.system, 'connecting', 'stale ack must not change the live session status');
  const systemActivations = recorded.active.filter(([source]) => source === 'system');
  assert.deepEqual(systemActivations[systemActivations.length - 1], ['system', true], 'attempt B stays active');
  assert.ok(!recorded.feedback.some(([message]) => /Stopped/.test(message)), 'stale ack must not surface to the user');

  // The live attempt's own stopped event still tears it down.
  transcriptionManager.handleVoskStopped({ source: 'system', attemptId: attemptB });
  await flush();
  assert.ok(events.includes('nativeStop:2'), 'the live attempt stop event releases the capture');
  assert.equal(sourceStatuses.system, 'off');
});

test('REGRESSION: an error carrying a superseded attempt id must not tear down the new session', async (t) => {
  const { manager: managerModule } = await loadModules();
  afterHostTest(t);
  const { transcriptionManager, recorded, sourceStatuses, events, backendAttemptIds } = buildHostHarness({ managerModule });

  await transcriptionManager.toggleMasterTranscription(); // attempt A active
  await transcriptionManager.toggleMasterTranscription(); // explicit Stop

  await transcriptionManager.toggleMasterTranscription(); // attempt B active
  const [attemptA, attemptB] = backendAttemptIds;
  transcriptionManager.handleVoskError({ source: 'system', attemptId: attemptA, error: 'Old session socket error' });
  await flush();

  assert.ok(!events.includes('nativeStop:2'), 'stale error must not stop the live capture');
  assert.equal(sourceStatuses.system, 'connecting');
  assert.ok(!recorded.feedback.some(([message]) => /Old session socket error/.test(message)));

  // The live attempt's own error still tears it down.
  transcriptionManager.handleVoskError({ source: 'system', attemptId: attemptB, error: 'Live connection lost' });
  await flush();
  assert.ok(events.includes('nativeStop:2'), 'the live attempt error releases the capture');
  assert.equal(sourceStatuses.system, 'error');
});

test('REGRESSION: a native capture error is correlated to the owning attempt', async (t) => {
  const { manager: managerModule } = await loadModules();
  afterHostTest(t);
  const { transcriptionManager, sourceStatuses, events, nativeAttemptIds } = buildHostHarness({ managerModule });

  await transcriptionManager.toggleMasterTranscription(); // capture of attempt A
  await transcriptionManager.toggleMasterTranscription(); // explicit Stop
  await transcriptionManager.toggleMasterTranscription(); // capture of attempt B
  const [attemptA, attemptB] = nativeAttemptIds;
  assert.ok(attemptA && attemptB && attemptA !== attemptB);

  // A late error from the dead first capture must not touch the live one.
  transcriptionManager.handleVoskError({
    source: 'system',
    error: 'Host audio capture stopped unexpectedly (pw-record exit code 1)',
    captureToken: attemptA,
    attemptId: attemptA
  });
  await flush();
  assert.ok(!events.includes('nativeStop:2'), 'a stale capture error must not stop the live capture');
  assert.equal(sourceStatuses.system, 'connecting');

  // The error of the live capture itself tears the session down.
  transcriptionManager.handleVoskError({
    source: 'system',
    error: 'Host audio capture stopped unexpectedly (pw-record exit code 1)',
    captureToken: attemptB,
    attemptId: attemptB
  });
  await flush();
  assert.ok(events.includes('nativeStop:2'), 'the live capture error releases the session');
  assert.equal(sourceStatuses.system, 'error');
});

// ---------------------------------------------------------------------------
// Renderer-owned attempt ids: correlation identity exists BEFORE any await, so
// a live terminal event arriving while its own start RPC is still pending is
// recognised as live and cancels the acquisition, and a stale event arriving
// during a replacement's pending start is ignored. These mirror the reviewer's
// REVIEW_EARLY scratch reproductions.
// ---------------------------------------------------------------------------

for (const terminal of ['error', 'termination']) {
  test(`REGRESSION correlation: a live ${terminal} before the start RPC response cancels acquisition`, async (t) => {
    const { manager: managerModule } = await loadModules();
    afterHostTest(t);
    const h = buildServiceBackedHostHarness({ managerModule });
    const m = h.transcriptionManager;
    const gate = deferred();

    // The RPC result is held back while the live socket is already able to
    // emit its terminal event (the reviewer's exact ordering).
    window.electronAPI.startVoiceRecognition = async (source, opts) => {
      h.events.push(`startVoiceRecognition:${source}`);
      const result = h.service.startAssemblyAiStream(source, opts);
      h.sockets[h.sockets.length - 1].emit('open');
      await gate.promise;
      return result;
    };

    const starting = m.toggleMasterTranscription();
    await flush();
    if (terminal === 'error') {
      h.sockets[0].emit('error', new Error('connection failed before IPC response'));
    } else {
      h.sockets[0].emit('message', terminationFrame());
    }
    gate.resolve();
    await starting;
    await flush();

    assert.ok(!everActivated(h.recorded), `a live ${terminal} before the RPC response must prevent activation`);
    assert.ok(!h.events.includes('nativeStart:1'), 'a terminated backend attempt must never acquire a capture');
    assert.equal(h.sourceStatuses.system, terminal === 'error' ? 'error' : 'off');
  });
}

test('REGRESSION correlation: a live native-capture death before the capture RPC response cancels activation', async (t) => {
  const { manager: managerModule } = await loadModules();
  afterHostTest(t);
  const gate = deferred();
  const h = buildHostHarness({ managerModule, gates: { nativeStart: gate } });
  const m = h.transcriptionManager;

  const starting = m.toggleMasterTranscription();
  await flush();
  const attemptId = h.nativeAttemptIds[0];
  assert.ok(attemptId, 'the renderer handed its attempt id to the pending capture start');

  // The current capture dies before its start RPC has resolved.
  m.handleVoskError({
    source: 'system',
    error: 'pw-record died before IPC response',
    captureToken: attemptId,
    attemptId
  });
  gate.resolve(); // the handle arrives after the death was handled
  await starting;
  await flush();

  assert.ok(!everActivated(h.recorded), 'a dead capture must not activate');
  assert.ok(h.events.includes('nativeStop:1'), 'the late handle must be released immediately');
  assert.equal(h.sourceStatuses.system, 'error');
});

test('REGRESSION correlation: a stale session event during a pending replacement start is ignored', async (t) => {
  const { manager: managerModule } = await loadModules();
  afterHostTest(t);
  const gate = deferred();
  const h = buildHostHarness({ managerModule, gates: { nativeStart: gate, nativeStartId: 2 } });
  const m = h.transcriptionManager;

  await m.toggleMasterTranscription(); // attempt A active (native capture 1)
  await m.toggleMasterTranscription(); // Stop A
  assert.ok(h.events.includes('nativeStop:1'));

  const startingB = m.toggleMasterTranscription(); // attempt B pending on its gated capture start
  await flush();
  const [attemptA, attemptB] = h.backendAttemptIds;
  assert.ok(h.events.includes('nativeStart:2'));

  // Stale events of the replaced attempt arrive while B is still starting.
  const activeEntriesBeforeStale = h.recorded.active.length;
  m.handleVoskError({ source: 'system', attemptId: attemptA, error: 'Old session socket error' });
  m.handleVoskStopped({ source: 'system', attemptId: attemptA });
  m.handleVoskError({ source: 'system', attemptId: attemptA, captureToken: attemptA, error: 'old capture died late' });
  await flush();

  assert.equal(h.sourceStatuses.system, 'connecting', 'stale events must not change the pending attempt status');
  assert.ok(!h.recorded.feedback.some(([message]) => /Old session socket error|old capture died/.test(message)));
  assert.equal(h.recorded.active.length, activeEntriesBeforeStale, 'stale events must not activate or deactivate anything');

  gate.resolve();
  await startingB;
  await flush();
  assert.ok(everActivated(h.recorded), 'the replacement attempt activates after its start resolves');
  assert.ok(!h.events.includes('nativeStop:2'), 'stale events never touched the replacement capture');

  // The replacement's own terminal event still applies.
  m.handleVoskStopped({ source: 'system', attemptId: attemptB });
  await flush();
  assert.ok(h.events.includes('nativeStop:2'));
  assert.equal(h.sourceStatuses.system, 'off');
});

// ---------------------------------------------------------------------------
// Cross-layer: the REAL AssemblyAI service wired to the REAL transcription
// manager through the same electronAPI bridge shape the preload exposes.
// Session correlation must survive stop/restart in both directions: obsolete
// events are suppressed at the service (or ignored by id at the manager), and
// the live session's own terminal events always apply.
// ---------------------------------------------------------------------------

function buildServiceBackedHostHarness({ managerModule, platform = 'linux', apiKey = 'test-key', delivery = 'direct', gates = {} } = {}) {
  const h = buildHostHarness({ managerModule, platform, gates });
  const sockets = [];
  const delivered = [];
  const queue = [];
  let currentApiKey = apiKey;

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

  const dispatch = (channel, data) => {
    if (channel === 'vosk-error') h.transcriptionManager.handleVoskError(data);
    else if (channel === 'vosk-stopped') h.transcriptionManager.handleVoskStopped(data);
    else if (channel === 'vosk-status') h.transcriptionManager.handleVoskStatus(data);
    else if (channel === 'vosk-final') h.transcriptionManager.handleVoskFinal(data);
    else if (channel === 'vosk-partial') h.transcriptionManager.handleVoskPartial(data);
  };

  const service = createAssemblyAiService({
    WebSocket: FakeWebSocket,
    desktopCapturer: { getSources: async () => [] },
    getAssemblyApiKey: () => currentApiKey,
    getSpeechModel: () => 'test-model',
    getGeminiService: () => null,
    sendToRenderer: (channel, data) => {
      delivered.push(channel);
      if (delivery === 'queued') queue.push(() => dispatch(channel, data));
      else dispatch(channel, data);
    }
  });

  window.electronAPI.startVoiceRecognition = async (source, opts) => {
    h.events.push(`startVoiceRecognition:${source}`);
    const socketCount = sockets.length;
    const result = service.startAssemblyAiStream(source, opts);
    if (result && result.success && sockets.length > socketCount) {
      sockets[sockets.length - 1].emit('open'); // the connection completes
    }
    return result;
  };
  window.electronAPI.stopVoiceRecognition = async (source, opts) => {
    h.events.push(`stopVoiceRecognition:${source}`);
    return service.stopVoiceRecognition({ source, attemptId: opts?.attemptId });
  };

  return {
    ...h,
    service,
    sockets,
    delivered,
    flushQueued: () => queue.splice(0).forEach((fn) => fn()),
    setApiKey: (key) => {
      currentApiKey = key;
    }
  };
}

const terminationFrame = () => JSON.stringify({ type: 'Termination', audio_duration_seconds: 1 });
const lastSystemActive = (recorded) => {
  const entries = recorded.active.filter(([source]) => source === 'system');
  return entries[entries.length - 1];
};

for (const terminal of ['error', 'termination', 'native-error']) {
  test(`REGRESSION cross-layer: stop/restart then a live ${terminal} must release the new session capture`, async (t) => {
    const { manager: managerModule } = await loadModules();
    afterHostTest(t);
    const h = buildServiceBackedHostHarness({ managerModule });
    const m = h.transcriptionManager;

    await m.toggleMasterTranscription(); // session A (backend session 1)
    await m.toggleMasterTranscription(); // Stop A
    await m.toggleMasterTranscription(); // session B (backend session 2)
    assert.ok(h.events.includes('nativeStart:2'));
    assert.equal(h.sockets.length, 2);

    h.sockets[0].emit('message', terminationFrame()); // stale A termination arrives late
    if (terminal === 'error') {
      h.sockets[1].emit('error', new Error('live connection lost'));
    } else if (terminal === 'termination') {
      h.sockets[1].emit('message', terminationFrame());
    } else {
      m.handleVoskError({ source: 'system', error: 'Host audio capture stopped unexpectedly (pw-record exit code 1)' });
    }
    await flush();

    assert.ok(h.events.includes('nativeStop:2'), `the live ${terminal} must release the restarted capture`);
    assert.deepEqual(lastSystemActive(h.recorded), ['system', false]);
    assert.equal(h.sourceStatuses.system, terminal === 'termination' ? 'off' : 'error');
  });
}

test('REGRESSION cross-layer: a failed start whose cleanup stop is a backend no-op must not swallow the next session', async (t) => {
  const { manager: managerModule } = await loadModules();
  afterHostTest(t);
  const h = buildServiceBackedHostHarness({ managerModule, platform: 'win32' });
  const m = h.transcriptionManager;

  // The first start fails before any backend session exists (no desktop
  // sources), so its cleanup stop hits a backend with no socket: a pure
  // no-op that never produces a terminal event.
  window.electronAPI.getDesktopSources = async () => [];
  await m.toggleMasterTranscription();
  assert.equal(h.sourceStatuses.system, 'error');
  assert.deepEqual(h.sockets.length, 0);

  // The second start succeeds and must still react to its own terminal event.
  window.electronAPI.getDesktopSources = async () => [{ id: 'screen:0', name: 'Entire Screen' }];
  await m.toggleMasterTranscription();
  assert.ok(everActivated(h.recorded));
  assert.equal(h.sockets.length, 1);

  h.sockets[0].emit('message', terminationFrame());
  await flush();

  assert.ok(h.events.includes('streamStopped'), 'the live termination must release the desktop stream');
  assert.equal(h.sourceStatuses.system, 'off');
  assert.deepEqual(lastSystemActive(h.recorded), ['system', false]);
});

test('REGRESSION cross-layer: a missing-API-key failure is surfaced once and the next start is unaffected', async (t) => {
  const { manager: managerModule } = await loadModules();
  afterHostTest(t);
  const h = buildServiceBackedHostHarness({ managerModule, apiKey: null });
  const m = h.transcriptionManager;

  await m.toggleMasterTranscription(); // fails: no key configured
  assert.equal(h.sourceStatuses.system, 'error');
  assert.ok(h.recorded.feedback.some(([message]) => /API key/i.test(message)));
  assert.ok(!h.events.some((e) => e.startsWith('nativeStart')), 'no capture without a backend session');
  assert.deepEqual(h.sockets.length, 0);
  assert.equal(
    h.recorded.feedback.filter(([message]) => /API key/i.test(message)).length,
    1,
    'the failure is surfaced exactly once'
  );

  h.setApiKey('test-key');
  await m.toggleMasterTranscription(); // works now
  assert.ok(h.events.includes('nativeStart:1'));
  assert.ok(everActivated(h.recorded));

  h.sockets[0].emit('message', terminationFrame());
  await flush();
  assert.ok(h.events.includes('nativeStop:1'), 'the live session reacts to its own termination');
  assert.equal(h.sourceStatuses.system, 'off');
});

test('REGRESSION cross-layer: a stop acknowledgement arriving before the stop RPC resolves is handled once, then the next session works', async (t) => {
  const { manager: managerModule } = await loadModules();
  afterHostTest(t);
  const h = buildServiceBackedHostHarness({ managerModule });
  const m = h.transcriptionManager;

  await m.toggleMasterTranscription(); // session A (socket 0)
  assert.ok(h.events.includes('nativeStart:1'));

  // The backend answers the Terminate frame before the stop RPC resolves.
  window.electronAPI.stopVoiceRecognition = async (source, opts) => {
    h.events.push(`stopVoiceRecognition:${source}`);
    const result = h.service.stopVoiceRecognition({ source, attemptId: opts?.attemptId });
    h.sockets[0].emit('message', terminationFrame());
    return result;
  };
  await m.toggleMasterTranscription(); // Stop
  assert.equal(h.events.filter((e) => e === 'nativeStop:1').length, 1, 'capture released exactly once');
  assert.equal(h.sourceStatuses.system, 'off');

  await m.toggleMasterTranscription(); // session B (socket 1)
  assert.ok(h.events.includes('nativeStart:2'));

  h.sockets[1].emit('message', terminationFrame());
  await flush();
  assert.ok(h.events.includes('nativeStop:2'), 'the next session termination is not swallowed by the early ack');
  assert.equal(h.sourceStatuses.system, 'off');
});

// ---------------------------------------------------------------------------
// Native capture death ends the WHOLE attempt: the backend session owned by
// the dead capture's attempt is stopped (scoped to that attempt), and a
// restart never adopts the orphaned backend session — the main process ends
// it and opens a fresh one with the new attempt's identity. A live backend
// failure after the restart then releases the new capture. These mirror the
// reviewer's REVIEW_NATIVE_RESTART scratch reproductions.
// ---------------------------------------------------------------------------

for (const pending of [false, true]) {
  test(`REGRESSION cross-layer: native capture death ${pending ? 'during acquisition' : 'while active'} ends the backend attempt and the restart starts fresh`, async (t) => {
    const { manager: managerModule } = await loadModules();
    afterHostTest(t);
    const gate = deferred();
    const h = buildServiceBackedHostHarness({ managerModule, gates: pending ? { nativeStart: gate } : {} });
    const m = h.transcriptionManager;
    const starts = [];
    window.electronAPI.startVoiceRecognition = async (source, opts) => {
      h.events.push(`startVoiceRecognition:${source}`);
      const socketCount = h.sockets.length;
      const result = h.service.startAssemblyAiStream(source, opts);
      starts.push({ requested: opts?.attemptId, returned: result?.attemptId });
      if (result && result.success && h.sockets.length > socketCount) {
        h.sockets[h.sockets.length - 1].emit('open'); // the connection completes
      }
      return result;
    };

    const first = m.toggleMasterTranscription();
    await flush();
    if (!pending) await first; // attempt A fully active (backend socket 0 + capture 1)
    const attemptA = starts[0].requested;
    assert.ok(attemptA, 'the renderer handed its attempt id to the backend start');

    // The current attempt's pw-record dies — while active or while its start
    // RPC is still pending — tagged with the owning attempt, as ipc.js sends it.
    m.handleVoskError({
      source: 'system',
      attemptId: attemptA,
      captureToken: attemptA,
      error: 'Host audio capture stopped unexpectedly (pw-record exit code 1)'
    });
    gate.resolve(); // pending case: the late capture handle arrives after the death
    await first;
    await flush();

    assert.ok(h.events.includes('nativeStop:1'), 'the dead attempt capture is released');
    assert.deepEqual(lastSystemActive(h.recorded), ['system', false]);
    assert.ok(
      h.sockets[0].sent.some((frame) => String(frame).includes('Terminate')),
      'native capture death must also end the backend session owned by the same attempt'
    );

    // Restart: attempt B must get a FRESH backend session with its own
    // identity, never adopt the orphaned one.
    await m.toggleMasterTranscription();
    await flush();

    assert.ok(h.events.includes('nativeStart:2'), 'the restart acquires a fresh capture');
    assert.equal(starts.length, 2);
    assert.equal(
      starts[1].returned,
      starts[1].requested,
      'the restart must have the backend identity of the new renderer attempt, not the previous dead attempt'
    );
    assert.ok(h.sockets.length >= 2, 'a fresh backend socket was opened for the restart');

    // A live backend failure of the NEW session now applies and releases the
    // NEW capture (previously it was tagged with the dead attempt and ignored).
    const liveSocket = h.sockets[h.sockets.length - 1];
    liveSocket.emit('error', new Error('current socket connection lost after restart'));
    await flush();

    assert.ok(h.events.includes('nativeStop:2'), 'a live backend failure after the restart must release the new capture');
    assert.deepEqual(lastSystemActive(h.recorded), ['system', false]);
    assert.equal(h.sourceStatuses.system, 'error');
  });
}
