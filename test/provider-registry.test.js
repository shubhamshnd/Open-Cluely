'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createProviderRegistry, PROVIDER_DEFINITIONS } = require('../src/services/ai/provider-registry');
const { createGeminiRuntime } = require('../src/main-process/features/assistant/gemini-runtime');
const { getAiProviders } = require('../src/config');
const { assertProvider } = require('../src/services/ai/provider-contract');

test('registry defines exactly the configured providers', () => {
  assert.deepEqual(getAiProviders(), ['gemini', 'openai', 'anthropic', 'bedrock', 'ollama']);
  assert.deepEqual(Object.keys(PROVIDER_DEFINITIONS).sort(), [...getAiProviders()].sort());
});

test('registry readiness depends on each provider\'s own credentials', () => {
  const registry = createProviderRegistry();
  assert.equal(registry.isReady('gemini', {}), false);
  assert.equal(registry.isReady('gemini', { gemini: { apiKey: 'k' } }), true);
  assert.equal(registry.isReady('openai', { gemini: { apiKey: 'k' } }), false);
  assert.equal(registry.isReady('anthropic', { anthropic: { apiKey: 'k' } }), true);
  assert.equal(registry.isReady('ollama', {}), true);
  // Bedrock: both key parts or neither
  assert.equal(registry.isReady('bedrock', {}), true);
  assert.equal(registry.isReady('bedrock', { bedrock: { accessKeyId: 'a', secretAccessKey: 's' } }), true);
  assert.equal(registry.isReady('bedrock', { bedrock: { accessKeyId: 'a' } }), false);
});

test('registry builds contract-conforming services, caches and reconfigures them', () => {
  const registry = createProviderRegistry();
  const settings = { openai: { apiKey: 'sk-1', modelName: 'gpt-4.1-mini' } };
  const first = registry.getService('openai', settings);
  assert.equal(assertProvider(first, 'openai'), true);
  assert.equal(registry.getService('openai', settings), first);

  registry.getService('openai', { openai: { apiKey: 'sk-2', modelName: 'gpt-4.1' } });
  assert.equal(first.apiKey, 'sk-2');
  assert.equal(first.modelName, 'gpt-4.1');
});

test('registry returns null and drops the cached service when not ready', () => {
  const registry = createProviderRegistry();
  assert.ok(registry.getService('anthropic', { anthropic: { apiKey: 'k' } }));
  assert.equal(registry.getService('anthropic', { anthropic: { apiKey: '' } }), null);
  assert.equal(registry.peek('anthropic'), null);
});

test('runtime isReady() follows the active provider, not Gemini keys', () => {
  const runtime = createGeminiRuntime();
  runtime.setKeys('gemini-key');
  runtime.setActiveAiProvider('gemini');
  assert.equal(runtime.isReady(), true);

  // Gemini has a key, but OpenAI does not — must be gated.
  runtime.setActiveAiProvider('openai');
  assert.equal(runtime.isReady(), false);
  runtime.setProviderSettings('openai', { apiKey: 'sk-x' });
  assert.equal(runtime.isReady(), true);

  // No Gemini key must not block a ready non-Gemini provider.
  runtime.setKeys('');
  assert.equal(runtime.isReady(), true);
  runtime.setActiveAiProvider('gemini');
  assert.equal(runtime.isReady(), false);
});

test('runtime routes non-Gemini providers through the registry', async () => {
  const runtime = createGeminiRuntime();
  runtime.setActiveAiProvider('anthropic');
  await assert.rejects(runtime.executeWithKeyFailover(async () => 'x'), /not configured/);

  runtime.setProviderSettings('anthropic', { apiKey: 'sk-ant-x', modelName: 'claude-haiku-4-5' });
  const service = await runtime.executeWithKeyFailover(async (svc) => svc);
  assert.equal(service.modelName, 'claude-haiku-4-5');
  assert.equal(runtime.getService(), service);
  assert.equal(runtime.getActiveModelName(), 'claude-haiku-4-5');
});

test('Gemini key rotation stays Gemini-only', async () => {
  const runtime = createGeminiRuntime();
  runtime.setKeys('k1,k2');
  runtime.setActiveAiProvider('gemini');
  const seen = [];
  const quota = Object.assign(new Error('quota exceeded'), { status: 429 });
  await runtime.executeWithKeyFailover(async (svc, meta) => {
    seen.push(meta.activeApiKey);
    if (meta.attempt === 1) throw quota;
    return 'ok';
  });
  assert.deepEqual(seen, ['k1', 'k2']);

  // A non-Gemini provider must never rotate, and passes the error through.
  runtime.setActiveAiProvider('openai');
  runtime.setProviderSettings('openai', { apiKey: 'sk' });
  let calls = 0;
  await assert.rejects(
    runtime.executeWithKeyFailover(async () => { calls += 1; throw quota; }),
    /quota/
  );
  assert.equal(calls, 1);
});
