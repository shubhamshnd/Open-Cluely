function registerAssistantIpc({
  ipcMain,
  screenshotManager,
  windowController,
  geminiRuntime,
  getAppEnvironment,
  assemblyAiService,
  sendToRenderer,
  quitApplication
}) {
  let chatContext = [];

  async function analyzeForMeetingWithContext(contextInput = '') {
    const payload = typeof contextInput === 'object' && contextInput !== null
      ? contextInput
      : { contextString: String(contextInput || '') };

    const contextString = typeof payload.contextString === 'string' ? payload.contextString : '';
    const enabledScreenshotIds = Array.isArray(payload.enabledScreenshotIds) ? payload.enabledScreenshotIds : null;
    const appEnvironment = getAppEnvironment();
    const geminiService = geminiRuntime.getService();

    console.log('Starting context-aware analysis...');
    console.log('Context length:', contextString.length);
    console.log('API Key exists:', !!appEnvironment.geminiApiKey);
    console.log('Model initialized:', !!(geminiService && geminiService.model));
    console.log('Programming language preference:', geminiRuntime.getActiveProgrammingLanguage());
    console.log('Screenshots count:', screenshotManager.getScreenshotsCount());

    if (!appEnvironment.geminiApiKey) {
      sendToRenderer('analysis-result', {
        error: 'No API key configured. Please add GEMINI_API_KEY to your .env file.'
      });
      return;
    }

    if (!geminiService || !geminiService.model) {
      sendToRenderer('analysis-result', {
        error: 'AI model not initialized. Please check your API key.'
      });
      return;
    }

    if (!screenshotManager.hasScreenshots()) {
      sendToRenderer('analysis-result', {
        error: 'No screenshots to analyze. Take a screenshot first.'
      });
      return;
    }

    try {
      sendToRenderer('analysis-start');

      const { imageParts } = await screenshotManager.buildImagePartsFromScreenshots({
        strict: true,
        includeIds: enabledScreenshotIds
      });

      if (imageParts.length === 0) {
        sendToRenderer('analysis-result', {
          error: 'No enabled screenshots selected for analysis.'
        });
        return;
      }

      const text = await geminiService.analyzeScreenshots(
        imageParts,
        '',
        { contextStringOverride: contextString }
      );

      chatContext.push({
        type: 'analysis',
        content: text,
        timestamp: new Date().toISOString(),
        screenshotCount: imageParts.length
      });

      sendToRenderer('analysis-result', { text });
    } catch (error) {
      console.error('Analysis error details:', error);

      let errorMessage = 'Analysis failed';
      if (error.message.includes('API_KEY')) {
        errorMessage = 'Invalid API key. Please check your GEMINI_API_KEY.';
      } else if (error.message.includes('quota')) {
        errorMessage = 'API quota exceeded. Please try again later.';
      } else if (error.message.includes('network') || error.message.includes('fetch')) {
        errorMessage = 'Network error. Please check your internet connection.';
      } else if (error.message.includes('model')) {
        errorMessage = 'AI model error. Please try a different model.';
      } else {
        errorMessage = `Analysis failed: ${error.message}`;
      }

      sendToRenderer('analysis-result', {
        error: errorMessage
      });
    }
  }

  async function analyzeForMeeting() {
    await analyzeForMeetingWithContext();
  }

  ipcMain.handle('get-screenshots-count', () => {
    return screenshotManager.getScreenshotsCount();
  });

  ipcMain.handle('get-window-bounds', () => {
    return windowController.getWindowBounds();
  });

  ipcMain.handle('set-window-bounds', (_event, nextBounds) => {
    return windowController.setWindowBounds(nextBounds);
  });

  ipcMain.handle('toggle-stealth', () => {
    return windowController.toggleStealthMode();
  });

  ipcMain.handle('emergency-hide', () => {
    return windowController.emergencyHide();
  });

  ipcMain.handle('take-stealth-screenshot', async () => {
    return screenshotManager.takeStealthScreenshot();
  });

  ipcMain.handle('analyze-stealth', async () => {
    return analyzeForMeeting();
  });

  ipcMain.handle('analyze-stealth-with-context', async (_event, context) => {
    return analyzeForMeetingWithContext(context);
  });

  ipcMain.handle('ask-ai-with-session-context', async (_event, payload = {}) => {
    const appEnvironment = getAppEnvironment();
    const geminiService = geminiRuntime.getService();
    const mode = payload?.mode === 'best-next-answer' ? 'best-next-answer' : 'best-next-answer';

    try {
      assemblyAiService.flushAllSttHistoryBuffers('pre-ask-ai');

      if (!appEnvironment.geminiApiKey) {
        throw new Error('No API key configured. Please add GEMINI_API_KEY to your .env file.');
      }

      if (!geminiService || !geminiService.model) {
        throw new Error('AI model not initialized. Please check your API key.');
      }

      const transcriptContext = typeof payload?.transcriptContext === 'string'
        ? payload.transcriptContext.trim()
        : '';
      const sessionSummary = typeof payload?.sessionSummary === 'string'
        ? payload.sessionSummary.trim()
        : '';
      const contextString = typeof payload?.contextString === 'string'
        ? payload.contextString.trim()
        : '';
      const enabledScreenshotIds = Array.isArray(payload?.enabledScreenshotIds)
        ? payload.enabledScreenshotIds.filter((id) => typeof id === 'string' && id.trim().length > 0)
        : null;

      if (!transcriptContext && !contextString && !screenshotManager.hasScreenshots()) {
        return {
          success: false,
          error: 'No transcript or screenshots available yet. Start transcription or capture a screenshot first.',
          mode,
          usedScreenshots: false
        };
      }

      let usedScreenshots = false;
      let usedScreenshotCount = 0;
      let text = '';

      if (screenshotManager.hasScreenshots()) {
        const { imageParts } = await screenshotManager.buildImagePartsFromScreenshots({
          strict: false,
          includeIds: enabledScreenshotIds
        });

        if (imageParts.length > 0) {
          usedScreenshots = true;
          usedScreenshotCount = imageParts.length;
          text = await geminiService.askAiWithSessionContextAndScreenshots(imageParts, {
            contextString,
            transcriptContext,
            sessionSummary,
            screenshotCount: imageParts.length,
            mode
          });
        }
      }

      if (!text) {
        text = await geminiService.askAiWithSessionContext({
          contextString,
          transcriptContext,
          sessionSummary,
          screenshotCount: usedScreenshots ? usedScreenshotCount : 0,
          mode
        });
      }

      chatContext.push({
        type: 'ask-ai',
        content: text,
        timestamp: new Date().toISOString(),
        screenshotCount: usedScreenshots ? usedScreenshotCount : 0
      });

      return { success: true, text, mode, usedScreenshots };
    } catch (error) {
      console.error('Error in ask-ai-with-session-context:', error);
      return {
        success: false,
        error: error.message || 'Ask AI failed',
        mode,
        usedScreenshots: false
      };
    }
  });

  ipcMain.handle('clear-stealth', () => {
    chatContext = [];
    return screenshotManager.clearStealth();
  });

  ipcMain.handle('close-app', () => {
    setTimeout(() => {
      quitApplication();
    }, 0);

    return { success: true };
  });

  ipcMain.handle('add-voice-transcript', async (_event, transcript) => {
    const geminiService = geminiRuntime.getService();
    if (geminiService) {
      geminiService.addToHistory('user', transcript);
    }

    return { success: true };
  });

  ipcMain.handle('suggest-response', async (_event, context) => {
    const geminiService = geminiRuntime.getService();

    try {
      assemblyAiService.flushAllSttHistoryBuffers('pre-suggest');
      if (!geminiService) {
        throw new Error('Gemini service not initialized');
      }

      const payload = typeof context === 'object' && context !== null
        ? context
        : { context };
      const contextPrompt = typeof payload.context === 'string'
        ? payload.context
        : 'Current meeting conversation';
      const contextStringOverride = typeof payload.contextString === 'string'
        ? payload.contextString
        : '';

      const suggestions = await geminiService.suggestResponse(contextPrompt, {
        contextString: contextStringOverride
      });

      return { success: true, suggestions };
    } catch (error) {
      console.error('Error generating suggestions:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('generate-meeting-notes', async (_event, payload = {}) => {
    const geminiService = geminiRuntime.getService();

    try {
      assemblyAiService.flushAllSttHistoryBuffers('pre-notes');
      if (!geminiService) {
        throw new Error('Gemini service not initialized');
      }

      const contextStringOverride = typeof payload?.contextString === 'string'
        ? payload.contextString
        : '';

      const notes = await geminiService.generateMeetingNotes({
        contextString: contextStringOverride
      });

      return { success: true, notes };
    } catch (error) {
      console.error('Error generating meeting notes:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('generate-follow-up-email', async () => {
    const geminiService = geminiRuntime.getService();

    try {
      assemblyAiService.flushAllSttHistoryBuffers('pre-followup');
      if (!geminiService) {
        throw new Error('Gemini service not initialized');
      }

      const email = await geminiService.generateFollowUpEmail();
      return { success: true, email };
    } catch (error) {
      console.error('Error generating email:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('answer-question', async (_event, question) => {
    const geminiService = geminiRuntime.getService();

    try {
      assemblyAiService.flushAllSttHistoryBuffers('pre-answer');
      if (!geminiService) {
        throw new Error('Gemini service not initialized');
      }

      const answer = await geminiService.answerQuestion(question);
      return { success: true, answer };
    } catch (error) {
      console.error('Error answering question:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-conversation-insights', async (_event, payload = {}) => {
    const geminiService = geminiRuntime.getService();

    try {
      assemblyAiService.flushAllSttHistoryBuffers('pre-insights');
      if (!geminiService) {
        throw new Error('Gemini service not initialized');
      }

      const contextStringOverride = typeof payload?.contextString === 'string'
        ? payload.contextString
        : '';

      const insights = await geminiService.getConversationInsights({
        contextString: contextStringOverride
      });

      return { success: true, insights };
    } catch (error) {
      console.error('Error getting insights:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('clear-conversation-history', async () => {
    const geminiService = geminiRuntime.getService();

    try {
      assemblyAiService.resetSttHistoryBuffers();
      if (geminiService) {
        geminiService.clearHistory();
      }

      chatContext = [];
      return { success: true };
    } catch (error) {
      console.error('Error clearing history:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-conversation-history', async () => {
    const geminiService = geminiRuntime.getService();

    try {
      if (!geminiService) {
        return { success: true, history: [] };
      }

      return { success: true, history: geminiService.conversationHistory };
    } catch (error) {
      console.error('Error getting history:', error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = {
  registerAssistantIpc
};
