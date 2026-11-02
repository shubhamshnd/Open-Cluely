// ============================================================================
// DEEPSEEK AI SERVICE - Open-Cluely AI Assistant
// ============================================================================
// Uses DeepSeek's OpenAI-compatible Chat Completions API (https://api.deepseek.com)
// Implements the same public interface as GeminiService so the runtime
// can swap providers transparently.
// ============================================================================

const {
  getDefaultDeepSeekBaseUrl,
  getDefaultDeepSeekModel,
  resolveDeepSeekModel,
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

function mapToDeepSeekApiModelId(modelName) {
  const normalized = String(modelName || '').trim().toLowerCase();
  if (!normalized || normalized === 'deepseek-v4' || normalized === 'deepseek-v3') {
    // DeepSeek's official API endpoint uses 'deepseek-chat' for the flagship V3/V4 model
    return 'deepseek-chat';
  }
  return String(modelName).trim();
}

class DeepSeekService {
  constructor(apiKey, options = {}) {
    this.apiKey = String(apiKey || '').trim();
    this.baseUrl = String(options.baseUrl || getDefaultDeepSeekBaseUrl()).replace(/\/+$/, '');
    this.modelName = resolveDeepSeekModel(options.modelName || getDefaultDeepSeekModel());
    this.model = this.modelName;
    this.programmingLanguage = resolveProgrammingLanguage(options.programmingLanguage);

    this.requestQueue = [];
    this.lastRequestTime = 0;
    this.minRequestInterval = 500;
    this.maxRetries = 2;
    this.isProcessing = false;

    this.conversationHistory = [];
    this.maxHistoryLength = 20;

    this.dailyTokenCount = 0;
    this.maxDailyTokens = Infinity;
    this.lastResetTime = Date.now();

    console.log('DeepSeekService initialized:', this.modelName, 'at', this.baseUrl);
  }

  updateConfiguration(options = {}) {
    const previousProgrammingLanguage = this.programmingLanguage;
    const nextApiKey = String(options.apiKey ?? this.apiKey ?? '').trim();
    const nextBaseUrl = String(options.baseUrl ?? this.baseUrl).replace(/\/+$/, '');
    const nextModelName = resolveDeepSeekModel(options.modelName ?? this.modelName);
    const nextProgrammingLanguage = resolveProgrammingLanguage(
      options.programmingLanguage ?? this.programmingLanguage
    );

    const apiKeyChanged = nextApiKey !== this.apiKey;
    const baseUrlChanged = nextBaseUrl !== this.baseUrl;
    const modelChanged = nextModelName !== this.modelName;
    const programmingLanguageChanged = nextProgrammingLanguage !== previousProgrammingLanguage;

    this.apiKey = nextApiKey;
    this.baseUrl = nextBaseUrl;
    this.modelName = nextModelName;
    this.model = nextModelName;
    this.programmingLanguage = nextProgrammingLanguage;

    return {
      apiKeyChanged: apiKeyChanged || baseUrlChanged,
      modelChanged,
      programmingLanguageChanged
    };
  }

  isQuotaExhaustedError(error) {
    const message = String(error?.message || '').toLowerCase();
    return (
      message.includes('insufficient balance') ||
      message.includes('insufficient_quota') ||
      message.includes('quota exceeded') ||
      message.includes('402')
    );
  }

  isAuthenticationError(error) {
    const message = String(error?.message || '').toLowerCase();
    return (
      message.includes('authentication fails') ||
      message.includes('invalid api key') ||
      message.includes('401') ||
      message.includes('403') ||
      message.includes('unauthorized')
    );
  }

  isRetryableError(error) {
    const message = String(error?.message || '');
    return (
      message.includes('429') ||
      message.includes('500') ||
      message.includes('502') ||
      message.includes('503') ||
      message.includes('ECONNRESET') ||
      message.includes('fetch failed')
    );
  }

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
      const prompt = typeof request.data === 'string'
        ? request.data
        : this._extractTextFromParts(request.data);

      if (typeof request.onChunk === 'function') {
        return await this._streamChat(prompt, request);
      }

      return await this._chat(prompt);
    } catch (error) {
      const causeMsg = error?.cause?.message ? ` (${error.cause.message})` : '';
      console.error(`DeepSeek request error (attempt ${retryCount + 1}): ${error.message}${causeMsg}`);

      if (this.isQuotaExhaustedError(error) || this.isAuthenticationError(error)) {
        throw error;
      }

      if (request._firstChunkSent) {
        throw error;
      }

      if (retryCount < this.maxRetries && this.isRetryableError(error)) {
        const backoffTime = Math.pow(2, retryCount) * 1500;
        console.log(`Retrying DeepSeek request in ${backoffTime}ms...`);
        await new Promise((resolve) => setTimeout(resolve, backoffTime));
        return this._executeRequest(request, retryCount + 1);
      }

      if (causeMsg && !error.message.includes(error.cause.message)) {
        throw new Error(`${error.message}${causeMsg}`);
      }
      throw error;
    }
  }

  _extractTextFromParts(data) {
    if (typeof data === 'string') {
      return data;
    }

    if (Array.isArray(data)) {
      const textParts = data
        .filter((part) => typeof part === 'string' || part?.text)
        .map((part) => (typeof part === 'string' ? part : part.text));
      return textParts.join('\n');
    }

    return String(data || '');
  }

  _buildMessages(prompt) {
    return [
      { role: 'system', content: 'You are a helpful AI assistant.' },
      { role: 'user', content: prompt }
    ];
  }

  _getChatCompletionsUrl() {
    if (this.baseUrl.endsWith('/chat/completions')) {
      return this.baseUrl;
    }
    return `${this.baseUrl}/chat/completions`;
  }

  async _chat(prompt) {
    const url = this._getChatCompletionsUrl();
    const messages = this._buildMessages(prompt);
    const apiModel = mapToDeepSeekApiModelId(this.modelName);

    console.log(`[DeepSeek API] Non-streaming request started (model: ${apiModel})`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: apiModel,
        messages,
        stream: false
      })
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`DeepSeek API error ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    const responseText = result.choices?.[0]?.message?.content || '';

    console.log(`[DeepSeek API] Non-streaming request completed (${responseText.length} chars)`);
    return responseText;
  }

  async _streamChat(prompt, request) {
    const url = this._getChatCompletionsUrl();
    const messages = this._buildMessages(prompt);
    const apiModel = mapToDeepSeekApiModelId(this.modelName);

    console.log(`[DeepSeek API] Streaming request started (model: ${apiModel})`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: apiModel,
        messages,
        stream: true
      })
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`DeepSeek API error ${response.status}: ${errorText}`);
    }

    let fullText = '';
    let chunkIndex = 0;
    const reader = response.body;
    const decoder = new TextDecoder();
    let buffer = '';

    for await (const chunk of reader) {
      buffer += decoder.decode(chunk, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || !line.startsWith('data:')) {
          continue;
        }

        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') {
          continue;
        }

        try {
          const parsed = JSON.parse(payload);
          const delta = parsed.choices?.[0]?.delta;
          const content = delta?.content || '';
          if (content) {
            fullText += content;
            chunkIndex += 1;
            if (!request._firstChunkSent) {
              request._firstChunkSent = true;
            }
            request.onChunk({ text: content, index: chunkIndex });
          }
        } catch {
          // ignore malformed SSE chunk
        }
      }
    }

    if (buffer.trim().startsWith('data:')) {
      const payload = buffer.trim().slice(5).trim();
      if (payload && payload !== '[DONE]') {
        try {
          const parsed = JSON.parse(payload);
          const content = parsed.choices?.[0]?.delta?.content || '';
          if (content) {
            fullText += content;
            chunkIndex += 1;
            request.onChunk({ text: content, index: chunkIndex });
          }
        } catch {
          // ignore
        }
      }
    }

    console.log(`[DeepSeek API] Streaming request completed (${chunkIndex} chunks, ${fullText.length} chars)`);
    return fullText;
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
      programmingLanguage: this.programmingLanguage,
      screenshotCount: imageParts.length
    });

    const streamOptions = { onChunk: options.onChunk };
    const result = await this.generateText(prompt, streamOptions);

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
    const result = await this.generateText(prompt, streamOptions);

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

module.exports = DeepSeekService;
