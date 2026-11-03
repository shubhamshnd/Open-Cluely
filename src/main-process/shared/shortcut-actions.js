// Shortcut actions shared by the globalShortcut handlers, the single-instance
// `--action=<shortcutId>` CLI path, and the opt-in GNOME custom-keybinding
// installer. Everything except createGnomeShortcutInstaller is a pure
// function so it can be unit-tested without Electron or gsettings.

const { execFile } = require('child_process');
const fs = require('fs');

const MEDIA_KEYS_SCHEMA = 'org.gnome.settings-daemon.plugins.media-keys';
const CUSTOM_KEYBINDINGS_KEY = 'custom-keybindings';
const CUSTOM_KEYBINDING_SCHEMA = 'org.gnome.settings-daemon.plugins.media-keys.custom-keybinding';
const CUSTOM_KEYBINDING_ROOT = '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/';
const KEYBINDING_PATH_PREFIX = 'open-cluely-';

// --- argv parsing -----------------------------------------------------------

// Extracts the shortcut id from `--action=<shortcutId>`. The value is NOT
// lowercased: shortcut ids in src/config.js are camelCase. Unknown ids are
// accepted here and rejected (log + ignore) at dispatch time.
function parseShortcutActionArg(argv) {
  if (!Array.isArray(argv)) {
    return null;
  }

  for (const rawArg of argv) {
    const match = /^--action=(.+)$/.exec(String(rawArg));
    if (match) {
      const actionId = match[1].trim();
      return actionId === '' ? null : actionId;
    }
  }

  return null;
}

// --- Electron accelerator -> GNOME binding ----------------------------------

const GNOME_MODIFIER_MAP = {
  alt: '<Alt>',
  shift: '<Shift>',
  ctrl: '<Control>',
  control: '<Control>',
  commandorcontrol: '<Control>',
  cmd: '<Control>',
  command: '<Control>',
  super: '<Super>',
  meta: '<Meta>'
};

// Electron accelerator names that differ from GTK keysym names.
const GNOME_KEY_NAME_MAP = {
  space: 'space',
  plus: 'plus',
  minus: 'minus',
  enter: 'Return',
  return: 'Return',
  esc: 'Escape',
  backspace: 'BackSpace',
  delete: 'Delete',
  tab: 'Tab',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right'
};

// `Alt+Shift+H` -> `<Alt><Shift>h`, `Alt+Shift+Left` -> `<Alt><Shift>Left`,
// digits stay (`Alt+Shift+1` -> `<Alt><Shift>1`). Throws on unknown modifiers
// so a typo in src/config.js can never silently install a wrong binding.
function acceleratorToGnomeBinding(accelerator) {
  const tokens = String(accelerator || '')
    .split('+')
    .map((token) => token.trim())
    .filter((token) => token !== '');

  if (tokens.length === 0) {
    throw new Error('Cannot convert an empty accelerator to a GNOME binding.');
  }

  const key = tokens[tokens.length - 1];
  const modifiers = tokens.slice(0, -1);

  const binding = modifiers.map((modifier) => {
    const mapped = GNOME_MODIFIER_MAP[modifier.toLowerCase()];
    if (!mapped) {
      throw new Error(`Unknown accelerator modifier "${modifier}" in "${accelerator}".`);
    }
    return mapped;
  });

  if (/^f(?:[1-9]|1[0-2])$/i.test(key)) {
    binding.push(key.toUpperCase());
  } else if (key.length === 1) {
    // Single letters and digits: GTK keysyms are the lowercase character.
    binding.push(key.toLowerCase());
  } else {
    const mappedKey = GNOME_KEY_NAME_MAP[key.toLowerCase()];
    if (!mappedKey) {
      throw new Error(`Unknown accelerator key "${key}" in "${accelerator}".`);
    }
    binding.push(mappedKey);
  }

  return binding.join('');
}

// --- GNOME custom-keybinding paths and lists --------------------------------

function buildCustomKeybindingPath(shortcutId) {
  const id = String(shortcutId || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid shortcut id "${shortcutId}".`);
  }
  return `${CUSTOM_KEYBINDING_ROOT}${KEYBINDING_PATH_PREFIX}${id}/`;
}

function buildCustomKeybindingPaths(shortcutIds) {
  return (Array.isArray(shortcutIds) ? shortcutIds : []).map(buildCustomKeybindingPath);
}

// existing + ours, deduped, existing order preserved, ours appended in order.
function mergeCustomKeybindingPaths(existingPaths, ourPaths) {
  const merged = Array.isArray(existingPaths) ? [...existingPaths] : [];
  for (const path of Array.isArray(ourPaths) ? ourPaths : []) {
    if (!merged.includes(path)) {
      merged.push(path);
    }
  }
  return merged;
}

// existing minus ours only; anything else (e.g. the user's custom0) stays.
function removeCustomKeybindingPaths(existingPaths, ourPaths) {
  const ours = new Set(Array.isArray(ourPaths) ? ourPaths : []);
  return (Array.isArray(existingPaths) ? existingPaths : []).filter((path) => !ours.has(path));
}

// Parses `gsettings get ... custom-keybindings` output: `@as []`, `[]`, or
// `['/a/', '/b/']`.
function parseGsettingsPathList(output) {
  const matches = String(output || '').match(/'([^']*)'/g);
  if (!matches) {
    return [];
  }
  return matches.map((token) => token.slice(1, -1));
}

// Inverse of parseGsettingsPathList. An empty list must carry an explicit
// type annotation or gsettings cannot infer the element type.
function formatGsettingsPathList(paths) {
  const list = Array.isArray(paths) ? paths : [];
  if (list.length === 0) {
    return '@as []';
  }
  return `[${list.map((path) => `'${String(path).replace(/'/g, "\\'")}'`).join(', ')}]`;
}

// A GVariant string literal for `gsettings set` (single-quoted, escaped).
function formatGvariantString(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

// --- GNOME command line for the second-instance launch ----------------------

// GNOME parses the command with g_shell_parse_argv (GLib shell rules), so
// double-quote every path and escape backslashes and double quotes inside.
function quoteGnomeCommandArg(arg) {
  return `"${String(arg).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// Packaged AppImage launches `"$APPIMAGE" --action=<id>`; running from source
// needs `"<electron>" "<app path>" --no-sandbox --action=<id>` (--no-sandbox
// because of the AppArmor restriction on unprivileged Electron sandboxes).
function buildShortcutActionCommand({ actionId, appImagePath, execPath, appPath }) {
  const id = String(actionId || '').trim();
  if (!id) {
    throw new Error('actionId is required to build a shortcut action command.');
  }

  if (appImagePath) {
    return `${quoteGnomeCommandArg(appImagePath)} --action=${id}`;
  }

  if (!execPath || !appPath) {
    throw new Error('execPath and appPath are required when not running packaged.');
  }

  return `${quoteGnomeCommandArg(execPath)} ${quoteGnomeCommandArg(appPath)} --no-sandbox --action=${id}`;
}

// --- environment probe ------------------------------------------------------

// Parses /proc/<pid>/environ content (NUL-separated KEY=value) into an object.
function parseProcEnviron(raw) {
  const entries = {};
  for (const pair of String(raw || '').split('\0')) {
    const separator = pair.indexOf('=');
    if (separator > 0) {
      entries[pair.slice(0, separator)] = pair.slice(separator + 1);
    }
  }
  return entries;
}

// Parses the parent pid out of /proc/<pid>/stat. The comm field in
// parentheses can contain spaces and parens, so parse after the LAST ')'.
function parseProcStatPpid(statText) {
  const closeParen = String(statText || '').lastIndexOf(')');
  if (closeParen === -1) {
    return null;
  }
  const fields = String(statText).slice(closeParen + 1).trim().split(/\s+/);
  const ppid = Number.parseInt(fields[1] || '', 10);
  return Number.isFinite(ppid) ? ppid : null;
}

function readEnvironFile(pid) {
  try {
    return parseProcEnviron(fs.readFileSync(`/proc/${pid}/environ`, 'latin1'));
  } catch {
    return {};
  }
}

function readSelfEnviron() {
  return readEnvironFile('self');
}

// Electron sanitizes desktop variables out of the browser process before its
// final exec, Chromium then sets XDG_CURRENT_DESKTOP='Unity' for its
// global-menu workaround, and `process.title = ...` clobbers what remains of
// /proc/self/environ. The session's real XDG_CURRENT_DESKTOP survives in the
// ancestor processes (shell, desktop launcher, systemd --user, gnome-shell),
// so walk up the process tree and use the first value found.
function readAncestorEnviron({ maxDepth = 8 } = {}) {
  const merged = {};
  let pid = process.ppid;

  for (let depth = 0; depth < maxDepth && Number.isInteger(pid) && pid > 1; depth += 1) {
    const env = readEnvironFile(pid);
    if (env.XDG_CURRENT_DESKTOP && !merged.XDG_CURRENT_DESKTOP) {
      merged.XDG_CURRENT_DESKTOP = env.XDG_CURRENT_DESKTOP;
    }
    if (merged.XDG_CURRENT_DESKTOP) {
      break;
    }
    try {
      pid = parseProcStatPpid(fs.readFileSync(`/proc/${pid}/stat`, 'latin1'));
    } catch {
      break;
    }
  }

  return merged;
}

// Execve-time-ish environment for desktop detection: our own /proc environ
// (reliable outside Electron) wins, then the ancestor chain.
function readSessionEnviron() {
  return { ...readAncestorEnviron(), ...readSelfEnviron() };
}

// Pure: procEnviron is the execve-time environment (see readSessionEnviron)
// and wins over the possibly-rewritten env. XDG_CURRENT_DESKTOP lists
// desktops colon-separated (e.g. 'ubuntu:GNOME').
function isGnomeDesktop(platform, env = {}, procEnviron = {}) {
  if (platform !== 'linux') {
    return false;
  }
  const desktop = String(
    procEnviron.XDG_CURRENT_DESKTOP ||
    env.XDG_CURRENT_DESKTOP ||
    ''
  ).toLowerCase();
  return desktop.split(':').map((part) => part.trim()).includes('gnome');
}

// --- gsettings-backed installer (impure, thin) -------------------------------

function createGnomeShortcutInstaller({
  platform,
  env = {},
  procEnviron,
  execPath,
  appPath,
  shortcuts = [],
  execFileImpl
} = {}) {
  const execveEnviron = procEnviron || (platform === 'linux' ? readSessionEnviron() : {});
  const runGsettings = typeof execFileImpl === 'function'
    ? execFileImpl
    : (file, args) => new Promise((resolve, reject) => {
      execFile(file, args, { encoding: 'utf8' }, (error, stdout, stderr) => {
        if (error) {
          error.stderr = stderr;
          reject(error);
        } else {
          resolve(String(stdout).trim());
        }
      });
    });

  const entries = (Array.isArray(shortcuts) ? shortcuts : []).map((shortcut) => ({
    id: shortcut.id,
    name: shortcut.name,
    accelerator: shortcut.accelerator,
    path: buildCustomKeybindingPath(shortcut.id),
    command: buildShortcutActionCommand({
      actionId: shortcut.id,
      appImagePath: env.APPIMAGE || '',
      execPath,
      appPath
    })
  }));
  const ourPaths = entries.map((entry) => entry.path);

  function isAvailable() {
    return isGnomeDesktop(platform, env, execveEnviron);
  }

  function unavailable() {
    return {
      success: false,
      error: 'GNOME shortcut integration is only available on Linux under the GNOME desktop.'
    };
  }

  function failureFrom(error) {
    if (error && error.code === 'ENOENT') {
      return { success: false, error: 'gsettings is not installed or not on PATH.' };
    }
    return { success: false, error: String((error && error.message) || error) };
  }

  async function readExistingPaths() {
    const output = await runGsettings('gsettings', ['get', MEDIA_KEYS_SCHEMA, CUSTOM_KEYBINDINGS_KEY]);
    return parseGsettingsPathList(output);
  }

  async function writePathList(paths) {
    await runGsettings('gsettings', ['set', MEDIA_KEYS_SCHEMA, CUSTOM_KEYBINDINGS_KEY, formatGsettingsPathList(paths)]);
  }

  async function writeEntry(entry) {
    const schemaWithPath = `${CUSTOM_KEYBINDING_SCHEMA}:${entry.path}`;
    await runGsettings('gsettings', ['set', schemaWithPath, 'name', formatGvariantString(entry.name)]);
    await runGsettings('gsettings', ['set', schemaWithPath, 'command', formatGvariantString(entry.command)]);
    await runGsettings('gsettings', ['set', schemaWithPath, 'binding', formatGvariantString(acceleratorToGnomeBinding(entry.accelerator))]);
  }

  async function resetEntry(path) {
    await runGsettings('gsettings', ['reset-recursively', `${CUSTOM_KEYBINDING_SCHEMA}:${path}`]);
  }

  async function isInstalled() {
    if (!isAvailable() || entries.length === 0) {
      return false;
    }
    try {
      const existing = await readExistingPaths();
      return ourPaths.every((path) => existing.includes(path));
    } catch (error) {
      console.warn('Could not read GNOME custom keybindings:', error.message || error);
      return false;
    }
  }

  async function install() {
    if (!isAvailable()) {
      return unavailable();
    }
    if (entries.length === 0) {
      return { success: false, error: 'No shortcut actions are configured.' };
    }

    try {
      for (const entry of entries) {
        await writeEntry(entry);
      }
      // Publish only fully configured bindings. Re-read after the slow entry
      // writes so unrelated shortcuts added in the meantime are retained.
      const existing = await readExistingPaths();
      await writePathList(mergeCustomKeybindingPaths(existing, ourPaths));
      return {
        success: true,
        message: `Added ${entries.length} shortcuts under GNOME Settings → Keyboard → Custom Shortcuts.`
      };
    } catch (error) {
      return failureFrom(error);
    }
  }

  async function remove() {
    if (!isAvailable()) {
      return unavailable();
    }

    try {
      const existing = await readExistingPaths();
      await writePathList(removeCustomKeybindingPaths(existing, ourPaths));
      for (const path of ourPaths) {
        await resetEntry(path);
      }
      return { success: true, message: 'Removed the Open Cluely GNOME shortcuts.' };
    } catch (error) {
      return failureFrom(error);
    }
  }

  return {
    isAvailable,
    isInstalled,
    install,
    remove
  };
}

module.exports = {
  CUSTOM_KEYBINDING_ROOT,
  CUSTOM_KEYBINDING_SCHEMA,
  CUSTOM_KEYBINDINGS_KEY,
  MEDIA_KEYS_SCHEMA,
  acceleratorToGnomeBinding,
  buildCustomKeybindingPath,
  buildCustomKeybindingPaths,
  buildShortcutActionCommand,
  createGnomeShortcutInstaller,
  formatGsettingsPathList,
  formatGvariantString,
  isGnomeDesktop,
  mergeCustomKeybindingPaths,
  parseGsettingsPathList,
  parseProcEnviron,
  parseProcStatPpid,
  parseShortcutActionArg,
  quoteGnomeCommandArg,
  readAncestorEnviron,
  readSelfEnviron,
  readSessionEnviron,
  removeCustomKeybindingPaths
};
