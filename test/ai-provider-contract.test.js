'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PROVIDER_METHODS,
  assertProvider,
  classifyProviderError,
  splitImageParts
} = require('../src/services/ai/provider-contract');
const GeminiService = require('../src/services/ai/gemini-service');
const OllamaService = require('../src/services/ai/ollama-service');

test('GeminiService satisfies the shared provider contract', () => {
  const service = new GeminiService('fake-test-key', { modelName: 'gemini-2.5-flash-lite' });
  assert.equal(assertProvider(service, 'GeminiService'), true);
  assert.equal(service.supportsImages, true);
  assert.equal(service.ready(), true);
});

test('GeminiService is not ready without an API key', () => {
  const service = new GeminiService('', { modelName: 'gemini-2.5-flash-lite' });
  assert.equal(service.ready(), false);
});

test('OllamaService satisfies the shared provider contract', () => {
  const service = new OllamaService({ baseUrl: 'http://localhost:11434', modelName: 'llama3.2' });
  assert.equal(assertProvider(service, 'OllamaService'), true);
  assert.equal(service.supportsImages, false);
  assert.equal(service.ready(), true);
});

test('assertProvider rejects incomplete implementations', () => {
  const broken = {};
  for (const methodName of PROVIDER_METHODS) {
    if (methodName === 'ready') continue;
    broken[methodName] = () => {};
  }
  broken.supportsImages = false;
  // Missing ready() — must throw, naming the missing method.
  assert.throws(() => assertProvider(broken, 'broken'), /missing required method "ready"/);

  const noImagesFlag = {};
  for (const methodName of PROVIDER_METHODS) {
    noImagesFlag[methodName] = () => {};
  }
  assert.throws(() => assertProvider(noImagesFlag, 'noImagesFlag'), /supportsImages/);
});

test('classifyProviderError buckets auth, quota, timeout and connection errors', () => {
  assert.equal(classifyProviderError({ status: 401, message: 'invalid api key' }), 'auth');
  assert.equal(classifyProviderError({ status: 403, message: 'Forbidden' }), 'auth');
  assert.equal(classifyProviderError({ name: 'UnrecognizedClientException', message: 'bad signature' }), 'auth');
  assert.equal(classifyProviderError({ name: 'AccessDeniedException', message: 'access denied' }), 'auth');

  assert.equal(classifyProviderError({ status: 429, message: 'rate limit reached' }), 'quota');
  assert.equal(classifyProviderError({ name: 'ThrottlingException', message: 'slow down' }), 'quota');
  assert.equal(classifyProviderError({ message: 'You exceeded your current quota' }), 'quota');

  assert.equal(classifyProviderError({ code: 'ETIMEDOUT', message: 'connect ETIMEDOUT' }), 'timeout');
  assert.equal(classifyProviderError({ name: 'ModelTimeoutException', message: 'model timed out' }), 'timeout');

  assert.equal(classifyProviderError({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' }), 'connection');
  assert.equal(classifyProviderError({ name: 'APIConnectionError', message: 'connection error' }), 'connection');

  // Ordinary bad answers / validation problems must NOT be fallback-eligible.
  assert.equal(classifyProviderError({ status: 400, message: 'ValidationException: bad prompt' }), null);
  assert.equal(classifyProviderError(new Error('some random failure')), null);
  assert.equal(classifyProviderError(null), null);
});

test('splitImageParts separates text and normalizes inline images', () => {
  const png1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const { texts, images } = splitImageParts([
    { text: 'describe this' },
    { inlineData: { mimeType: 'image/png', data: png1x1 } },
    'plain string part',
    { inlineData: { mimeType: 'image/jpeg', data: 'Zm9v' } }
  ]);

  assert.deepEqual(texts, ['describe this', 'plain string part']);
  assert.equal(images.length, 2);
  assert.equal(images[0].mimeType, 'image/png');
  assert.equal(images[0].data, png1x1);
  assert.ok(Buffer.isBuffer(images[0].bytes));
  assert.equal(images[0].bytes.toString('base64'), png1x1);
  assert.equal(images[1].mimeType, 'image/jpeg');
});
