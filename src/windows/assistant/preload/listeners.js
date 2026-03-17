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
    onToggleVoiceRecognition,
    onTriggerAskAi,
    onSttDebug: (callback) => rawOnSttDebug((data) => callback(data || {}))
  };
}

module.exports = {
  createEventActions
};
