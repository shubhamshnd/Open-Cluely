import {
  contextLineForMessage,
  isScreenshotMessageType,
  isSystemMessageType,
  isTranscriptMessageType,
  summaryLineForMessage
} from './message-types.js';

export function buildFilteredAiContextBundle({
  messages,
  isMessageIncludedForAi,
  charBudget,
  emitTruncationLog = true,
  onTruncationLog
}) {
  const candidates = messages
    .filter(isMessageIncludedForAi)
    .map((message) => ({
      message,
      contextLine: contextLineForMessage(message),
      summaryLine: summaryLineForMessage(message)
    }))
    .filter((entry) => entry.contextLine.length > 0);

  const selectedReversed = [];
  let currentChars = 0;
  let dropped = 0;

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const entry = candidates[index];
    const nextCost = entry.contextLine.length + 1;

    if (currentChars + nextCost > charBudget) {
      dropped += 1;
      continue;
    }

    selectedReversed.push(entry);
    currentChars += nextCost;
  }

  const selected = selectedReversed.reverse();

  if (emitTruncationLog && dropped > 0 && typeof onTruncationLog === 'function') {
    onTruncationLog(dropped, charBudget);
  }

  const transcriptContext = selected
    .filter((entry) => isTranscriptMessageType(entry.message.type))
    .map((entry) => entry.contextLine)
    .join('\n');

  const sessionSummary = selected
    .filter((entry) => !isSystemMessageType(entry.message.type))
    .map((entry) => entry.summaryLine)
    .filter((line) => line.length > 0)
    .slice(-16)
    .join('\n');

  const enabledScreenshotIds = Array.from(
    new Set(
      selected
        .filter((entry) => isScreenshotMessageType(entry.message.type))
        .map((entry) => entry.message.screenshotId)
        .filter((value) => typeof value === 'string' && value.trim().length > 0)
    )
  );

  return {
    contextString: selected.map((entry) => entry.contextLine).join('\n'),
    transcriptContext,
    sessionSummary,
    enabledScreenshotIds,
    droppedMessages: dropped,
    selectedMessages: selected.length,
    charBudget
  };
}
