'use strict';

const fs = require('fs');
const { createWorker } = require('tesseract.js');

function createOcrService({
  createWorker: createWorkerFactory = createWorker,
  fsModule = fs
} = {}) {
  let workerPromise = null;

  async function getWorker() {
    if (!workerPromise) {
      workerPromise = createWorkerFactory('eng').catch((error) => {
        workerPromise = null;
        throw error;
      });
    }

    return workerPromise;
  }

  async function extractTextFromEntries(entries = []) {
    const usableEntries = Array.isArray(entries)
      ? entries.filter((entry) => entry && typeof entry.path === 'string')
      : [];

    if (usableEntries.length === 0) {
      return '';
    }

    const worker = await getWorker();
    const textParts = [];

    for (const entry of usableEntries) {
      if (!fsModule.existsSync(entry.path)) {
        throw new Error(`Screenshot file not found for OCR: ${entry.path}`);
      }

      const result = await worker.recognize(fsModule.readFileSync(entry.path));
      const text = String(result?.data?.text || '').trim();

      if (text) {
        textParts.push(`[Screenshot ${entry.id || 'unknown'}]\n${text}`);
      }
    }

    return textParts.join('\n\n');
  }

  async function dispose() {
    if (!workerPromise) {
      return;
    }

    const worker = await workerPromise;
    workerPromise = null;
    await worker.terminate();
  }

  return {
    dispose,
    extractTextFromEntries
  };
}

module.exports = {
  createOcrService
};
