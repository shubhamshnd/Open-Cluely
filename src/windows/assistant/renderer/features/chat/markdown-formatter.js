// ============================================================================
// MARKDOWN FORMATTER (chat AI responses)
// ============================================================================
// Renders the markdown subset models actually emit in answers — headings
// (#-###), bullet/numbered/task lists, bold/italic, inline code, fenced code
// blocks, blockquotes, horizontal rules and paragraphs.
//
// Safety contract: model text is NEVER inserted as HTML. Every character of
// the source passes through escapeHtml first; the only markup in the output
// is the markup this module generates.
// ============================================================================

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// "- [ ] task" → "☐ task", "- [x] task" → "☑ task".
function formatTaskItem(content) {
  const match = content.match(/^\[( |x|X)\]\s+(.*)$/);
  if (!match) {
    return content;
  }
  return `${match[1].trim() ? '☑' : '☐'} ${match[2]}`;
}

// Inline spans. Runs on ALREADY ESCAPED text, so a pattern can never reopen
// an HTML tag; the only tags inserted are our own.
function formatInline(escapedLine) {
  let out = escapedLine;
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic only when the opener starts a word boundary — keeps a*b*c intact.
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?;:]|$)/g, '$1<em>$2</em>');
  return out;
}

const HEADING_TAGS = { 1: 'h1', 2: 'h2', 3: 'h3' };

export function formatMarkdownResponse(text) {
  const source = String(text ?? '').replace(/\r\n/g, '\n');
  const lines = source.split('\n');
  const html = [];

  let paragraph = [];
  let list = null; // { type: 'ul' | 'ol', items: [] }
  let blockquote = [];
  let code = null; // { lang, lines: [] }

  function flushParagraph() {
    if (paragraph.length > 0) {
      html.push(`<p>${paragraph.join('<br>')}</p>`);
      paragraph = [];
    }
  }

  function flushList() {
    if (list) {
      html.push(`<${list.type}>${list.items.map((item) => `<li>${item}</li>`).join('')}</${list.type}>`);
      list = null;
    }
  }

  function flushBlockquote() {
    if (blockquote.length > 0) {
      html.push(`<blockquote>${blockquote.join('<br>')}</blockquote>`);
      blockquote = [];
    }
  }

  function flushBlocks() {
    flushParagraph();
    flushList();
    flushBlockquote();
  }

  function flushCode() {
    if (code) {
      const langClass = code.lang ? ` class="language-${code.lang}"` : '';
      html.push(`<pre><code${langClass}>${code.lines.join('\n')}</code></pre>`);
      code = null;
    }
  }

  for (const rawLine of lines) {
    if (code) {
      if (/^\s*```\s*$/.test(rawLine)) {
        flushCode();
      } else {
        code.lines.push(escapeHtml(rawLine));
      }
      continue;
    }

    const fenceMatch = rawLine.match(/^\s*```(\w*)\s*$/);
    if (fenceMatch) {
      flushBlocks();
      code = { lang: fenceMatch[1] || '', lines: [] };
      continue;
    }

    if (rawLine.trim() === '') {
      flushBlocks();
      continue;
    }

    const headingMatch = rawLine.match(/^\s*(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushBlocks();
      const tag = HEADING_TAGS[Math.min(headingMatch[1].length, 3)];
      html.push(`<${tag}>${formatInline(escapeHtml(headingMatch[2]))}</${tag}>`);
      continue;
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(rawLine)) {
      flushBlocks();
      html.push('<hr>');
      continue;
    }

    const quoteMatch = rawLine.match(/^\s*>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      blockquote.push(formatInline(escapeHtml(quoteMatch[1])));
      continue;
    }

    const listMatch = rawLine.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/);
    if (listMatch) {
      flushParagraph();
      flushBlockquote();
      const type = listMatch[2] ? 'ol' : 'ul';
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push(formatInline(escapeHtml(formatTaskItem(listMatch[3]))));
      continue;
    }

    flushList();
    flushBlockquote();
    paragraph.push(formatInline(escapeHtml(rawLine)));
  }

  // An unterminated fence still renders as a code block instead of vanishing.
  flushCode();
  flushBlocks();

  return html.join('');
}
