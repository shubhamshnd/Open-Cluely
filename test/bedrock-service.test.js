'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ConverseCommand, ConverseStreamCommand } = require('@aws-sdk/client-bedrock-runtime');
const { ListFoundationModelsCommand } = require('@aws-sdk/client-bedrock');
const BedrockService = require('../src/services/ai/bedrock-service');
const { assertProvider } = require('../src/services/ai/provider-contract');

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function createStubClients({ sendImpl } = {}) {
  const sent = [];
  const runtimeClient = {
    send: async (command) => {
      sent.push(command);
      if (sendImpl) {
        return sendImpl(command);
      }
      if (command instanceof ConverseStreamCommand) {
        return {
          stream: (async function* () {
            yield { contentBlockDelta: { delta: { reasoningContent: { text: 'thinking…' } } } };
            yield { contentBlockDelta: { delta: { text: 'Hello ' } } };
            yield { contentBlockDelta: { delta: { text: 'world' } } };
            yield { messageStop: { stopReason: 'end_turn' } };
          })()
        };
      }
      if (command instanceof ListFoundationModelsCommand) {
        return {
          modelSummaries: [
            { modelId: 'us.anthropic.claude-sonnet-5-5', outputModalities: ['TEXT'], inferenceTypesSupported: ['ON_DEMAND'], modelLifecycle: { status: 'ACTIVE' } },
            { modelId: 'amazon.titan-embed-text-v2:0', outputModalities: ['EMBEDDING'], inferenceTypesSupported: ['ON_DEMAND'], modelLifecycle: { status: 'ACTIVE' } },
            { modelId: 'us.moonshotai.kimi-k3', outputModalities: ['TEXT'], inferenceTypesSupported: ['ON_DEMAND'], modelLifecycle: { status: 'ACTIVE' } },
            { modelId: 'old.legacy-model-v1:0', outputModalities: ['TEXT'], inferenceTypesSupported: ['ON_DEMAND'], modelLifecycle: { status: 'LEGACY' } }
          ]
        };
      }
      return {
        output: {
          message: {
            role: 'assistant',
            content: [
              { reasoningContent: { reasoningText: { text: 'chain of thought' } } },
              { text: 'stubbed ' },
              { text: 'answer' }
            ]
          }
        }
      };
    }
  };
  const bedrockClient = { send: runtimeClient.send };
  return { sent, runtimeClient, bedrockClient };
}

function createService(overrides = {}) {
  const stubs = createStubClients(overrides);
  const service = new BedrockService({
    region: overrides.region ?? 'us-east-1',
    accessKeyId: overrides.accessKeyId,
    secretAccessKey: overrides.secretAccessKey,
    modelId: overrides.modelId ?? 'us.anthropic.claude-sonnet-5-5',
    minRequestInterval: 0,
    runtimeClient: stubs.runtimeClient,
    bedrockClient: stubs.bedrockClient
  });
  return { service, stubs };
}

test('BedrockService satisfies the shared provider contract', () => {
  const { service } = createService();
  assert.equal(assertProvider(service, 'BedrockService'), true);
  assert.equal(service.ready(), true);
  assert.equal(service.supportsImages, true);
});

test('ready() gating: region plus both keys or neither', () => {
  assert.equal(createService({ accessKeyId: '', secretAccessKey: '' }).service.ready(), true);
  assert.equal(createService({ accessKeyId: 'AKIA…', secretAccessKey: 'secret' }).service.ready(), true);
  assert.equal(createService({ accessKeyId: 'AKIA…', secretAccessKey: '' }).service.ready(), false);
  assert.equal(createService({ accessKeyId: '', secretAccessKey: 'secret' }).service.ready(), false);
  assert.equal(createService({ region: '' }).service.region, 'us-east-1');
});

test('sends a Converse request with system blocks and returns text only', async () => {
  const { service, stubs } = createService();
  const result = await service.answerQuestion('What is a closure?');

  assert.equal(result, 'stubbed answer');
  assert.equal(stubs.sent.length, 1);
  const command = stubs.sent[0];
  assert.ok(command instanceof ConverseCommand);
  assert.equal(command.input.modelId, 'us.anthropic.claude-sonnet-5-5');
  assert.ok(Array.isArray(command.input.system));
  assert.equal(typeof command.input.system[0].text, 'string');
  const content = command.input.messages[0].content;
  assert.equal(content[0].text !== undefined, true);
  assert.match(content[0].text, /=== VOICE ===/);
  assert.match(content[0].text, /What is a closure\?/);
});

test('streams text deltas and skips reasoningContent deltas', async () => {
  const { service } = createService();
  const chunks = [];
  const result = await service.answerQuestion('hi', { onChunk: (chunk) => chunks.push(chunk) });

  assert.equal(result, 'Hello world');
  // The reasoningContent delta must not leak into the streamed output.
  assert.deepEqual(chunks, [
    { text: 'Hello ', index: 1 },
    { text: 'world', index: 2 }
  ]);
});

test('maps screenshots to Converse image blocks with raw bytes', async () => {
  const { service, stubs } = createService();
  await service.analyzeScreenshots(
    [{ inlineData: { mimeType: 'image/png', data: PNG_1X1 } }],
    ''
  );

  const command = stubs.sent[0];
  const content = command.input.messages[0].content;
  assert.equal(content.length, 2);
  assert.equal(typeof content[0].text, 'string');
  assert.equal(content[1].image.format, 'png');
  assert.ok(Buffer.isBuffer(content[1].image.source.bytes));
  assert.equal(content[1].image.source.bytes.toString('base64'), PNG_1X1);
});

test('text-only models (kimi-k3) send no image blocks', async () => {
  const { service, stubs } = createService({ modelId: 'us.moonshotai.kimi-k3' });
  assert.equal(service.supportsImages, false);

  await service.analyzeScreenshots(
    [{ inlineData: { mimeType: 'image/png', data: PNG_1X1 } }],
    'ocr text'
  );

  const content = stubs.sent[0].input.messages[0].content;
  assert.equal(content.length, 1);
  assert.match(content[0].text, /cannot see images/);
  assert.match(content[0].text, /ocr text/);
});

test('classifies Bedrock auth, throttling and timeout errors', () => {
  const { service } = createService();
  assert.equal(service.isAuthenticationError({ name: 'UnrecognizedClientException', message: 'bad creds' }), true);
  assert.equal(service.isAuthenticationError({ name: 'InvalidSignatureException', message: 'sig mismatch' }), true);
  assert.equal(service.isAuthenticationError({ name: 'AccessDeniedException', message: 'denied' }), true);
  assert.equal(service.isQuotaExhaustedError({ name: 'ThrottlingException', message: 'too many requests' }), true);
  assert.equal(service.isRetryableError({ name: 'ModelTimeoutException', message: 'model timed out' }), true);
  assert.equal(service.isAuthenticationError({ name: 'ValidationException', message: 'bad input' }), false);
});

test('listModels filters to active on-demand text models', async () => {
  const { service } = createService();
  const models = await service.listModels();
  assert.deepEqual(models, ['us.anthropic.claude-sonnet-5-5', 'us.moonshotai.kimi-k3']);
});

test('uses static credentials only when both key parts are set', async () => {
  delete require.cache[require.resolve('../src/services/ai/bedrock-service.js')];
  const BedrockServiceFresh = require('../src/services/ai/bedrock-service.js');
  const withKeys = new BedrockServiceFresh({
    region: 'eu-west-1',
    accessKeyId: 'AKIATESTKEY0000000',
    secretAccessKey: 'testsecret',
    modelId: 'us.moonshotai.kimi-k3',
    runtimeClient: { send: async () => ({ output: { message: { content: [{ text: 'x' }] } } }) },
    bedrockClient: { send: async () => ({ modelSummaries: [] }) }
  });
  assert.equal(withKeys.ready(), true);
  const withoutKeys = new BedrockServiceFresh({
    region: 'eu-west-1',
    modelId: 'us.moonshotai.kimi-k3',
    runtimeClient: { send: async () => ({ output: { message: { content: [{ text: 'x' }] } } }) },
    bedrockClient: { send: async () => ({ modelSummaries: [] }) }
  });
  assert.equal(withoutKeys.ready(), true);
});
