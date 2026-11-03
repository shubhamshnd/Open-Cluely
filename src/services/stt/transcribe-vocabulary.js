// ============================================================================
// AMAZON TRANSCRIBE CUSTOM VOCABULARY
// ============================================================================
// Settings "Create / update vocabulary": turns the Custom words textarea into
// a Transcribe custom vocabulary named `open-cluely-<language>` and waits for
// it to become READY (or FAILED, or a 2-minute timeout).
//
// Transcribe phrases cannot contain spaces, so whitespace runs become single
// hyphens ("REST API" -> "REST-API"); the Settings helper text says so.
// Create is attempted first; a ConflictException means the vocabulary already
// exists and switches to Update.
//
// The client, poll interval, timeout and sleep are injectable so tests run
// against a fake client with no network and no real waiting.
// ============================================================================

const {
  TranscribeClient,
  CreateVocabularyCommand,
  UpdateVocabularyCommand,
  GetVocabularyCommand
} = require('@aws-sdk/client-transcribe');
const { resolveTranscribeLanguage } = require('../../config');

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 120000;

function defaultCreateClient(clientConfig) {
  return new TranscribeClient(clientConfig);
}

function vocabularyNameForLanguage(language) {
  return `open-cluely-${resolveTranscribeLanguage(language)}`;
}

// Textarea lines -> Transcribe phrases: trim, drop empties, whitespace runs
// become single hyphens, dedupe.
function phrasesFromText(phrasesText) {
  const seen = new Set();
  const phrases = [];
  for (const line of String(phrasesText || '').split(/\r?\n/)) {
    const phrase = line.trim().replace(/\s+/g, '-');
    if (phrase && !seen.has(phrase)) {
      seen.add(phrase);
      phrases.push(phrase);
    }
  }
  return phrases;
}

// createOrUpdateVocabulary({ client, language, phrasesText, pollIntervalMs,
//   timeoutMs, sleep }) -> { success, vocabularyName, state?, error? }
async function createOrUpdateVocabulary({
  client,
  language,
  phrasesText,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}) {
  if (!client || typeof client.send !== 'function') {
    return { success: false, error: 'No Transcribe client was provided.' };
  }

  const languageCode = resolveTranscribeLanguage(language);
  const vocabularyName = vocabularyNameForLanguage(languageCode);
  const phrases = phrasesFromText(phrasesText);
  if (phrases.length === 0) {
    return { success: false, error: 'Enter at least one custom word or phrase (one per line).' };
  }

  try {
    await client.send(new CreateVocabularyCommand({
      VocabularyName: vocabularyName,
      LanguageCode: languageCode,
      Phrases: phrases
    }));
  } catch (error) {
    if (error?.name !== 'ConflictException') {
      // Includes permission errors (AccessDeniedException): the SDK message
      // names the missing action, which is what the user needs to fix IAM.
      return { success: false, error: error?.message || 'Vocabulary creation failed.' };
    }
    // Already exists: switch to update.
    try {
      await client.send(new UpdateVocabularyCommand({
        VocabularyName: vocabularyName,
        LanguageCode: languageCode,
        Phrases: phrases
      }));
    } catch (updateError) {
      return { success: false, error: updateError?.message || 'Vocabulary update failed.' };
    }
  }

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let state = null;
    try {
      const response = await client.send(new GetVocabularyCommand({ VocabularyName: vocabularyName }));
      state = response?.VocabularyState || null;
      if (state === 'READY') {
        return { success: true, vocabularyName, state };
      }
      if (state === 'FAILED') {
        return {
          success: false,
          vocabularyName,
          state,
          error: `Vocabulary ${vocabularyName} failed: ${response?.FailureReason || 'no reason given by AWS'}`
        };
      }
    } catch (error) {
      return { success: false, vocabularyName, error: error?.message || 'Could not read vocabulary status.' };
    }

    if (Date.now() >= deadline) {
      return {
        success: false,
        vocabularyName,
        state,
        error: `Vocabulary ${vocabularyName} is still ${state || 'pending'} after ${Math.round(timeoutMs / 1000)}s. It may finish later; check the AWS console.`
      };
    }
    await sleep(pollIntervalMs);
  }
}

module.exports = {
  createOrUpdateVocabulary,
  vocabularyNameForLanguage,
  phrasesFromText,
  defaultCreateClient,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_TIMEOUT_MS
};
