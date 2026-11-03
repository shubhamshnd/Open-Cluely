'use strict';

// Secret masking for the Settings IPC surface: get-settings must never send a
// stored key to the renderer in cleartext (only a masked bullets+last4 form),
// and save-settings / list-provider-models / transcribe-vocabulary-save must
// treat a blank or still-masked field as "keep the stored value" so the
// no-touch Settings round trip behaves exactly as before.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MASK_BULLETS,
  maskSecretValue,
  maskSecretList,
  resolveSecretOnSave,
  resolveSecretListOnSave
} = require('../src/services/state/secret-masking.js');
const { registerSettingsIpc } = require('../src/main-process/features/settings/ipc.js');

const FAKE_GEMINI_KEY_1 = 'FAKE-GEMINI-KEY-0001abcd';
const FAKE_GEMINI_KEY_2 = 'FAKE-GEMINI-KEY-0002efgh';
const FAKE_ASSEMBLY_KEY = 'FAKE-ASSEMBLYAI-KEY-1234wxyz';
const FAKE_OPENAI_KEY = 'sk-fake-openai-key-9999';
const FAKE_AWS_ACCESS_KEY = 'AKIAFAKEKEY0000000';
const FAKE_AWS_SECRET = 'fakeSecretKeyfakeSecretKeyfakeSec';
const FAKE_AWS_TOKEN = 'FQoGZXIvYXdzEfakeSessionTokenfakeSessionToken';
const FAKE_BEDROCK_KEY = 'fake-bedrock-api-key-7777';

// ---------------------------------------------------------------------------
// Pure masking helpers
// ---------------------------------------------------------------------------

test('maskSecretValue: empty stays empty, long secrets keep only their last 4 chars', () => {
  assert.equal(maskSecretValue(''), '');
  assert.equal(maskSecretValue(null), '');
  assert.equal(maskSecretValue(undefined), '');
  assert.equal(maskSecretValue(FAKE_OPENAI_KEY), `${MASK_BULLETS}9999`);
  assert.ok(!maskSecretValue(FAKE_OPENAI_KEY).includes('fake'), 'no cleartext fragment survives');
});

test('maskSecretValue: secrets of 4 chars or fewer are fully hidden', () => {
  const masked = maskSecretValue('abcd');
  assert.equal(masked, MASK_BULLETS);
  assert.ok(!masked.includes('abcd'));
});

test('maskSecretList: every comma-separated key is masked individually', () => {
  const masked = maskSecretList(`${FAKE_GEMINI_KEY_1}, ${FAKE_GEMINI_KEY_2}`);
  assert.equal(masked, `${MASK_BULLETS}abcd, ${MASK_BULLETS}efgh`);
  assert.equal(maskSecretList(''), '');
});

test('resolveSecretOnSave: blank or masked-echo keeps the stored secret, typed replaces it', () => {
  assert.equal(resolveSecretOnSave('', FAKE_OPENAI_KEY), FAKE_OPENAI_KEY, 'blank keeps old key');
  assert.equal(resolveSecretOnSave('   ', FAKE_OPENAI_KEY), FAKE_OPENAI_KEY, 'whitespace keeps old key');
  assert.equal(resolveSecretOnSave(maskSecretValue(FAKE_OPENAI_KEY), FAKE_OPENAI_KEY), FAKE_OPENAI_KEY, 'untouched masked echo keeps old key');
  assert.equal(resolveSecretOnSave('sk-brand-new-key-5555', FAKE_OPENAI_KEY), 'sk-brand-new-key-5555', 'typed value replaces');
  assert.equal(resolveSecretOnSave('', ''), '', 'blank with nothing stored stays blank');
  // A masked fragment must never be persisted as a literal key.
  assert.equal(resolveSecretOnSave(`${MASK_BULLETS}9999-extra`, FAKE_OPENAI_KEY), FAKE_OPENAI_KEY);
});

test('resolveSecretListOnSave: blank keeps the list; masked segments map back; typed appends merge', () => {
  const stored = `${FAKE_GEMINI_KEY_1},${FAKE_GEMINI_KEY_2}`;
  assert.equal(resolveSecretListOnSave('', stored), stored, 'blank keeps the stored list');
  assert.equal(
    resolveSecretListOnSave(maskSecretList(stored), stored),
    stored,
    'untouched masked list keeps every stored key'
  );
  // User appends a new key after the masked echo: stored keys survive, new key is added.
  const appended = resolveSecretListOnSave(`${maskSecretList(stored)}, FAKE-GEMINI-KEY-0003ijkl`, stored);
  assert.deepEqual(appended.split(','), [FAKE_GEMINI_KEY_1, FAKE_GEMINI_KEY_2, 'FAKE-GEMINI-KEY-0003ijkl']);
  // A full retype replaces the list.
  assert.equal(resolveSecretListOnSave('FAKE-ONLY-KEY-zzzz', stored), 'FAKE-ONLY-KEY-zzzz');
});

// ---------------------------------------------------------------------------
// Settings IPC harness
// ---------------------------------------------------------------------------
function createSettingsHarness({ appState = {} } = {}) {
  const handlers = new Map();
  const ipcMain = {
    handle: (channel, fn) => handlers.set(channel, fn),
    on: () => {}
  };
  const savedPartials = [];
  let currentState = appState;
  const providerSettings = {
    openai: { apiKey: appState.openaiApiKey || '', modelName: '' },
    anthropic: { apiKey: appState.anthropicApiKey || '', modelName: '' },
    bedrock: {
      region: '',
      authMode: '',
      profile: '',
      accessKeyId: '',
      secretAccessKey: '',
      sessionToken: '',
      apiKey: '',
      modelId: ''
    }
  };
  const geminiRuntime = {
    getActiveAiProvider: () => 'openai',
    getActiveGeminiModel: () => 'gemini-x',
    getGeminiModels: () => ['gemini-x'],
    getDefaultGeminiModel: () => 'gemini-x',
    getAiProviders: () => ['gemini', 'openai', 'anthropic', 'bedrock', 'ollama'],
    getActiveModelName: () => 'gpt-x',
    isReady: () => true,
    getProviderSettings: (name) => providerSettings[name] || null,
    setProviderSettings: (name, values) => {
      Object.assign(providerSettings[name], values);
      return { ...providerSettings[name] };
    },
    getActiveOllamaBaseUrl: () => '',
    getActiveOllamaModel: () => '',
    getDefaultOllamaBaseUrl: () => '',
    getDefaultOllamaModel: () => '',
    getActiveProgrammingLanguage: () => 'Python',
    getProgrammingLanguages: () => ['Python'],
    getDefaultProgrammingLanguage: () => 'Python',
    setActiveAiProvider: (name) => name,
    setActiveGeminiModel: (name) => name,
    setActiveOllamaBaseUrl: (value) => value,
    setActiveOllamaModel: (value) => value,
    setProviderFallback: (list) => list,
    setActiveProgrammingLanguage: (value) => value,
    setKeys: (keys) => ({ geminiApiKeys: [], activeApiKeyIndex: 0, activeApiKey: '' }),
    initializeGeminiService: () => null,
    initializeAiService: () => null
  };
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
      savedPartials.push(partial);
      currentState = { ...currentState, ...partial };
      return currentState;
    },
    geminiRuntime,
    windowController: {
      getShortcutActionIds: () => [],
      getWindowOpacityLevel: () => 10,
      setWindowOpacityLevel: (value) => value
    },
    getAssemblyAiSpeechModel: () => 'universal-streaming-english',
    setAssemblyAiSpeechModel: (model) => model,
    keyboardShortcuts: [],
    assemblyAiSpeechModels: ['universal-streaming-english'],
    defaultAssemblyAiSpeechModel: 'universal-streaming-english'
  });
  return { handlers, savedPartials, getState: () => currentState };
}

const FULL_STATE = {
  geminiApiKey: `${FAKE_GEMINI_KEY_1},${FAKE_GEMINI_KEY_2}`,
  assemblyAiApiKey: FAKE_ASSEMBLY_KEY,
  openaiApiKey: FAKE_OPENAI_KEY,
  anthropicApiKey: 'sk-ant-fake-key-0000',
  awsAuthMode: 'keys',
  awsAccessKeyId: FAKE_AWS_ACCESS_KEY,
  awsSecretAccessKey: FAKE_AWS_SECRET,
  awsSessionToken: FAKE_AWS_TOKEN,
  bedrockApiKey: FAKE_BEDROCK_KEY
};

const ALL_FAKE_SECRETS = [
  FAKE_GEMINI_KEY_1,
  FAKE_GEMINI_KEY_2,
  FAKE_ASSEMBLY_KEY,
  FAKE_OPENAI_KEY,
  'sk-ant-fake-key-0000',
  FAKE_AWS_ACCESS_KEY,
  FAKE_AWS_SECRET,
  FAKE_AWS_TOKEN,
  FAKE_BEDROCK_KEY
];

test('get-settings never returns a stored secret in cleartext', async () => {
  const { handlers } = createSettingsHarness({ appState: { ...FULL_STATE } });
  const settings = await handlers.get('get-settings')({});

  const serialized = JSON.stringify(settings);
  for (const secret of ALL_FAKE_SECRETS) {
    assert.ok(!serialized.includes(secret), `get-settings payload must not contain a stored secret (${secret.slice(0, 6)}…)`);
  }

  // Masked forms keep the last 4 chars so the user can recognise the key.
  assert.equal(settings.geminiApiKey, `${MASK_BULLETS}abcd, ${MASK_BULLETS}efgh`);
  assert.equal(settings.assemblyAiApiKey, `${MASK_BULLETS}wxyz`);
  assert.equal(settings.openaiApiKey, `${MASK_BULLETS}9999`);
  assert.equal(settings.awsAccessKeyId, `${MASK_BULLETS}0000`);
  assert.equal(settings.awsSecretAccessKey, `${MASK_BULLETS}eSec`);
  assert.equal(settings.awsSessionToken, `${MASK_BULLETS}oken`);
  assert.equal(settings.bedrockApiKey, `${MASK_BULLETS}7777`);

  // The "configured" flags the renderer actually needs still work.
  assert.equal(settings.hasGeminiApiKeys, true);
  assert.equal(settings.hasAssemblyAiApiKey, true);
});

test('get-settings with no stored secrets returns empty fields, not bullets', async () => {
  const { handlers } = createSettingsHarness({ appState: {} });
  const settings = await handlers.get('get-settings')({});
  assert.equal(settings.geminiApiKey, '');
  assert.equal(settings.assemblyAiApiKey, '');
  assert.equal(settings.awsAccessKeyId, '');
  assert.equal(settings.hasGeminiApiKeys, false);
  assert.equal(settings.hasAssemblyAiApiKey, false);
});

function baseSavePayload(overrides = {}) {
  return {
    aiProvider: 'openai',
    geminiApiKey: '',
    assemblyAiApiKey: '',
    geminiModel: 'gemini-x',
    openaiApiKey: '',
    anthropicApiKey: '',
    awsAuthMode: 'keys',
    awsAccessKeyId: '',
    awsSecretAccessKey: '',
    awsSessionToken: '',
    bedrockApiKey: '',
    sttProvider: 'assemblyai',
    transcribeLanguage: 'en-US',
    ...overrides
  };
}

test('save-settings keeps every stored secret when the form sends blanks', async () => {
  const { handlers, savedPartials } = createSettingsHarness({ appState: { ...FULL_STATE } });
  const result = await handlers.get('save-settings')({}, baseSavePayload());
  assert.equal(result.success, true);

  const saved = savedPartials[savedPartials.length - 1];
  assert.equal(saved.geminiApiKey, FULL_STATE.geminiApiKey, 'blank Gemini field keeps stored keys');
  assert.equal(saved.assemblyAiApiKey, FAKE_ASSEMBLY_KEY);
  assert.equal(saved.openaiApiKey, FAKE_OPENAI_KEY);
  assert.equal(saved.awsAccessKeyId, FAKE_AWS_ACCESS_KEY);
  assert.equal(saved.awsSecretAccessKey, FAKE_AWS_SECRET);
  assert.equal(saved.awsSessionToken, FAKE_AWS_TOKEN);
  assert.equal(saved.bedrockApiKey, FAKE_BEDROCK_KEY);
});

test('save-settings keeps stored secrets when the form echoes the masked values back', async () => {
  const { handlers, savedPartials } = createSettingsHarness({ appState: { ...FULL_STATE } });
  const result = await handlers.get('save-settings')({}, baseSavePayload({
    geminiApiKey: `${MASK_BULLETS}abcd, ${MASK_BULLETS}efgh`,
    assemblyAiApiKey: `${MASK_BULLETS}wxyz`,
    openaiApiKey: `${MASK_BULLETS}9999`,
    awsAccessKeyId: `${MASK_BULLETS}0000`,
    awsSecretAccessKey: `${MASK_BULLETS}eSec`,
    awsSessionToken: `${MASK_BULLETS}oken`,
    bedrockApiKey: `${MASK_BULLETS}7777`
  }));
  assert.equal(result.success, true);

  const saved = savedPartials[savedPartials.length - 1];
  assert.equal(saved.geminiApiKey, FULL_STATE.geminiApiKey, 'masked echo must not overwrite stored keys');
  assert.equal(saved.assemblyAiApiKey, FAKE_ASSEMBLY_KEY);
  assert.equal(saved.openaiApiKey, FAKE_OPENAI_KEY);
  assert.equal(saved.awsAccessKeyId, FAKE_AWS_ACCESS_KEY);
  assert.equal(saved.awsSecretAccessKey, FAKE_AWS_SECRET);
  assert.equal(saved.awsSessionToken, FAKE_AWS_TOKEN);
  assert.equal(saved.bedrockApiKey, FAKE_BEDROCK_KEY);
});

test('save-settings stores a newly typed key in place of the old one', async () => {
  const { handlers, savedPartials } = createSettingsHarness({ appState: { ...FULL_STATE } });
  const result = await handlers.get('save-settings')({}, baseSavePayload({
    openaiApiKey: 'sk-replacement-key-4242'
  }));
  assert.equal(result.success, true);

  const saved = savedPartials[savedPartials.length - 1];
  assert.equal(saved.openaiApiKey, 'sk-replacement-key-4242', 'typed key replaces the stored one');
  assert.equal(saved.assemblyAiApiKey, FAKE_ASSEMBLY_KEY, 'untouched providers keep their keys');
});
