'use strict';

// Shared AWS auth resolution (Bedrock + Amazon Transcribe): mode selection,
// per-mode readiness, profile-name parsing from fixture files (never the real
// ~/.aws), Bedrock API key -> bearer config, and the transcribe+apiKey error.
// All key material here is obviously fake; error strings must never contain it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  resolveAwsAuth,
  isAwsAuthReady,
  parseAwsProfileNames,
  listAwsProfiles,
  AWS_AUTH_MODES
} = require('../src/services/aws/credentials.js');
const { BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');
const { BedrockClient, ListFoundationModelsCommand } = require('@aws-sdk/client-bedrock');

const FAKE_ACCESS_KEY = 'AKIAFAKEKEY0000000';
const FAKE_SECRET = 'fakeSecretKeyfakeSecretKeyfakeSec';
const FAKE_TOKEN = 'fakeSessionToken';
const FAKE_BEDROCK_KEY = 'bedrock-api-key-fake';

function keysState(overrides = {}) {
  return {
    awsAuthMode: 'keys',
    awsAccessKeyId: FAKE_ACCESS_KEY,
    awsSecretAccessKey: FAKE_SECRET,
    ...overrides
  };
}

test('mode selection: unset/invalid mode resolves to the default credential chain', () => {
  for (const mode of [undefined, null, '', 'bogus']) {
    const auth = resolveAwsAuth({ awsAuthMode: mode }, { purpose: 'bedrock' });
    assert.equal(auth.mode, 'default');
    assert.equal(auth.credentials, undefined, 'default mode attaches no credentials');
    assert.equal(auth.token, undefined);
    assert.equal(auth.error, undefined);
  }
  assert.deepEqual(AWS_AUTH_MODES, ['default', 'profile', 'keys', 'apiKey']);
});

test('profile mode: needs a name; fromIni receives the profile name only', () => {
  const missing = resolveAwsAuth({ awsAuthMode: 'profile' }, { purpose: 'bedrock' });
  assert.match(missing.error, /no profile name/);

  const calls = [];
  const fakeProvider = async () => ({ accessKeyId: 'x', secretAccessKey: 'y' });
  const auth = resolveAwsAuth(
    { awsAuthMode: 'profile', awsProfile: 'transcribe-profile' },
    { purpose: 'bedrock', fromIni: (options) => { calls.push(options); return fakeProvider; } }
  );
  assert.equal(auth.error, undefined);
  assert.equal(auth.credentials, fakeProvider);
  assert.deepEqual(calls, [{ profile: 'transcribe-profile' }]);
});

test('keys mode: both parts required; optional session token is attached', () => {
  const full = resolveAwsAuth(keysState({ awsSessionToken: FAKE_TOKEN }), { purpose: 'transcribe' });
  assert.deepEqual(full.credentials, {
    accessKeyId: FAKE_ACCESS_KEY,
    secretAccessKey: FAKE_SECRET,
    sessionToken: FAKE_TOKEN
  });

  const noToken = resolveAwsAuth(keysState(), { purpose: 'bedrock' });
  assert.deepEqual(noToken.credentials, { accessKeyId: FAKE_ACCESS_KEY, secretAccessKey: FAKE_SECRET });

  for (const broken of [
    { awsAuthMode: 'keys', awsAccessKeyId: FAKE_ACCESS_KEY },
    { awsAuthMode: 'keys', awsSecretAccessKey: FAKE_SECRET },
    { awsAuthMode: 'keys' }
  ]) {
    const auth = resolveAwsAuth(broken, { purpose: 'bedrock' });
    assert.match(auth.error, /both an access key ID and a secret access key/);
    assert.equal(auth.credentials, undefined);
  }
});

test('apiKey mode: Bedrock gets the bearer token config', () => {
  const auth = resolveAwsAuth({ awsAuthMode: 'apiKey', bedrockApiKey: FAKE_BEDROCK_KEY }, { purpose: 'bedrock' });
  assert.deepEqual(auth.token, { token: FAKE_BEDROCK_KEY });
  assert.deepEqual(auth.authSchemePreference, ['httpBearerAuth']);
  assert.equal(auth.credentials, undefined);

  const missing = resolveAwsAuth({ awsAuthMode: 'apiKey' }, { purpose: 'bedrock' });
  assert.match(missing.error, /no key is set/);
});

test('apiKey mode is an error for Amazon Transcribe', () => {
  const auth = resolveAwsAuth(
    { awsAuthMode: 'apiKey', bedrockApiKey: FAKE_BEDROCK_KEY },
    { purpose: 'transcribe' }
  );
  assert.match(auth.error, /Bedrock API key cannot be used for Amazon Transcribe/);
  assert.equal(auth.token, undefined);
  assert.equal(auth.credentials, undefined);
});

test('error strings never contain key material', () => {
  const cases = [
    resolveAwsAuth(keysState({ awsSecretAccessKey: '' }), { purpose: 'bedrock' }),
    resolveAwsAuth({ awsAuthMode: 'apiKey', bedrockApiKey: FAKE_BEDROCK_KEY }, { purpose: 'transcribe' }),
    resolveAwsAuth({ awsAuthMode: 'profile', awsProfile: '' }, { purpose: 'bedrock' })
  ];
  for (const auth of cases) {
    assert.ok(auth.error, 'expected an error');
    assert.doesNotMatch(auth.error, new RegExp(FAKE_ACCESS_KEY));
    assert.doesNotMatch(auth.error, new RegExp(FAKE_SECRET.slice(0, 8)));
    assert.doesNotMatch(auth.error, new RegExp(FAKE_BEDROCK_KEY));
    assert.doesNotMatch(auth.error, new RegExp(FAKE_TOKEN));
  }
});

test('readiness per mode and purpose', () => {
  assert.equal(isAwsAuthReady({}, { purpose: 'bedrock' }), true, 'default chain needs nothing');
  assert.equal(isAwsAuthReady({}, { purpose: 'transcribe' }), true);
  assert.equal(isAwsAuthReady({ awsAuthMode: 'profile' }, { purpose: 'bedrock' }), false);
  assert.equal(isAwsAuthReady({ awsAuthMode: 'profile', awsProfile: 'transcribe-profile' }, { purpose: 'bedrock' }), true);
  assert.equal(isAwsAuthReady({ awsAuthMode: 'keys', awsAccessKeyId: FAKE_ACCESS_KEY }, { purpose: 'bedrock' }), false);
  assert.equal(isAwsAuthReady(keysState(), { purpose: 'bedrock' }), true);
  assert.equal(isAwsAuthReady({ awsAuthMode: 'apiKey' }, { purpose: 'bedrock' }), false);
  assert.equal(isAwsAuthReady({ awsAuthMode: 'apiKey', bedrockApiKey: FAKE_BEDROCK_KEY }, { purpose: 'bedrock' }), true);
  assert.equal(
    isAwsAuthReady({ awsAuthMode: 'apiKey', bedrockApiKey: FAKE_BEDROCK_KEY }, { purpose: 'transcribe' }),
    false,
    'a Bedrock API key can never make Transcribe ready'
  );
});

test('profile-name parsing: config format keeps default/profile sections only', () => {
  const config = [
    '# comment',
    '[default]',
    'region = us-east-1',
    'aws_access_key_id = SHOULD_NOT_APPEAR',
    '[profile transcribe-profile]',
    'region = us-east-1',
    '[profile  spaced-name  ]',
    '[sso-session my-sso]',
    'sso_start_url = https://example.awsapps.com/start',
    '[services my-services]',
    ''
  ].join('\n');
  assert.deepEqual(parseAwsProfileNames(config, { configFormat: true }), ['default', 'transcribe-profile', 'spaced-name']);

  const credentials = [
    '[default]',
    `aws_access_key_id = ${FAKE_ACCESS_KEY}`,
    `aws_secret_access_key = ${FAKE_SECRET}`,
    '[transcribe-profile]',
    'aws_access_key_id = SHOULD_NOT_APPEAR_EITHER',
    '[Rogesh]'
  ].join('\n');
  assert.deepEqual(parseAwsProfileNames(credentials, { configFormat: false }), ['default', 'transcribe-profile', 'Rogesh']);
});

test('listAwsProfiles merges names from fixture files and never returns values', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aws-profiles-fixture-'));
  const configPath = path.join(dir, 'config');
  const credentialsPath = path.join(dir, 'credentials');
  fs.writeFileSync(configPath, '[default]\nregion = us-east-1\n[profile transcribe-profile]\nregion = eu-west-1\n');
  fs.writeFileSync(credentialsPath, `[transcribe-profile]\naws_access_key_id = ${FAKE_ACCESS_KEY}\n[bedrock-profile]\n`);

  const result = listAwsProfiles({ configPath, credentialsPath });
  assert.equal(result.success, true);
  assert.deepEqual(result.profiles, ['default', 'transcribe-profile', 'bedrock-profile']);
  assert.ok(!result.profiles.some((name) => name.includes(FAKE_ACCESS_KEY)), 'credential values must not leak');

  // Missing files are fine (config-only or credentials-only setups).
  const partial = listAwsProfiles({ configPath, credentialsPath: path.join(dir, 'nope') });
  assert.deepEqual(partial.profiles, ['default', 'transcribe-profile']);

  fs.rmSync(dir, { recursive: true, force: true });
});

// The Bedrock API key must reach the wire as `Authorization: Bearer <key>`.
// A capturing requestHandler intercepts the request before any network I/O;
// deserialization then fails on the empty fake body, which is fine — the
// header was already captured.
async function captureAuthorizationHeader(Client, Command, input) {
  const captured = {};
  const client = new Client({
    region: 'us-east-1',
    token: { token: FAKE_BEDROCK_KEY },
    authSchemePreference: ['httpBearerAuth'],
    requestHandler: {
      handle: async (request) => {
        captured.authorization = request.headers?.authorization ?? request.headers?.Authorization;
        return {
          response: {
            statusCode: 200,
            headers: {},
            body: (async function* () { yield Buffer.from('{}'); })()
          }
        };
      }
    }
  });
  try {
    await client.send(new Command(input));
  } catch (_error) {
    // Deserialization of the fake body may fail; the header was captured first.
  }
  client.destroy();
  return captured.authorization;
}

test('Bedrock API key is sent as an Authorization bearer header (runtime + control plane)', async () => {
  const runtimeHeader = await captureAuthorizationHeader(BedrockRuntimeClient, ConverseCommand, { modelId: 'x', messages: [] });
  assert.equal(runtimeHeader, `Bearer ${FAKE_BEDROCK_KEY}`);

  const controlHeader = await captureAuthorizationHeader(BedrockClient, ListFoundationModelsCommand, {});
  assert.equal(controlHeader, `Bearer ${FAKE_BEDROCK_KEY}`);
});
