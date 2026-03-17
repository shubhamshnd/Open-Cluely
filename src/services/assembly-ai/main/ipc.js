function registerAssemblyAiIpc({ ipcMain, assemblyAiService }) {
  ipcMain.handle('start-voice-recognition', (_event, { source } = {}) => {
    const resolvedSource = source === 'system' ? 'system' : 'mic';
    console.log(`IPC: start-voice-recognition [${resolvedSource}]`);
    assemblyAiService.emitSttDebug({
      source: resolvedSource,
      event: 'ipc-start',
      message: 'Renderer requested source start'
    });

    return assemblyAiService.startAssemblyAiStream(resolvedSource);
  });

  ipcMain.on('audio-chunk', (_event, payload = {}) => {
    assemblyAiService.handleAudioChunk(payload);
  });

  ipcMain.handle('stop-voice-recognition', (_event, { source } = {}) => {
    console.log(`IPC: stop-voice-recognition [${source}]`);
    return assemblyAiService.stopVoiceRecognition({ source });
  });

  ipcMain.handle('get-desktop-sources', async () => {
    return assemblyAiService.getDesktopSources();
  });

  ipcMain.handle('transcribe-audio', async (_event, base64Audio) => {
    console.log('IPC: transcribe-audio called, size:', base64Audio?.length || 0);
    return assemblyAiService.transcribeAudio(base64Audio);
  });
}

module.exports = {
  registerAssemblyAiIpc
};
