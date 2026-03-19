import { normalizeSource } from './source-state.js';

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

export function createTranscriptBufferManager({
  onFlush,
  onBuffer,
  mergeWindowMs = 2400
}) {
  const buffers = {
    mic: { text: '', segments: 0, timer: null },
    system: { text: '', segments: 0, timer: null }
  };

  function clearFinalTranscriptTimer(source) {
    const resolvedSource = normalizeSource(source);
    const timer = buffers[resolvedSource].timer;

    if (timer) {
      clearTimeout(timer);
      buffers[resolvedSource].timer = null;
    }
  }

  function resetFinalTranscriptBuffer(source) {
    const resolvedSource = normalizeSource(source);
    clearFinalTranscriptTimer(resolvedSource);
    buffers[resolvedSource].text = '';
    buffers[resolvedSource].segments = 0;
  }

  function flushFinalTranscript(source, reason = 'pause-timeout') {
    const resolvedSource = normalizeSource(source);
    const buffer = buffers[resolvedSource];
    const text = String(buffer.text || '').trim();
    const segments = buffer.segments;

    clearFinalTranscriptTimer(resolvedSource);
    buffer.text = '';
    buffer.segments = 0;

    if (!text) {
      return;
    }

    onFlush({ source: resolvedSource, text, reason, segments });
  }

  function queueFinalTranscript(source, text) {
    const resolvedSource = normalizeSource(source);
    const buffer = buffers[resolvedSource];

    buffer.text = mergeTranscriptText(buffer.text, text);
    buffer.segments += 1;

    if (typeof onBuffer === 'function') {
      onBuffer({
        source: resolvedSource,
        text: buffer.text,
        segments: buffer.segments
      });
    }

    clearFinalTranscriptTimer(resolvedSource);
    buffer.timer = setTimeout(() => {
      flushFinalTranscript(resolvedSource, 'pause-timeout');
    }, mergeWindowMs);
  }

  function flushAllFinalTranscripts(reason = 'flush-all') {
    flushFinalTranscript('mic', reason);
    flushFinalTranscript('system', reason);
  }

  return {
    flushAllFinalTranscripts,
    flushFinalTranscript,
    queueFinalTranscript,
    resetFinalTranscriptBuffer
  };
}
