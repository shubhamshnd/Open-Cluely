// ============================================================================
// STT PROVIDER ROUTER
// ============================================================================
// One object with the exact interface the IPC layer expects from the STT
// service; every streaming call is forwarded to the provider selected in
// Settings ('assemblyai' | 'transcribe') at call time.
//
// Notes:
// - getDesktopSources (non-Linux host capture) and transcribeAudio (the
//   AssemblyAI batch API) are AssemblyAI features and always route there.
// - STT history buffers exist per provider; flush/reset hits BOTH so context
//   from a previous provider session can never linger into an AI request.
// - stopVoiceRecognition('all') fans out to both providers (a stop on an
//   idle provider is a no-op that emits nothing); per-source stops go to the
//   active provider, which is where the renderer's attempts always live (the
//   provider select is disabled while transcription runs).
// ============================================================================

const { resolveSttProvider } = require('../../config');

function createSttRouter({ getSttProvider, services } = {}) {
  if (!services?.assemblyai || !services?.transcribe) {
    throw new Error('createSttRouter needs both services.assemblyai and services.transcribe.');
  }

  function activeService() {
    const provider = resolveSttProvider(typeof getSttProvider === 'function' ? getSttProvider() : null);
    return services[provider] || services.assemblyai;
  }

  return {
    emitSttDebug: (payload) => activeService().emitSttDebug(payload),
    handleAudioChunk: (payload) => activeService().handleAudioChunk(payload),
    startAssemblyAiStream: (source, options) => activeService().startAssemblyAiStream(source, options),
    stopVoiceRecognition: (options = {}) => {
      if (options.source === 'all') {
        const first = services.assemblyai.stopVoiceRecognition(options);
        services.transcribe.stopVoiceRecognition(options);
        return first;
      }
      return activeService().stopVoiceRecognition(options);
    },
    getDesktopSources: () => services.assemblyai.getDesktopSources(),
    transcribeAudio: (audio) => services.assemblyai.transcribeAudio(audio),
    flushAllSttHistoryBuffers: (reason) => {
      services.assemblyai.flushAllSttHistoryBuffers(reason);
      services.transcribe.flushAllSttHistoryBuffers(reason);
    },
    resetSttHistoryBuffers: () => {
      services.assemblyai.resetSttHistoryBuffers();
      services.transcribe.resetSttHistoryBuffers();
    },
    dispose: () => {
      services.assemblyai.dispose();
      services.transcribe.dispose();
    }
  };
}

module.exports = {
  createSttRouter
};
