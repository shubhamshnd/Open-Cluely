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
  assert.match(linuxMessage, /No 'Monitor of/);
  assert.match(linuxMessage, /pipewire-pulse/);
  assert.match(linuxMessage, /pick the monitor device as your microphone/);

  const windowsMessage = errors.getSystemAudioUnsupportedMessage(WINDOWS_UA);
  assert.doesNotMatch(windowsMessage, /Linux/);
  assert.match(windowsMessage, /Mic source/);
});

test('pickMonitorDevice: picks a "Monitor of …" audioinput', async () => {
  const { pipeline } = await loadModules();

  const devices = [
    { kind: 'audioinput', deviceId: 'mic1', label: 'Built-in Microphone' },
    { kind: 'audioinput', deviceId: 'mon1', label: 'Monitor of Built-in Audio Analog Stereo' },
    { kind: 'audiooutput', deviceId: 'default', label: 'Built-in Audio Analog Stereo' }
  ];

  assert.equal(pipeline.pickMonitorDevice(devices).deviceId, 'mon1');
});

test('pickMonitorDevice: prefers the monitor of the default output over the first monitor', async () => {
  const { pipeline } = await loadModules();

  const devices = [
    { kind: 'audioinput', deviceId: 'mon-other', label: 'Monitor of HDMI Output' },
    { kind: 'audioinput', deviceId: 'mon-default', label: 'Monitor of Built-in Audio Analog Stereo' },
    { kind: 'audiooutput', deviceId: 'default', label: 'Built-in Audio Analog Stereo' },
    { kind: 'audiooutput', deviceId: 'hdmi', label: 'HDMI Output' }
  ];

  assert.equal(pipeline.pickMonitorDevice(devices).deviceId, 'mon-default');
});

test('pickMonitorDevice: falls back to the first monitor and returns null when none', async () => {
  const { pipeline } = await loadModules();

  // Default output matches no monitor label → first monitor wins.
  const devices = [
    { kind: 'audioinput', deviceId: 'mon1', label: 'Monitor of HDMI Output' },
    { kind: 'audioinput', deviceId: 'mon2', label: 'Monitor of USB DAC' },
    { kind: 'audiooutput', deviceId: 'default', label: 'Something Else' }
  ];
  assert.equal(pipeline.pickMonitorDevice(devices).deviceId, 'mon1');

  // No monitor at all.
  assert.equal(
    pipeline.pickMonitorDevice([{ kind: 'audioinput', deviceId: 'mic1', label: 'Built-in Microphone' }]),
    null
  );
  // Labels not yet populated (no permission grant) → no match.
  assert.equal(
    pipeline.pickMonitorDevice([{ kind: 'audioinput', deviceId: '', label: '' }]),
    null
  );
  assert.equal(pipeline.pickMonitorDevice([]), null);
  assert.equal(pipeline.pickMonitorDevice(undefined), null);
});

test('audio pipeline: linux monitor capture requests the picked device, audio-only', async () => {
  const { pipeline } = await loadModules();
  const devices = [
    { kind: 'audioinput', deviceId: 'mic1', label: 'Built-in Microphone' },
    { kind: 'audioinput', deviceId: 'mon1', label: 'Monitor of Built-in Audio Analog Stereo' },
    { kind: 'audiooutput', deviceId: 'default', label: 'Built-in Audio Analog Stereo' }
  ];
  const { stream } = createFakeStream({ audioTrackStates: ['live'] });
  const attempts = [];
  const monitorLogs = [];
  const audioPipeline = pipeline.createAudioPipeline({
    sendAudioChunk: () => {},
    addMonitorLog: (...args) => monitorLogs.push(args),
    enumerateDevices: async () => devices,
    getUserMedia: async (constraints) => {
      attempts.push(constraints);
      return stream;
    }
  });

  const result = await audioPipeline.getSystemAudioMonitorStream();

  assert.equal(result, stream);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].video, false);
  assert.deepEqual(attempts[0].audio.deviceId, { exact: 'mon1' });
  assert.equal(attempts[0].audio.echoCancellation, false);
  assert.equal(attempts[0].audio.noiseSuppression, false);
  assert.equal(attempts[0].audio.autoGainControl, false);
  assert.ok(!('chromeMediaSource' in attempts[0].audio));
  assert.ok(
    monitorLogs.some((args) => args[1] === 'monitor-device' && /Monitor of/.test(args[2]))
  );
});

test('audio pipeline: empty labels prime mic permission once, then re-enumerate', async () => {
  const { pipeline } = await loadModules();
  const labeledDevices = [
    { kind: 'audioinput', deviceId: 'mic1', label: 'Built-in Microphone' },
    { kind: 'audioinput', deviceId: 'mon1', label: 'Monitor of Built-in Audio Analog Stereo' }
  ];
  const unlabeledDevices = labeledDevices.map((device) => ({ ...device, label: '' }));
  let enumerateCalls = 0;
  const attempts = [];
  const stoppedPrimingTracks = [];
  const { stream } = createFakeStream({ audioTrackStates: ['live'] });
  const audioPipeline = pipeline.createAudioPipeline({
    sendAudioChunk: () => {},
    addMonitorLog: () => {},
    enumerateDevices: async () => {
      enumerateCalls += 1;
      return enumerateCalls === 1 ? unlabeledDevices : labeledDevices;
    },
    getUserMedia: async (constraints) => {
      attempts.push(constraints);
      if (constraints.audio === true) {
        const primingTrack = {
          readyState: 'live',
          stop: () => stoppedPrimingTracks.push('stopped')
        };
        return {
          getTracks: () => [primingTrack],
          getAudioTracks: () => [primingTrack],
          getVideoTracks: () => []
        };
      }
      return stream;
    }
  });

  const result = await audioPipeline.getSystemAudioMonitorStream();

  assert.equal(result, stream);
  assert.equal(enumerateCalls, 2);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].audio, true);
  assert.deepEqual(stoppedPrimingTracks, ['stopped']);
  assert.deepEqual(attempts[1].audio.deviceId, { exact: 'mon1' });
});

test('audio pipeline: no monitor device → typed unsupported error, no getUserMedia', async () => {
  const { errors, pipeline } = await loadModules();
  const audioPipeline = pipeline.createAudioPipeline({
    sendAudioChunk: () => {},
    addMonitorLog: () => {},
    enumerateDevices: async () => [
      { kind: 'audioinput', deviceId: 'mic1', label: 'Built-in Microphone' }
    ],
    getUserMedia: async () => {
      throw new Error('getUserMedia must not be called when no monitor exists');
    }
  });

  await assert.rejects(audioPipeline.getSystemAudioMonitorStream(), (error) => {
    assert.ok(errors.isSystemAudioUnsupportedError(error));
    assert.match(error.cause, /No 'Monitor of/);
    assert.match(error.cause, /pipewire-pulse/);
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

test('transcription manager: on Linux the host source uses the monitor input, never desktop sources', async (t) => {
  const { manager: managerModule } = await loadModules();
  t.after(() => {
    cleanupManagerGlobals();
    delete globalThis.AudioContext;
  });

  const recorded = { chat: [], feedback: [], active: [], monitorRows: [] };
  const sourceStatuses = { system: 'off', mic: 'off' };
  const selectedSources = { system: true, mic: false };
  const stopCalls = [];
  const desktopSourceCalls = [];
  const desktopStreamCalls = [];
  const monitorStreamCalls = [];
  const stoppedResources = [];

  globalThis.document = {
    createElement: () => ({ className: '', textContent: '', style: {} })
  };
  globalThis.AudioContext = class {
    async resume() {}
    async close() {}
  };
  const monitorLogList = {
    innerHTML: '',
    appendChild: (row) => recorded.monitorRows.push(row.textContent)
  };

  const stoppedTracks = [];
  const monitorStream = {
    getAudioTracks: () => [{ readyState: 'live', stop: () => stoppedTracks.push('audio') }],
    getVideoTracks: () => [],
    getTracks: () => [{ readyState: 'live', stop: () => stoppedTracks.push('audio') }]
  };

  globalThis.window = {
    navigator: { userAgent: LINUX_UA },
    electronAPI: {
      platform: 'linux',
      getDesktopSources: async () => {
        desktopSourceCalls.push('called');
        return [{ id: 'screen:0', name: 'Entire Screen' }];
      },
      startVoiceRecognition: async () => ({}),
      stopVoiceRecognition: async (source) => stopCalls.push(source)
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
      isAnySourceConnecting: () => false
    },
    normalizeSourceRule: (source) => (source === 'system' ? 'system' : 'mic'),
    sourceLabelRule: (source) => (source === 'system' ? 'Host' : 'Mic'),
    audioPipeline: {
      getSystemAudioStream: async () => {
        desktopStreamCalls.push('called');
        throw new Error('desktop capture must not be used on Linux');
      },
      getSystemAudioMonitorStream: async () => {
        monitorStreamCalls.push('called');
        return monitorStream;
      },
      resetSourceSampleQueue: () => {},
      stopAudioResources: (ctx, stream, processor) => stoppedResources.push([ctx, stream, processor]),
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

  // Start: monitor path, no desktopCapturer IPC, no chromeMediaSource stream.
  await transcriptionManager.toggleMasterTranscription();

  assert.deepEqual(desktopSourceCalls, []);
  assert.deepEqual(desktopStreamCalls, []);
  assert.equal(monitorStreamCalls.length, 1);
  assert.deepEqual(recorded.feedback, [['System audio on', 'success']]);
  assert.ok(recorded.chat.some(([type, content]) => type === 'system' && /Listening to host audio/i.test(content)));
  assert.ok(recorded.active.some(([source, active]) => source === 'system' && active === true));
  // Stays 'connecting' until the main process reports 'listening' via the
  // vosk-status IPC (not exercised here); crucially, not 'error'.
  assert.equal(sourceStatuses.system, 'connecting');

  // Stop: every capture resource is released and the stop IPC goes out.
  await transcriptionManager.toggleMasterTranscription();

  assert.equal(stoppedResources.length, 1);
  assert.equal(stoppedResources[0][1], monitorStream);
  assert.deepEqual(stopCalls, ['system']);
  assert.ok(recorded.active.some(([source, active]) => source === 'system' && active === false));
  assert.equal(sourceStatuses.system, 'off');
});
