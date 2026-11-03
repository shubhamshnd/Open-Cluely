// ============================================================================
// AMAZON TRANSCRIBE STREAMING STT SERVICE
// ============================================================================
// Streaming speech-to-text via `@aws-sdk/client-transcribe-streaming`
// (StartStreamTranscription, 16 kHz s16le mono PCM — exactly what the existing
// renderer worklet and the Linux pw-record capture already produce, so no
// audio conversion is needed).
//
// This service implements the SAME interface and event contract the IPC layer
// uses for AssemblyAI (../assembly-ai/service.js), so the renderer, transcript
// buffer, mobile bridge and STT history work unchanged:
//   - startAssemblyAiStream(source, { attemptId }) / handleAudioChunk /
//     stopVoiceRecognition / dispose (the method name is the shared IPC
//     interface; the provider router picks which service receives the call).
//   - Events: vosk-status (loading/listening/stopped), vosk-partial,
//     vosk-final, vosk-error, vosk-stopped, stt-debug — every one tagged with
//     the renderer-owned attemptId when the start carried one.
//   - Renderer-owned attemptId correlation (same rules as AssemblyAI): a
//     start with a new attempt id ends an orphaned session instead of
//     adopting it; an attempt-scoped stop never kills a newer attempt's
//     session; events from superseded sessions are suppressed, never emitted.
//   - Stop ends the AudioStream async iterator AND aborts the command
//     (AbortController), so no stream or session is leaked.
//
// Credentials come from the shared AWS auth resolver (../aws/credentials.js);
// a Bedrock API key (bearer) is rejected there for purpose 'transcribe'.
// Tests inject a fake client via options.createClient.
// ============================================================================

const {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand
} = require('@aws-sdk/client-transcribe-streaming');
const {
  createSttHistoryManager,
  normalizeSttSource
} = require('../assembly-ai/stt-history');
const { resolveAwsAuth } = require('../aws/credentials');
const { safeEventStreamPayloadHandlerProvider } = require('./safe-eventstream-handler');
const {
  resolveTranscribeRegion,
  resolveTranscribeLanguage
} = require('../../config');

const TRANSCRIBE_SAMPLE_RATE = 16000;
const TRANSCRIBE_MEDIA_ENCODING = 'pcm';

function defaultCreateClient(clientConfig) {
  return new TranscribeStreamingClient(clientConfig);
}

function isAbortError(error) {
  return error?.name === 'AbortError' || error?.name === 'AbortSignalTimeoutError';
}

function createAwsTranscribeService({
  getTranscribeSettings,
  getGeminiService,
  sendToRenderer,
  createClient = defaultCreateClient
}) {
  let isStreamingMic = false;
  let isStreamingSystem = false;

  // Session correlation mirrors the AssemblyAI service: the renderer owns the
  // correlation identity; every event for a session is stamped with it.
  const sessions = { mic: null, system: null };
  const sessionCounters = { mic: 0, system: 0 };
  const currentSessionIds = { mic: 0, system: 0 };
  const currentAttemptIds = { mic: null, system: null };
  // Sessions an explicit stop was issued for: their late events (a send()
  // resolving after abort, trailing results) must not emit or resurrect.
  const stoppedSessions = new WeakSet();

  const sttChunkCounters = { mic: 0, system: 0 };
  const sttDroppedChunkCounters = { mic: 0, system: 0 };

  function emitSttDebug({ source = null, level = 'info', event = 'event', message = '', meta = null } = {}) {
    const payload = {
      ts: new Date().toISOString(),
      source: source === 'mic' || source === 'system' ? source : null,
      level,
      event,
      message,
      meta
    };

    sendToRenderer('stt-debug', payload);
  }

  const sttHistoryManager = createSttHistoryManager({
    getGeminiService,
    emitSttDebug,
    mergeWindowMs: 3500
  });

  // -------------------------------------------------------------------------
  // Per-session audio queue: handleAudioChunk pushes, the AudioStream async
  // generator drains. Stop ends the queue so the generator returns and the
  // SDK can half-close the stream.
  // -------------------------------------------------------------------------
  function pushAudioChunk(session, chunk) {
    const { queue } = session;
    if (queue.ended) {
      return false;
    }
    queue.chunks.push(chunk);
    if (queue.waiting) {
      const wake = queue.waiting;
      queue.waiting = null;
      wake();
    }
    return true;
  }

  function endAudioQueue(session) {
    const { queue } = session;
    queue.ended = true;
    if (queue.waiting) {
      const wake = queue.waiting;
      queue.waiting = null;
      wake();
    }
  }

  async function* audioEventStream(session) {
    const { queue } = session;
    for (;;) {
      while (queue.chunks.length > 0) {
        yield { AudioEvent: { AudioChunk: queue.chunks.shift() } };
      }
      if (queue.ended) {
        return;
      }
      // Wait for the next chunk (or the end signal). Audio arrives in
      // ~100 ms frames, so the stream is paced by the capture itself.
      await new Promise((resolve) => {
        queue.waiting = resolve;
      });
    }
  }

  function getSourceSession(source) {
    return source === 'system' ? sessions.system : sessions.mic;
  }

  function setSourceSession(source, session) {
    if (source === 'system') {
      sessions.system = session;
    } else {
      sessions.mic = session;
    }
  }

  function isCurrentSession(session) {
    return getSourceSession(session.source) === session;
  }

  function isSourceStreaming(source) {
    return source === 'system' ? isStreamingSystem : isStreamingMic;
  }

  function setSourceStreaming(source, active) {
    if (source === 'system') {
      isStreamingSystem = active;
    } else {
      isStreamingMic = active;
    }
  }

  function resetSourceState(source) {
    const resolvedSource = normalizeSttSource(source);
    sttChunkCounters[resolvedSource] = 0;
    sttDroppedChunkCounters[resolvedSource] = 0;
    sttHistoryManager.resetSttHistoryBuffer(resolvedSource);
    setSourceSession(resolvedSource, null);
    setSourceStreaming(resolvedSource, false);
  }

  // A session's stream ended without an error: either a user stop (already
  // acknowledged with a vosk-status) or the server closing the stream. The
  // vosk-stopped carries the session's (possibly stale) attempt id, exactly
  // like the AssemblyAI Termination message does.
  function finishSession(session, reason) {
    const resolvedSource = session.source;
    sttHistoryManager.flushSttHistoryBuffer(resolvedSource, reason);
    resetSourceState(resolvedSource);
    sendToRenderer('vosk-stopped', session.withAttempt({ source: resolvedSource, sessionId: session.id }));
  }

  function handleTranscriptEvent(session, event) {
    // TranscriptResultStream yields the event-stream UNION: each event is
    // { TranscriptEvent: { Transcript: { Results: [...] } } }, never the
    // flattened { Transcript: ... } shape. Verified against the real SDK
    // response on the wire (exception members arrive as thrown errors).
    const results = event?.TranscriptEvent?.Transcript?.Results;
    if (!Array.isArray(results)) {
      return;
    }
    for (const result of results) {
      const transcript = result?.Alternatives?.[0]?.Transcript;
      if (!transcript || !transcript.trim()) {
        continue;
      }
      if (result.IsPartial) {
        sendToRenderer('vosk-partial', session.withAttempt({
          source: session.source,
          text: transcript,
          sessionId: session.id
        }));
      } else {
        console.log(`Transcribe final [${session.source}]:`, transcript);
        emitSttDebug({
          source: session.source,
          event: 'result-final',
          message: 'Final transcript received',
          meta: { chars: transcript.length }
        });
        sendToRenderer('vosk-final', session.withAttempt({
          source: session.source,
          text: transcript,
          sessionId: session.id
        }));
        sttHistoryManager.queueSttHistorySegment(session.source, transcript);
      }
    }
  }

  // Owns the SDK round trip for one session. Resolves when the stream ends
  // (cleanly, by stop, or by error). Never throws.
  async function runSession(session, commandInput) {
    const resolvedSource = session.source;
    const logStaleSessionEvent = (kind) => {
      emitSttDebug({
        source: resolvedSource,
        event: 'stale-session-event',
        message: `Ignored ${kind} from a superseded session`
      });
    };

    try {
      const response = await session.client.send(
        new StartStreamTranscriptionCommand({
          ...commandInput,
          AudioStream: audioEventStream(session)
        }),
        { abortSignal: session.abortController.signal }
      );

      if (!isCurrentSession(session) || stoppedSessions.has(session)) {
        // Superseded or stopped while the request was being established: the
        // late resolution must not mark the source streaming or resurrect the
        // session.
        logStaleSessionEvent('a stream start');
        return;
      }

      setSourceStreaming(resolvedSource, true);
      console.log(`Transcribe session started [${resolvedSource}]`);
      emitSttDebug({
        source: resolvedSource,
        event: 'session-begin',
        message: 'Amazon Transcribe session started'
      });
      sendToRenderer('vosk-status', session.withAttempt({
        source: resolvedSource,
        status: 'listening',
        message: `Listening (${resolvedSource === 'system' ? 'Host' : 'You'})...`,
        sessionId: session.id
      }));

      for await (const event of response.TranscriptResultStream) {
        if (!isCurrentSession(session) || stoppedSessions.has(session)) {
          logStaleSessionEvent('a transcript result');
          break;
        }
        handleTranscriptEvent(session, event);
      }

      if (isCurrentSession(session)) {
        finishSession(session, stoppedSessions.has(session) ? 'stop-request' : 'stream-ended');
      }
    } catch (error) {
      if (stoppedSessions.has(session) || isAbortError(error)) {
        // An explicit stop aborts the command; that is a normal end, not an
        // error. finishSession is a no-op when the session was superseded.
        if (isCurrentSession(session)) {
          finishSession(session, 'stop-request');
        }
        return;
      }
      if (!isCurrentSession(session)) {
        logStaleSessionEvent('an error');
        return;
      }
      console.error(`Transcribe stream error [${resolvedSource}]:`, error?.message);
      emitSttDebug({
        source: resolvedSource,
        level: 'error',
        event: 'stream-error',
        message: error?.message || 'Unknown Transcribe error'
      });
      sttHistoryManager.flushSttHistoryBuffer(resolvedSource, 'stream-error');
      sendToRenderer('vosk-error', session.withAttempt({
        source: resolvedSource,
        error: `Connection error (${resolvedSource}): ${error?.message || 'Unknown Transcribe error'}`,
        sessionId: session.id
      }));
      resetSourceState(resolvedSource);
    } finally {
      // Every terminal path owns cleanup, including server EOF and errors.
      // Once the session slot is reset, a later Stop/dispose cannot find it.
      endSession(session);
    }
  }

  // Explicitly ends a session (stop path): ends the audio iterator so the
  // SDK half-closes, then aborts the command so nothing lingers. The session
  // slot stays until runSession finishes (AssemblyAI Termination parity).
  function endSession(session) {
    stoppedSessions.add(session);
    endAudioQueue(session);
    try {
      session.abortController.abort();
    } catch (error) {
      console.error(`Error aborting Transcribe session [${session.source}]:`, error?.message);
    }
    try {
      session.client.destroy?.();
    } catch (_error) {
      // already gone
    }
  }

  function startAssemblyAiStream(source, { attemptId } = {}) {
    const resolvedSource = normalizeSttSource(source);
    const correlationId = typeof attemptId === 'string' && attemptId ? attemptId : null;
    const withAttempt = (payload) => (correlationId ? { ...payload, attemptId: correlationId } : payload);

    const settings = typeof getTranscribeSettings === 'function' ? getTranscribeSettings() || {} : {};
    const region = resolveTranscribeRegion(settings.region);
    const language = resolveTranscribeLanguage(settings.language);
    const vocabularyName = String(settings.vocabularyName || '').trim();
    const auth = resolveAwsAuth(settings.awsAuth || {}, { purpose: 'transcribe' });

    if (auth.error) {
      console.error('Amazon Transcribe auth is not configured:', auth.error);
      emitSttDebug({
        source: resolvedSource,
        level: 'error',
        event: 'auth-not-configured',
        message: auth.error
      });
      sendToRenderer('vosk-error', withAttempt({
        source: resolvedSource,
        error: auth.error
      }));
      return { success: false, error: auth.error, attemptId: correlationId ?? undefined };
    }

    if (isSourceStreaming(resolvedSource)) {
      const liveAttemptId = currentAttemptIds[resolvedSource] ?? null;
      if (correlationId && liveAttemptId !== correlationId) {
        // A start carrying a NEW renderer attempt id arrived while a session
        // owned by a DIFFERENT attempt is still streaming: that session is
        // orphaned. End it scoped to its own attempt, then fall through and
        // open a fresh session. A start must never adopt another attempt's
        // backend.
        emitSttDebug({
          source: resolvedSource,
          event: 'start-replaces-orphaned-session',
          message: 'Start for a new attempt ends the orphaned streaming session and opens a fresh one'
        });
        stopVoiceRecognition({ source: resolvedSource, attemptId: liveAttemptId ?? undefined });
      } else {
        emitSttDebug({
          source: resolvedSource,
          event: 'start-skipped',
          message: 'Start requested while source is already streaming'
        });
        return {
          success: true,
          message: resolvedSource === 'system' ? 'System audio already streaming' : 'Mic already streaming',
          sessionId: currentSessionIds[resolvedSource],
          attemptId: liveAttemptId ?? undefined
        };
      }
    }

    try {
      console.log(`Connecting to Amazon Transcribe for source: ${resolvedSource}`);
      emitSttDebug({
        source: resolvedSource,
        event: 'start-request',
        message: 'Opening Amazon Transcribe stream',
        meta: { region, language, vocabulary: vocabularyName || null }
      });

      sttChunkCounters[resolvedSource] = 0;
      sttDroppedChunkCounters[resolvedSource] = 0;
      sttHistoryManager.resetSttHistoryBuffer(resolvedSource);

      sendToRenderer('vosk-status', withAttempt({
        source: resolvedSource,
        status: 'loading',
        message: `Connecting (${resolvedSource})...`
      }));

      const clientConfig = { region, eventStreamPayloadHandlerProvider: safeEventStreamPayloadHandlerProvider };
      if (auth.credentials) {
        clientConfig.credentials = auth.credentials;
      }
      const client = createClient(clientConfig);

      sessionCounters[resolvedSource] += 1;
      const sessionId = sessionCounters[resolvedSource];
      const session = {
        id: sessionId,
        source: resolvedSource,
        client,
        abortController: new AbortController(),
        queue: { chunks: [], waiting: null, ended: false },
        withAttempt
      };

      // The session owns the slot from this moment; a session replaced by
      // this start belonged to a stopped or superseded attempt: end it so its
      // late events die with it instead of racing the live session.
      const previousSession = getSourceSession(resolvedSource);
      setSourceSession(resolvedSource, session);
      if (previousSession) {
        endSession(previousSession);
      }

      currentSessionIds[resolvedSource] = sessionId;
      currentAttemptIds[resolvedSource] = correlationId;

      const commandInput = {
        LanguageCode: language,
        MediaSampleRateHertz: TRANSCRIBE_SAMPLE_RATE,
        MediaEncoding: TRANSCRIBE_MEDIA_ENCODING
      };
      if (vocabularyName) {
        commandInput.VocabularyName = vocabularyName;
      }

      // Owns itself from here: resolves on stream end/stop/error, never throws.
      runSession(session, commandInput);

      return { success: true, sessionId, attemptId: correlationId ?? undefined };
    } catch (error) {
      console.error(`Error starting Amazon Transcribe stream [${resolvedSource}]:`, error?.message);
      emitSttDebug({
        source: resolvedSource,
        level: 'error',
        event: 'start-failed',
        message: error?.message || 'Failed to start Transcribe stream'
      });
      setSourceStreaming(resolvedSource, false);
      return { success: false, error: error?.message || 'Failed to start Transcribe stream' };
    }
  }

  function handleAudioChunk({ source, data }) {
    const resolvedSource = normalizeSttSource(source);
    const session = getSourceSession(resolvedSource);

    if (session && !stoppedSessions.has(session) && pushAudioChunk(session, Buffer.from(data))) {
      sttChunkCounters[resolvedSource] += 1;

      if (sttChunkCounters[resolvedSource] % 50 === 0) {
        emitSttDebug({
          source: resolvedSource,
          event: 'chunk-heartbeat',
          message: 'Streaming audio chunks',
          meta: {
            chunks: sttChunkCounters[resolvedSource],
            dropped: sttDroppedChunkCounters[resolvedSource]
          }
        });
      }
      return;
    }

    sttDroppedChunkCounters[resolvedSource] += 1;
    if (sttDroppedChunkCounters[resolvedSource] % 25 === 0) {
      emitSttDebug({
        source: resolvedSource,
        level: 'error',
        event: 'chunk-dropped',
        message: 'Audio chunk dropped because no live Transcribe session exists',
        meta: {
          dropped: sttDroppedChunkCounters[resolvedSource]
        }
      });
    }
  }

  function stopVoiceRecognition({ source, attemptId } = {}) {
    emitSttDebug({
      source: source === 'system' || source === 'mic' ? source : null,
      event: 'ipc-stop',
      message: `Stop requested for ${source || 'default'}`
    });

    // A stop scoped to a renderer-owned attempt id must only kill THAT
    // attempt's resources: if the live session belongs to a newer attempt, the
    // stop is stale (its target is already gone) and must not touch it.
    const requestedAttemptId = typeof attemptId === 'string' && attemptId ? attemptId : null;

    const stopSource = (src) => {
      const resolvedSource = normalizeSttSource(src);
      const session = getSourceSession(resolvedSource);

      if (requestedAttemptId && currentAttemptIds[resolvedSource] !== requestedAttemptId) {
        emitSttDebug({
          source: resolvedSource,
          event: 'stop-stale-scope',
          message: 'Stop for a superseded attempt ignored; the live session is untouched'
        });
        return;
      }

      if (!session) {
        sttHistoryManager.flushSttHistoryBuffer(resolvedSource, 'stop-noop');
        emitSttDebug({
          source: resolvedSource,
          event: 'stop-noop',
          message: 'Stop requested but no active session found'
        });
        sttChunkCounters[resolvedSource] = 0;
        sttDroppedChunkCounters[resolvedSource] = 0;
        return;
      }

      // Mark before any I/O: even if this session is still connecting, its
      // late start must not mark the source streaming again.
      endSession(session);

      sttHistoryManager.flushSttHistoryBuffer(resolvedSource, 'stop-request');
      const stoppedPayload = {
        source: resolvedSource,
        status: 'stopped',
        message: 'Stopped',
        sessionId: currentSessionIds[resolvedSource]
      };
      if (currentAttemptIds[resolvedSource]) {
        stoppedPayload.attemptId = currentAttemptIds[resolvedSource];
      }
      sendToRenderer('vosk-status', stoppedPayload);

      setSourceStreaming(resolvedSource, false);
      sttChunkCounters[resolvedSource] = 0;
      sttDroppedChunkCounters[resolvedSource] = 0;

      emitSttDebug({
        source: resolvedSource,
        event: 'stop-issued',
        message: 'Audio stream ended and Transcribe command aborted'
      });
    };

    if (source === 'all') {
      stopSource('mic');
      stopSource('system');
    } else {
      stopSource(source === 'system' ? 'system' : 'mic');
    }

    return { success: true };
  }

  function dispose() {
    // Quit-time hard cleanup: end both sessions, flush histories.
    for (const src of ['mic', 'system']) {
      const session = getSourceSession(src);
      if (session) {
        endSession(session);
      }
      setSourceStreaming(src, false);
      setSourceSession(src, null);
      sttChunkCounters[src] = 0;
      sttDroppedChunkCounters[src] = 0;
    }
    sttHistoryManager.flushAllSttHistoryBuffers('cleanup');
    sttHistoryManager.dispose();
  }

  function resetSttHistoryBuffers() {
    sttHistoryManager.resetSttHistoryBuffer('mic');
    sttHistoryManager.resetSttHistoryBuffer('system');
  }

  return {
    dispose,
    emitSttDebug,
    flushAllSttHistoryBuffers: sttHistoryManager.flushAllSttHistoryBuffers,
    handleAudioChunk,
    resetSttHistoryBuffers,
    startAssemblyAiStream,
    stopVoiceRecognition
  };
}

module.exports = {
  createAwsTranscribeService
};
