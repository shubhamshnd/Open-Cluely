// ============================================================================
// SCRIPT: fetch-gemini-models.js
// ============================================================================
// Fetches all supported Google Gemini models from the API and shows which
// ones support generateContent (usable for chat/AI).
//
// Usage:
//   node scripts/fetch-gemini-models.js
//
// Reads GEMINI_API_KEY from .env (same as the app). Supports comma-separated
// keys — uses the first valid one found.
// ============================================================================

const https = require('https');
const path = require('path');

// Load .env from project root (same as app infrastructure)
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { getGeminiModels } = require('../src/config');

// ============================================================================
// API key resolution (mirrors the app's multi-key support)
// ============================================================================

function resolveApiKey() {
  const raw = String(process.env.GEMINI_API_KEY || '').trim();
  if (!raw) {
    return null;
  }
  // Support comma-separated keys — use the first non-empty one
  const keys = raw.split(',').map((k) => k.trim()).filter(Boolean);
  return keys[0] || null;
}

// ============================================================================
// HTTP helpers
// ============================================================================

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        if (res.statusCode >= 400) {
          let parsed;
          try { parsed = JSON.parse(body); } catch { parsed = { message: body }; }
          const msg = parsed?.error?.message || parsed?.message || body;
          reject(new Error(`HTTP ${res.statusCode}: ${msg}`));
        } else {
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error('Failed to parse response as JSON'));
          }
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ============================================================================
// Fetch models from both v1 and v1beta endpoints
// ============================================================================

async function fetchModels(apiKey, apiVersion) {
  const url = `https://generativelanguage.googleapis.com/${apiVersion}/models?key=${apiKey}`;
  try {
    const data = await httpsGet(url);
    return (data.models || []);
  } catch (error) {
    console.warn(`  [${apiVersion}] ${error.message}`);
    return [];
  }
}

// ============================================================================
// Display helpers
// ============================================================================

function formatModel(model, configuredModels) {
  const name = model.name || '';               // e.g. "models/gemini-1.5-flash"
  const displayName = model.displayName || name;
  const shortName = name.replace(/^models\//, '');
  const methods = (model.supportedGenerationMethods || []);
  const supportsGenerate = methods.includes('generateContent');
  const isConfigured = configuredModels.includes(shortName);

  const tags = [];
  if (supportsGenerate) tags.push('generateContent');
  if (isConfigured) tags.push('IN CONFIG');

  return { shortName, displayName, supportsGenerate, isConfigured, tags, methods };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('=== Gemini Model Fetcher ===\n');

  const apiKey = resolveApiKey();
  if (!apiKey) {
    console.error('ERROR: GEMINI_API_KEY not set in .env');
    console.error('  Add your key to .env: GEMINI_API_KEY=your_key_here');
    process.exit(1);
  }
  console.log(`API key loaded from .env (${apiKey.slice(0, 8)}...)\n`);

  const configuredModels = getGeminiModels();
  console.log('Models currently in src/config.js:');
  configuredModels.forEach((m) => console.log(`  - ${m}`));
  console.log();

  // Fetch from both API versions to get the widest coverage
  console.log('Fetching models from Google Generative AI API...');
  const [v1Models, v1betaModels] = await Promise.all([
    fetchModels(apiKey, 'v1'),
    fetchModels(apiKey, 'v1beta')
  ]);

  // Deduplicate by model name
  const seen = new Set();
  const allModels = [...v1Models, ...v1betaModels].filter((m) => {
    if (seen.has(m.name)) return false;
    seen.add(m.name);
    return true;
  });

  if (allModels.length === 0) {
    console.error('No models returned. Check your API key and internet connection.');
    process.exit(1);
  }

  const formatted = allModels.map((m) => formatModel(m, configuredModels));

  // Split into generateContent-capable vs others
  const generateModels = formatted.filter((m) => m.supportsGenerate);
  const otherModels = formatted.filter((m) => !m.supportsGenerate);

  // ---- generateContent-capable models ----
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Models supporting generateContent (${generateModels.length} found):`);
  console.log('─'.repeat(60));

  for (const m of generateModels) {
    const configured = m.isConfigured ? ' ✓ IN CONFIG' : '';
    console.log(`  ${m.shortName}${configured}`);
    if (m.displayName && m.displayName !== m.shortName) {
      console.log(`    Display name: ${m.displayName}`);
    }
  }

  // ---- other models ----
  if (otherModels.length > 0) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Other models (no generateContent support, ${otherModels.length} found):`);
    console.log('─'.repeat(60));
    for (const m of otherModels) {
      const methods = m.methods.join(', ') || 'none';
      console.log(`  ${m.shortName}  [${methods}]`);
    }
  }

  // ---- config validation ----
  console.log(`\n${'─'.repeat(60)}`);
  console.log('Config validation:');
  console.log('─'.repeat(60));
  const generateModelNames = generateModels.map((m) => m.shortName);
  for (const name of configuredModels) {
    const valid = generateModelNames.includes(name);
    const status = valid ? '  OK' : '  NOT FOUND / UNSUPPORTED';
    console.log(`  ${name}${status}`);
  }

  console.log(`\nTotal models: ${allModels.length} (${generateModels.length} support generateContent)\n`);
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
