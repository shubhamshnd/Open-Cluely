'use strict';

// Launcher that strips ELECTRON_RUN_AS_NODE before spawning the Electron binary.
// Without this, shells that already export ELECTRON_RUN_AS_NODE=1 (some IDE
// terminals do) cause `electron .` to start in pure-Node mode — no window, and
// `require('electron')` returns a path string instead of the Electron API.

const { spawn } = require('child_process');
const electronBinary = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const args = ['.', ...process.argv.slice(2)];
const child = spawn(electronBinary, args, { stdio: 'inherit', env });

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on('error', (err) => {
  console.error('[run-electron] Failed to spawn Electron:', err.message);
  process.exit(1);
});
