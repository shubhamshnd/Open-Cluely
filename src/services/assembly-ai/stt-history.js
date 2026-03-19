function normalizeSttSource(source) {
  return source === 'system' ? 'system' : 'mic';
}

function normalizeTranscriptForMerge(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mergeTranscriptText(existingText, incomingText) {
  const current = String(existingText || '').trim();
  const incoming = String(incomingText || '').trim();

  if (!current) return incoming;
  if (!incoming) return current;

  const currentNorm = normalizeTranscriptForMerge(current);
  const incomingNorm = normalizeTranscriptForMerge(incoming);

  if (!incomingNorm) return current;
  if (!currentNorm) return incoming;

  if (currentNorm === incomingNorm) {
    return incoming.length >= current.length ? incoming : current;
  }

  if (incomingNorm.includes(currentNorm)) {
    return incoming;
  }

  if (currentNorm.includes(incomingNorm)) {
    return current;
  }

  const currentWords = current.split(/\s+/);
  const incomingWords = incoming.split(/\s+/);
  const maxOverlap = Math.min(12, currentWords.length, incomingWords.length);
  let overlap = 0;

  for (let size = maxOverlap; size > 0; size -= 1) {
    const currentTail = currentWords.slice(-size).join(' ').toLowerCase();
    const incomingHead = incomingWords.slice(0, size).join(' ').toLowerCase();
    if (currentTail === incomingHead) {
      overlap = size;
      break;
    }
  }

  if (overlap > 0) {
    const remainder = incomingWords.slice(overlap).join(' ');
    if (!remainder) return current;
    return `${current} ${remainder}`.replace(/\s+/g, ' ').trim();
  }

  return `${current} ${incoming}`.replace(/\s+/g, ' ').trim();
}

function createSttHistoryManager({
  getGeminiService,
  emitSttDebug,
  mergeWindowMs = 2400
}) {
  const sttHistoryBuffers = {
    mic: { text: '', segments: 0, timer: null },
    system: { text: '', segments: 0, timer: null }
  };

  function clearSttHistoryTimer(source) {
    const resolvedSource = normalizeSttSource(source);
    const timer = sttHistoryBuffers[resolvedSource].timer;
    if (timer) {
      clearTimeout(timer);
      sttHistoryBuffers[resolvedSource].timer = null;
    }
  }

  function resetSttHistoryBuffer(source) {
    const resolvedSource = normalizeSttSource(source);
    clearSttHistoryTimer(resolvedSource);
    sttHistoryBuffers[resolvedSource].text = '';
    sttHistoryBuffers[resolvedSource].segments = 0;
  }

  function flushSttHistoryBuffer(source, reason = 'pause-timeout') {
    const resolvedSource = normalizeSttSource(source);
    const buffer = sttHistoryBuffers[resolvedSource];
    const finalText = String(buffer.text || '').trim();
    const segmentCount = buffer.segments;

    clearSttHistoryTimer(resolvedSource);
    buffer.text = '';
    buffer.segments = 0;

    const geminiService = getGeminiService();
    if (!finalText || !geminiService) {
      return;
    }

    try {
      const label = resolvedSource === 'system' ? 'Host' : 'You';
      geminiService.addToHistory('user', `${label}: ${finalText}`);
      emitSttDebug({
        source: resolvedSource,
        event: 'history-flush',
        message: 'Merged transcript added to Gemini history',
        meta: {
          reason,
          chars: finalText.length,
          segments: segmentCount
        }
      });
    } catch (error) {
      emitSttDebug({
        source: resolvedSource,
        level: 'error',
        event: 'history-flush-failed',
        message: error?.message || 'Failed to add merged transcript to history'
      });
    }
  }

  function flushAllSttHistoryBuffers(reason = 'flush-all') {
    flushSttHistoryBuffer('mic', reason);
    flushSttHistoryBuffer('system', reason);
  }

  function queueSttHistorySegment(source, transcriptText) {
    const resolvedSource = normalizeSttSource(source);
    const buffer = sttHistoryBuffers[resolvedSource];

    buffer.text = mergeTranscriptText(buffer.text, transcriptText);
    buffer.segments += 1;

    emitSttDebug({
      source: resolvedSource,
      event: 'history-buffer',
      message: 'Buffered final transcript segment',
      meta: {
        segments: buffer.segments,
        chars: buffer.text.length
      }
    });

    clearSttHistoryTimer(resolvedSource);

    buffer.timer = setTimeout(() => {
      flushSttHistoryBuffer(resolvedSource, 'pause-timeout');
    }, mergeWindowMs);
  }

  function dispose() {
    resetSttHistoryBuffer('mic');
    resetSttHistoryBuffer('system');
  }

  return {
    flushAllSttHistoryBuffers,
    flushSttHistoryBuffer,
    queueSttHistorySegment,
    resetSttHistoryBuffer,
    dispose
  };
}

module.exports = {
  createSttHistoryManager,
  normalizeSttSource
};
