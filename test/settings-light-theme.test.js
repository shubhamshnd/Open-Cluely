'use strict';

// Regression: the Settings panel background is near-opaque white
// (--glass-settings-bg) while the base .settings-* rules use white text for the
// dark glass look. Light theme must override them with dark text, or labels,
// inputs and the close icon render white-on-white.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'windows', 'assistant', 'styles.css'),
  'utf8'
);

function lightRuleBody(selectorFragment) {
  const re = new RegExp(`body:not\\(\\.theme-dark\\)[^{]*${selectorFragment}[^{]*\\{([^}]*)\\}`, 'g');
  const bodies = [];
  let m;
  while ((m = re.exec(css))) bodies.push(m[1]);
  return bodies.join('\n');
}

function isWhiteish(color) {
  return /rgba?\(\s*255\s*,\s*255\s*,\s*255/.test(color) || /#fff(fff)?\b/i.test(color) || /\bwhite\b/.test(color);
}

test('settings panel background is light, so light theme needs its own text colors', () => {
  assert.match(css, /--glass-settings-bg:\s*rgba\(255,\s*255,\s*255,\s*0\.9\d?\)/);
});

for (const selector of ['\\.settings-label', '\\.settings-title', '\\.settings-input', '#close-settings']) {
  test(`light theme sets a non-white text color for ${selector}`, () => {
    const body = lightRuleBody(selector);
    const colors = [...body.matchAll(/(?:^|[;\s])color:\s*([^;]+);/g)].map((m) => m[1].trim());
    assert.ok(colors.length > 0, `no light-theme color rule for ${selector}`);
    for (const color of colors) {
      assert.ok(!isWhiteish(color), `${selector} light-theme color is white-ish: ${color}`);
    }
  });
}
