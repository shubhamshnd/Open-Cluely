'use strict';

// The file: protocol handler must only serve paths inside the app's own src/
// directory. Anything else — the app-state key store, system files, traversal
// tricks — is rejected.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');

test('file: protocol guard allows app src files and rejects everything else', () => {
  const { resolveAllowedFilePath } = require('../src/windows/assistant/file-protocol-guard.js');
  const srcRoot = path.join(REPO_ROOT, 'src');

  // Allowed: the renderer bundle itself and the audio worklet.
  assert.equal(
    resolveAllowedFilePath(`file://${srcRoot}/windows/assistant/styles.css`, srcRoot),
    path.join(srcRoot, 'windows/assistant/styles.css')
  );
  assert.equal(
    resolveAllowedFilePath(`file://${srcRoot}/windows/assistant/pcm-capture-worklet.js`, srcRoot),
    path.join(srcRoot, 'windows/assistant/pcm-capture-worklet.js')
  );

  // Rejected: the key store, system files, traversal, prefix confusion.
  assert.equal(resolveAllowedFilePath(`file://${REPO_ROOT}/cache/app-state.json`, srcRoot), null);
  assert.equal(resolveAllowedFilePath('file:///etc/hostname', srcRoot), null);
  assert.equal(
    resolveAllowedFilePath(`file://${srcRoot}/../cache/app-state.json`, srcRoot),
    null,
    'dot-dot traversal must not escape src/'
  );
  assert.equal(
    resolveAllowedFilePath(`file://${srcRoot}/..%2f..%2fetc%2fpasswd`, srcRoot),
    null,
    'encoded traversal must not escape src/'
  );
  assert.equal(
    resolveAllowedFilePath(`file://${srcRoot}evil/x.png`, srcRoot),
    null,
    'a sibling sharing the src prefix is not inside src/'
  );

  // Windows drive-letter form: /C:/app/src/x → C:/app/src/x.
  const winSrc = 'C:\\app\\src';
  assert.equal(
    resolveAllowedFilePath('file:///C:/app/src/windows/assistant/styles.css', winSrc, 'win32'),
    'C:\\app\\src\\windows\\assistant\\styles.css'
  );
  assert.equal(resolveAllowedFilePath('file:///C:/Users/me/cache/app-state.json', winSrc, 'win32'), null);
});
