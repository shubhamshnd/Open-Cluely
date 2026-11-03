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
      startVoiceRecognition: async (source) => {
        events.push(`startVoiceRecognition:${source}`);
        if (gates.startVoice) await gates.startVoice.promise;
        return {};
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
      startNativeMonitorCapture: async () => {
        nativeCounter += 1;
        const id = nativeCounter;
        events.push(`nativeStart:${id}`);
        if (gates.nativeStart && id === 1) await gates.nativeStart.promise;
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

  return { transcriptionManager, recorded, sourceStatuses, events };
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
