export function createChatUiManager({
    chatContainer,
    chatMessagesElement,
    chatComposer,
    chatManualInput,
    chatManualSend,
    messageStore,
    maxChatInputHeight,
    escapeHtml,
    updateUi,
    onMessagesChanged,
    showFeedback,
    addMonitorLog
}) {
    function formatResponse(text) {
        return String(text || '')
            .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');
    }

    function isChatNearBottom(threshold = 28) {
        if (!chatMessagesElement) {
            return true;
        }

        const distanceFromBottom =
            chatMessagesElement.scrollHeight - chatMessagesElement.clientHeight - chatMessagesElement.scrollTop;
        return distanceFromBottom <= threshold;
    }

    function addChatMessage(type, content, options = {}) {
        if (!chatMessagesElement) {
            return null;
        }

        const shouldAutoScroll = isChatNearBottom();

        const timestampDate = new Date();
        const record = messageStore.add(type, content, {
            id: options.id,
            timestamp: timestampDate,
            canToggleAi: options.canToggleAi,
            includeInAi: options.includeInAi,
            screenshotId: options.screenshotId
        });

        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${type}-message`;
        messageDiv.dataset.messageId = record.id;
        if (record.canToggleAi) {
            messageDiv.classList.add('ai-toggleable');
            messageDiv.classList.add(record.includeInAi ? 'ai-included' : 'ai-excluded');
        }

        const timestamp = timestampDate.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });

        let icon = '\u2139\uFE0F';
        let label = '';
        let contentClass = 'message-content';
        let safeContent = escapeHtml(content);

        switch (type) {
            case 'voice':
            case 'voice-mic':
                icon = '\u{1F3A4}';
                label = 'You';
                break;

            case 'voice-system':
                icon = '\u{1F50A}';
                label = 'Host';
                break;

            case 'screenshot':
                icon = '\u{1F4F8}';
                break;

            case 'ai-response':
                icon = '\u{1F916}';
                contentClass = 'message-content ai-response';
                safeContent = formatResponse(content);
                break;

            case 'system':
                icon = '\u2139\uFE0F';
                contentClass = 'message-content system-message';
                break;
        }

        const labelHtml = label ? `<span class="message-label">${label}</span>` : '';
        const toggleHtml = record.canToggleAi
            ? `<button class="ai-include-toggle ${record.includeInAi ? 'included' : 'excluded'}" data-message-id="${record.id}" aria-pressed="${record.includeInAi ? 'true' : 'false'}">${record.includeInAi ? '-' : '+'}</button>`
            : '';
        const exclusionHtml = record.canToggleAi
            ? '<div class="ai-excluded-note">Excluded from AI context</div>'
            : '';

        const messageContent = `
        <div class="message-header">
            <span class="message-icon">${icon}</span>
            ${labelHtml}
            ${toggleHtml}
            <span class="message-time">${timestamp}</span>
        </div>
        <div class="${contentClass}">${exclusionHtml}${safeContent}</div>
    `;

        messageDiv.innerHTML = messageContent;
        chatMessagesElement.appendChild(messageDiv);

        if (shouldAutoScroll) {
            chatMessagesElement.scrollTop = chatMessagesElement.scrollHeight;
        }

        onMessagesChanged?.(messageStore.getMessages());
        updateUi?.();

        return record;
    }

    function updateChatComposerHeight() {
        if (!chatContainer || !chatComposer) {
            return;
        }

        const composerHeight = Math.max(0, Math.round(chatComposer.getBoundingClientRect().height));
        if (composerHeight > 0) {
            chatContainer.style.setProperty('--chat-composer-height', `${composerHeight}px`);
        }
    }

    function autoResizeManualInput() {
        if (!chatManualInput) {
            return;
        }

        chatManualInput.style.height = 'auto';
        const nextHeight = Math.min(chatManualInput.scrollHeight, maxChatInputHeight);
        chatManualInput.style.height = `${Math.max(24, nextHeight)}px`;
        chatManualInput.style.overflowY = chatManualInput.scrollHeight > maxChatInputHeight ? 'auto' : 'hidden';
        updateChatComposerHeight();
    }

    function updateManualComposerState() {
        if (!chatManualInput || !chatManualSend) {
            return;
        }

        chatManualSend.disabled = String(chatManualInput.value || '').trim().length === 0;
    }

    function submitManualContextMessage() {
        if (!chatManualInput) {
            return;
        }

        const text = String(chatManualInput.value || '').trim();
        if (!text) {
            showFeedback?.('Type a message first', 'error');
            return;
        }

        addChatMessage('voice-mic', text);
        addMonitorLog?.('info', 'manual-context-added', 'Manual context message added', 'mic', {
            chars: text.length
        });
        showFeedback?.('Manual context added', 'success');

        chatManualInput.value = '';
        autoResizeManualInput();
        updateManualComposerState();
        chatManualInput.focus();
    }

    return {
        addChatMessage,
        autoResizeManualInput,
        submitManualContextMessage,
        updateManualComposerState
    };
}
