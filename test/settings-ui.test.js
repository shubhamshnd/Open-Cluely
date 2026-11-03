'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { getAiProviders, getAwsAuthModes, getSttProviders } = require('../src/config');

const html = fs.readFileSync(path.join(__dirname, '../src/windows/assistant/renderer.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../src/windows/assistant/styles.css'), 'utf8');
const manager = fs.readFileSync(
  path.join(__dirname, '../src/windows/assistant/renderer/features/settings/settings-panel-manager.js'),
  'utf8'
);

// Extract every CSS rule as { selectors: [...], body } so tests can assert on
// exact selectors instead of substring-matching the whole stylesheet.
function parseCssRules(source) {
  const rules = [];
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = rulePattern.exec(withoutComments)) !== null) {
    const selectors = match[1].split(',').map((s) => s.trim()).filter(Boolean);
    rules.push({ selectors, body: match[2] });
  }
  return rules;
}

test('settings provider dropdown offers every configured provider', () => {
  const select = html.match(/<select id="setting-ai-provider"[\s\S]*?<\/select>/)[0];
  const values = [...select.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(values, getAiProviders());
});

test('each provider has exactly one settings group, hidden by default except Gemini', () => {
  for (const provider of getAiProviders()) {
    const id = `${provider}-settings-group`;
    const matches = html.match(new RegExp(`<div id="${id}"[^>]*>`, 'g')) || [];
    assert.equal(matches.length, 1, `missing group ${id}`);
    assert.ok(manager.includes(`'${id}'`), `${id} not wired in settings-panel-manager`);
    if (provider !== 'gemini') {
      assert.match(matches[0], /class="hidden"/, `${id} should start hidden`);
    }
  }
});

test('Bedrock group keeps region+model and the top bar badge exists', () => {
  assert.match(html, /id="setting-bedrock-region"/);
  assert.match(html, /id="setting-bedrock-model"/);
  assert.match(html, /id="chat-provider-model"/);
  // The legacy per-provider key fields were replaced by the shared AWS block.
  assert.doesNotMatch(html, /setting-bedrock-access-key/);
  assert.doesNotMatch(html, /setting-bedrock-secret/);
});

test('shared AWS credentials block: one option per auth mode, sub-groups hidden', () => {
  assert.match(html, /<div id="aws-credentials-group" class="hidden">/);
  assert.ok(manager.includes('aws-credentials-group'), 'AWS block not wired in settings-panel-manager');

  const select = html.match(/<select id="setting-aws-auth-mode"[\s\S]*?<\/select>/)[0];
  const values = [...select.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(values, getAwsAuthModes());

  for (const id of [
    'setting-aws-profile-select',
    'setting-aws-profile',
    'refresh-aws-profiles',
    'setting-aws-access-key',
    'setting-aws-secret',
    'setting-aws-session-token',
    'setting-bedrock-api-key'
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing ${id}`);
  }
  for (const groupId of ['aws-profile-group', 'aws-keys-group', 'aws-api-key-group']) {
    const matches = html.match(new RegExp(`<div id="${groupId}"[^>]*>`)) || [];
    assert.equal(matches.length, 1, `missing group ${groupId}`);
    assert.match(matches[0], /class="[^"]*\bhidden\b/, `${groupId} should start hidden`);
  }
  // The Bedrock API key helper must say Transcribe cannot use it.
  assert.match(html, /Bedrock only; Amazon Transcribe can't use it/);
});

test('speech-to-text provider select offers every configured STT provider', () => {
  const select = html.match(/<select id="setting-stt-provider"[\s\S]*?<\/select>/)[0];
  const values = [...select.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(values, getSttProviders());
  assert.ok(manager.includes('setting-stt-provider'), 'STT select not wired in settings-panel-manager');

  // AssemblyAI fields stay in their own visible-by-default group; the
  // Transcribe group starts hidden with its region and language fields.
  assert.match(html, /<div id="assemblyai-stt-group">/);
  assert.match(html, /<div id="transcribe-stt-group" class="hidden">/);
  assert.match(html, /id="setting-transcribe-region"/);
  assert.match(html, /id="setting-transcribe-language"/);
  // The lock hint for switching provider while transcription runs.
  assert.match(html, /<div id="stt-provider-locked-hint" class="settings-helper-text hidden">/);
});

test('Transcribe custom vocabulary UI exists inside the Transcribe group', () => {
  const group = html.match(/<div id="transcribe-stt-group"[\s\S]*$/)?.[0] || '';
  for (const id of [
    'setting-transcribe-vocabulary-words',
    'transcribe-vocabulary-save',
    'transcribe-vocabulary-status'
  ]) {
    assert.ok(group.includes(`id="${id}"`), `missing ${id} in the Transcribe group`);
  }
  // The helper explains the spaces-to-hyphens rule.
  assert.match(html, /spaces become hyphens/);
  assert.ok(manager.includes('transcribe-vocabulary-save'), 'vocabulary button not wired in settings-panel-manager');
});

test('stylesheet has a bare .hidden rule with display: none (provider groups rely on it)', () => {
  // settings-panel-manager toggles only the `hidden` class on the provider
  // groups and the Ollama model dropdown; without a bare `.hidden` rule those
  // elements stay visible even when they carry the class. A scoped rule like
  // `.settings-panel.hidden` must NOT satisfy this test.
  const bareHiddenRule = parseCssRules(css).find(
    (rule) => rule.selectors.includes('.hidden') && /display\s*:\s*none/.test(rule.body)
  );
  assert.ok(
    bareHiddenRule,
    'styles.css must contain a bare `.hidden { display: none ... }` rule; ' +
    'provider settings groups and #setting-ollama-model-select carry only the `hidden` class'
  );
});
