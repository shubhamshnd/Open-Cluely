'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const registerAssistantIpc = (() => {
  // ipc.js uses `function registerAssistantIpc` + module.exports at the end.
  const mod = require('../src/main-process/features/assistant/ipc');
  return mod.registerAssistantIpc || mod;
})();

function setup({ supportsImages, ocrText }) {
  const handlers = new Map();
  const sent = [];
  const calls = { analyze: [], askShots: [], ask: [], ocr: 0 };

  const service = {
    ready: () => true,
    supportsImages,
    analyzeScreenshots: async (images, ocr, options) => {
      calls.analyze.push({ images, ocr });
      options.onChunk?.({ text: 'answer', index: 1 });
      return 'answer';
    },
    askAiWithSessionContextAndScreenshots: async (images, options) => {
      calls.askShots.push({ images, options });
      return 'shot answer';
    },
    askAiWithSessionContext: async (options) => {
      calls.ask.push(options);
      return 'text answer';
    }
  };

  const geminiRuntime = {
    isReady: () => true,
    getApiKeys: () => [],
    getService: () => service,
    getActiveProgrammingLanguage: () => 'python',
    getActiveAiProvider: () => 'bedrock',
    activeSupportsImages: () => supportsImages,
    executeWithKeyFailover: async (op) => op(service, {})
  };

  registerAssistantIpc({
    ipcMain: { handle: (name, fn) => handlers.set(name, fn), on: () => {} },
    screenshotManager: {
      hasScreenshots: () => true,
      getScreenshotsCount: () => 1,
      buildImagePartsFromScreenshots: async () => ({
        imageParts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }],
        entries: [{ id: 'one' }]
      })
    },
    ocrService: {
      extractTextFromEntries: async () => {
        calls.ocr += 1;
        return ocrText;
      }
    },
    windowController: {},
    geminiRuntime,
    assemblyAiService: { flushAllSttHistoryBuffers: () => {} },
    sendToRenderer: (channel, payload) => sent.push({ channel, payload }),
    quitApplication: () => {}
  });

  return { handlers, sent, calls };
}

test('text-only model gets OCR text and the chat says so', async () => {
  const { handlers, sent, calls } = setup({ supportsImages: false, ocrText: 'def foo(): pass' });
  await handlers.get('analyze-stealth-with-context')({}, { contextString: '' });

  assert.equal(calls.ocr, 1);
  assert.equal(calls.analyze[0].ocr, 'def foo(): pass');
  const result = sent.find((entry) => entry.channel === 'analysis-result').payload;
  assert.match(result.text, /cannot see images/);
  assert.match(result.text, /answer$/);
  const chunks = sent.filter((entry) => entry.channel === 'ai-stream-chunk');
  assert.match(chunks[0].payload.text, /cannot see images/);
});

test('text-only model with empty OCR errors instead of sending a blind prompt', async () => {
  const { handlers, sent, calls } = setup({ supportsImages: false, ocrText: '   ' });
  await handlers.get('analyze-stealth-with-context')({}, { contextString: '' });

  assert.equal(calls.analyze.length, 0);
  const result = sent.find((entry) => entry.channel === 'analysis-result').payload;
  assert.match(result.error, /no text could be extracted/);
});

test('vision model sends the image and skips the text-only notice and OCR', async () => {
  const { handlers, sent, calls } = setup({ supportsImages: true, ocrText: 'ignored' });
  await handlers.get('analyze-stealth-with-context')({}, { contextString: '' });

  assert.equal(calls.ocr, 0);
  assert.equal(calls.analyze[0].images.length, 1);
  const result = sent.find((entry) => entry.channel === 'analysis-result').payload;
  assert.equal(result.text, 'answer');
});

test('Ask AI on a text-only model with empty OCR falls back to transcript-only', async () => {
  const { handlers, calls } = setup({ supportsImages: false, ocrText: '' });
  const result = await handlers.get('ask-ai-with-session-context')({}, { transcriptContext: 'they asked about closures' });

  assert.equal(calls.askShots.length, 0);
  assert.equal(calls.ask.length, 1);
  assert.equal(result.success, true);
  assert.equal(result.usedScreenshots, false);
  assert.match(result.text, /no text could be extracted/);
  assert.match(result.text, /text answer$/);
});

test('Ask AI on a text-only model passes OCR text as transcript context', async () => {
  const { handlers, calls } = setup({ supportsImages: false, ocrText: 'screen words' });
  const result = await handlers.get('ask-ai-with-session-context')({}, { transcriptContext: 'hello' });

  assert.equal(calls.askShots.length, 1);
  assert.match(calls.askShots[0].options.transcriptContext, /hello\n\nscreen words/);
  assert.match(result.text, /cannot see images/);
});
