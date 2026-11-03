// ============================================================================
// OPENAI AI SERVICE - Open-Cluely AI Assistant
// ============================================================================
// Uses the official `openai` SDK (chat.completions with streaming).
// Implements the shared provider contract via BaseProviderService; every
// prompt comes from the shared builders in ./prompts.js.
// Tests inject a stubbed client via options.client — no network needed.
// ============================================================================

const OpenAI = require('openai');
const BaseProviderService = require('./base-provider-service');
const {
  openAIModelSupportsImages,
  resolveOpenAIModel,
  resolveProgrammingLanguage
} = require('../../config');

// Chat-capable model ids; embeddings, speech, image and moderation models are
// excluded so the picker only offers models this service can call.
const OPENAI_CHAT_MODEL_PATTERN = /^(gpt-|chatgpt-|o\d)/;
const OPENAI_NON_CHAT_PATTERN = /(embedding|whisper|tts|dall-e|moderation|audio|realtime|transcribe|image|search|instruct|davinci|babbage)/;

class OpenAIService extends BaseProviderService {
  constructor(apiKey, options = {}) {
    super(options);
    this.apiKey = String(apiKey || '').trim();
    this.modelName = resolveOpenAIModel(options.modelName);
    // Allow tests to inject a stubbed SDK client.
    this.client = options.client || new OpenAI({ apiKey: this.apiKey });

    console.log('OpenAIService initialized:', this.modelName);
  }

  get supportsImages() {
    return openAIModelSupportsImages(this.modelName);
  }

  ready() {
    return this.apiKey.length > 0;
  }

  // List chat-capable models for the settings "Fetch" button (Task D3).
  async listModels() {
    const page = await this.client.models.list();
    let items = [];
    if (page && typeof page[Symbol.asyncIterator] === 'function') {
      // SDK Page objects auto-paginate when iterated.
      for await (const item of page) {
        items.push(item);
      }
    } else if (Array.isArray(page?.data)) {
      items = page.data;
    }
    return items
      .map((model) => String(model?.id || ''))
      .filter((id) => OPENAI_CHAT_MODEL_PATTERN.test(id) && !OPENAI_NON_CHAT_PATTERN.test(id))
      .sort();
  }

  updateConfiguration(options = {}) {
    const previousProgrammingLanguage = this.programmingLanguage;
    const nextApiKey = String(options.apiKey ?? this.apiKey ?? '').trim();
    const nextModelName = resolveOpenAIModel(options.modelName ?? this.modelName);

    const apiKeyChanged = nextApiKey !== this.apiKey;
    const modelChanged = nextModelName !== this.modelName;

    if (apiKeyChanged) {
      this.apiKey = nextApiKey;
      if (!options.client) {
        this.client = new OpenAI({ apiKey: this.apiKey });
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
      console.warn(`OpenAI model ${this.modelName} is text-only; dropping ${request.images.length} image(s)`);
    }

    const userContent = images.length > 0
      ? [
          { type: 'text', text: request.prompt },
          ...images.map((image) => ({
            type: 'image_url',
            image_url: { url: `data:${image.mimeType};base64,${image.data}` }
          }))
        ]
      : request.prompt;

    return [
      { role: 'system', content: 'You are a helpful AI assistant.' },
      { role: 'user', content: userContent }
    ];
  }

  async _performRequest(request) {
    const messages = this._buildMessages(request);

    if (typeof request.onChunk === 'function') {
      console.log(`[OpenAI API] Streaming ${request.type} request started (model: ${this.modelName})`);
      const stream = await this.client.chat.completions.create({
        model: this.modelName,
        messages,
        stream: true
      });

      let fullText = '';
      let chunkIndex = 0;

      for await (const chunk of stream) {
        const chunkText = chunk.choices?.[0]?.delta?.content || '';
        if (chunkText) {
          fullText += chunkText;
          chunkIndex += 1;
          if (!request._firstChunkSent) {
            request._firstChunkSent = true;
          }
          request.onChunk({ text: chunkText, index: chunkIndex });
        }
      }

      console.log(`[OpenAI API] Streaming ${request.type} request completed (${chunkIndex} chunks, ${fullText.length} chars)`);
      return fullText;
    }

    console.log(`[OpenAI API] Non-streaming ${request.type} request started (model: ${this.modelName})`);
    const response = await this.client.chat.completions.create({
      model: this.modelName,
      messages
    });

    const responseText = response.choices?.[0]?.message?.content || '';
    console.log(`[OpenAI API] Non-streaming ${request.type} request completed (${responseText.length} chars)`);
    return responseText;
  }
}

module.exports = OpenAIService;
