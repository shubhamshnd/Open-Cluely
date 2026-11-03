'use strict';

// Linux-only Host audio. Chromium cannot loopback desktop audio on Linux and
// Electron does not expose PipeWire sink monitors as audio inputs, so the main
// process runs the installed `pw-record` with `stream.capture.sink=true`. That
// property makes PipeWire link the stream to the monitor of the *default
// playback sink* as resolved when the stream connects (whether PipeWire
// re-links the stream if the default sink changes mid-capture is unverified),
// without touching the default microphone/output, persistent routing, or any
// other app's stream. It is audio-only: no xdg-desktop-portal screencast
// session and no video.
//
// Ownership: at most one live capture child at any moment. start() takes
// ownership synchronously and supersedes any previous capture; a replacement
// spawns only after every terminating predecessor actually exited (SIGTERM,
// escalated to SIGKILL after killGraceMs). A child that was signaled but has
// not exited yet stays owned (in `terminating`) so stop()/dispose() always
// cover it. stop({token}) kills only the capture owning that token; stop({})
// kills whatever is current — including a start still queued behind its
// predecessor — and cancels it before anything spawns. dispose() is quit-time
// hard cleanup: it kills everything owned and resolves only once every child
// really exited, so quit can wait for it instead of exiting under a child
// that ignored SIGTERM. Output is raw s16le 16 kHz mono PCM, re-framed into
// 100 ms chunks, which is what the AssemblyAI service already expects.
//
// Identity: the caller may pass its own `token` (the renderer passes its
// Host-start attempt id, so every event for this capture is correlatable from
// the first moment, before any RPC resolves); without one a random UUID is
// generated. Either way stop({token}) authorizes against the same value.

const { spawn } = require('node:child_process');
const { scrubSecretEnvVars } = require('../../main-process/shared/child-process-env');
const crypto = require('node:crypto');

const PW_RECORD_ARGS = Object.freeze([
  '-P',
  '{ stream.capture.sink=true }',
  '--raw',
  '--rate',
  '16000',
  '--channels',
  '1',
  '--format',
  's16',
  '-'
]);
const FRAME_BYTES = 3200; // 100 ms of s16 mono @ 16 kHz
const MAX_STDERR_CHARS = 400;

function createLinuxMonitorCapture({
  spawnFn = spawn,
  platform = process.platform,
  startupTimeoutMs = 5000,
  killGraceMs = 1500
} = {}) {
  let current = null;
  let startGeneration = 0;
  const terminating = new Set(); // signaled children that have not exited yet

  function markExited(entry) {
    entry.exited = true;
    clearTimeout(entry.killTimer);
    clearTimeout(entry.startTimer);
    terminating.delete(entry);
    entry.resolveClosed?.();
  }

  function terminate(entry) {
    if (!entry) {
      return Promise.resolve();
    }
    if (current === entry) {
      current = null;
    }
    if (entry.closedPromise) {
      return entry.closedPromise;
    }
    entry.terminating = true;
    clearTimeout(entry.startTimer);
    entry.settle?.({ success: false, error: 'Host audio capture was canceled' });
    terminating.add(entry);
    entry.closedPromise = new Promise((resolve) => {
      entry.resolveClosed = resolve;
      if (entry.exited || !entry.child) {
        // Never spawned (canceled while queued behind a predecessor).
        markExited(entry);
        return;
      }
      entry.killTimer = setTimeout(() => {
        try {
          entry.child.kill('SIGKILL');
        } catch (_) {
          // already gone
        }
      }, killGraceMs);
      entry.killTimer.unref?.();
      try {
        entry.child.kill('SIGTERM');
      } catch (_) {
        // already gone
      }
    });
    return entry.closedPromise;
  }

  function spawnAndSettle(entry, { onChunk, onEnded }) {
    return new Promise((resolve) => {
      let settled = false;
      entry.settle = (result) => {
        if (settled) {
          return;
        }
        settled = true;
        entry.settle = null;
        clearTimeout(entry.startTimer);
        resolve(result);
      };

      const fail = (message) => {
        entry.settle({ success: false, error: message });
        terminate(entry);
      };

      let child;
      try {
        // pw-record must not inherit API keys through process.env.
        child = spawnFn('pw-record', PW_RECORD_ARGS.slice(), {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: scrubSecretEnvVars(process.env)
        });
      } catch (error) {
        fail(`Failed to start pw-record: ${error.message}`);
        return;
      }
      entry.child = child;

      entry.startTimer = setTimeout(
        () => fail('Host audio capture timed out waiting for audio from PipeWire'),
        startupTimeoutMs
      );
      entry.startTimer.unref?.();

      child.stderr?.on('data', (data) => {
        entry.stderr = (entry.stderr + String(data)).slice(-MAX_STDERR_CHARS);
      });

      child.stdout?.on('data', (data) => {
        if (entry.terminating) {
          return;
        }
        entry.buffer = Buffer.concat([entry.buffer, data]);
        while (entry.buffer.length >= FRAME_BYTES) {
          const frame = entry.buffer.subarray(0, FRAME_BYTES);
          entry.buffer = entry.buffer.subarray(FRAME_BYTES);
          if (!entry.running) {
            entry.running = true;
            entry.settle({ success: true, token: entry.token });
          }
          try {
            onChunk?.(Buffer.from(frame));
          } catch (_) {
            // a consumer error must not kill the capture
          }
        }
      });

      child.on('error', (error) => {
        if (child.pid === undefined) {
          markExited(entry);
        }
        fail(`pw-record failed: ${error.message}`);
      });

      child.on('close', (code, signal) => {
        const wasRunning = entry.running;
        const wasTerminating = entry.terminating;
        markExited(entry);
        if (current === entry) {
          current = null;
        }
        if (!wasRunning) {
          entry.settle?.({
            success: false,
            error: `pw-record exited (code ${code}) before producing audio${
              entry.stderr ? `: ${entry.stderr.trim()}` : ''
            }`
          });
        } else if (!wasTerminating) {
          try {
            onEnded?.({ code, signal });
          } catch (_) {
            // ignore
          }
        }
      });
    });
  }

  function start({ onChunk, onEnded, token: callerToken } = {}) {
    if (platform !== 'linux') {
      return Promise.resolve({ success: false, error: 'Native monitor capture is only available on Linux' });
    }

    // Ownership is taken synchronously so a stop/start in the same tick sees
    // this attempt; the previous capture is superseded.
    const previous = current;
    startGeneration += 1;
    const generation = startGeneration;

    const entry = {
      token: typeof callerToken === 'string' && callerToken ? callerToken : crypto.randomUUID(),
      child: null,
      buffer: Buffer.alloc(0),
      stderr: '',
      running: false,
      terminating: false,
      exited: false,
      closedPromise: null,
      resolveClosed: null,
      settle: null,
      startTimer: null,
      killTimer: null
    };
    current = entry;

    return (async () => {
      const waits = [];
      if (previous) {
        waits.push(terminate(previous));
      }
      for (const other of terminating) {
        if (other !== entry && other.closedPromise) {
          waits.push(other.closedPromise);
        }
      }
      if (waits.length > 0) {
        // At most one live child: spawn only after every predecessor exited.
        // A Stop or newer start landing while we wait cancels this attempt.
        await Promise.all(waits);
        if (generation !== startGeneration || entry.terminating) {
          await terminate(entry);
          return { success: false, error: 'Host audio capture was canceled' };
        }
      }
      return spawnAndSettle(entry, { onChunk, onEnded });
    })();
  }

  // stop({ token }) only stops the capture owning that token (a stale session
  // cannot kill a newer one). stop({}) stops whatever is current, including a
  // start that has not produced audio or spawned yet.
  async function stop({ token } = {}) {
    const entry = current;
    if (token === undefined || token === null) {
      startGeneration += 1; // also cancels a start still awaiting its predecessor
    }
    if (!entry || (token !== undefined && token !== null && token !== entry.token)) {
      return { stopped: false };
    }
    await terminate(entry);
    return { stopped: true };
  }

  // Quit-time hard cleanup: kills everything owned and resolves once every
  // child (including one still terminating) actually exited.
  function dispose() {
    startGeneration += 1;
    terminate(current);
    const waits = [...terminating].map((entry) => entry.closedPromise).filter(Boolean);
    return Promise.all(waits).then(() => {});
  }

  return { start, stop, dispose };
}

module.exports = { createLinuxMonitorCapture, PW_RECORD_ARGS, FRAME_BYTES };
