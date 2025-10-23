// Gemini API Service with Rate Limiting and Advanced Features
// Rate limits for Gemini 1.5 Flash: 15 RPM (free tier), 1M tokens/day
// Using 10 RPM to be safe

const { GoogleGenerativeAI } = require('@google/generative-ai');

class GeminiService {
    constructor(apiKey) {
        this.genAI = new GoogleGenerativeAI(apiKey);
        // Try different model names for compatibility
        // gemini-pro is the most widely supported free model
        try {
            this.model = this.genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
        } catch (e) {
            console.warn('gemini-pro failed, trying gemini-1.5-flash-latest:', e);
            this.model = this.genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
        }

        // Rate limiting
        this.requestQueue = [];
        this.lastRequestTime = 0;
        this.minRequestInterval = 6000; // 6 seconds between requests (10 RPM = 1 per 6s)
        this.maxRetries = 3;
        this.isProcessing = false;

        // Token tracking
        this.dailyTokenCount = 0;
        this.maxDailyTokens = 4000000; // 4M tokens per day
        this.lastResetTime = Date.now();

        // Conversation context
        this.conversationHistory = [];
        this.maxHistoryLength = 20;
    }

    // Reset daily token count
    checkAndResetDailyLimit() {
        const now = Date.now();
        const dayInMs = 24 * 60 * 60 * 1000;

        if (now - this.lastResetTime >= dayInMs) {
            console.log('Resetting daily token count');
            this.dailyTokenCount = 0;
            this.lastResetTime = now;
        }
    }

    // Estimate token count (rough approximation)
    estimateTokens(text) {
        // Rough estimate: 1 token ≈ 4 characters
        return Math.ceil(text.length / 4);
    }

    // Wait for rate limit
    async waitForRateLimit() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;

        if (timeSinceLastRequest < this.minRequestInterval) {
            const waitTime = this.minRequestInterval - timeSinceLastRequest;
            console.log(`Rate limit: waiting ${waitTime}ms`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        this.lastRequestTime = Date.now();
    }

    // Process queue
    async processQueue() {
        if (this.isProcessing || this.requestQueue.length === 0) return;

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

    // Execute request with retry logic
    async _executeRequest(request, retryCount = 0) {
        try {
            this.checkAndResetDailyLimit();

            // Check daily token limit
            const estimatedTokens = this.estimateTokens(JSON.stringify(request.data));
            if (this.dailyTokenCount + estimatedTokens > this.maxDailyTokens) {
                throw new Error('Daily token limit reached');
            }

            let result;

            if (request.type === 'text') {
                result = await this.model.generateContent(request.data);
            } else if (request.type === 'multimodal') {
                result = await this.model.generateContent(request.data);
            }

            // Update token count
            this.dailyTokenCount += estimatedTokens;

            const text = result.response.text();
            return text;

        } catch (error) {
            console.error(`Request error (attempt ${retryCount + 1}):`, error.message);

            // Retry on rate limit or server errors
            if (retryCount < this.maxRetries) {
                const isRetryable =
                    error.message.includes('429') ||
                    error.message.includes('500') ||
                    error.message.includes('503') ||
                    error.message.includes('RATE_LIMIT');

                if (isRetryable) {
                    const backoffTime = Math.pow(2, retryCount) * 2000; // Exponential backoff
                    console.log(`Retrying in ${backoffTime}ms...`);
                    await new Promise(resolve => setTimeout(resolve, backoffTime));
                    return await this._executeRequest(request, retryCount + 1);
                }
            }

            throw error;
        }
    }

    // Add to conversation history
    addToHistory(role, content) {
        this.conversationHistory.push({ role, content });

        // Keep only recent history
        if (this.conversationHistory.length > this.maxHistoryLength) {
            this.conversationHistory = this.conversationHistory.slice(-this.maxHistoryLength);
        }
    }

    // Clear conversation history
    clearHistory() {
        this.conversationHistory = [];
    }

    // Get conversation context
    getContextString() {
        return this.conversationHistory
            .map(entry => `${entry.role}: ${entry.content}`)
            .join('\n\n');
    }

    // Queue a text request
    async generateText(prompt, options = {}) {
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

    // Queue a multimodal request (text + images)
    async generateMultimodal(parts, options = {}) {
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

    // Analyze screenshot with context
    async analyzeScreenshot(imageBase64, additionalContext = '') {
        const contextString = this.getContextString();

        const prompt = `You are an AI meeting assistant helping the user during a live conversation.

${contextString ? `Previous conversation context:\n${contextString}\n\n` : ''}

${additionalContext ? `Additional context:\n${additionalContext}\n\n` : ''}

Analyze this screenshot and provide:
1. Key information visible on screen
2. Relevant insights or suggestions
3. If there's text/questions visible, provide a brief, helpful response

Keep your response concise, actionable, and directly useful for the meeting.`;

        const parts = [
            { text: prompt },
            {
                inlineData: {
                    mimeType: 'image/png',
                    data: imageBase64
                }
            }
        ];

        const result = await this.generateMultimodal(parts);
        this.addToHistory('assistant', `Screenshot analysis: ${result}`);
        return result;
    }

    // "What should I say?" feature
    async suggestResponse(context) {
        const contextString = this.getContextString();

        const prompt = `You are an AI meeting assistant. Based on the conversation so far, suggest 2-3 brief, professional responses the user could say.

${contextString ? `Conversation history:\n${contextString}\n\n` : ''}

Current situation: ${context}

Provide 2-3 short, natural response options (1-2 sentences each) that would be appropriate. Format as:
1. [response option]
2. [response option]
3. [response option]`;

        const result = await this.generateText(prompt);
        return result;
    }

    // Generate meeting notes
    async generateMeetingNotes() {
        if (this.conversationHistory.length === 0) {
            return 'No conversation history to summarize.';
        }

        const contextString = this.getContextString();

        const prompt = `Create concise meeting notes from this conversation:

${contextString}

Format:
# Meeting Summary
[Brief overview]

## Key Discussion Points
- [Point 1]
- [Point 2]

## Action Items
- [ ] [Action item]
- [ ] [Action item]

## Important Details
- [Detail 1]
- [Detail 2]`;

        const result = await this.generateText(prompt);
        return result;
    }

    // Generate follow-up email
    async generateFollowUpEmail() {
        if (this.conversationHistory.length === 0) {
            return 'No conversation history to create email from.';
        }

        const contextString = this.getContextString();

        const prompt = `Create a professional follow-up email based on this meeting conversation:

${contextString}

Format as a complete email with:
- Subject line
- Professional greeting
- Summary of discussion
- Next steps
- Professional closing

Keep it concise and professional.`;

        const result = await this.generateText(prompt);
        return result;
    }

    // Answer specific question with context
    async answerQuestion(question) {
        const contextString = this.getContextString();

        const prompt = `${contextString ? `Conversation context:\n${contextString}\n\n` : ''}

Question: ${question}

Provide a brief, helpful answer (2-3 sentences max).`;

        const result = await this.generateText(prompt);
        this.addToHistory('user', question);
        this.addToHistory('assistant', result);
        return result;
    }

    // Get conversation insights
    async getConversationInsights() {
        if (this.conversationHistory.length === 0) {
            return 'Not enough conversation data for insights.';
        }

        const contextString = this.getContextString();

        const prompt = `Analyze this conversation and provide brief insights:

${contextString}

Provide:
1. Main topics discussed (2-3 bullet points)
2. Key decisions or conclusions (2-3 bullet points)
3. Suggested follow-up topics (2-3 bullet points)

Keep it very concise.`;

        const result = await this.generateText(prompt);
        return result;
    }
}

module.exports = GeminiService;
