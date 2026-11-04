// Typed error shared by the audio pipeline (which throws it when host/
// loopback audio cannot be captured) and the transcription manager (which
// turns it into a clear, actionable message instead of a raw getUserMedia
// failure). On Linux the host source is a main-process `pw-record` capture of
// the default sink monitor, so this fires when PipeWire/pw-record is missing
// or fails to deliver audio.

export const SYSTEM_AUDIO_UNSUPPORTED = 'SYSTEM_AUDIO_UNSUPPORTED';

export const LINUX_HOST_AUDIO_UNAVAILABLE_MESSAGE =
  'Host audio on Linux could not start. It needs a running PipeWire session and the pw-record tool (pipewire-bin / pipewire-utils package). Use the Mic source instead.';
const LINUX_UNSUPPORTED_MESSAGE = LINUX_HOST_AUDIO_UNAVAILABLE_MESSAGE;
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
