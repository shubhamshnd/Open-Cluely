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

            const buttonLabel = document.createElement('span');
            buttonLabel.className = 'settings-shortcut-button';
            buttonLabel.textContent = shortcut.buttonLabel;
            if (shortcut.description) {
                buttonLabel.title = shortcut.description;
            }

            const shortcutValue = document.createElement('span');
            shortcutValue.className = 'settings-shortcut-key';
            shortcutValue.textContent = formatShortcutForDisplay(shortcut.accelerator);

            row.appendChild(buttonLabel);
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
