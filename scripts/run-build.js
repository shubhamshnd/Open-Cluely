'use strict';

// Build launcher. electron-builder spawns helpers that misbehave when
// ELECTRON_RUN_AS_NODE is inherited from the shell, so we strip it here too.
// Detects the current platform and picks a sensible default target.
// Also pre-populates winCodeSign on Windows without macOS symlinks so builds
// succeed without requiring an elevated Administrator prompt or Developer Mode.

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const https = require('https');
const path = require('path');
const os = require('os');

const ROOT_DIR = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT_DIR, '.env');
const ENV_EXAMPLE_PATH = path.join(ROOT_DIR, '.env.example');

// Ensure .env exists because package.json bundles it in extraResources
if (!fs.existsSync(ENV_PATH) && fs.existsSync(ENV_EXAMPLE_PATH)) {
  fs.copyFileSync(ENV_EXAMPLE_PATH, ENV_PATH);
  console.log('[run-build] Created .env from .env.example');
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        response.resume();
        downloadFile(response.headers.location, destPath).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode} downloading ${url}`));
        return;
      }

      const fileStream = fs.createWriteStream(destPath);
      response.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close(resolve);
      });
      fileStream.on('error', reject);
    });

    request.on('error', reject);
  });
}

async function ensureWindowsCodeSignCache() {
  if (os.platform() !== 'win32') {
    return;
  }

  const localAppData =
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const cacheRoot =
    process.env.ELECTRON_BUILDER_CACHE ||
    path.join(localAppData, 'electron-builder', 'Cache');
  const winCodeSignDir = path.join(cacheRoot, 'winCodeSign');
  const targetDir = path.join(winCodeSignDir, 'winCodeSign-2.6.0');
  const rceditPath = path.join(targetDir, 'rcedit-x64.exe');

  if (fs.existsSync(rceditPath)) {
    return;
  }

  try {
    const sevenZipBin = require('7zip-bin').path7za;
    fs.mkdirSync(winCodeSignDir, { recursive: true });
    const archivePath = path.join(winCodeSignDir, 'winCodeSign-2.6.0.7z');

    if (!fs.existsSync(archivePath)) {
      const url =
        'https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z';
      console.log('[run-build] Pre-downloading winCodeSign-2.6.0.7z...');
      await downloadFile(url, archivePath);
    }

    console.log(
      '[run-build] Extracting winCodeSign-2.6.0 (skipping macOS darwin symlinks)...'
    );
    fs.mkdirSync(targetDir, { recursive: true });
    const result = spawnSync(
      sevenZipBin,
      ['x', '-bd', '-y', '-xr!darwin', archivePath, `-o${targetDir}`],
      { stdio: 'inherit' }
    );

    if (result.status !== 0 && !fs.existsSync(rceditPath)) {
      console.warn(
        `[run-build] 7za exited with status ${result.status}; continuing...`
      );
    }
  } catch (error) {
    console.warn(
      '[run-build] Could not pre-populate winCodeSign cache:',
      error.message
    );
  }
}

async function main() {
  await ensureWindowsCodeSignCache();

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const platformArgs = (() => {
    switch (os.platform()) {
      case 'win32':
        return ['--win', 'portable'];
      case 'darwin':
        return ['--mac'];
      case 'linux':
        return ['--linux'];
      default:
        return [];
    }
  })();

  const args = [...platformArgs, ...process.argv.slice(2)];

  // Invoke electron-builder via Node directly to avoid spawning the .cmd
  // shim on Windows (which needs shell:true and triggers a deprecation
  // warning). The CLI module path is stable across versions.
  const builderCli = require.resolve('electron-builder/out/cli/cli.js');
  const child = spawn(process.execPath, [builderCli, ...args], {
    stdio: 'inherit',
    env
  });

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
}

main();
