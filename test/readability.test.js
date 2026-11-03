'use strict';

// Static readability checks on the assistant stylesheet.
// Linux Electron cannot blur what is behind a transparent window, so any
// surface that holds text must be near-opaque in BOTH themes, and the light
// theme needs its own equivalent for every text rule the dark theme overrides.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cssPath = process.env.READABILITY_CSS
  || path.join(__dirname, '../src/windows/assistant/styles.css');
const css = fs.readFileSync(cssPath, 'utf8');
const MIN_ALPHA = 0.8;

function parseRules(source) {
  const rules = [];
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = pattern.exec(clean)) !== null) {
    const selectors = m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
    const decls = {};
    for (const part of m[2].split(';')) {
      const idx = part.indexOf(':');
      if (idx > 0) decls[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    }
    rules.push({ selectors, decls });
  }
  return rules;
}

const rules = parseRules(css);
const DARK = 'body.theme-dark ';
const LIGHT = 'body:not(.theme-dark) ';

function themeVars(theme) {
  const vars = {};
  for (const rule of rules) {
    const applies = rule.selectors.some((s) => s === ':root' || (theme === 'dark' && s === 'body.theme-dark'));
    if (!applies) continue;
    for (const [k, v] of Object.entries(rule.decls)) {
      if (k.startsWith('--')) vars[k] = v;
    }
  }
  return vars;
}

// Effective declaration for a selector in a theme. Theme-prefixed rules always
// out-specify plain ones, so: last theme-prefixed match wins, else last plain.
function effective(theme, selector, props) {
  const prefix = theme === 'dark' ? DARK : LIGHT;
  let plain = null;
  let themed = null;
  for (const rule of rules) {
    for (const prop of props) {
      if (!(prop in rule.decls)) continue;
      if (rule.selectors.includes(selector)) plain = rule.decls[prop];
      if (rule.selectors.includes(prefix + selector)) themed = rule.decls[prop];
    }
  }
  return themed || plain;
}

function resolveColor(value, vars) {
  if (!value) return null;
  const varMatch = value.match(/var\((--[\w-]+)\)/);
  if (varMatch) return resolveColor(vars[varMatch[1]], vars);
  return value;
}

function alphaOf(color) {
  if (!color) return null;
  const rgba = color.match(/rgba\(([^)]+)\)/);
  if (rgba) {
    const parts = rgba[1].split(',').map((s) => parseFloat(s));
    return parts.length > 3 ? parts[3] : 1;
  }
  if (/gradient/.test(color)) return null;
  if (/transparent/.test(color)) return 0;
  return 1; // hex / named color: opaque
}

// Every surface that directly holds readable text.
const TEXT_SURFACES = [
  '.glass-container',
  '.status-section',
  '.transcription-monitor',
  '.monitor-source-row',
  '.monitor-log-entry',
  '.monitor-log-entry.error',
  '.chat-container',
  '.chat-header',
  '.chat-composer',
  '.chat-manual-input',
  '.chat-message',
  '.chat-message.voice-message',
  '.chat-message.screenshot-message',
  '.chat-message.ai-response-message',
  '.chat-message.system-message',
  '.message-content',
  '.message-content.ai-response',
  '.message-content.system-message',
  '.results-panel',
  '.settings-panel',
  '.settings-input',
  '.settings-shortcut-row',
  '.close-confirmation-card',
  '.loading-overlay',
  '.status-text',
  '.action-btn',
  '.source-toggle',
  '.mobile-server-pill',
  '.monitor-status-badge',
  '.monitor-master-state',
  '.chat-autoscroll-toggle',
  '.message-copy-btn',
  '.ai-include-toggle',
  '.save-settings-btn'
];

for (const theme of ['light', 'dark']) {
  test(`${theme} theme: every text-holding surface has background alpha >= ${MIN_ALPHA}`, () => {
    const vars = themeVars(theme);
    const failures = [];
    for (const selector of TEXT_SURFACES) {
      const raw = effective(theme, selector, ['background', 'background-color']);
      if (!raw) {
        failures.push(`${selector}: no background declared`);
        continue;
      }
      const alpha = alphaOf(resolveColor(raw, vars));
      if (alpha === null) continue;
      if (alpha < MIN_ALPHA) failures.push(`${selector}: alpha ${alpha} (${raw})`);
    }
    assert.deepEqual(failures, [], `see-through surfaces in ${theme} theme`);
  });
}

test('glass CSS variables are opaque enough in both themes', () => {
  for (const theme of ['light', 'dark']) {
    const vars = themeVars(theme);
    for (const [name, value] of Object.entries(vars)) {
      if (!/-bg$/.test(name)) continue;
      const alpha = alphaOf(value);
      assert.ok(alpha === null || alpha >= MIN_ALPHA, `${theme}: ${name} = ${value} (alpha ${alpha})`);
    }
  }
});

test('light theme overrides every selector whose text color the dark theme overrides', () => {
  const lightSelectors = new Set();
  for (const rule of rules) {
    if (!('color' in rule.decls)) continue;
    for (const s of rule.selectors) {
      if (s.startsWith(LIGHT)) lightSelectors.add(s.slice(LIGHT.length));
    }
  }
  const missing = new Set();
  for (const rule of rules) {
    if (!('color' in rule.decls)) continue;
    for (const s of rule.selectors) {
      if (!s.startsWith(DARK)) continue;
      const bare = s.slice(DARK.length);
      if (!lightSelectors.has(bare)) missing.add(bare);
    }
  }
  assert.deepEqual([...missing], [], 'dark-only text color rules');
});

test('light theme overrides every selector whose background the dark theme overrides', () => {
  const lightSelectors = new Set();
  for (const rule of rules) {
    if (!('background' in rule.decls || 'background-color' in rule.decls)) continue;
    for (const s of rule.selectors) {
      if (s.startsWith(LIGHT)) lightSelectors.add(s.slice(LIGHT.length));
    }
  }
  const missing = new Set();
  for (const rule of rules) {
    if (!('background' in rule.decls || 'background-color' in rule.decls)) continue;
    for (const s of rule.selectors) {
      if (!s.startsWith(DARK)) continue;
      if (/::/.test(s) || /:focus-visible/.test(s)) continue;
      const bare = s.slice(DARK.length);
      if (!lightSelectors.has(bare)) missing.add(bare);
    }
  }
  assert.deepEqual([...missing], [], 'dark-only background rules');
});

test('settings Save button stays reachable (sticky inside the scroll body)', () => {
  const rule = rules.find((r) => r.selectors.includes('.settings-body .save-settings-btn'));
  assert.ok(rule, 'missing sticky Save rule');
  assert.equal(rule.decls.position, 'sticky');
  assert.match(rule.decls.bottom, /^\d+(px)?$/);
});

test('model label truncates with an ellipsis instead of clipping', () => {
  const decls = {};
  for (const rule of rules) {
    if (rule.selectors.includes('.chat-provider-model')) Object.assign(decls, rule.decls);
  }
  assert.equal(decls['text-overflow'], 'ellipsis');
  assert.equal(decls['min-width'], '0');
  assert.equal(decls.overflow, 'hidden');
});
