// ============================================================================
// OLLAMA AI SERVICE - Open-Cluely AI Assistant
// ============================================================================
// Uses Ollama's OpenAI-compatible API for local LLM inference.
// Implements the same public interface as GeminiService so the runtime
// can swap providers transparently.
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

const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
const DEFAULT_OLLAMA_MODEL = 'llama3.2';

class OllamaService {
  constructor(options = {}) {
    this.baseUrl = String(options.baseUrl || DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, '');
    this.modelName = String(options.modelName || DEFAULT_OLLAMA_MODEL).trim();
    this.programmingLanguage = resolveProgrammingLanguage(options.programmingLanguage);

    this.requestQueue = [];
    this.lastRequestTime = 0;
    this.minRequestInterval = 500;
    this.maxRetries = 2;
    this.isProcessing = false;

    this.conversationHistory = [];
    this.maxHistoryLength = 20;

    // Unused but kept for interface compatibility with GeminiService
    this.dailyTokenCount = 0;
    this.maxDailyTokens = Infinity;
    this.lastResetTime = Date.now();
    this.apiKey = '';

    console.log('OllamaService initialized:', this.modelName, 'at', this.baseUrl);
  }

  updateConfiguration(options = {}) {
    const previousProgrammingLanguage = this.programmingLanguage;
    const nextBaseUrl = String(options.baseUrl ?? this.baseUrl).replace(/\/+$/, '');
    const nextModelName = String(options.modelName ?? this.modelName).trim();
    const nextProgrammingLanguage = resolveProgrammingLanguage(
      options.programmingLanguage ?? this.programmingLanguage
    );

    const baseUrlChanged = nextBaseUrl !== this.baseUrl;
    const modelChanged = nextModelName !== this.modelName;
    const programmingLanguageChanged = nextProgrammingLanguage !== previousProgrammingLanguage;

    this.baseUrl = nextBaseUrl;
    this.modelName = nextModelName;
    this.programmingLanguage = nextProgrammingLanguage;

    return {
      apiKeyChanged: baseUrlChanged,
      modelChanged,
      programmingLanguageChanged
    };
  }

  isQuotaExhaustedError() {
    return false;
  }

  isAuthenticationError() {
    return false;
  }

  isRetryableError(error) {
    const message = String(error?.message || '');
    return (
      message.includes('ECONNREFUSED') ||
      message.includes('ECONNRESET') ||
      message.includes('fetch failed') ||
      message.includes('500') ||
      message.includes('503')
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
      console.error(`Ollama request error (attempt ${retryCount + 1}):`, error.message);

      if (request._firstChunkSent) {
        throw error;
      }

      if (retryCount < this.maxRetries && this.isRetryableError(error)) {
        const backoffTime = Math.pow(2, retryCount) * 1000;
        console.log(`Retrying Ollama request in ${backoffTime}ms...`);
        await new Promise((resolve) => setTimeout(resolve, backoffTime));
        return this._executeRequest(request, retryCount + 1);
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

  async _chat(prompt) {
    const url = `${this.baseUrl}/api/chat`;
    const messages = this._buildMessages(prompt);

    console.log(`[Ollama API] Non-streaming request started (model: ${this.modelName})`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.modelName,
        messages,
        stream: false
      })
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Ollama API error ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    const responseText = result.message?.content || '';

    console.log(`[Ollama API] Non-streaming request completed (${responseText.length} chars)`);
    return responseText;
  }

  async _streamChat(prompt, request) {
    const url = `${this.baseUrl}/api/chat`;
    const messages = this._buildMessages(prompt);

    console.log(`[Ollama API] Streaming request started (model: ${this.modelName})`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.modelName,
        messages,
        stream: true
      })
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Ollama API error ${response.status}: ${errorText}`);
    }

    let fullText = '';
    let chunkIndex = 0;
    const reader = response.body;

    // Node.js fetch returns a ReadableStream; iterate with async for-of on the body
    const decoder = new TextDecoder();
    let buffer = '';

    for await (const chunk of reader) {
      buffer += decoder.decode(chunk, { stream: true });

      // Each line is a JSON object separated by newlines
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const parsed = JSON.parse(trimmed);
          const content = parsed.message?.content || '';
          if (content) {
            fullText += content;
            chunkIndex += 1;
            if (!request._firstChunkSent) {
              request._firstChunkSent = true;
            }
            request.onChunk({ text: content, index: chunkIndex });
          }
        } catch {
          // skip malformed lines
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer.trim());
        const content = parsed.message?.content || '';
        if (content) {
          fullText += content;
          chunkIndex += 1;
          request.onChunk({ text: content, index: chunkIndex });
        }
      } catch {
        // skip
      }
    }

    console.log(`[Ollama API] Streaming request completed (${chunkIndex} chunks, ${fullText.length} chars)`);
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
    // Ollama doesn't support inline image data the same way Gemini does.
    // We extract text parts and pass them as a text-only prompt.
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
    // For Ollama we pass the prompt as text; image data is not forwarded
    const result = await this.generateText(
      `${prompt}\n\n[Note: ${imageParts.length} screenshot(s) were captured but image analysis requires a vision-capable model. Respond based on the text context provided.]`,
      streamOptions
    );

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
    const result = await this.generateText(
      `${prompt}\n\n[Note: ${imageParts.length} screenshot(s) were captured but image analysis requires a vision-capable model.]`,
      streamOptions
    );

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

module.exports = OllamaService;
