'use strict';

// Amazon Transcribe custom vocabulary: phrase hyphenation, create-vs-update,
// READY/FAILED polling, timeout, permission errors, and the settings IPC
// handler (fake clients throughout — no network, no real ~/.aws).

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CreateVocabularyCommand,
  UpdateVocabularyCommand,
  GetVocabularyCommand
} = require('@aws-sdk/client-transcribe');

const {
  createOrUpdateVocabulary,
  vocabularyNameForLanguage,
  phrasesFromText
} = require('../src/services/stt/transcribe-vocabulary.js');
const { registerSettingsIpc } = require('../src/main-process/features/settings/ipc.js');

function createFakeTranscribeClient({ createError = null, getStates = ['READY'] } = {}) {
  const sent = [];
  const client = {
    send: async (command) => {
      sent.push(command);
      if (command instanceof CreateVocabularyCommand) {
        if (createError) {
          throw createError;
        }
        return {};
      }
      if (command instanceof UpdateVocabularyCommand) {
        return {};
      }
      if (command instanceof GetVocabularyCommand) {
        const state = getStates.length > 1 ? getStates.shift() : getStates[0];
        return {
          VocabularyState: state,
          FailureReason: state === 'FAILED' ? 'phrase "bad word" is invalid' : undefined
        };
      }
      throw new Error(`unexpected command ${command?.constructor?.name}`);
    }
  };
  return { client, sent };
}

test('phrasesFromText: one per line, spaces become hyphens, exact-match dedupe', () => {
  assert.deepEqual(phrasesFromText('REST API\n  GraphQL  \nREST API\nGraphQL\n\nKimi K3\n'), [
    'REST-API',
    'GraphQL',
    'Kimi-K3'
  ]);
  assert.deepEqual(phrasesFromText(''), []);
  assert.deepEqual(phrasesFromText(null), []);
});

test('vocabularyNameForLanguage names open-cluely-<language>', () => {
  assert.equal(vocabularyNameForLanguage('en-IN'), 'open-cluely-en-IN');
  assert.equal(vocabularyNameForLanguage('klingon'), 'open-cluely-en-US');
});

test('create then poll until READY', async () => {
  const { client, sent } = createFakeTranscribeClient({ getStates: ['PENDING', 'READY'] });
  const result = await createOrUpdateVocabulary({
    client,
    language: 'en-US',
    phrasesText: 'REST API\nGraphQL',
    pollIntervalMs: 1
  });
  assert.deepEqual(result, { success: true, vocabularyName: 'open-cluely-en-US', state: 'READY' });

  assert.ok(sent[0] instanceof CreateVocabularyCommand);
  assert.equal(sent[0].input.VocabularyName, 'open-cluely-en-US');
  assert.equal(sent[0].input.LanguageCode, 'en-US');
  assert.deepEqual(sent[0].input.Phrases, ['REST-API', 'GraphQL']);
  assert.ok(sent.slice(1).every((command) => command instanceof GetVocabularyCommand));
  assert.equal(sent.length, 3);
});

test('an existing vocabulary (ConflictException) is updated instead', async () => {
  const conflict = new Error('The vocabulary already exists');
  conflict.name = 'ConflictException';
  const { client, sent } = createFakeTranscribeClient({ createError: conflict });
  const result = await createOrUpdateVocabulary({
    client,
    language: 'hi-IN',
    phrasesText: 'AnkerCloud',
    pollIntervalMs: 1
  });
  assert.equal(result.success, true);
  assert.equal(result.vocabularyName, 'open-cluely-hi-IN');
  assert.ok(sent[0] instanceof CreateVocabularyCommand);
  assert.ok(sent[1] instanceof UpdateVocabularyCommand);
  assert.equal(sent[1].input.VocabularyName, 'open-cluely-hi-IN');
});

test('FAILED state surfaces the AWS failure reason', async () => {
  const { client } = createFakeTranscribeClient({ getStates: ['FAILED'] });
  const result = await createOrUpdateVocabulary({
    client,
    language: 'en-US',
    phrasesText: 'bad word',
    pollIntervalMs: 1
  });
  assert.equal(result.success, false);
  assert.equal(result.state, 'FAILED');
  assert.match(result.error, /bad word/);
});

test('a vocabulary that never becomes READY times out with a clear message', async () => {
  const { client, sent } = createFakeTranscribeClient({ getStates: ['PENDING'] });
  const result = await createOrUpdateVocabulary({
    client,
    language: 'en-US',
    phrasesText: 'GraphQL',
    pollIntervalMs: 1,
    timeoutMs: 25
  });
  assert.equal(result.success, false);
  assert.match(result.error, /still PENDING/);
  assert.ok(sent.length >= 2);
});

test('permission denied on create returns the AWS message and never updates', async () => {
  const denied = new Error('User is not authorized to perform transcribe:CreateVocabulary');
  denied.name = 'AccessDeniedException';
  const { client, sent } = createFakeTranscribeClient({ createError: denied });
  const result = await createOrUpdateVocabulary({
    client,
    language: 'en-US',
    phrasesText: 'GraphQL',
    pollIntervalMs: 1
  });
  assert.equal(result.success, false);
  assert.match(result.error, /transcribe:CreateVocabulary/);
  assert.equal(sent.length, 1, 'no update or poll after a hard create error');
});

test('empty words list is rejected before any AWS call', async () => {
  const { client, sent } = createFakeTranscribeClient();
  const result = await createOrUpdateVocabulary({ client, language: 'en-US', phrasesText: '  \n\n' });
  assert.equal(result.success, false);
  assert.match(result.error, /at least one custom word/);
  assert.equal(sent.length, 0);
});

// ---------------------------------------------------------------------------
// Settings IPC handler: auth resolution + vocabulary name persistence.
// ---------------------------------------------------------------------------
function createSettingsHarness({ appState = {}, vocabResult } = {}) {
  const handlers = new Map();
  const ipcMain = {
    handle: (channel, fn) => handlers.set(channel, fn),
    on: () => {}
  };
  const savedStates = [];
  let currentState = appState;
  const fakeVocab = createFakeTranscribeClient({});
  registerSettingsIpc({
    ipcMain,
    app: { isPackaged: false, getAppPath: () => '/unused', getPath: () => '/unused-user-data' },
    getAppEnvironment: () => ({}),
    getAppState: () => currentState,
    setAppState: (next) => {
      currentState = next;
    },
    getAppStatePath: () => '/tmp/app-state.json',
    saveAppState: (_app, partial) => {
      savedStates.push(partial);
      currentState = { ...currentState, ...partial };
      return currentState;
    },
    geminiRuntime: {
      getActiveAiProvider: () => 'bedrock',
      getActiveGeminiModel: () => 'x',
      getGeminiModels: () => ['x'],
      getDefaultGeminiModel: () => 'x',
      getAiProviders: () => ['bedrock'],
      getActiveModelName: () => 'x',
      isReady: () => true,
      getProviderSettings: () => ({}),
      getActiveOllamaBaseUrl: () => '',
      getActiveOllamaModel: () => '',
      getDefaultOllamaBaseUrl: () => '',
      getDefaultOllamaModel: () => '',
      getActiveProgrammingLanguage: () => 'Python',
      getProgrammingLanguages: () => ['Python'],
      getDefaultProgrammingLanguage: () => 'Python'
    },
    windowController: {
      getShortcutActionIds: () => [],
      getWindowOpacityLevel: () => 10
    },
    getAssemblyAiSpeechModel: () => 'universal-streaming-english',
    setAssemblyAiSpeechModel: (model) => model,
    keyboardShortcuts: [],
    assemblyAiSpeechModels: ['universal-streaming-english'],
    defaultAssemblyAiSpeechModel: 'universal-streaming-english',
    createTranscribeClient: (config) => {
      fakeVocab.config = config;
      return fakeVocab.client;
    }
  });
  return { handlers, savedStates, fakeVocab, getState: () => currentState };
}

test('ipc: vocabulary save creates, polls and persists the vocabulary name', async () => {
  const { handlers, savedStates, fakeVocab, getState } = createSettingsHarness({
    appState: { awsAuthMode: 'default' }
  });
  const handler = handlers.get('transcribe-vocabulary-save');
  const result = await handler({}, {
    language: 'en-IN',
    region: 'eu-west-1',
    phrasesText: 'REST API\nGroww'
  });

  assert.equal(result.success, true);
  assert.equal(result.vocabularyName, 'open-cluely-en-IN');
  assert.equal(fakeVocab.config.region, 'eu-west-1');
  assert.equal(fakeVocab.config.credentials, undefined, 'default chain attaches no credentials');
  assert.deepEqual(savedStates, [{ transcribeVocabularyName: 'open-cluely-en-IN' }]);
  assert.equal(getState().transcribeVocabularyName, 'open-cluely-en-IN');
});

test('ipc: Bedrock API key mode is rejected for vocabulary creation before any AWS call', async () => {
  const { handlers, fakeVocab, savedStates } = createSettingsHarness({
    appState: { awsAuthMode: 'apiKey', bedrockApiKey: 'fake-bedrock-key' }
  });
  const result = await handlers.get('transcribe-vocabulary-save')({}, {
    language: 'en-US',
    phrasesText: 'GraphQL'
  });
  assert.equal(result.success, false);
  assert.match(result.error, /cannot be used for Amazon Transcribe/);
  assert.equal(fakeVocab.sent.length, 0);
  assert.equal(savedStates.length, 0);
});

test('ipc: a Transcribe-only profile override rescues vocabulary creation from a shared apiKey mode', async () => {
  // The shared block is a Bedrock API key (unusable for Transcribe), but the
  // split gives Transcribe its own profile: creation must go through with
  // credentials from fromIni({ profile: 'transcribe-profile' }), proving per-purpose
  // isolation at the IPC layer. The provider is lazy — ~/.aws is never read.
  const { handlers, fakeVocab, savedStates } = createSettingsHarness({
    appState: {
      awsAuthMode: 'apiKey',
      bedrockApiKey: 'fake-...key',
      transcribeAuthMode: 'profile',
      transcribeAwsProfile: 'transcribe-profile'
    }
  });
  const result = await handlers.get('transcribe-vocabulary-save')({}, {
    language: 'en-US',
    phrasesText: 'GraphQL'
  });
  assert.equal(result.success, true);
  assert.equal(typeof fakeVocab.config.credentials, 'function', 'profile mode attaches a lazy credential provider');
  assert.deepEqual(savedStates, [{ transcribeVocabularyName: 'open-cluely-en-US' }]);
});

test('ipc: payload-level override fields win over stored ones, masked secrets resolve against stored', async () => {
  const storedSecret = 'fakeStoredTranscribeSecret0000';
  const { handlers, fakeVocab } = createSettingsHarness({
    appState: {
      awsAuthMode: 'default',
      transcribeAuthMode: 'keys',
      transcribeAwsAccessKeyId: 'AKIAFAKESTORED00000',
      transcribeAwsSecretAccessKey: storedSecret
    }
  });
  // The form echoes the masked secret back: resolution must keep the stored
  // one, and the static credentials object must carry it (functions aren't
  // inspectable, but static keys are).
  const { maskSecretValue } = require('../src/services/state/secret-masking.js');
  const result = await handlers.get('transcribe-vocabulary-save')({}, {
    language: 'en-US',
    phrasesText: 'GraphQL',
    transcribeAuthMode: 'keys',
    transcribeAwsAccessKeyId: maskSecretValue('AKIAFAKESTORED00000'),
    transcribeAwsSecretAccessKey: maskSecretValue(storedSecret),
    transcribeAwsSessionToken: ''
  });
  assert.equal(result.success, true);
  assert.deepEqual(fakeVocab.config.credentials, {
    accessKeyId: 'AKIAFAKESTORED00000',
    secretAccessKey: storedSecret
  }, 'masked echo resolves to the stored split keys');
});
