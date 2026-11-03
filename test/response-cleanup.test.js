'use strict';

// Defect: a run began with a stray line "Domain: conceptual" before the
// answer. Routing labels from the domain-classification prompt must never
// reach the user — the prompt forbids them and response post-processing
// strips them defensively.

const test = require('node:test');
const assert = require('node:assert/strict');

const { stripRoutingLabels } = require('../src/services/ai/response-cleanup');
const { buildAskAiSessionPrompt } = require('../src/services/ai/prompts');
const BedrockService = require('../src/services/ai/bedrock-service');
const GeminiService = require('../src/services/ai/gemini-service');
const OllamaService = require('../src/services/ai/ollama-service');
const { ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');

const STRIP_CASES = [
  ['Domain: conceptual\n\nA process is an independent program.', 'A process is an independent program.'],
  ['Domain: conceptual\nA process is an independent program.', 'A process is an independent program.'],
  ['  Domain: conceptual  \nAnswer', 'Answer'],
  ['**Domain:** conceptual\nAnswer', 'Answer'],
  ['__Category:__ coding\nAnswer', 'Answer'],
  ['domain: CONCEPTUAL\nAnswer', 'Answer'],
  ['Mode: other\nCategory: coding\nDomain: behavioral\n\nAnswer', 'Answer'],
  ['\n\nDomain: conceptual\n\nAnswer', 'Answer'],
  ['Category: one\nMode: two\nDomain: three\nDomain: four stays\nAnswer', 'Domain: four stays\nAnswer'],
  ['Domain:\nAnswer', 'Answer']
];

test('stripRoutingLabels removes leading routing-label lines', () => {
  for (const [input, expected] of STRIP_CASES) {
    assert.equal(stripRoutingLabels(input), expected, `input: ${JSON.stringify(input)}`);
  }
});

const KEEP_CASES = [
  // Labels in the middle of an answer are content, not routing text.
  'A process is independent.\n\nDomain: conceptual\nMore detail here.',
  // A fenced code block leads the reply — nothing before it may be touched.
  '```\nDomain: x\n```',
  // An ordinary sentence that merely starts with the word "Domain" has no
  // colon directly after the word and is kept.
  'Domain models are useful.\nAnswer',
  ''
];

test('stripRoutingLabels keeps answers that have no leading label line', () => {
  for (const input of KEEP_CASES) {
    assert.equal(stripRoutingLabels(input), input, `input: ${JSON.stringify(input)}`);
  }
});

test('stripRoutingLabels handles non-string and label-only input', () => {
  assert.equal(stripRoutingLabels(null), '');
  assert.equal(stripRoutingLabels(undefined), '');
  assert.equal(stripRoutingLabels(42), '');
  assert.equal(stripRoutingLabels('Mode: other'), '');
});

test('the prompt orders the model to classify silently, never printing the label', () => {
  const prompt = buildAskAiSessionPrompt({ transcriptContext: 'hi', programmingLanguage: 'Python' });
  assert.match(prompt, /=== DOMAIN ROUTING ===/);
  assert.match(prompt, /[Cc]lassif(y|ies) silently/);
  assert.match(prompt, /[Nn]ever print (the|that|this) (domain|routing|category|mode|label)/);
});

// --- service-level: the strip happens in every provider's post-processing ---

test('BedrockService strips a leading routing label from the returned answer', async () => {
  const service = new BedrockService({
    region: 'us-east-1',
    modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
    minRequestInterval: 0,
    runtimeClient: {
      send: async (command) => {
        assert.ok(command instanceof ConverseCommand);
        return { output: { message: { content: [{ text: 'Domain: conceptual\n\nA process is an independent program.' }] } } };
      }
    },
    bedrockClient: { send: async () => ({ modelSummaries: [] }) }
  });

  const result = await service.answerQuestion('process vs thread?');
  assert.equal(result, 'A process is an independent program.');
});

test('GeminiService strips a leading routing label from the returned answer', async () => {
  const service = new GeminiService('fake-test-key', { modelName: 'gemini-2.5-flash-lite' });
  service.model = {
    generateContent: async () => ({ response: { text: () => 'Domain: conceptual\n\nClean answer.' } })
  };

  const result = await service.generateText('prompt');
  assert.equal(result, 'Clean answer.');
});

test('OllamaService strips a leading routing label from the returned answer', async () => {
  const service = new OllamaService({ baseUrl: 'http://localhost:11434', modelName: 'llama3.2' });
  service._chat = async () => 'Domain: conceptual\n\nClean answer.';

  const result = await service.generateText('prompt');
  assert.equal(result, 'Clean answer.');
});
