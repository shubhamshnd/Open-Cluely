// Decides whether a transcription start may proceed, given the active
// speech-to-text provider and which credentials are configured.
//
// AssemblyAI needs its API key up front, so a missing key blocks the start
// with a direct Settings hint. Amazon Transcribe has no single local key to
// check (default chain, named profile, or access keys may all work), so the
// start is always allowed and any credential problem surfaces through the
// normal transcription error path from the backend.

export const STT_PROVIDER_ASSEMBLYAI = 'assemblyai';
export const STT_PROVIDER_TRANSCRIBE = 'transcribe';

export const ASSEMBLYAI_KEY_MISSING_MESSAGE = 'AssemblyAI API key missing. Add it in Settings.';

export function normalizeSttProvider(value) {
    return value === STT_PROVIDER_TRANSCRIBE ? STT_PROVIDER_TRANSCRIBE : STT_PROVIDER_ASSEMBLYAI;
}

export function canStartTranscription({ sttProvider, hasAssemblyAiApiKey } = {}) {
    if (normalizeSttProvider(sttProvider) === STT_PROVIDER_ASSEMBLYAI && !hasAssemblyAiApiKey) {
        return { allowed: false, reason: 'assemblyai-key-missing', message: ASSEMBLYAI_KEY_MISSING_MESSAGE };
    }
    return { allowed: true };
}
