'use strict';

// STT start gate: the "AssemblyAI API key missing" block applies only when the
// active STT provider is AssemblyAI. With Amazon Transcribe selected, Start is
// allowed and credential problems surface through the normal error path.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GATE_MODULE_URL = '../src/windows/assistant/renderer/features/transcription/stt-start-gate.js';
const rendererSource = fs.readFileSync(
  path.join(__dirname, '../src/windows/assistant/renderer.js'),
  'utf8'
);

async function loadGate() {
  return import(GATE_MODULE_URL);
}

test('normalizeSttProvider defaults unknown and missing values to assemblyai', async () => {
  const { normalizeSttProvider } = await loadGate();
  assert.equal(normalizeSttProvider('transcribe'), 'transcribe');
  assert.equal(normalizeSttProvider('assemblyai'), 'assemblyai');
  assert.equal(normalizeSttProvider('something-else'), 'assemblyai');
  assert.equal(normalizeSttProvider(''), 'assemblyai');
  assert.equal(normalizeSttProvider(null), 'assemblyai');
  assert.equal(normalizeSttProvider(undefined), 'assemblyai');
});

test('assemblyai provider without a key blocks the start with the Settings hint', async () => {
  const { canStartTranscription, ASSEMBLYAI_KEY_MISSING_MESSAGE } = await loadGate();
  const gate = canStartTranscription({ sttProvider: 'assemblyai', hasAssemblyAiApiKey: false });
  assert.equal(gate.allowed, false);
  assert.equal(gate.reason, 'assemblyai-key-missing');
  assert.equal(gate.message, ASSEMBLYAI_KEY_MISSING_MESSAGE);
  assert.equal(gate.message, 'AssemblyAI API key missing. Add it in Settings.');
});

test('assemblyai provider with a key allows the start', async () => {
  const { canStartTranscription } = await loadGate();
  assert.equal(canStartTranscription({ sttProvider: 'assemblyai', hasAssemblyAiApiKey: true }).allowed, true);
});

test('transcribe provider allows the start without any AssemblyAI key', async () => {
  const { canStartTranscription } = await loadGate();
  assert.equal(canStartTranscription({ sttProvider: 'transcribe', hasAssemblyAiApiKey: false }).allowed, true);
  assert.equal(canStartTranscription({ sttProvider: 'transcribe', hasAssemblyAiApiKey: true }).allowed, true);
});

// --- renderer wiring: these assertions fail if the gate is reverted ---------

test('renderer syncs the active STT provider from settings', () => {
  assert.match(rendererSource, /activeSttProvider = normalizeSttProvider\(settings\.sttProvider\)/);
});

test('toggleMasterTranscription gates through canStartTranscription, not the raw key flag', () => {
  const body = rendererSource.match(/async function toggleMasterTranscription\(\) \{[\s\S]*?\n\}/)[0];
  assert.match(body, /canStartTranscription\(\{/);
  assert.match(body, /sttProvider: activeSttProvider/);
  assert.doesNotMatch(body, /if \(!hasAssemblyAiApiKeyConfigured\)/);
});

test('updateUI derives canRunTranscription through canStartTranscription', () => {
  const body = rendererSource.match(/function updateUI\(\) \{[\s\S]*?\n\}/)[0];
  assert.match(body, /const canRunTranscription = canStartTranscription\(\{/);
  assert.doesNotMatch(body, /const canRunTranscription = hasAssemblyAiApiKeyConfigured;/);
});
