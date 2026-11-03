// AI provider configuration.
// Supported providers: 'gemini' and 'ollama'.
const AI_PROVIDERS = ['gemini', 'ollama'];
const DEFAULT_AI_PROVIDER = 'gemini';

const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
const DEFAULT_OLLAMA_MODEL = 'llama3.2';

// Gemini model configuration.
// The first model in this list is treated as the default model everywhere.
const GEMINI_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite-preview',
  'gemini-3.1-pro-preview'
];

// OpenAI model configuration.
// The first model in this list is treated as the default model everywhere.
// supportsImages marks models that accept image_url content blocks.
const OPENAI_MODELS = [
  { id: 'gpt-4.1-mini', supportsImages: true },
  { id: 'gpt-4.1', supportsImages: true },
  { id: 'gpt-4o-mini', supportsImages: true }
];

// Anthropic model configuration (curated — the Anthropic API has no public
// list-models call, so the settings panel uses this list as-is).
// The first model in this list is treated as the default model everywhere.
const ANTHROPIC_MODELS = [
  { id: 'claude-sonnet-4-5', supportsImages: true },
  { id: 'claude-haiku-4-5', supportsImages: true }
];

// Amazon Bedrock configuration (Converse API — one client covers Claude,
// Llama, Nova, and other Bedrock models).
// The AWS account must have model access enabled in the Bedrock console or
// calls fail with AccessDeniedException. Cross-region inference profile ids
// (the `us.` prefix) work as model ids too.
const DEFAULT_BEDROCK_REGION = 'us-east-1';
const BEDROCK_MODELS = [
  { id: 'us.anthropic.claude-sonnet-5-5', supportsImages: true },
  { id: 'amazon.nova-lite-v1:0', supportsImages: true },
  { id: 'us.moonshotai.kimi-k3', supportsImages: false }
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
    buttonLabel: 'Toggle Stealth',
    description: 'Toggle stealth mode',
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

// AI provider configuration functions
function getAiProviders() {
  return [...AI_PROVIDERS];
}

function getDefaultAiProvider() {
  return DEFAULT_AI_PROVIDER;
}

function isConfiguredAiProvider(providerName) {
  return AI_PROVIDERS.includes(providerName);
}

function resolveAiProvider(providerName) {
  return isConfiguredAiProvider(providerName) ? providerName : DEFAULT_AI_PROVIDER;
}

function getDefaultOllamaBaseUrl() {
  return DEFAULT_OLLAMA_BASE_URL;
}

function getDefaultOllamaModel() {
  return DEFAULT_OLLAMA_MODEL;
}

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

// OpenAI model configuration functions
function getOpenAIModels() {
  if (!Array.isArray(OPENAI_MODELS) || OPENAI_MODELS.length === 0) {
    throw new Error('OpenAI models are not configured. Add at least one model to src/config.js.');
  }

  return OPENAI_MODELS.map((entry) => ({ ...entry }));
}

function getDefaultOpenAIModel() {
  return getOpenAIModels()[0].id;
}

function isConfiguredOpenAIModel(modelName) {
  return getOpenAIModels().some((entry) => entry.id === modelName);
}

// The settings panel can list models fetched from the OpenAI API that are not
// in the curated list; those still resolve as valid selections.
function resolveOpenAIModel(modelName) {
  const normalized = String(modelName || '').trim();
  return normalized || getDefaultOpenAIModel();
}

// Vision support for curated models comes from the flag; fetched models fall
// back to a conservative id heuristic. Unknown ids are treated as text-only.
function openAIModelSupportsImages(modelName) {
  const configured = getOpenAIModels().find((entry) => entry.id === modelName);
  if (configured) {
    return configured.supportsImages === true;
  }

  return /^(chatgpt-4o|gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-4-vision|gpt-5|o1|o3|o4)/i.test(
    String(modelName || '')
  );
}

// Anthropic model configuration functions
function getAnthropicModels() {
  if (!Array.isArray(ANTHROPIC_MODELS) || ANTHROPIC_MODELS.length === 0) {
    throw new Error('Anthropic models are not configured. Add at least one model to src/config.js.');
  }

  return ANTHROPIC_MODELS.map((entry) => ({ ...entry }));
}

function getDefaultAnthropicModel() {
  return getAnthropicModels()[0].id;
}

function isConfiguredAnthropicModel(modelName) {
  return getAnthropicModels().some((entry) => entry.id === modelName);
}

function resolveAnthropicModel(modelName) {
  const normalized = String(modelName || '').trim();
  return isConfiguredAnthropicModel(normalized) ? normalized : getDefaultAnthropicModel();
}

// Every Claude 3+ model accepts image input; curated flags win when present.
function anthropicModelSupportsImages(modelName) {
  const configured = getAnthropicModels().find((entry) => entry.id === modelName);
  if (configured) {
    return configured.supportsImages === true;
  }

  return /^claude-(3|4|5|sonnet|haiku|opus)/i.test(String(modelName || ''));
}

// Bedrock configuration functions
function getBedrockModels() {
  if (!Array.isArray(BEDROCK_MODELS) || BEDROCK_MODELS.length === 0) {
    throw new Error('Bedrock models are not configured. Add at least one model to src/config.js.');
  }

  return BEDROCK_MODELS.map((entry) => ({ ...entry }));
}

function getDefaultBedrockModel() {
  return getBedrockModels()[0].id;
}

function getDefaultBedrockRegion() {
  return DEFAULT_BEDROCK_REGION;
}

function isConfiguredBedrockModel(modelId) {
  return getBedrockModels().some((entry) => entry.id === modelId);
}

// Bedrock model ids are account- and region-specific (including inference
// profile ids), so any non-empty id the user entered or fetched resolves.
function resolveBedrockModel(modelId) {
  const normalized = String(modelId || '').trim();
  return normalized || getDefaultBedrockModel();
}

function resolveBedrockRegion(region) {
  const normalized = String(region || '').trim();
  return normalized || DEFAULT_BEDROCK_REGION;
}

// Vision support: curated flags win; otherwise a conservative id heuristic.
// Unknown ids are treated as text-only so Screen AI falls back to OCR text.
function bedrockModelSupportsImages(modelId) {
  const configured = getBedrockModels().find((entry) => entry.id === modelId);
  if (configured) {
    return configured.supportsImages === true;
  }

  const normalized = String(modelId || '').toLowerCase();
  return (
    normalized.includes('claude') ||
    normalized.includes('nova') ||
    normalized.includes('vision') ||
    normalized.includes('pixtral')
  );
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
  getAiProviders,
  getDefaultAiProvider,
  getDefaultOllamaBaseUrl,
  getDefaultOllamaModel,
  isConfiguredAiProvider,
  resolveAiProvider,
  getAssemblyAiSpeechModels,
  getDefaultAssemblyAiSpeechModel,
  getGeminiModels,
  getDefaultGeminiModel,
  getKeyboardShortcutAccelerator,
  getKeyboardShortcutById,
  getKeyboardShortcuts,
  getDefaultProgrammingLanguage,
  getProgrammingLanguages,
  anthropicModelSupportsImages,
  bedrockModelSupportsImages,
  getAnthropicModels,
  getBedrockModels,
  getDefaultAnthropicModel,
  getDefaultBedrockModel,
  getDefaultBedrockRegion,
  isConfiguredBedrockModel,
  resolveBedrockModel,
  resolveBedrockRegion,
  resolveAnthropicModel,
  isConfiguredAnthropicModel,
  isConfiguredAssemblyAiSpeechModel,
  isConfiguredGeminiModel,
  isConfiguredOpenAIModel,
  isConfiguredProgrammingLanguage,
  openAIModelSupportsImages,
  getOpenAIModels,
  getDefaultOpenAIModel,
  resolveOpenAIModel,
  resolveAssemblyAiSpeechModel,
  resolveGeminiModel,
  resolveProgrammingLanguage
};
