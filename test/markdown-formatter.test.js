'use strict';

// Defect: Notes showed literal "## Key Discussion Points" and "- " bullets —
// the chat formatter only partly rendered markdown. It now renders the answer
// subset properly, with the source HTML-escaped first (XSS-safe by contract).

const test = require('node:test');
const assert = require('node:assert/strict');

async function loadFormatter() {
  return import('../src/windows/assistant/renderer/features/chat/markdown-formatter.js');
}

test('renders headings # through ### and clamps deeper levels', async () => {
  const { formatMarkdownResponse } = await loadFormatter();
  assert.equal(formatMarkdownResponse('# Title'), '<h1>Title</h1>');
  assert.equal(formatMarkdownResponse('## Key Discussion Points'), '<h2>Key Discussion Points</h2>');
  assert.equal(formatMarkdownResponse('### Sub'), '<h3>Sub</h3>');
  assert.equal(formatMarkdownResponse('##### Deep'), '<h3>Deep</h3>');
});

test('renders bullet, numbered and task lists', async () => {
  const { formatMarkdownResponse } = await loadFormatter();
  assert.equal(
    formatMarkdownResponse('- one\n- two'),
    '<ul><li>one</li><li>two</li></ul>'
  );
  assert.equal(
    formatMarkdownResponse('1. first\n2. second'),
    '<ol><li>first</li><li>second</li></ol>'
  );
  assert.equal(
    formatMarkdownResponse('- [ ] call Rohit — Owner: Rohit\n- [x] done thing'),
    '<ul><li>☐ call Rohit — Owner: Rohit</li><li>☑ done thing</li></ul>'
  );
});

test('renders bold, italic and inline code without crossing into words', async () => {
  const { formatMarkdownResponse } = await loadFormatter();
  assert.equal(
    formatMarkdownResponse('**Best response (say this):**'),
    '<p><strong>Best response (say this):</strong></p>'
  );
  assert.equal(formatMarkdownResponse('some *emphasis* here'), '<p>some <em>emphasis</em> here</p>');
  assert.equal(formatMarkdownResponse('a*b*c stays literal'), '<p>a*b*c stays literal</p>');
  assert.equal(formatMarkdownResponse('use `printf` here'), '<p>use <code>printf</code> here</p>');
});

test('renders fenced code blocks, including unterminated fences', async () => {
  const { formatMarkdownResponse } = await loadFormatter();
  assert.equal(
    formatMarkdownResponse('```python\nprint("hi")\n```'),
    '<pre><code class="language-python">print(&quot;hi&quot;)</code></pre>'
  );
  assert.equal(
    formatMarkdownResponse('```\nraw <b>html</b>\n```'),
    '<pre><code>raw &lt;b&gt;html&lt;/b&gt;</code></pre>'
  );
  // Never closed: the rest is still code, not dropped.
  assert.equal(
    formatMarkdownResponse('intro\n```js\nlet x = 1;'),
    '<p>intro</p><pre><code class="language-js">let x = 1;</code></pre>'
  );
});

test('paragraphs split on blank lines, single newlines become <br>', async () => {
  const { formatMarkdownResponse } = await loadFormatter();
  assert.equal(
    formatMarkdownResponse('first\nsecond\n\nthird'),
    '<p>first<br>second</p><p>third</p>'
  );
});

test('renders blockquotes and horizontal rules', async () => {
  const { formatMarkdownResponse } = await loadFormatter();
  assert.equal(
    formatMarkdownResponse("> I'm not sure what you're being asked.\n> ---"),
    '<blockquote>I&#39;m not sure what you&#39;re being asked.<br>---</blockquote>'
  );
  assert.equal(formatMarkdownResponse('above\n---\nbelow'), '<p>above</p><hr><p>below</p>');
});

test('a full Notes-shaped answer renders without raw markdown symbols', async () => {
  const { formatMarkdownResponse } = await loadFormatter();
  const notes = [
    '## Key Discussion Points',
    '- Processes run independently with isolated memory',
    '- Threads share memory within a process',
    '',
    '## Action Items',
    '- [ ] Review thread safety — Owner: team'
  ].join('\n');
  const html = formatMarkdownResponse(notes);
  assert.ok(html.includes('<h2>Key Discussion Points</h2>'));
  assert.ok(html.includes('<ul><li>Processes run independently'));
  assert.ok(!/(^|[>\s])##\s/.test(html), 'raw ## leaked into output');
  assert.ok(!/<li>- /.test(html), 'raw bullet marker leaked into output');
});

// --- XSS safety: model text never becomes HTML -----------------------------

const XSS_CASES = [
  '<img src=x onerror=alert(1)>',
  '<script>alert(1)</script>',
  '**<img src=x onerror=alert(1)>**',
  '```\n<script>alert(1)</script>\n```',
  '- <svg onload=alert(1)>',
  '# <iframe src=javascript:alert(1)></iframe>',
  '`</code><img src=x onerror=alert(1)>`',
  '[click](javascript:alert(1)) <b>bold</b>',
  '"><script>alert(document.domain)</script>'
];

test('XSS strings are escaped and no event handlers or scripts survive', async () => {
  const { formatMarkdownResponse } = await loadFormatter();
  // Airtight: every '<' in the output must belong to a formatter-generated
  // tag. Anything from the model arrives escaped (&lt;) and cannot open one.
  const FORMATTER_TAGS = /<\/?(?:p|h1|h2|h3|ul|ol|li|strong|em|code|pre|blockquote|hr)\b[^>]*>/g;
  for (const payload of XSS_CASES) {
    const html = formatMarkdownResponse(payload);
    assert.ok(!/<(img|script|svg|iframe|object|embed)\b/i.test(html), `unsafe tag survived: ${payload} → ${html}`);
    const withoutFormatterTags = html.replace(FORMATTER_TAGS, '');
    assert.ok(
      !withoutFormatterTags.includes('<') && !withoutFormatterTags.includes('>'),
      `non-formatter markup survived: ${payload} → ${html}`
    );
  }
});

test('angle brackets from the source always arrive escaped in the output', async () => {
  const { formatMarkdownResponse } = await loadFormatter();
  const html = formatMarkdownResponse('<img src=x onerror=alert(1)> and **bold**');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('<strong>bold</strong>'));
});

test('empty and non-string input is safe', async () => {
  const { formatMarkdownResponse } = await loadFormatter();
  assert.equal(formatMarkdownResponse(''), '');
  assert.equal(formatMarkdownResponse(null), '');
  assert.equal(formatMarkdownResponse(undefined), '');
});

test('chat-ui-manager renders AI responses through the markdown formatter', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const source = fs.readFileSync(
    path.join(__dirname, '../src/windows/assistant/renderer/features/chat/chat-ui-manager.js'),
    'utf8'
  );
  assert.match(source, /import \{ formatMarkdownResponse \} from '\.\/markdown-formatter\.js'/);
  assert.match(source, /formatMarkdownResponse\(text\)/);
  assert.doesNotMatch(source, /replace\(\/\\n\/g, '<br>'\)/);
});
