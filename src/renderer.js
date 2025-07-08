// Fixed renderer.js with proper Whisper Worker implementation

let screenshotsCount = 0;
let isAnalyzing = false;
let stealthModeActive = false;
let stealthHideTimeout = null;
let isRecording = false;
let mediaRecorder = null;
let audioStream = null;
let recordingChunks = [];
let chatMessagesArray = [];
let isModelLoading = false;

// Whisper worker
let worker = null;
let isWorkerReady = false;

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

// Timer
let startTime = Date.now();
let timerInterval;

// Whisper configuration
const WHISPER_CONFIG = {
    model: 'Xenova/whisper-tiny.en',
    multilingual: false,
    quantized: true,
    subtask: 'transcribe',
    language: 'english'
};

// Initialize
async function init() {
    console.log('Initializing renderer...');
    
    // Check if electronAPI is available
    if (typeof window.electronAPI !== 'undefined') {
        console.log('electronAPI is available');
    } else {
        console.error('electronAPI not available');
        showFeedback('electronAPI not available', 'error');
    }
    
    await initializeWhisperWorker();
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
    
    console.log('Renderer initialized successfully');
}

// Initialize Whisper Web Worker using separate file
async function initializeWhisperWorker() {
    try {
        console.log('Initializing Whisper Web Worker...');
        
        // Use the separate worker file
        worker = new Worker('whisper-worker.js', { type: 'module' });
        
        worker.addEventListener('message', handleWorkerMessage);
        worker.addEventListener('error', (error) => {
            console.error('Worker error:', error);
            showFeedback('Speech recognition worker failed', 'error');
        });
        
        console.log('Whisper worker created successfully');
        showFeedback('Whisper worker initialized', 'success');
        return true;
        
    } catch (error) {
        console.error('Failed to initialize Whisper worker:', error);
        showFeedback('Failed to initialize speech recognition', 'error');
        return false;
    }
}

// Handle worker messages
function handleWorkerMessage(event) {
    const message = event.data;
    
    console.log('Worker message:', message);
    
    switch (message.status) {
        case "progress":
            const percent = Math.round((message.progress || 0) * 100);
            showFeedback(`Loading model: ${percent}%`, 'info');
            break;
            
        case "complete":
            if (message.data && message.data.text) {
                const transcribedText = message.data.text.trim();
                console.log('Transcription result:', transcribedText);
                
                if (transcribedText.length > 3 && !isNoise(transcribedText)) {
                    addChatMessage('voice', transcribedText);
                }
            }
            break;
            
        case "initiate":
            isModelLoading = true;
            showFeedback('Loading speech recognition model...', 'info');
            break;
            
        case "ready":
            isModelLoading = false;
            isWorkerReady = true;
            showFeedback('Speech recognition ready', 'success');
            break;
            
        case "error":
            console.error('Worker error:', message.data);
            showFeedback('Speech recognition error', 'error');
            isModelLoading = false;
            break;
            
        case "done":
            if (message.file && message.file.includes('tokenizer')) {
                isWorkerReady = true;
                isModelLoading = false;
                showFeedback('Speech recognition ready', 'success');
            }
            break;
    }
    
    updateUI();
}

// Setup audio recording
// Alternative microphone access approach
async function setupVoiceRecording() {
  try {
    console.log('Setting up voice recording...');
    
    // Check if getUserMedia is available
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('getUserMedia not supported');
    }
    
    // Request permissions first
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioDevices = devices.filter(device => device.kind === 'audioinput');
    console.log('Available audio devices:', audioDevices.length);
    
    if (audioDevices.length === 0) {
      throw new Error('No microphone devices found');
    }
    
    // Try different constraint configurations
    const constraints = [
      // Simple constraint
      { audio: true },
      // Detailed constraint
      {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
          channelCount: 1
        }
      },
      // Minimal constraint
      {
        audio: {
          sampleRate: 16000
        }
      }
    ];
    
    let stream = null;
    let lastError = null;
    
    for (const constraint of constraints) {
      try {
        console.log('Trying constraint:', constraint);
        stream = await navigator.mediaDevices.getUserMedia(constraint);
        console.log('Microphone access granted with constraint:', constraint);
        break;
      } catch (error) {
        console.warn('Failed with constraint:', constraint, error);
        lastError = error;
      }
    }
    
    if (!stream) {
      throw lastError || new Error('All microphone access attempts failed');
    }
    
    audioStream = stream;
    return true;
    
} catch (error) {
  console.error('Microphone access error details:');
  console.error('Error name:', error.name);
  console.error('Error message:', error.message);
  console.error('Error constraint:', error.constraint);
  console.error('Full error:', error);
  
  let userMessage = 'Microphone access denied';
  
  switch (error.name) {
    case 'NotAllowedError':
      userMessage = 'Microphone permission denied. Check browser/system settings.';
      break;
    case 'NotFoundError':
      userMessage = 'No microphone found. Please connect a microphone.';
      break;
    case 'NotReadableError':
      userMessage = 'Microphone is being used by another application.';
      break;
    case 'OverconstrainedError':
      userMessage = 'Microphone constraints not supported. Trying simpler settings...';
      break;
    case 'SecurityError':
      userMessage = 'Microphone access blocked due to security policy.';
      break;
    default:
      userMessage = `Microphone error: ${error.message}`;
  }
  
  showFeedback(userMessage, 'error');
  return false;
}
}

// Start recording
async function startAutoRecording() {
    if (isRecording || !isWorkerReady) {
        console.log('Cannot start recording:', { isRecording, isWorkerReady });
        return;
    }
    
    if (!audioStream) {
        const success = await setupVoiceRecording();
        if (!success) return;
    }
    
    try {
        isRecording = true;
        updateVoiceUI();
        
        console.log('Starting recording...');
        startChunkedRecording();
        
        addChatMessage('system', 'Voice recording started...');
        showFeedback('Recording started', 'success');
        
    } catch (error) {
        console.error('Failed to start recording:', error);
        showFeedback('Recording failed', 'error');
        isRecording = false;
        updateVoiceUI();
    }
}

// Stop recording
function stopAutoRecording() {
    if (!isRecording) return;
    
    console.log('Stopping recording...');
    
    isRecording = false;
    
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    
    updateVoiceUI();
    addChatMessage('system', 'Voice recording stopped');
    showFeedback('Recording stopped', 'info');
}

// Start chunked recording
function startChunkedRecording() {
    const chunkDuration = 3000; // 3 seconds
    
    function recordChunk() {
        if (!isRecording) return;
        
        recordingChunks = [];
        
        mediaRecorder = new MediaRecorder(audioStream, {
            mimeType: 'audio/webm;codecs=opus'
        });
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordingChunks.push(event.data);
            }
        };
        
        mediaRecorder.onstop = async () => {
            if (recordingChunks.length > 0 && isRecording) {
                await processAudioChunk();
            }
            
            if (isRecording) {
                setTimeout(recordChunk, 100);
            }
        };
        
        mediaRecorder.start();
        
        setTimeout(() => {
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
            }
        }, chunkDuration);
    }
    
    recordChunk();
}

// Process audio chunk
async function processAudioChunk() {
    if (!worker || !isWorkerReady || recordingChunks.length === 0) return;
    
    try {
        console.log('Processing audio chunk...');
        
        const audioBlob = new Blob(recordingChunks, { type: 'audio/webm' });
        const audioBuffer = await convertBlobToAudioBuffer(audioBlob);
        
        if (!audioBuffer || audioBuffer.length === 0) {
            console.warn('No audio data to process');
            return;
        }
        
        // Send to worker
        worker.postMessage({
            audio: audioBuffer,
            model: WHISPER_CONFIG.model,
            multilingual: WHISPER_CONFIG.multilingual,
            quantized: WHISPER_CONFIG.quantized,
            subtask: WHISPER_CONFIG.subtask,
            language: WHISPER_CONFIG.language
        });
        
    } catch (error) {
        console.error('Error processing audio:', error);
    }
}

// Convert audio blob to format for Whisper
async function convertBlobToAudioBuffer(blob) {
    try {
        const arrayBuffer = await blob.arrayBuffer();
        const audioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: 16000
        });
        
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        
        // Convert to mono Float32Array
        let audio;
        if (audioBuffer.numberOfChannels === 2) {
            const SCALING_FACTOR = Math.sqrt(2);
            const left = audioBuffer.getChannelData(0);
            const right = audioBuffer.getChannelData(1);
            
            audio = new Float32Array(left.length);
            for (let i = 0; i < audioBuffer.length; ++i) {
                audio[i] = SCALING_FACTOR * (left[i] + right[i]) / 2;
            }
        } else {
            audio = audioBuffer.getChannelData(0);
        }
        
        return audio;
        
    } catch (error) {
        console.error('Audio conversion failed:', error);
        return null;
    }
}

// Filter noise
function isNoise(text) {
    const noisePatterns = [
        /^[^\w]*$/,
        /^(uh|um|er|ah)+$/i,
        /^[.!?]+$/,
        /^silence$/i,
        /^background/i,
    ];
    
    return noisePatterns.some(pattern => pattern.test(text.trim()));
}

// Toggle voice recognition
async function toggleVoiceRecognition() {
    if (isRecording) {
        stopAutoRecording();
        voiceToggle.classList.remove('active');
    } else {
        await startAutoRecording();
        if (isRecording) {
            voiceToggle.classList.add('active');
        }
    }
}

// Update voice UI
function updateVoiceUI() {
    if (!voiceToggle) return;
    
    if (isRecording) {
        voiceToggle.classList.add('listening');
        voiceToggle.title = 'Stop recording';
    } else {
        voiceToggle.classList.remove('listening');
        
        if (!isWorkerReady) {
            voiceToggle.title = 'Loading speech recognition...';
            voiceToggle.disabled = true;
        } else {
            voiceToggle.title = 'Start recording';
            voiceToggle.disabled = false;
        }
    }
}

// Add chat message
function addChatMessage(type, content) {
    if (!chatMessagesElement) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${type}`;
    
    const timestamp = new Date().toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    
    let messageContent = '';
    
    switch (type) {
        case 'voice':
            messageContent = `<div class="message-header"><span class="message-icon">🎤</span><span class="message-time">${timestamp}</span></div><div class="message-content">${content}</div>`;
            break;
            
        case 'screenshot':
            messageContent = `<div class="message-header"><span class="message-icon">📸</span><span class="message-time">${timestamp}</span></div><div class="message-content">Screenshot captured</div>`;
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

// Start timer
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

// Setup event listeners
function setupEventListeners() {
    if (screenshotBtn) screenshotBtn.addEventListener('click', takeStealthScreenshot);
    if (analyzeBtn) analyzeBtn.addEventListener('click', analyzeScreenshots);
    if (clearBtn) clearBtn.addEventListener('click', clearStealthData);
    if (hideBtn) hideBtn.addEventListener('click', emergencyHide);
    if (copyBtn) copyBtn.addEventListener('click', copyToClipboard);
    if (closeResultsBtn) closeResultsBtn.addEventListener('click', hideResults);
    if (voiceToggle) voiceToggle.addEventListener('click', toggleVoiceRecognition);

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

// Setup IPC listeners
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
            showFeedback(data.error, 'error');
        } else {
            addChatMessage('ai-response', data.text);
            showFeedback('Analysis complete', 'success');
        }
    });

    window.electronAPI.onSetStealthMode((enabled) => {
        setStealthMode(enabled);
    });

    window.electronAPI.onEmergencyClear(() => {
        hideResults();
        clearStealthData();
        emergencyHide();
    });

    window.electronAPI.onError((message) => {
        addChatMessage('system', `Error: ${message}`);
        showFeedback(message, 'error');
    });
}

// Take screenshot
async function takeStealthScreenshot() {
    if (!window.electronAPI) {
        showFeedback('electronAPI not available', 'error');
        return;
    }

    try {
        screenshotBtn.disabled = true;
        await window.electronAPI.takeStealthScreenshot();
    } catch (error) {
        console.error('Screenshot error:', error);
        showFeedback('Screenshot failed', 'error');
        addChatMessage('system', 'Screenshot failed');
    } finally {
        screenshotBtn.disabled = false;
    }
}

// Analyze screenshots
async function analyzeScreenshots() {
    if (screenshotsCount === 0) {
        showFeedback('No screenshots to analyze', 'error');
        return;
    }

    if (!window.electronAPI) {
        showFeedback('electronAPI not available', 'error');
        return;
    }

    try {
        const recentMessages = chatMessagesArray.slice(-10).filter(msg => 
            msg.type === 'voice' || msg.type === 'ai-response'
        );
        
        const context = recentMessages.map(msg => 
            `${msg.type === 'voice' ? 'User' : 'AI'}: ${msg.content}`
        ).join('\n');
        
        await window.electronAPI.analyzeStealthWithContext(context);
    } catch (error) {
        console.error('Analysis error:', error);
        showFeedback('Analysis failed', 'error');
        addChatMessage('system', 'Analysis failed');
    }
}

// Clear data
async function clearStealthData() {
    if (!window.electronAPI) return;

    try {
        clearBtn.disabled = true;
        const result = await window.electronAPI.clearStealth();
        
        if (result.success) {
            screenshotsCount = 0;
            chatMessagesElement.innerHTML = '';
            chatMessagesArray.length = 0;
            hideResults();
            updateUI();
            addChatMessage('system', 'Data cleared');
            showFeedback('Data cleared', 'info');
        }
    } catch (error) {
        console.error('Clear error:', error);
        showFeedback('Clear failed', 'error');
    } finally {
        clearBtn.disabled = false;
    }
}

// Emergency hide
function emergencyHide() {
    if (emergencyOverlay) {
        emergencyOverlay.classList.remove('hidden');
    }
    
    if (isRecording) {
        stopAutoRecording();
        voiceToggle.classList.remove('active');
    }
    
    if (resultText) {
        resultText.textContent = '';
    }
    
    setTimeout(() => {
        if (emergencyOverlay) {
            emergencyOverlay.classList.add('hidden');
        }
    }, 2000);
}

// Utility functions
function hideResults() {
    if (resultsPanel) {
        resultsPanel.classList.add('hidden');
    }
    if (resultText) {
        resultText.innerHTML = '';
    }
}

function formatResponse(text) {
    let formatted = text;
    formatted = formatted.replace(/```(\w+)?\n([\s\S]*?)```/g, '<div class="code-block"><code>$2</code></div>');
    formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/• (.*?)(?=\n|$)/g, '<div>• $1</div>');
    formatted = formatted.replace(/\n/g, '<br>');
    return formatted;
}

async function copyToClipboard() {
    if (!chatMessagesElement || chatMessagesElement.children.length === 0) {
        showFeedback('No content to copy', 'error');
        return;
    }

    try {
        const lastAiMessage = Array.from(chatMessagesElement.children)
            .reverse()
            .find(msg => msg.classList.contains('ai-response'));
        
        if (lastAiMessage) {
            const text = lastAiMessage.querySelector('.message-content').textContent;
            await navigator.clipboard.writeText(text);
            showFeedback('Copied to clipboard', 'success');
        } else {
            showFeedback('No AI response to copy', 'error');
        }
    } catch (error) {
        console.error('Copy error:', error);
        showFeedback('Copy failed', 'error');
    }
}

function updateUI() {
    if (screenshotCount) {
        screenshotCount.textContent = screenshotsCount;
    }
    
    if (analyzeBtn) {
        analyzeBtn.disabled = screenshotsCount === 0 || isAnalyzing;
    }
    if (clearBtn) {
        clearBtn.disabled = screenshotsCount === 0 && chatMessagesElement.children.length === 0;
    }
    
    updateVoiceUI();
}

function setAnalyzing(analyzing) {
    isAnalyzing = analyzing;
    updateUI();
}

function setStealthMode(enabled) {
    if (stealthHideTimeout) {
        clearTimeout(stealthHideTimeout);
        stealthHideTimeout = null;
    }

    stealthModeActive = enabled;
    
    if (enabled) {
        document.body.classList.add('stealth-mode');
        if (isRecording) {
            stopAutoRecording();
            voiceToggle.classList.remove('active');
        }
    } else {
        document.body.classList.remove('stealth-mode');
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

function showFeedback(message, type) {
    type = type || 'info';
    
    if (!statusText) {
        console.log('Status feedback:', message, type);
        return;
    }
    
    statusText.style.display = 'block';
    statusText.style.opacity = '1';
    statusText.textContent = message;
    statusText.className = `status-text status-${type} show`;
    
    setTimeout(() => {
        statusText.style.opacity = '0';
        setTimeout(() => {
            statusText.style.display = 'none';
            statusText.className = 'status-text';
        }, 300);
    }, 3000);
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM loaded, initializing...');
    await init();
    
    stealthModeActive = false;
    
    setTimeout(() => {
        addChatMessage('system', 'AI Meeting Assistant with Whisper speech recognition ready. Click the microphone to start recording.');
    }, 1000);
});

// Cleanup
window.addEventListener('beforeunload', () => {
    if (timerInterval) {
        clearInterval(timerInterval);
    }
    if (stealthHideTimeout) {
        clearTimeout(stealthHideTimeout);
    }
    if (isRecording) {
        stopAutoRecording();
    }
    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
    }
    if (worker) {
        worker.terminate();
    }
});