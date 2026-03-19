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

const shortcutIconById = {
    toggleTranscription: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10v4"/><path d="M7 7v10"/><path d="M11 4v16"/><path d="M15 7v10"/><path d="M19 10v4"/></svg>',
    takeScreenshot: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 2 7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/></svg>',
    askAi: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a8 8 0 0 0-8 8v2a4 4 0 0 0 4 4h1v3l3-3h3a8 8 0 0 0 8-8 8 8 0 0 0-8-8zm-1 6h2v2h-2V8zm0 3h2v5h-2v-5z"/></svg>',
    screenAi: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-6v2h3v1H7v-1h3v-2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm0 2v10h16V7H4z"/></svg>',
    suggest: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 21h6v-1H9v1zm3-19a7 7 0 0 0-4 12.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26A7 7 0 0 0 12 2zm2 11.6V16h-4v-2.4A5 5 0 1 1 14 13.6z"/></svg>',
    notes: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 2h9l5 5v15a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 1v5h5"/><path d="M8 13h8v1H8zm0 3h8v1H8zm0-6h5v1H8z"/></svg>',
    insights: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 20h16v1H3V4h1v16z"/><path d="M7 16h2v-5H7v5zm4 0h2V8h-2v8zm4 0h2v-3h-2v3z"/></svg>',
    clearChat: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
    emergencyHide: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7a1 1 0 1 0-1.42 1.42L10.59 12l-4.9 4.89a1 1 0 0 0 1.42 1.42L12 13.41l4.89 4.9a1 1 0 0 0 1.42-1.42L13.41 12l4.9-4.89a1 1 0 0 0 0-1.4Z"/></svg>',
    toggleStealth: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4a8 8 0 1 0 0 16V4z"/></svg>',
    moveWindowLeft: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 7l-5 5 5 5V7z"/></svg>',
    moveWindowRight: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 7l5 5-5 5V7z"/></svg>',
    moveWindowUp: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 14l5-5 5 5H7z"/></svg>',
    moveWindowDown: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5H7z"/></svg>'
};

function getShortcutIconMarkup(shortcutId) {
    return shortcutIconById[shortcutId] || '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="4"/></svg>';
}

export function createShortcutManager({ settingsShortcutsList }) {
    let configuredKeyboardShortcuts = [];
    const shortcutBindingsById = new Map();

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

            const shortcutMeta = document.createElement('div');
            shortcutMeta.className = 'settings-shortcut-meta';

            const icon = document.createElement('span');
            icon.className = 'settings-shortcut-icon';
            icon.innerHTML = getShortcutIconMarkup(shortcut.id);

            const buttonLabel = document.createElement('span');
            buttonLabel.className = 'settings-shortcut-button';
            buttonLabel.textContent = shortcut.buttonLabel;
            if (shortcut.description) {
                buttonLabel.title = shortcut.description;
            }
            const shortcutText = document.createElement('div');
            shortcutText.className = 'settings-shortcut-text';
            shortcutText.appendChild(buttonLabel);

            if (shortcut.description) {
                const description = document.createElement('span');
                description.className = 'settings-shortcut-description';
                description.textContent = shortcut.description;
                shortcutText.appendChild(description);
            }

            const shortcutValue = document.createElement('span');
            shortcutValue.className = 'settings-shortcut-key';
            shortcutValue.textContent = formatShortcutForDisplay(shortcut.accelerator);

            shortcutMeta.appendChild(icon);
            shortcutMeta.appendChild(shortcutText);
            row.appendChild(shortcutMeta);
            row.appendChild(shortcutValue);
            settingsShortcutsList.appendChild(row);
        });
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
        } else if (event.ctrlKey !== binding.ctrl || event.metaKey !== binding.meta) {
            return false;
        }

        return event.altKey === binding.alt && event.shiftKey === binding.shift;
    }

    function applySettingsShortcutConfig(settings) {
        if (!settings || settings.error) {
            return;
        }

        setConfiguredKeyboardShortcuts(settings.keyboardShortcuts);
    }

    return {
        applySettingsShortcutConfig,
        isShortcutPressed
    };
}
