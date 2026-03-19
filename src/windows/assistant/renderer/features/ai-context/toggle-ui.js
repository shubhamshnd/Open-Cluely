export function updateMessageAiToggleUi(chatMessagesElement, message) {
  if (!message || !message.id || !chatMessagesElement) {
    return;
  }

  const container = chatMessagesElement.querySelector(`.chat-message[data-message-id="${message.id}"]`);
  if (!container) {
    return;
  }

  container.classList.toggle('ai-excluded', message.canToggleAi && !message.includeInAi);
  container.classList.toggle('ai-included', message.canToggleAi && !!message.includeInAi);

  const toggle = container.querySelector('.ai-include-toggle');
  if (toggle) {
    toggle.classList.toggle('included', !!message.includeInAi);
    toggle.classList.toggle('excluded', !message.includeInAi);
    toggle.textContent = message.includeInAi ? '-' : '+';
    toggle.setAttribute('aria-pressed', message.includeInAi ? 'true' : 'false');
  }
}
