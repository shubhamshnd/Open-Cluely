'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  runWithFallback,
  isFallbackEligible,
  buildFallbackNotice,
  classifyForFallback
} = require('../src/services/ai/provider-fallback');
const { createGeminiRuntime } = require('../src/main-process/features/assistant/gemini-runtime');

const err = (props) => Object.assign(new Error(props.message || 'boom'), props);
const quota = () => err({ status: 429, message: 'rate limit exceeded' });
const auth = () => err({ status: 401, message: 'invalid api key' });
const refused = () => err({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' });
const timeout = () => err({ code: 'ETIMEDOUT', message: 'request timed out' });

test('only auth, quota, timeout and connection errors are eligible', () => {
  assert.equal(classifyForFallback(auth()), 'auth');
  assert.equal(classifyForFallback(quota()), 'quota');
  assert.equal(classifyForFallback(timeout()), 'timeout');
  assert.equal(classifyForFallback(refused()), 'connection');
  assert.equal(classifyForFallback(err({ code: 'GEMINI_ALL_KEYS_UNAVAILABLE' })), 'quota');
  // A normal bad answer / validation problem must never switch providers.
  assert.equal(isFallbackEligible(err({ status: 400, message: 'bad request' })), false);
  assert.equal(isFallbackEligible(new Error('model returned empty text')), false);
});

test('falls through the list in order and skips providers that are not ready', async () => {
  const tried = [];
  const switches = [];
  const result = await runWithFallback({
    order: ['gemini', 'openai', 'anthropic', 'ollama'],
    isReady: (name) => name !== 'openai',
    run: async (name) => {
      tried.push(name);
      if (name === 'gemini') throw quota();
      if (name === 'anthropic') throw refused();
      return `ok from ${name}`;
    },
    onSwitch: (info) => switches.push(info)
  });

  assert.equal(result, 'ok from ollama');
  assert.deepEqual(tried, ['gemini', 'anthropic', 'ollama']);
  assert.deepEqual(switches.map((s) => [s.from, s.to, s.reason]), [
    ['gemini', 'anthropic', 'quota'],
    ['anthropic', 'ollama', 'connection']
  ]);
});

test('a non-eligible error is thrown immediately without trying the next provider', async () => {
  const tried = [];
  await assert.rejects(
    runWithFallback({
      order: ['gemini', 'openai'],
      isReady: () => true,
      run: async (name) => { tried.push(name); throw err({ status: 400, message: 'bad prompt' }); }
    }),
    /bad prompt/
  );
  assert.deepEqual(tried, ['gemini']);
});

test('rethrows the original error when no ready fallback remains', async () => {
  await assert.rejects(
    runWithFallback({
      order: ['gemini', 'openai'],
      isReady: () => false,
      run: async () => { throw auth(); }
    }),
    /invalid api key/
  );
});

test('notice names the provider that took over', () => {
  assert.equal(buildFallbackNotice('gemini', 'openai', 'quota'), 'Gemini was rate-limited, continuing with OpenAI.');
  assert.equal(buildFallbackNotice('bedrock', 'anthropic', 'auth'), 'Amazon Bedrock rejected its credentials, continuing with Anthropic.');
});

test('runtime: default has no fallback, so errors surface unchanged', async () => {
  const runtime = createGeminiRuntime();
  runtime.setActiveAiProvider('openai');
  runtime.setProviderSettings('openai', { apiKey: 'sk' });
  runtime.setProviderSettings('anthropic', { apiKey: 'sk-ant' });
  assert.deepEqual(runtime.getProviderFallback(), []);
  const tried = [];
  await assert.rejects(
    runtime.executeWithKeyFailover(async (svc, meta) => { tried.push(meta.provider); throw quota(); }),
    /rate limit/
  );
  assert.deepEqual(tried, ['openai']);
});

test('runtime: configured fallback switches provider and reports it', async () => {
  const runtime = createGeminiRuntime();
  runtime.setActiveAiProvider('openai');
  runtime.setProviderSettings('openai', { apiKey: 'sk' });
  runtime.setProviderSettings('anthropic', { apiKey: 'sk-ant', modelName: 'claude-haiku-4-5' });
  assert.deepEqual(runtime.setProviderFallback(['bedrock-typo', 'anthropic', 'anthropic', 'openai']), ['anthropic', 'openai']);

  const switches = [];
  const result = await runtime.executeWithKeyFailover(
    async (svc, meta) => {
      if (meta.provider === 'openai') throw quota();
      return `${meta.provider}:${svc.modelName}`;
    },
    { onProviderSwitch: (info) => switches.push(info.notice) }
  );
  assert.equal(result, 'anthropic:claude-haiku-4-5');
  assert.deepEqual(switches, ['OpenAI was rate-limited, continuing with Anthropic.']);
});
