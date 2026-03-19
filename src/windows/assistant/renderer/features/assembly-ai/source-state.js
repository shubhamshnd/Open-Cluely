export function normalizeSource(source) {
  return source === 'system' ? 'system' : 'mic';
}

export function sourceLabel(source) {
  return source === 'system' ? 'Host' : 'Mic';
}

export function createTranscriptionSourceState() {
  const selectedSources = {
    system: true,
    mic: false
  };

  const sourceStatuses = {
    system: 'off',
    mic: 'off'
  };

  const activeSources = {
    system: false,
    mic: false
  };

  function setSourceSelected(source, enabled) {
    selectedSources[normalizeSource(source)] = !!enabled;
  }

  function isSourceSelected(source) {
    return !!selectedSources[normalizeSource(source)];
  }

  function getSelectedSources() {
    return { ...selectedSources };
  }

  function setSourceStatus(source, status) {
    const resolvedSource = normalizeSource(source);
    const allowedStatuses = new Set(['off', 'connecting', 'listening', 'error']);
    sourceStatuses[resolvedSource] = allowedStatuses.has(status) ? status : 'off';
  }

  function getSourceStatus(source) {
    return sourceStatuses[normalizeSource(source)];
  }

  function getSourceStatuses() {
    return { ...sourceStatuses };
  }

  function setSourceActive(source, active) {
    activeSources[normalizeSource(source)] = !!active;
  }

  function isSourceActive(source) {
    return !!activeSources[normalizeSource(source)];
  }

  function isAnySourceActive() {
    return activeSources.system || activeSources.mic;
  }

  function isAnySourceConnecting() {
    return sourceStatuses.system === 'connecting' || sourceStatuses.mic === 'connecting';
  }

  return {
    selectedSources,
    sourceStatuses,
    getSelectedSources,
    getSourceStatus,
    getSourceStatuses,
    isAnySourceActive,
    isAnySourceConnecting,
    isSourceActive,
    isSourceSelected,
    setSourceActive,
    setSourceSelected,
    setSourceStatus
  };
}
