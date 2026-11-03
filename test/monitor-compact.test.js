'use strict';

// Defect: at 900x400 the transcription monitor took most of the height and
// the answer was clipped. The monitor is now compact when idle — a single
// status line — expanding to its full panel only while a source is active
// (or after a click). No information is removed; the window's default size
// and shortcuts are untouched.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function loadResolver() {
  return import('../src/windows/assistant/renderer/features/transcription/transcription-manager.js');
}

test('monitor expands automatically while any source is active, connecting or in error', async () => {
  const { resolveMonitorExpanded } = await loadResolver();
  assert.equal(resolveMonitorExpanded({ sourceStatuses: { system: 'off', mic: 'off' } }), false);
  assert.equal(resolveMonitorExpanded({ sourceStatuses: { system: 'listening', mic: 'off' } }), true);
  assert.equal(resolveMonitorExpanded({ sourceStatuses: { system: 'off', mic: 'connecting' } }), true);
  assert.equal(resolveMonitorExpanded({ sourceStatuses: { system: 'error', mic: 'off' } }), true);
});

test('the user click pins expansion until the next click, and live activity re-engages auto', async () => {
  const { resolveMonitorExpanded } = await loadResolver();
  assert.equal(resolveMonitorExpanded({ sourceStatuses: { system: 'off', mic: 'off' }, userOverride: true }), true);
  assert.equal(resolveMonitorExpanded({ sourceStatuses: { system: 'listening', mic: 'off' }, userOverride: false }), false);
  // null = automatic: activity decides (a fresh live source is never hidden).
  assert.equal(resolveMonitorExpanded({ sourceStatuses: { system: 'listening', mic: 'off' }, userOverride: null }), true);
});

test('styles collapse the monitor details in compact mode', () => {
  const css = fs.readFileSync(path.join(__dirname, '../src/windows/assistant/styles.css'), 'utf8');
  const compactRule = css.match(/\.transcription-monitor\.compact \.monitor-details \{[^}]*\}/);
  assert.ok(compactRule, 'missing compact rule for .monitor-details');
  assert.match(compactRule[0], /display:\s*none/);
});

test('the monitor starts compact and the header is an accessible expander', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/windows/assistant/renderer.html'), 'utf8');
  const monitor = html.match(/<div id="transcription-monitor"[^>]*>/);
  assert.ok(monitor, 'transcription-monitor element missing');
  assert.match(monitor[0], /\bcompact\b/, 'monitor must start compact (idle default)');

  const header = html.match(/<div\s[^>]*id="monitor-header"[^>]*>/);
  assert.ok(header, 'monitor-header element missing');
  assert.match(header[0], /role="button"/);
  assert.match(header[0], /tabindex="0"/);
  assert.match(header[0], /aria-expanded="false"/);
  assert.match(header[0], /aria-controls="monitor-details"/);
  assert.match(header[0], /title="[^"]+"/, 'header needs a tooltip');
  assert.ok(html.includes('id="monitor-details"'), 'details region exists for aria-controls');
});

test('renderer wires the header toggle and the manager owns the state', () => {
  const rendererSource = fs.readFileSync(path.join(__dirname, '../src/windows/assistant/renderer.js'), 'utf8');
  assert.match(rendererSource, /getElementById\('monitor-header'\)/);
  assert.match(rendererSource, /getElementById\('transcription-monitor'\)/);
  assert.match(rendererSource, /toggleMonitorExpanded\(\)/);

  const managerSource = fs.readFileSync(
    path.join(__dirname, '../src/windows/assistant/renderer/features/transcription/transcription-manager.js'),
    'utf8'
  );
  assert.match(managerSource, /toggleMonitorExpanded/);
  assert.match(managerSource, /classList\.toggle\('compact', !expanded\)/);
  assert.match(managerSource, /setAttribute\('aria-expanded'/);
});

test('window sizing presets and minimums are untouched', () => {
  const rendererSource = fs.readFileSync(path.join(__dirname, '../src/windows/assistant/renderer.js'), 'utf8');
  assert.match(rendererSource, /const MIN_WINDOW_WIDTH = 600;/);
  assert.match(rendererSource, /const MIN_WINDOW_HEIGHT = 380;/);
});
