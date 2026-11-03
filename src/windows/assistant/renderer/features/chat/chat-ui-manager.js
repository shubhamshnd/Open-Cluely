import { formatMarkdownResponse } from './markdown-formatter.js';

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
    addMonitorLog,
    isAutoScrollEnabled = () => true
}) {
    // AI responses arrive as markdown and are rendered (headings, lists,
    // bold/italic, code) with the source fully escaped first — raw model text
    // never becomes HTML.
    function formatResponse(text) {
        return formatMarkdownResponse(text);
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
            ? `<button class="ai-include-toggle ${record.includeInAi ? 'included' : 'excluded'}" data-message-id="${record.id}" type="button" aria-label="Toggle AI context" aria-pressed="${record.includeInAi ? 'true' : 'false'}">${record.includeInAi ? '-' : '+'}</button>`
            : '';
        const copyHtml = `<button class="message-copy-btn" data-message-id="${record.id}" type="button" aria-label="Copy message"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg></button>`;
        const messageActionsHtml = `<span class="message-actions">${toggleHtml}${copyHtml}</span>`;
        const exclusionHtml = record.canToggleAi
            ? '<div class="ai-excluded-note">Excluded from AI context</div>'
            : '';

        const messageContent = `
        <div class="message-header">
            <span class="message-icon">${icon}</span>
            ${labelHtml}
            ${messageActionsHtml}
            <span class="message-time">${timestamp}</span>
        </div>
        <div class="${contentClass}">${exclusionHtml}${safeContent}</div>
    `;

        messageDiv.innerHTML = messageContent;
        chatMessagesElement.appendChild(messageDiv);

        if (shouldAutoScroll && isAutoScrollEnabled()) {
            chatMessagesElement.scrollTop = chatMessagesElement.scrollHeight;
        }

        onMessagesChanged?.(messageStore.getMessages());
        updateUi?.();

        return record;
    }

    // Removes a message from the store and the DOM. Used to drop the
    // streaming placeholder of a failed AI action so it never pollutes the
    // next context bundle as an "AI:" line.
    function removeChatMessage(messageId) {
        const removed = messageStore.remove(messageId);
        if (!removed) {
            return null;
        }

        if (chatMessagesElement) {
            const messageEl = chatMessagesElement.querySelector(`[data-message-id="${messageId}"]`);
            if (messageEl) {
                messageEl.remove();
            }
        }

        onMessagesChanged?.(messageStore.getMessages());
        updateUi?.();
        return removed;
    }

    function updateChatComposerHeight() {
        if (!chatContainer || !chatComposer) {
            return;
        }

        // Remove the variable first so the min-height constraint is cleared,
        // allowing getBoundingClientRect to return the natural content height
        // instead of being held at the previous (potentially stale) large value.
        chatContainer.style.removeProperty('--chat-composer-height');
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

    function updateChatMessageContent(messageId, newContent) {
        const record = messageStore.findById(messageId);
        if (record) {
            record.content = newContent;
        }

        if (!chatMessagesElement) return;

        const messageEl = chatMessagesElement.querySelector(`[data-message-id="${messageId}"]`);
        if (!messageEl) return;

        const contentEl = messageEl.querySelector('.message-content');
        if (!contentEl) return;

        const shouldAutoScroll = isChatNearBottom();
        contentEl.innerHTML = formatResponse(newContent);

        if (shouldAutoScroll && isAutoScrollEnabled()) {
            chatMessagesElement.scrollTop = chatMessagesElement.scrollHeight;
        }
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
        removeChatMessage,
        updateChatMessageContent,
        autoResizeManualInput,
        submitManualContextMessage,
        updateManualComposerState,
        isChatNearBottom
    };
}
