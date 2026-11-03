// ============================================================================
// SECRET MASKING — Settings IPC surface
// ============================================================================
// Stored keys/tokens never leave the main process in cleartext: get-settings
// sends a masked form (bullets + last 4 chars) so the Settings UI can show
// that a key is configured and recognisable, without handing the renderer
// (or anything that compromises it) the usable secret.
//
// On save, a masked echo or omitted field keeps the stored secret. Explicit
// empty input clears it, preserving Settings' original key-removal behavior.
// A freshly typed value replaces it; masked placeholders are never persisted.
// ============================================================================

const MASK_BULLETS = '••••••••';

function maskSecretValue(secret) {
  const value = String(secret ?? '').trim();
  if (!value) {
    return '';
  }
  // Short secrets would be fully revealed by a last-4 window: hide them whole.
  if (value.length <= 4) {
    return MASK_BULLETS;
  }
  return `${MASK_BULLETS}${value.slice(-4)}`;
}

// Gemini supports a comma-separated key list; mask each entry so the field
// still shows how many keys are configured.
function maskSecretList(value) {
  const segments = String(value ?? '')
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments.map(maskSecretValue).join(', ');
}

function containsMask(value) {
  return String(value ?? '').includes(MASK_BULLETS);
}

// Single-value secrets: resolve the value the Settings form sent against the
// stored one. Masked or omitted input keeps it; explicit blank clears it.
function resolveSecretOnSave(incoming, stored) {
  const typed = String(incoming ?? '').trim();
  const saved = String(stored ?? '').trim();
  if (incoming === undefined) {
    return saved;
  }
  if (!typed) {
    return '';
  }
  if (typed === maskSecretValue(saved)) {
    return saved;
  }
  // A masked fragment inside a longer edit (e.g. user typed around the
  // placeholder): never persist bullets as a literal key — keep the stored
  // value rather than corrupting it.
  if (containsMask(typed)) {
    return saved;
  }
  return typed;
}

// Comma-separated key lists (Gemini): each masked segment maps back to its
// stored original, fresh segments are kept, and orphaned masked fragments
// are dropped. If nothing usable remains, keep the stored list.
function resolveSecretListOnSave(incoming, stored) {
  const typed = String(incoming ?? '').trim();
  const savedRaw = String(stored ?? '').trim();
  if (incoming === undefined) {
    return savedRaw;
  }
  if (!typed) {
    return '';
  }
  const savedSegments = savedRaw
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);
  const typedSegments = typed
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);

  const resolved = [];
  const consumed = new Set();
  for (const segment of typedSegments) {
    const matchIndex = savedSegments.findIndex(
      (savedSegment, index) => !consumed.has(index) && maskSecretValue(savedSegment) === segment
    );
    if (matchIndex >= 0) {
      consumed.add(matchIndex);
      resolved.push(savedSegments[matchIndex]);
      continue;
    }
    if (containsMask(segment)) {
      continue; // masked fragment that matches nothing stored — drop it
    }
    resolved.push(segment);
  }

  return resolved.length > 0 ? resolved.join(',') : savedRaw;
}

// SDK and server error text can echo key material (OpenAI's own error body
// shows the first and last characters of the offending key). Console output
// and error broadcasts pass through this redactor so a secret never lands in
// a log or on a connected phone. Only the last 4 chars survive, matching the
// masked display form.
const SECRET_PATTERNS = [
  // OpenAI / Anthropic style keys, including server-echoed sk-…***…last4
  { re: /sk-[A-Za-z0-9_*-]{8,}/g, keep: 3 },
  // AWS access key id
  { re: /AKIA[0-9A-Z]{16}/g, keep: 4 },
  // Google API keys
  { re: /AIza[0-9A-Za-z_*-]{16,}/g, keep: 4 },
  // Bearer tokens in Authorization headers
  { re: /Bearer\s+[A-Za-z0-9._*~-]{8,}/g, keep: -1 }
];

function redactSecretsInText(text) {
  let out = String(text ?? '');
  if (!out) {
    return '';
  }
  for (const { re, keep } of SECRET_PATTERNS) {
    out = out.replace(re, (match) => {
      if (keep === -1) {
        // Bearer: keep the scheme word, mask the token.
        const head = match.match(/^Bearer\s+/)[0];
        const token = match.slice(head.length);
        return `${head}${MASK_BULLETS}${token.slice(-4)}`;
      }
      return `${match.slice(0, keep)}${MASK_BULLETS}${match.slice(-4)}`;
    });
  }
  return out;
}

module.exports = {
  MASK_BULLETS,
  maskSecretValue,
  maskSecretList,
  resolveSecretOnSave,
  resolveSecretListOnSave,
  redactSecretsInText
};
