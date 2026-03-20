// ============================================================================
// GEMINI AI SERVICE - Invisibrain AI Assistant
// ============================================================================
// Rate limits: 15 RPM (free tier), 1M tokens/day
// Configured for: 10 RPM to be safe (6 seconds between requests)
// ============================================================================

const { GoogleGenerativeAI } = require('@google/generative-ai');
const {
  getDefaultGeminiModel,
  resolveGeminiModel,
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

class GeminiService {
  constructor(apiKey, options = {}) {
    this.apiKey = String(apiKey || '').trim();
    this.modelName = resolveGeminiModel(options.modelName);
    this.programmingLanguage = resolveProgrammingLanguage(options.programmingLanguage);
    this.genAI = new GoogleGenerativeAI(this.apiKey);

    this.requestQueue = [];
    this.lastRequestTime = 0;
    this.minRequestInterval = 6000;
    this.maxRetries = 3;
    this.isProcessing = false;

    this.dailyTokenCount = 0;
    this.maxDailyTokens = 4000000;
    this.lastResetTime = Date.now();

    this.conversationHistory = [];
    this.maxHistoryLength = 20;

    this._initializeModel();
  }

  _initializeModel() {
    try {
      console.log('Initializing Gemini model:', this.modelName);
      this.model = this.genAI.getGenerativeModel({
        model: this.modelName
      });
    } catch (error) {
      const fallbackModel = getDefaultGeminiModel();
      console.warn(`Primary model failed, using fallback ${fallbackModel}:`, error);
      this.modelName = fallbackModel;
      this.model = this.genAI.getGenerativeModel({
        model: fallbackModel
      });
    }
  }

  updateConfiguration(options = {}) {
    const previousProgrammingLanguage = this.programmingLanguage;
    const nextApiKey = String(options.apiKey ?? this.apiKey ?? '').trim();
    const nextModelName = resolveGeminiModel(options.modelName ?? this.modelName);
    const nextProgrammingLanguage = resolveProgrammingLanguage(
      options.programmingLanguage ?? this.programmingLanguage
    );

    const apiKeyChanged = nextApiKey !== this.apiKey;
    const modelChanged = nextModelName !== this.modelName;
    const programmingLanguageChanged = nextProgrammingLanguage !== previousProgrammingLanguage;

    if (apiKeyChanged) {
      this.apiKey = nextApiKey;
      this.genAI = new GoogleGenerativeAI(this.apiKey);
    }

    if (apiKeyChanged || modelChanged) {
      this.modelName = nextModelName;
      this._initializeModel();
    }

    this.programmingLanguage = nextProgrammingLanguage;

    return {
      apiKeyChanged,
      modelChanged,
      programmingLanguageChanged
    };
  }

  checkAndResetDailyLimit() {
    const now = Date.now();
    const dayInMs = 24 * 60 * 60 * 1000;

    if (now - this.lastResetTime >= dayInMs) {
      console.log('Resetting daily token count');
      this.dailyTokenCount = 0;
      this.lastResetTime = now;
    }
  }

  estimateTokens(text) {
    return Math.ceil(text.length / 4);
  }

  isQuotaExhaustedError(error) {
    const message = String(error?.message || '').toLowerCase();

    return (
      message.includes('quota exceeded') ||
      message.includes('exceeded your current quota') ||
      message.includes('generate_content_free_tier_requests') ||
      message.includes('generaterequestsperdayperprojectpermodel') ||
      message.includes('perdayperprojectpermodel') ||
      message.includes('daily request limit')
    );
  }

  isAuthenticationError(error) {
    const message = String(error?.message || '').toLowerCase();

    return (
      message.includes('api key not valid') ||
      message.includes('invalid api key') ||
      message.includes('api_key_invalid') ||
      message.includes('401') ||
      message.includes('403') ||
      message.includes('permission denied') ||
      message.includes('permission_denied') ||
      message.includes('unauthorized') ||
      message.includes('forbidden')
    );
  }

  isRetryableError(error) {
    const message = String(error?.message || '');

    return (
      message.includes('429') ||
      message.includes('500') ||
      message.includes('503') ||
      message.includes('RATE_LIMIT')
    );
  }

  async waitForRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.minRequestInterval) {
      const waitTime = this.minRequestInterval - timeSinceLastRequest;
      console.log(`Rate limit: waiting ${waitTime}ms`);
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
      this.checkAndResetDailyLimit();

      const estimatedTokens = this.estimateTokens(JSON.stringify(request.data));
      if (this.dailyTokenCount + estimatedTokens > this.maxDailyTokens) {
        throw new Error('Daily token limit reached');
      }

      // Streaming path: use generateContentStream when onChunk callback is provided
      if (typeof request.onChunk === 'function') {
        console.log(`[Gemini API] Streaming ${request.type} request started`);
        const streamResult = await this.model.generateContentStream(request.data);
        let fullText = '';
        let chunkIndex = 0;

        for await (const chunk of streamResult.stream) {
          const chunkText = chunk.text();
          if (chunkText) {
            fullText += chunkText;
            chunkIndex += 1;
            if (!request._firstChunkSent) {
              request._firstChunkSent = true;
            }
            request.onChunk({ text: chunkText, index: chunkIndex });
          }
        }

        this.dailyTokenCount += this.estimateTokens(fullText);
        console.log(`[Gemini API] Streaming ${request.type} request completed (${chunkIndex} chunks, ${fullText.length} chars)`);
        return fullText;
      }

      // Non-streaming path (existing behavior)
      console.log(`[Gemini API] Non-streaming ${request.type} request started`);
      let result;
      if (request.type === 'text') {
        result = await this.model.generateContent(request.data);
      } else if (request.type === 'multimodal') {
        result = await this.model.generateContent(request.data);
      } else {
        throw new Error(`Unsupported Gemini request type: ${request.type}`);
      }

      this.dailyTokenCount += estimatedTokens;

      const responseText = result.response.text();
      console.log(`[Gemini API] Non-streaming ${request.type} request completed (${responseText.length} chars)`);
      return responseText;
    } catch (error) {
      console.error(`Request error (attempt ${retryCount + 1}):`, error.message);

      if (this.isQuotaExhaustedError(error)) {
        console.error('Quota-exhausted error detected. Skipping retries.');
        throw error;
      }

      // Skip retries if streaming chunks were already sent to avoid duplicate content
      if (request._firstChunkSent) {
        throw error;
      }

      if (retryCount < this.maxRetries) {
        const isRetryable = this.isRetryableError(error);

        if (isRetryable) {
          const backoffTime = Math.pow(2, retryCount) * 2000;
          console.log(`Retrying in ${backoffTime}ms...`);
          await new Promise((resolve) => setTimeout(resolve, backoffTime));
          return this._executeRequest(request, retryCount + 1);
        }
      }

      throw error;
    }
  }

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

  async generateText(prompt, options = {}) {
    return new Promise((resolve, reject) => {
      const request = {
        type: 'text',
        data: prompt,
        resolve,
        reject,
        onChunk: typeof options.onChunk === 'function' ? options.onChunk : null
      };

      this.requestQueue.push(request);
      this.processQueue();
    });
  }

  async generateMultimodal(parts, options = {}) {
    return new Promise((resolve, reject) => {
      const request = {
        type: 'multimodal',
        data: parts,
        resolve,
        reject,
        onChunk: typeof options.onChunk === 'function' ? options.onChunk : null
      };

      this.requestQueue.push(request);
      this.processQueue();
    });
  }

  async analyzeScreenshots(imageParts, additionalContext = '', options = {}) {
    const contextString = typeof options.contextStringOverride === 'string'
      ? options.contextStringOverride
      : this.getContextString();
    const prompt = buildScreenshotAnalysisPrompt({
      contextString,
      additionalContext,
      programmingLanguage: this.programmingLanguage
    });

    const streamOptions = { onChunk: options.onChunk };
    const result = await this.generateMultimodal([
      { text: prompt },
      ...imageParts
    ], streamOptions);

    this.addToHistory('assistant', `Screenshot analysis: ${result}`);
    return result;
  }

  async analyzeScreenshot(imageBase64, additionalContext = '') {
    return this.analyzeScreenshots(
      [
        {
          inlineData: {
            mimeType: 'image/png',
            data: imageBase64
          }
        }
      ],
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
    const result = await this.generateMultimodal([
      { text: prompt },
      ...imageParts
    ], streamOptions);

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

module.exports = GeminiService;
