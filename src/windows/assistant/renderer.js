import {
    canToggleAiForMessageType as canToggleAiForMessageTypeRule,
    defaultIncludeInAiForMessageType as defaultIncludeInAiForMessageTypeRule,
    isAiResponseMessageType as isAiResponseMessageTypeRule,
    isScreenshotMessageType as isScreenshotMessageTypeRule,
    isSystemMessageType as isSystemMessageTypeRule,
    isTranscriptMessageType as isTranscriptMessageTypeRule
} from './renderer/features/ai-context/message-types.js';
import { createMessageStore } from './renderer/features/ai-context/message-store.js';
import { buildFilteredAiContextBundle as buildAiContextBundle } from './renderer/features/ai-context/context-bundle.js';
import { updateMessageAiToggleUi as syncMessageAiToggleUi } from './renderer/features/ai-context/toggle-ui.js';
import {
    createTranscriptionSourceState,
    normalizeSource as normalizeAssemblySource,
    sourceLabel as resolveSourceLabel
} from './renderer/features/assembly-ai/source-state.js';
import { createAudioPipeline } from './renderer/features/assembly-ai/audio-pipeline.js';
import { createTranscriptBufferManager } from './renderer/features/assembly-ai/transcript-buffer.js';
// Renderer with AssemblyAI Streaming Transcription - Real-time & Accurate!
// Uses AssemblyAI WebSocket API for live speech-to-text

let screenshotsCount = 0;
let isAnalyzing = false;
let stealthModeActive = false;
let stealthHideTimeout = null;
const THEME_STORAGE_KEY = 'assistant-theme';
const THEME_LIGHT = 'light';
const THEME_DARK = 'dark';
let activeTheme = THEME_LIGHT;
const AI_CONTEXT_CHAR_BUDGET = 12000;
const messageStore = createMessageStore();
let chatMessagesArray = messageStore.getMessages();
const transcriptionSourceState = createTranscriptionSourceState();

// Mic audio capture state
let micAudioContext = null;
let micMediaStream = null;
let micScriptProcessor = null;
let isMicActive = false;

// System audio capture state
let systemAudioContext = null;
let systemMediaStream = null;
let systemScriptProcessor = null;
let isSystemActive = false;

// Source selection state (default: host/system on, mic off)
const selectedSources = transcriptionSourceState.selectedSources;

// Runtime source status state
const sourceStatuses = transcriptionSourceState.sourceStatuses;

// Partial transcription tracking per source
let micPartialText = '';
let micPartialDiv = null;
let systemPartialText = '';
let systemPartialDiv = null;

const monitorLastText = {
    system: 'No transcript yet',
    mic: 'No transcript yet'
};

const MAX_MONITOR_LOG_ENTRIES = 80;
const monitorLogEntries = [];

const audioPipeline = createAudioPipeline({
    sendAudioChunk: (source, audioBuffer) => {
        window.electronAPI.sendAudioChunk(source, audioBuffer);
    },
    addMonitorLog: (...args) => addMonitorLog(...args)
});

const transcriptBufferManager = createTranscriptBufferManager({
    mergeWindowMs: 2400,
    onBuffer: ({ source, text, segments }) => {
        addMonitorLog('info', 'final-buffer', 'Buffered transcript segment', source, {
            segments,
            chars: text.length
        });
    },
    onFlush: ({ source, text, reason, segments }) => {
        if (source === 'system') {
            addChatMessage('voice-system', text);
        } else {
            addChatMessage('voice-mic', text);
        }

        addMonitorLog('info', 'final-flush', 'Merged transcript committed', source, {
            reason,
            segments,
            chars: text.length
        });
        showFeedback('Captured', 'success');
    }
});


// DOM elements
const statusText = document.getElementById('status-text');
const screenshotCount = document.getElementById('screenshot-count');
const resultsPanel = document.getElementById('results-panel');
const resultText = document.getElementById('result-text');
const loadingOverlay = document.getElementById('loading-overlay');
const emergencyOverlay = document.getElementById('emergency-overlay');
const chatContainer = document.getElementById('chat-container');
const chatMessagesElement = document.getElementById('chat-messages');
const chatComposer = document.getElementById('chat-composer');
const chatManualInput = document.getElementById('chat-manual-input');
const chatManualSend = document.getElementById('chat-manual-send');
const chatResizeHandle = document.getElementById('chat-resize-handle');
const transcriptionToggle = document.getElementById('transcription-toggle');
const sourceSystemToggle = document.getElementById('source-system-toggle');
const sourceMicToggle = document.getElementById('source-mic-toggle');
const monitorMasterState = document.getElementById('monitor-master-state');
const monitorStatusSystem = document.getElementById('monitor-status-system');
const monitorStatusMic = document.getElementById('monitor-status-mic');
const monitorLiveSystem = document.getElementById('monitor-live-system');
const monitorLiveMic = document.getElementById('monitor-live-mic');
const monitorLogList = document.getElementById('monitor-log-list');
const windowResizeHandles = document.querySelectorAll('[data-resize-handle]');

const screenshotBtn = document.getElementById('screenshot-btn');
const analyzeBtn = document.getElementById('analyze-btn');
const screenAiBtn = document.getElementById('screen-ai-btn');
const clearBtn = document.getElementById('clear-btn');
const hideBtn = document.getElementById('hide-btn');
const copyBtn = document.getElementById('copy-btn');
const closeResultsBtn = document.getElementById('close-results');
const closeAppBtn = document.getElementById('close-app-btn');
const closeConfirmationDialog = document.getElementById('close-confirmation-dialog');
const cancelCloseBtn = document.getElementById('cancel-close-btn');
const confirmCloseBtn = document.getElementById('confirm-close-btn');

// New Cluely-style buttons
const suggestBtn = document.getElementById('suggest-btn');
const notesBtn = document.getElementById('notes-btn');
const insightsBtn = document.getElementById('insights-btn');
const themeToggleBtn = document.getElementById('theme-toggle-btn');

// Settings elements
const settingsBtn = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const closeSettingsBtn = document.getElementById('close-settings');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const settingGeminiKey = document.getElementById('setting-gemini-key');
const settingGeminiModel = document.getElementById('setting-gemini-model');
const settingProgrammingLanguage = document.getElementById('setting-programming-language');
const settingAssemblyKey = document.getElementById('setting-assembly-key');
const settingAssemblyModel = document.getElementById('setting-assembly-model');
const settingWindowOpacity = document.getElementById('setting-window-opacity');
const settingWindowOpacityValue = document.getElementById('setting-window-opacity-value');
const settingsShortcutsList = document.getElementById('settings-shortcuts-list');

// Timer
let startTime = Date.now();
let timerInterval;
const MIN_WINDOW_WIDTH = 600;
const MIN_WINDOW_HEIGHT = 250;
const MIN_CHAT_HEIGHT = 150;
const MAX_CHAT_INPUT_HEIGHT = 88;

let activeWindowResize = null;
let pendingWindowBounds = null;
let windowResizeFrame = null;
let activeChatResize = null;
let isCloseConfirmationOpen = false;
let configuredKeyboardShortcuts = [];
const shortcutBindingsById = new Map();

// Initialize
async function init() {
    console.log('Initializing renderer with Vosk Live Transcription...');

    if (typeof window.electronAPI !== 'undefined') {
        console.log('electronAPI is available');
    } else {
        console.error('electronAPI not available');
        showFeedback('electronAPI not available', 'error');
    }

    await loadShortcutConfig();
    setupEventListeners();
    setupIpcListeners();
    setupWindowAdjustments();
    applyTheme(loadStoredThemePreference(), { persist: false });
    updateUI();
    updateTranscriptionUI();
    renderMonitorState();
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
    showFeedback('Ready - click transcription to start', 'success');
    addMonitorLog('info', 'init', 'Renderer initialized');
    addMonitorLog('info', 'source-defaults', 'Default sources: Host on, Mic off');
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function normalizeWindowOpacityLevel(value) {
    const parsedValue = Number.parseInt(String(value ?? ''), 10);

    if (!Number.isFinite(parsedValue)) {
        return 10;
    }

    return clamp(parsedValue, 1, 10);
}

function updateWindowOpacityValueLabel(value) {
    if (!settingWindowOpacityValue) {
        return;
    }

    const opacityLevel = normalizeWindowOpacityLevel(value);
    settingWindowOpacityValue.textContent = `${opacityLevel}/10`;
}

function normalizeTheme(theme) {
    return theme === THEME_DARK ? THEME_DARK : THEME_LIGHT;
}

function loadStoredThemePreference() {
    try {
        const savedTheme = window.localStorage?.getItem(THEME_STORAGE_KEY);
        return normalizeTheme(savedTheme);
    } catch (error) {
        console.warn('Failed to read saved theme preference:', error);
        return THEME_LIGHT;
    }
}

function saveThemePreference(theme) {
    try {
        window.localStorage?.setItem(THEME_STORAGE_KEY, normalizeTheme(theme));
    } catch (error) {
        console.warn('Failed to save theme preference:', error);
    }
}

function updateThemeToggleUi() {
    if (!themeToggleBtn) {
        return;
    }

    const isDarkMode = activeTheme === THEME_DARK;
    const nextThemeLabel = isDarkMode ? 'light' : 'dark';
    const ariaLabel = `Switch to ${nextThemeLabel} mode`;

    themeToggleBtn.classList.toggle('is-dark', isDarkMode);
    themeToggleBtn.setAttribute('aria-pressed', isDarkMode ? 'true' : 'false');
    themeToggleBtn.setAttribute('aria-label', ariaLabel);
    themeToggleBtn.removeAttribute('title');
}

function applyTheme(theme, options = {}) {
    const { persist = true, announce = false } = options;
    activeTheme = normalizeTheme(theme);

    document.body.classList.toggle('theme-dark', activeTheme === THEME_DARK);
    document.documentElement.setAttribute('data-theme', activeTheme);
    updateThemeToggleUi();

    if (persist) {
        saveThemePreference(activeTheme);
    }

    if (announce) {
        showFeedback(activeTheme === THEME_DARK ? 'Dark mode enabled' : 'Light mode enabled', 'info');
    }
}

function toggleThemeMode() {
    const nextTheme = activeTheme === THEME_DARK ? THEME_LIGHT : THEME_DARK;
    applyTheme(nextTheme, { persist: true, announce: true });
}

function normalizeShortcutToken(token) {
    const normalized = String(token || '').trim().toLowerCase();
    const aliasMap = {
        left: 'arrowleft',
        right: 'arrowright',
        up: 'arrowup',
        down: 'arrowdown',
        escape: 'escape',
        esc: 'escape',
        enter: 'enter',
        return: 'enter',
        plus: '+',
        space: ' '
    };

    if (Object.prototype.hasOwnProperty.call(aliasMap, normalized)) {
        return aliasMap[normalized];
    }

    return normalized;
}

function parseAcceleratorBinding(accelerator) {
    if (typeof accelerator !== 'string' || accelerator.trim().length === 0) {
        return null;
    }

    const tokens = accelerator
        .split('+')
        .map((token) => token.trim())
        .filter(Boolean);

    if (tokens.length === 0) {
        return null;
    }

    const binding = {
        ctrl: false,
        meta: false,
        ctrlOrMeta: false,
        alt: false,
        shift: false,
        key: ''
    };

    tokens.forEach((token) => {
        const normalized = String(token).toLowerCase();
        switch (normalized) {
            case 'commandorcontrol':
                binding.ctrlOrMeta = true;
                break;
            case 'ctrl':
            case 'control':
                binding.ctrl = true;
                break;
            case 'command':
            case 'cmd':
            case 'meta':
            case 'super':
                binding.meta = true;
                break;
            case 'alt':
            case 'option':
                binding.alt = true;
                break;
            case 'shift':
                binding.shift = true;
                break;
            default:
                binding.key = normalizeShortcutToken(normalized);
                break;
        }
    });

    if (!binding.key) {
        return null;
    }

    return binding;
}

function normalizeKeyboardShortcutDefinition(shortcut) {
    if (!shortcut || typeof shortcut !== 'object') {
        return null;
    }

    const id = typeof shortcut.id === 'string' ? shortcut.id.trim() : '';
    const accelerator = typeof shortcut.accelerator === 'string' ? shortcut.accelerator.trim() : '';
    if (!id || !accelerator) {
        return null;
    }

    const buttonLabel = typeof shortcut.buttonLabel === 'string' && shortcut.buttonLabel.trim()
        ? shortcut.buttonLabel.trim()
        : id;
    const description = typeof shortcut.description === 'string' ? shortcut.description.trim() : '';

    return {
        id,
        accelerator,
        buttonLabel,
        description
    };
}

function setConfiguredKeyboardShortcuts(shortcuts) {
    const normalizedShortcuts = Array.isArray(shortcuts)
        ? shortcuts
            .map((shortcut) => normalizeKeyboardShortcutDefinition(shortcut))
            .filter(Boolean)
        : [];

    configuredKeyboardShortcuts = normalizedShortcuts;
    shortcutBindingsById.clear();

    normalizedShortcuts.forEach((shortcut) => {
        const parsedBinding = parseAcceleratorBinding(shortcut.accelerator);
        if (parsedBinding) {
            shortcutBindingsById.set(shortcut.id, parsedBinding);
        }
    });

    renderKeyboardShortcutsInSettings();
}

function getShortcutBinding(shortcutId) {
    return shortcutBindingsById.get(shortcutId) || null;
}

function isShortcutPressed(event, shortcutId) {
    const binding = getShortcutBinding(shortcutId);
    if (!binding) {
        return false;
    }

    const eventKey = normalizeShortcutToken(event.key);
    if (eventKey !== binding.key) {
        return false;
    }

    if (binding.ctrlOrMeta) {
        if (!event.ctrlKey && !event.metaKey) {
            return false;
        }
    } else {
        if (event.ctrlKey !== binding.ctrl || event.metaKey !== binding.meta) {
            return false;
        }
    }

    return event.altKey === binding.alt && event.shiftKey === binding.shift;
}

function formatShortcutTokenForDisplay(token) {
    const normalized = String(token || '').trim().toLowerCase();
    const displayMap = {
        commandorcontrol: navigator.platform.toLowerCase().includes('mac') ? 'Cmd' : 'Ctrl',
        command: 'Cmd',
        cmd: 'Cmd',
        control: 'Ctrl',
        ctrl: 'Ctrl',
        alt: navigator.platform.toLowerCase().includes('mac') ? 'Option' : 'Alt',
        option: 'Option',
        shift: 'Shift',
        left: 'Left',
        right: 'Right',
        up: 'Up',
        down: 'Down'
    };

    if (Object.prototype.hasOwnProperty.call(displayMap, normalized)) {
        return displayMap[normalized];
    }

    if (normalized.length === 1) {
        return normalized.toUpperCase();
    }

    return token;
}

function formatShortcutForDisplay(accelerator) {
    return String(accelerator || '')
        .split('+')
        .map((token) => token.trim())
        .filter(Boolean)
        .map((token) => formatShortcutTokenForDisplay(token))
        .join('+');
}

function renderKeyboardShortcutsInSettings() {
    if (!settingsShortcutsList) {
        return;
    }

    settingsShortcutsList.innerHTML = '';

    if (!configuredKeyboardShortcuts.length) {
        const emptyState = document.createElement('div');
        emptyState.className = 'settings-shortcuts-empty';
        emptyState.textContent = 'No shortcuts configured.';
        settingsShortcutsList.appendChild(emptyState);
        return;
    }

    configuredKeyboardShortcuts.forEach((shortcut) => {
        const row = document.createElement('div');
        row.className = 'settings-shortcut-row';

        const buttonLabel = document.createElement('span');
        buttonLabel.className = 'settings-shortcut-button';
        buttonLabel.textContent = shortcut.buttonLabel;
        if (shortcut.description) {
            buttonLabel.title = shortcut.description;
        }

        const shortcutValue = document.createElement('span');
        shortcutValue.className = 'settings-shortcut-key';
        shortcutValue.textContent = formatShortcutForDisplay(shortcut.accelerator);

        row.appendChild(buttonLabel);
        row.appendChild(shortcutValue);
        settingsShortcutsList.appendChild(row);
    });
}

function applySettingsShortcutConfig(settings) {
    if (!settings || settings.error) {
        return;
    }

    setConfiguredKeyboardShortcuts(settings.keyboardShortcuts);
}

async function loadShortcutConfig() {
    if (!window.electronAPI?.getSettings) {
        return;
    }

    try {
        const settings = await window.electronAPI.getSettings();
        applySettingsShortcutConfig(settings);
    } catch (error) {
        console.error('Failed to load shortcut config:', error);
    }
}

function setupWindowAdjustments() {
    setupWindowResizeHandles();
    setupChatResizeHandle();
    window.addEventListener('resize', () => {
        autoResizeManualInput();
    });
}

function setupWindowResizeHandles() {
    if (!window.electronAPI || !windowResizeHandles.length) {
        return;
    }

    windowResizeHandles.forEach((handle) => {
        handle.addEventListener('pointerdown', startWindowResize);
    });
}

async function startWindowResize(event) {
    if (!window.electronAPI?.getWindowBounds || !window.electronAPI?.setWindowBounds) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();

    const handleElement = event.currentTarget;
    if (!handleElement) {
        return;
    }

    const direction = handleElement.dataset.resizeHandle;
    const pointerId = event.pointerId;
    const startScreenX = event.screenX;
    const startScreenY = event.screenY;
    const startBounds = await window.electronAPI.getWindowBounds();
    if (!startBounds || startBounds.error) {
        console.error('Failed to get initial window bounds:', startBounds?.error);
        return;
    }

    activeWindowResize = {
        direction,
        pointerId,
        startScreenX,
        startScreenY,
        startBounds,
        handleElement
    };

    document.body.classList.add('window-resizing');
    handleElement.setPointerCapture?.(pointerId);

    document.addEventListener('pointermove', onWindowResizeMove);
    document.addEventListener('pointerup', stopWindowResize);
    document.addEventListener('pointercancel', stopWindowResize);
}

function onWindowResizeMove(event) {
    if (!activeWindowResize || event.pointerId !== activeWindowResize.pointerId) {
        return;
    }

    event.preventDefault();

    const deltaX = event.screenX - activeWindowResize.startScreenX;
    const deltaY = event.screenY - activeWindowResize.startScreenY;
    const nextBounds = calculateWindowResizeBounds(
        activeWindowResize.startBounds,
        activeWindowResize.direction,
        deltaX,
        deltaY
    );

    scheduleWindowResize(nextBounds);
}

function calculateWindowResizeBounds(startBounds, direction, deltaX, deltaY) {
    let { x, y, width, height } = startBounds;

    if (direction.includes('e')) {
        width = Math.max(MIN_WINDOW_WIDTH, startBounds.width + deltaX);
    }

    if (direction.includes('s')) {
        height = Math.max(MIN_WINDOW_HEIGHT, startBounds.height + deltaY);
    }

    if (direction.includes('w')) {
        const nextWidth = Math.max(MIN_WINDOW_WIDTH, startBounds.width - deltaX);
        x = startBounds.x + (startBounds.width - nextWidth);
        width = nextWidth;
    }

    if (direction.includes('n')) {
        const nextHeight = Math.max(MIN_WINDOW_HEIGHT, startBounds.height - deltaY);
        y = startBounds.y + (startBounds.height - nextHeight);
        height = nextHeight;
    }

    return {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height)
    };
}

function scheduleWindowResize(bounds) {
    pendingWindowBounds = bounds;
    if (windowResizeFrame) {
        return;
    }

    windowResizeFrame = window.requestAnimationFrame(async () => {
        windowResizeFrame = null;
        const nextBounds = pendingWindowBounds;
        pendingWindowBounds = null;

        if (!nextBounds) {
            return;
        }

        const result = await window.electronAPI.setWindowBounds(nextBounds);
        if (result && result.error) {
            console.error('Failed to set window bounds:', result.error);
        }
    });
}

function stopWindowResize(event) {
    if (!activeWindowResize) {
        return;
    }

    if (event.pointerId && event.pointerId !== activeWindowResize.pointerId) {
        return;
    }

    activeWindowResize.handleElement?.releasePointerCapture?.(activeWindowResize.pointerId);
    activeWindowResize = null;
    pendingWindowBounds = null;

    if (windowResizeFrame) {
        window.cancelAnimationFrame(windowResizeFrame);
        windowResizeFrame = null;
    }

    document.body.classList.remove('window-resizing');
    document.removeEventListener('pointermove', onWindowResizeMove);
    document.removeEventListener('pointerup', stopWindowResize);
    document.removeEventListener('pointercancel', stopWindowResize);
}

function setupChatResizeHandle() {
    if (!chatContainer || !chatResizeHandle) {
        return;
    }

    chatResizeHandle.addEventListener('pointerdown', startChatResize);
}

function startChatResize(event) {
    event.preventDefault();
    event.stopPropagation();

    activeChatResize = {
        pointerId: event.pointerId,
        startClientY: event.clientY,
        startHeight: chatContainer.getBoundingClientRect().height
    };

    document.body.classList.add('chat-resizing');
    chatResizeHandle.setPointerCapture?.(event.pointerId);

    document.addEventListener('pointermove', onChatResizeMove);
    document.addEventListener('pointerup', stopChatResize);
    document.addEventListener('pointercancel', stopChatResize);
}

function onChatResizeMove(event) {
    if (!activeChatResize || event.pointerId !== activeChatResize.pointerId) {
        return;
    }

    event.preventDefault();

    const deltaY = event.clientY - activeChatResize.startClientY;
    const mainInterface = document.querySelector('.main-interface');
    const monitorSection = document.getElementById('transcription-monitor');
    const reservedHeight =
        (mainInterface?.getBoundingClientRect().height || 0) +
        (monitorSection?.getBoundingClientRect().height || 0) +
        56;
    const maxChatHeight = Math.max(MIN_CHAT_HEIGHT, window.innerHeight - reservedHeight);
    const nextHeight = clamp(activeChatResize.startHeight + deltaY, MIN_CHAT_HEIGHT, maxChatHeight);

    chatContainer.style.height = `${Math.round(nextHeight)}px`;
}

function stopChatResize(event) {
    if (!activeChatResize) {
        return;
    }

    if (event.pointerId && event.pointerId !== activeChatResize.pointerId) {
        return;
    }

    chatResizeHandle.releasePointerCapture?.(activeChatResize.pointerId);
    activeChatResize = null;
    document.body.classList.remove('chat-resizing');
    document.removeEventListener('pointermove', onChatResizeMove);
    document.removeEventListener('pointerup', stopChatResize);
    document.removeEventListener('pointercancel', stopChatResize);
}

function sourceLabel(source) {
    return resolveSourceLabel(source);
}

function isTranscriptMessageType(type) {
    return isTranscriptMessageTypeRule(type);
}

function isScreenshotMessageType(type) {
    return isScreenshotMessageTypeRule(type);
}

function isSystemMessageType(type) {
    return isSystemMessageTypeRule(type);
}

function isAiResponseMessageType(type) {
    return isAiResponseMessageTypeRule(type);
}

function canToggleAiForMessageType(type) {
    return canToggleAiForMessageTypeRule(type);
}

function defaultIncludeInAiForMessageType(type) {
    return defaultIncludeInAiForMessageTypeRule(type);
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function isMessageIncludedForAi(message) {
    return messageStore.isIncludedForAi(message);
}

function buildFilteredAiContextBundle({ charBudget = AI_CONTEXT_CHAR_BUDGET, emitTruncationLog = true } = {}) {
    return buildAiContextBundle({
        messages: chatMessagesArray,
        isMessageIncludedForAi,
        charBudget,
        emitTruncationLog,
        onTruncationLog: (dropped, budget) => {
            addMonitorLog(
                'info',
                'context-cap',
                `Trimmed ${dropped} older context message(s) to stay within ${budget} chars`
            );
        }
    });
}

function findChatMessageById(messageId) {
    return messageStore.findById(messageId);
}

function updateMessageAiToggleUi(message) {
    syncMessageAiToggleUi(chatMessagesElement, message);
}

function toggleChatMessageInclusion(messageId) {
    const message = messageStore.toggleInclusion(messageId);
    if (!message) return;

    chatMessagesArray = messageStore.getMessages();
    updateMessageAiToggleUi(message);
    updateUI();

    const stateText = message.includeInAi ? 'included in' : 'excluded from';
    addMonitorLog('info', 'ai-context-toggle', `Message ${stateText} AI context`, null, {
        id: message.id,
        type: message.type
    });
}

function normalizeSource(source) {
    return normalizeAssemblySource(source);
}

function isSourceActive(source) {
    return source === 'system' ? isSystemActive : isMicActive;
}

function setMicActive(active) {
    isMicActive = !!active;
    transcriptionSourceState.setSourceActive('mic', isMicActive);
}

function setSystemActive(active) {
    isSystemActive = !!active;
    transcriptionSourceState.setSourceActive('system', isSystemActive);
}

function isAnyTranscriptionActive() {
    return isSystemActive || isMicActive;
}

function isAnySourceConnecting() {
    return transcriptionSourceState.isAnySourceConnecting();
}

function setSourceStatus(source, status, liveText) {
    const resolvedSource = normalizeSource(source);
    transcriptionSourceState.setSourceStatus(resolvedSource, status);

    if (typeof liveText === 'string' && liveText.trim().length > 0) {
        monitorLastText[resolvedSource] = liveText.trim();
    }

    renderMonitorState();
}

function updateTranscriptionUI() {
    const anyActive = isAnyTranscriptionActive();
    const anyConnecting = !anyActive && isAnySourceConnecting();

    if (transcriptionToggle) {
        transcriptionToggle.classList.toggle('active', anyActive);
        transcriptionToggle.classList.toggle('listening', anyActive);
        transcriptionToggle.classList.toggle('connecting', anyConnecting);
    }

    if (sourceSystemToggle) {
        sourceSystemToggle.classList.toggle('selected', selectedSources.system);
        sourceSystemToggle.classList.toggle('running', isSystemActive);
    }

    if (sourceMicToggle) {
        sourceMicToggle.classList.toggle('selected', selectedSources.mic);
        sourceMicToggle.classList.toggle('running', isMicActive);
    }
}

function renderMonitorState() {
    updateTranscriptionUI();

    const statusMap = {
        off: 'Off',
        connecting: 'Connecting',
        listening: 'Listening',
        error: 'Error'
    };

    if (monitorStatusSystem) {
        monitorStatusSystem.className = `monitor-status-badge ${sourceStatuses.system}`;
        monitorStatusSystem.textContent = statusMap[sourceStatuses.system] || 'Off';
    }

    if (monitorStatusMic) {
        monitorStatusMic.className = `monitor-status-badge ${sourceStatuses.mic}`;
        monitorStatusMic.textContent = statusMap[sourceStatuses.mic] || 'Off';
    }

    if (monitorLiveSystem) {
        monitorLiveSystem.textContent = monitorLastText.system || 'No transcript yet';
    }

    if (monitorLiveMic) {
        monitorLiveMic.textContent = monitorLastText.mic || 'No transcript yet';
    }

    if (monitorMasterState) {
        monitorMasterState.classList.remove('active', 'connecting');
        if (isAnyTranscriptionActive()) {
            monitorMasterState.textContent = 'Running';
            monitorMasterState.classList.add('active');
        } else if (isAnySourceConnecting()) {
            monitorMasterState.textContent = 'Connecting';
            monitorMasterState.classList.add('connecting');
        } else {
            monitorMasterState.textContent = 'Idle';
        }
    }
}

function formatMonitorTime(timestamp = Date.now()) {
    return new Date(timestamp).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

function safeJson(value) {
    try {
        return JSON.stringify(value);
    } catch (_) {
        return '';
    }
}

function addMonitorLog(level, event, message, source = null, meta = null, timestamp = Date.now()) {
    const entry = {
        level: level || 'info',
        event: event || 'event',
        message: message || '',
        source: source ? normalizeSource(source) : null,
        meta,
        timestamp
    };

    monitorLogEntries.push(entry);
    if (monitorLogEntries.length > MAX_MONITOR_LOG_ENTRIES) {
        monitorLogEntries.shift();
    }

    if (!monitorLogList) {
        return;
    }

    monitorLogList.innerHTML = '';
    const entriesToRender = [...monitorLogEntries].reverse();
    for (const item of entriesToRender) {
        const row = document.createElement('div');
        row.className = `monitor-log-entry ${item.level === 'error' ? 'error' : ''}`.trim();

        const sourcePrefix = item.source ? `${sourceLabel(item.source)} ` : '';
        const metaText = item.meta ? ` ${safeJson(item.meta)}` : '';
        row.textContent = `${formatMonitorTime(item.timestamp)} ${sourcePrefix}${item.event}: ${item.message}${metaText}`;
        monitorLogList.appendChild(row);
    }
}

function resetFinalTranscriptBuffer(source) {
    transcriptBufferManager.resetFinalTranscriptBuffer(source);
}

function flushFinalTranscript(source, reason = 'pause-timeout') {
    transcriptBufferManager.flushFinalTranscript(source, reason);
}

function queueFinalTranscript(source, text) {
    transcriptBufferManager.queueFinalTranscript(source, text);
}

function flushAllFinalTranscripts(reason = 'flush-all') {
    transcriptBufferManager.flushAllFinalTranscripts(reason);
}

function setSourceSelected(source, enabled) {
    const resolvedSource = normalizeSource(source);
    transcriptionSourceState.setSourceSelected(resolvedSource, enabled);
    addMonitorLog('info', 'source-toggle', `${sourceLabel(resolvedSource)} ${enabled ? 'enabled' : 'disabled'}`, resolvedSource);
    updateTranscriptionUI();

    if (isAnyTranscriptionActive() || sourceStatuses[resolvedSource] === 'connecting') {
        ensureSourceRunning(resolvedSource, !!enabled).catch((error) => {
            console.error(`Failed to apply live source toggle for ${resolvedSource}:`, error);
            addMonitorLog('error', 'source-toggle-failed', error.message, resolvedSource);
        });
    }
}

async function ensureSourceRunning(source, shouldRun) {
    const resolvedSource = normalizeSource(source);
    if (shouldRun) {
        if (resolvedSource === 'system') {
            await startSystemAudioRecording();
        } else {
            await startMicRecording();
        }
    } else if (resolvedSource === 'system') {
        await stopSystemAudioRecording();
    } else {
        await stopMicRecording();
    }
}

async function startSelectedSources() {
    if (!selectedSources.system && !selectedSources.mic) {
        const message = 'Select at least one source (Host or Mic) before starting transcription.';
        showFeedback(message, 'error');
        addMonitorLog('error', 'start-blocked', message);
        return;
    }

    addMonitorLog('info', 'master-start', 'Starting selected transcription sources');

    if (selectedSources.system) {
        await ensureSourceRunning('system', true);
    }

    if (selectedSources.mic) {
        await ensureSourceRunning('mic', true);
    }
}

async function stopAllSources() {
    addMonitorLog('info', 'master-stop', 'Stopping all active transcription sources');
    if (isSystemActive || sourceStatuses.system === 'connecting') {
        await stopSystemAudioRecording();
    }
    if (isMicActive || sourceStatuses.mic === 'connecting') {
        await stopMicRecording();
    }
}

async function toggleMasterTranscription() {
    if (isAnyTranscriptionActive() || isAnySourceConnecting()) {
        await stopAllSources();
    } else {
        await startSelectedSources();
    }
    updateTranscriptionUI();
}

function isLikelyCameraTrack(trackLabel) {
    return audioPipeline.isLikelyCameraTrack(trackLabel);
}

async function getSystemAudioStream(sourceId) {
    return audioPipeline.getSystemAudioStream(sourceId);
}

function resetSourceSampleQueue(source) {
    audioPipeline.resetSourceSampleQueue(source);
}

function drainSourceSampleQueue(source, { flushPartial = false } = {}) {
    audioPipeline.drainSourceSampleQueue(source, { flushPartial });
}

async function buildAudioProcessor(context, stream, source, activeCheck) {
    return audioPipeline.buildAudioProcessor(context, stream, source, activeCheck);
}

function stopAudioResources(ctx, stream, processor) {
    audioPipeline.stopAudioResources(ctx, stream, processor);
}

async function startMicRecording() {
    if (isMicActive || sourceStatuses.mic === 'connecting') return;
    setSourceStatus('mic', 'connecting', 'Connecting to mic...');
    addMonitorLog('info', 'start-request', 'Starting mic source', 'mic');
    resetFinalTranscriptBuffer('mic');

    try {
        const result = await window.electronAPI.startVoiceRecognition('mic');
        if (result && result.error) throw new Error(result.error);

        micMediaStream = await navigator.mediaDevices.getUserMedia({
            audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
        });
        micAudioContext = new AudioContext();
        await micAudioContext.resume();
        resetSourceSampleQueue('mic');
        micScriptProcessor = await buildAudioProcessor(micAudioContext, micMediaStream, 'mic', () => isMicActive);

        setMicActive(true);
        addChatMessage('system', 'Mic listening...');
        showFeedback('Mic on', 'success');
        addMonitorLog('info', 'source-active', 'Mic source active', 'mic');
    } catch (error) {
        console.error('Failed to start mic:', error);
        showFeedback(`Mic failed: ${error.message}`, 'error');
        addMonitorLog('error', 'source-failed', error.message, 'mic');
        stopAudioResources(micAudioContext, micMediaStream, micScriptProcessor);
        micAudioContext = null; micMediaStream = null; micScriptProcessor = null;
        setMicActive(false);
        resetSourceSampleQueue('mic');
        setSourceStatus('mic', 'error', `Mic error: ${error.message}`);
        try {
            await window.electronAPI.stopVoiceRecognition('mic');
        } catch (_) {}
    }

    updateTranscriptionUI();
}

async function stopMicRecording() {
    if (!isMicActive && sourceStatuses.mic !== 'connecting') return;
    drainSourceSampleQueue('mic', { flushPartial: true });
    flushFinalTranscript('mic', 'stop-request');
    stopAudioResources(micAudioContext, micMediaStream, micScriptProcessor);
    micAudioContext = null; micMediaStream = null; micScriptProcessor = null;
    if (micPartialDiv) { micPartialDiv.remove(); micPartialDiv = null; }
    micPartialText = '';
    try {
        await window.electronAPI.stopVoiceRecognition('mic');
    } catch (error) {
        addMonitorLog('error', 'stop-failed', error.message || 'Failed to stop mic source', 'mic');
    }
    setMicActive(false);
    resetSourceSampleQueue('mic');
    audioPipeline.resetChunkCounter('mic');
    setSourceStatus('mic', 'off', 'Mic stopped');
    addMonitorLog('info', 'source-stopped', 'Mic source stopped', 'mic');
    showFeedback('Mic off', 'info');
}

async function startSystemAudioRecording() {
    if (isSystemActive || sourceStatuses.system === 'connecting') return;
    setSourceStatus('system', 'connecting', 'Connecting to host audio...');
    addMonitorLog('info', 'start-request', 'Starting host audio source', 'system');
    resetFinalTranscriptBuffer('system');

    try {
        const sources = await window.electronAPI.getDesktopSources();
        if (!sources || sources.length === 0) throw new Error('No desktop sources found');
        const sourceId = sources[0].id;
        addMonitorLog('info', 'desktop-source', `Using desktop source: ${sources[0].name || sourceId}`, 'system');

        const result = await window.electronAPI.startVoiceRecognition('system');
        if (result && result.error) throw new Error(result.error);

        systemMediaStream = await getSystemAudioStream(sourceId);

        const videoTrack = systemMediaStream.getVideoTracks()[0];
        if (videoTrack && isLikelyCameraTrack(videoTrack.label)) {
            throw new Error(`Desktop capture fell back to camera source (${videoTrack.label || 'unknown'}).`);
        }

        systemMediaStream.getVideoTracks().forEach(t => t.stop());

        systemAudioContext = new AudioContext();
        await systemAudioContext.resume();
        resetSourceSampleQueue('system');
        systemScriptProcessor = await buildAudioProcessor(systemAudioContext, systemMediaStream, 'system', () => isSystemActive);

        setSystemActive(true);
        addChatMessage('system', 'Listening to host audio...');
        showFeedback('System audio on', 'success');
        addMonitorLog('info', 'source-active', 'Host source active', 'system');
    } catch (error) {
        console.error('Failed to start system audio:', error);
        showFeedback(`System audio failed: ${error.message}`, 'error');
        addMonitorLog('error', 'source-failed', error.message, 'system');
        stopAudioResources(systemAudioContext, systemMediaStream, systemScriptProcessor);
        systemAudioContext = null; systemMediaStream = null; systemScriptProcessor = null;
        setSystemActive(false);
        resetSourceSampleQueue('system');
        setSourceStatus('system', 'error', `Host error: ${error.message}`);
        try {
            await window.electronAPI.stopVoiceRecognition('system');
        } catch (_) {}
    }

    updateTranscriptionUI();
}

async function stopSystemAudioRecording() {
    if (!isSystemActive && sourceStatuses.system !== 'connecting') return;
    drainSourceSampleQueue('system', { flushPartial: true });
    flushFinalTranscript('system', 'stop-request');
    stopAudioResources(systemAudioContext, systemMediaStream, systemScriptProcessor);
    systemAudioContext = null; systemMediaStream = null; systemScriptProcessor = null;
    if (systemPartialDiv) { systemPartialDiv.remove(); systemPartialDiv = null; }
    systemPartialText = '';
    try {
        await window.electronAPI.stopVoiceRecognition('system');
    } catch (error) {
        addMonitorLog('error', 'stop-failed', error.message || 'Failed to stop host source', 'system');
    }
    setSystemActive(false);
    resetSourceSampleQueue('system');
    audioPipeline.resetChunkCounter('system');
    setSourceStatus('system', 'off', 'Host source stopped');
    addMonitorLog('info', 'source-stopped', 'Host source stopped', 'system');
    showFeedback('System audio off', 'info');
}

function handleVoskPartial(data) {
    const source = normalizeSource(data?.source);
    const text = data?.text;
    if (!text || text.trim().length === 0) return;
    if (!isSourceActive(source)) return;

    const trimmed = text.trim();
    const icon = source === 'system' ? '\u{1F50A}' : '\u{1F3A4}';
    monitorLastText[source] = `Live: ${trimmed}`;
    renderMonitorState();

    if (source === 'mic') {
        micPartialText = trimmed;
        if (!micPartialDiv) {
            micPartialDiv = createPartialDiv(icon);
            chatMessagesElement.appendChild(micPartialDiv);
        }
        micPartialDiv.querySelector('.message-content').textContent = trimmed;
    } else {
        systemPartialText = trimmed;
        if (!systemPartialDiv) {
            systemPartialDiv = createPartialDiv(icon);
            chatMessagesElement.appendChild(systemPartialDiv);
        }
        systemPartialDiv.querySelector('.message-content').textContent = trimmed;
    }
    chatMessagesElement.scrollTop = chatMessagesElement.scrollHeight;
}

function createPartialDiv(icon) {
    const div = document.createElement('div');
    div.className = 'chat-message voice-message partial';
    const ts = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `
        <div class="message-header">
            <span class="message-icon">${icon}</span>
            <span class="message-time">${ts}</span>
            <span class="partial-indicator">Live</span>
        </div>
        <div class="message-content partial-text"></div>
    `;
    return div;
}

function handleVoskFinal(data) {
    const source = normalizeSource(data?.source);
    const text = data?.text;
    if (!text || text.trim().length === 0) return;

    const finalText = text.trim();
    monitorLastText[source] = `Final: ${finalText}`;
    renderMonitorState();
    addMonitorLog('info', 'final', 'Final transcript received', source, {
        chars: finalText.length
    });

    if (source === 'mic') {
        if (micPartialDiv) { micPartialDiv.remove(); micPartialDiv = null; }
        micPartialText = '';
    } else {
        if (systemPartialDiv) { systemPartialDiv.remove(); systemPartialDiv = null; }
        systemPartialText = '';
    }
    queueFinalTranscript(source, finalText);
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

function getTranscriptMessages() {
    return chatMessagesArray.filter((message) =>
        message.type === 'voice' ||
        message.type === 'voice-mic' ||
        message.type === 'voice-system'
    );
}

function buildAskAiContextPayload() {
    const bundle = buildFilteredAiContextBundle({ charBudget: AI_CONTEXT_CHAR_BUDGET, emitTruncationLog: true });
    return {
        mode: 'best-next-answer',
        contextString: bundle.contextString,
        transcriptContext: bundle.transcriptContext,
        sessionSummary: bundle.sessionSummary,
        enabledScreenshotIds: bundle.enabledScreenshotIds,
        screenshotCount: bundle.enabledScreenshotIds.length
    };
}

async function askAiWithSessionContext() {
    if (!window.electronAPI?.askAiWithSessionContext) {
        showFeedback('Feature not available', 'error');
        return;
    }

    const payload = buildAskAiContextPayload();
    if (!payload.contextString && payload.enabledScreenshotIds.length === 0) {
        showFeedback('No transcript or screenshots available yet', 'error');
        return;
    }

    try {
        setAnalyzing(true);
        showLoadingOverlay('Analyzing full session context...');
        const result = await window.electronAPI.askAiWithSessionContext(payload);
        setAnalyzing(false);
        hideLoadingOverlay();

        if (result?.success && result?.text) {
            const heading = result.usedScreenshots
                ? '**Best Next Answer (Transcript + Screen):**'
                : '**Best Next Answer (Transcript):**';
            addChatMessage('ai-response', `${heading}\n\n${result.text}`);
            showFeedback('Ask AI ready', 'success');
        } else {
            throw new Error(result?.error || 'Ask AI failed');
        }
    } catch (error) {
        console.error('Ask AI error:', error);
        setAnalyzing(false);
        hideLoadingOverlay();
        showFeedback('Ask AI failed', 'error');
        addChatMessage('system', `Error: ${error.message}`);
    }
}

async function analyzeScreenshotsOnly() {
    const bundle = buildFilteredAiContextBundle({ charBudget: AI_CONTEXT_CHAR_BUDGET, emitTruncationLog: true });
    if (bundle.enabledScreenshotIds.length === 0) {
        showFeedback('No enabled screenshots to analyze', 'error');
        return;
    }

    try {
        setAnalyzing(true);
        showLoadingOverlay('Analyzing screenshots...');

        await window.electronAPI.analyzeStealthWithContext({
            contextString: bundle.contextString,
            enabledScreenshotIds: bundle.enabledScreenshotIds
        });
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
        if (window.electronAPI.clearConversationHistory) {
            await window.electronAPI.clearConversationHistory();
        }
        screenshotsCount = 0;
        messageStore.clear();
        chatMessagesArray = messageStore.getMessages();
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

function openCloseConfirmation() {
    if (!closeConfirmationDialog) {
        closeApplication();
        return;
    }

    isCloseConfirmationOpen = true;
    closeConfirmationDialog.classList.remove('hidden');
    confirmCloseBtn?.focus();
}

function closeCloseConfirmation() {
    if (!closeConfirmationDialog) {
        return;
    }

    isCloseConfirmationOpen = false;
    closeConfirmationDialog.classList.add('hidden');
    closeAppBtn?.focus();
}

async function closeApplication() {
    try {
        console.log('Closing application...');
        flushAllFinalTranscripts('app-close');
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
        const bundle = buildFilteredAiContextBundle({ charBudget: AI_CONTEXT_CHAR_BUDGET, emitTruncationLog: true });
        if (!bundle.contextString) {
            showFeedback('No enabled context available for suggestions', 'error');
            return;
        }

        const result = await window.electronAPI.suggestResponse({
            context: bundle.sessionSummary || 'Current meeting conversation',
            contextString: bundle.contextString
        });

        if (result.success && result.suggestions) {
            addChatMessage('ai-response', `\u{1F4A1} **What should I say?**\n\n${result.suggestions}`);
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
        const bundle = buildFilteredAiContextBundle({ charBudget: AI_CONTEXT_CHAR_BUDGET, emitTruncationLog: true });
        if (!bundle.contextString) {
            setAnalyzing(false);
            showFeedback('No enabled context available for notes', 'error');
            return;
        }

        const result = await window.electronAPI.generateMeetingNotes({
            contextString: bundle.contextString
        });

        setAnalyzing(false);

        if (result.success && result.notes) {
            addChatMessage('ai-response', `\u{1F4DD} **Meeting Notes**\n\n${result.notes}`);
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
        const bundle = buildFilteredAiContextBundle({ charBudget: AI_CONTEXT_CHAR_BUDGET, emitTruncationLog: true });
        if (!bundle.contextString) {
            setAnalyzing(false);
            showFeedback('No enabled context available for insights', 'error');
            return;
        }

        const result = await window.electronAPI.getConversationInsights({
            contextString: bundle.contextString
        });

        setAnalyzing(false);

        if (result.success && result.insights) {
            addChatMessage('ai-response', `\u{1F4CA} **Conversation Insights**\n\n${result.insights}`);
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

// SETTINGS FUNCTIONS

async function openSettings() {
    if (!settingsPanel) return;

    try {
        const settings = await window.electronAPI.getSettings();
        if (settings && !settings.error) {
            applySettingsShortcutConfig(settings);
            if (settingGeminiKey) settingGeminiKey.value = settings.geminiApiKey || '';
            populateGeminiModelOptions(settings.geminiModels, settings.geminiModel || settings.defaultGeminiModel);
            populateProgrammingLanguageOptions(
                settings.programmingLanguages,
                settings.programmingLanguage || settings.defaultProgrammingLanguage
            );
            if (settingAssemblyKey) settingAssemblyKey.value = settings.assemblyAiApiKey || '';
            populateAssemblyAiSpeechModelOptions(
                settings.assemblyAiSpeechModels,
                settings.assemblyAiSpeechModel || settings.defaultAssemblyAiSpeechModel
            );
            if (settingWindowOpacity) {
                settingWindowOpacity.value = normalizeWindowOpacityLevel(settings.windowOpacityLevel);
            }
            updateWindowOpacityValueLabel(settings.windowOpacityLevel);
        }
    } catch (error) {
        console.error('Failed to load settings:', error);
    }

    settingsPanel.classList.remove('hidden');
}

function closeSettings() {
    if (settingsPanel) settingsPanel.classList.add('hidden');
}

function populateGeminiModelOptions(models, selectedModel) {
    if (!settingGeminiModel) {
        return;
    }

    settingGeminiModel.innerHTML = '';

    const configuredModels = Array.isArray(models) ? models : [];
    if (configuredModels.length === 0) {
        throw new Error('Gemini models are not configured.');
    }

    configuredModels.forEach((modelName) => {
        const option = document.createElement('option');
        option.value = modelName;
        option.textContent = modelName;
        settingGeminiModel.appendChild(option);
    });

    settingGeminiModel.value = configuredModels.includes(selectedModel)
        ? selectedModel
        : configuredModels[0];
}

function populateProgrammingLanguageOptions(languages, selectedLanguage) {
    if (!settingProgrammingLanguage) {
        return;
    }

    settingProgrammingLanguage.innerHTML = '';

    const configuredLanguages = Array.isArray(languages) ? languages : [];
    if (configuredLanguages.length === 0) {
        throw new Error('Programming languages are not configured.');
    }

    configuredLanguages.forEach((languageName) => {
        const option = document.createElement('option');
        option.value = languageName;
        option.textContent = languageName;
        settingProgrammingLanguage.appendChild(option);
    });

    settingProgrammingLanguage.value = configuredLanguages.includes(selectedLanguage)
        ? selectedLanguage
        : configuredLanguages[0];
}

function populateAssemblyAiSpeechModelOptions(models, selectedModel) {
    if (!settingAssemblyModel) {
        return;
    }

    settingAssemblyModel.innerHTML = '';

    const configuredModels = Array.isArray(models) ? models : [];
    if (configuredModels.length === 0) {
        throw new Error('AssemblyAI speech models are not configured.');
    }

    configuredModels.forEach((modelName) => {
        const option = document.createElement('option');
        option.value = modelName;
        option.textContent = modelName;
        settingAssemblyModel.appendChild(option);
    });

    settingAssemblyModel.value = configuredModels.includes(selectedModel)
        ? selectedModel
        : configuredModels[0];
}

async function saveSettings() {
    try {
        if (!settingGeminiModel || settingGeminiModel.options.length === 0) {
            throw new Error('Gemini models are not configured.');
        }

        if (!settingProgrammingLanguage || settingProgrammingLanguage.options.length === 0) {
            throw new Error('Programming languages are not configured.');
        }

        if (!settingAssemblyModel || settingAssemblyModel.options.length === 0) {
            throw new Error('AssemblyAI speech models are not configured.');
        }

        const settings = {
            geminiApiKey: settingGeminiKey ? settingGeminiKey.value.trim() : '',
            assemblyAiApiKey: settingAssemblyKey ? settingAssemblyKey.value.trim() : '',
            geminiModel: settingGeminiModel.value,
            programmingLanguage: settingProgrammingLanguage.value,
            assemblyAiSpeechModel: settingAssemblyModel.value,
            windowOpacityLevel: normalizeWindowOpacityLevel(settingWindowOpacity?.value)
        };

        const result = await window.electronAPI.saveSettings(settings);

        if (result.success) {
            showFeedback('Settings saved. AI changes are active now; voice model applies next session.', 'success');
            closeSettings();
        } else {
            showFeedback(`Failed to save: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('Failed to save settings:', error);
        showFeedback('Failed to save settings', 'error');
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

    const aiBundle = buildFilteredAiContextBundle({
        charBudget: AI_CONTEXT_CHAR_BUDGET,
        emitTruncationLog: false
    });
    const hasTranscriptContext = aiBundle.transcriptContext.length > 0;
    const hasEnabledScreenshots = aiBundle.enabledScreenshotIds.length > 0;

    if (analyzeBtn) {
        const hasContent = hasTranscriptContext || hasEnabledScreenshots || aiBundle.contextString.length > 0;
        analyzeBtn.disabled = isAnalyzing || !hasContent;
    }

    if (screenAiBtn) {
        screenAiBtn.disabled = isAnalyzing || !hasEnabledScreenshots;
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

function showLoadingOverlay(message = 'Analyzing screen...') {
    if (loadingOverlay) {
        // Update the loading text if custom message provided
        const loadingTextElement = loadingOverlay.querySelector('.loading-text');
        if (loadingTextElement) {
            loadingTextElement.innerHTML = message;
        }
        loadingOverlay.classList.remove('hidden');
    }
}

function hideLoadingOverlay() {
    if (loadingOverlay) {
        loadingOverlay.classList.add('hidden');
        // Reset to default text
        const loadingTextElement = loadingOverlay.querySelector('.loading-text');
        if (loadingTextElement) {
            loadingTextElement.innerHTML = 'Analyzing screen...';
        }
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

function addChatMessage(type, content, options = {}) {
    if (!chatMessagesElement) return;

    const timestampDate = new Date();
    const record = messageStore.add(type, content, {
        id: options.id,
        timestamp: timestampDate,
        canToggleAi: options.canToggleAi,
        includeInAi: options.includeInAi,
        screenshotId: options.screenshotId
    });

    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${type}-message`;
    messageDiv.dataset.messageId = record.id;
    if (record.canToggleAi) {
        messageDiv.classList.add('ai-toggleable');
        messageDiv.classList.add(record.includeInAi ? 'ai-included' : 'ai-excluded');
    }

    const timestamp = timestampDate.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
    });

    let icon = '\u2139\uFE0F';
    let label = '';
    let contentClass = 'message-content';
    let safeContent = escapeHtml(content);

    switch (type) {
        case 'voice':
        case 'voice-mic':
            icon = '\u{1F3A4}';
            label = 'You';
            break;

        case 'voice-system':
            icon = '\u{1F50A}';
            label = 'Host';
            break;

        case 'screenshot':
            icon = '\u{1F4F8}';
            break;

        case 'ai-response':
            icon = '\u{1F916}';
            contentClass = 'message-content ai-response';
            safeContent = formatResponse(content);
            break;

        case 'system':
            icon = '\u2139\uFE0F';
            contentClass = 'message-content system-message';
            break;
    }

    const labelHtml = label ? `<span class="message-label">${label}</span>` : '';
    const toggleHtml = record.canToggleAi
        ? `<button class="ai-include-toggle ${record.includeInAi ? 'included' : 'excluded'}" data-message-id="${record.id}" aria-pressed="${record.includeInAi ? 'true' : 'false'}">${record.includeInAi ? 'AI' : 'Off'}</button>`
        : '';
    const exclusionHtml = record.canToggleAi
        ? '<div class="ai-excluded-note">Excluded from AI context</div>'
        : '';

    const messageContent = `
        <div class="message-header">
            <span class="message-icon">${icon}</span>
            ${labelHtml}
            ${toggleHtml}
            <span class="message-time">${timestamp}</span>
        </div>
        <div class="${contentClass}">${exclusionHtml}${safeContent}</div>
    `;

    messageDiv.innerHTML = messageContent;
    chatMessagesElement.appendChild(messageDiv);

    chatMessagesElement.scrollTop = chatMessagesElement.scrollHeight;

    chatMessagesArray = messageStore.getMessages();

    // Update UI to enable/disable buttons based on content
    updateUI();

    return record;
}

function updateChatComposerHeight() {
    if (!chatContainer || !chatComposer) {
        return;
    }

    const composerHeight = Math.max(0, Math.round(chatComposer.getBoundingClientRect().height));
    if (composerHeight > 0) {
        chatContainer.style.setProperty('--chat-composer-height', `${composerHeight}px`);
    }
}

function autoResizeManualInput() {
    if (!chatManualInput) {
        return;
    }

    chatManualInput.style.height = 'auto';
    const nextHeight = Math.min(chatManualInput.scrollHeight, MAX_CHAT_INPUT_HEIGHT);
    chatManualInput.style.height = `${Math.max(24, nextHeight)}px`;
    chatManualInput.style.overflowY = chatManualInput.scrollHeight > MAX_CHAT_INPUT_HEIGHT ? 'auto' : 'hidden';
    updateChatComposerHeight();
}

function updateManualComposerState() {
    if (!chatManualInput || !chatManualSend) {
        return;
    }

    chatManualSend.disabled = String(chatManualInput.value || '').trim().length === 0;
}

function submitManualContextMessage() {
    if (!chatManualInput) {
        return;
    }

    const text = String(chatManualInput.value || '').trim();
    if (!text) {
        showFeedback('Type a message first', 'error');
        return;
    }

    addChatMessage('voice-mic', text);
    addMonitorLog('info', 'manual-context-added', 'Manual context message added', 'mic', {
        chars: text.length
    });
    showFeedback('Manual context added', 'success');

    chatManualInput.value = '';
    autoResizeManualInput();
    updateManualComposerState();
    chatManualInput.focus();
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
    if (analyzeBtn) analyzeBtn.addEventListener('click', askAiWithSessionContext);
    if (screenAiBtn) screenAiBtn.addEventListener('click', analyzeScreenshotsOnly);
    if (clearBtn) clearBtn.addEventListener('click', clearStealthData);
    if (hideBtn) hideBtn.addEventListener('click', emergencyHide);
    if (copyBtn) copyBtn.addEventListener('click', copyToClipboard);
    if (chatManualSend) chatManualSend.addEventListener('click', submitManualContextMessage);
    if (chatManualInput) {
        chatManualInput.addEventListener('input', () => {
            autoResizeManualInput();
            updateManualComposerState();
        });
        chatManualInput.addEventListener('keydown', (event) => {
            if (event.isComposing) {
                return;
            }

            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submitManualContextMessage();
            }
        });
        autoResizeManualInput();
        updateManualComposerState();
    }
    if (closeResultsBtn) closeResultsBtn.addEventListener('click', hideResults);
    if (transcriptionToggle) {
        transcriptionToggle.addEventListener('click', () => {
            toggleMasterTranscription().catch((error) => {
                console.error('Failed to toggle transcription:', error);
                addMonitorLog('error', 'master-toggle-failed', error.message);
            });
        });
    }
    if (sourceSystemToggle) {
        sourceSystemToggle.addEventListener('click', () => {
            setSourceSelected('system', !selectedSources.system);
        });
    }
    if (sourceMicToggle) {
        sourceMicToggle.addEventListener('click', () => {
            setSourceSelected('mic', !selectedSources.mic);
        });
    }
    if (closeAppBtn) closeAppBtn.addEventListener('click', openCloseConfirmation);
    if (cancelCloseBtn) cancelCloseBtn.addEventListener('click', closeCloseConfirmation);
    if (confirmCloseBtn) confirmCloseBtn.addEventListener('click', closeApplication);
    if (closeConfirmationDialog) {
        closeConfirmationDialog.addEventListener('click', (event) => {
            if (event.target === closeConfirmationDialog) {
                closeCloseConfirmation();
            }
        });
    }

    if (chatMessagesElement) {
        chatMessagesElement.addEventListener('click', (event) => {
            const button = event.target?.closest?.('.ai-include-toggle');
            if (!button) return;
            event.preventDefault();
            const messageId = button.dataset.messageId;
            if (!messageId) return;
            toggleChatMessageInclusion(messageId);
        });
    }

    // New feature buttons
    if (suggestBtn) suggestBtn.addEventListener('click', getResponseSuggestions);
    if (notesBtn) notesBtn.addEventListener('click', generateMeetingNotes);
    if (insightsBtn) insightsBtn.addEventListener('click', getConversationInsights);
    if (themeToggleBtn) themeToggleBtn.addEventListener('click', toggleThemeMode);

    // Settings buttons
    if (settingsBtn) settingsBtn.addEventListener('click', openSettings);
    if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeSettings);
    if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', saveSettings);
    if (settingWindowOpacity) {
        settingWindowOpacity.addEventListener('input', (event) => {
            updateWindowOpacityValueLabel(event.target.value);
        });
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (isCloseConfirmationOpen) {
            if (e.key === 'Escape') {
                e.preventDefault();
                closeCloseConfirmation();
                return;
            }

            if (e.key === 'Enter') {
                e.preventDefault();
                closeApplication();
                return;
            }
        }

        if (isShortcutPressed(e, 'toggleStealth')) {
            e.preventDefault();
            if (window.electronAPI) window.electronAPI.toggleStealth();
            return;
        }

        if (isShortcutPressed(e, 'takeScreenshot')) {
            e.preventDefault();
            takeStealthScreenshot();
            return;
        }

        if (isShortcutPressed(e, 'askAi')) {
            e.preventDefault();
            addMonitorLog('info', 'shortcut-local', 'Local Ask AI shortcut captured; awaiting global Ask AI event');
            return;
        }

        if (isShortcutPressed(e, 'emergencyHide')) {
            e.preventDefault();
            emergencyHide();
            return;
        }

        if (isShortcutPressed(e, 'toggleTranscription')) {
            e.preventDefault();
            addMonitorLog('info', 'shortcut-local', 'Local transcription shortcut captured; awaiting global shortcut event');
            return;
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
        const payload = typeof count === 'object' && count !== null ? count : { count };
        screenshotsCount = Number(payload.count || 0);
        updateUI();
        addChatMessage('screenshot', 'Screenshot captured', {
            screenshotId: typeof payload.screenshotId === 'string' ? payload.screenshotId : null
        });
        showFeedback('Screenshot captured', 'success');
    });

    window.electronAPI.onAnalysisStart(() => {
        setAnalyzing(true);
        showLoadingOverlay();
        addChatMessage('system', 'Analyzing screenshots...');
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

    // AssemblyAI streaming transcription event listeners
    window.electronAPI.onVoskStatus((data) => {
        const source = normalizeSource(data?.source);
        const status = data?.status;
        const message = data?.message || '';
        console.log(`STT status [${source}]:`, status, message);

        if (status === 'loading') {
            setSourceStatus(source, 'connecting', `Connecting (${sourceLabel(source)})...`);
            showFeedback(`Connecting (${sourceLabel(source)})...`, 'info');
            addMonitorLog('info', 'status-loading', message || 'Connection requested', source);
        } else if (status === 'listening') {
            setSourceStatus(source, 'listening', `Listening (${sourceLabel(source)})...`);
            showFeedback(`Listening (${sourceLabel(source)})...`, 'success');
            addMonitorLog('info', 'status-listening', message || 'Source listening', source);
        } else if (status === 'stopped') {
            setSourceStatus(source, 'off', `${sourceLabel(source)} stopped`);
            showFeedback(`Stopped (${sourceLabel(source)})`, 'info');
            addMonitorLog('info', 'status-stopped', message || 'Source stopped', source);
        }
    });

    window.electronAPI.onVoskPartial((data) => {
        handleVoskPartial(data);
    });

    window.electronAPI.onVoskFinal((data) => {
        handleVoskFinal(data);
    });

    window.electronAPI.onVoskError((data) => {
        const source = normalizeSource(data?.source);
        const error = data?.error || 'Unknown transcription error';
        console.error(`STT error [${source}]:`, error);
        showFeedback(`Error (${sourceLabel(source)}): ${error}`, 'error');
        addChatMessage('system', `Transcription error (${sourceLabel(source)}): ${error}`);
        addMonitorLog('error', 'status-error', error, source);
        flushFinalTranscript(source, 'status-error');

        if (source === 'system') {
            stopAudioResources(systemAudioContext, systemMediaStream, systemScriptProcessor);
            systemAudioContext = null; systemMediaStream = null; systemScriptProcessor = null;
            if (systemPartialDiv) { systemPartialDiv.remove(); systemPartialDiv = null; }
            systemPartialText = '';
            setSystemActive(false);
            resetSourceSampleQueue('system');
            resetFinalTranscriptBuffer('system');
        } else {
            stopAudioResources(micAudioContext, micMediaStream, micScriptProcessor);
            micAudioContext = null; micMediaStream = null; micScriptProcessor = null;
            if (micPartialDiv) { micPartialDiv.remove(); micPartialDiv = null; }
            micPartialText = '';
            setMicActive(false);
            resetSourceSampleQueue('mic');
            resetFinalTranscriptBuffer('mic');
        }

        setSourceStatus(source, 'error', `Error: ${error}`);
        updateTranscriptionUI();
    });

    window.electronAPI.onVoskStopped((data) => {
        const source = normalizeSource(data?.source);
        console.log(`STT stopped [${source}]`);
        flushFinalTranscript(source, 'stopped-event');
        if (source === 'system') {
            stopAudioResources(systemAudioContext, systemMediaStream, systemScriptProcessor);
            systemAudioContext = null; systemMediaStream = null; systemScriptProcessor = null;
            if (systemPartialDiv) { systemPartialDiv.remove(); systemPartialDiv = null; }
            systemPartialText = '';
            setSystemActive(false);
            resetSourceSampleQueue('system');
            resetFinalTranscriptBuffer('system');
        } else {
            stopAudioResources(micAudioContext, micMediaStream, micScriptProcessor);
            micAudioContext = null; micMediaStream = null; micScriptProcessor = null;
            if (micPartialDiv) { micPartialDiv.remove(); micPartialDiv = null; }
            micPartialText = '';
            setMicActive(false);
            resetSourceSampleQueue('mic');
            resetFinalTranscriptBuffer('mic');
        }
        setSourceStatus(source, 'off', `${sourceLabel(source)} stopped`);
        addMonitorLog('info', 'stopped-event', 'Stop acknowledged by backend', source);
    });

    if (window.electronAPI.onToggleVoiceRecognition) {
        window.electronAPI.onToggleVoiceRecognition(() => {
            addMonitorLog('info', 'shortcut-event', 'Global shortcut toggled transcription');
            toggleMasterTranscription().catch((error) => {
                console.error('Global shortcut toggle failed:', error);
                addMonitorLog('error', 'shortcut-toggle-failed', error.message);
            });
        });
    }

    if (window.electronAPI.onTriggerAskAi) {
        window.electronAPI.onTriggerAskAi(() => {
            addMonitorLog('info', 'shortcut-event', 'Global Ask AI shortcut triggered');
            askAiWithSessionContext().catch((error) => {
                console.error('Global Ask AI trigger failed:', error);
                addMonitorLog('error', 'shortcut-ask-ai-failed', error.message);
            });
        });
    }

    if (window.electronAPI.onSttDebug) {
        window.electronAPI.onSttDebug((data) => {
            const source = data?.source ? normalizeSource(data.source) : null;
            addMonitorLog(
                data?.level || 'info',
                data?.event || 'stt-debug',
                data?.message || '',
                source,
                data?.meta || null,
                data?.ts || Date.now()
            );
        });
    }

    window.addEventListener('error', (event) => {
        addMonitorLog('error', 'renderer-error', event?.message || 'Renderer error');
    });

    window.addEventListener('unhandledrejection', (event) => {
        const reason = event?.reason;
        const message = typeof reason === 'string'
            ? reason
            : reason?.message || 'Unhandled promise rejection';
        addMonitorLog('error', 'renderer-rejection', message);
    });
}

// Initialize on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}





