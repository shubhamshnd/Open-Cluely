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

/* --------------------------------------------------------------------------
 * Round 2: real contrast ratios, font floors, disabled state, placeholder,
 * tooltips, edge margins.
 * ------------------------------------------------------------------------ */

function parseColorParts(color) {
  if (!color) return null;
  let m = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    };
  }
  m = color.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(',').map((s) => parseFloat(s));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }
  return null;
}

function compositeOver(fg, bg) {
  const a = fg.a + bg.a * (1 - fg.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
    g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
    b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
    a,
  };
}

function relLum(c) {
  const f = (v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

function contrastRatio(c1, c2) {
  const l1 = relLum(c1);
  const l2 = relLum(c2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function colorOf(theme, selector, prop, vars) {
  const raw = effective(theme, selector, [prop]);
  return parseColorParts(resolveColor(raw, vars));
}

// Text/background pairs that must hold WCAG AA (>= 4.5:1) in BOTH themes.
// bgLayers are composited inside-out: the element's own surface first, then
// the surface it sits on. An empty bgLayers entry means "no own background":
// the text sits directly on the next layer.
const CONTRAST_PAIRS = [
  { name: 'Ask AI button', fg: ['.action-btn.analyze-btn', 'color'], bg: ['.action-btn.analyze-btn'] },
  { name: 'Screen AI button', fg: ['.action-btn.screen-ai-btn', 'color'], bg: ['.action-btn.screen-ai-btn'] },
  { name: 'Suggest button', fg: ['.action-btn.suggest-btn', 'color'], bg: ['.action-btn.suggest-btn'] },
  { name: 'Notes button', fg: ['.action-btn.notes-btn', 'color'], bg: ['.action-btn.notes-btn'] },
  { name: 'Insights button', fg: ['.action-btn.insights-btn', 'color'], bg: ['.action-btn.insights-btn'] },
  { name: 'Add button', fg: ['.chat-manual-send', 'color'], bg: ['.chat-manual-send'] },
  { name: 'composer placeholder', fg: ['.chat-manual-input::placeholder', 'color'], bg: ['.chat-manual-input'] },
  { name: 'composer text', fg: ['.chat-manual-input', 'color'], bg: ['.chat-manual-input'] },
  { name: 'model label', fg: ['.chat-provider-model', 'color'], bg: ['.chat-header', '.chat-container'] },
  { name: 'monitor live text', fg: ['.monitor-live-text', 'color'], bg: ['.monitor-source-row', '.transcription-monitor'] },
  { name: 'Off status pill', fg: ['.monitor-status-badge', 'color'], bg: ['.monitor-status-badge', '.monitor-source-row', '.transcription-monitor'] },
  { name: 'Idle master pill', fg: ['.monitor-master-state', 'color'], bg: ['.monitor-master-state', '.transcription-monitor'] },
  { name: 'monitor log line', fg: ['.monitor-log-entry', 'color'], bg: ['.monitor-log-entry', '.transcription-monitor'] },
  { name: 'message timestamp', fg: ['.message-time', 'color'], bg: ['.chat-message', '.chat-container'] },
  { name: 'message label', fg: ['.message-label', 'color'], bg: ['.message-label', '.chat-message', '.chat-container'] },
  { name: 'settings helper', fg: ['.settings-helper-text', 'color'], bg: ['.settings-panel'] },
  { name: 'mobile pill', fg: ['.mobile-server-pill', 'color'], bg: ['.mobile-server-pill', '.status-section'] },
  { name: 'screenshot count', fg: ['.screenshot-count', 'color'], bg: ['.screenshot-count', '.status-section'] },
  { name: 'close button glyph', fg: ['.close-app-btn', 'color'], bg: ['.close-app-btn', '.glass-container'] },
  { name: 'toolbar icon', fg: ['.action-btn.settings-btn', 'color'], bg: ['.action-btn.settings-btn', '.glass-container'] },
];

for (const theme of ['light', 'dark']) {
  test(`${theme} theme: key text/background pairs reach WCAG AA 4.5:1`, () => {
    const vars = themeVars(theme);
    const failures = [];
    for (const pair of CONTRAST_PAIRS) {
      const fg = colorOf(theme, pair.fg[0], pair.fg[1], vars);
      if (!fg) {
        failures.push(`${pair.name}: no ${pair.fg[1]} for ${pair.fg[0]}`);
        continue;
      }
      let bg = { r: theme === 'dark' ? 10 : 255, g: theme === 'dark' ? 15 : 255, b: theme === 'dark' ? 26 : 255, a: 1 };
      for (const layerSel of [...pair.bg].reverse()) {
        const layer = colorOf(theme, layerSel, 'background', vars) || colorOf(theme, layerSel, 'background-color', vars);
        if (layer) bg = compositeOver(layer, bg);
      }
      if (bg.a < 1) bg = compositeOver(bg, { r: 255, g: 255, b: 255, a: 1 });
      const text = fg.a < 1 ? compositeOver(fg, bg) : fg;
      const ratio = contrastRatio(text, bg);
      if (ratio < 4.5) failures.push(`${pair.name}: ${ratio.toFixed(2)}:1`);
    }
    assert.deepEqual(failures, [], `low-contrast pairs in ${theme} theme`);
  });
}

// Secondary/status text must be at least 11px (these were 9-10px).
const FONT_FLOOR_SELECTORS = [
  '.monitor-title',
  '.monitor-source-label',
  '.monitor-master-state',
  '.monitor-status-badge',
  '.monitor-live-text',
  '.monitor-log-entry',
  '.message-time',
  '.message-label',
  '.settings-helper-text',
  '.action-btn.analyze-btn',
  '.action-btn.screen-ai-btn',
  '.action-btn.suggest-btn',
  '.action-btn.notes-btn',
  '.action-btn.insights-btn',
  '.chat-provider-model',
];

test('secondary and status text is at least 11px', () => {
  const failures = [];
  for (const selector of FONT_FLOOR_SELECTORS) {
    const raw = effective('dark', selector, ['font-size']);
    const px = raw ? parseFloat(raw) : null;
    if (px === null || px < 11) failures.push(`${selector}: ${raw || 'undeclared'}`);
  }
  assert.deepEqual(failures, [], 'text below the 11px floor');
});

test('disabled buttons stay readable (no opacity washout)', () => {
  for (const selector of ['.action-btn:disabled', '.source-toggle:disabled', '.chat-manual-send:disabled']) {
    const opacity = parseFloat(effective('dark', selector, ['opacity']) || '1');
    assert.ok(opacity >= 0.95, `${selector} opacity ${opacity} washes the label out over the backdrop`);
    const filter = effective('dark', selector, ['filter']) || '';
    assert.match(filter, /saturate/, `${selector} must mute by desaturating, not fading`);
  }
});

const htmlPath = path.join(__dirname, '../src/windows/assistant/renderer.html');
const html = fs.readFileSync(htmlPath, 'utf8');

test('composer placeholder is short enough to never clip', () => {
  const m = html.match(/id="chat-manual-input"[\s\S]*?placeholder="([^"]*)"/);
  assert.ok(m, 'chat-manual-input placeholder missing');
  assert.ok(m[1].length <= 20, `placeholder "${m[1]}" is ${m[1].length} chars; keep it <= 20 so it fits narrow windows`);
});

test('small toolbar and window controls expose tooltips', () => {
  const ids = [
    'close-app-btn',
    'transcription-toggle',
    'source-system-toggle',
    'source-mic-toggle',
    'screenshot-btn',
    'theme-toggle-btn',
    'settings-btn',
    'hide-btn',
    'clear-btn',
  ];
  const missing = [];
  for (const id of ids) {
    const m = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`));
    if (!m || !/title="[^"]+"/.test(m[0])) missing.push(id);
  }
  assert.deepEqual(missing, [], 'buttons without a title tooltip');
});

test('theme toggle keeps its title in sync with the dynamic label', () => {
  const rendererJs = fs.readFileSync(path.join(__dirname, '../src/windows/assistant/renderer.js'), 'utf8');
  const fn = rendererJs.match(/function updateThemeToggleUi\(\) \{[\s\S]*?\n\}/);
  assert.ok(fn, 'updateThemeToggleUi not found');
  assert.ok(/setAttribute\('title', ariaLabel\)/.test(fn[0]), 'title must mirror the dynamic aria-label, not be removed');
});

test('frame controls keep margin from the window edges', () => {
  const handle = [...rules].reverse().find((r) => r.selectors.includes('.drag-handle') && r.decls.padding && /px/.test(r.decls.padding));
  assert.ok(handle, 'drag-handle must pad the close button off the top-right corner');
  const parts = handle.decls.padding.split(/\s+/).map((p) => parseFloat(p));
  const [padTop, padRight] = parts.length > 1 ? parts : [parts[0], parts[0]];
  assert.ok(padTop >= 7 && padRight >= 14, `close button padding too tight: ${handle.decls.padding}`);
  const corner = [...rules].reverse().find((r) => r.selectors.includes('.resize-handle-ne') && r.decls.top);
  assert.ok(corner, 'resize-handle-ne inset rule missing');
  assert.ok(parseFloat(corner.decls.top) >= 3 && parseFloat(corner.decls.right) >= 3, 'corner accent must be inset from the frame');
  const composer = rules.find((r) => r.selectors.includes('.chat-composer') && r.decls['padding-bottom']);
  assert.ok(composer, 'chat-composer bottom padding missing');
  assert.ok(parseFloat(composer.decls['padding-bottom']) >= 8, 'Add button needs >= 8px composer bottom padding');
});
