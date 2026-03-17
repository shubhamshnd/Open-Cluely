function logStartupConfiguration({
  appEnvironment,
  geminiModels,
  defaultGeminiModel,
  assemblyAiSpeechModels,
  defaultAssemblyAiSpeechModel,
  programmingLanguages,
  defaultProgrammingLanguage
}) {
  console.log('Loaded .env from:', appEnvironment.envPath);
  console.log('Startup configuration:');
  console.log(`  GEMINI_API_KEY: ${appEnvironment.geminiApiKey ? 'present' : 'missing'}`);
  console.log(`  ASSEMBLY_AI_API_KEY: ${appEnvironment.assemblyAiApiKey ? 'present' : 'missing'}`);
  console.log(`  HIDE_FROM_SCREEN_CAPTURE: ${appEnvironment.hideFromScreenCapture}`);
  console.log(`  MAX_SCREENSHOTS: ${appEnvironment.maxScreenshots}`);
  console.log(`  SCREENSHOT_DELAY: ${appEnvironment.screenshotDelay}`);
  console.log(`  NODE_ENV: ${appEnvironment.nodeEnv}`);
  console.log(`  NODE_OPTIONS: ${appEnvironment.nodeOptions}`);
  console.log(`  Default Gemini model: ${defaultGeminiModel}`);
  console.log(`  Gemini models: ${geminiModels.join(', ')}`);
  console.log(`  Default AssemblyAI speech model: ${defaultAssemblyAiSpeechModel}`);
  console.log(`  AssemblyAI speech models: ${assemblyAiSpeechModels.join(', ')}`);
  console.log(`  Default programming language: ${defaultProgrammingLanguage}`);
  console.log(`  Programming languages: ${programmingLanguages.join(', ')}`);
}

module.exports = {
  logStartupConfiguration
};
