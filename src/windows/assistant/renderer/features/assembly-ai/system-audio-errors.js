// Typed error shared by the audio pipeline (which throws it when host/
// loopback audio cannot be captured) and the transcription manager (which
// turns it into a clear, actionable message instead of a raw getUserMedia
// failure). On Linux the host source captures the PipeWire/PulseAudio
// "Monitor of <output>" input, so the only unsupported case left there is
// a missing monitor device.

export const SYSTEM_AUDIO_UNSUPPORTED = 'SYSTEM_AUDIO_UNSUPPORTED';

export const NO_MONITOR_DEVICE_MESSAGE =
  "No 'Monitor of …' audio device found. Make sure PipeWire/PulseAudio is running (pipewire-pulse), or pick the monitor device as your microphone.";
const LINUX_UNSUPPORTED_MESSAGE = NO_MONITOR_DEVICE_MESSAGE;
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
