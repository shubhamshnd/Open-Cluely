// ============================================================================
// CHILD-PROCESS ENVIRONMENT SCRUBBING
// ============================================================================
// The app process environment can carry API keys (synced from .env by
// bootstrap/environment, or exported by the user's shell for the AWS default
// credential chain). Child processes this app spawns — pw-record, gsettings,
// helper scripts — never need those values, so they get a copy of the
// environment with every known secret variable removed instead of
// inheriting process.env wholesale.
// ============================================================================

const SECRET_ENV_VARS = Object.freeze([
  'GEMINI_API_KEY',
  'GEMINI_API_KEYS',
  'ASSEMBLY_AI_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'BEDROCK_API_KEY'
]);

function scrubSecretEnvVars(env = process.env) {
  const scrubbed = { ...(env || {}) };
  for (const name of SECRET_ENV_VARS) {
    delete scrubbed[name];
  }
  return scrubbed;
}

module.exports = {
  SECRET_ENV_VARS,
  scrubSecretEnvVars
};
