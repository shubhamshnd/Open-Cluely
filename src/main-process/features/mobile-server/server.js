'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { WebSocketServer } = require('ws');

// Names that almost always belong to virtual adapters (Docker, WSL, VPN,
// hypervisors). Phones cannot route to these IPs, so we want the real
// Wi-Fi/Ethernet adapter to appear first in the URL list.
const VIRTUAL_ADAPTER_PATTERNS = [
  /vethernet/i,
  /wsl/i,
  /vmware/i,
  /virtualbox/i,
  /hyper-?v/i,
  /docker/i,
  /tailscale/i,
  /zerotier/i,
  /\btap\b/i,
  /\btun\b/i,
  /loopback/i,
  /^ppp/i,
  /openvpn/i,
  /utun/i
];

function isVirtualAdapter(name = '') {
  return VIRTUAL_ADAPTER_PATTERNS.some((re) => re.test(name));
}

function getLanAddresses() {
  const real = [];
  const virtual = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const entry = { name, address: iface.address, virtual: isVirtualAdapter(name) };
        if (entry.virtual) virtual.push(entry); else real.push(entry);
      }
    }
  }
  return [...real, ...virtual];
}

const MOBILE_PORT = 7823;
const MOBILE_HTML_PATH = path.join(__dirname, 'mobile.html');

function createMobileServer({ getGeminiRuntime, getScreenshotManager, notifyDesktop }) {
  const clients = new Set();
  const status = {
    listening: false,
    port: MOBILE_PORT,
    urls: [],
    clientCount: 0,
    error: null
  };

  function emitStatus() {
    if (typeof notifyDesktop === 'function') {
      try { notifyDesktop('mobile-server-status', { ...status }); } catch (_) { /* ignore */ }
    }
  }

  function refreshUrls() {
    status.urls = getLanAddresses().map(({ name, address, virtual }) => ({
      name,
      address,
      virtual: !!virtual,
      url: `http://${address}:${MOBILE_PORT}`
    }));
  }

  function setClientCount(n) {
    status.clientCount = n;
    emitStatus();
  }

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

  // ── HTTP server (serves mobile UI) ────────────────────────────────────────

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

    res.writeHead(404);
    res.end('Not found');
  });

  // ── WebSocket server ───────────────────────────────────────────────────────

  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws) => {
    clients.add(ws);
    setClientCount(clients.size);
    console.log(`[MobileServer] Client connected (total: ${clients.size})`);

    // Send initial state
    const screenshotMgr = getScreenshotManager();
    sendTo(ws, 'connected', {
      screenshotsCount: screenshotMgr ? screenshotMgr.getScreenshotsCount() : 0
    });

    ws.on('message', async (rawData, _isBinary) => {
      let msg;
      try {
        msg = JSON.parse(rawData.toString());
      } catch (_) {
        sendTo(ws, 'error', { message: 'Invalid message format' });
        return;
      }

      const geminiRuntime = getGeminiRuntime();
      const screenshotManager = getScreenshotManager();

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
            broadcast('clear-done', {});
          } catch (err) {
            sendTo(ws, 'error', { message: `Clear failed: ${err.message}` });
          }
          break;
        }

        default:
          sendTo(ws, 'error', { message: `Unknown command: ${msg.type}` });
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      setClientCount(clients.size);
      console.log(`[MobileServer] Client disconnected (total: ${clients.size})`);
    });

    ws.on('error', (err) => {
      console.error('[MobileServer] WebSocket error:', err.message);
      clients.delete(ws);
      setClientCount(clients.size);
    });
  });

  // ── Start listening ────────────────────────────────────────────────────────

  httpServer.listen(MOBILE_PORT, '0.0.0.0', () => {
    refreshUrls();
    status.listening = true;
    status.error = null;
    emitStatus();
    console.log(`[MobileServer] Listening on 0.0.0.0:${MOBILE_PORT}`);
    console.log(`[MobileServer] Local:   http://localhost:${MOBILE_PORT}`);
    for (const { name, url, virtual } of status.urls) {
      const tag = virtual ? '  [virtual — phone probably cannot reach]' : '';
      console.log(`[MobileServer] Network: ${url}  (${name})${tag}`);
    }
    console.log('[MobileServer] On the phone, open one of the Network URLs.');
    console.log('[MobileServer] If the phone cannot reach the PC, allow inbound TCP 7823 in Windows Firewall.');
  });

  httpServer.on('error', (err) => {
    status.listening = false;
    status.error = err.message;
    emitStatus();
    if (err.code === 'EADDRINUSE') {
      console.error(`[MobileServer] Port ${MOBILE_PORT} already in use — mobile companion disabled`);
    } else {
      console.error('[MobileServer] HTTP server error:', err.message);
    }
  });

  return {
    broadcast,
    getStatus: () => ({ ...status }),
    emitStatus,
    close() {
      try {
        wss.close();
        httpServer.close();
        status.listening = false;
        status.clientCount = 0;
        emitStatus();
      } catch (_) { /* ignore */ }
    }
  };
}

module.exports = { createMobileServer };
