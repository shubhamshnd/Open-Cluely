'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWindowController } = require('../src/main-process/features/window/window-controller');

test('shortcut dispatch ignores inherited object properties without throwing', () => {
  const controller = createWindowController({});
  for (const id of ['__proto__', 'constructor', 'toString', 'bogusAction']) {
    assert.equal(controller.runShortcutAction(id), false);
  }
});
