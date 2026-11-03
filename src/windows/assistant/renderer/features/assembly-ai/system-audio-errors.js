// Typed error shared by the audio pipeline (which throws it when host/
// loopback audio cannot be captured) and the transcription manager (which
// turns it into a clear, actionable message instead of a raw getUserMedia
// failure). On Linux the host source requires an exposed PipeWire/PulseAudio
// "Monitor of <output>" input. A running audio server alone is not enough:
// Electron may omit monitor inputs from its device list.

export const SYSTEM_AUDIO_UNSUPPORTED = 'SYSTEM_AUDIO_UNSUPPORTED';

export const NO_MONITOR_DEVICE_MESSAGE =
  "No 'Monitor of …' audio device found. Electron may not expose PipeWire/PulseAudio monitor inputs even with pipewire-pulse running. Use the Mic source; Host audio requires an exposed monitor input.";
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
