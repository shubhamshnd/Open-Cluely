'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const AnthropicService = require('../src/services/ai/anthropic-service');
const { assertProvider } = require('../src/services/ai/provider-contract');

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function createStubClient({ createImpl } = {}) {
  const calls = [];
  return {
    calls,
    client: {
      messages: {
        create: async (params) => {
          calls.push(params);
          if (createImpl) {
            return createImpl(params);
          }
          if (params.stream) {
            return (async function* () {
              yield { type: 'message_start' };
              yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } };
              yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } };
              yield { type: 'content_block_delta', delta: { type: 'signature_delta', signature: 'sig' } };
              yield { type: 'message_stop' };
            })();
          }
          return {
            content: [
              { type: 'text', text: 'stubbed ' },
              { type: 'text', text: 'answer' }
            ]
          };
        }
      }
    }
  };
}

function createService(overrides = {}) {
  const stub = createStubClient(overrides);
  const service = new AnthropicService(overrides.apiKey ?? 'sk-ant-test', {
    modelName: overrides.modelName ?? 'claude-sonnet-4-5',
    minRequestInterval: 0,
    client: stub.client
  });
  return { service, stub };
}

test('AnthropicService satisfies the shared provider contract', () => {
  const { service } = createService();
  assert.equal(assertProvider(service, 'AnthropicService'), true);
  assert.equal(service.ready(), true);
  assert.equal(service.supportsImages, true);
});

test('AnthropicService is not ready without an API key', () => {
  const { service } = createService({ apiKey: '' });
  assert.equal(service.ready(), false);
});

test('puts the system prompt in the system field, not a message', async () => {
  const { service, stub } = createService();
  const result = await service.answerQuestion('What is a closure?');

  assert.equal(result, 'stubbed answer');
  assert.equal(stub.calls.length, 1);
  const params = stub.calls[0];
  assert.equal(params.model, 'claude-sonnet-4-5');
  assert.equal(typeof params.system, 'string');
  assert.ok(params.max_tokens > 0);
  assert.equal(params.stream, undefined);
  // Roles must be user/assistant only — no system message in the array.
  assert.ok(params.messages.every((message) => message.role === 'user' || message.role === 'assistant'));
  assert.equal(params.messages.length, 1);
  assert.equal(params.messages[0].role, 'user');
  assert.match(params.messages[0].content, /=== VOICE ===/);
  assert.match(params.messages[0].content, /What is a closure\?/);
});

test('streams only text_delta events through onChunk', async () => {
  const { service } = createService();
  const chunks = [];
  const result = await service.answerQuestion('hi', { onChunk: (chunk) => chunks.push(chunk) });

  assert.equal(result, 'Hello world');
  // The signature_delta event must not leak into the output.
  assert.deepEqual(chunks, [
    { text: 'Hello ', index: 1 },
    { text: 'world', index: 2 }
  ]);
});

test('maps screenshots to Anthropic base64 image blocks', async () => {
  const { service, stub } = createService();
  await service.analyzeScreenshots(
    [{ inlineData: { mimeType: 'image/png', data: PNG_1X1 } }],
    ''
  );

  const userContent = stub.calls[0].messages[0].content;
  assert.ok(Array.isArray(userContent));
  assert.equal(userContent[0].type, 'text');
  assert.match(userContent[0].text, /=== VOICE ===/);
  assert.deepEqual(userContent[1], {
    type: 'image',
    source: {
      type: 'base64',
      media_type: 'image/png',
      data: PNG_1X1
    }
  });
});

test('classifies Anthropic auth and rate-limit errors', () => {
  const { service } = createService();
  assert.equal(service.isAuthenticationError({ status: 401, name: 'AuthenticationError', message: 'invalid x-api-key' }), true);
  assert.equal(service.isAuthenticationError({ status: 403, message: 'forbidden' }), true);
  assert.equal(service.isQuotaExhaustedError({ status: 429, name: 'RateLimitError', message: 'rate limit exceeded' }), true);
  assert.equal(service.isRetryableError({ name: 'APIConnectionError', message: 'connection error' }), true);
  assert.equal(service.isRetryableError({ name: 'APIConnectionTimeoutError', message: 'timed out' }), true);
  assert.equal(service.isAuthenticationError({ status: 400, message: 'validation' }), false);
});

test('does not retry quota errors', async () => {
  let attempts = 0;
  const { service } = createService({
    createImpl: async () => {
      attempts += 1;
      const error = new Error('rate limit exceeded');
      error.status = 429;
      throw error;
    }
  });

  await assert.rejects(service.answerQuestion('hi'), /rate limit/);
  assert.equal(attempts, 1);
});
