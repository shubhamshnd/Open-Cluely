'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CUSTOM_KEYBINDING_SCHEMA,
  CUSTOM_KEYBINDINGS_KEY,
  MEDIA_KEYS_SCHEMA,
  acceleratorToGnomeBinding,
  buildCustomKeybindingPath,
  buildShortcutActionCommand,
  createGnomeShortcutInstaller,
  formatGsettingsPathList,
  isGnomeDesktop,
  mergeCustomKeybindingPaths,
  parseGsettingsPathList,
  parseProcEnviron,
  parseProcStatPpid,
  parseShortcutActionArg,
  quoteGnomeCommandArg,
  readSessionEnviron,
  removeCustomKeybindingPaths
} = require('../src/main-process/shared/shortcut-actions');

const { getKeyboardShortcuts } = require('../src/config');

// --- parseShortcutActionArg --------------------------------------------------

test('parseShortcutActionArg extracts the id from --action=<id>', () => {
  assert.equal(
    parseShortcutActionArg(['/usr/bin/electron', '/app', '--no-sandbox', '--action=moveWindowRight']),
    'moveWindowRight'
  );
  assert.equal(parseShortcutActionArg(['--action=toggleStealth']), 'toggleStealth');
});

test('parseShortcutActionArg returns null without a usable --action', () => {
  assert.equal(parseShortcutActionArg(['/usr/bin/electron', '/app']), null);
  assert.equal(parseShortcutActionArg(['--action=']), null);
  assert.equal(parseShortcutActionArg(['--action']), null);
  assert.equal(parseShortcutActionArg([]), null);
  assert.equal(parseShortcutActionArg(null), null);
  assert.equal(parseShortcutActionArg(undefined), null);
});

test('parseShortcutActionArg keeps camelCase ids intact', () => {
  assert.equal(parseShortcutActionArg(['--action=windowSizePreset3']), 'windowSizePreset3');
});

// --- acceleratorToGnomeBinding -----------------------------------------------

test('acceleratorToGnomeBinding converts letters, named keys and digits', () => {
  assert.equal(acceleratorToGnomeBinding('Alt+Shift+H'), '<Alt><Shift>h');
  assert.equal(acceleratorToGnomeBinding('Alt+Shift+Left'), '<Alt><Shift>Left');
  assert.equal(acceleratorToGnomeBinding('Alt+Shift+Right'), '<Alt><Shift>Right');
  assert.equal(acceleratorToGnomeBinding('Alt+Shift+Down'), '<Alt><Shift>Down');
  assert.equal(acceleratorToGnomeBinding('Alt+Shift+1'), '<Alt><Shift>1');
});

test('acceleratorToGnomeBinding maps modifier aliases and special keys', () => {
  assert.equal(acceleratorToGnomeBinding('CommandOrControl+Shift+P'), '<Control><Shift>p');
  assert.equal(acceleratorToGnomeBinding('Ctrl+Alt+Delete'), '<Control><Alt>Delete');
  assert.equal(acceleratorToGnomeBinding('Alt+Space'), '<Alt>space');
  assert.equal(acceleratorToGnomeBinding('Super+F5'), '<Super>F5');
});

test('acceleratorToGnomeBinding rejects unknown modifiers, keys and empty input', () => {
  assert.throws(() => acceleratorToGnomeBinding('Alt+Wat+K'), /Unknown accelerator modifier/);
  assert.throws(() => acceleratorToGnomeBinding('Alt+Nonexistent'), /Unknown accelerator key/);
  assert.throws(() => acceleratorToGnomeBinding(''), /empty accelerator/);
  assert.throws(() => acceleratorToGnomeBinding(null), /empty accelerator/);
});

test('every configured shortcut accelerator converts to a GNOME binding', () => {
  for (const shortcut of getKeyboardShortcuts()) {
    assert.ok(
      acceleratorToGnomeBinding(shortcut.accelerator).startsWith('<'),
      `${shortcut.id} (${shortcut.accelerator}) must convert`
    );
  }
});

// --- keybinding paths and list merge/remove ----------------------------------

const CUSTOM0 = '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/';

test('buildCustomKeybindingPath namespaces our entries and validates ids', () => {
  assert.equal(
    buildCustomKeybindingPath('toggleStealth'),
    '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/open-cluely-toggleStealth/'
  );
  assert.throws(() => buildCustomKeybindingPath(''), /Invalid shortcut id/);
  assert.throws(() => buildCustomKeybindingPath('a/b'), /Invalid shortcut id/);
});

test('mergeCustomKeybindingPaths preserves existing entries and dedupes', () => {
  const ours = [buildCustomKeybindingPath('toggleStealth'), buildCustomKeybindingPath('moveWindowRight')];
  assert.deepEqual(mergeCustomKeybindingPaths([CUSTOM0], ours), [CUSTOM0, ...ours]);
  // Installing twice changes nothing.
  assert.deepEqual(mergeCustomKeybindingPaths([CUSTOM0, ...ours], ours), [CUSTOM0, ...ours]);
  assert.deepEqual(mergeCustomKeybindingPaths([], ours), ours);
});

test('removeCustomKeybindingPaths drops only our entries', () => {
  const ours = [buildCustomKeybindingPath('toggleStealth'), buildCustomKeybindingPath('moveWindowRight')];
  assert.deepEqual(removeCustomKeybindingPaths([CUSTOM0, ...ours], ours), [CUSTOM0]);
  // Removing when none of ours exist leaves the list untouched.
  assert.deepEqual(removeCustomKeybindingPaths([CUSTOM0], ours), [CUSTOM0]);
  assert.deepEqual(removeCustomKeybindingPaths([], ours), []);
});

test('gsettings path list parse/format round-trips', () => {
  assert.deepEqual(parseGsettingsPathList('@as []'), []);
  assert.deepEqual(parseGsettingsPathList('[]'), []);
  assert.deepEqual(parseGsettingsPathList(`['${CUSTOM0}']`), [CUSTOM0]);
  assert.deepEqual(parseGsettingsPathList(`['${CUSTOM0}', '/a/b/']`), [CUSTOM0, '/a/b/']);
  assert.deepEqual(parseGsettingsPathList(''), []);

  assert.equal(formatGsettingsPathList([]), '@as []');
  assert.equal(formatGsettingsPathList([CUSTOM0]), `['${CUSTOM0}']`);
  assert.deepEqual(parseGsettingsPathList(formatGsettingsPathList([CUSTOM0, '/a/b/'])), [CUSTOM0, '/a/b/']);
});

// --- command building --------------------------------------------------------

test('quoteGnomeCommandArg double-quotes and escapes for g_shell_parse_argv', () => {
  assert.equal(quoteGnomeCommandArg('/opt/Open Cluely.AppImage'), '"/opt/Open Cluely.AppImage"');
  assert.equal(quoteGnomeCommandArg('/a/b"c'), '"/a/b\\"c"');
});

test('buildShortcutActionCommand uses $APPIMAGE when packaged', () => {
  assert.equal(
    buildShortcutActionCommand({ actionId: 'toggleStealth', appImagePath: '/opt/Open Cluely.AppImage' }),
    '"/opt/Open Cluely.AppImage" --action=toggleStealth'
  );
});

test('buildShortcutActionCommand from source quotes electron and app path, adds --no-sandbox', () => {
  assert.equal(
    buildShortcutActionCommand({
      actionId: 'moveWindowRight',
      appImagePath: '',
      execPath: '/home/me/app/node_modules/electron/dist/electron',
      appPath: '/home/me/my app'
    }),
    '"/home/me/app/node_modules/electron/dist/electron" "/home/me/my app" --no-sandbox --action=moveWindowRight'
  );
  assert.throws(() => buildShortcutActionCommand({ actionId: '' }), /actionId is required/);
  assert.throws(
    () => buildShortcutActionCommand({ actionId: 'x', appImagePath: '', execPath: '', appPath: '/a' }),
    /execPath and appPath are required/
  );
});

// --- isGnomeDesktop -----------------------------------------------------------

test('isGnomeDesktop only matches linux + GNOME in XDG_CURRENT_DESKTOP', () => {
  assert.equal(isGnomeDesktop('linux', { XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' }), true);
  assert.equal(isGnomeDesktop('linux', { XDG_CURRENT_DESKTOP: 'GNOME' }), true);
  assert.equal(isGnomeDesktop('linux', { XDG_CURRENT_DESKTOP: 'KDE' }), false);
  assert.equal(isGnomeDesktop('linux', {}), false);
  assert.equal(isGnomeDesktop('win32', { XDG_CURRENT_DESKTOP: 'GNOME' }), false);
  assert.equal(isGnomeDesktop('darwin', { XDG_CURRENT_DESKTOP: 'GNOME' }), false);
});

test('isGnomeDesktop survives Chromium rewriting XDG_CURRENT_DESKTOP to Unity', () => {
  // Electron rewrites process.env.XDG_CURRENT_DESKTOP to 'Unity' before app
  // code runs; the execve-time environment from /proc/self/environ still
  // holds the real value and must win.
  assert.equal(
    isGnomeDesktop('linux', { XDG_CURRENT_DESKTOP: 'Unity' }, { XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' }),
    true
  );
  assert.equal(
    isGnomeDesktop('linux', { XDG_CURRENT_DESKTOP: 'Unity' }, { XDG_CURRENT_DESKTOP: 'KDE' }),
    false
  );
  assert.equal(isGnomeDesktop('linux', { XDG_CURRENT_DESKTOP: 'Unity' }, {}), false);
});

// --- /proc parsing helpers ----------------------------------------------------

test('parseProcEnviron parses NUL-separated KEY=value pairs', () => {
  assert.deepEqual(parseProcEnviron('A=1\0B=two=2\0\0'), { A: '1', B: 'two=2' });
  assert.deepEqual(parseProcEnviron(''), {});
  assert.deepEqual(parseProcEnviron('novalue\0X=y'), { X: 'y' });
});

test('parseProcStatPpid reads the ppid past a comm with spaces and parens', () => {
  assert.equal(parseProcStatPpid('1234 (electron) S 1000 1234 1234 0 -1 4194304'), 1000);
  assert.equal(parseProcStatPpid('55 (weird (comm) name) R 42 55 55 0'), 42);
  assert.equal(parseProcStatPpid('garbage'), null);
  assert.equal(parseProcStatPpid(''), null);
});

// --- installer against a fake gsettings ---------------------------------------

const GNOME_ENV = { XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' };
const TEST_SHORTCUTS = [
  { id: 'toggleStealth', name: 'Open Cluely: Toggle Stealth', accelerator: 'Alt+Shift+H' },
  { id: 'moveWindowRight', name: 'Open Cluely: Move Window Right', accelerator: 'Alt+Shift+Right' }
];

function createFakeGsettings(initialPaths) {
  const store = { list: [...initialPaths], entries: {} };
  const execFileImpl = (file, args) => {
    if (file !== 'gsettings') {
      return Promise.reject(new Error(`unexpected binary ${file}`));
    }
    const [command, target, key, value] = args;
    if (command === 'get' && target === MEDIA_KEYS_SCHEMA && key === CUSTOM_KEYBINDINGS_KEY) {
      return Promise.resolve(formatGsettingsPathList(store.list));
    }
    if (command === 'set' && target === MEDIA_KEYS_SCHEMA && key === CUSTOM_KEYBINDINGS_KEY) {
      store.list = parseGsettingsPathList(value);
      return Promise.resolve('');
    }
    if (command === 'set' && target.startsWith(`${CUSTOM_KEYBINDING_SCHEMA}:`)) {
      const path = target.slice(CUSTOM_KEYBINDING_SCHEMA.length + 1);
      store.entries[path] = { ...(store.entries[path] || {}), [key]: value };
      return Promise.resolve('');
    }
    if (command === 'reset-recursively' && target.startsWith(`${CUSTOM_KEYBINDING_SCHEMA}:`)) {
      delete store.entries[target.slice(CUSTOM_KEYBINDING_SCHEMA.length + 1)];
      return Promise.resolve('');
    }
    return Promise.reject(new Error(`unexpected gsettings call: ${args.join(' ')}`));
  };
  return { store, execFileImpl };
}

function createInstaller(execFileImpl, env = GNOME_ENV) {
  return createGnomeShortcutInstaller({
    platform: 'linux',
    env,
    // Keep tests hermetic: never read this host's real /proc/self/environ.
    procEnviron: {},
    execPath: '/usr/bin/electron',
    appPath: '/home/me/open-cluely',
    shortcuts: TEST_SHORTCUTS,
    execFileImpl
  });
}

test('install adds our entries and preserves the user\'s custom0', async () => {
  const { store, execFileImpl } = createFakeGsettings([CUSTOM0]);
  const installer = createInstaller(execFileImpl);

  assert.equal(installer.isAvailable(), true);
  assert.equal(await installer.isInstalled(), false);

  const result = await installer.install();
  assert.equal(result.success, true, result.error);

  // custom0 comes first, both of ours appended.
  assert.deepEqual(store.list, [
    CUSTOM0,
    buildCustomKeybindingPath('toggleStealth'),
    buildCustomKeybindingPath('moveWindowRight')
  ]);

  const entry = store.entries[buildCustomKeybindingPath('moveWindowRight')];
  assert.equal(entry.name, `'Open Cluely: Move Window Right'`);
  assert.equal(entry.binding, `'<Alt><Shift>Right'`);
  assert.match(entry.command, /^'.*--action=moveWindowRight'$/);
  assert.match(entry.command, /--no-sandbox/);

  assert.equal(await installer.isInstalled(), true);

  // Installing again is a no-op for the list.
  await installer.install();
  assert.deepEqual(store.list, [
    CUSTOM0,
    buildCustomKeybindingPath('toggleStealth'),
    buildCustomKeybindingPath('moveWindowRight')
  ]);
});

test('failed entry configuration does not publish an installed shortcut list', async () => {
  const { store, execFileImpl } = createFakeGsettings([CUSTOM0]);
  const installer = createInstaller((file, args) => {
    if (args[0] === 'set' && args[1].startsWith(`${CUSTOM_KEYBINDING_SCHEMA}:`)) {
      return Promise.reject(new Error('write denied'));
    }
    return execFileImpl(file, args);
  });
  assert.equal((await installer.install()).success, false);
  assert.equal(await installer.isInstalled(), false);
  assert.deepEqual(store.list, [CUSTOM0]);
});

test('remove drops only our entries and resets them', async () => {
  const { store, execFileImpl } = createFakeGsettings([CUSTOM0]);
  const installer = createInstaller(execFileImpl);

  await installer.install();
  assert.equal(store.list.length, 3);

  const result = await installer.remove();
  assert.equal(result.success, true, result.error);
  assert.deepEqual(store.list, [CUSTOM0]);
  assert.deepEqual(store.entries, {});
  assert.equal(await installer.isInstalled(), false);

  // Removing when nothing of ours is installed leaves custom0 exactly as-is.
  await installer.remove();
  assert.deepEqual(store.list, [CUSTOM0]);
});

test('install uses $APPIMAGE in the command when packaged', async () => {
  const { store, execFileImpl } = createFakeGsettings([CUSTOM0]);
  const installer = createInstaller(execFileImpl, { ...GNOME_ENV, APPIMAGE: '/opt/Open Cluely.AppImage' });
  await installer.install();
  const entry = store.entries[buildCustomKeybindingPath('toggleStealth')];
  assert.equal(entry.command, `'"/opt/Open Cluely.AppImage" --action=toggleStealth'`);
});

test('installer reports gsettings missing and refuses off-GNOME', async () => {
  const enoent = Object.assign(new Error('spawn gsettings ENOENT'), { code: 'ENOENT' });
  const missing = createInstaller(() => Promise.reject(enoent));
  const installResult = await missing.install();
  assert.equal(installResult.success, false);
  assert.match(installResult.error, /gsettings is not installed/);
  const removeResult = await missing.remove();
  assert.equal(removeResult.success, false);
  assert.match(removeResult.error, /gsettings is not installed/);

  const kde = createInstaller(createFakeGsettings([CUSTOM0]).execFileImpl, { XDG_CURRENT_DESKTOP: 'KDE' });
  assert.equal(kde.isAvailable(), false);
  assert.equal((await kde.install()).success, false);
  assert.equal((await kde.remove()).success, false);
});

test('installer without injected environ detects GNOME via the host session', () => {
  // Host-conditional sanity check of the real /proc ancestor walk: on a
  // GNOME host the installer (no procEnviron injection) must see GNOME even
  // though Electron would have rewritten process.env to 'Unity'. On
  // non-GNOME hosts this only asserts the negative.
  const installer = createGnomeShortcutInstaller({
    platform: 'linux',
    env: { XDG_CURRENT_DESKTOP: 'Unity' },
    execPath: '/usr/bin/electron',
    appPath: '/home/me/open-cluely',
    shortcuts: TEST_SHORTCUTS,
    execFileImpl: () => Promise.reject(new Error('must not be called'))
  });

  const hostIsGnome = String(readSessionEnviron().XDG_CURRENT_DESKTOP || process.env.XDG_CURRENT_DESKTOP || '')
    .toLowerCase()
    .includes('gnome');
  assert.equal(installer.isAvailable(), hostIsGnome);
});
