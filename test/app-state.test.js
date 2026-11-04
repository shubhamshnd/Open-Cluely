'use strict';

// App-state sanitization: the AWS auth fields, the one-time migration from
// the legacy Bedrock key pair, and the speech-to-text provider fields.

const test = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeAppState, getDefaultAppState } = require('../src/services/state/app-state.js');

const FAKE_ACCESS_KEY = 'AKIAFAKEKEY0000000';
const FAKE_SECRET = 'fakeSecretKeyfakeSecretKeyfakeSec';

test('defaults: empty state gets the default AWS auth mode and AssemblyAI STT', () => {
  const state = sanitizeAppState({});
  assert.equal(state.awsAuthMode, 'default');
  assert.equal(state.awsProfile, null);
  assert.equal(state.awsAccessKeyId, null);
  assert.equal(state.awsSecretAccessKey, null);
  assert.equal(state.awsSessionToken, null);
  assert.equal(state.bedrockApiKey, null);
  assert.equal(state.sttProvider, 'assemblyai');
  assert.equal(state.transcribeRegion, null);
  assert.equal(state.transcribeLanguage, null);
  assert.equal(state.transcribeVocabularyName, null);
  // The Transcribe-only credential split defaults to 'inherit' (shared
  // credentials) with no stored override values — the pre-split behavior.
  assert.equal(state.transcribeAuthMode, 'inherit');
  assert.equal(state.transcribeAwsProfile, null);
  assert.equal(state.transcribeAwsAccessKeyId, null);
  assert.equal(state.transcribeAwsSecretAccessKey, null);
  assert.equal(state.transcribeAwsSessionToken, null);
});

test('migration: legacy Bedrock key pair with no auth mode becomes mode keys', () => {
  const state = sanitizeAppState({
    bedrockAccessKeyId: `  ${FAKE_ACCESS_KEY}  `,
    bedrockSecretAccessKey: ` ${FAKE_SECRET} `
  });
  assert.equal(state.awsAuthMode, 'keys');
  assert.equal(state.awsAccessKeyId, FAKE_ACCESS_KEY);
  assert.equal(state.awsSecretAccessKey, FAKE_SECRET);
  // The legacy fields stay readable (nothing else consumes them anymore).
  assert.equal(state.bedrockAccessKeyId, FAKE_ACCESS_KEY);
  assert.equal(state.bedrockSecretAccessKey, FAKE_SECRET);
});

test('migration: only ONE legacy key is not keys mode — it falls back to default', () => {
  assert.equal(sanitizeAppState({ bedrockAccessKeyId: FAKE_ACCESS_KEY }).awsAuthMode, 'default');
  assert.equal(sanitizeAppState({ bedrockSecretAccessKey: FAKE_SECRET }).awsAuthMode, 'default');
});

test('an explicit auth mode always wins and is never re-migrated', () => {
  const state = sanitizeAppState({
    awsAuthMode: 'profile',
    awsProfile: ' transcribe-profile ',
    bedrockAccessKeyId: FAKE_ACCESS_KEY,
    bedrockSecretAccessKey: FAKE_SECRET
  });
  assert.equal(state.awsAuthMode, 'profile');
  assert.equal(state.awsProfile, 'transcribe-profile');
  assert.equal(state.awsAccessKeyId, null, 'legacy keys are not copied when a mode is set');
  assert.equal(state.awsSecretAccessKey, null);

  // A second pass (saveAppState merges and re-sanitizes) keeps the mode.
  const again = sanitizeAppState(state);
  assert.equal(again.awsAuthMode, 'profile');
  assert.equal(again.awsProfile, 'transcribe-profile');
});

test('new fields are trimmed; unknown values fall back to safe defaults', () => {
  const state = sanitizeAppState({
    awsAuthMode: 'bogus',
    sttProvider: 'not-a-provider',
    transcribeLanguage: 'klingon',
    transcribeRegion: '  eu-west-1 ',
    transcribeVocabularyName: ' open-cluely-en-US ',
    awsSessionToken: ' tok ',
    bedrockApiKey: ' key '
  });
  assert.equal(state.awsAuthMode, 'default');
  assert.equal(state.sttProvider, 'assemblyai');
  assert.equal(state.transcribeLanguage, null, 'invalid languages resolve to the default at use');
  assert.equal(state.transcribeRegion, 'eu-west-1');
  assert.equal(state.transcribeVocabularyName, 'open-cluely-en-US');
  assert.equal(state.awsSessionToken, 'tok');
  assert.equal(state.bedrockApiKey, 'key');

  const transcribe = sanitizeAppState({ sttProvider: 'transcribe', transcribeLanguage: 'hi-IN' });
  assert.equal(transcribe.sttProvider, 'transcribe');
  assert.equal(transcribe.transcribeLanguage, 'hi-IN');
});

test('transcribe auth split: valid modes survive, unknown modes sanitize to inherit', () => {
  const profile = sanitizeAppState({
    transcribeAuthMode: 'profile',
    transcribeAwsProfile: ' transcribe-profile '
  });
  assert.equal(profile.transcribeAuthMode, 'profile');
  assert.equal(profile.transcribeAwsProfile, 'transcribe-profile');

  const keys = sanitizeAppState({
    transcribeAuthMode: 'keys',
    transcribeAwsAccessKeyId: ` ${FAKE_ACCESS_KEY} `,
    transcribeAwsSecretAccessKey: ` ${FAKE_SECRET} `,
    transcribeAwsSessionToken: ' tok '
  });
  assert.equal(keys.transcribeAuthMode, 'keys');
  assert.equal(keys.transcribeAwsAccessKeyId, FAKE_ACCESS_KEY);
  assert.equal(keys.transcribeAwsSecretAccessKey, FAKE_SECRET);
  assert.equal(keys.transcribeAwsSessionToken, 'tok');

  // Unknown/garbage modes can never break transcription: they become
  // 'inherit' (the shared block), and a re-save keeps it stable.
  for (const bogus of ['bogus', 'apiKey', 'PROFILE', '', null, undefined, 42]) {
    const state = sanitizeAppState({ transcribeAuthMode: bogus });
    assert.equal(state.transcribeAuthMode, 'inherit', `mode ${JSON.stringify(bogus)} must sanitize to inherit`);
    assert.equal(sanitizeAppState(state).transcribeAuthMode, 'inherit');
  }

  // An explicit 'inherit' is kept as-is (not confused with "not migrated").
  assert.equal(sanitizeAppState({ transcribeAuthMode: 'inherit' }).transcribeAuthMode, 'inherit');
});

test('default state shape stays complete', () => {
  const defaults = getDefaultAppState();
  for (const key of [
    'awsAuthMode', 'awsProfile', 'awsAccessKeyId', 'awsSecretAccessKey', 'awsSessionToken',
    'bedrockApiKey', 'sttProvider', 'transcribeRegion', 'transcribeLanguage', 'transcribeVocabularyName',
    'transcribeAuthMode', 'transcribeAwsProfile', 'transcribeAwsAccessKeyId',
    'transcribeAwsSecretAccessKey', 'transcribeAwsSessionToken'
  ]) {
    assert.ok(key in defaults, `missing ${key}`);
  }
});
