// ============================================================================
// RESPONSE CLEANUP
// ============================================================================
// Defensive post-processing for model output. The domain-routing prompt tells
// the model to classify the request silently, but a model can still open its
// reply with a routing label line ("Domain: conceptual"). That internal text
// must never reach the user: strip leading routing-label lines from every
// response before it is returned to the caller.
// ============================================================================

// One routing-label line: "Domain: conceptual", "**Category:** coding",
// "Mode: other" — case-insensitive, optional markdown bold markers.
// Anchored per-line by the caller; only leading lines are ever removed.
const ROUTING_LABEL_LINE = /^[ \t]*(?:\*\*|__)?[ \t]*(?:Domain|Category|Mode)[ \t]*(?:\*\*|__)?[ \t]*:[^\n]*$/i;

// Never strip more than this many leading label lines: past that point the
// lines are the answer itself, not leaked routing text.
const MAX_STRIPPED_LINES = 3;

function stripRoutingLabels(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return typeof text === 'string' ? text : '';
  }

  const lines = text.split('\n');
  let index = 0;

  // Tolerate blank lines before a label block.
  while (index < lines.length && lines[index].trim() === '') {
    index += 1;
  }

  let labels = 0;
  while (
    index + labels < lines.length &&
    labels < MAX_STRIPPED_LINES &&
    ROUTING_LABEL_LINE.test(lines[index + labels])
  ) {
    labels += 1;
  }

  if (labels === 0) {
    return text;
  }

  // Drop the labels and the blank lines that separated them from the answer.
  let end = index + labels;
  while (end < lines.length && lines[end].trim() === '') {
    end += 1;
  }
  return lines.slice(end).join('\n');
}

module.exports = { stripRoutingLabels };
