// ============================================================================
// AMAZON BEDROCK AI SERVICE - Open-Cluely AI Assistant
// ============================================================================
// Uses `@aws-sdk/client-bedrock-runtime` with the Converse / ConverseStream
// API, so one client covers Claude, Llama, Nova, and other Bedrock models
// without per-model body formats.
//
// Credentials come from the shared AWS auth resolver (../aws/credentials.js):
// the Settings-chosen auth mode — default credential chain, named profile,
// access key + secret (+ optional session token), or a Bedrock API key sent
// as `Authorization: Bearer`. For backwards compatibility an unset auth mode
// with both legacy key fields still behaves as mode 'keys'.
//
// Implements the shared provider contract via BaseProviderService; every
// prompt comes from the shared builders in ./prompts.js.
// Tests inject stubbed clients via options.runtimeClient / options.bedrockClient.
// ============================================================================

const {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand
} = require('@aws-sdk/client-bedrock-runtime');
const { BedrockClient, ListFoundationModelsCommand } = require('@aws-sdk/client-bedrock');
const BaseProviderService = require('./base-provider-service');
const { resolveAwsAuth, isAwsAuthReady, normalizeAwsAuthMode } = require('../aws/credentials');
const {
  bedrockModelSupportsImages,
  resolveBedrockModel,
  resolveBedrockRegion,
  resolveProgrammingLanguage
} = require('../../config');

const SYSTEM_PROMPT = 'You are a helpful AI assistant.';
const MIME_TO_CONVERSE_FORMAT = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/gif': 'gif',
  'image/webp': 'webp'
};

// An unset auth mode keeps the pre-auth-modes behavior: any key material
// means static-keys mode (exactly one key stays the misconfiguration it
// always was and is not ready); none means the default AWS credential chain.
function resolveAuthMode(options) {
  const explicit = normalizeAwsAuthMode(options.authMode);
  if (explicit) {
    return explicit;
  }
  const hasKey = String(options.accessKeyId || '').trim().length > 0;
  const hasSecret = String(options.secretAccessKey || '').trim().length > 0;
  return hasKey || hasSecret ? 'keys' : 'default';
}

function buildClientConfig({ region, auth }) {
  // Bound connect/idle time so a hung call surfaces as a timeout (and can
  // trigger provider fallback) instead of hanging with no limit.
  const config = {
    region,
    requestHandler: { connectionTimeout: 10_000, requestTimeout: 60_000 }
  };
  if (auth?.credentials) {
    config.credentials = auth.credentials;
  }
  if (auth?.token) {
    // Bedrock API key: bearer auth instead of SigV4 (verified with a custom
    // requestHandler — the SDK sends `Authorization: Bearer <key>`).
    config.token = auth.token;
    config.authSchemePreference = auth.authSchemePreference;
  }
  return config;
}

class BedrockService extends BaseProviderService {
  constructor(options = {}) {
    super(options);
    this.region = resolveBedrockRegion(options.region);
    this.authMode = resolveAuthMode(options);
    this.profile = String(options.profile || '').trim();
    this.accessKeyId = String(options.accessKeyId || '').trim();
    this.secretAccessKey = String(options.secretAccessKey || '').trim();
    this.sessionToken = String(options.sessionToken || '').trim();
    this.apiKey = String(options.apiKey || '').trim();
    this.modelId = resolveBedrockModel(options.modelId ?? options.modelName);

    const clientConfig = this._clientConfig();
    // Allow tests to inject stubbed SDK clients.
    this.runtimeClient = options.runtimeClient || new BedrockRuntimeClient(clientConfig);
    this.bedrockClient = options.bedrockClient || new BedrockClient(clientConfig);

    console.log('BedrockService initialized:', this.modelId, 'in', this.region, '| auth:', this.authMode);
  }

  _awsAuthState() {
    return {
      awsAuthMode: this.authMode,
      awsProfile: this.profile,
      awsAccessKeyId: this.accessKeyId,
      awsSecretAccessKey: this.secretAccessKey,
      awsSessionToken: this.sessionToken,
      bedrockApiKey: this.apiKey
    };
  }

  _clientConfig() {
    const auth = resolveAwsAuth(this._awsAuthState(), { purpose: 'bedrock' });
    return buildClientConfig({ region: this.region, auth });
  }

  get supportsImages() {
    return bedrockModelSupportsImages(this.modelId);
  }

  // Ready when a region is set and the selected auth mode has everything it
  // needs (profile name, both keys, or the API key). The default chain needs
  // nothing configured.
  ready() {
    if (!this.region) {
      return false;
    }
    return isAwsAuthReady(this._awsAuthState(), { purpose: 'bedrock' });
  }

  updateConfiguration(options = {}) {
    const previousProgrammingLanguage = this.programmingLanguage;
    const nextRegion = resolveBedrockRegion(options.region ?? this.region);
    const nextAuthMode = options.authMode !== undefined ? resolveAuthMode(options) : this.authMode;
    const nextProfile = String(options.profile ?? this.profile ?? '').trim();
    const nextAccessKeyId = String(options.accessKeyId ?? this.accessKeyId ?? '').trim();
    const nextSecretAccessKey = String(options.secretAccessKey ?? this.secretAccessKey ?? '').trim();
    const nextSessionToken = String(options.sessionToken ?? this.sessionToken ?? '').trim();
    const nextApiKey = String(options.apiKey ?? this.apiKey ?? '').trim();
    const nextModelId = resolveBedrockModel(options.modelId ?? options.modelName ?? this.modelId);

    const credentialsChanged =
      nextRegion !== this.region ||
      nextAuthMode !== this.authMode ||
      nextProfile !== this.profile ||
      nextAccessKeyId !== this.accessKeyId ||
      nextSecretAccessKey !== this.secretAccessKey ||
      nextSessionToken !== this.sessionToken ||
      nextApiKey !== this.apiKey;
    const modelChanged = nextModelId !== this.modelId;

    this.region = nextRegion;
    this.authMode = nextAuthMode;
    this.profile = nextProfile;
    this.accessKeyId = nextAccessKeyId;
    this.secretAccessKey = nextSecretAccessKey;
    this.sessionToken = nextSessionToken;
    this.apiKey = nextApiKey;
    this.modelId = nextModelId;
    this.programmingLanguage = resolveProgrammingLanguage(
      options.programmingLanguage ?? this.programmingLanguage
    );

    if (credentialsChanged && !options.runtimeClient) {
      const clientConfig = this._clientConfig();
      this.runtimeClient = new BedrockRuntimeClient(clientConfig);
      this.bedrockClient = new BedrockClient(clientConfig);
    }

    return {
      apiKeyChanged: credentialsChanged,
      modelChanged,
      programmingLanguageChanged: this.programmingLanguage !== previousProgrammingLanguage
    };
  }

  isAuthenticationError(error) {
    const name = String(error?.name || '');
    return (
      name === 'UnrecognizedClientException' ||
      name === 'InvalidSignatureException' ||
      name === 'AccessDeniedException' ||
      super.isAuthenticationError(error)
    );
  }

  _buildConverseMessages(request) {
    const images = this.supportsImages ? request.images : [];
    if (request.images.length > 0 && !this.supportsImages) {
      console.warn(`Bedrock model ${this.modelId} is text-only; dropping ${request.images.length} image(s)`);
    }

    const content = [{ text: request.prompt }];
    for (const image of images) {
      const format = MIME_TO_CONVERSE_FORMAT[image.mimeType] || 'png';
      // Converse wants raw image bytes, not base64 strings.
      content.push({ image: { format, source: { bytes: image.bytes } } });
    }

    return [{ role: 'user', content }];
  }

  async _performRequest(request) {
    const messages = this._buildConverseMessages(request);
    const system = [{ text: SYSTEM_PROMPT }];

    if (typeof request.onChunk === 'function') {
      console.log(`[Bedrock API] Streaming ${request.type} request started (model: ${this.modelId})`);
      const response = await this.runtimeClient.send(
        new ConverseStreamCommand({
          modelId: this.modelId,
          system,
          messages
        })
      );

      let fullText = '';
      let chunkIndex = 0;

      for await (const event of response.stream) {
        // Reasoning models emit reasoningContent deltas before text — skip
        // them; only text deltas reach the user.
        const text = event?.contentBlockDelta?.delta?.text;
        if (text) {
          fullText += text;
          chunkIndex += 1;
          if (!request._firstChunkSent) {
            request._firstChunkSent = true;
          }
          request.onChunk({ text, index: chunkIndex });
        }
      }

      console.log(`[Bedrock API] Streaming ${request.type} request completed (${chunkIndex} chunks, ${fullText.length} chars)`);
      return fullText;
    }

    console.log(`[Bedrock API] Non-streaming ${request.type} request started (model: ${this.modelId})`);
    const response = await this.runtimeClient.send(
      new ConverseCommand({
        modelId: this.modelId,
        system,
        messages
      })
    );

    // Return only text blocks; skip reasoningContent and anything else.
    const blocks = response.output?.message?.content;
    const responseText = (Array.isArray(blocks) ? blocks : [])
      .filter((block) => typeof block?.text === 'string')
      .map((block) => block.text)
      .join('');
    console.log(`[Bedrock API] Non-streaming ${request.type} request completed (${responseText.length} chars)`);
    return responseText;
  }

  // List foundation models available in the configured region (settings panel
  // "Fetch" button, Task D3). Returns plain model id strings. Bedrock API
  // keys are bearer credentials for the runtime API; the control-plane list
  // call needs SigV4, so apiKey mode gets a clear message instead of a call.
  async listModels() {
    if (this.authMode === 'apiKey') {
      throw new Error(
        'Model listing needs SigV4 AWS credentials and is not available with a Bedrock API key. Use Default, AWS profile, or access keys to fetch models.'
      );
    }
    const response = await this.bedrockClient.send(new ListFoundationModelsCommand({}));
    const summaries = Array.isArray(response.modelSummaries) ? response.modelSummaries : [];
    return summaries
      .filter((summary) => {
        const outputs = summary.outputModalities || [];
        const inference = summary.inferenceTypesSupported || [];
        const lifecycle = String(summary.modelLifecycle?.status || 'ACTIVE');
        return (
          lifecycle === 'ACTIVE' &&
          outputs.includes('TEXT') &&
          (inference.length === 0 || inference.includes('ON_DEMAND'))
        );
      })
      .map((summary) => summary.modelId)
      .filter(Boolean);
  }
}

module.exports = BedrockService;
