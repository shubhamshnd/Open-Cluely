function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

const PROVIDER_GROUP_IDS = {
    gemini: 'gemini-settings-group',
    openai: 'openai-settings-group',
    anthropic: 'anthropic-settings-group',
    bedrock: 'bedrock-settings-group',
    ollama: 'ollama-settings-group'
};

function byId(id) {
    return document.getElementById(id);
}

// The shared AWS credentials block is visible when the AI provider is Bedrock
// OR the speech-to-text provider is Amazon Transcribe (Part 2 adds the STT
// select; until then the STT provider stays 'assemblyai' here).
let currentSttProvider = 'assemblyai';
let currentAwsAuthMode = 'default';

export function createSettingsPanelManager({
    settingsPanel,
    settingAiProvider,
    geminiSettingsGroup,
    ollamaSettingsGroup,
    settingGeminiKey,
    toggleGeminiKeyVisibilityBtn,
    settingGeminiModel,
    settingProgrammingLanguage,
    settingOllamaBaseUrl,
    settingOllamaModel,
    settingOllamaModelSelect,
    fetchOllamaModelsBtn,
    settingAssemblyKey,
    toggleAssemblyKeyVisibilityBtn,
    settingAssemblyModel,
    settingWindowOpacity,
    settingWindowOpacityValue,
    applySettingsShortcutConfig,
    showFeedback,
    onSettingsSaved
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

    function setApiKeyFieldVisibility(inputElement, toggleButton, providerName, visible) {
        if (!inputElement || !toggleButton) {
            return;
        }

        const shouldShow = Boolean(visible);
        inputElement.type = shouldShow ? 'text' : 'password';
        toggleButton.textContent = shouldShow ? 'Hide' : 'Show';
        toggleButton.setAttribute('aria-pressed', shouldShow ? 'true' : 'false');
        toggleButton.setAttribute(
            'aria-label',
            `${shouldShow ? 'Hide' : 'Show'} ${providerName} API key`
        );
    }

    function bindApiKeyVisibilityToggle(inputElement, toggleButton, providerName) {
        if (!inputElement || !toggleButton) {
            return;
        }

        setApiKeyFieldVisibility(inputElement, toggleButton, providerName, false);
        toggleButton.addEventListener('click', () => {
            const nextVisible = inputElement.type !== 'text';
            setApiKeyFieldVisibility(inputElement, toggleButton, providerName, nextVisible);
        });
    }

    // Show only the selected provider's fields.
    function updateProviderVisibility(provider) {
        const selected = PROVIDER_GROUP_IDS[provider] ? provider : 'gemini';
        for (const [name, groupId] of Object.entries(PROVIDER_GROUP_IDS)) {
            byId(groupId)?.classList.toggle('hidden', name !== selected);
        }
        updateAwsCredentialsVisibility(selected);
    }

    // The Bedrock API key option only makes sense when Bedrock is the AI
    // provider — Amazon Transcribe has no bearer scheme. When it is not
    // applicable the option is hidden and a selected apiKey mode falls back
    // to the default chain.
    function updateAwsCredentialsVisibility(provider) {
        const awsGroup = byId('aws-credentials-group');
        if (awsGroup) {
            const show = provider === 'bedrock' || currentSttProvider === 'transcribe';
            awsGroup.classList.toggle('hidden', !show);
        }

        const modeSelect = byId('setting-aws-auth-mode');
        const apiKeyOption = modeSelect?.querySelector('option[value="apiKey"]');
        if (apiKeyOption) {
            apiKeyOption.hidden = provider !== 'bedrock';
        }
        if (provider !== 'bedrock' && currentAwsAuthMode === 'apiKey') {
            currentAwsAuthMode = 'default';
            if (modeSelect) {
                modeSelect.value = 'default';
            }
        }
        updateAwsAuthModeVisibility(currentAwsAuthMode);
    }

    // Only the fields for the chosen auth method are visible.
    function updateAwsAuthModeVisibility(mode) {
        currentAwsAuthMode = mode;
        byId('aws-profile-group')?.classList.toggle('hidden', mode !== 'profile');
        byId('aws-keys-group')?.classList.toggle('hidden', mode !== 'keys');
        byId('aws-api-key-group')?.classList.toggle('hidden', mode !== 'apiKey');
    }

    function populateAwsProfileOptions(profiles, selectedProfile) {
        const select = byId('setting-aws-profile-select');
        if (!select) {
            return;
        }
        select.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = profiles.length > 0 ? 'Pick a profile...' : 'No profiles found in ~/.aws';
        select.appendChild(placeholder);
        for (const name of Array.isArray(profiles) ? profiles : []) {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            select.appendChild(option);
        }
        if (selectedProfile && profiles.includes(selectedProfile)) {
            select.value = selectedProfile;
        }
    }

    async function refreshAwsProfileList() {
        const refreshButton = byId('refresh-aws-profiles');
        try {
            if (refreshButton) {
                refreshButton.disabled = true;
            }
            const result = await window.electronAPI.listAwsProfiles();
            if (result?.success === false) {
                showFeedback?.(result?.error || 'Could not list AWS profiles.', 'error');
                return;
            }
            populateAwsProfileOptions(result?.profiles, byId('setting-aws-profile')?.value.trim());
        } catch (error) {
            console.error('Failed to list AWS profiles:', error);
            showFeedback?.('Could not list AWS profiles.', 'error');
        } finally {
            if (refreshButton) {
                refreshButton.disabled = false;
            }
        }
    }

    function bindAwsAuthControls() {
        byId('setting-aws-auth-mode')?.addEventListener('change', (event) => {
            updateAwsAuthModeVisibility(event.target.value);
        });
        byId('setting-aws-profile-select')?.addEventListener('change', (event) => {
            const profileInput = byId('setting-aws-profile');
            if (profileInput && event.target.value) {
                profileInput.value = event.target.value;
            }
        });
        byId('refresh-aws-profiles')?.addEventListener('click', () => {
            refreshAwsProfileList();
        });
    }

    function populateModelSelect(selectElement, models, selectedModel) {
        if (!selectElement) {
            return;
        }
        const ids = (Array.isArray(models) ? models : [])
            .map((entry) => (typeof entry === 'string' ? entry : entry?.id))
            .filter(Boolean);
        if (selectedModel && !ids.includes(selectedModel)) {
            ids.unshift(selectedModel);
        }
        selectElement.innerHTML = '';
        ids.forEach((id) => {
            const option = document.createElement('option');
            option.value = id;
            option.textContent = id;
            selectElement.appendChild(option);
        });
        if (selectedModel) {
            selectElement.value = selectedModel;
        }
    }

    function populateDatalist(datalist, models) {
        if (!datalist) {
            return;
        }
        datalist.innerHTML = '';
        (Array.isArray(models) ? models : []).forEach((entry) => {
            const id = typeof entry === 'string' ? entry : entry?.id;
            if (!id) {
                return;
            }
            const option = document.createElement('option');
            option.value = id;
            datalist.appendChild(option);
        });
    }

    function bindProviderToggle() {
        if (!settingAiProvider) {
            return;
        }

        settingAiProvider.addEventListener('change', () => {
            updateProviderVisibility(settingAiProvider.value);
        });
    }

    async function fetchOllamaModels() {
        if (!settingOllamaBaseUrl || !settingOllamaModelSelect) {
            return;
        }

        const baseUrl = settingOllamaBaseUrl.value.trim() || 'http://localhost:11434';

        try {
            if (fetchOllamaModelsBtn) {
                fetchOllamaModelsBtn.textContent = '...';
                fetchOllamaModelsBtn.disabled = true;
            }

            const response = await fetch(`${baseUrl}/api/tags`);
            if (!response.ok) {
                throw new Error(`Ollama API returned ${response.status}`);
            }

            const data = await response.json();
            const models = Array.isArray(data.models) ? data.models : [];

            if (models.length === 0) {
                showFeedback?.('No models found. Pull a model first with: ollama pull <model>', 'error');
                return;
            }

            settingOllamaModelSelect.innerHTML = '';
            models.forEach((model) => {
                const option = document.createElement('option');
                option.value = model.name;
                option.textContent = model.name;
                settingOllamaModelSelect.appendChild(option);
            });

            // Pre-select current model if it's in the list
            const currentModel = settingOllamaModel ? settingOllamaModel.value.trim() : '';
            const modelNames = models.map((m) => m.name);
            if (currentModel && modelNames.includes(currentModel)) {
                settingOllamaModelSelect.value = currentModel;
            }

            settingOllamaModelSelect.classList.remove('hidden');

            // When user picks from dropdown, update the text input
            settingOllamaModelSelect.addEventListener('change', () => {
                if (settingOllamaModel) {
                    settingOllamaModel.value = settingOllamaModelSelect.value;
                }
            }, { once: false });

            showFeedback?.(`Found ${models.length} model(s). Select one from the dropdown.`, 'success');
        } catch (error) {
            console.error('Failed to fetch Ollama models:', error);
            showFeedback?.(`Could not reach Ollama at ${baseUrl}. Is it running?`, 'error');
        } finally {
            if (fetchOllamaModelsBtn) {
                fetchOllamaModelsBtn.textContent = 'Fetch';
                fetchOllamaModelsBtn.disabled = false;
            }
        }
    }

    // Fetch buttons for OpenAI and Bedrock (Task D3).
    async function fetchProviderModelList(provider, button, params, applyModels) {
        try {
            button.textContent = '...';
            button.disabled = true;
            const result = await window.electronAPI.listProviderModels({ provider, ...params });
            if (!result?.success) {
                showFeedback?.(result?.error || 'Could not fetch models.', 'error');
                return;
            }
            applyModels(result.models);
            showFeedback?.(`Found ${result.models.length} models.`, 'success');
        } catch (error) {
            console.error(`Failed to fetch ${provider} models:`, error);
            showFeedback?.('Could not fetch models.', 'error');
        } finally {
            button.textContent = 'Fetch';
            button.disabled = false;
        }
    }

    function bindFetchProviderModels() {
        const openaiBtn = byId('fetch-openai-models');
        const bedrockBtn = byId('fetch-bedrock-models');

        openaiBtn?.addEventListener('click', () => {
            fetchProviderModelList(
                'openai',
                openaiBtn,
                { apiKey: byId('setting-openai-key')?.value.trim() },
                (models) => populateModelSelect(byId('setting-openai-model'), models, byId('setting-openai-model')?.value)
            );
        });

        bedrockBtn?.addEventListener('click', () => {
            fetchProviderModelList(
                'bedrock',
                bedrockBtn,
                {
                    region: byId('setting-bedrock-region')?.value.trim(),
                    authMode: byId('setting-aws-auth-mode')?.value,
                    profile: byId('setting-aws-profile')?.value.trim(),
                    accessKeyId: byId('setting-aws-access-key')?.value.trim(),
                    secretAccessKey: byId('setting-aws-secret')?.value.trim(),
                    sessionToken: byId('setting-aws-session-token')?.value.trim()
                },
                (models) => populateDatalist(byId('bedrock-model-options'), models)
            );
        });
    }

    function bindFetchOllamaModels() {
        if (!fetchOllamaModelsBtn) {
            return;
        }

        fetchOllamaModelsBtn.addEventListener('click', () => {
            fetchOllamaModels();
        });
    }

    // GNOME Wayland shortcut installer: only shown when the main process says
    // the host is Linux + GNOME. Nothing is written until a button is clicked.
    function updateGnomeShortcutsSection(gnomeShortcuts) {
        const group = byId('gnome-shortcuts-group');
        if (!group) {
            return;
        }

        const available = Boolean(gnomeShortcuts?.available);
        group.classList.toggle('hidden', !available);

        const status = byId('gnome-shortcuts-status');
        if (status && available) {
            status.textContent = gnomeShortcuts?.installed
                ? 'GNOME keyboard shortcuts are installed and work in any window.'
                : '';
        }
    }

    async function runGnomeShortcutAction(action) {
        const addButton = byId('gnome-shortcuts-add');
        const removeButton = byId('gnome-shortcuts-remove');
        const status = byId('gnome-shortcuts-status');

        try {
            if (addButton) addButton.disabled = true;
            if (removeButton) removeButton.disabled = true;
            if (status) status.textContent = 'Working...';

            const result = action === 'add'
                ? await window.electronAPI.installGnomeShortcuts()
                : await window.electronAPI.removeGnomeShortcuts();

            if (status) {
                status.textContent = result?.success
                    ? (result.message || 'Done.')
                    : (result?.error || 'Failed.');
            }
        } catch (error) {
            console.error(`GNOME shortcut ${action} failed:`, error);
            if (status) {
                status.textContent = error.message || 'Failed.';
            }
        } finally {
            if (addButton) addButton.disabled = false;
            if (removeButton) removeButton.disabled = false;
        }
    }

    function bindGnomeShortcutButtons() {
        byId('gnome-shortcuts-add')?.addEventListener('click', () => {
            runGnomeShortcutAction('add');
        });
        byId('gnome-shortcuts-remove')?.addEventListener('click', () => {
            runGnomeShortcutAction('remove');
        });
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

                // AI Provider
                const activeProvider = settings.aiProvider || 'gemini';
                if (settingAiProvider) {
                    settingAiProvider.value = activeProvider;
                }
                updateProviderVisibility(activeProvider);

                // Gemini settings
                if (settingGeminiKey) settingGeminiKey.value = settings.geminiApiKey || '';
                populateGeminiModelOptions(settings.geminiModels, settings.geminiModel || settings.defaultGeminiModel);

                // OpenAI / Anthropic / Bedrock settings
                if (byId('setting-openai-key')) byId('setting-openai-key').value = settings.openaiApiKey || '';
                populateModelSelect(byId('setting-openai-model'), settings.openaiModels, settings.openaiModel || settings.openaiModels?.[0]?.id);
                if (byId('setting-anthropic-key')) byId('setting-anthropic-key').value = settings.anthropicApiKey || '';
                populateModelSelect(byId('setting-anthropic-model'), settings.anthropicModels, settings.anthropicModel || settings.anthropicModels?.[0]?.id);
                if (byId('setting-bedrock-region')) byId('setting-bedrock-region').value = settings.bedrockRegion || settings.defaultBedrockRegion || 'us-east-1';
                if (byId('setting-bedrock-model')) byId('setting-bedrock-model').value = settings.bedrockModelId || settings.bedrockModels?.[0]?.id || '';
                populateDatalist(byId('bedrock-model-options'), settings.bedrockModels);

                // Shared AWS credentials (Bedrock + Amazon Transcribe)
                const awsAuthMode = settings.awsAuthMode || 'default';
                if (byId('setting-aws-auth-mode')) byId('setting-aws-auth-mode').value = awsAuthMode;
                updateAwsAuthModeVisibility(awsAuthMode);
                if (byId('setting-aws-profile')) byId('setting-aws-profile').value = settings.awsProfile || '';
                populateAwsProfileOptions(settings.awsProfiles || [], settings.awsProfile || '');
                if (byId('setting-aws-access-key')) byId('setting-aws-access-key').value = settings.awsAccessKeyId || '';
                if (byId('setting-aws-secret')) byId('setting-aws-secret').value = settings.awsSecretAccessKey || '';
                if (byId('setting-aws-session-token')) byId('setting-aws-session-token').value = settings.awsSessionToken || '';
                if (byId('setting-bedrock-api-key')) byId('setting-bedrock-api-key').value = settings.bedrockApiKey || '';

                // Fallback provider (first entry of the saved fallback list)
                const fallbackSelect = byId('setting-provider-fallback');
                if (fallbackSelect) {
                    fallbackSelect.innerHTML = '<option value="">None</option>';
                    (settings.aiProviders || []).forEach((name) => {
                        const option = document.createElement('option');
                        option.value = name;
                        option.textContent = settings.aiProviderLabels?.[name] || name;
                        fallbackSelect.appendChild(option);
                    });
                    fallbackSelect.value = settings.providerFallback?.[0] || '';
                }

                // Ollama settings
                if (settingOllamaBaseUrl) settingOllamaBaseUrl.value = settings.ollamaBaseUrl || 'http://localhost:11434';
                if (settingOllamaModel) settingOllamaModel.value = settings.ollamaModel || 'llama3.2';
                if (settingOllamaModelSelect) settingOllamaModelSelect.classList.add('hidden');

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
                updateGnomeShortcutsSection(settings.gnomeShortcuts);
            }
        } catch (error) {
            console.error('Failed to load settings:', error);
        }

        setApiKeyFieldVisibility(settingGeminiKey, toggleGeminiKeyVisibilityBtn, 'Gemini', false);
        setApiKeyFieldVisibility(settingAssemblyKey, toggleAssemblyKeyVisibilityBtn, 'AssemblyAI', false);

        settingsPanel.classList.remove('hidden');
    }

    function closeSettings() {
        if (settingsPanel) {
            settingsPanel.classList.add('hidden');
        }

        setApiKeyFieldVisibility(settingGeminiKey, toggleGeminiKeyVisibilityBtn, 'Gemini', false);
        setApiKeyFieldVisibility(settingAssemblyKey, toggleAssemblyKeyVisibilityBtn, 'AssemblyAI', false);
    }

    async function saveSettings() {
        try {
            const aiProvider = settingAiProvider ? settingAiProvider.value : 'gemini';

            if (aiProvider === 'gemini') {
                if (!settingGeminiModel || settingGeminiModel.options.length === 0) {
                    throw new Error('Gemini models are not configured.');
                }
            }

            if (!settingProgrammingLanguage || settingProgrammingLanguage.options.length === 0) {
                throw new Error('Programming languages are not configured.');
            }

            if (!settingAssemblyModel || settingAssemblyModel.options.length === 0) {
                throw new Error('AssemblyAI speech models are not configured.');
            }

            const settings = {
                aiProvider,
                geminiApiKey: settingGeminiKey ? settingGeminiKey.value.trim() : '',
                assemblyAiApiKey: settingAssemblyKey ? settingAssemblyKey.value.trim() : '',
                geminiModel: settingGeminiModel ? settingGeminiModel.value : '',
                providerFallback: [byId('setting-provider-fallback')?.value]
                    .filter((name) => name && name !== aiProvider),
                openaiApiKey: byId('setting-openai-key')?.value.trim() || '',
                openaiModel: byId('setting-openai-model')?.value || '',
                anthropicApiKey: byId('setting-anthropic-key')?.value.trim() || '',
                anthropicModel: byId('setting-anthropic-model')?.value || '',
                bedrockRegion: byId('setting-bedrock-region')?.value.trim() || '',
                bedrockModelId: byId('setting-bedrock-model')?.value.trim() || '',
                awsAuthMode: byId('setting-aws-auth-mode')?.value || 'default',
                awsProfile: byId('setting-aws-profile')?.value.trim() || '',
                awsAccessKeyId: byId('setting-aws-access-key')?.value.trim() || '',
                awsSecretAccessKey: byId('setting-aws-secret')?.value.trim() || '',
                awsSessionToken: byId('setting-aws-session-token')?.value.trim() || '',
                bedrockApiKey: byId('setting-bedrock-api-key')?.value.trim() || '',
                ollamaBaseUrl: settingOllamaBaseUrl ? settingOllamaBaseUrl.value.trim() : '',
                ollamaModel: settingOllamaModel ? settingOllamaModel.value.trim() : '',
                programmingLanguage: settingProgrammingLanguage.value,
                assemblyAiSpeechModel: settingAssemblyModel.value,
                windowOpacityLevel: normalizeWindowOpacityLevel(settingWindowOpacity?.value)
            };

            const result = await window.electronAPI.saveSettings(settings);

            if (result.success) {
                showFeedback?.('Settings saved. Latest AI settings are active now; voice model applies next session.', 'success');
                onSettingsSaved?.(settings);
                closeSettings();
                return { success: true, settings };
            } else {
                showFeedback?.(`Failed to save: ${result.error}`, 'error');
                return { success: false, error: result.error || 'Failed to save settings' };
            }
        } catch (error) {
            console.error('Failed to save settings:', error);
            showFeedback?.('Failed to save settings', 'error');
            return { success: false, error: error.message || 'Failed to save settings' };
        }
    }

    bindApiKeyVisibilityToggle(settingGeminiKey, toggleGeminiKeyVisibilityBtn, 'Gemini');
    bindApiKeyVisibilityToggle(settingAssemblyKey, toggleAssemblyKeyVisibilityBtn, 'AssemblyAI');
    bindApiKeyVisibilityToggle(byId('setting-openai-key'), byId('toggle-openai-key-visibility'), 'OpenAI');
    bindApiKeyVisibilityToggle(byId('setting-anthropic-key'), byId('toggle-anthropic-key-visibility'), 'Anthropic');
    bindApiKeyVisibilityToggle(byId('setting-aws-access-key'), byId('toggle-aws-access-key-visibility'), 'AWS access key');
    bindApiKeyVisibilityToggle(byId('setting-aws-secret'), byId('toggle-aws-secret-visibility'), 'AWS secret access');
    bindApiKeyVisibilityToggle(byId('setting-aws-session-token'), byId('toggle-aws-session-token-visibility'), 'AWS session');
    bindApiKeyVisibilityToggle(byId('setting-bedrock-api-key'), byId('toggle-bedrock-api-key-visibility'), 'Bedrock API');
    bindProviderToggle();
    bindAwsAuthControls();
    bindFetchOllamaModels();
    bindFetchProviderModels();
    bindGnomeShortcutButtons();

    return {
        normalizeWindowOpacityLevel,
        updateWindowOpacityValueLabel,
        openSettings,
        closeSettings,
        saveSettings
    };
}
