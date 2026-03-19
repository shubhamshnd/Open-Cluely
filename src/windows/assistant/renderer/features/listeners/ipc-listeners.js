export function setupIpcListeners({
    windowApi,
    setScreenshotsCount,
    updateUi,
    addChatMessage,
    setAnalyzing,
    showLoadingOverlay,
    hideLoadingOverlay,
    showFeedback,
    showEmergencyOverlay,
    transcriptionManager,
    toggleMasterTranscription,
    askAiWithSessionContext,
    addMonitorLog
}) {
    if (!windowApi) {
        console.error('electronAPI not available');
        return;
    }

    windowApi.onScreenshotTakenStealth((count) => {
        const payload = typeof count === 'object' && count !== null ? count : { count };
        setScreenshotsCount(Number(payload.count || 0));
        updateUi();
        addChatMessage('screenshot', 'Screenshot captured', {
            screenshotId: typeof payload.screenshotId === 'string' ? payload.screenshotId : null
        });
        showFeedback('Screenshot captured', 'success');
    });

    windowApi.onAnalysisStart(() => {
        setAnalyzing(true);
        showLoadingOverlay();
        addChatMessage('system', 'Analyzing screenshots...');
    });

    windowApi.onAnalysisResult((data) => {
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

    windowApi.onSetStealthMode((enabled) => {
        showFeedback(enabled ? 'Stealth mode ON' : 'Stealth mode OFF', 'info');
    });

    windowApi.onEmergencyClear(() => {
        showEmergencyOverlay();
    });

    windowApi.onError((message) => {
        showFeedback(message, 'error');
    });

    windowApi.onVoskStatus((data) => {
        transcriptionManager.handleVoskStatus(data);
    });

    windowApi.onVoskPartial((data) => {
        transcriptionManager.handleVoskPartial(data);
    });

    windowApi.onVoskFinal((data) => {
        transcriptionManager.handleVoskFinal(data);
    });

    windowApi.onVoskError((data) => {
        transcriptionManager.handleVoskError(data);
    });

    windowApi.onVoskStopped((data) => {
        transcriptionManager.handleVoskStopped(data);
    });

    if (windowApi.onToggleVoiceRecognition) {
        windowApi.onToggleVoiceRecognition(() => {
            addMonitorLog('info', 'shortcut-event', 'Global shortcut toggled transcription');
            toggleMasterTranscription().catch((error) => {
                console.error('Global shortcut toggle failed:', error);
                addMonitorLog('error', 'shortcut-toggle-failed', error.message);
            });
        });
    }

    if (windowApi.onTriggerAskAi) {
        windowApi.onTriggerAskAi(() => {
            addMonitorLog('info', 'shortcut-event', 'Global Ask AI shortcut triggered');
            askAiWithSessionContext().catch((error) => {
                console.error('Global Ask AI trigger failed:', error);
                addMonitorLog('error', 'shortcut-ask-ai-failed', error.message);
            });
        });
    }

    if (windowApi.onSttDebug) {
        windowApi.onSttDebug((data) => {
            const source = data?.source ? transcriptionManager.normalizeSource(data.source) : null;
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
