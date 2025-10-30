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

        const prompt = `You are Cluely AI - an intelligent assistant that helps users during meetings, interviews, and coding challenges in real-time.

${contextString ? `Previous conversation context:\n${contextString}\n\n` : ''}

${additionalContext ? `Additional context:\n${additionalContext}\n\n` : ''}

**ANALYSIS INSTRUCTIONS:**

1. **For Coding Problems (LeetCode, HackerRank, CodeForces, etc.):**
   - **DETECT THE PROGRAMMING LANGUAGE** from the screenshot (Python, Java, C++, JavaScript, Go, Rust, C#, etc.)
   - If no specific language is visible, default to Python
   - Identify the problem and provide a clear problem summary
   - Give **multiple solutions in the DETECTED LANGUAGE** (at least 2-3 approaches: brute force, optimized, and optimal)
   - For each solution, include:
     * Time complexity and Space complexity analysis
     * Step-by-step explanation of the approach
     * Clean, well-commented code in the DETECTED LANGUAGE
     * Mention edge cases to consider
   - Highlight which solution is recommended and why
   - Format code in markdown code blocks with proper language tag (e.g., \`\`\`python, \`\`\`java, \`\`\`cpp, \`\`\`javascript)

2. **For Technical Discussions/Meetings:**
   - Summarize key points being discussed
   - Provide relevant technical insights or clarifications
   - Suggest thoughtful questions or responses

3. **For General Questions:**
   - Provide clear, concise, and actionable information
   - Include examples where helpful
   - Anticipate follow-up questions

**OUTPUT FORMAT:**
Use clear markdown formatting with:
- **Bold** for important concepts
- Code blocks with proper language syntax highlighting (e.g., \`\`\`python, \`\`\`java, \`\`\`cpp, \`\`\`javascript, \`\`\`go, \`\`\`rust)
- Bullet points for lists
- Headers (##) for sections

**IMPORTANT:** Always use the programming language visible in the screenshot or interface. Do NOT force Python if another language is being used.

Keep responses comprehensive but well-organized. Be direct and practical.`;

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

        const prompt = `You are Cluely AI. Based on the conversation/situation, suggest 3-4 smart responses or talking points.

${contextString ? `Conversation history:\n${contextString}\n\n` : ''}

Current situation: ${context}

**Provide suggestions for:**
- If it's a coding problem:
  * Detect the programming language being used (Python, Java, C++, JavaScript, Go, etc.)
  * Provide key insights about the approach specific to that language
  * Suggest time/space complexity clarifications
  * Mention edge cases or language-specific considerations
- If it's an interview: Thoughtful questions, clarifications, or professional responses
- If it's a discussion: Relevant points to contribute or questions to ask

Format each suggestion clearly and make them natural to say out loud. Include WHY each suggestion is valuable.

Format as:
**Option 1:** [suggestion]
*Why:* [brief reason]

**Option 2:** [suggestion]
*Why:* [brief reason]

**Option 3:** [suggestion]
*Why:* [brief reason]`;

        const result = await this.generateText(prompt);
        return result;
    }

    // Generate meeting notes
    async generateMeetingNotes() {
        if (this.conversationHistory.length === 0) {
            return 'No conversation history to summarize.';
        }

        const contextString = this.getContextString();

        const prompt = `Create comprehensive notes from this session:

${contextString}

**Format based on content type:**

**For Coding Sessions:**
# Session Summary
[Brief overview of problems tackled]

## Problems Solved
- **Problem Name:** [Brief description]
  - Language: [Language used]
  - Approach: [Method used]
  - Complexity: Time O(X), Space O(Y)
  - Key insights: [Important points]

## Code Snippets
[Use the appropriate language code blocks: \`\`\`python, \`\`\`java, \`\`\`cpp, \`\`\`javascript, \`\`\`go, etc.]
\`\`\`language
[Key code solutions in the language that was used]
\`\`\`

## Lessons Learned
- [Technical insight 1]
- [Technical insight 2]

## Review Later
- [ ] [Concepts to practice]
- [ ] [Similar problems to solve]

**For Meetings/Discussions:**
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
- [Detail 2]

Use the format that best fits the content.`;

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

**Answer the question with:**
- If it's a coding/algorithm question:
  * Detect the programming language from context (or default to Python if unclear)
  * Provide code examples in that language
  * Explain time/space complexity
  * Mention edge cases
  * Use proper language code blocks (\`\`\`python, \`\`\`java, \`\`\`cpp, \`\`\`javascript, etc.)
- If it's a technical concept: Give clear explanation with examples
- If it's a general question: Provide concise, actionable answer

Use markdown formatting. Be thorough but concise.`;

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

        const prompt = `Analyze this session and provide actionable insights:

${contextString}

**Provide insights based on content:**

**For Coding Sessions:**
## 📊 Performance Analysis
- Algorithms used: [List approaches]
- Complexity patterns: [Time/space complexity trends]
- Problem-solving approach: [Your strategy]

## 💡 Key Learnings
- [Technical concept 1]
- [Technical concept 2]
- [Pattern or technique learned]

## 🎯 Improvement Areas
- [Skill to practice]
- [Concept to review]
- [Alternative approach to explore]

## 🔗 Related Topics to Study
- [Related algorithm/data structure]
- [Similar problem types]
- [Advanced techniques]

**For Meetings/Discussions:**
## Main Topics Discussed
- [Topic 1]
- [Topic 2]

## Key Decisions/Conclusions
- [Decision 1]
- [Decision 2]

## Suggested Follow-ups
- [Follow-up topic 1]
- [Follow-up topic 2]

Use the format that best matches the session content.`;

        const result = await this.generateText(prompt);
        return result;
    }
}

module.exports = GeminiService;
