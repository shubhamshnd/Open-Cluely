# Build Instructions - Open Cluely

## One command per OS

```bash
npm ci
npm run build:win     # Windows: dist/OpenCluely.exe (portable, x64)
npm run build:mac     # macOS:   dist/Open Cluely-<version>.dmg
npm run build:linux   # Linux:   dist/Open Cluely-<version>.AppImage
```

`npm run build` auto-detects the current OS and builds that target.

Each OS target must be built on that OS (or a matching CI runner). The Windows and macOS targets were not built on the Linux development machine, so verify them on their own platforms.

## Prerequisites

- Node.js 18+ (20 or later recommended) and npm 10+.
- No C++ toolchain, Visual Studio Build Tools, or Python is needed. The dependency tree has no native modules that compile on install (`package-lock.json` has no `gypfile` entries).
- Linux: `libfuse2` may be required to *run* an AppImage on newer distros. It is not needed to build one.

## Icons

Icons live in `assets/` and are wired into `package.json`:

- `assets/icon.ico` - Windows
- `assets/icon.icns` - macOS
- `assets/icon.png` - Linux

See `assets/README.md` for how to replace them.

## Configuration

The app identity is set in the `build` section of `package.json`:

- Product name: `Open Cluely`
- App ID: `com.opencluely.app`
- Windows artifact: `OpenCluely.exe` (portable)
- Linux target: AppImage

`.env` is **not** bundled. Packaged builds read settings and API keys from `cache/app-state.json` in the user-data directory; edit them from the in-app Settings panel.

## Running the built app

- Windows: run `dist/OpenCluely.exe`. Add `--start-hidden` to launch in the background.
- Linux: `chmod +x "dist/Open Cluely-<version>.AppImage"` then run it.
- macOS: open the app from the `.dmg`.

## Troubleshooting

- **Windows symlink privilege error:** enable Developer Mode or build from an elevated terminal.
- **Build fails:** run `npm ci` again and retry `npm run build:<os>`.
- **Icon not updated:** delete `dist/` and rebuild.

## Responsible use

Use Open Cluely only where recording, transcription, screenshots, and AI assistance are allowed, and get consent where required.
