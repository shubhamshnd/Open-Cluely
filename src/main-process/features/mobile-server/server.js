'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const MOBILE_PORT = 7823;
const MOBILE_HTML_PATH = path.join(__dirname, 'mobile.html');
const WORKLET_PATH = path.join(__dirname, '..', '..', '..', 'windows', 'assistant', 'pcm-capture-worklet.js');

function createMobileServer({ getGeminiRuntime, getScreenshotManager, getAssemblyAiService }) {
  const clients = new Set();

  function broadcast(channel, data) {
    if (clients.size === 0) return;
    const message = JSON.stringify({ channel, data });
    for (const ws of clients) {
      if (ws.readyState === 1 /* WebSocket.OPEN */) {
        try { ws.send(message); } catch (_) { /* ignore dead socket */ }
      }
    }
  }

  function sendTo(ws, channel, data) {
    try {
      if (ws.readyState === 1) ws.send(JSON.stringify({ channel, data }));
    } catch (_) { /* ignore */ }
  }

  // ── HTTP server (serves mobile UI + PCM worklet) ──────────────────────────

  const httpServer = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];

    if (url === '/' || url === '/index.html') {
      try {
        const html = fs.readFileSync(MOBILE_HTML_PATH, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch (err) {
        res.writeHead(500);
        res.end('Mobile UI unavailable');
      }
      return;
    }

    if (url === '/pcm-worklet.js') {
      try {
        const js = fs.readFileSync(WORKLET_PATH, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(js);
      } catch (err) {
        res.writeHead(500);
        res.end('Worklet unavailable');
      }
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  // ── WebSocket server ───────────────────────────────────────────────────────

  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`[MobileServer] Client connected (total: ${clients.size})`);

    // Send initial state
    const screenshotMgr = getScreenshotManager();
    sendTo(ws, 'connected', {
      screenshotsCount: screenshotMgr ? screenshotMgr.getScreenshotsCount() : 0
    });

    ws.on('message', async (rawData, isBinary) => {
      // Binary = PCM audio chunk from mobile microphone
      if (isBinary) {
        const assemblyAiSvc = getAssemblyAiService();
        if (assemblyAiSvc) {
          assemblyAiSvc.handleAudioChunk({ source: 'mic', data: rawData });
        }
        return;
      }

      let msg;
      try {
        msg = JSON.parse(rawData.toString());
      } catch (_) {
        sendTo(ws, 'error', { message: 'Invalid message format' });
        return;
      }

      const geminiRuntime = getGeminiRuntime();
      const screenshotManager = getScreenshotManager();
      const assemblyAiService = getAssemblyAiService();

      switch (msg.type) {

        // ── Screenshot ─────────────────────────────────────────────────────
        case 'take-screenshot': {
          if (!screenshotManager) {
            sendTo(ws, 'error', { message: 'Screenshot manager not ready' });
            break;
          }
          try {
            await screenshotManager.takeStealthScreenshot();
            // screenshot-taken-stealth is emitted via augmented sendToRenderer → broadcast
          } catch (err) {
            sendTo(ws, 'error', { message: `Screenshot failed: ${err.message}` });
          }
          break;
        }

        // ── Ask AI ─────────────────────────────────────────────────────────
        case 'ask-ai': {
          if (!geminiRuntime || !geminiRuntime.hasApiKeys()) {
            sendTo(ws, 'error', { message: 'No API key configured. Add it in the desktop Settings.' });
            break;
          }

          const contextString = typeof msg.contextString === 'string' ? msg.contextString.trim() : '';

          if (!contextString && !screenshotManager?.hasScreenshots()) {
            sendTo(ws, 'error', { message: 'Take a screenshot or type a question first.' });
            break;
          }

          if (assemblyAiService) {
            assemblyAiService.flushAllSttHistoryBuffers('pre-ask-ai-mobile');
          }

          // Fire-and-forget; stream events go back via broadcast
          (async () => {
            try {
              broadcast('ai-stream-start', { actionId: 'askAi' });

              const onChunk = ({ text, index }) => {
                broadcast('ai-stream-chunk', { actionId: 'askAi', text, index });
              };

              let text = '';

              if (screenshotManager && screenshotManager.hasScreenshots()) {
                const { imageParts } = await screenshotManager.buildImagePartsFromScreenshots({ strict: false });
                if (imageParts.length > 0) {
                  text = await geminiRuntime.executeWithKeyFailover((svc) => {
                    if (!svc || !svc.model) throw new Error('AI model not initialized');
                    return svc.askAiWithSessionContextAndScreenshots(imageParts, {
                      contextString,
                      transcriptContext: '',
                      sessionSummary: '',
                      screenshotCount: imageParts.length,
                      onChunk
                    });
                  });
                }
              }

              if (!text) {
                text = await geminiRuntime.executeWithKeyFailover((svc) => {
                  if (!svc || !svc.model) throw new Error('AI model not initialized');
                  return svc.askAiWithSessionContext({
                    contextString,
                    transcriptContext: '',
                    sessionSummary: '',
                    screenshotCount: 0,
                    onChunk
                  });
                });
              }

              broadcast('ai-stream-end', { actionId: 'askAi' });
            } catch (err) {
              console.error('[MobileServer] ask-ai error:', err.message);
              broadcast('ai-stream-end', { actionId: 'askAi' });
              broadcast('error', { message: err.message });
            }
          })();
          break;
        }

        // ── Clear conversation history ──────────────────────────────────────
        case 'clear-conversation': {
          try {
            const geminiService = geminiRuntime?.getService();
            if (geminiService) geminiService.clearHistory();
            if (assemblyAiService) assemblyAiService.resetSttHistoryBuffers();
            broadcast('clear-done', {});
          } catch (err) {
            sendTo(ws, 'error', { message: `Clear failed: ${err.message}` });
          }
          break;
        }

        // ── Microphone control ─────────────────────────────────────────────
        case 'start-mic': {
          if (!assemblyAiService) {
            sendTo(ws, 'error', { message: 'STT service not ready' });
            break;
          }
          assemblyAiService.startAssemblyAiStream('mic');
          break;
        }

        case 'stop-mic': {
          if (assemblyAiService) {
            assemblyAiService.stopVoiceRecognition({ source: 'mic' });
          }
          break;
        }

        default:
          sendTo(ws, 'error', { message: `Unknown command: ${msg.type}` });
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`[MobileServer] Client disconnected (total: ${clients.size})`);
    });

    ws.on('error', (err) => {
      console.error('[MobileServer] WebSocket error:', err.message);
      clients.delete(ws);
    });
  });

  // ── Start listening ────────────────────────────────────────────────────────

  httpServer.listen(MOBILE_PORT, '127.0.0.1', () => {
    console.log(`[MobileServer] Mobile companion available at http://localhost:${MOBILE_PORT}`);
    console.log('[MobileServer] Connect your phone via USB tethering and open that URL in your mobile browser');
  });

  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[MobileServer] Port ${MOBILE_PORT} already in use — mobile companion disabled`);
    } else {
      console.error('[MobileServer] HTTP server error:', err.message);
    }
  });

  return {
    broadcast,
    close() {
      try {
        wss.close();
        httpServer.close();
      } catch (_) { /* ignore */ }
    }
  };
}

module.exports = { createMobileServer };
