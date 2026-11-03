// ============================================================================
// AWS CREDENTIAL RESOLUTION — shared by Amazon Bedrock and Amazon Transcribe
// ============================================================================
// One auth mode, chosen in Settings, drives every AWS client the app builds:
//
//   default  -> no credentials attached; the SDK default chain resolves them
//               (AWS_PROFILE, environment variables, ~/.aws, instance role).
//   profile  -> a named profile from ~/.aws/config / ~/.aws/credentials,
//               loaded with fromIni({ profile }). Only the NAME crosses the
//               app; credential values are read by the SDK, never by us.
//   keys     -> a static access key + secret (+ optional session token for
//               temporary credentials).
//   apiKey   -> a Bedrock API key, sent as `Authorization: Bearer <key>`
//               (token + authSchemePreference httpBearerAuth). Bedrock only:
//               Amazon Transcribe has no bearer scheme, so resolving auth for
//               purpose 'transcribe' with this mode is an error.
//
// Secrets never appear in the returned error strings, and nothing here logs
// credential material.
// ============================================================================

const { fromIni: sdkFromIni } = require('@aws-sdk/credential-providers');

const AWS_AUTH_MODES = Object.freeze(['default', 'profile', 'keys', 'apiKey']);

function normalizeAwsAuthMode(mode) {
  const normalized = String(mode ?? '').trim();
  return AWS_AUTH_MODES.includes(normalized) ? normalized : null;
}

function str(value) {
  return String(value ?? '').trim();
}

// resolveAwsAuth(state, { purpose }) -> { mode, credentials?, token?,
//   authSchemePreference?, error? }
// `state` carries the app's AWS settings fields (awsAuthMode, awsProfile,
// awsAccessKeyId, awsSecretAccessKey, awsSessionToken, bedrockApiKey).
// `options.fromIni` is injectable so tests never touch the real ~/.aws.
function resolveAwsAuth(state = {}, { purpose = 'bedrock', fromIni = sdkFromIni } = {}) {
  const mode = normalizeAwsAuthMode(state.awsAuthMode) || 'default';

  if (mode === 'default') {
    // No credentials key: the SDK default credential chain applies.
    return { mode };
  }

  if (mode === 'profile') {
    const profile = str(state.awsProfile);
    if (!profile) {
      return { mode, error: 'AWS profile auth is selected but no profile name is set. Pick one in Settings.' };
    }
    // fromIni only builds a provider function here; ~/.aws is read lazily by
    // the SDK when a client first needs credentials.
    return { mode, credentials: fromIni({ profile }) };
  }

  if (mode === 'keys') {
    const accessKeyId = str(state.awsAccessKeyId);
    const secretAccessKey = str(state.awsSecretAccessKey);
    if (!accessKeyId || !secretAccessKey) {
      return {
        mode,
        error: 'AWS access key auth needs both an access key ID and a secret access key. Set both in Settings, or pick another auth method.'
      };
    }
    const credentials = { accessKeyId, secretAccessKey };
    const sessionToken = str(state.awsSessionToken);
    if (sessionToken) {
      credentials.sessionToken = sessionToken;
    }
    return { mode, credentials };
  }

  // mode === 'apiKey'
  if (purpose === 'transcribe') {
    return {
      mode,
      error: 'A Bedrock API key cannot be used for Amazon Transcribe. Choose Default, AWS profile, or access keys in Settings.'
    };
  }
  const apiKey = str(state.bedrockApiKey);
  if (!apiKey) {
    return { mode, error: 'Bedrock API key auth is selected but no key is set. Add it in Settings.' };
  }
  return { mode, token: { token: apiKey }, authSchemePreference: ['httpBearerAuth'] };
}

// Readiness per mode, without building any credential provider. `region` is
// checked by callers that have one; every region in the app has a default.
function isAwsAuthReady(state = {}, { purpose = 'bedrock' } = {}) {
  const mode = normalizeAwsAuthMode(state.awsAuthMode) || 'default';
  if (mode === 'default') {
    return true;
  }
  if (mode === 'profile') {
    return str(state.awsProfile).length > 0;
  }
  if (mode === 'keys') {
    return str(state.awsAccessKeyId).length > 0 && str(state.awsSecretAccessKey).length > 0;
  }
  // apiKey
  return purpose !== 'transcribe' && str(state.bedrockApiKey).length > 0;
}

// ---------------------------------------------------------------------------
// AWS profile listing (Settings dropdown). Reads ONLY section names from
// ~/.aws/config ([default], [profile x]) and ~/.aws/credentials ([x]);
// credential values are never parsed, returned, or logged. Paths and fs are
// injectable so tests run against fixtures, never the real ~/.aws.
// ---------------------------------------------------------------------------
function parseAwsProfileNames(fileContent, { configFormat }) {
  const names = [];
  for (const line of String(fileContent || '').split(/\r?\n/)) {
    const match = line.match(/^\s*\[([^\]]+)\]\s*(?:[;#].*)?$/);
    if (!match) {
      continue;
    }
    const section = match[1].trim();
    let name = section;
    if (configFormat) {
      // ~/.aws/config: profiles are "[profile x]"; "[default]" stays "default".
      const profileMatch = section.match(/^profile\s+(.+)$/);
      if (profileMatch) {
        name = profileMatch[1].trim();
      } else if (section !== 'default') {
        continue; // sso-session / services / preview sections are not profiles
      }
    }
    if (name && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

function listAwsProfiles({
  fsImpl = require('fs'),
  osImpl = require('os'),
  pathImpl = require('path'),
  configPath,
  credentialsPath
} = {}) {
  const awsDir = pathImpl.join(osImpl.homedir(), '.aws');
  const files = [
    { filePath: configPath || pathImpl.join(awsDir, 'config'), configFormat: true },
    { filePath: credentialsPath || pathImpl.join(awsDir, 'credentials'), configFormat: false }
  ];

  const profiles = [];
  for (const { filePath, configFormat } of files) {
    let content = null;
    try {
      content = fsImpl.readFileSync(filePath, 'utf8');
    } catch (_error) {
      continue; // a missing file is normal (e.g. config-only setups)
    }
    for (const name of parseAwsProfileNames(content, { configFormat })) {
      if (!profiles.includes(name)) {
        profiles.push(name);
      }
    }
  }
  return { success: true, profiles };
}

module.exports = {
  AWS_AUTH_MODES,
  normalizeAwsAuthMode,
  resolveAwsAuth,
  isAwsAuthReady,
  parseAwsProfileNames,
  listAwsProfiles
};
