'use strict';

// Defect: after an auth error the next Ask AI answered "I'm not sure what
// you're being asked" — the error bubble and other UI/system artifacts were
// sent as conversation context. Error/status/system messages must never reach
// the model: system types are excluded from the context bundle, and the
// streaming placeholder message left behind by a failed AI action is removed
// from the store instead of being fed back as an "AI:" line.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const STORE_URL = '../src/windows/assistant/renderer/features/ai-context/message-store.js';
const BUNDLE_URL = '../src/windows/assistant/renderer/features/ai-context/context-bundle.js';
const CHAT_UI_URL = '../src/windows/assistant/renderer/features/chat/chat-ui-manager.js';

async function loadModules() {
  const [storeModule, bundleModule, chatUiModule] = await Promise.all([
    import(STORE_URL),
    import(BUNDLE_URL),
    import(CHAT_UI_URL)
  ]);
  return {
    createMessageStore: storeModule.createMessageStore,
    buildFilteredAiContextBundle: bundleModule.buildFilteredAiContextBundle,
    createChatUiManager: chatUiModule.createChatUiManager
  };
}

function bundleFor(store, buildFilteredAiContextBundle) {
  return buildFilteredAiContextBundle({
    messages: store.getMessages(),
    isMessageIncludedForAi: (message) => store.isIncludedForAi(message),
    charBudget: 12000,
    emitTruncationLog: false
  });
}

test('system and error messages are excluded from the AI context bundle', async () => {
  const { createMessageStore, buildFilteredAiContextBundle } = await loadModules();
  const store = createMessageStore();
  store.add('voice-system', 'What is the difference between a process and a thread?');
  store.add('system', 'Error: Ask AI failed: The security token included in the request is invalid.');
  store.add('system', 'Listening to host audio...');

  const bundle = bundleFor(store, buildFilteredAiContextBundle);
  assert.match(bundle.contextString, /process and a thread/);
  assert.doesNotMatch(bundle.contextString, /security token|Error:|Listening to host audio/);
  assert.match(bundle.transcriptContext, /Host: What is the difference/);
});

test('messageStore.remove deletes a message (streaming-placeholder cleanup API)', async () => {
  const { createMessageStore } = await loadModules();
  const store = createMessageStore();
  assert.equal(typeof store.remove, 'function', 'messageStore must expose remove(id)');

  const keep = store.add('voice-system', 'real transcript line');
  const junk = store.add('ai-response', '...');
  assert.equal(store.getMessages().length, 2);

  const removed = store.remove(junk.id);
  assert.equal(removed.id, junk.id);
  assert.deepEqual(store.getMessages().map((message) => message.id), [keep.id]);
  assert.equal(store.remove('missing-id'), null);
});

// Minimal DOM stand-ins: chat-ui-manager appends created elements and reads
// scroll metrics. node --test isolates each file, so the global stub is safe.
function createFakeElement() {
  return {
    className: '',
    dataset: {},
    style: {},
    classList: { add: () => {}, toggle: () => {}, contains: () => false },
    children: [],
    innerHTML: '',
    textContent: '',
    appendChild(child) { this.children.push(child); return child; },
    querySelector: () => null,
    remove: () => {}
  };
}

test('a failed AI action leaves no placeholder junk in the next context bundle', async () => {
  globalThis.document = { createElement: () => createFakeElement() };
  const fakeChatMessages = Object.assign(createFakeElement(), {
    scrollHeight: 0,
    clientHeight: 0,
    scrollTop: 0
  });

  const { createMessageStore, buildFilteredAiContextBundle, createChatUiManager } = await loadModules();
  const store = createMessageStore();
  const chatUi = createChatUiManager({
    chatContainer: null,
    chatMessagesElement: fakeChatMessages,
    chatComposer: null,
    chatManualInput: null,
    chatManualSend: null,
    messageStore: store,
    maxChatInputHeight: 88,
    escapeHtml: (value) => String(value || ''),
    updateUi: () => {},
    onMessagesChanged: () => {},
    showFeedback: () => {},
    addMonitorLog: () => {}
  });

  chatUi.addChatMessage('voice-system', 'What is the difference between a process and a thread?');
  // The renderer's stream.start('') opens an ai-response placeholder; the
  // request then fails (auth error) and the catch must discard it.
  const placeholder = chatUi.addChatMessage('ai-response', '...');
  chatUi.addChatMessage('system', 'Error: Ask AI failed: invalid token');
  assert.equal(typeof chatUi.removeChatMessage, 'function', 'chat UI must expose removeChatMessage(id)');
  chatUi.removeChatMessage(placeholder.id);

  const bundle = bundleFor(store, buildFilteredAiContextBundle);
  assert.match(bundle.contextString, /process and a thread/);
  assert.doesNotMatch(bundle.contextString, /AI: \.\.\./, 'placeholder must not be sent as an AI answer');
  assert.doesNotMatch(bundle.contextString, /invalid token|Error:/);
  // The real transcript still counts as context for the follow-up Ask AI.
  assert.ok(bundle.contextString.trim().length > 0);
});

test('renderer error paths discard the stream placeholder', () => {
  const rendererSource = fs.readFileSync(
    path.join(__dirname, '../src/windows/assistant/renderer.js'),
    'utf8'
  );
  const discardCalls = rendererSource.match(/stream\.discard\(\)/g) || [];
  assert.ok(
    discardCalls.length >= 4,
    `expected stream.discard() in askAi/suggest/notes/insights error paths, found ${discardCalls.length}`
  );

  const ipcSource = fs.readFileSync(
    path.join(__dirname, '../src/windows/assistant/renderer/features/listeners/ipc-listeners.js'),
    'utf8'
  );
  const onResult = ipcSource.match(/onAnalysisResult\(\(data\) => \{[\s\S]*?\n    \}\);/);
  assert.ok(onResult, 'onAnalysisResult handler not found');
  assert.match(onResult[0], /\.discard\(/, 'screen-AI error path must discard the placeholder too');
});
