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
// TRANSCRIBE-ONLY SPLIT: Amazon Transcribe can also carry its own IAM
// identity. When purpose is 'transcribe' and state.transcribeAuthMode is
// 'profile' or 'keys', the transcribeAws* fields drive auth and the shared
// block is ignored (Bedrock is never affected). 'inherit' — the default — or
// any unrecognized value uses the shared block: exactly the pre-split
// behavior. The apiKey mode is not offered for the split (no bearer scheme).
//
// Successful transcribe resolutions carry `credentialLabel`, a human-readable
// name for the credential set in use (e.g. "Amazon Transcribe credentials
// (profile transcribe-profile)") so callers can name WHICH credentials failed in error
// messages. The label never contains key material.
//
// Secrets never appear in the returned error strings, and nothing here logs
// credential material.
// ============================================================================

const { fromIni: sdkFromIni } = require('@aws-sdk/credential-providers');

const AWS_AUTH_MODES = Object.freeze(['default', 'profile', 'keys', 'apiKey']);
// Transcribe-only override modes (the split). 'inherit' = shared block.
const TRANSCRIBE_AUTH_MODES = Object.freeze(['inherit', 'profile', 'keys']);

function normalizeAwsAuthMode(mode) {
  const normalized = String(mode ?? '').trim();
  return AWS_AUTH_MODES.includes(normalized) ? normalized : null;
}

function normalizeTranscribeAuthMode(mode) {
  const normalized = String(mode ?? '').trim();
  return TRANSCRIBE_AUTH_MODES.includes(normalized) ? normalized : null;
}

function str(value) {
  return String(value ?? '').trim();
}

// Names the credential set a transcribe resolution will use, for error
// messages. Profile names are safe to show; key material never appears.
function transcribeCredentialLabel({ overrideMode, sharedMode, profile }) {
  const base = 'Amazon Transcribe credentials';
  if (overrideMode === 'profile') {
    return `${base} (profile ${profile})`;
  }
  if (overrideMode === 'keys') {
    return `${base} (access keys)`;
  }
  if (sharedMode === 'profile') {
    return `${base} (shared profile ${profile})`;
  }
  if (sharedMode === 'keys') {
    return `${base} (shared access keys)`;
  }
  if (sharedMode === 'apiKey') {
    return base;
  }
  return `${base} (shared default credential chain)`;
}

// The Transcribe-only split: resolve from the transcribeAws* fields.
function resolveTranscribeOverride(state, overrideMode, fromIni) {
  if (overrideMode === 'profile') {
    const profile = str(state.transcribeAwsProfile);
    if (!profile) {
      return {
        mode: 'profile',
        error: 'Amazon Transcribe is set to use a different AWS profile, but no profile name is set. Pick one in Settings (Amazon Transcribe section), or switch back to the shared credentials.'
      };
    }
    return {
      mode: 'profile',
      credentials: fromIni({ profile }),
      credentialLabel: transcribeCredentialLabel({ overrideMode, profile })
    };
  }

  // overrideMode === 'keys'
  const accessKeyId = str(state.transcribeAwsAccessKeyId);
  const secretAccessKey = str(state.transcribeAwsSecretAccessKey);
  if (!accessKeyId || !secretAccessKey) {
    return {
      mode: 'keys',
      error: 'Amazon Transcribe is set to use its own access keys and needs both an access key ID and a secret access key. Set both in Settings (Amazon Transcribe section), or switch back to the shared credentials.'
    };
  }
  const credentials = { accessKeyId, secretAccessKey };
  const sessionToken = str(state.transcribeAwsSessionToken);
  if (sessionToken) {
    credentials.sessionToken = sessionToken;
  }
  return {
    mode: 'keys',
    credentials,
    credentialLabel: transcribeCredentialLabel({ overrideMode })
  };
}

// resolveAwsAuth(state, { purpose }) -> { mode, credentials?, token?,
//   authSchemePreference?, credentialLabel?, error? }
// `state` carries the app's AWS settings fields (awsAuthMode, awsProfile,
// awsAccessKeyId, awsSecretAccessKey, awsSessionToken, bedrockApiKey) plus
// the Transcribe-only split fields (transcribeAuthMode, transcribeAwsProfile,
// transcribeAwsAccessKeyId, transcribeAwsSecretAccessKey,
// transcribeAwsSessionToken).
// `options.fromIni` is injectable so tests never touch the real ~/.aws.
function resolveAwsAuth(state = {}, { purpose = 'bedrock', fromIni = sdkFromIni } = {}) {
  const sharedMode = normalizeAwsAuthMode(state.awsAuthMode) || 'default';

  // Transcribe-only split: an explicit override wins; anything else inherits.
  if (purpose === 'transcribe') {
    const overrideMode = normalizeTranscribeAuthMode(state.transcribeAuthMode);
    if (overrideMode && overrideMode !== 'inherit') {
      return resolveTranscribeOverride(state, overrideMode, fromIni);
    }
  }

  // The credential label names the credential set in Transcribe error
  // messages. It is only built for purpose 'transcribe'; Bedrock callers and
  // results are byte-for-byte the pre-split shape.
  const credentialLabel = purpose === 'transcribe'
    ? transcribeCredentialLabel({ sharedMode, profile: str(state.awsProfile) })
    : undefined;
  const withLabel = (result) => (credentialLabel ? { ...result, credentialLabel } : result);

  if (sharedMode === 'default') {
    // No credentials key: the SDK default credential chain applies.
    return withLabel({ mode: sharedMode });
  }

  if (sharedMode === 'profile') {
    const profile = str(state.awsProfile);
    if (!profile) {
      return { mode: sharedMode, error: 'AWS profile auth is selected but no profile name is set. Pick one in Settings.' };
    }
    // fromIni only builds a provider function here; ~/.aws is read lazily by
    // the SDK when a client first needs credentials.
    return withLabel({ mode: sharedMode, credentials: fromIni({ profile }) });
  }

  if (sharedMode === 'keys') {
    const accessKeyId = str(state.awsAccessKeyId);
    const secretAccessKey = str(state.awsSecretAccessKey);
    if (!accessKeyId || !secretAccessKey) {
      return {
        mode: sharedMode,
        error: 'AWS access key auth needs both an access key ID and a secret access key. Set both in Settings, or pick another auth method.'
      };
    }
    const credentials = { accessKeyId, secretAccessKey };
    const sessionToken = str(state.awsSessionToken);
    if (sessionToken) {
      credentials.sessionToken = sessionToken;
    }
    return withLabel({ mode: sharedMode, credentials });
  }

  // sharedMode === 'apiKey'
  if (purpose === 'transcribe') {
    return {
      mode: sharedMode,
      error: 'A Bedrock API key cannot be used for Amazon Transcribe. Choose Default, AWS profile, or access keys in Settings — or give Transcribe its own profile or keys there.'
    };
  }
  const apiKey = str(state.bedrockApiKey);
  if (!apiKey) {
    return { mode: sharedMode, error: 'Bedrock API key auth is selected but no key is set. Add it in Settings.' };
  }
  return { mode: sharedMode, token: { token: apiKey }, authSchemePreference: ['httpBearerAuth'] };
}

// Readiness per mode, without building any credential provider. `region` is
// checked by callers that have one; every region in the app has a default.
// For purpose 'transcribe' an explicit split override is checked against the
// transcribeAws* fields; 'inherit' checks the shared block as before.
function isAwsAuthReady(state = {}, { purpose = 'bedrock' } = {}) {
  if (purpose === 'transcribe') {
    const overrideMode = normalizeTranscribeAuthMode(state.transcribeAuthMode);
    if (overrideMode === 'profile') {
      return str(state.transcribeAwsProfile).length > 0;
    }
    if (overrideMode === 'keys') {
      return str(state.transcribeAwsAccessKeyId).length > 0 && str(state.transcribeAwsSecretAccessKey).length > 0;
    }
  }

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
//
// The default paths follow the AWS SDK: AWS_CONFIG_FILE and
// AWS_SHARED_CREDENTIALS_FILE override ~/.aws/config and ~/.aws/credentials
// (on every OS — the SDK honors them on Windows too), so the dropdown lists
// the same profiles the SDK's fromIni would actually resolve.
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
  env = process.env,
  configPath,
  credentialsPath
} = {}) {
  const awsDir = pathImpl.join(osImpl.homedir(), '.aws');
  const files = [
    {
      filePath: configPath || env.AWS_CONFIG_FILE || pathImpl.join(awsDir, 'config'),
      configFormat: true
    },
    {
      filePath: credentialsPath || env.AWS_SHARED_CREDENTIALS_FILE || pathImpl.join(awsDir, 'credentials'),
      configFormat: false
    }
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
  TRANSCRIBE_AUTH_MODES,
  normalizeAwsAuthMode,
  normalizeTranscribeAuthMode,
  resolveAwsAuth,
  isAwsAuthReady,
  parseAwsProfileNames,
  listAwsProfiles
};
