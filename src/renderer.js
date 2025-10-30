// Renderer with Vosk Live Transcription - Real-time & Accurate!
// Uses Vosk model vosk-model-en-us-0.22 for offline, accurate transcription

let screenshotsCount = 0;
let isAnalyzing = false;
let stealthModeActive = false;
let stealthHideTimeout = null;
let isRecording = false;
let chatMessagesArray = [];
let currentPartialText = '';
let lastPartialMessageDiv = null;

// DOM elements
const statusText = document.getElementById('status-text');
const screenshotCount = document.getElementById('screenshot-count');
const resultsPanel = document.getElementById('results-panel');
const resultText = document.getElementById('result-text');
const loadingOverlay = document.getElementById('loading-overlay');
const emergencyOverlay = document.getElementById('emergency-overlay');
const chatContainer = document.getElementById('chat-container');
const chatMessagesElement = document.getElementById('chat-messages');
const voiceToggle = document.getElementById('voice-toggle');

const screenshotBtn = document.getElementById('screenshot-btn');
const analyzeBtn = document.getElementById('analyze-btn');
const clearBtn = document.getElementById('clear-btn');
const hideBtn = document.getElementById('hide-btn');
const copyBtn = document.getElementById('copy-btn');
const closeResultsBtn = document.getElementById('close-results');
const closeAppBtn = document.getElementById('close-app-btn');

// New Cluely-style buttons
const suggestBtn = document.getElementById('suggest-btn');
const notesBtn = document.getElementById('notes-btn');
const insightsBtn = document.getElementById('insights-btn');

// Timer
let startTime = Date.now();
let timerInterval;

// Initialize
async function init() {
    console.log('Initializing renderer with Vosk Live Transcription...');

    if (typeof window.electronAPI !== 'undefined') {
        console.log('electronAPI is available');
    } else {
        console.error('electronAPI not available');
        showFeedback('electronAPI not available', 'error');
    }

    setupEventListeners();
    setupIpcListeners();
    updateUI();
    startTimer();
    stealthModeActive = false;

    document.body.style.visibility = 'visible';
    document.body.style.display = 'block';
    const app = document.getElementById('app');
    if (app) {
        app.style.visibility = 'visible';
        app.style.display = 'block';
    }

    console.log('Renderer initialized - Ready for live transcription!');
    showFeedback('Vosk ready - click microphone to start real-time transcription', 'success');
}

// Start Vosk voice recognition
async function startVoiceRecording() {
    if (isRecording) {
        console.log('Already recording');
        return;
    }

    try {
        console.log('Starting Vosk live transcription...');

        // Call main process to start Vosk Python process
        const result = await window.electronAPI.startVoiceRecognition();

        if (result && result.error) {
            throw new Error(result.error);
        }

        isRecording = true;
        updateVoiceUI();

        addChatMessage('system', 'Live transcription started - speak now!');
        showFeedback('Listening with Vosk...', 'success');

    } catch (error) {
        console.error('Failed to start Vosk:', error);
        showFeedback(`Failed to start: ${error.message}`, 'error');
        isRecording = false;
        updateVoiceUI();
    }
}

// Stop Vosk voice recognition
async function stopVoiceRecording() {
    if (!isRecording) return;

    try {
        console.log('Stopping Vosk transcription...');

        await window.electronAPI.stopVoiceRecognition();

        isRecording = false;
        updateVoiceUI();

        // Clear any partial text display
        if (lastPartialMessageDiv) {
            lastPartialMessageDiv.remove();
            lastPartialMessageDiv = null;
        }
        currentPartialText = '';

        addChatMessage('system', 'Live transcription stopped');
        showFeedback('Stopped listening', 'info');

    } catch (error) {
        console.error('Failed to stop Vosk:', error);
        showFeedback('Stop failed', 'error');
    }
}

// Toggle voice recognition
async function toggleVoiceRecognition() {
    if (isRecording) {
        await stopVoiceRecording();
        voiceToggle.classList.remove('active');
    } else {
        await startVoiceRecording();
        if (isRecording) {
            voiceToggle.classList.add('active');
        }
    }
}

// Update voice UI
function updateVoiceUI() {
    if (!voiceToggle) return;

    if (isRecording) {
        voiceToggle.classList.add('active', 'listening');
    } else {
        voiceToggle.classList.remove('active', 'listening');
    }
}

// Handle Vosk partial results (real-time display)
function handleVoskPartial(data) {
    if (!data.text || data.text.trim().length === 0) return;

    currentPartialText = data.text.trim();
    console.log('Partial:', currentPartialText);

    // Update or create partial message div
    if (!lastPartialMessageDiv) {
        lastPartialMessageDiv = document.createElement('div');
        lastPartialMessageDiv.className = 'chat-message voice-message partial';

        const timestamp = new Date().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });

        lastPartialMessageDiv.innerHTML = `
            <div class="message-header">
                <span class="message-icon">🎤</span>
                <span class="message-time">${timestamp}</span>
                <span class="partial-indicator">⏱️ Live</span>
            </div>
            <div class="message-content partial-text">${currentPartialText}</div>
        `;

        chatMessagesElement.appendChild(lastPartialMessageDiv);
    } else {
        // Update existing partial message
        const contentDiv = lastPartialMessageDiv.querySelector('.message-content');
        if (contentDiv) {
            contentDiv.textContent = currentPartialText;
        }
    }

    // Auto-scroll to bottom
    chatMessagesElement.scrollTop = chatMessagesElement.scrollHeight;
}

// Handle Vosk final results
function handleVoskFinal(data) {
    if (!data.text || data.text.trim().length === 0) return;

    const finalText = data.text.trim();
    console.log('Final:', finalText);

    // Remove partial message if exists
    if (lastPartialMessageDiv) {
        lastPartialMessageDiv.remove();
        lastPartialMessageDiv = null;
    }
    currentPartialText = '';

    // Add as final message
    addChatMessage('voice', finalText);
    showFeedback('Voice captured', 'success');
}

// Screenshot functions
async function takeStealthScreenshot() {
    try {
        showFeedback('Taking screenshot...', 'info');
        await window.electronAPI.takeStealthScreenshot();
    } catch (error) {
        console.error('Screenshot error:', error);
        showFeedback('Screenshot failed', 'error');
    }
}

async function analyzeScreenshots() {
    if (screenshotsCount === 0) {
        showFeedback('No screenshots to analyze', 'error');
        return;
    }

    try {
        setAnalyzing(true);
        showLoadingOverlay();

        const context = chatMessagesArray
            .map(msg => `${msg.type}: ${msg.content}`)
            .join('\n\n');

        await window.electronAPI.analyzeStealthWithContext(context);
    } catch (error) {
        console.error('Analysis error:', error);
        showFeedback('Analysis failed', 'error');
        setAnalyzing(false);
        hideLoadingOverlay();
    }
}

async function clearStealthData() {
    try {
        await window.electronAPI.clearStealth();
        screenshotsCount = 0;
        chatMessagesArray = [];
        chatMessagesElement.innerHTML = '';
        updateUI();
        showFeedback('Cleared', 'success');
    } catch (error) {
        console.error('Clear error:', error);
        showFeedback('Clear failed', 'error');
    }
}

async function emergencyHide() {
    try {
        await window.electronAPI.emergencyHide();
        showEmergencyOverlay();
    } catch (error) {
        console.error('Emergency hide error:', error);
    }
}

async function closeApplication() {
    try {
        console.log('Closing application...');
        await window.electronAPI.closeApp();
    } catch (error) {
        console.error('Close application error:', error);
    }
}

// NEW CLUELY-STYLE FEATURES

async function getResponseSuggestions() {
    if (!window.electronAPI || !window.electronAPI.suggestResponse) {
        showFeedback('Feature not available', 'error');
        return;
    }

    try {
        showFeedback('Generating suggestions...', 'info');

        const recentMessages = chatMessagesArray
            .slice(-5)
            .map(m => `${m.type}: ${m.content}`)
            .join('\n');

        const context = recentMessages || 'Current meeting conversation';

        const result = await window.electronAPI.suggestResponse(context);

        if (result.success && result.suggestions) {
            addChatMessage('ai-response', `💡 **What should I say?**\n\n${result.suggestions}`);
            showFeedback('Suggestions generated', 'success');
        } else {
            throw new Error(result.error || 'Failed to generate suggestions');
        }
    } catch (error) {
        console.error('Error getting suggestions:', error);
        showFeedback('Failed to generate suggestions', 'error');
        addChatMessage('system', `Error: ${error.message}`);
    }
}

async function generateMeetingNotes() {
    if (!window.electronAPI || !window.electronAPI.generateMeetingNotes) {
        showFeedback('Feature not available', 'error');
        return;
    }

    try {
        showFeedback('Generating meeting notes...', 'info');
        setAnalyzing(true);

        const result = await window.electronAPI.generateMeetingNotes();

        setAnalyzing(false);

        if (result.success && result.notes) {
            addChatMessage('ai-response', `📝 **Meeting Notes**\n\n${result.notes}`);
            showFeedback('Meeting notes generated', 'success');
        } else {
            throw new Error(result.error || 'Failed to generate notes');
        }
    } catch (error) {
        console.error('Error generating notes:', error);
        setAnalyzing(false);
        showFeedback('Failed to generate notes', 'error');
        addChatMessage('system', `Error: ${error.message}`);
    }
}

async function getConversationInsights() {
    if (!window.electronAPI || !window.electronAPI.getConversationInsights) {
        showFeedback('Feature not available', 'error');
        return;
    }

    try {
        showFeedback('Analyzing conversation...', 'info');
        setAnalyzing(true);

        const result = await window.electronAPI.getConversationInsights();

        setAnalyzing(false);

        if (result.success && result.insights) {
            addChatMessage('ai-response', `📊 **Conversation Insights**\n\n${result.insights}`);
            showFeedback('Insights generated', 'success');
        } else {
            throw new Error(result.error || 'Failed to get insights');
        }
    } catch (error) {
        console.error('Error getting insights:', error);
        setAnalyzing(false);
        showFeedback('Failed to get insights', 'error');
        addChatMessage('system', `Error: ${error.message}`);
    }
}

// UI Helper functions
function setAnalyzing(analyzing) {
    isAnalyzing = analyzing;
    updateUI();
}

function updateUI() {
    if (screenshotCount) {
        screenshotCount.textContent = screenshotsCount;
    }

    if (analyzeBtn) {
        // Enable Ask AI button if we have screenshots OR conversation history
        const hasContent = screenshotsCount > 0 || chatMessagesArray.length > 0;
        analyzeBtn.disabled = isAnalyzing || !hasContent;
    }
}

function showFeedback(message, type = 'info') {
    console.log(`Feedback (${type}):`, message);

    if (statusText) {
        statusText.textContent = message;
        statusText.className = `status-text ${type} show`;
        statusText.style.display = 'block';

        setTimeout(() => {
            statusText.classList.remove('show');
            setTimeout(() => {
                statusText.style.display = 'none';
            }, 300);
        }, 3000);
    }
}

function showLoadingOverlay() {
    if (loadingOverlay) {
        loadingOverlay.classList.remove('hidden');
    }
}

function hideLoadingOverlay() {
    if (loadingOverlay) {
        loadingOverlay.classList.add('hidden');
    }
}

function showEmergencyOverlay() {
    if (emergencyOverlay) {
        emergencyOverlay.classList.remove('hidden');
        setTimeout(() => {
            emergencyOverlay.classList.add('hidden');
        }, 2000);
    }
}

function hideResults() {
    if (resultsPanel) {
        resultsPanel.classList.add('hidden');
    }
}

async function copyToClipboard() {
    const lastAiMessage = chatMessagesArray
        .slice()
        .reverse()
        .find(msg => msg.type === 'ai-response');

    if (!lastAiMessage) {
        showFeedback('No AI response to copy', 'error');
        return;
    }

    try {
        await navigator.clipboard.writeText(lastAiMessage.content);
        showFeedback('Copied to clipboard', 'success');
    } catch (error) {
        console.error('Copy error:', error);
        showFeedback('Copy failed', 'error');
    }
}

// Chat message management
function formatResponse(text) {
    let formatted = text
        .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');

    return formatted;
}

function addChatMessage(type, content) {
    if (!chatMessagesElement) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${type}-message`;

    const timestamp = new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
    });

    let messageContent = '';

    switch (type) {
        case 'voice':
            messageContent = `<div class="message-header"><span class="message-icon">🎤</span><span class="message-time">${timestamp}</span></div><div class="message-content">${content}</div>`;
            break;

        case 'screenshot':
            messageContent = `<div class="message-header"><span class="message-icon">📸</span><span class="message-time">${timestamp}</span></div><div class="message-content">${content}</div>`;
            break;

        case 'ai-response':
            messageContent = `<div class="message-header"><span class="message-icon">🤖</span><span class="message-time">${timestamp}</span></div><div class="message-content ai-response">${formatResponse(content)}</div>`;
            break;

        case 'system':
            messageContent = `<div class="message-header"><span class="message-icon">ℹ️</span><span class="message-time">${timestamp}</span></div><div class="message-content system-message">${content}</div>`;
            break;
    }

    messageDiv.innerHTML = messageContent;
    chatMessagesElement.appendChild(messageDiv);

    chatMessagesElement.scrollTop = chatMessagesElement.scrollHeight;

    chatMessagesArray.push({
        type,
        content,
        timestamp: new Date()
    });

    // Update UI to enable/disable buttons based on content
    updateUI();
}

// Timer
function startTimer() {
    const timerElement = document.querySelector('.timer');
    if (!timerElement) return;

    timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const seconds = (elapsed % 60).toString().padStart(2, '0');
        timerElement.textContent = `${minutes}:${seconds}`;
    }, 1000);
}

// Event listeners
function setupEventListeners() {
    if (screenshotBtn) screenshotBtn.addEventListener('click', takeStealthScreenshot);
    if (analyzeBtn) analyzeBtn.addEventListener('click', analyzeScreenshots);
    if (clearBtn) clearBtn.addEventListener('click', clearStealthData);
    if (hideBtn) hideBtn.addEventListener('click', emergencyHide);
    if (copyBtn) copyBtn.addEventListener('click', copyToClipboard);
    if (closeResultsBtn) closeResultsBtn.addEventListener('click', hideResults);
    if (voiceToggle) voiceToggle.addEventListener('click', toggleVoiceRecognition);
    if (closeAppBtn) closeAppBtn.addEventListener('click', closeApplication);

    // New feature buttons
    if (suggestBtn) suggestBtn.addEventListener('click', getResponseSuggestions);
    if (notesBtn) notesBtn.addEventListener('click', generateMeetingNotes);
    if (insightsBtn) insightsBtn.addEventListener('click', getConversationInsights);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.altKey && e.shiftKey) {
            switch (e.key.toLowerCase()) {
                case 'h':
                    e.preventDefault();
                    if (window.electronAPI) window.electronAPI.toggleStealth();
                    break;
                case 's':
                    e.preventDefault();
                    takeStealthScreenshot();
                    break;
                case 'a':
                    e.preventDefault();
                    analyzeScreenshots();
                    break;
                case 'x':
                    e.preventDefault();
                    emergencyHide();
                    break;
                case 'v':
                    e.preventDefault();
                    toggleVoiceRecognition();
                    break;
            }
        }
    });

    document.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('selectstart', e => e.preventDefault());
    document.addEventListener('dragstart', e => e.preventDefault());
}

// IPC listeners
function setupIpcListeners() {
    if (!window.electronAPI) {
        console.error('electronAPI not available');
        return;
    }

    window.electronAPI.onScreenshotTakenStealth((count) => {
        screenshotsCount = count;
        updateUI();
        addChatMessage('screenshot', 'Screenshot captured');
        showFeedback('Screenshot captured', 'success');
    });

    window.electronAPI.onAnalysisStart(() => {
        setAnalyzing(true);
        showLoadingOverlay();
        addChatMessage('system', 'Analyzing screenshots and context...');
    });

    window.electronAPI.onAnalysisResult((data) => {
        setAnalyzing(false);
        hideLoadingOverlay();

        if (data.error) {
            addChatMessage('system', `Error: ${data.error}`);
            showFeedback('Analysis failed', 'error');
        } else {
            addChatMessage('ai-response', data.text);
            showFeedback('Analysis complete', 'success');
        }
    });

    window.electronAPI.onSetStealthMode((enabled) => {
        stealthModeActive = enabled;
        showFeedback(enabled ? 'Stealth mode ON' : 'Stealth mode OFF', 'info');
    });

    window.electronAPI.onEmergencyClear(() => {
        showEmergencyOverlay();
    });

    window.electronAPI.onError((message) => {
        showFeedback(message, 'error');
    });

    // Vosk live transcription event listeners
    window.electronAPI.onVoskStatus((data) => {
        console.log('Vosk status:', data.status, '-', data.message);

        switch (data.status) {
            case 'downloading':
                showFeedback(`Downloading model... ${data.message}`, 'info');
                break;
            case 'extracting':
                showFeedback('Extracting model...', 'info');
                break;
            case 'loading':
                showFeedback('Loading Vosk model...', 'info');
                break;
            case 'ready':
                showFeedback('Vosk ready!', 'success');
                break;
            case 'listening':
                showFeedback('Listening...', 'success');
                break;
            case 'stopped':
                showFeedback('Stopped listening', 'info');
                break;
        }
    });

    window.electronAPI.onVoskPartial((data) => {
        handleVoskPartial(data);
    });

    window.electronAPI.onVoskFinal((data) => {
        handleVoskFinal(data);
    });

    window.electronAPI.onVoskError((data) => {
        console.error('Vosk error:', data.error);
        showFeedback(`Vosk error: ${data.error}`, 'error');
        addChatMessage('system', `Vosk error: ${data.error}`);

        // Stop recording on error
        if (isRecording) {
            isRecording = false;
            updateVoiceUI();
            if (voiceToggle) {
                voiceToggle.classList.remove('active');
            }
        }
    });

    window.electronAPI.onVoskStopped(() => {
        console.log('Vosk stopped');
        if (isRecording) {
            isRecording = false;
            updateVoiceUI();
            if (voiceToggle) {
                voiceToggle.classList.remove('active');
            }
        }
    });
}

// Initialize on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
