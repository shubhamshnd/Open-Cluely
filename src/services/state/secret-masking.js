// ============================================================================
// SECRET MASKING — Settings IPC surface
// ============================================================================
// Stored keys/tokens never leave the main process in cleartext: get-settings
// sends a masked form (bullets + last 4 chars) so the Settings UI can show
// that a key is configured and recognisable, without handing the renderer
// (or anything that compromises it) the usable secret.
//
// On save, a field that comes back blank OR still holding the masked echo
// means "untouched — keep the stored value". Only a freshly typed value
// replaces the stored secret. The masked placeholder itself must never be
// persisted as a literal key.
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
// stored one. Blank or masked input keeps the stored secret.
function resolveSecretOnSave(incoming, stored) {
  const typed = String(incoming ?? '').trim();
  const saved = String(stored ?? '').trim();
  if (!typed) {
    return saved;
  }
  if (!saved) {
    return typed;
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
  if (!typed) {
    return savedRaw;
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
  for (const segment of typedSegments) {
    const matchIndex = savedSegments.findIndex(
      (savedSegment) => maskSecretValue(savedSegment) === segment
    );
    if (matchIndex >= 0) {
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

module.exports = {
  MASK_BULLETS,
  maskSecretValue,
  maskSecretList,
  resolveSecretOnSave,
  resolveSecretListOnSave
};
