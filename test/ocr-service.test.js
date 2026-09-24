'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOcrService } = require('../src/services/ocr/service');
const { buildScreenshotAnalysisPrompt } = require('../src/services/ai/prompts');

test('extracts and labels text from each captured screenshot', async () => {
  const recognizedImages = [];
  const worker = {
    recognize: async (image) => {
      recognizedImages.push(image);
      return { data: { text: image === 'first' ? 'first screen' : 'second screen' } };
    },
    terminate: async () => {}
  };
  const ocr = createOcrService({
    createWorker: async () => worker,
    fsModule: {
      existsSync: () => true,
      readFileSync: (filePath) => filePath === 'one.png' ? 'first' : 'second'
    }
  });

  const text = await ocr.extractTextFromEntries([
    { id: 'ss-1', path: 'one.png' },
    { id: 'ss-2', path: 'two.png' }
  ]);

  assert.equal(text, '[Screenshot ss-1]\nfirst screen\n\n[Screenshot ss-2]\nsecond screen');
  assert.deepEqual(recognizedImages, ['first', 'second']);
  await ocr.dispose();
});

test('reports missing screenshot files', async () => {
  const ocr = createOcrService({
    createWorker: async () => ({
      recognize: async () => ({ data: { text: '' } }),
      terminate: async () => {}
    }),
    fsModule: {
      existsSync: () => false,
      readFileSync: () => ''
    }
  });

  await assert.rejects(
    ocr.extractTextFromEntries([{ id: 'ss-1', path: 'missing.png' }]),
    /Screenshot file not found for OCR/
  );
  await ocr.dispose();
});

test('keeps Gemini screenshot analysis image-first while including OCR as supplemental context', () => {
  const prompt = buildScreenshotAnalysisPrompt({
    additionalContext: '[Screenshot ss-1]\nvisible text',
    screenshotCount: 2
  });

  assert.match(prompt, /You have 2 screenshots/);
  assert.match(prompt, /Extracted screen text \(supplemental\)/);
  assert.match(prompt, /source of truth/);
});
