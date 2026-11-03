'use strict';

// Regression guard: no TLS-defeating or web-security-defeating Chromium
// switches may be appended at startup (they expose provider API keys to MITM
// forgery and disable renderer origin isolation).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const START_APPLICATION = fs.readFileSync(
  path.join(__dirname, '../src/main-process/start-application.js'), 'utf8'
);

test('no certificate/web-security defeating Chromium switches are appended', () => {
  for (const flag of ['ignore-certificate-errors', 'disable-web-security', 'allow-running-insecure-content']) {
    assert.ok(
      !START_APPLICATION.includes(`appendSwitch('${flag}'`),
      `start-application.js must not appendSwitch('${flag}')`
    );
  }
});
