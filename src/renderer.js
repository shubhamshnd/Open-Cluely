// CLUELY-STYLE STEALTH MEETING ASSISTANT
let screenshotsCount = 0;
let isAnalyzing = false;
let stealthModeActive = false;
let stealthHideTimeout = null;

// DOM elements
const statusText = document.getElementById('status-text');
const screenshotCount = document.getElementById('screenshot-count');
const resultsPanel = document.getElementById('results-panel');
const resultText = document.getElementById('result-text');
const loadingOverlay = document.getElementById('loading-overlay');
const emergencyOverlay = document.getElementById('emergency-overlay');

const screenshotBtn = document.getElementById('screenshot-btn');
const analyzeBtn = document.getElementById('analyze-btn');
const clearBtn = document.getElementById('clear-btn');
const hideBtn = document.getElementById('hide-btn');
const copyBtn = document.getElementById('copy-btn');
const closeResultsBtn = document.getElementById('close-results');

// Timer for Cluely-style display
let startTime = Date.now();
let timerInterval;

// Initialize
function init() {
  console.log('Initializing renderer...');
  setupEventListeners();
  setupIpcListeners();
  updateUI();
  startTimer();
  stealthModeActive = false;
  
  // Ensure content is visible
  document.body.style.visibility = 'visible';
  document.body.style.display = 'block';
  const app = document.getElementById('app');
  if (app) {
    app.style.visibility = 'visible';
    app.style.display = 'block';
  }
  
  console.log('Renderer initialized successfully');
}

// Start the timer display
function startTimer() {
  const timerElement = document.querySelector('.timer');
  if (!timerElement) {
    console.error('Timer element not found');
    return;
  }
  
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const seconds = (elapsed % 60).toString().padStart(2, '0');
    timerElement.textContent = `${minutes}:${seconds}`;
  }, 1000);
}

// Setup event listeners
function setupEventListeners() {
  // Button events
  if (screenshotBtn) screenshotBtn.addEventListener('click', takeStealthScreenshot);
  if (analyzeBtn) analyzeBtn.addEventListener('click', analyzeScreenshots);
  if (clearBtn) clearBtn.addEventListener('click', clearStealthData);
  if (hideBtn) hideBtn.addEventListener('click', emergencyHide);
  if (copyBtn) copyBtn.addEventListener('click', copyToClipboard);
  if (closeResultsBtn) closeResultsBtn.addEventListener('click', hideResults);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.altKey && e.shiftKey) {
      switch (e.key.toLowerCase()) {
        case 'h':
          e.preventDefault();
          window.electronAPI.toggleStealth();
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
      }
    }
  });

  // Prevent context menu and selection
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

  // Screenshot taken
  window.electronAPI.onScreenshotTakenStealth((count) => {
    screenshotsCount = count;
    updateUI();
    showFeedback('Screenshot captured', 'success');
  });

  // Analysis events
  window.electronAPI.onAnalysisStart(() => {
    setAnalyzing(true);
    showLoadingOverlay();
  });

  window.electronAPI.onAnalysisResult((data) => {
    setAnalyzing(false);
    hideLoadingOverlay();
    
    if (data.error) {
      showFeedback(data.error, 'error');
    } else {
      showResults(data.text);
      showFeedback('Analysis complete', 'success');
    }
  });

  // Stealth mode events
  window.electronAPI.onSetStealthMode((enabled) => {
    setStealthMode(enabled);
  });

  // Emergency events
  window.electronAPI.onEmergencyClear(() => {
    hideResults();
    clearStealthData();
    emergencyHide();
  });

  // Error handling
  window.electronAPI.onError((message) => {
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
    await window.electronAPI.analyzeStealth();
  } catch (error) {
    console.error('Analysis error:', error);
    showFeedback('Analysis failed', 'error');
  }
}

// Clear data
async function clearStealthData() {
  if (!window.electronAPI) {
    showFeedback('electronAPI not available', 'error');
    return;
  }

  try {
    clearBtn.disabled = true;
    const result = await window.electronAPI.clearStealth();
    
    if (result.success) {
      screenshotsCount = 0;
      hideResults();
      updateUI();
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
  
  // Clear sensitive content
  if (resultText) {
    resultText.textContent = '';
  }
  
  // Auto-restore after 2 seconds
  setTimeout(() => {
    if (emergencyOverlay) {
      emergencyOverlay.classList.add('hidden');
    }
  }, 2000);
}

// Show results
function showResults(text) {
  if (!text || !resultText || !resultsPanel) return;
  
  const formattedText = formatResponse(text);
  resultText.innerHTML = formattedText;
  resultsPanel.classList.remove('hidden');
}

// Hide results
function hideResults() {
  if (resultsPanel) {
    resultsPanel.classList.add('hidden');
  }
  if (resultText) {
    resultText.innerHTML = '';
  }
}

// Format AI response
function formatResponse(text) {
  let formatted = text;
  
  // Format code blocks
  formatted = formatted.replace(
    /```(\w+)?\n([\s\S]*?)```/g,
    '<div class="code-block"><code>$2</code></div>'
  );
  
  // Format inline code
  formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // Format sections
  formatted = formatted.replace(
    /\*\*LOGIC EXPLANATION:\*\*([\s\S]*?)(?=\*\*|$)/g,
    '<div class="logic-section"><strong>LOGIC EXPLANATION:</strong>$1</div>'
  );
  
  formatted = formatted.replace(
    /\*\*KEY POINTS:\*\*([\s\S]*?)(?=\*\*|$)/g,
    '<div class="key-points"><strong>KEY POINTS:</strong>$1</div>'
  );
  
  // Format bold text
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // Format bullet points
  formatted = formatted.replace(/• (.*?)(?=\n|$)/g, '<div>• $1</div>');
  
  // Format line breaks
  formatted = formatted.replace(/\n/g, '<br>');
  
  return formatted;
}

// Copy to clipboard
async function copyToClipboard() {
  if (!resultText) {
    showFeedback('No content to copy', 'error');
    return;
  }

  try {
    const text = resultText.textContent;
    await navigator.clipboard.writeText(text);
    showFeedback('Copied to clipboard', 'success');
  } catch (error) {
    console.error('Copy error:', error);
    showFeedback('Copy failed', 'error');
  }
}

// Update UI
function updateUI() {
  // Update screenshot counter
  if (screenshotCount) {
    screenshotCount.textContent = screenshotsCount;
  }
  
  // Update button states
  if (analyzeBtn) {
    analyzeBtn.disabled = screenshotsCount === 0 || isAnalyzing;
  }
  if (clearBtn) {
    clearBtn.disabled = screenshotsCount === 0;
  }
  
  // Update status text
  if (statusText) {
    if (isAnalyzing) {
      statusText.textContent = 'Analyzing...';
    } else if (screenshotsCount === 0) {
      statusText.textContent = 'AI Assistant';
    } else {
      statusText.textContent = `${screenshotsCount} screenshot${screenshotsCount > 1 ? 's' : ''} ready`;
    }
  }
}

// Set analyzing state
function setAnalyzing(analyzing) {
  isAnalyzing = analyzing;
  updateUI();
}

// Stealth mode management
function setStealthMode(enabled) {
  if (stealthHideTimeout) {
    clearTimeout(stealthHideTimeout);
    stealthHideTimeout = null;
  }

  stealthModeActive = enabled;
  
  if (enabled) {
    document.body.classList.add('stealth-mode');
  } else {
    document.body.classList.remove('stealth-mode');
  }
}

// Loading overlay
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

// Feedback system
function showFeedback(message, type = 'info') {
  if (!statusText) {
    console.log('Status feedback:', message, type);
    return;
  }
  
  // Show the status text element
  statusText.style.display = 'block';
  statusText.style.opacity = '1';
  statusText.textContent = message;
  statusText.className = `status-text status-${type} show`;
  
  // Hide after 3 seconds
  setTimeout(() => {
    statusText.style.opacity = '0';
    setTimeout(() => {
      statusText.style.display = 'none';
      statusText.className = 'status-text';
    }, 300);
  }, 3000);
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, initializing...');
  init();
  
  // Start in normal visible mode
  stealthModeActive = false;
});

// Cleanup
window.addEventListener('beforeunload', () => {
  if (timerInterval) {
    clearInterval(timerInterval);
  }
  if (stealthHideTimeout) {
    clearTimeout(stealthHideTimeout);
  }
});