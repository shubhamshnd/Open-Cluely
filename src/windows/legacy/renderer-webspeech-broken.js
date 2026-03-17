// Renderer with Web Speech API (Instant - No Model Loading!)

let screenshotsCount = 0;
let isAnalyzing = false;
let stealthModeActive = false;
let stealthHideTimeout = null;
let isRecording = false;
let chatMessagesArray = [];

// Web Speech API - Instant recognition!
let recognition = null;
let isRecognitionReady = false;

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

// New Cluely-style buttons
const suggestBtn = document.getElementById('suggest-btn');
const notesBtn = document.getElementById('notes-btn');
const insightsBtn = document.getElementById('insights-btn');

// Timer
let startTime = Date.now();
let timerInterval;

// Initialize
async function init() {
    console.log('Initializing renderer with Web Speech API...');

    // Check if electronAPI is available
    if (typeof window.electronAPI !== 'undefined') {
        console.log('electronAPI is available');
    } else {
        console.error('electronAPI not available');
        showFeedback('electronAPI not available', 'error');
    }

    initializeWebSpeech();
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

    console.log('Renderer initialized successfully with Web Speech API');
}

// Initialize Web Speech API (instant!)
function initializeWebSpeech() {
    try {
        // Check for browser support
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

        if (!SpeechRecognition) {
            console.error('Web Speech API not supported in this browser');
            showFeedback('Speech recognition not supported', 'error');
            return;
        }

        console.log('Initializing Web Speech API...');
        recognition = new SpeechRecognition();

        // Configuration
        recognition.continuous = true;           // Keep listening
        recognition.interimResults = true;       // Get partial results
        recognition.lang = 'en-US';             // Language
        recognition.maxAlternatives = 1;         // Only get best result

        // Event handlers
        recognition.onstart = () => {
            console.log('Speech recognition started');
            isRecognitionReady = true;
            isRecording = true;
            updateVoiceUI();
            showFeedback('Listening...', 'success');
        };

        recognition.onresult = (event) => {
            console.log('Speech recognition result');

            // Get the latest result
            const lastResultIndex = event.results.length - 1;
            const result = event.results[lastResultIndex];
            const transcript = result[0].transcript.trim();

            console.log('Transcript:', transcript, 'Final:', result.isFinal);

            // Only add final results to chat
            if (result.isFinal && transcript.length > 0) {
                // Filter out noise
                if (!isNoise(transcript)) {
                    addChatMessage('voice', transcript);
                    showFeedback('Voice captured', 'success');

                    // Add to Gemini conversation history
                    if (window.electronAPI && window.electronAPI.addVoiceTranscript) {
                        window.electronAPI.addVoiceTranscript(transcript).catch(err => {
                            console.error('Failed to add transcript to history:', err);
                        });
                    }
                } else {
                    console.log('Filtered out noise:', transcript);
                }
            }
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);

            // Handle different error types
            let errorMessage = 'Speech recognition error';
            switch (event.error) {
                case 'no-speech':
                    errorMessage = 'No speech detected';
                    break;
                case 'audio-capture':
                    errorMessage = 'No microphone found';
                    break;
                case 'not-allowed':
                    errorMessage = 'Microphone permission denied';
                    break;
                case 'network':
                    errorMessage = 'Network error';
                    break;
                case 'aborted':
                    // Don't show error for intentional stops
                    return;
                default:
                    errorMessage = `Error: ${event.error}`;
            }

            showFeedback(errorMessage, 'error');

            // Auto-restart on some errors
            if (isRecording && (event.error === 'no-speech' || event.error === 'network')) {
                console.log('Auto-restarting recognition...');
                setTimeout(() => {
                    if (isRecording) {
                        try {
                            recognition.start();
                        } catch (e) {
                            console.error('Failed to restart:', e);
                        }
                    }
                }, 1000);
            }
        };

        recognition.onend = () => {
            console.log('Speech recognition ended');

            // Auto-restart if we're still supposed to be recording
            if (isRecording) {
                console.log('Auto-restarting recognition...');
                try {
                    recognition.start();
                } catch (error) {
                    console.error('Failed to restart recognition:', error);
                    isRecording = false;
                    updateVoiceUI();
                }
            } else {
                updateVoiceUI();
            }
        };

        isRecognitionReady = true;
        console.log('Web Speech API initialized successfully - INSTANT!');
        showFeedback('Speech recognition ready - No loading needed!', 'success');

    } catch (error) {
        console.error('Failed to initialize Web Speech API:', error);
        showFeedback('Failed to initialize speech recognition', 'error');
    }
}

// Start voice recognition
async function startVoiceRecognition() {
    if (!recognition || !isRecognitionReady) {
        showFeedback('Speech recognition not available', 'error');
        return;
    }

    if (isRecording) {
        console.log('Already recording');
        return;
    }

    try {
        console.log('Starting voice recognition...');
        isRecording = true;
        recognition.start();
        updateVoiceUI();
        addChatMessage('system', 'Voice recording started...');
    } catch (error) {
        console.error('Failed to start recognition:', error);
        showFeedback('Failed to start recording', 'error');
        isRecording = false;
        updateVoiceUI();
    }
}

// Stop voice recognition
function stopVoiceRecognition() {
    if (!recognition || !isRecording) {
        return;
    }

    console.log('Stopping voice recognition...');
    isRecording = false;

    try {
        recognition.stop();
    } catch (error) {
        console.error('Error stopping recognition:', error);
    }

    updateVoiceUI();
    addChatMessage('system', 'Voice recording stopped');
    showFeedback('Recording stopped', 'info');
}

// Toggle voice recognition
async function toggleVoiceRecognition() {
    if (isRecording) {
        stopVoiceRecognition();
        voiceToggle.classList.remove('active');
    } else {
        await startVoiceRecognition();
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

// Filter noise (simple version)
function isNoise(text) {
    const cleanText = text.trim().toLowerCase();

    // Very short or empty
    if (cleanText.length < 2) return true;

    // Only punctuation or symbols
    if (/^[^\w\s]*$/.test(cleanText)) return true;

    // Common filler words alone
    const fillerWords = ['uh', 'um', 'er', 'ah', 'oh', 'hmm'];
    if (fillerWords.includes(cleanText)) return true;

    return false;
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

        // Get conversation context
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
        analyzeBtn.disabled = isAnalyzing || screenshotsCount === 0;
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
    // Basic markdown formatting
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
}

// Initialize on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
