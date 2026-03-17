import {
  canToggleAiForMessageType,
  defaultIncludeInAiForMessageType,
  isSystemMessageType
} from './message-types.js';

export function createMessageStore() {
  let messages = [];
  let sequence = 0;

  function nextId() {
    sequence += 1;
    return `msg-${sequence}`;
  }

  function createRecord(type, content, options = {}) {
    return {
      id: options.id || nextId(),
      type,
      content,
      timestamp: options.timestamp || new Date(),
      canToggleAi: typeof options.canToggleAi === 'boolean'
        ? options.canToggleAi
        : canToggleAiForMessageType(type),
      includeInAi: typeof options.includeInAi === 'boolean'
        ? options.includeInAi
        : defaultIncludeInAiForMessageType(type),
      screenshotId: typeof options.screenshotId === 'string' ? options.screenshotId : null
    };
  }

  function add(type, content, options = {}) {
    const record = createRecord(type, content, options);
    messages.push(record);
    return record;
  }

  function clear() {
    messages = [];
    sequence = 0;
  }

  function findById(messageId) {
    return messages.find((message) => message.id === messageId);
  }

  function getMessages() {
    return messages.slice();
  }

  function toggleInclusion(messageId) {
    const message = findById(messageId);
    if (!message || !message.canToggleAi) {
      return null;
    }

    message.includeInAi = !message.includeInAi;
    return message;
  }

  function isIncludedForAi(message) {
    if (!message || isSystemMessageType(message.type)) {
      return false;
    }

    if (message.canToggleAi) {
      return !!message.includeInAi;
    }

    return message.includeInAi !== false;
  }

  return {
    add,
    clear,
    findById,
    getMessages,
    isIncludedForAi,
    toggleInclusion
  };
}
