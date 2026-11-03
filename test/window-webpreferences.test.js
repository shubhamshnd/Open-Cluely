'use strict';

// The assistant window loads a local file:// page with no insecure
// subresources, so allowRunningInsecureContent has no legitimate use and only
// widens the attack surface around stored secrets.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ASSISTANT_WINDOW = fs.readFileSync(
  path.join(__dirname, '../src/windows/assistant/window.js'), 'utf8'
);

test('the assistant window does not enable allowRunningInsecureContent', () => {
  assert.ok(
    !ASSISTANT_WINDOW.includes('allowRunningInsecureContent: true'),
    'window.js webPreferences must not set allowRunningInsecureContent: true'
  );
});
