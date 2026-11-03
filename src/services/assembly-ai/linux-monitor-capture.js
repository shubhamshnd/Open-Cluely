'use strict';

// Linux-only Host audio. Chromium cannot loopback desktop audio on Linux and
// Electron does not expose PipeWire sink monitors as audio inputs, so the main
// process runs the installed `pw-record` with `stream.capture.sink=true`. That
// property makes PipeWire link the stream to the monitor of the *default
// playback sink* (it follows default-sink changes) without touching the default
// microphone/output, persistent routing, or any other app's stream. It is
// audio-only: no xdg-desktop-portal screencast session and no video.
//
// Ownership: at most one capture child at a time. Every start() supersedes any
// previous (pending or running) capture, stop() kills the child and waits for
// it to exit (SIGTERM, then SIGKILL after killGraceMs), dispose() is the
// synchronous quit-time kill. Output is raw s16le 16 kHz mono PCM, re-framed
// into 100 ms chunks, which is what the AssemblyAI service already expects.

const { spawn } = require('node:child_process');
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

    entry.closedPromise = new Promise((resolve) => {
      if (entry.exited) {
        resolve();
        return;
      }
      entry.resolveClosed = resolve;
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

  function markExited(entry) {
    entry.exited = true;
    clearTimeout(entry.killTimer);
    clearTimeout(entry.startTimer);
    entry.resolveClosed?.();
  }

  function start({ onChunk, onEnded } = {}) {
    if (platform !== 'linux') {
      return Promise.resolve({ success: false, error: 'Native monitor capture is only available on Linux' });
    }

    const previous = current;
    current = null;
    startGeneration += 1;
    const generation = startGeneration;

    return (async () => {
      if (previous) {
        await terminate(previous);
      }
      // A stop()/newer start() that arrived while the previous child was
      // still exiting cancels this start before anything is spawned.
      if (generation !== startGeneration) {
        return { success: false, error: 'Host audio capture was canceled' };
      }

      const entry = {
        token: crypto.randomUUID(),
        child: null,
        buffer: Buffer.alloc(0),
        stderr: '',
        running: false,
        terminating: false,
        exited: false
      };
      current = entry;

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
          child = spawnFn('pw-record', PW_RECORD_ARGS.slice(), { stdio: ['ignore', 'pipe', 'pipe'] });
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
    })();
  }

  // stop({ token }) only stops the capture owning that token (a stale session
  // cannot kill a newer one). stop({}) stops whatever is current, including a
  // start that has not produced audio yet.
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

  function dispose() {
    startGeneration += 1;
    terminate(current);
  }

  return { start, stop, dispose };
}

module.exports = { createLinuxMonitorCapture, PW_RECORD_ARGS, FRAME_BYTES };
