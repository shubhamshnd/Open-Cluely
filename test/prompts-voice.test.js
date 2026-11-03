'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAskAiSessionPrompt } = require('../src/services/ai/prompts');

test('natural voice stays in the shared prompts', () => {
  const prompt = buildAskAiSessionPrompt({
    transcriptContext: 'Hello, what is a linked list?',
    screenshotCount: 0,
    programmingLanguage: 'JavaScript'
  });

  assert.match(prompt, /=== VOICE ===/, 'prompt must contain === VOICE ===');

  // The shipped prompt says "Never put a comment above every line", so the
  // phrase itself appears inside a negated rule. Strip that rule, then make
  // sure no affirmative "comment above every line" mandate remains.
  const withoutNegation = prompt.replace(/Never put a comment above every line/gi, '');
  assert.ok(
    !withoutNegation.includes('comment above every line'),
    'prompt must not require a comment above every line'
  );
  assert.ok(!/MUST have a comment on the line above/i.test(prompt));
  assert.ok(!/No line without a comment/i.test(prompt));
});
