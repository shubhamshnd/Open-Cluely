'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const OpenAIService = require('../src/services/ai/openai-service');
const { fetchProviderModels } = require('../src/services/ai/model-lists');

function openaiWithModels(ids) {
  return new OpenAIService('sk-test', {
    minRequestInterval: 0,
    client: { models: { list: async () => ({ data: ids.map((id) => ({ id })) }) } }
  });
}

test('OpenAI listModels keeps chat models and drops embeddings, speech and image models', async () => {
  const service = openaiWithModels([
    'text-embedding-3-small', 'gpt-4o', 'whisper-1', 'gpt-4.1-mini', 'dall-e-3',
    'tts-1', 'gpt-4o-realtime-preview', 'o3-mini', 'omni-moderation-latest', 'gpt-3.5-turbo-instruct'
  ]);
  assert.deepEqual(await service.listModels(), ['gpt-4.1-mini', 'gpt-4o', 'o3-mini']);
});

test('fetchProviderModels returns models from the matching service', async () => {
  const seen = [];
  const factories = {
    openai: (params) => { seen.push(params); return { ready: () => true, listModels: async () => ['gpt-4o'] }; },
    bedrock: (params) => { seen.push(params); return { ready: () => true, listModels: async () => ['us.anthropic.claude-sonnet-5-5'] }; }
  };
  assert.deepEqual(await fetchProviderModels('openai', { apiKey: ' sk-1 ' }, factories), { success: true, models: ['gpt-4o'] });
  assert.deepEqual(
    await fetchProviderModels('bedrock', { region: 'eu-west-1' }, factories),
    { success: true, models: ['us.anthropic.claude-sonnet-5-5'] }
  );
  assert.equal(seen[0].apiKey, 'sk-1');
  assert.equal(seen[1].region, 'eu-west-1');
});

test('object-shaped listModels results pass models and the readable note through', async () => {
  const factories = {
    bedrock: () => ({
      ready: () => true,
      listModels: async () => ({
        models: [{ id: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', supportsImages: true }],
        note: 'Inference profiles could not be listed (AccessDeniedException).'
      })
    })
  };
  const result = await fetchProviderModels('bedrock', { region: 'us-east-1' }, factories);
  assert.deepEqual(result, {
    success: true,
    models: [{ id: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', supportsImages: true }],
    note: 'Inference profiles could not be listed (AccessDeniedException).'
  });
});

test('Anthropic and unknown providers are not fetchable', async () => {
  const result = await fetchProviderModels('anthropic', { apiKey: 'k' });
  assert.equal(result.success, false);
  assert.match(result.error, /not available/);
});

test('not-ready service returns a helpful message instead of calling the API', async () => {
  let called = false;
  const factories = {
    openai: () => ({ ready: () => false, listModels: async () => { called = true; return []; } })
  };
  const result = await fetchProviderModels('openai', {}, factories);
  assert.equal(result.success, false);
  assert.match(result.error, /API key/);
  assert.equal(called, false);
});

test('errors are returned without leaking API keys', async () => {
  const factories = {
    openai: () => ({
      ready: () => true,
      listModels: async () => { throw new Error('401 Incorrect API key provided: sk-abcdef123456XYZ'); }
    })
  };
  const result = await fetchProviderModels('openai', { apiKey: 'sk-abcdef123456XYZ' }, factories);
  assert.equal(result.success, false);
  assert.doesNotMatch(result.error, /sk-abcdef/);
  assert.match(result.error, /\[redacted\]/);
});

test('OpenAI listModels walks an auto-paginating async iterable page', async () => {
  const service = new OpenAIService('sk-test', {
    minRequestInterval: 0,
    client: {
      models: {
        list: async () => (async function* () {
          yield { id: 'gpt-4o' };
          yield { id: 'text-embedding-3-large' };
          yield { id: 'gpt-4.1' };
        })()
      }
    }
  });
  assert.deepEqual(await service.listModels(), ['gpt-4.1', 'gpt-4o']);
});
