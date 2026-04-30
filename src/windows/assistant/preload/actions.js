const { invokeWithFallback } = require('./helpers');

function createInvokeActions(ipcRenderer) {
  return {
    toggleStealth: invokeWithFallback(ipcRenderer, {
      channel: 'toggle-stealth',
      label: 'toggleStealth',
      fallback: (error) => ({ error: error.message })
    }),

    emergencyHide: invokeWithFallback(ipcRenderer, {
      channel: 'emergency-hide',
      label: 'emergencyHide',
      fallback: (error) => ({ error: error.message })
    }),

    takeStealthScreenshot: invokeWithFallback(ipcRenderer, {
      channel: 'take-stealth-screenshot',
      label: 'takeStealthScreenshot',
      fallback: (error) => ({ error: error.message })
    }),

    analyzeStealth: invokeWithFallback(ipcRenderer, {
      channel: 'analyze-stealth',
      label: 'analyzeStealth',
      fallback: (error) => ({ error: error.message })
    }),

    analyzeStealthWithContext: invokeWithFallback(ipcRenderer, {
      channel: 'analyze-stealth-with-context',
      label: 'analyzeStealthWithContext',
      fallback: (error) => ({ error: error.message })
    }),

    askAiWithSessionContext: invokeWithFallback(ipcRenderer, {
      channel: 'ask-ai-with-session-context',
      label: 'askAiWithSessionContext',
      fallback: (error) => ({ success: false, error: error.message })
    }),

    clearStealth: invokeWithFallback(ipcRenderer, {
      channel: 'clear-stealth',
      label: 'clearStealth',
      fallback: (error) => ({ error: error.message })
    }),

    getScreenshotsCount: invokeWithFallback(ipcRenderer, {
      channel: 'get-screenshots-count',
      label: 'getScreenshotsCount',
      fallback: () => 0
    }),

    getWindowBounds: invokeWithFallback(ipcRenderer, {
      channel: 'get-window-bounds',
      label: 'getWindowBounds',
      fallback: (error) => ({ error: error.message })
    }),

    setWindowBounds: invokeWithFallback(ipcRenderer, {
      channel: 'set-window-bounds',
      label: 'setWindowBounds',
      fallback: (error) => ({ error: error.message })
    }),

    setWindowSizePreset: invokeWithFallback(ipcRenderer, {
      channel: 'set-window-size-preset',
      label: 'setWindowSizePreset',
      transformArgs: (args) => [{ preset: args[0] }],
      fallback: (error) => ({ error: error.message })
    }),

    startVoiceRecognition: invokeWithFallback(ipcRenderer, {
      channel: 'start-voice-recognition',
      label: 'startVoiceRecognition',
      transformArgs: (args) => [{ source: args[0] }],
      fallback: (error) => ({ error: error.message })
    }),

    stopVoiceRecognition: invokeWithFallback(ipcRenderer, {
      channel: 'stop-voice-recognition',
      label: 'stopVoiceRecognition',
      transformArgs: (args) => [{ source: args[0] }],
      fallback: (error) => ({ error: error.message })
    }),

    sendAudioChunk: (source, audioData) => {
      ipcRenderer.send('audio-chunk', { source, data: audioData });
    },

    getDesktopSources: invokeWithFallback(ipcRenderer, {
      channel: 'get-desktop-sources',
      label: 'getDesktopSources',
      fallback: () => []
    }),

    transcribeAudio: invokeWithFallback(ipcRenderer, {
      channel: 'transcribe-audio',
      label: 'transcribeAudio',
      fallback: (error) => ({ success: false, error: error.message })
    }),

    addVoiceTranscript: invokeWithFallback(ipcRenderer, {
      channel: 'add-voice-transcript',
      label: 'addVoiceTranscript',
      fallback: (error) => ({ error: error.message })
    }),

    suggestResponse: invokeWithFallback(ipcRenderer, {
      channel: 'suggest-response',
      label: 'suggestResponse',
      fallback: (error) => ({ error: error.message })
    }),

    generateMeetingNotes: invokeWithFallback(ipcRenderer, {
      channel: 'generate-meeting-notes',
      label: 'generateMeetingNotes',
      fallback: (error) => ({ error: error.message })
    }),

    generateFollowUpEmail: invokeWithFallback(ipcRenderer, {
      channel: 'generate-follow-up-email',
      label: 'generateFollowUpEmail',
      fallback: (error) => ({ error: error.message })
    }),

    answerQuestion: invokeWithFallback(ipcRenderer, {
      channel: 'answer-question',
      label: 'answerQuestion',
      fallback: (error) => ({ error: error.message })
    }),

    getConversationInsights: invokeWithFallback(ipcRenderer, {
      channel: 'get-conversation-insights',
      label: 'getConversationInsights',
      fallback: (error) => ({ error: error.message })
    }),

    clearConversationHistory: invokeWithFallback(ipcRenderer, {
      channel: 'clear-conversation-history',
      label: 'clearConversationHistory',
      fallback: (error) => ({ error: error.message })
    }),

    getConversationHistory: invokeWithFallback(ipcRenderer, {
      channel: 'get-conversation-history',
      label: 'getConversationHistory',
      fallback: (error) => ({ error: error.message })
    }),

    getSettings: invokeWithFallback(ipcRenderer, {
      channel: 'get-settings',
      label: 'getSettings',
      fallback: (error) => ({ error: error.message })
    }),

    saveSettings: invokeWithFallback(ipcRenderer, {
      channel: 'save-settings',
      label: 'saveSettings',
      fallback: (error) => ({ success: false, error: error.message })
    }),

    setThemePreference: invokeWithFallback(ipcRenderer, {
      channel: 'set-theme-preference',
      label: 'setThemePreference',
      transformArgs: (args) => [{ theme: args[0] }],
      fallback: (error) => ({ success: false, error: error.message })
    }),

    closeApp: invokeWithFallback(ipcRenderer, {
      channel: 'close-app',
      label: 'closeApp',
      fallback: (error) => ({ error: error.message })
    }),

    getMobileServerStatus: invokeWithFallback(ipcRenderer, {
      channel: 'mobile-server-get-status',
      label: 'getMobileServerStatus',
      fallback: () => ({ listening: false, port: 7823, urls: [], clientCount: 0, error: null })
    })
  };
}

module.exports = {
  createInvokeActions
};
