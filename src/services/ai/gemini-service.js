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

      let result;
      if (request.type === 'text') {
        result = await this.model.generateContent(request.data);
      } else if (request.type === 'multimodal') {
        result = await this.model.generateContent(request.data);
      } else {
        throw new Error(`Unsupported Gemini request type: ${request.type}`);
      }

      this.dailyTokenCount += estimatedTokens;

      return result.response.text();
    } catch (error) {
      console.error(`Request error (attempt ${retryCount + 1}):`, error.message);

      if (retryCount < this.maxRetries) {
        const isRetryable =
          error.message.includes('429') ||
          error.message.includes('500') ||
          error.message.includes('503') ||
          error.message.includes('RATE_LIMIT');

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

  async generateText(prompt) {
    return new Promise((resolve, reject) => {
      const request = {
        type: 'text',
        data: prompt,
        resolve,
        reject
      };

      this.requestQueue.push(request);
      this.processQueue();
    });
  }

  async generateMultimodal(parts) {
    return new Promise((resolve, reject) => {
      const request = {
        type: 'multimodal',
        data: parts,
        resolve,
        reject
      };

      this.requestQueue.push(request);
      this.processQueue();
    });
  }

  async analyzeScreenshots(imageParts, additionalContext = '') {
    const contextString = this.getContextString();
    const prompt = buildScreenshotAnalysisPrompt({
      contextString,
      additionalContext,
      programmingLanguage: this.programmingLanguage
    });

    const result = await this.generateMultimodal([
      { text: prompt },
      ...imageParts
    ]);

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
    const contextString = this.getContextString();
    const prompt = buildAskAiSessionPrompt({
      contextString,
      transcriptContext: options.transcriptContext || '',
      sessionSummary: options.sessionSummary || '',
      screenshotCount: options.screenshotCount || 0,
      mode: options.mode || 'best-next-answer'
    });

    const result = await this.generateText(prompt);
    this.addToHistory('assistant', `Ask AI: ${result}`);
    return result;
  }

  async askAiWithSessionContextAndScreenshots(imageParts, options = {}) {
    const contextString = this.getContextString();
    const prompt = buildAskAiSessionPrompt({
      contextString,
      transcriptContext: options.transcriptContext || '',
      sessionSummary: options.sessionSummary || '',
      screenshotCount: options.screenshotCount || imageParts.length,
      mode: options.mode || 'best-next-answer'
    });

    const result = await this.generateMultimodal([
      { text: prompt },
      ...imageParts
    ]);

    this.addToHistory('assistant', `Ask AI: ${result}`);
    return result;
  }

  async suggestResponse(context) {
    const contextString = this.getContextString();
    const prompt = buildSuggestResponsePrompt({
      contextString,
      context
    });

    return this.generateText(prompt);
  }

  async generateMeetingNotes() {
    if (this.conversationHistory.length === 0) {
      return 'No conversation history to summarize.';
    }

    const contextString = this.getContextString();
    const prompt = buildMeetingNotesPrompt({ contextString });
    return this.generateText(prompt);
  }

  async generateFollowUpEmail() {
    if (this.conversationHistory.length === 0) {
      return 'No conversation history to create email from.';
    }

    const contextString = this.getContextString();
    const prompt = buildFollowUpEmailPrompt({ contextString });
    return this.generateText(prompt);
  }

  async answerQuestion(question) {
    const contextString = this.getContextString();
    const prompt = buildAnswerQuestionPrompt({
      contextString,
      question,
      programmingLanguage: this.programmingLanguage
    });

    const result = await this.generateText(prompt);
    this.addToHistory('user', question);
    this.addToHistory('assistant', result);
    return result;
  }

  async getConversationInsights() {
    if (this.conversationHistory.length === 0) {
      return 'Not enough conversation data for insights.';
    }

    const contextString = this.getContextString();
    const prompt = buildInsightsPrompt({ contextString });
    return this.generateText(prompt);
  }
}

module.exports = GeminiService;
