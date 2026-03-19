function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

export function createSettingsPanelManager({
    settingsPanel,
    settingGeminiKey,
    settingGeminiModel,
    settingProgrammingLanguage,
    settingAssemblyKey,
    settingAssemblyModel,
    settingWindowOpacity,
    settingWindowOpacityValue,
    applySettingsShortcutConfig,
    showFeedback
}) {
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

    async function openSettings() {
        if (!settingsPanel) {
            return;
        }

        try {
            const settings = await window.electronAPI.getSettings();
            if (settings && !settings.error) {
                applySettingsShortcutConfig?.(settings);
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
        if (settingsPanel) {
            settingsPanel.classList.add('hidden');
        }
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
                showFeedback?.('Settings saved. AI changes are active now; voice model applies next session.', 'success');
                closeSettings();
            } else {
                showFeedback?.(`Failed to save: ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('Failed to save settings:', error);
            showFeedback?.('Failed to save settings', 'error');
        }
    }

    return {
        normalizeWindowOpacityLevel,
        updateWindowOpacityValueLabel,
        openSettings,
        closeSettings,
        saveSettings
    };
}
