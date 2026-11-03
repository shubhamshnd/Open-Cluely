'use strict';

// Defect: AI answers were prefixed with app-side labels ("**Best Next Answer
// (Transcript):**", "💡 **What should I say?**", "📝 **Meeting Notes**") that
// read as app chrome, not as a human answer. The answer itself must lead.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rendererSource = fs.readFileSync(
  path.join(__dirname, '../src/windows/assistant/renderer.js'),
  'utf8'
);
const { buildAskAiSessionPrompt } = require('../src/services/ai/prompts');

const REMOVED_LABELS = [
  '**Best Next Answer:**',
  '**Best Next Answer (Transcript):**',
  '**Best Next Answer (Transcript + Screen):**',
  '**What should I say?**',
  '**Meeting Notes**',
  '**Conversation Insights**'
];

test('renderer never prefixes AI answers with app-side labels', () => {
  for (const label of REMOVED_LABELS) {
    assert.equal(
      rendererSource.includes(label),
      false,
      `renderer still prefixes answers with ${label}`
    );
  }
});

test('stream finalize passes the model answer through without a heading', () => {
  const finalizeCalls = rendererSource.match(/stream\.finalize\([^)]*\)/g) || [];
  assert.ok(finalizeCalls.length >= 4, 'expected finalize calls for askAi/suggest/notes/insights');
  for (const call of finalizeCalls) {
    assert.doesNotMatch(call, /\*\*|u\{1F4/, `finalize adds a label: ${call}`);
    assert.match(call, /stream\.finalize\((result\.(text|suggestions|notes|insights)|data\.text)\)/, `unexpected finalize payload: ${call}`);
  }
});

test('prompt style leads with the direct answer in 2-4 sentences', () => {
  const prompt = buildAskAiSessionPrompt({ transcriptContext: 'hi', programmingLanguage: 'Python' });
  assert.match(prompt, /Lead with the direct answer: 2–4 plain spoken sentences/);
  assert.match(prompt, /No meta-phrases/);
  // The natural-voice directive stays the single source of anti-opener rules.
  const voiceCount = (prompt.match(/=== VOICE ===/g) || []).length;
  assert.equal(voiceCount, 1, 'buildNaturalVoiceDirective must not be duplicated');
});
