# Open-Cluely

Electron desktop meeting assistant with live transcription, screenshots, and Gemini-based assistance.

## Features

- Live transcription with a single master control button and per-source toggles:
  - `Host audio` (system output)
  - `Mic` (microphone input)
- Real-time Transcription Monitor:
  - Per-source status (`Off`, `Connecting`, `Listening`, `Error`)
  - Live partial/final preview and rolling debug log
- `Ask AI` now uses full session context:
  - Transcript context (Host + You)
  - Current session screenshots (when enabled)
  - Works even when screenshot count is zero (text-only fallback)
- New `Screen AI` button for screenshot-only analysis flow
- Selective AI context controls in chat:
  - Toggle transcript/screenshot messages `AI` / `Off` per message
  - Disabled chunks stay visible but are excluded from AI prompts
- Automatic context cap for long meetings:
  - Keeps newest enabled context
  - Trims oldest enabled chunks first when budget is exceeded

## Ask AI vs Screen AI

- `Ask AI`:
  - Primary assistant action
  - Uses filtered session context from chat (transcript + enabled screenshots)
  - Best for "what should I say/do next?"
- `Screen AI`:
  - Screenshot-focused analysis
  - Uses only enabled screenshot items
- `Screenshot`:
  - Capture only (does not analyze by itself)

## Selective AI Context Controls

In chat, transcript and screenshot messages have an `AI`/`Off` toggle.

- `AI`: message is included in context sent to AI
- `Off`: message is excluded from context, but still shown in UI
- Excluded messages appear dimmed with an `Excluded from AI context` marker

Default behavior:

- Toggleable: transcript (`You` / `Host`) and screenshot messages
- Always excluded: system status/error messages
- Included by default: AI output messages

This filtering is applied consistently across:

- `Ask AI`
- `Screen AI`
- `What should I say`
- `Generate Meeting Notes`
- `Get Insights`

## Project Structure

- `src/main.js` - main Electron process entry and runtime orchestration
- `src/bootstrap/` - startup environment loading, validation, and `.env` persistence
- `src/windows/assistant/` - active Electron window files (`window.js`, `preload.js`, `renderer.js`, `renderer.html`, `styles.css`)
- `src/windows/legacy/` - old or backup window/transcription experiments kept for reference
- `src/services/ai/` - AI service integrations such as Gemini
- `src/services/state/` - local persisted state helpers such as `cache/app-state.json` handling
- `src/config.js` - source of truth for Gemini and AssemblyAI speech model lists/defaults

## Setup

### Prerequisites

- Windows 10/11
- `nvm-windows` `1.2.2` or compatible
- Node.js `20.20.1`
- npm `10.8.2`
- Gemini API key
- AssemblyAI API key

### Native Windows Dependencies

This app uses native Windows modules. If `npm ci` fails with `node-gyp` / Visual Studio errors, install:

- Visual Studio 2022 Build Tools or Visual Studio 2022
- `Desktop development with C++` workload
- MSVC C++ toolset
- Windows 10/11 SDK
- Python

Install command:

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools --exact --accept-package-agreements --accept-source-agreements --override "--passive --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

### Install

```powershell
winget install --id CoreyButler.NVMforWindows --exact --silent --accept-package-agreements --accept-source-agreements
nvm install 20.20.1
nvm use 20.20.1
```

Restart the terminal or VS Code/Cursor, then run:

```powershell
node -v
npm -v
npm ci
```

### Run

```powershell
npm start
```

For logs:

```powershell
npm run dev
```

## Configuration

### `src/config.js`

This file is the source of truth for model lists:

- `GEMINI_MODELS`: Gemini models shown in settings
- `ASSEMBLY_AI_SPEECH_MODELS`: AssemblyAI speech models shown in settings
- The first item in each list is the default

Current defaults:

- Gemini: `gemini-2.5-flash-lite`
- AssemblyAI speech: `universal-streaming-english`

### `.env`

Required:

```env
GEMINI_API_KEY=your_gemini_key
ASSEMBLY_AI_API_KEY=your_assemblyai_key
```

Optional:

```env
HIDE_FROM_SCREEN_CAPTURE=true
MAX_SCREENSHOTS=50
SCREENSHOT_DELAY=300
NODE_ENV=production
NODE_OPTIONS=--max-old-space-size=4096
```

Notes:

- `GEMINI_MODEL` is not read from `.env`
- available AssemblyAI speech models are not controlled from `.env`
- `HIDE_FROM_SCREEN_CAPTURE=false` allows the window to appear in screen share / screenshots

### App State

Runtime selections are persisted in:

```text
cache/app-state.json
```

Stored values:

- selected Gemini model
- selected AssemblyAI speech model

## Build

Use:

```powershell
npm run build -- --config.win.signAndEditExecutable=false
```

Output:

```text
dist/GoogleChrome.exe
```

If build fails with a symlink privilege error, enable Windows Developer Mode or run the build from an elevated terminal.

## Scripts

- `npm start` - run the app
- `npm run dev` - run with logs
- `npm run build -- --config.win.signAndEditExecutable=false` - build Windows executable

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Alt+Shift+V` | Toggle transcription master control |
| `Ctrl+Alt+Shift+S` | Capture screenshot |
| `Ctrl+Alt+Shift+A` | Ask AI (full session context) |
| `Ctrl+Alt+Shift+X` | Emergency hide |
| `Ctrl+Alt+Shift+H` | Toggle opacity |

## Note

Use this tool only where recording, transcription, and AI assistance are allowed.
