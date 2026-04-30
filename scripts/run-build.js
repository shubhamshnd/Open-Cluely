'use strict';

// Build launcher. electron-builder spawns helpers that misbehave when
// ELECTRON_RUN_AS_NODE is inherited from the shell, so we strip it here too.
// Detects the current platform and picks a sensible default target.

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const platformArgs = (() => {
  switch (os.platform()) {
    case 'win32':  return ['--win', 'portable'];
    case 'darwin': return ['--mac'];
    case 'linux':  return ['--linux'];
    default:       return [];
  }
})();

const args = [...platformArgs, ...process.argv.slice(2)];
const builderBin = path.join(
  __dirname,
  '..',
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder'
);

const child = spawn(builderBin, args, { stdio: 'inherit', env, shell: false });

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on('error', (err) => {
  console.error('[run-build] Failed to spawn electron-builder:', err.message);
  process.exit(1);
});
