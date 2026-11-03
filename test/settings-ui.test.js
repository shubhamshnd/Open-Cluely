'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { getAiProviders } = require('../src/config');

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

test('Bedrock group explains the credential chain and the top bar badge exists', () => {
  assert.match(html, /Leave both blank to use the AWS credential chain/);
  assert.match(html, /id="chat-provider-model"/);
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
