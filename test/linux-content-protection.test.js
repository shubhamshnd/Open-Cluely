'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('Linux content-protection warning prints once per process', () => {
  const modulePath = require.resolve('../src/main-process/startup-logging');
  delete require.cache[modulePath];
  const { warnLinuxContentProtectionOnce } = require(modulePath);

  const lines = [];
  const logger = { warn: (line) => lines.push(line) };

  assert.equal(warnLinuxContentProtectionOnce('win32', logger), false);
  assert.equal(warnLinuxContentProtectionOnce('darwin', logger), false);
  assert.equal(lines.length, 0);

  // Startup, then window creation (twice): only the first call logs.
  assert.equal(warnLinuxContentProtectionOnce('linux', logger), true);
  assert.equal(warnLinuxContentProtectionOnce('linux', logger), false);
  assert.equal(warnLinuxContentProtectionOnce('linux', logger), false);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /no effect on Linux/);
});
