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

module.exports = {
  getAssemblyAiSpeechModels,
  getDefaultAssemblyAiSpeechModel,
  getGeminiModels,
  getDefaultGeminiModel,
  isConfiguredAssemblyAiSpeechModel,
  isConfiguredGeminiModel,
  resolveAssemblyAiSpeechModel,
  resolveGeminiModel
};
