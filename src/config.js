// Gemini model configuration.
// The first model in this list is treated as the default model everywhere.
const GEMINI_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite-preview',
  'gemini-3.1-pro-preview'
];

// AssemblyAI speech model configuration.
// The first model in this list is treated as the default model everywhere.
const ASSEMBLY_AI_SPEECH_MODELS = [
  'universal-streaming-english',
  'universal-streaming-multilingual'
];

// Programming language configuration.
// The first language in this list is treated as the default language everywhere.
const PROGRAMMING_LANGUAGES = [
  'Python',
  'Java',
  'JavaScript',
  'TypeScript',
  'C++',
  'Go',
  'Rust',
  'C#',
  'Kotlin'
];

// Keyboard shortcuts configuration.
// Edit accelerators here to customize app shortcuts in one place.
const KEYBOARD_SHORTCUTS = [
  {
    id: 'toggleTranscription',
    buttonLabel: 'Transcription',
    description: 'Toggle transcription master control',
    accelerator: 'Alt+Shift+T'
  },
  {
    id: 'takeScreenshot',
    buttonLabel: 'Screenshot',
    description: 'Capture screenshot',
    accelerator: 'Alt+Shift+S'
  },
  {
    id: 'askAi',
    buttonLabel: 'Ask AI',
    description: 'Uses only enabled transcript, enabled screenshots, and enabled chat context',
    accelerator: 'Alt+Shift+A'
  },
  {
    id: 'screenAi',
    buttonLabel: 'Screen AI',
    description: 'Analyzes only enabled screenshots selected in chat',
    accelerator: 'Alt+Shift+E'
  },
  {
    id: 'suggest',
    buttonLabel: 'Suggest',
    description: 'Uses only enabled transcript context to suggest what to say next',
    accelerator: 'Alt+Shift+G'
  },
  {
    id: 'notes',
    buttonLabel: 'Notes',
    description: 'Generates notes from only enabled context',
    accelerator: 'Alt+Shift+N'
  },
  {
    id: 'insights',
    buttonLabel: 'Insights',
    description: 'Finds key insights from only enabled context',
    accelerator: 'Alt+Shift+I'
  },
  {
    id: 'clearChat',
    buttonLabel: 'Clear Chat',
    description: 'Clears chat, screenshots, and AI history',
    accelerator: 'Alt+Shift+C'
  },
  {
    id: 'emergencyHide',
    buttonLabel: 'Hide',
    description: 'Emergency hide',
    accelerator: 'Alt+Shift+X'
  },
  {
    id: 'toggleStealth',
    buttonLabel: 'Toggle Opacity',
    description: 'Toggle stealth opacity mode',
    accelerator: 'Alt+Shift+H'
  },
  {
    id: 'moveWindowLeft',
    buttonLabel: 'Move Window Left',
    description: 'Move window to left side',
    accelerator: 'Alt+Shift+Left'
  },
  {
    id: 'moveWindowRight',
    buttonLabel: 'Move Window Right',
    description: 'Move window to right side',
    accelerator: 'Alt+Shift+Right'
  },
  {
    id: 'moveWindowUp',
    buttonLabel: 'Move Window Up',
    description: 'Move window to top',
    accelerator: 'Alt+Shift+Up'
  },
  {
    id: 'moveWindowDown',
    buttonLabel: 'Move Window Down',
    description: 'Move window to bottom',
    accelerator: 'Alt+Shift+Down'
  },
  {
    id: 'windowSizePreset1',
    buttonLabel: 'Size Preset 1',
    description: 'Resize window to minimum size',
    accelerator: 'Alt+Shift+1'
  },
  {
    id: 'windowSizePreset2',
    buttonLabel: 'Size Preset 2',
    description: 'Resize window to +25% from minimum size',
    accelerator: 'Alt+Shift+2'
  },
  {
    id: 'windowSizePreset3',
    buttonLabel: 'Size Preset 3',
    description: 'Resize window to +50% from minimum size',
    accelerator: 'Alt+Shift+3'
  },
  {
    id: 'windowSizePreset4',
    buttonLabel: 'Size Preset 4',
    description: 'Resize window to +75% from minimum size',
    accelerator: 'Alt+Shift+4'
  }
];

// Gemini model configuration functions
function getGeminiModels() {
  if (!Array.isArray(GEMINI_MODELS) || GEMINI_MODELS.length === 0) {
    throw new Error('Gemini models are not configured. Add at least one model to src/config.js.');
  }

  return [...GEMINI_MODELS];
}

function getDefaultGeminiModel() {
  return getGeminiModels()[0];
}

function isConfiguredGeminiModel(modelName) {
  return getGeminiModels().includes(modelName);
}

function resolveGeminiModel(modelName) {
  return isConfiguredGeminiModel(modelName) ? modelName : getDefaultGeminiModel();
}

// Programming language configuration functions
function getProgrammingLanguages() {
  if (!Array.isArray(PROGRAMMING_LANGUAGES) || PROGRAMMING_LANGUAGES.length === 0) {
    throw new Error('Programming languages are not configured. Add at least one language to src/config.js.');
  }

  return [...PROGRAMMING_LANGUAGES];
}

function getDefaultProgrammingLanguage() {
  return getProgrammingLanguages()[0];
}

function isConfiguredProgrammingLanguage(languageName) {
  return getProgrammingLanguages().includes(languageName);
}

function resolveProgrammingLanguage(languageName) {
  return isConfiguredProgrammingLanguage(languageName)
    ? languageName
    : getDefaultProgrammingLanguage();
}

// AssemblyAI speech model configuration functions
function getAssemblyAiSpeechModels() {
  if (!Array.isArray(ASSEMBLY_AI_SPEECH_MODELS) || ASSEMBLY_AI_SPEECH_MODELS.length === 0) {
    throw new Error('AssemblyAI speech models are not configured. Add at least one model to src/config.js.');
  }

  return [...ASSEMBLY_AI_SPEECH_MODELS];
}

function getDefaultAssemblyAiSpeechModel() {
  return getAssemblyAiSpeechModels()[0];
}

function isConfiguredAssemblyAiSpeechModel(modelName) {
  return getAssemblyAiSpeechModels().includes(modelName);
}

function resolveAssemblyAiSpeechModel(modelName, fallbackModel = getDefaultAssemblyAiSpeechModel()) {
  if (isConfiguredAssemblyAiSpeechModel(modelName)) {
    return modelName;
  }

  if (isConfiguredAssemblyAiSpeechModel(fallbackModel)) {
    return fallbackModel;
  }

  return getDefaultAssemblyAiSpeechModel();
}

function getKeyboardShortcuts() {
  if (!Array.isArray(KEYBOARD_SHORTCUTS) || KEYBOARD_SHORTCUTS.length === 0) {
    throw new Error('Keyboard shortcuts are not configured. Add at least one shortcut to src/config.js.');
  }

  return KEYBOARD_SHORTCUTS.map((shortcut) => ({ ...shortcut }));
}

function getKeyboardShortcutById(shortcutId) {
  const normalizedId = String(shortcutId || '').trim();
  if (!normalizedId) {
    throw new Error('Shortcut id is required.');
  }

  const shortcut = getKeyboardShortcuts().find((entry) => entry.id === normalizedId);
  if (!shortcut) {
    throw new Error(`Shortcut "${normalizedId}" is not configured in src/config.js.`);
  }

  return shortcut;
}

function getKeyboardShortcutAccelerator(shortcutId) {
  const shortcut = getKeyboardShortcutById(shortcutId);
  const accelerator = String(shortcut.accelerator || '').trim();
  if (!accelerator) {
    throw new Error(`Shortcut "${shortcutId}" is missing an accelerator in src/config.js.`);
  }

  return accelerator;
}

module.exports = {
  getAssemblyAiSpeechModels,
  getDefaultAssemblyAiSpeechModel,
  getGeminiModels,
  getDefaultGeminiModel,
  getKeyboardShortcutAccelerator,
  getKeyboardShortcutById,
  getKeyboardShortcuts,
  getDefaultProgrammingLanguage,
  getProgrammingLanguages,
  isConfiguredAssemblyAiSpeechModel,
  isConfiguredGeminiModel,
  isConfiguredProgrammingLanguage,
  resolveAssemblyAiSpeechModel,
  resolveGeminiModel,
  resolveProgrammingLanguage
};
