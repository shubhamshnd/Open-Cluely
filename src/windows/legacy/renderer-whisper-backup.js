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
let audioContext = null;

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

// New Cluely-style buttons
const suggestBtn = document.getElementById('suggest-btn');
const notesBtn = document.getElementById('notes-btn');
const insightsBtn = document.getElementById('insights-btn');

// Timer
let startTime = Date.now();
let timerInterval;

// Whisper configuration
const WHISPER_CONFIG = {
    model: 'Xenova/whisper-tiny', // Use base whisper-tiny (works better)
    multilingual: false,
    quantized: true,
    subtask: 'transcribe',
    language: 'en' // Changed from 'english' to 'en'
};


// Initialize
async function init() {
    console.log('Initializing renderer...');
    
    // Create a single AudioContext
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: 16000
        });
        console.log('AudioContext created successfully');
    } catch (error) {
        console.error('Failed to create AudioContext:', error);
        showFeedback('Audio processing disabled', 'error');
    }
    
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

async function initializeWhisperWorker() {
    try {
        console.log('Initializing Whisper Web Worker...');
        
        // Since you have the bundled version in dist/, use that
        // Use relative path from the renderer.html location
        worker = new Worker('./dist/whisper-worker.bundle.js', { type: 'module' });
        
        worker.addEventListener('message', handleWorkerMessage);
        worker.addEventListener('error', (error) => {
            console.error('Worker error:', error);
            showFeedback('Speech recognition worker failed', 'error');
        });
        
        console.log('Whisper worker created successfully');
        return true;
        
    } catch (error) {
        console.error('Failed to initialize Whisper worker:', error);
        showFeedback('Failed to initialize speech recognition', 'error');
        
        // Fallback: try the unbundled version
        try {
            console.log('Trying fallback worker path...');
            worker = new Worker('./whisper-worker.js', { type: 'module' });
            
            worker.addEventListener('message', handleWorkerMessage);
            worker.addEventListener('error', (error) => {
                console.error('Fallback worker error:', error);
                showFeedback('Speech recognition worker failed', 'error');
            });
            
            console.log('Fallback whisper worker created successfully');
            return true;
            
        } catch (fallbackError) {
            console.error('Fallback worker also failed:', fallbackError);
            return false;
        }
    }
}   

// Handle worker messages
function handleWorkerMessage(event) {
    const message = event.data;
    
    console.log('Worker message:', JSON.stringify(message, null, 2));
    
    switch (message.status) {
        case "progress":
            const percent = Math.round((message.progress || 0) * 100);
            showFeedback(`Loading model: ${percent}%`, 'info');
            break;
            
        case "update":
            // Handle interim results but don't add to chat yet
            if (message.data && message.data[0]) {
                const interimText = message.data[0].trim();
                console.log('Interim transcription:', interimText);
                
                // Only show meaningful interim results
                if (interimText.length > 3 && !isNoise(interimText)) {
                    // You could display this as interim feedback
                    // showFeedback(`Hearing: "${interimText}"`, 'info');
                }
            }
            break;
            
        case "complete":
            if (message.data && message.data[0]) {
                const transcribedText = message.data[0].trim();
                console.log('Final transcription result:', transcribedText);

                // More strict filtering for final results
                if (transcribedText.length > 3 && !isNoise(transcribedText) && !isRepeatedPattern(transcribedText)) {
                    addChatMessage('voice', transcribedText);
                    showFeedback('Voice captured', 'success');

                    // Add to Gemini conversation history
                    if (window.electronAPI && window.electronAPI.addVoiceTranscript) {
                        window.electronAPI.addVoiceTranscript(transcribedText).catch(err => {
                            console.error('Failed to add transcript to history:', err);
                        });
                    }
                } else {
                    console.log('Filtered out noise/invalid transcription:', transcribedText);
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
    const chunkDuration = 3000; // 3 seconds for better audio quality
    const silenceTimeout = 100;  // Minimal gap between chunks
    
    function recordChunk() {
        if (!isRecording) return;
        
        recordingChunks = [];
        
        try {
            // Better MediaRecorder configuration
            const options = {
                mimeType: 'audio/webm;codecs=opus',
                bitsPerSecond: 32000 // Higher bitrate for better quality
            };
            
            // Fallback for different browsers
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                options.mimeType = 'audio/webm';
            }
            
            mediaRecorder = new MediaRecorder(audioStream, options);
            
            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 500) { // Only process substantial chunks
                    recordingChunks.push(event.data);
                    console.log('Audio chunk received, size:', event.data.size);
                }
            };
            
            mediaRecorder.onstop = async () => {
                console.log('MediaRecorder stopped, chunks:', recordingChunks.length);
                
                if (recordingChunks.length > 0 && isRecording) {
                    await processAudioChunk();
                }
                
                if (isRecording) {
                    setTimeout(recordChunk, silenceTimeout);
                }
            };
            
            mediaRecorder.onerror = (event) => {
                console.error('MediaRecorder error:', event.error);
                if (isRecording) {
                    setTimeout(recordChunk, 1000); // Retry after error
                }
            };
            
            mediaRecorder.start();
            console.log('MediaRecorder started');
            
            setTimeout(() => {
                if (mediaRecorder && mediaRecorder.state === 'recording') {
                    console.log('Stopping MediaRecorder after', chunkDuration, 'ms');
                    mediaRecorder.stop();
                }
            }, chunkDuration);
            
        } catch (error) {
            console.error('Error in recordChunk:', error);
            if (isRecording) {
                setTimeout(recordChunk, 1000); // Retry after 1 second
            }
        }
    }
    
    recordChunk();
}


// Process audio chunk
async function processAudioChunk() {
    if (!worker || !isWorkerReady || recordingChunks.length === 0) return;
    try {
        console.log('Processing audio chunk...');
        const audioBlob = new Blob(recordingChunks, { type: 'audio/webm' }); // Or 'audio/webm;codecs=opus'
        // Check if audio is substantial enough to process
        if (audioBlob.size < 2000) { // Less than 2KB, likely silence
            console.log('Audio chunk too small, skipping. Size:', audioBlob.size);
            return;
        }
        // Call the NEW convertBlobToAudioBuffer function (renderer-based)
        const audioBuffer = await convertBlobToAudioBuffer(audioBlob);
        if (!audioBuffer || audioBuffer.length === 0) {
            console.warn('No audio data to process after conversion');
            return;
        }
        // Enhanced audio quality checks (using the Float32Array from renderer)
        const maxAmplitude = Math.max(...audioBuffer.map(Math.abs));
        const rms = Math.sqrt(audioBuffer.reduce((sum, val) => sum + val * val, 0) / audioBuffer.length);
        console.log(`Audio quality - Length: ${audioBuffer.length}, Max: ${maxAmplitude.toFixed(4)}, RMS: ${rms.toFixed(4)}`);

        // More strict thresholds
        const minAmplitude = 0.005; // Minimum peak amplitude
        const minRMS = 0.001;       // Minimum RMS energy
        if (maxAmplitude < minAmplitude || rms < minRMS) {
            console.log(`Audio too quiet - Max: ${maxAmplitude.toFixed(4)} < ${minAmplitude}, RMS: ${rms.toFixed(4)} < ${minRMS}`);
            return;
        }
        // Check for minimum duration (at least 0.5 seconds at 16kHz)
        const minSamples = 8000; // 0.5 seconds at 16kHz
        if (audioBuffer.length < minSamples) {
            console.log(`Audio too short: ${audioBuffer.length} samples < ${minSamples} required`);
            return;
        }
        console.log('Sending quality audio to Whisper worker');
        // Send the 16kHz Float32Array directly to the worker
        worker.postMessage({
            audio: audioBuffer, // This is now the Float32Array from renderer
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
        console.log('Converting blob to audio buffer. Size:', blob.size);
        if (blob.size === 0) {
            console.warn('Empty audio blob');
            return null;
        }

        // Decode the audio blob using the AudioContext created in init()
        const arrayBuffer = await blob.arrayBuffer();
        // Ensure audioContext is available and resume if suspended
        if (!audioContext) {
            console.error('AudioContext is not available');
            return null;
        }
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        // Get the first channel (mono)
        const rawData = audioBuffer.getChannelData(0);
        const sampleRate = audioBuffer.sampleRate;

        console.log(`Decoded audio: ${rawData.length} samples, ${sampleRate} Hz`);

        // Whisper expects 16kHz. Resample if necessary using a simple averaging method.
        const targetSampleRate = 16000;
        if (sampleRate !== targetSampleRate) {
            console.log(`Resampling from ${sampleRate} Hz to ${targetSampleRate} Hz`);
            const resampledData = resampleAudio(rawData, sampleRate, targetSampleRate);
            console.log(`Resampled data length: ${resampledData.length}`);
            return resampledData; // Return the Float32Array at 16kHz
        }

        // If already 16kHz, return the raw data directly
        console.log(`Audio already at target sample rate ${targetSampleRate} Hz`);
        return rawData; // rawData is already a Float32Array

    } catch (error) {
        console.error('Error decoding audio blob:', error);
        return null;
    }
}

function resampleAudio(buffer, fromRate, toRate) {
    if (fromRate === toRate) {
        return buffer;
    }
    const sampleRateRatio = fromRate / toRate;
    const newLength = Math.round(buffer.length / sampleRateRatio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;

    while (offsetResult < result.length) {
        const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
        let accum = 0;
        let count = 0;
        for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
            accum += buffer[i];
            count++;
        }
        result[offsetResult] = accum / count;
        offsetResult++;
        offsetBuffer = nextOffsetBuffer;
    }
    return result;
}

// Filter noise
function isNoise(text) {
    const cleanText = text.trim().toLowerCase();
    
    // Filter out noise patterns
    const noisePatterns = [
        /^[^\w\s]*$/,                    // Only punctuation
        /^[!@#$%^&*()_+\-=\[\]{}|;':".,<>?\/`~]*$/, // Only symbols
        /^(uh|um|er|ah|oh|hmm)+$/i,      // Filler words
        /^[.!?]+$/,                      // Only punctuation
        /^silence$/i,                    // Literal "silence"
        /^background/i,                  // Background noise
        /^[!]{2,}$/,                     // Multiple exclamation marks (your issue!)
        /^[\s]*$/,                       // Only whitespace
        /^[a-z]$/i,                      // Single characters
        /^[0-9]+$/,                      // Only numbers
        /^[.,;:!?]+$/,                   // Only punctuation
        /^music$/i,                      // Music detection
        /^noise$/i,                      // Noise detection
    ];
    
    // Check length - very short transcriptions are usually noise
    if (cleanText.length < 3) {
        return true;
    }
    
    // Check against patterns
    return noisePatterns.some(pattern => pattern.test(cleanText));
}

function isRepeatedPattern(text) {
    // Check for repeated single characters
    if (/^(.)\1{3,}$/.test(text)) {
        return true;
    }
    
    // Check for repeated short patterns
    if (text.length > 6) {
        for (let len = 1; len <= 3; len++) {
            const pattern = text.substring(0, len);
            const repeated = pattern.repeat(Math.floor(text.length / len));
            if (text.startsWith(repeated) && repeated.length >= text.length * 0.8) {
                return true;
            }
        }
    }
    
    return false;
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

// NEW CLUELY-STYLE FEATURES

// "What should I say?" feature
async function getResponseSuggestions() {
    if (!window.electronAPI || !window.electronAPI.suggestResponse) {
        showFeedback('Feature not available', 'error');
        return;
    }

    try {
        showFeedback('Generating suggestions...', 'info');

        // Get recent context from chat messages
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

// Generate meeting notes
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

// Get conversation insights
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

// Setup event listeners
function setupEventListeners() {
    if (screenshotBtn) screenshotBtn.addEventListener('click', takeStealthScreenshot);
    if (analyzeBtn) analyzeBtn.addEventListener('click', analyzeScreenshots);
    if (clearBtn) clearBtn.addEventListener('click', clearStealthData);
    if (hideBtn) hideBtn.addEventListener('click', emergencyHide);
    if (copyBtn) copyBtn.addEventListener('click', copyToClipboard);
    if (closeResultsBtn) closeResultsBtn.addEventListener('click', hideResults);
    if (voiceToggle) voiceToggle.addEventListener('click', toggleVoiceRecognition);

    // New Cluely-style feature buttons
    if (suggestBtn) suggestBtn.addEventListener('click', getResponseSuggestions);
    if (notesBtn) notesBtn.addEventListener('click', generateMeetingNotes);
    if (insightsBtn) insightsBtn.addEventListener('click', getConversationInsights);

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
    if (audioContext && audioContext.state !== 'closed') {
        audioContext.close();
    }
});