// ============================================================================
// ANTHROPIC AI SERVICE - Open-Cluely AI Assistant
// ============================================================================
// Uses the official `@anthropic-ai/sdk` (messages.create with streaming).
// Implements the shared provider contract via BaseProviderService; every
// prompt comes from the shared builders in ./prompts.js.
// Tests inject a stubbed client via options.client — no network needed.
// ============================================================================

const Anthropic = require('@anthropic-ai/sdk');
const BaseProviderService = require('./base-provider-service');
const {
  anthropicModelSupportsImages,
  resolveAnthropicModel,
  resolveProgrammingLanguage
} = require('../../config');

const DEFAULT_MAX_TOKENS = 4096;
const SYSTEM_PROMPT = 'You are a helpful AI assistant.';

// Bound each request so a hung call surfaces as a timeout (and can trigger
// provider fallback) instead of the SDK default of 10 minutes. Retries are
// handled once by BaseProviderService, so the SDK's own retries are off.
const SDK_CLIENT_OPTIONS = { timeout: 60_000, maxRetries: 0 };

class AnthropicService extends BaseProviderService {
  constructor(apiKey, options = {}) {
    super(options);
    this.apiKey = String(apiKey || '').trim();
    this.modelName = resolveAnthropicModel(options.modelName);
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    // Allow tests to inject a stubbed SDK client.
    this.client = options.client || new Anthropic({ apiKey: this.apiKey, ...SDK_CLIENT_OPTIONS });

    console.log('AnthropicService initialized:', this.modelName);
  }

  get supportsImages() {
    return anthropicModelSupportsImages(this.modelName);
  }

  ready() {
    return this.apiKey.length > 0;
  }

  updateConfiguration(options = {}) {
    const previousProgrammingLanguage = this.programmingLanguage;
    const nextApiKey = String(options.apiKey ?? this.apiKey ?? '').trim();
    const nextModelName = resolveAnthropicModel(options.modelName ?? this.modelName);

    const apiKeyChanged = nextApiKey !== this.apiKey;
    const modelChanged = nextModelName !== this.modelName;

    if (apiKeyChanged) {
      this.apiKey = nextApiKey;
      if (!options.client) {
        this.client = new Anthropic({ apiKey: this.apiKey, ...SDK_CLIENT_OPTIONS });
      }
    }
    this.modelName = nextModelName;
    this.programmingLanguage = resolveProgrammingLanguage(
      options.programmingLanguage ?? this.programmingLanguage
    );

    return {
      apiKeyChanged,
      modelChanged,
      programmingLanguageChanged: this.programmingLanguage !== previousProgrammingLanguage
    };
  }

  _buildMessages(request) {
    const images = this.supportsImages ? request.images : [];
    if (request.images.length > 0 && !this.supportsImages) {
      console.warn(`Anthropic model ${this.modelName} is text-only; dropping ${request.images.length} image(s)`);
    }

    // The system prompt travels in the `system` field, never as a message.
    // History roles stay user/assistant; the built prompt is one user turn.
    const userContent = images.length > 0
      ? [
          { type: 'text', text: request.prompt },
          ...images.map((image) => ({
            type: 'image',
            source: {
              type: 'base64',
              media_type: image.mimeType,
              data: image.data
            }
          }))
        ]
      : request.prompt;

    return [{ role: 'user', content: userContent }];
  }

  async _performRequest(request) {
    const messages = this._buildMessages(request);

    if (typeof request.onChunk === 'function') {
      console.log(`[Anthropic API] Streaming ${request.type} request started (model: ${this.modelName})`);
      const stream = await this.client.messages.create({
        model: this.modelName,
        max_tokens: this.maxTokens,
        system: SYSTEM_PROMPT,
        messages,
        stream: true
      });

      let fullText = '';
      let chunkIndex = 0;

      for await (const event of stream) {
        if (
          event?.type === 'content_block_delta' &&
          event.delta?.type === 'text_delta' &&
          event.delta.text
        ) {
          fullText += event.delta.text;
          chunkIndex += 1;
          if (!request._firstChunkSent) {
            request._firstChunkSent = true;
          }
          request.onChunk({ text: event.delta.text, index: chunkIndex });
        }
      }

      console.log(`[Anthropic API] Streaming ${request.type} request completed (${chunkIndex} chunks, ${fullText.length} chars)`);
      return fullText;
    }

    console.log(`[Anthropic API] Non-streaming ${request.type} request started (model: ${this.modelName})`);
    const response = await this.client.messages.create({
      model: this.modelName,
      max_tokens: this.maxTokens,
      system: SYSTEM_PROMPT,
      messages
    });

    // Join only text blocks; ignore anything else the API returns.
    const responseText = (Array.isArray(response.content) ? response.content : [])
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('');
    console.log(`[Anthropic API] Non-streaming ${request.type} request completed (${responseText.length} chars)`);
    return responseText;
  }
}

module.exports = AnthropicService;
