// ============================================================================
// BASE AI PROVIDER SERVICE
// ============================================================================
// Shared machinery every SDK-backed provider needs: request queue with rate
// limiting and retries, conversation history, and the six action methods that
// all render through the shared prompt builders in ./prompts.js.
//
// Subclasses implement:
//   _performRequest(request)  -> resolves to the full response text.
//     request = { type: 'text' | 'multimodal', prompt, images, onChunk, ... }
//     - prompt: the fully-built prompt string (system + user content combined
//       by the prompt builders; providers split it into their SDK's shape)
//     - images: normalized [{ mimeType, data, bytes }] from splitImageParts()
//     - onChunk: optional streaming callback; set request._firstChunkSent = true
//       before the first emit so the retry logic never double-sends content.
//   ready()              -> boolean
//   supportsImages       -> boolean property
// Subclasses may override the error classifiers; the defaults use
// classifyProviderError() which understands HTTP statuses and AWS error names.
// ============================================================================

const {
  resolveProgrammingLanguage
} = require('../../config');
const {
  buildAnswerQuestionPrompt,
  buildAskAiSessionPrompt,
  buildFollowUpEmailPrompt,
  buildInsightsPrompt,
  buildMeetingNotesPrompt,
  buildScreenshotAnalysisPrompt,
  buildSuggestResponsePrompt
} = require('./prompts');
const { classifyProviderError, splitImageParts } = require('./provider-contract');

// Appended to image-based prompts when the active model cannot see images and
// only extracted screen text is available.
const TEXT_ONLY_SCREEN_NOTE = '[Note: This model cannot see images. The extracted screen text below is the ONLY screen content available — answer from it, and say when the text is not enough.]';

class BaseProviderService {
  constructor(options = {}) {
    this.programmingLanguage = resolveProgrammingLanguage(options.programmingLanguage);

    this.requestQueue = [];
    this.lastRequestTime = 0;
    this.minRequestInterval = options.minRequestInterval ?? 1000;
    this.maxRetries = options.maxRetries ?? 2;
    this.isProcessing = false;

    this.conversationHistory = [];
    this.maxHistoryLength = 20;
  }

  // -- Contract surface subclasses must provide -----------------------------
  get supportsImages() {
    return false;
  }

  ready() {
    return false;
  }

  updateConfiguration(options = {}) {
    const previousProgrammingLanguage = this.programmingLanguage;
    this.programmingLanguage = resolveProgrammingLanguage(
      options.programmingLanguage ?? this.programmingLanguage
    );
    return {
      apiKeyChanged: false,
      modelChanged: false,
      programmingLanguageChanged: this.programmingLanguage !== previousProgrammingLanguage
    };
  }

  async _performRequest(_request) {
    throw new Error(`${this.constructor.name} does not implement _performRequest()`);
  }

  // -- Error classification (override for provider-specific rules) ----------
  isAuthenticationError(error) {
    return classifyProviderError(error) === 'auth';
  }

  isQuotaExhaustedError(error) {
    return classifyProviderError(error) === 'quota';
  }

  isRetryableError(error) {
    const classification = classifyProviderError(error);
    return classification === 'quota' || classification === 'timeout' || classification === 'connection';
  }

  // -- Request queue ---------------------------------------------------------
  async waitForRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.minRequestInterval) {
      const waitTime = this.minRequestInterval - timeSinceLastRequest;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
  }

  async processQueue() {
    if (this.isProcessing || this.requestQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.requestQueue.length > 0) {
      const request = this.requestQueue.shift();

      try {
        await this.waitForRateLimit();
        const result = await this._executeRequest(request);
        request.resolve(result);
      } catch (error) {
        request.reject(error);
      }
    }

    this.isProcessing = false;
  }

  async _executeRequest(request, retryCount = 0) {
    try {
      return await this._performRequest(request);
    } catch (error) {
      console.error(`${this.constructor.name} request error (attempt ${retryCount + 1}):`, error.message);

      if (this.isQuotaExhaustedError(error)) {
        throw error;
      }

      // Skip retries once streaming chunks went out to avoid duplicate content.
      if (request._firstChunkSent) {
        throw error;
      }

      if (retryCount < this.maxRetries && this.isRetryableError(error)) {
        const backoffTime = Math.pow(2, retryCount) * 1000;
        console.log(`Retrying ${this.constructor.name} request in ${backoffTime}ms...`);
        await new Promise((resolve) => setTimeout(resolve, backoffTime));
        return this._executeRequest(request, retryCount + 1);
      }

      throw error;
    }
  }

  _enqueue(request) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ ...request, resolve, reject });
      this.processQueue();
    });
  }

  generateText(prompt, options = {}) {
    return this._enqueue({
      type: 'text',
      prompt,
      images: [],
      onChunk: typeof options.onChunk === 'function' ? options.onChunk : null
    });
  }

  generateMultimodal(parts, options = {}) {
    const { texts, images } = splitImageParts(parts);
    return this._enqueue({
      type: 'multimodal',
      prompt: texts.join('\n'),
      images,
      onChunk: typeof options.onChunk === 'function' ? options.onChunk : null
    });
  }

  // -- Conversation history ---------------------------------------------------
  addToHistory(role, content) {
    this.conversationHistory.push({ role, content });

    if (this.conversationHistory.length > this.maxHistoryLength) {
      this.conversationHistory = this.conversationHistory.slice(-this.maxHistoryLength);
    }
  }

  clearHistory() {
    this.conversationHistory = [];
  }

  getContextString() {
    return this.conversationHistory
      .map((entry) => `${entry.role}: ${entry.content}`)
      .join('\n\n');
  }

  // -- Actions (shared prompt builders; no provider-specific prompt text) -----
  async analyzeScreenshots(imageParts, additionalContext = '', options = {}) {
    const contextString = typeof options.contextStringOverride === 'string'
      ? options.contextStringOverride
      : this.getContextString();
    const prompt = buildScreenshotAnalysisPrompt({
      contextString,
      additionalContext,
      programmingLanguage: this.programmingLanguage,
      screenshotCount: imageParts.length
    });

    const streamOptions = { onChunk: options.onChunk };
    const canSeeImages = this.supportsImages && !options.forceTextOnly;
    const result = canSeeImages
      ? await this.generateMultimodal([{ text: prompt }, ...imageParts], streamOptions)
      : await this.generateText(`${prompt}\n\n${TEXT_ONLY_SCREEN_NOTE}`, streamOptions);

    this.addToHistory('assistant', `Screenshot analysis: ${result}`);
    return result;
  }

  async analyzeScreenshot(imageBase64, additionalContext = '') {
    return this.analyzeScreenshots(
      [{ inlineData: { mimeType: 'image/png', data: imageBase64 } }],
      additionalContext
    );
  }

  async askAiWithSessionContext(options = {}) {
    const contextString = typeof options.contextString === 'string'
      ? options.contextString
      : this.getContextString();
    const prompt = buildAskAiSessionPrompt({
      contextString,
      transcriptContext: options.transcriptContext || '',
      sessionSummary: options.sessionSummary || '',
      screenshotCount: options.screenshotCount || 0,
      mode: options.mode || 'best-next-answer'
    });

    const streamOptions = { onChunk: options.onChunk };
    const result = await this.generateText(prompt, streamOptions);
    this.addToHistory('assistant', `Ask AI: ${result}`);
    return result;
  }

  async askAiWithSessionContextAndScreenshots(imageParts, options = {}) {
    const contextString = typeof options.contextString === 'string'
      ? options.contextString
      : this.getContextString();
    const prompt = buildAskAiSessionPrompt({
      contextString,
      transcriptContext: options.transcriptContext || '',
      sessionSummary: options.sessionSummary || '',
      screenshotCount: options.screenshotCount || imageParts.length,
      mode: options.mode || 'best-next-answer'
    });

    const streamOptions = { onChunk: options.onChunk };
    const canSeeImages = this.supportsImages && !options.forceTextOnly;
    const result = canSeeImages
      ? await this.generateMultimodal([{ text: prompt }, ...imageParts], streamOptions)
      : await this.generateText(`${prompt}\n\n${TEXT_ONLY_SCREEN_NOTE}`, streamOptions);

    this.addToHistory('assistant', `Ask AI: ${result}`);
    return result;
  }

  async suggestResponse(context, options = {}) {
    const contextString = typeof options.contextString === 'string'
      ? options.contextString
      : this.getContextString();
    const prompt = buildSuggestResponsePrompt({
      contextString,
      context
    });

    const streamOptions = { onChunk: options.onChunk };
    return this.generateText(prompt, streamOptions);
  }

  async generateMeetingNotes(options = {}) {
    const contextString = typeof options.contextString === 'string'
      ? options.contextString
      : this.getContextString();
    if (!contextString.trim()) {
      return 'No conversation history to summarize.';
    }
    const prompt = buildMeetingNotesPrompt({ contextString });
    const streamOptions = { onChunk: options.onChunk };
    return this.generateText(prompt, streamOptions);
  }

  async generateFollowUpEmail(options = {}) {
    if (this.conversationHistory.length === 0) {
      return 'No conversation history to create email from.';
    }

    const contextString = this.getContextString();
    const prompt = buildFollowUpEmailPrompt({ contextString });
    const streamOptions = { onChunk: options.onChunk };
    return this.generateText(prompt, streamOptions);
  }

  async answerQuestion(question, options = {}) {
    const contextString = this.getContextString();
    const prompt = buildAnswerQuestionPrompt({
      contextString,
      question,
      programmingLanguage: this.programmingLanguage
    });

    const streamOptions = { onChunk: options.onChunk };
    const result = await this.generateText(prompt, streamOptions);
    this.addToHistory('user', question);
    this.addToHistory('assistant', result);
    return result;
  }

  async getConversationInsights(options = {}) {
    const contextString = typeof options.contextString === 'string'
      ? options.contextString
      : this.getContextString();
    if (!contextString.trim()) {
      return 'Not enough conversation data for insights.';
    }
    const prompt = buildInsightsPrompt({ contextString });
    const streamOptions = { onChunk: options.onChunk };
    return this.generateText(prompt, streamOptions);
  }
}

module.exports = BaseProviderService;
