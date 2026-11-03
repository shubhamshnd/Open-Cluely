'use strict';

// SDK/server error text can echo key material (OpenAI's own error body shows
// the first and last characters of the offending key). Anything written to
// the console must pass through the redactor first.

const test = require('node:test');
const assert = require('node:assert/strict');

const { redactSecretsInText } = require('../src/services/state/secret-masking.js');

const FAKE_OPENAI_KEY = 'sk-proj-fakekeyfakekeyfakekey0001';
const FAKE_AWS_ACCESS_KEY = 'AKIAFAKEKEY000000000';
const FAKE_GEMINI_KEY = 'AIzaFakeGeminiKey00000000000000000001';

test('redactSecretsInText masks known key shapes in arbitrary text', () => {
  assert.equal(
    redactSecretsInText(`Incorrect API key provided: ${FAKE_OPENAI_KEY}. You can find your API key at …`),
    'Incorrect API key provided: sk-••••••••0001. You can find your API key at …'
  );
  assert.equal(
    redactSecretsInText(`AWS error for ${FAKE_AWS_ACCESS_KEY}`),
    'AWS error for AKIA••••••••0000'
  );
  assert.equal(
    redactSecretsInText(`genai error ${FAKE_GEMINI_KEY}`),
    'genai error AIza••••••••0001'
  );
  assert.equal(
    redactSecretsInText('401 with Authorization: Bearer fakebedrocktoken1234abcd'),
    '401 with Authorization: Bearer ••••••••abcd'
  );
  // Server-side partial echo (first 8 + asterisks + last 4) is fully removed.
  assert.equal(
    redactSecretsInText('Incorrect API key provided: sk-proj-***********0001.'),
    'Incorrect API key provided: sk-••••••••0001.'
  );
  // Ordinary prose is untouched.
  assert.equal(redactSecretsInText('Analysis failed: quota exceeded'), 'Analysis failed: quota exceeded');
  assert.equal(redactSecretsInText(''), '');
  assert.equal(redactSecretsInText(null), '');
  assert.equal(redactSecretsInText(undefined), '');
});

test('redaction leaves at most the last 4 characters of any secret', () => {
  const redacted = redactSecretsInText(`keys ${FAKE_OPENAI_KEY} and ${FAKE_AWS_ACCESS_KEY}`);
  assert.ok(!redacted.includes('fakekey'), 'no cleartext fragment survives');
  assert.ok(!redacted.includes('FAKEKEY00'), 'no cleartext fragment survives');
});
