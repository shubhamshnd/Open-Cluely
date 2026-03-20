const https = require('https');
const {
  createSttHistoryManager,
  normalizeSttSource
} = require('./stt-history');

const ASSEMBLY_AI_SAMPLE_RATE = 16000;

function createAssemblyAiService({
  WebSocket,
  desktopCapturer,
  getAssemblyApiKey,
  getSpeechModel,
  getGeminiService,
  sendToRenderer
}) {
  let assemblyWsMic = null;
  let assemblyWsSystem = null;
  let isStreamingMic = false;
  let isStreamingSystem = false;

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
    mergeWindowMs: 2400
  });

  function cleanupAssemblyWs(ws) {
    if (!ws) return;
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'Terminate' }));
      }
      ws.terminate();
    } catch (error) {
      console.error('Error cleaning up AssemblyAI WebSocket:', error);
    }
  }

  function resetSourceState(source) {
    const resolvedSource = normalizeSttSource(source);
    sttChunkCounters[resolvedSource] = 0;
    sttDroppedChunkCounters[resolvedSource] = 0;
    sttHistoryManager.resetSttHistoryBuffer(resolvedSource);

    if (resolvedSource === 'mic') {
      isStreamingMic = false;
      assemblyWsMic = null;
    } else {
      isStreamingSystem = false;
      assemblyWsSystem = null;
    }
  }

  function cleanupTransientResources() {
    sttHistoryManager.flushAllSttHistoryBuffers('cleanup');
    cleanupAssemblyWs(assemblyWsMic);
    cleanupAssemblyWs(assemblyWsSystem);

    assemblyWsMic = null;
    assemblyWsSystem = null;
    isStreamingMic = false;
    isStreamingSystem = false;

    sttChunkCounters.mic = 0;
    sttChunkCounters.system = 0;
    sttDroppedChunkCounters.mic = 0;
    sttDroppedChunkCounters.system = 0;

    sttHistoryManager.resetSttHistoryBuffer('mic');
    sttHistoryManager.resetSttHistoryBuffer('system');
  }

  function isSourceStreaming(source) {
    return source === 'system' ? isStreamingSystem : isStreamingMic;
  }

  function getSourceSocket(source) {
    return source === 'system' ? assemblyWsSystem : assemblyWsMic;
  }

  function setSourceSocket(source, socket) {
    if (source === 'system') {
      assemblyWsSystem = socket;
    } else {
      assemblyWsMic = socket;
    }
  }

  function setSourceStreaming(source, active) {
    if (source === 'system') {
      isStreamingSystem = active;
    } else {
      isStreamingMic = active;
    }
  }

  function startAssemblyAiStream(source) {
    const resolvedSource = normalizeSttSource(source);
    const apiKey = getAssemblyApiKey();

    if (!apiKey) {
      console.error('AssemblyAI API key not configured in app settings');
      emitSttDebug({
        source: resolvedSource,
        level: 'error',
        event: 'missing-api-key',
        message: 'AssemblyAI API key not configured in Settings'
      });
      sendToRenderer('vosk-error', {
        source: resolvedSource,
        error: 'AssemblyAI API key not configured. Add it in Settings.'
      });
      return { success: false, error: 'AssemblyAI API key not configured. Add it in Settings.' };
    }

    if (isSourceStreaming(resolvedSource)) {
      emitSttDebug({
        source: resolvedSource,
        event: 'start-skipped',
        message: 'Start requested while source is already streaming'
      });
      return {
        success: true,
        message: resolvedSource === 'system' ? 'System audio already streaming' : 'Mic already streaming'
      };
    }

    try {
      const queryParams = new URLSearchParams({
        sample_rate: String(ASSEMBLY_AI_SAMPLE_RATE),
        format_turns: 'true',
        speech_model: getSpeechModel()
      });

      const wsUrl = `wss://streaming.assemblyai.com/v3/ws?${queryParams.toString()}`;

      console.log(`Connecting to AssemblyAI for source: ${resolvedSource}`);
      emitSttDebug({
        source: resolvedSource,
        event: 'start-request',
        message: 'Opening AssemblyAI WebSocket',
        meta: { speechModel: getSpeechModel() }
      });

      sttChunkCounters[resolvedSource] = 0;
      sttDroppedChunkCounters[resolvedSource] = 0;
      sttHistoryManager.resetSttHistoryBuffer(resolvedSource);

      sendToRenderer('vosk-status', {
        source: resolvedSource,
        status: 'loading',
        message: `Connecting (${resolvedSource})...`
      });

      const ws = new WebSocket(wsUrl, {
        headers: { Authorization: apiKey }
      });

      setSourceSocket(resolvedSource, ws);

      ws.on('open', () => {
        console.log(`AssemblyAI WebSocket connected [${resolvedSource}]`);
        setSourceStreaming(resolvedSource, true);
        emitSttDebug({
          source: resolvedSource,
          event: 'ws-open',
          message: 'AssemblyAI WebSocket connected'
        });
      });

      ws.on('message', (rawMessage) => {
        try {
          const msg = JSON.parse(rawMessage.toString());

          switch (msg.type) {
            case 'Begin':
              console.log(`AssemblyAI session started [${resolvedSource}]:`, msg.id);
              emitSttDebug({
                source: resolvedSource,
                event: 'session-begin',
                message: 'AssemblyAI session started',
                meta: { id: msg.id }
              });
              sendToRenderer('vosk-status', {
                source: resolvedSource,
                status: 'listening',
                message: `Listening (${resolvedSource === 'system' ? 'Host' : 'You'})...`
              });
              break;

            case 'Turn':
              if (msg.transcript) {
                if (msg.end_of_turn) {
                  console.log(`AssemblyAI final [${resolvedSource}]:`, msg.transcript);
                  emitSttDebug({
                    source: resolvedSource,
                    event: 'turn-final',
                    message: 'Final transcript received',
                    meta: { chars: msg.transcript.length }
                  });
                  sendToRenderer('vosk-final', {
                    source: resolvedSource,
                    text: msg.transcript
                  });
                  sttHistoryManager.queueSttHistorySegment(resolvedSource, msg.transcript);
                } else {
                  sendToRenderer('vosk-partial', {
                    source: resolvedSource,
                    text: msg.transcript
                  });
                }
              }
              break;

            case 'Termination':
              console.log(
                `AssemblyAI terminated [${resolvedSource}]. Duration:`,
                msg.audio_duration_seconds,
                's'
              );
              emitSttDebug({
                source: resolvedSource,
                event: 'termination',
                message: 'AssemblyAI stream terminated',
                meta: { durationSeconds: msg.audio_duration_seconds }
              });
              sttHistoryManager.flushSttHistoryBuffer(resolvedSource, 'termination');
              resetSourceState(resolvedSource);
              sendToRenderer('vosk-stopped', { source: resolvedSource });
              break;

            default:
              console.log(`AssemblyAI message [${resolvedSource}]:`, msg.type);
          }
        } catch (parseError) {
          console.error(`Failed to parse AssemblyAI message [${resolvedSource}]:`, parseError);
          emitSttDebug({
            source: resolvedSource,
            level: 'error',
            event: 'parse-error',
            message: parseError.message
          });
        }
      });

      ws.on('error', (error) => {
        console.error(`AssemblyAI WebSocket error [${resolvedSource}]:`, error.message);
        emitSttDebug({
          source: resolvedSource,
          level: 'error',
          event: 'ws-error',
          message: error.message
        });
        sttHistoryManager.flushSttHistoryBuffer(resolvedSource, 'ws-error');
        sendToRenderer('vosk-error', {
          source: resolvedSource,
          error: `Connection error (${resolvedSource}): ${error.message}`
        });
        resetSourceState(resolvedSource);
      });

      ws.on('close', (code, reason) => {
        console.log(`AssemblyAI WebSocket closed [${resolvedSource}]:`, code, reason?.toString());
        emitSttDebug({
          source: resolvedSource,
          event: 'ws-close',
          message: 'AssemblyAI WebSocket closed',
          meta: { code, reason: reason?.toString() || '' }
        });

        if (isSourceStreaming(resolvedSource)) {
          sttHistoryManager.flushSttHistoryBuffer(resolvedSource, 'ws-close');
          resetSourceState(resolvedSource);
          sendToRenderer('vosk-stopped', { source: resolvedSource });
        }
      });

      return { success: true };
    } catch (error) {
      console.error(`Error starting AssemblyAI stream [${resolvedSource}]:`, error.message);
      emitSttDebug({
        source: resolvedSource,
        level: 'error',
        event: 'start-failed',
        message: error.message
      });
      setSourceStreaming(resolvedSource, false);
      return { success: false, error: error.message };
    }
  }

  function handleAudioChunk({ source, data }) {
    const resolvedSource = normalizeSttSource(source);
    const ws = getSourceSocket(resolvedSource);

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(Buffer.from(data));
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
        message: 'Audio chunk dropped because WebSocket is not open',
        meta: {
          dropped: sttDroppedChunkCounters[resolvedSource],
          readyState: ws ? ws.readyState : 'no-ws'
        }
      });
    }
  }

  function stopVoiceRecognition({ source } = {}) {
    emitSttDebug({
      source: source === 'system' || source === 'mic' ? source : null,
      event: 'ipc-stop',
      message: `Stop requested for ${source || 'default'}`
    });

    const stopSource = (src) => {
      const resolvedSource = normalizeSttSource(src);
      const ws = getSourceSocket(resolvedSource);

      if (!ws) {
        sttHistoryManager.flushSttHistoryBuffer(resolvedSource, 'stop-noop');
        emitSttDebug({
          source: resolvedSource,
          event: 'stop-noop',
          message: 'Stop requested but no active socket found'
        });
        sttChunkCounters[resolvedSource] = 0;
        sttDroppedChunkCounters[resolvedSource] = 0;
        return;
      }

      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'Terminate' }));
        }
      } catch (error) {
        console.error(`Error stopping [${resolvedSource}]:`, error.message);
        emitSttDebug({
          source: resolvedSource,
          level: 'error',
          event: 'stop-error',
          message: error.message
        });
      }

      sttHistoryManager.flushSttHistoryBuffer(resolvedSource, 'stop-request');
      sendToRenderer('vosk-status', {
        source: resolvedSource,
        status: 'stopped',
        message: 'Stopped'
      });

      setSourceStreaming(resolvedSource, false);
      sttChunkCounters[resolvedSource] = 0;
      sttDroppedChunkCounters[resolvedSource] = 0;

      emitSttDebug({
        source: resolvedSource,
        event: 'stop-issued',
        message: 'Terminate frame sent to AssemblyAI'
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

  async function getDesktopSources() {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      return sources.map((source) => ({ id: source.id, name: source.name }));
    } catch (error) {
      console.error('Error getting desktop sources:', error.message);
      return [];
    }
  }

  async function transcribeAudio(base64Audio) {
    const apiKey = getAssemblyApiKey();

    if (!apiKey) {
      return { success: false, error: 'AssemblyAI API key not configured. Add it in Settings.' };
    }

    try {
      const audioBuffer = Buffer.from(base64Audio, 'base64');

      const uploadUrl = await new Promise((resolve, reject) => {
        const request = https.request({
          hostname: 'api.assemblyai.com',
          path: '/v2/upload',
          method: 'POST',
          headers: {
            Authorization: apiKey,
            'Content-Type': 'application/octet-stream',
            'Content-Length': audioBuffer.length
          }
        }, (response) => {
          let data = '';
          response.on('data', (chunk) => {
            data += chunk;
          });
          response.on('end', () => {
            try {
              const result = JSON.parse(data);
              if (result.upload_url) {
                resolve(result.upload_url);
              } else {
                reject(new Error(result.error || 'Upload failed'));
              }
            } catch (_error) {
              reject(new Error('Failed to parse upload response'));
            }
          });
        });

        request.on('error', reject);
        request.write(audioBuffer);
        request.end();
      });

      const transcriptId = await new Promise((resolve, reject) => {
        const body = JSON.stringify({ audio_url: uploadUrl, language_code: 'en' });

        const request = https.request({
          hostname: 'api.assemblyai.com',
          path: '/v2/transcript',
          method: 'POST',
          headers: {
            Authorization: apiKey,
            'Content-Type': 'application/json'
          }
        }, (response) => {
          let data = '';
          response.on('data', (chunk) => {
            data += chunk;
          });
          response.on('end', () => {
            try {
              const result = JSON.parse(data);
              if (result.id) {
                resolve(result.id);
              } else {
                reject(new Error(result.error || 'Transcript creation failed'));
              }
            } catch (_error) {
              reject(new Error('Failed to parse transcript response'));
            }
          });
        });

        request.on('error', reject);
        request.write(body);
        request.end();
      });

      const pollTranscript = () => new Promise((resolve, reject) => {
        const request = https.request({
          hostname: 'api.assemblyai.com',
          path: `/v2/transcript/${transcriptId}`,
          method: 'GET',
          headers: { Authorization: apiKey }
        }, (response) => {
          let data = '';
          response.on('data', (chunk) => {
            data += chunk;
          });
          response.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (_error) {
              reject(new Error('Failed to parse poll response'));
            }
          });
        });

        request.on('error', reject);
        request.end();
      });

      let transcript;
      while (true) {
        transcript = await pollTranscript();
        if (transcript.status === 'completed') break;
        if (transcript.status === 'error') {
          throw new Error(transcript.error || 'Transcription failed');
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      const geminiService = getGeminiService();
      if (transcript.text && geminiService) {
        geminiService.addToHistory('user', transcript.text.trim());
      }

      return { success: true, transcript: transcript.text || '' };
    } catch (error) {
      console.error('Error in transcribe-audio:', error.message);
      return { success: false, error: error.message };
    }
  }

  function dispose() {
    cleanupTransientResources();
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
    getDesktopSources,
    handleAudioChunk,
    resetSttHistoryBuffers,
    startAssemblyAiStream,
    stopVoiceRecognition,
    transcribeAudio
  };
}

module.exports = {
  createAssemblyAiService
};
