const { createEventListener } = require('./helpers');

function createEventActions(ipcRenderer) {
  const onScreenshotTakenStealth = createEventListener(ipcRenderer, {
    channel: 'screenshot-taken-stealth',
    label: 'onScreenshotTakenStealth'
  });

  const onAnalysisStart = createEventListener(ipcRenderer, {
    channel: 'analysis-start',
    label: 'onAnalysisStart'
  });

  const onAnalysisResult = createEventListener(ipcRenderer, {
    channel: 'analysis-result',
    label: 'onAnalysisResult'
  });

  const onSetStealthMode = createEventListener(ipcRenderer, {
    channel: 'set-stealth-mode',
    label: 'onSetStealthMode'
  });

  const onEmergencyClear = createEventListener(ipcRenderer, {
    channel: 'emergency-clear',
    label: 'onEmergencyClear'
  });

  const onError = createEventListener(ipcRenderer, {
    channel: 'error',
    label: 'onError'
  });

  const onVoiceTranscript = createEventListener(ipcRenderer, {
    channel: 'voice-transcript',
    label: 'onVoiceTranscript'
  });

  const onVoiceError = createEventListener(ipcRenderer, {
    channel: 'voice-error',
    label: 'onVoiceError'
  });

  const onVoskStatus = createEventListener(ipcRenderer, {
    channel: 'vosk-status',
    label: 'onVoskStatus'
  });

  const onVoskPartial = createEventListener(ipcRenderer, {
    channel: 'vosk-partial',
    label: 'onVoskPartial'
  });

  const onVoskFinal = createEventListener(ipcRenderer, {
    channel: 'vosk-final',
    label: 'onVoskFinal'
  });

  const onVoskError = createEventListener(ipcRenderer, {
    channel: 'vosk-error',
    label: 'onVoskError'
  });

  const onVoskStopped = createEventListener(ipcRenderer, {
    channel: 'vosk-stopped',
    label: 'onVoskStopped'
  });

  const onToggleVoiceRecognition = createEventListener(ipcRenderer, {
    channel: 'toggle-voice-recognition',
    label: 'onToggleVoiceRecognition'
  });

  const onTriggerAskAi = createEventListener(ipcRenderer, {
    channel: 'trigger-ask-ai',
    label: 'onTriggerAskAi'
  });

  const onAiStreamStart = createEventListener(ipcRenderer, {
    channel: 'ai-stream-start',
    label: 'onAiStreamStart'
  });

  const onAiStreamChunk = createEventListener(ipcRenderer, {
    channel: 'ai-stream-chunk',
    label: 'onAiStreamChunk'
  });

  const onAiStreamEnd = createEventListener(ipcRenderer, {
    channel: 'ai-stream-end',
    label: 'onAiStreamEnd'
  });

  const rawOnSttDebug = createEventListener(ipcRenderer, {
    channel: 'stt-debug',
    label: 'onSttDebug'
  });

  return {
    onScreenshotTakenStealth,
    onAnalysisStart,
    onAnalysisResult,
    onSetStealthMode,
    onEmergencyClear,
    onError,
    onVoiceTranscript,
    onVoiceError,
    onVoskStatus,
    onVoskPartial,
    onVoskFinal,
    onVoskError,
    onVoskStopped,
    onAiStreamStart,
    onAiStreamChunk,
    onAiStreamEnd,
    onToggleVoiceRecognition,
    onTriggerAskAi,
    onSttDebug: (callback) => rawOnSttDebug((data) => callback(data || {}))
  };
}

module.exports = {
  createEventActions
};
