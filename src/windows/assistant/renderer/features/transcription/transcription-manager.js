import { getSystemAudioUnsupportedMessage, isSystemAudioUnsupportedError } from '../assembly-ai/system-audio-errors.js';

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
    showFeedback,
    isAutoScrollEnabled = () => true,
    isChatNearBottom = () => true
}) {
    let micAudioContext = null;
    let micMediaStream = null;
    let micScriptProcessor = null;
    let isMicActive = false;

    let systemAudioContext = null;
    let systemMediaStream = null;
    let systemScriptProcessor = null;
    let isSystemActive = false;
    let systemNativeCapture = null;
    let systemStartGeneration = 0;
    // Session correlation: the renderer owns the identity. Each Host start
    // attempt allocates an attempt id SYNCHRONOUSLY, before the first await,
    // and hands it to both start RPCs (backend socket start and native capture
    // start). The main process stamps every event for that attempt with the
    // same id, so an event is live iff event.attemptId ===
    // currentSystemAttemptId — from the very first moment, including events
    // that arrive while their own start RPC response is still in flight.
    // Events without correlation data can only come from paths that are
    // inherently about the live attempt (legacy/untagged callers), so they
    // apply as before. No speculative counting and no post-await id
    // publication: the identity can never be unknown when an event arrives.
    let currentSystemAttemptId = null;
    let systemAttemptCounter = 0;

    function allocateSystemAttemptId() {
        systemAttemptCounter += 1;
        const uuid = globalThis.crypto?.randomUUID?.();
        return uuid ? `system-${uuid}` : `system-${Date.now().toString(36)}-${systemAttemptCounter}`;
    }

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

    // Is this backend/native event obsolete — emitted by an attempt that is
    // not the live one? Correlation data that is present is checked against
    // the renderer-owned attempt id; absent data means the event is inherently
    // about the live attempt.
    function isStaleSystemEvent(data) {
        if (!data || typeof data !== 'object') return false;
        const eventAttemptId = typeof data.attemptId === 'string' && data.attemptId ? data.attemptId : null;
        if (!eventAttemptId) return false;
        return eventAttemptId !== currentSystemAttemptId;
    }

    // Releases everything the Host source owns: renderer stream/context (non-Linux)
    // and the main-process pw-record capture (Linux). Safe to call repeatedly.
    // attemptId scopes the pending-start cancel so it can never kill a newer
    // attempt's capture (a token-less cancel is only the legacy fallback).
    function releaseSystemResources({ cancelPendingStart = false, attemptId = null } = {}) {
        stopAudioResources(systemAudioContext, systemMediaStream, systemScriptProcessor);
        systemAudioContext = null;
        systemMediaStream = null;
        systemScriptProcessor = null;
        const nativeCapture = systemNativeCapture;
        systemNativeCapture = null;
        // No handle yet means a Linux start may still be pending in the main
        // process; an attempt-scoped stop cancels it there (the attempt's own
        // generation check then drops any handle that arrives late).
        const cancelPending =
            cancelPendingStart && !nativeCapture && window.electronAPI?.platform === 'linux'
                ? () => window.electronAPI.stopLinuxMonitorCapture?.(attemptId ?? undefined)
                : null;
        const stopNative = nativeCapture ? () => nativeCapture.stop() : cancelPending;
        return stopNative
            ? Promise.resolve().then(stopNative).catch((error) => {
                addMonitorLog('error', 'stop-failed', error?.message || 'Failed to stop host capture', 'system');
            })
            : Promise.resolve();
    }

    async function startSystemAudioRecording() {
        if (isSystemActive || sourceStatuses.system === 'connecting') return;

        // Every await below can outlive a Stop (or a Stop + new Start). The
        // generation tells this attempt whether it is still the live one; the
        // attempt's own resources stay local until it is verified current, so a
        // late result is released immediately and can never activate the session
        // or touch a newer session's resources.
        systemStartGeneration += 1;
        const generation = systemStartGeneration;
        const isCurrent = () => generation === systemStartGeneration;
        // The correlation identity is allocated and published BEFORE the first
        // await: every event the main process emits for this attempt carries
        // this id, so a live terminal event is recognised as live even while
        // its own start RPC response is still in flight.
        const attemptId = allocateSystemAttemptId();
        currentSystemAttemptId = attemptId;
        let nativeCapture = null;
        let stream = null;
        let context = null;
        let processor = null;
        const releaseAttemptResources = async () => {
            stopAudioResources(context, stream, processor);
            context = null;
            stream = null;
            processor = null;
            const capture = nativeCapture;
            nativeCapture = null;
            if (capture) {
                try {
                    await capture.stop();
                } catch (_) {}
            }
        };

        setSourceStatus('system', 'connecting', 'Connecting to host audio...');
        addMonitorLog('info', 'start-request', 'Starting host audio source', 'system');
        resetFinalTranscriptBuffer('system');

        try {
            // Platform comes from the preload bridge (process.platform), not
            // a UA guess. On Linux, Chromium has no desktop-audio loopback
            // and a chromeMediaSource:'desktop' request would hold a GNOME
            // screencast session open for the whole transcription while
            // returning no audio, so the main process captures the default
            // output's PipeWire monitor with pw-record instead (audio-only).
            const isLinuxHost = window.electronAPI?.platform === 'linux';
            let sourceId = null;

            if (!isLinuxHost) {
                const sources = await window.electronAPI.getDesktopSources();
                if (!isCurrent()) return;
                if (!sources || sources.length === 0) throw new Error('No desktop sources found');
                sourceId = sources[0].id;
                addMonitorLog('info', 'desktop-source', `Using desktop source: ${sources[0].name || sourceId}`, 'system');
            }

            const result = await window.electronAPI.startVoiceRecognition('system', { attemptId });
            if (!isCurrent()) return;
            if (result && result.error) throw new Error(result.error);
            // A start must never adopt another attempt's backend session: if
            // the main process answered with a different attempt identity,
            // this attempt would be attached to a socket whose events are all
            // tagged with the other id (and therefore ignored as stale). Fail
            // the start instead of activating on the wrong session; the
            // catch below cleans up scoped to this attempt.
            if (result && typeof result.attemptId === 'string' && result.attemptId !== attemptId) {
                throw new Error('Host backend returned a different session identity than requested');
            }

            if (isLinuxHost) {
                nativeCapture = await audioPipeline.startNativeMonitorCapture({ attemptId });
                if (!isCurrent()) {
                    await releaseAttemptResources();
                    return;
                }
            } else {
                stream = await getSystemAudioStream(sourceId);
                if (!isCurrent()) {
                    await releaseAttemptResources();
                    return;
                }

                const videoTrack = stream.getVideoTracks()[0];
                if (videoTrack && isLikelyCameraTrack(videoTrack.label)) {
                    throw new Error(`Desktop capture fell back to camera source (${videoTrack.label || 'unknown'}).`);
                }

                // Only audio is used; stop any video track right away so a
                // desktop-capture session is never held open.
                stream.getVideoTracks().forEach((track) => track.stop());

                context = new AudioContext();
                await context.resume();
                if (!isCurrent()) {
                    await releaseAttemptResources();
                    return;
                }
                resetSourceSampleQueue('system');
                processor = await buildAudioProcessor(context, stream, 'system', () => isSystemActive);
                if (!isCurrent()) {
                    await releaseAttemptResources();
                    return;
                }
            }

            systemNativeCapture = nativeCapture;
            systemMediaStream = stream;
            systemAudioContext = context;
            systemScriptProcessor = processor;

            setSystemActive(true);
            addChatMessage('system', 'Listening to host audio...');
            showFeedback('System audio on', 'success');
            addMonitorLog('info', 'source-active', 'Host source active', 'system');
        } catch (error) {
            await releaseAttemptResources();
            if (!isCurrent()) return;
            console.error('Failed to start system audio:', error);

            // A typed unsupported error means the host source could not be
            // captured (Linux: pw-record/PipeWire unavailable). Say so
            // explicitly and never leave the source looking like it is listening.
            const unsupportedMessage = isSystemAudioUnsupportedError(error)
                ? getSystemAudioUnsupportedMessage(window.navigator?.userAgent)
                : null;

            if (unsupportedMessage) {
                const detail = typeof error.cause === 'string' && error.cause ? ` (${error.cause})` : '';
                addChatMessage('system', unsupportedMessage);
                showFeedback(unsupportedMessage, 'error');
                addMonitorLog('error', 'system-audio-unsupported', `${unsupportedMessage}${detail}`, 'system');
            } else {
                showFeedback(`System audio failed: ${error.message}`, 'error');
                addMonitorLog('error', 'source-failed', error.message, 'system');
            }

            setSystemActive(false);
            resetSourceSampleQueue('system');
            setSourceStatus('system', 'error', unsupportedMessage || `Host error: ${error.message}`);
            // The failed attempt is over: clear its identity BEFORE the
            // cleanup stop RPC so every later event carrying its id is stale
            // by construction. The scoped stop kills only this attempt's
            // backend session, never a newer attempt's.
            currentSystemAttemptId = null;
            try {
                await window.electronAPI.stopVoiceRecognition('system', { attemptId });
            } catch (_) {}
        }

        updateTranscriptionUI();
    }

    async function stopSystemAudioRecording() {
        // Invalidate any start still awaiting a step, even if nothing is active yet.
        systemStartGeneration += 1;
        if (!isSystemActive && sourceStatuses.system !== 'connecting') return;
        // Clear the attempt identity synchronously, BEFORE awaiting anything:
        // every event the stopped attempt still emits afterwards is stale by
        // construction and cannot cancel or tear down a newer attempt. The
        // stop RPC and the pending-start cancel are scoped to this attempt id,
        // so they kill only this attempt's resources.
        const stoppedAttemptId = currentSystemAttemptId;
        currentSystemAttemptId = null;
        drainSourceSampleQueue('system', { flushPartial: true });
        flushFinalTranscript('system', 'stop-request');
        const releasing = releaseSystemResources({ cancelPendingStart: true, attemptId: stoppedAttemptId });
        if (systemPartialDiv) {
            systemPartialDiv.remove();
            systemPartialDiv = null;
        }
        systemPartialText = '';
        try {
            await window.electronAPI.stopVoiceRecognition('system', { attemptId: stoppedAttemptId ?? undefined });
        } catch (error) {
            addMonitorLog('error', 'stop-failed', error.message || 'Failed to stop host source', 'system');
        }
        await releasing;
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
        if (isAutoScrollEnabled() && isChatNearBottom()) {
            chatMessagesElement.scrollTop = chatMessagesElement.scrollHeight;
        }
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
        if (source === 'system' && isStaleSystemEvent(data)) {
            // A superseded session's status must not rewrite the live badge.
            return;
        }
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
        if (source === 'system' && isStaleSystemEvent(data)) {
            // Obsolete event of a superseded session or capture, not the live
            // session: it must not tear anything down.
            addMonitorLog('info', 'stale-event-ignored', `Ignored a stale backend error from a previous session: ${error}`, source);
            return;
        }
        console.error(`STT error [${source}]:`, error);
        showFeedback(`Error (${sourceLabel(source)}): ${error}`, 'error');
        addChatMessage('system', `Transcription error (${sourceLabel(source)}): ${error}`);
        addMonitorLog('error', 'status-error', error, source);
        flushFinalTranscript(source, 'status-error');

        if (source === 'system') {
            // The live attempt ended: invalidate any start still awaiting a
            // step so a late capture is released at once and can never
            // reactivate the session, clear the attempt identity so any
            // further event carrying its id is stale, and cancel a pending
            // main-process start scoped to this attempt.
            systemStartGeneration += 1;
            const endedAttemptId = currentSystemAttemptId;
            currentSystemAttemptId = null;
            releaseSystemResources({ cancelPendingStart: true, attemptId: endedAttemptId });
            // End the BACKEND session owned by this attempt too, exactly as a
            // user Stop would: when this event is a native capture death the
            // backend socket is still streaming, and leaving it would orphan
            // the session (a restart would find it and could adopt its
            // identity). Scoped to the ended attempt, so it can never kill a
            // newer attempt's session; its stop acknowledgement is tagged
            // with the ended id and is stale by construction. For a backend
            // terminal event the session is already gone and this is a no-op.
            try {
                Promise.resolve(
                    window.electronAPI.stopVoiceRecognition?.('system', { attemptId: endedAttemptId ?? undefined })
                ).catch((stopError) => {
                    addMonitorLog('error', 'stop-failed', stopError?.message || 'Failed to stop host backend', 'system');
                });
            } catch (_) {}
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
        if (source === 'system' && isStaleSystemEvent(data)) {
            // The acknowledgment of a superseded session's stop; it must not
            // tear down the session that is live now.
            addMonitorLog('info', 'stale-event-ignored', 'Ignored a stale stop acknowledgment from a previous session', source);
            return;
        }
        console.log(`STT stopped [${source}]`);
        flushFinalTranscript(source, 'stopped-event');
        if (source === 'system') {
            // Same contract as handleVoskError: cancel a pending start and
            // release anything that arrives late, all scoped to this attempt.
            systemStartGeneration += 1;
            const endedAttemptId = currentSystemAttemptId;
            currentSystemAttemptId = null;
            releaseSystemResources({ cancelPendingStart: true, attemptId: endedAttemptId });
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
