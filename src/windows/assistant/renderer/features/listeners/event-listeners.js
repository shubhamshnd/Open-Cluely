export function setupEventListeners({
    windowApi,
    screenshotBtn,
    analyzeBtn,
    screenAiBtn,
    clearBtn,
    hideBtn,
    chatManualSend,
    chatManualInput,
    closeResultsBtn,
    transcriptionToggle,
    sourceSystemToggle,
    sourceMicToggle,
    closeAppBtn,
    cancelCloseBtn,
    confirmCloseBtn,
    closeConfirmationDialog,
    chatMessagesElement,
    suggestBtn,
    notesBtn,
    insightsBtn,
    themeToggleBtn,
    settingsBtn,
    closeSettingsBtn,
    saveSettingsBtn,
    settingWindowOpacity,
    selectedSources,
    isCloseConfirmationOpen,
    isShortcutPressed,
    updateWindowOpacityValueLabel,
    takeStealthScreenshot,
    askAiWithSessionContext,
    analyzeScreenshotsOnly,
    clearStealthData,
    emergencyHide,
    copyChatMessageById,
    submitManualContextMessage,
    autoResizeManualInput,
    updateManualComposerState,
    hideResults,
    toggleMasterTranscription,
    addMonitorLog,
    setSourceSelected,
    openCloseConfirmation,
    closeCloseConfirmation,
    closeApplication,
    toggleChatMessageInclusion,
    getResponseSuggestions,
    generateMeetingNotes,
    getConversationInsights,
    toggleThemeMode,
    openSettings,
    closeSettings,
    saveSettings
}) {
    if (screenshotBtn) screenshotBtn.addEventListener('click', takeStealthScreenshot);
    if (analyzeBtn) analyzeBtn.addEventListener('click', askAiWithSessionContext);
    if (screenAiBtn) screenAiBtn.addEventListener('click', analyzeScreenshotsOnly);
    if (clearBtn) clearBtn.addEventListener('click', clearStealthData);
    if (hideBtn) hideBtn.addEventListener('click', emergencyHide);
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
            const copyButton = event.target?.closest?.('.message-copy-btn');
            if (copyButton) {
                event.preventDefault();
                const messageId = copyButton.dataset.messageId;
                if (!messageId) return;
                copyChatMessageById(messageId);
                return;
            }

            const toggleButton = event.target?.closest?.('.ai-include-toggle');
            if (!toggleButton) return;
            event.preventDefault();
            const messageId = toggleButton.dataset.messageId;
            if (!messageId) return;
            toggleChatMessageInclusion(messageId);
        });
    }

    if (suggestBtn) suggestBtn.addEventListener('click', getResponseSuggestions);
    if (notesBtn) notesBtn.addEventListener('click', generateMeetingNotes);
    if (insightsBtn) insightsBtn.addEventListener('click', getConversationInsights);
    if (themeToggleBtn) themeToggleBtn.addEventListener('click', toggleThemeMode);

    if (settingsBtn) settingsBtn.addEventListener('click', openSettings);
    if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeSettings);
    if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', saveSettings);

    if (settingWindowOpacity) {
        settingWindowOpacity.addEventListener('input', (event) => {
            const value = event?.target?.value;
            if (typeof value !== 'undefined') {
                updateWindowOpacityValueLabel(value);
            }
        });
    }

    document.addEventListener('keydown', (event) => {
        if (isCloseConfirmationOpen?.()) {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeCloseConfirmation();
                return;
            }

            if (event.key === 'Enter') {
                event.preventDefault();
                closeApplication();
                return;
            }
        }

        if (isShortcutPressed?.(event, 'toggleStealth')) {
            event.preventDefault();
            windowApi?.toggleStealth?.();
            return;
        }

        if (isShortcutPressed?.(event, 'takeScreenshot')) {
            event.preventDefault();
            takeStealthScreenshot();
            return;
        }

        if (isShortcutPressed?.(event, 'askAi')) {
            event.preventDefault();
            addMonitorLog('info', 'shortcut-local', 'Local Ask AI shortcut captured; awaiting global Ask AI event');
            return;
        }

        if (isShortcutPressed?.(event, 'screenAi')) {
            event.preventDefault();
            if (screenAiBtn?.disabled) {
                return;
            }
            analyzeScreenshotsOnly().catch((error) => {
                console.error('Local Screen AI shortcut failed:', error);
                addMonitorLog('error', 'shortcut-screen-ai-failed', error.message);
            });
            return;
        }

        if (isShortcutPressed?.(event, 'suggest')) {
            event.preventDefault();
            if (suggestBtn?.disabled) {
                return;
            }
            getResponseSuggestions().catch((error) => {
                console.error('Local Suggest shortcut failed:', error);
                addMonitorLog('error', 'shortcut-suggest-failed', error.message);
            });
            return;
        }

        if (isShortcutPressed?.(event, 'notes')) {
            event.preventDefault();
            if (notesBtn?.disabled) {
                return;
            }
            generateMeetingNotes().catch((error) => {
                console.error('Local Notes shortcut failed:', error);
                addMonitorLog('error', 'shortcut-notes-failed', error.message);
            });
            return;
        }

        if (isShortcutPressed?.(event, 'insights')) {
            event.preventDefault();
            if (insightsBtn?.disabled) {
                return;
            }
            getConversationInsights().catch((error) => {
                console.error('Local Insights shortcut failed:', error);
                addMonitorLog('error', 'shortcut-insights-failed', error.message);
            });
            return;
        }

        if (isShortcutPressed?.(event, 'clearChat')) {
            event.preventDefault();
            clearStealthData().catch((error) => {
                console.error('Local Clear Chat shortcut failed:', error);
                addMonitorLog('error', 'shortcut-clear-chat-failed', error.message);
            });
            return;
        }

        if (isShortcutPressed?.(event, 'emergencyHide')) {
            event.preventDefault();
            emergencyHide();
            return;
        }

        if (isShortcutPressed?.(event, 'toggleTranscription')) {
            event.preventDefault();
            addMonitorLog('info', 'shortcut-local', 'Local transcription shortcut captured; awaiting global shortcut event');
        }
    });

    document.addEventListener('contextmenu', (event) => event.preventDefault());
    document.addEventListener('selectstart', (event) => event.preventDefault());
    document.addEventListener('dragstart', (event) => event.preventDefault());
}
