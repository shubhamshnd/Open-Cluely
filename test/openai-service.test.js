'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const OpenAIService = require('../src/services/ai/openai-service');
const { assertProvider } = require('../src/services/ai/provider-contract');

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function createStubClient({ createImpl } = {}) {
  const calls = [];
  return {
    calls,
    client: {
      chat: {
        completions: {
          create: async (params) => {
            calls.push(params);
            if (createImpl) {
              return createImpl(params);
            }
            if (params.stream) {
              return (async function* () {
                yield { choices: [{ delta: { content: 'Hello ' } }] };
                yield { choices: [{ delta: { content: 'world' } }] };
                yield { choices: [{ delta: {} }] };
              })();
            }
            return { choices: [{ message: { content: 'stubbed answer' } }] };
          }
        }
      }
    }
  };
}

function createService(overrides = {}) {
  const stub = createStubClient(overrides);
  const service = new OpenAIService(overrides.apiKey ?? 'sk-test', {
    modelName: overrides.modelName ?? 'gpt-4.1-mini',
    minRequestInterval: 0,
    client: stub.client
  });
  return { service, stub };
}

test('OpenAIService satisfies the shared provider contract', () => {
  const { service } = createService();
  assert.equal(assertProvider(service, 'OpenAIService'), true);
  assert.equal(service.ready(), true);
  assert.equal(service.supportsImages, true);
});

test('OpenAIService is not ready without an API key', () => {
  const { service } = createService({ apiKey: '' });
  assert.equal(service.ready(), false);
});

test('maps a text request to system + user chat messages', async () => {
  const { service, stub } = createService();
  const result = await service.answerQuestion('What is a closure?');

  assert.equal(result, 'stubbed answer');
  assert.equal(stub.calls.length, 1);
  const params = stub.calls[0];
  assert.equal(params.model, 'gpt-4.1-mini');
  assert.equal(params.stream, undefined);
  assert.equal(params.messages[0].role, 'system');
  assert.equal(typeof params.messages[0].content, 'string');
  assert.equal(params.messages[1].role, 'user');
  assert.equal(typeof params.messages[1].content, 'string');
  // The user message must carry the shared prompt builder output, voice included.
  assert.match(params.messages[1].content, /=== VOICE ===/);
  assert.match(params.messages[1].content, /What is a closure\?/);
});

test('streams chunks through onChunk with running index', async () => {
  const { service } = createService();
  const chunks = [];
  const result = await service.answerQuestion('hi', { onChunk: (chunk) => chunks.push(chunk) });

  assert.equal(result, 'Hello world');
  assert.deepEqual(chunks, [
    { text: 'Hello ', index: 1 },
    { text: 'world', index: 2 }
  ]);
});

test('maps screenshots to image_url content blocks for vision models', async () => {
  const { service, stub } = createService();
  await service.analyzeScreenshots(
    [{ inlineData: { mimeType: 'image/png', data: PNG_1X1 } }],
    'extra context'
  );

  assert.equal(stub.calls.length, 1);
  const userContent = stub.calls[0].messages[1].content;
  assert.ok(Array.isArray(userContent));
  assert.equal(userContent[0].type, 'text');
  assert.match(userContent[0].text, /=== VOICE ===/);
  assert.deepEqual(userContent[1], {
    type: 'image_url',
    image_url: { url: `data:image/png;base64,${PNG_1X1}` }
  });
});

test('text-only models receive a text prompt instead of image blocks', async () => {
  const { service, stub } = createService({ modelName: 'some-text-only-model' });
  assert.equal(service.supportsImages, false);

  await service.analyzeScreenshots(
    [{ inlineData: { mimeType: 'image/png', data: PNG_1X1 } }],
    'ocr text here'
  );

  const userContent = stub.calls[0].messages[1].content;
  assert.equal(typeof userContent, 'string');
  assert.match(userContent, /cannot see images/);
  assert.match(userContent, /ocr text here/);
});

test('classifies auth, quota and connection errors for fallback decisions', () => {
  const { service } = createService();
  assert.equal(service.isAuthenticationError({ status: 401, message: 'Incorrect API key' }), true);
  assert.equal(service.isAuthenticationError({ status: 429, message: 'rate limit' }), false);
  assert.equal(service.isQuotaExhaustedError({ status: 429, message: 'rate limit' }), true);
  assert.equal(service.isRetryableError({ name: 'APIConnectionError', message: 'connection error' }), true);
  assert.equal(service.isRetryableError({ status: 400, message: 'bad request' }), false);
});

test('retries a retryable failure before succeeding', async () => {
  let attempts = 0;
  const { service, stub } = createService({
    createImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error('connect ECONNREFUSED');
        error.code = 'ECONNREFUSED';
        throw error;
      }
      return { choices: [{ message: { content: 'recovered' } }] };
    }
  });

  const result = await service.answerQuestion('hi');
  assert.equal(result, 'recovered');
  assert.equal(stub.calls.length, 2);
});

test('does not retry quota errors', async () => {
  let attempts = 0;
  const { service } = createService({
    createImpl: async () => {
      attempts += 1;
      const error = new Error('rate limit reached');
      error.status = 429;
      throw error;
    }
  });

  await assert.rejects(service.answerQuestion('hi'), /rate limit/);
  assert.equal(attempts, 1);
});
