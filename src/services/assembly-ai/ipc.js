function registerAssemblyAiIpc({ ipcMain, assemblyAiService, linuxMonitorCapture, sendToRenderer }) {
  // Linux Host audio: pw-record PCM goes straight from the main process into
  // the existing 'system' STT socket (no renderer round trip, no screencast).
  // The child is owned by the capture module; here it is also tied to the
  // requesting window so closing/reloading it can never leave pw-record behind.
  const boundSenders = new WeakSet();

  ipcMain.handle('start-linux-monitor-capture', async (event) => {
    if (!linuxMonitorCapture) {
      return { success: false, error: 'Native monitor capture is not available' };
    }
    const sender = event?.sender;
    if (sender && !boundSenders.has(sender) && typeof sender.once === 'function') {
      boundSenders.add(sender);
      sender.once('destroyed', () => {
        linuxMonitorCapture.stop({});
      });
    }

    return linuxMonitorCapture.start({
      onChunk: (data) => assemblyAiService.handleAudioChunk({ source: 'system', data }),
      onEnded: ({ code }) => {
        if (typeof sendToRenderer === 'function') {
          sendToRenderer('vosk-error', {
            source: 'system',
            error: `Host audio capture stopped unexpectedly (pw-record exit code ${code})`
          });
        }
      }
    });
  });

  ipcMain.handle('stop-linux-monitor-capture', async (_event, { token } = {}) => {
    if (!linuxMonitorCapture) {
      return { stopped: false };
    }
    return linuxMonitorCapture.stop({ token });
  });

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
