// Typed error shared by the audio pipeline (which throws it when desktop/
// loopback audio cannot be captured) and the transcription manager (which
// turns it into a clear, actionable message instead of a raw getUserMedia
// failure). Chromium's desktop-audio loopback is Windows-only, so on Linux
// host/system capture is genuinely unsupported, not merely broken.

export const SYSTEM_AUDIO_UNSUPPORTED = 'SYSTEM_AUDIO_UNSUPPORTED';

const LINUX_UNSUPPORTED_MESSAGE =
  "System/host audio capture isn't supported by Chromium on Linux. Use the Mic source, or route desktop audio through a PulseAudio/PipeWire 'Monitor of ...' device selected as your microphone.";
const GENERIC_UNSUPPORTED_MESSAGE =
  'System/host audio capture is unavailable on this platform. Use the Mic source instead.';

export function createSystemAudioUnsupportedError(detail) {
  const error = new Error('System/host audio capture is unavailable on this platform');
  error.code = SYSTEM_AUDIO_UNSUPPORTED;
  if (detail) {
    error.cause = detail;
  }
  return error;
}

export function isSystemAudioUnsupportedError(error) {
  return Boolean(error) && typeof error === 'object' && error.code === SYSTEM_AUDIO_UNSUPPORTED;
}

export function isLinuxUserAgent(userAgent) {
  return /linux/i.test(String(userAgent || ''));
}

export function getSystemAudioUnsupportedMessage(userAgent) {
  const resolvedUserAgent =
    typeof userAgent === 'string'
      ? userAgent
      : typeof navigator !== 'undefined'
        ? navigator.userAgent
        : '';
  return isLinuxUserAgent(resolvedUserAgent)
    ? LINUX_UNSUPPORTED_MESSAGE
    : GENERIC_UNSUPPORTED_MESSAGE;
}
