'use strict';

// Defect (investigated RAN in t_fd2c2e54): the QA run "needed a manual-context
// fallback" after switching AI provider/profile. The live investigation showed
// the renderer transcript buffer DOES persist across a Settings save and a
// provider change (Ask AI still saw the Host transcript). The real loss was
// in the MAIN process: the STT history manager writes transcript lines into
// the ACTIVE provider service's conversationHistory, and a provider switch
// strands that history in the old service (a fresh/reconfigured service for
// the new provider starts empty). Consumers that read the service history
// (answer-question, follow-up email, any getContextString caller) lose the
// transcript. The history belongs to the conversation, not the provider:
// it is carried across the switch.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createGeminiRuntime } = require('../src/main-process/features/assistant/gemini-runtime');

test('conversation history is carried across an AI provider switch', () => {
  const runtime = createGeminiRuntime();
  runtime.setKeys(['fake-gemini-key'], 0);
  runtime.initializeGeminiService('fake-gemini-key', 'gemini-2.5-flash-lite', 'Python');
  const gemini = runtime.getService();
  assert.ok(gemini, 'gemini service exists');
  gemini.addToHistory('user', 'Host: What is the difference between a process and a thread?');
  gemini.addToHistory('assistant', 'Ask AI: A process is independent; a thread shares its memory.');

  runtime.setProviderSettings('bedrock', { region: 'us-east-1', authMode: 'default', modelId: 'us.moonshotai.kimi-k3' });
  runtime.setActiveAiProvider('bedrock');
  runtime.initializeAiService();

  const bedrock = runtime.getService();
  assert.ok(bedrock, 'bedrock service exists');
  assert.deepEqual(
    bedrock.conversationHistory,
    [
      { role: 'user', content: 'Host: What is the difference between a process and a thread?' },
      { role: 'assistant', content: 'Ask AI: A process is independent; a thread shares its memory.' }
    ],
    'the transcript history must follow the conversation across the provider switch'
  );
  assert.match(bedrock.getContextString(), /process and a thread/);
});

test('history carry-over does not overwrite a target that already has history', () => {
  const runtime = createGeminiRuntime();
  runtime.setKeys(['fake-gemini-key'], 0);
  runtime.initializeGeminiService('fake-gemini-key', 'gemini-2.5-flash-lite', 'Python');
  runtime.getService().addToHistory('user', 'Host: gemini-era line');

  // gemini -> ollama (ollama gets the carry-over), add a line there, then
  // ollama -> gemini: gemini still has its own history, which must win.
  runtime.setActiveOllamaModel('llama3.2');
  runtime.setActiveAiProvider('ollama');
  runtime.initializeAiService();
  const ollama = runtime.getService();
  assert.deepEqual(ollama.conversationHistory.map((e) => e.content), ['Host: gemini-era line']);
  ollama.addToHistory('user', 'Host: ollama-era line');

  runtime.setActiveAiProvider('gemini');
  runtime.initializeAiService();
  const geminiAgain = runtime.getService();
  assert.deepEqual(
    geminiAgain.conversationHistory.map((e) => e.content),
    ['Host: gemini-era line'],
    'the provider that already has history keeps it (no interleaving)'
  );
});

test('a service with an empty history is not touched when there is nothing to carry', () => {
  const runtime = createGeminiRuntime();
  runtime.setProviderSettings('bedrock', { region: 'us-east-1', authMode: 'default', modelId: 'us.moonshotai.kimi-k3' });
  runtime.setActiveAiProvider('bedrock');
  runtime.initializeAiService();
  assert.deepEqual(runtime.getService().conversationHistory, []);
});
