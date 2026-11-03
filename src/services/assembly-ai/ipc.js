function registerAssemblyAiIpc({ ipcMain, assemblyAiService, linuxMonitorCapture, sendToRenderer }) {
  // Linux Host audio: pw-record PCM goes straight from the main process into
  // the existing 'system' STT socket (no renderer round trip, no screencast).
  //
  // Ownership: the capture belongs to the renderer document that started it and
  // is released when that document goes away — a full main-frame navigation
  // (reload/cross-document), render-process loss, or window destroy — so a
  // reload can never leave pw-record running behind a renderer that lost its
  // handle. Cleanup only runs while the sender still owns the current capture
  // (token-scoped once started, token-less cancel while the start is pending),
  // so an old document's cleanup can never stop a replacement capture.
  const boundSenders = new WeakSet();
  let monitorOwner = null; // { sender, token | null }

  function bindSender(sender) {
    if (!sender || boundSenders.has(sender) || typeof sender.once !== 'function') {
      return;
    }
    boundSenders.add(sender);
    const releaseIfOwner = () => {
      const owner = monitorOwner;
      if (!owner || owner.sender !== sender) {
        return; // this sender was superseded; the replacement is not ours to stop
      }
      monitorOwner = null;
      linuxMonitorCapture.stop(owner.token ? { token: owner.token } : {});
    };
    sender.once('destroyed', releaseIfOwner);
    if (typeof sender.on === 'function') {
      // webContents 'did-start-navigation': (event, url, isInPlace, isMainFrame).
      // In-place (same-document) and subframe navigations keep the document.
      sender.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
        if (isInPlace === true || isMainFrame === false) {
          return;
        }
        releaseIfOwner();
      });
      sender.on('render-process-gone', releaseIfOwner);
    }
  }

  ipcMain.handle('start-linux-monitor-capture', async (event) => {
    if (!linuxMonitorCapture) {
      return { success: false, error: 'Native monitor capture is not available' };
    }
    const sender = event?.sender;
    bindSender(sender);
    const owner = { sender, token: null };
    monitorOwner = owner;

    const result = await linuxMonitorCapture.start({
      onChunk: (data) => assemblyAiService.handleAudioChunk({ source: 'system', data }),
      onEnded: ({ code }) => {
        // Only the owning (current) capture's unexpected end is the live
        // session's error; a superseded capture's end must not tear down the
        // replacement. The captureToken lets the renderer correlate this error
        // to the capture it came from.
        if (monitorOwner !== owner) {
          return;
        }
        monitorOwner = null;
        if (typeof sendToRenderer === 'function') {
          sendToRenderer('vosk-error', {
            source: 'system',
            error: `Host audio capture stopped unexpectedly (pw-record exit code ${code})`,
            captureToken: owner.token
          });
        }
      }
    });
    if (result?.success && monitorOwner === owner) {
      owner.token = result.token;
    }
    return result;
  });

  ipcMain.handle('stop-linux-monitor-capture', async (_event, { token } = {}) => {
    if (!linuxMonitorCapture) {
      return { stopped: false };
    }
    const result = await linuxMonitorCapture.stop({ token });
    if (result?.stopped && monitorOwner && (!token || monitorOwner.token === token)) {
      monitorOwner = null;
    }
    return result;
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
