const MAX_MONITOR_LOG_ENTRIES = 80;

export function createTranscriptionManager({
    transcriptionSourceState,
    normalizeSourceRule,
    sourceLabelRule,
    audioPipeline,
    transcriptBufferManager,
    chatMessagesElement,
    transcriptionToggle,
    sourceSystemToggle,
    sourceMicToggle,
    monitorMasterState,
    monitorStatusSystem,
    monitorStatusMic,
    monitorLiveSystem,
    monitorLiveMic,
    monitorLogList,
    addChatMessage,
    showFeedback
}) {
    let micAudioContext = null;
    let micMediaStream = null;
    let micScriptProcessor = null;
    let isMicActive = false;

    let systemAudioContext = null;
    let systemMediaStream = null;
    let systemScriptProcessor = null;
    let isSystemActive = false;

    let micPartialText = '';
    let micPartialDiv = null;
    let systemPartialText = '';
    let systemPartialDiv = null;

    const selectedSources = transcriptionSourceState.selectedSources;
    const sourceStatuses = transcriptionSourceState.sourceStatuses;
    const monitorLogEntries = [];
    const monitorLastText = {
        system: 'No transcript yet',
        mic: 'No transcript yet'
    };

    function normalizeSource(source) {
        return normalizeSourceRule(source);
    }

    function sourceLabel(source) {
        return sourceLabelRule(normalizeSource(source));
    }

    function isSourceActive(source) {
        return source === 'system' ? isSystemActive : isMicActive;
    }

    function setMicActive(active) {
        isMicActive = !!active;
        transcriptionSourceState.setSourceActive('mic', isMicActive);
    }

    function setSystemActive(active) {
        isSystemActive = !!active;
        transcriptionSourceState.setSourceActive('system', isSystemActive);
    }

    function isAnyTranscriptionActive() {
        return isSystemActive || isMicActive;
    }

    function isAnySourceConnecting() {
        return transcriptionSourceState.isAnySourceConnecting();
    }

    function setSourceStatus(source, status, liveText) {
        const resolvedSource = normalizeSource(source);
        transcriptionSourceState.setSourceStatus(resolvedSource, status);

        if (typeof liveText === 'string' && liveText.trim().length > 0) {
            monitorLastText[resolvedSource] = liveText.trim();
        }

        renderMonitorState();
    }

    function updateTranscriptionUI() {
        const anyActive = isAnyTranscriptionActive();
        const anyConnecting = !anyActive && isAnySourceConnecting();

        if (transcriptionToggle) {
            transcriptionToggle.classList.toggle('active', anyActive);
            transcriptionToggle.classList.toggle('listening', anyActive);
            transcriptionToggle.classList.toggle('connecting', anyConnecting);
        }

        if (sourceSystemToggle) {
            sourceSystemToggle.classList.toggle('selected', selectedSources.system);
            sourceSystemToggle.classList.toggle('running', isSystemActive);
        }

        if (sourceMicToggle) {
            sourceMicToggle.classList.toggle('selected', selectedSources.mic);
            sourceMicToggle.classList.toggle('running', isMicActive);
        }
    }

    function renderMonitorState() {
        updateTranscriptionUI();

        const statusMap = {
            off: 'Off',
            connecting: 'Connecting',
            listening: 'Listening',
            error: 'Error'
        };

        if (monitorStatusSystem) {
            monitorStatusSystem.className = `monitor-status-badge ${sourceStatuses.system}`;
            monitorStatusSystem.textContent = statusMap[sourceStatuses.system] || 'Off';
        }

        if (monitorStatusMic) {
            monitorStatusMic.className = `monitor-status-badge ${sourceStatuses.mic}`;
            monitorStatusMic.textContent = statusMap[sourceStatuses.mic] || 'Off';
        }

        if (monitorLiveSystem) {
            monitorLiveSystem.textContent = monitorLastText.system || 'No transcript yet';
        }

        if (monitorLiveMic) {
            monitorLiveMic.textContent = monitorLastText.mic || 'No transcript yet';
        }

        if (monitorMasterState) {
            monitorMasterState.classList.remove('active', 'connecting');
            if (isAnyTranscriptionActive()) {
                monitorMasterState.textContent = 'Running';
                monitorMasterState.classList.add('active');
            } else if (isAnySourceConnecting()) {
                monitorMasterState.textContent = 'Connecting';
                monitorMasterState.classList.add('connecting');
            } else {
                monitorMasterState.textContent = 'Idle';
            }
        }
    }

    function formatMonitorTime(timestamp = Date.now()) {
        return new Date(timestamp).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }

    function safeJson(value) {
        try {
            return JSON.stringify(value);
        } catch (_) {
            return '';
        }
    }

    function addMonitorLog(level, event, message, source = null, meta = null, timestamp = Date.now()) {
        const entry = {
            level: level || 'info',
            event: event || 'event',
            message: message || '',
            source: source ? normalizeSource(source) : null,
            meta,
            timestamp
        };

        monitorLogEntries.push(entry);
        if (monitorLogEntries.length > MAX_MONITOR_LOG_ENTRIES) {
            monitorLogEntries.shift();
        }

        if (!monitorLogList) {
            return;
        }

        monitorLogList.innerHTML = '';
        const entriesToRender = [...monitorLogEntries].reverse();
        for (const item of entriesToRender) {
            const row = document.createElement('div');
            row.className = `monitor-log-entry ${item.level === 'error' ? 'error' : ''}`.trim();

            const sourcePrefix = item.source ? `${sourceLabel(item.source)} ` : '';
            const metaText = item.meta ? ` ${safeJson(item.meta)}` : '';
            row.textContent = `${formatMonitorTime(item.timestamp)} ${sourcePrefix}${item.event}: ${item.message}${metaText}`;
            monitorLogList.appendChild(row);
        }
    }

    function resetFinalTranscriptBuffer(source) {
        transcriptBufferManager.resetFinalTranscriptBuffer(source);
    }

    function flushFinalTranscript(source, reason = 'pause-timeout') {
        transcriptBufferManager.flushFinalTranscript(source, reason);
    }

    function queueFinalTranscript(source, text) {
        transcriptBufferManager.queueFinalTranscript(source, text);
    }

    function flushAllFinalTranscripts(reason = 'flush-all') {
        transcriptBufferManager.flushAllFinalTranscripts(reason);
    }

    function setSourceSelected(source, enabled) {
        const resolvedSource = normalizeSource(source);
        transcriptionSourceState.setSourceSelected(resolvedSource, enabled);
        addMonitorLog('info', 'source-toggle', `${sourceLabel(resolvedSource)} ${enabled ? 'enabled' : 'disabled'}`, resolvedSource);
        updateTranscriptionUI();

        if (isAnyTranscriptionActive() || sourceStatuses[resolvedSource] === 'connecting') {
            ensureSourceRunning(resolvedSource, !!enabled).catch((error) => {
                console.error(`Failed to apply live source toggle for ${resolvedSource}:`, error);
                addMonitorLog('error', 'source-toggle-failed', error.message, resolvedSource);
            });
        }
    }

    async function ensureSourceRunning(source, shouldRun) {
        const resolvedSource = normalizeSource(source);
        if (shouldRun) {
            if (resolvedSource === 'system') {
                await startSystemAudioRecording();
            } else {
                await startMicRecording();
            }
        } else if (resolvedSource === 'system') {
            await stopSystemAudioRecording();
        } else {
            await stopMicRecording();
        }
    }

    async function startSelectedSources() {
        if (!selectedSources.system && !selectedSources.mic) {
            const message = 'Select at least one source (Host or Mic) before starting transcription.';
            showFeedback(message, 'error');
            addMonitorLog('error', 'start-blocked', message);
            return;
        }

        addMonitorLog('info', 'master-start', 'Starting selected transcription sources');

        if (selectedSources.system) {
            await ensureSourceRunning('system', true);
        }

        if (selectedSources.mic) {
            await ensureSourceRunning('mic', true);
        }
    }

    async function stopAllSources() {
        addMonitorLog('info', 'master-stop', 'Stopping all active transcription sources');
        if (isSystemActive || sourceStatuses.system === 'connecting') {
            await stopSystemAudioRecording();
        }
        if (isMicActive || sourceStatuses.mic === 'connecting') {
            await stopMicRecording();
        }
    }

    async function toggleMasterTranscription() {
        if (isAnyTranscriptionActive() || isAnySourceConnecting()) {
            await stopAllSources();
        } else {
            await startSelectedSources();
        }
        updateTranscriptionUI();
    }

    function isLikelyCameraTrack(trackLabel) {
        return audioPipeline.isLikelyCameraTrack(trackLabel);
    }

    async function getSystemAudioStream(sourceId) {
        return audioPipeline.getSystemAudioStream(sourceId);
    }

    function resetSourceSampleQueue(source) {
        audioPipeline.resetSourceSampleQueue(source);
    }

    function drainSourceSampleQueue(source, { flushPartial = false } = {}) {
        audioPipeline.drainSourceSampleQueue(source, { flushPartial });
    }

    async function buildAudioProcessor(context, stream, source, activeCheck) {
        return audioPipeline.buildAudioProcessor(context, stream, source, activeCheck);
    }

    function stopAudioResources(ctx, stream, processor) {
        audioPipeline.stopAudioResources(ctx, stream, processor);
    }

    async function startMicRecording() {
        if (isMicActive || sourceStatuses.mic === 'connecting') return;
        setSourceStatus('mic', 'connecting', 'Connecting to mic...');
        addMonitorLog('info', 'start-request', 'Starting mic source', 'mic');
        resetFinalTranscriptBuffer('mic');

        try {
            const result = await window.electronAPI.startVoiceRecognition('mic');
            if (result && result.error) throw new Error(result.error);

            micMediaStream = await navigator.mediaDevices.getUserMedia({
                audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
            });
            micAudioContext = new AudioContext();
            await micAudioContext.resume();
            resetSourceSampleQueue('mic');
            micScriptProcessor = await buildAudioProcessor(micAudioContext, micMediaStream, 'mic', () => isMicActive);

            setMicActive(true);
            addChatMessage('system', 'Mic listening...');
            showFeedback('Mic on', 'success');
            addMonitorLog('info', 'source-active', 'Mic source active', 'mic');
        } catch (error) {
            console.error('Failed to start mic:', error);
            showFeedback(`Mic failed: ${error.message}`, 'error');
            addMonitorLog('error', 'source-failed', error.message, 'mic');
            stopAudioResources(micAudioContext, micMediaStream, micScriptProcessor);
            micAudioContext = null;
            micMediaStream = null;
            micScriptProcessor = null;
            setMicActive(false);
            resetSourceSampleQueue('mic');
            setSourceStatus('mic', 'error', `Mic error: ${error.message}`);
            try {
                await window.electronAPI.stopVoiceRecognition('mic');
            } catch (_) {}
        }

        updateTranscriptionUI();
    }

    async function stopMicRecording() {
        if (!isMicActive && sourceStatuses.mic !== 'connecting') return;
        drainSourceSampleQueue('mic', { flushPartial: true });
        flushFinalTranscript('mic', 'stop-request');
        stopAudioResources(micAudioContext, micMediaStream, micScriptProcessor);
        micAudioContext = null;
        micMediaStream = null;
        micScriptProcessor = null;
        if (micPartialDiv) {
            micPartialDiv.remove();
            micPartialDiv = null;
        }
        micPartialText = '';
        try {
            await window.electronAPI.stopVoiceRecognition('mic');
        } catch (error) {
            addMonitorLog('error', 'stop-failed', error.message || 'Failed to stop mic source', 'mic');
        }
        setMicActive(false);
        resetSourceSampleQueue('mic');
        audioPipeline.resetChunkCounter('mic');
        setSourceStatus('mic', 'off', 'Mic stopped');
        addMonitorLog('info', 'source-stopped', 'Mic source stopped', 'mic');
        showFeedback('Mic off', 'info');
    }

    async function startSystemAudioRecording() {
        if (isSystemActive || sourceStatuses.system === 'connecting') return;
        setSourceStatus('system', 'connecting', 'Connecting to host audio...');
        addMonitorLog('info', 'start-request', 'Starting host audio source', 'system');
        resetFinalTranscriptBuffer('system');

        try {
            const sources = await window.electronAPI.getDesktopSources();
            if (!sources || sources.length === 0) throw new Error('No desktop sources found');
            const sourceId = sources[0].id;
            addMonitorLog('info', 'desktop-source', `Using desktop source: ${sources[0].name || sourceId}`, 'system');

            const result = await window.electronAPI.startVoiceRecognition('system');
            if (result && result.error) throw new Error(result.error);

            systemMediaStream = await getSystemAudioStream(sourceId);

            const videoTrack = systemMediaStream.getVideoTracks()[0];
            if (videoTrack && isLikelyCameraTrack(videoTrack.label)) {
                throw new Error(`Desktop capture fell back to camera source (${videoTrack.label || 'unknown'}).`);
            }

            systemMediaStream.getVideoTracks().forEach((track) => track.stop());

            systemAudioContext = new AudioContext();
            await systemAudioContext.resume();
            resetSourceSampleQueue('system');
            systemScriptProcessor = await buildAudioProcessor(systemAudioContext, systemMediaStream, 'system', () => isSystemActive);

            setSystemActive(true);
            addChatMessage('system', 'Listening to host audio...');
            showFeedback('System audio on', 'success');
            addMonitorLog('info', 'source-active', 'Host source active', 'system');
        } catch (error) {
            console.error('Failed to start system audio:', error);
            showFeedback(`System audio failed: ${error.message}`, 'error');
            addMonitorLog('error', 'source-failed', error.message, 'system');
            stopAudioResources(systemAudioContext, systemMediaStream, systemScriptProcessor);
            systemAudioContext = null;
            systemMediaStream = null;
            systemScriptProcessor = null;
            setSystemActive(false);
            resetSourceSampleQueue('system');
            setSourceStatus('system', 'error', `Host error: ${error.message}`);
            try {
                await window.electronAPI.stopVoiceRecognition('system');
            } catch (_) {}
        }

        updateTranscriptionUI();
    }

    async function stopSystemAudioRecording() {
        if (!isSystemActive && sourceStatuses.system !== 'connecting') return;
        drainSourceSampleQueue('system', { flushPartial: true });
        flushFinalTranscript('system', 'stop-request');
        stopAudioResources(systemAudioContext, systemMediaStream, systemScriptProcessor);
        systemAudioContext = null;
        systemMediaStream = null;
        systemScriptProcessor = null;
        if (systemPartialDiv) {
            systemPartialDiv.remove();
            systemPartialDiv = null;
        }
        systemPartialText = '';
        try {
            await window.electronAPI.stopVoiceRecognition('system');
        } catch (error) {
            addMonitorLog('error', 'stop-failed', error.message || 'Failed to stop host source', 'system');
        }
        setSystemActive(false);
        resetSourceSampleQueue('system');
        audioPipeline.resetChunkCounter('system');
        setSourceStatus('system', 'off', 'Host source stopped');
        addMonitorLog('info', 'source-stopped', 'Host source stopped', 'system');
        showFeedback('System audio off', 'info');
    }

    function createPartialDiv(icon) {
        const div = document.createElement('div');
        div.className = 'chat-message voice-message partial';
        const ts = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        div.innerHTML = `
        <div class="message-header">
            <span class="message-icon">${icon}</span>
            <span class="message-time">${ts}</span>
            <span class="partial-indicator">Live</span>
        </div>
        <div class="message-content partial-text"></div>
    `;
        return div;
    }

    function handleVoskPartial(data) {
        const source = normalizeSource(data?.source);
        const text = data?.text;
        if (!text || text.trim().length === 0) return;
        if (!isSourceActive(source)) return;

        const trimmed = text.trim();
        const icon = source === 'system' ? '\u{1F50A}' : '\u{1F3A4}';
        monitorLastText[source] = `Live: ${trimmed}`;
        renderMonitorState();

        if (source === 'mic') {
            micPartialText = trimmed;
            if (!micPartialDiv) {
                micPartialDiv = createPartialDiv(icon);
                chatMessagesElement.appendChild(micPartialDiv);
            }
            micPartialDiv.querySelector('.message-content').textContent = trimmed;
        } else {
            systemPartialText = trimmed;
            if (!systemPartialDiv) {
                systemPartialDiv = createPartialDiv(icon);
                chatMessagesElement.appendChild(systemPartialDiv);
            }
            systemPartialDiv.querySelector('.message-content').textContent = trimmed;
        }
        chatMessagesElement.scrollTop = chatMessagesElement.scrollHeight;
    }

    function handleVoskFinal(data) {
        const source = normalizeSource(data?.source);
        const text = data?.text;
        if (!text || text.trim().length === 0) return;

        const finalText = text.trim();
        monitorLastText[source] = `Final: ${finalText}`;
        renderMonitorState();
        addMonitorLog('info', 'final', 'Final transcript received', source, {
            chars: finalText.length
        });

        if (source === 'mic') {
            if (micPartialDiv) {
                micPartialDiv.remove();
                micPartialDiv = null;
            }
            micPartialText = '';
        } else {
            if (systemPartialDiv) {
                systemPartialDiv.remove();
                systemPartialDiv = null;
            }
            systemPartialText = '';
        }
        queueFinalTranscript(source, finalText);
    }

    function handleVoskStatus(data) {
        const source = normalizeSource(data?.source);
        const status = data?.status;
        const message = data?.message || '';
        console.log(`STT status [${source}]:`, status, message);

        if (status === 'loading') {
            setSourceStatus(source, 'connecting', `Connecting (${sourceLabel(source)})...`);
            showFeedback(`Connecting (${sourceLabel(source)})...`, 'info');
            addMonitorLog('info', 'status-loading', message || 'Connection requested', source);
        } else if (status === 'listening') {
            setSourceStatus(source, 'listening', `Listening (${sourceLabel(source)})...`);
            showFeedback(`Listening (${sourceLabel(source)})...`, 'success');
            addMonitorLog('info', 'status-listening', message || 'Source listening', source);
        } else if (status === 'stopped') {
            setSourceStatus(source, 'off', `${sourceLabel(source)} stopped`);
            showFeedback(`Stopped (${sourceLabel(source)})`, 'info');
            addMonitorLog('info', 'status-stopped', message || 'Source stopped', source);
        }
    }

    function handleVoskError(data) {
        const source = normalizeSource(data?.source);
        const error = data?.error || 'Unknown transcription error';
        console.error(`STT error [${source}]:`, error);
        showFeedback(`Error (${sourceLabel(source)}): ${error}`, 'error');
        addChatMessage('system', `Transcription error (${sourceLabel(source)}): ${error}`);
        addMonitorLog('error', 'status-error', error, source);
        flushFinalTranscript(source, 'status-error');

        if (source === 'system') {
            stopAudioResources(systemAudioContext, systemMediaStream, systemScriptProcessor);
            systemAudioContext = null;
            systemMediaStream = null;
            systemScriptProcessor = null;
            if (systemPartialDiv) {
                systemPartialDiv.remove();
                systemPartialDiv = null;
            }
            systemPartialText = '';
            setSystemActive(false);
            resetSourceSampleQueue('system');
            resetFinalTranscriptBuffer('system');
        } else {
            stopAudioResources(micAudioContext, micMediaStream, micScriptProcessor);
            micAudioContext = null;
            micMediaStream = null;
            micScriptProcessor = null;
            if (micPartialDiv) {
                micPartialDiv.remove();
                micPartialDiv = null;
            }
            micPartialText = '';
            setMicActive(false);
            resetSourceSampleQueue('mic');
            resetFinalTranscriptBuffer('mic');
        }

        setSourceStatus(source, 'error', `Error: ${error}`);
        updateTranscriptionUI();
    }

    function handleVoskStopped(data) {
        const source = normalizeSource(data?.source);
        console.log(`STT stopped [${source}]`);
        flushFinalTranscript(source, 'stopped-event');
        if (source === 'system') {
            stopAudioResources(systemAudioContext, systemMediaStream, systemScriptProcessor);
            systemAudioContext = null;
            systemMediaStream = null;
            systemScriptProcessor = null;
            if (systemPartialDiv) {
                systemPartialDiv.remove();
                systemPartialDiv = null;
            }
            systemPartialText = '';
            setSystemActive(false);
            resetSourceSampleQueue('system');
            resetFinalTranscriptBuffer('system');
        } else {
            stopAudioResources(micAudioContext, micMediaStream, micScriptProcessor);
            micAudioContext = null;
            micMediaStream = null;
            micScriptProcessor = null;
            if (micPartialDiv) {
                micPartialDiv.remove();
                micPartialDiv = null;
            }
            micPartialText = '';
            setMicActive(false);
            resetSourceSampleQueue('mic');
            resetFinalTranscriptBuffer('mic');
        }
        setSourceStatus(source, 'off', `${sourceLabel(source)} stopped`);
        addMonitorLog('info', 'stopped-event', 'Stop acknowledged by backend', source);
    }

    return {
        selectedSources,
        sourceStatuses,
        normalizeSource,
        sourceLabel,
        addMonitorLog,
        updateTranscriptionUI,
        renderMonitorState,
        setSourceSelected,
        toggleMasterTranscription,
        flushAllFinalTranscripts,
        handleVoskPartial,
        handleVoskFinal,
        handleVoskStatus,
        handleVoskError,
        handleVoskStopped
    };
}
