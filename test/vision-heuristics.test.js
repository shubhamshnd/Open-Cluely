'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { openAIModelSupportsImages, bedrockModelSupportsImages } = require('../src/config');

test('OpenAI vision heuristic: fetched text-only models get OCR, vision models get images', () => {
  for (const id of ['o1-mini', 'o1-preview', 'o3-mini', 'gpt-4-turbo-preview', 'gpt-4-0125-preview', 'gpt-3.5-turbo']) {
    assert.equal(openAIModelSupportsImages(id), false, id);
  }
  for (const id of ['gpt-4o', 'gpt-4.1-nano', 'gpt-4-turbo', 'gpt-5', 'o1', 'o3', 'o4-mini']) {
    assert.equal(openAIModelSupportsImages(id), true, id);
  }
});

test('Bedrock vision heuristic: fetched text-only models get OCR, vision models get images', () => {
  for (const id of [
    'amazon.nova-micro-v1:0',
    'anthropic.claude-v2:1',
    'anthropic.claude-instant-v1',
    'us.anthropic.claude-3-5-haiku-20241022-v1:0',
    'meta.llama3-1-70b-instruct-v1:0'
  ]) {
    assert.equal(bedrockModelSupportsImages(id), false, id);
  }
  for (const id of [
    'amazon.nova-pro-v1:0',
    'anthropic.claude-3-haiku-20240307-v1:0',
    'us.anthropic.claude-haiku-4-5-20251001-v1:0'
  ]) {
    assert.equal(bedrockModelSupportsImages(id), true, id);
  }
});
