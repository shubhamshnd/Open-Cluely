# Open-Cluely Codebase Structure (Updated)

This is the current architecture and file-ownership map for the repository.
It is based on the actual code in `src/` after the renderer modular refactor.

## 1) Runtime Architecture

1. **Main process boot**
   - `src/main.js` calls `startApplication()` in `src/main-process/start-application.js`.
2. **Environment + state**
   - `.env` is loaded/sanitized via `src/bootstrap/environment.js`.
   - persisted UI/runtime choices are loaded from `cache/app-state.json` via `src/services/state/app-state.js`.
3. **Main-process composition**
   - `start-application.js` wires:
     - window controller
     - screenshot manager
     - Gemini runtime
     - AssemblyAI streaming service
     - all IPC handlers
4. **Preload bridge**
   - `src/windows/assistant/preload.js` exposes `window.electronAPI` through `contextBridge`.
   - API is modularized in `src/windows/assistant/preload/*`.
5. **Renderer UI**
   - `src/windows/assistant/renderer.html` + `styles.css` define UI.
   - `src/windows/assistant/renderer.js` orchestrates feature managers under `src/windows/assistant/renderer/features/*`.

## 2) Top-Level Files And Folders

- `package.json`: scripts, dependencies, and `electron-builder` configuration.
- `.env` / `.env.example`: runtime secrets and defaults contract.
- `README.md`: setup, usage, and high-level docs.
- `BUILD_INSTRUCTIONS.md`: build/package walkthrough.
- `SETUP-VOSK.md`: legacy STT setup notes (project now uses AssemblyAI modules in active flow).
- `notes.md`: this architecture map.
- `src/`: all application source.
- `assets/`: icons and packaging assets.
- `cache/`: generated persisted state in development (`app-state.json`).
- `.stealth_screenshots/`: generated screenshots in development.
- `dist/`: packaged output.

## 3) `src/` Detailed File Ownership

### `src/main.js`
- Thin entrypoint. Starts app by calling `startApplication()` and exits on fatal startup failure.

### `src/config.js`
- Central source of truth for:
  - Gemini model list
  - AssemblyAI speech model list
  - programming-language list
  - global shortcut definitions
- Exposes getters/resolvers and shortcut lookup helpers.

### `src/bootstrap/environment.js`
- Handles env file path resolution (dev vs packaged).
- Loads `.env` with `dotenv`.
- Normalizes values (booleans, ints, key arrays).
- Validates required keys (`GEMINI_API_KEY`, `ASSEMBLY_AI_API_KEY`).
- Persists settings back to `.env` through `saveApplicationEnvironment`.

### `src/main-process/`

#### `src/main-process/start-application.js`
- Main composition root for Electron app lifecycle.
- Initializes and wires:
  - window controller
  - screenshot manager
  - Gemini runtime
  - AssemblyAI service
  - assistant/settings/assembly IPC registrations
- Loads persisted app state and restores model/language/opacity/key-index.
- Registers global shortcuts and lifecycle hooks (`whenReady`, `activate`, `will-quit`).

#### `src/main-process/startup-logging.js`
- Logs startup config values (keys presence, selected defaults, lists).

#### `src/main-process/shared/safe-send.js`
- Safe wrapper for `webContents.send` to avoid sending to destroyed/crashed renderer.

#### `src/main-process/features/window/window-constants.js`
- Window defaults and constraints:
  - default/min width/height
  - opacity bounds and default
  - stealth opacity delta

#### `src/main-process/features/window/window-controller.js`
- Owns BrowserWindow runtime behavior:
  - create/destroy/get window
  - opacity application + stealth mode toggle
  - emergency hide behavior
  - guarded recovery/reload handlers
  - set/get bounds with work-area clamping
  - global shortcut registration and movement shortcuts

#### `src/main-process/features/assistant/gemini-runtime.js`
- Runtime controller around `GeminiService`:
  - model/language/key configuration
  - active-key index tracking and persistence callback
  - key rotation/failover logic on quota/auth errors
  - wrapper for executing operations with automatic key fallback

#### `src/main-process/features/assistant/screenshot-manager.js`
- Screenshot lifecycle:
  - stealth capture with temporary low-opacity window
  - screenshot directory management
  - screenshot retention cap cleanup
  - conversion to Gemini multimodal image parts
  - clear/cleanup helpers

#### `src/main-process/features/assistant/ipc.js`
- Assistant and AI-related IPC handlers:
  - screenshot analysis
  - Ask AI with transcript + optional screenshots
  - suggestions/notes/insights/email/QA helpers
  - clear conversation/history
  - close app
- Maps raw Gemini/runtime errors into user-facing messages.

#### `src/main-process/features/settings/ipc.js`
- Settings IPC handlers:
  - `get-settings` returns current keys, models, languages, shortcuts, opacity
  - `save-settings` persists `.env` + `app-state.json`, reapplies runtime config

### `src/services/`

#### `src/services/ai/gemini-service.js`
- Core Gemini service wrapper:
  - model init/re-init
  - request queue + rate limiting + retry/backoff
  - quota/auth error detection helpers
  - conversation history storage
  - feature methods (`analyzeScreenshots`, `askAiWithSessionContext`, notes/insights/etc.)

#### `src/services/ai/prompts.js`
- Prompt builder library for all Gemini tasks:
  - screenshot analysis
  - ask-ai session mode
  - suggestions
  - meeting notes
  - follow-up email
  - direct question answering
  - conversation insights
- Applies programming-language preference policy and language-specific guidance.

#### `src/services/assembly-ai/service.js`
- AssemblyAI streaming backend:
  - per-source WS connect/start/stop
  - partial/final transcript events to renderer
  - audio chunk intake and heartbeat/drop debug
  - source state resets and cleanup
  - non-streaming transcription endpoint flow (`upload` -> `transcript` -> polling)

#### `src/services/assembly-ai/stt-history.js`
- Merges and buffers final STT segments per source.
- Flushes merged transcripts into Gemini history on pause/stop/termination.
- Handles overlap-aware transcript merge to reduce duplicate fragments.

#### `src/services/assembly-ai/ipc.js`
- IPC adapter for AssemblyAI service:
  - start/stop voice recognition
  - audio chunk forwarding
  - desktop source listing
  - offline transcription call

#### `src/services/state/app-state.js`
- Persisted app-state read/write/sanitize for `cache/app-state.json`.
- Stores key index, selected models/language, and window opacity level.

### `src/windows/assistant/`

#### `src/windows/assistant/window.js`
- BrowserWindow creation/config for transparent overlay window.
- Permission handlers for media/microphone.
- Content protection setup (`setContentProtection`).
- Initial visibility behavior (`launchHidden` aware).

#### `src/windows/assistant/preload.js`
- Exposes `window.electronAPI` through `contextBridge`.
- Uses `createElectronApi` factory from `preload/create-electron-api.js`.

#### `src/windows/assistant/preload/create-electron-api.js`
- Composes invoke and event API modules into one renderer-facing object.

#### `src/windows/assistant/preload/actions.js`
- All `ipcRenderer.invoke` wrappers used by renderer.
- Includes fallbacks and consistent logging through helper factory.

#### `src/windows/assistant/preload/listeners.js`
- Renderer event subscription wrappers for all push events from main process.

#### `src/windows/assistant/preload/helpers.js`
- Utility factories:
  - `invokeWithFallback`
  - `createEventListener`

#### `src/windows/assistant/renderer.html`
- Main UI layout:
  - top controls and action buttons
  - transcription monitor
  - AI chat area + composer
  - settings panel
  - close confirmation modal
  - loading/emergency overlays
  - resize handles

#### `src/windows/assistant/styles.css`
- Full visual system for overlay UI:
  - glass theme variables
  - chat/transcription/settings styling
  - dark theme support
  - resize-handle and interaction styling
  - responsive layout behavior

#### `src/windows/assistant/renderer-globals.d.ts`
- Global renderer typing for `window.electronAPI`.

#### `src/windows/assistant/pcm-capture-worklet.js`
- AudioWorklet processor that batches PCM float samples and posts chunks to main thread.

#### `src/windows/assistant/renderer.js`
- Renderer composition root.
- Instantiates managers and wires dependencies:
  - message store/context bundle
  - chat UI manager
  - window adjustment manager
  - shortcut manager
  - settings panel manager
  - transcription manager
  - listener modules
- Owns high-level UI actions and feature flows:
  - Ask AI / Screen AI
  - suggestions/notes/insights
  - theme switching
  - feedback/loading overlays
  - close confirmation

### `src/windows/assistant/renderer/features/ai-context/`

#### `message-types.js`
- Message-type classification and context/summary line formatting rules.

#### `message-store.js`
- In-memory chat message records:
  - add/clear/find
  - toggle `includeInAi`
  - inclusion rules for AI context

#### `context-bundle.js`
- Builds token-budgeted AI context bundle from included messages.
- Produces:
  - `contextString`
  - `transcriptContext`
  - `sessionSummary`
  - enabled screenshot IDs

#### `toggle-ui.js`
- Applies include/exclude toggle state to rendered chat message DOM.

### `src/windows/assistant/renderer/features/chat/`

#### `chat-ui-manager.js`
- Chat rendering and local UX behavior:
  - message card rendering
  - AI formatting for markdown-like blocks
  - auto-scroll behavior
  - composer auto-resize
  - manual context message submission

### `src/windows/assistant/renderer/features/layout/`

#### `window-adjustments.js`
- Renderer-side window resize handle behavior.
- Uses `electronAPI.getWindowBounds/setWindowBounds` and pointer events.
- Enforces chat fill layout after viewport changes.

### `src/windows/assistant/renderer/features/listeners/`

#### `event-listeners.js`
- All DOM/event wiring in one place:
  - button clicks
  - chat input handlers
  - keyboard shortcuts
  - context-menu/select/drag suppression

#### `ipc-listeners.js`
- All renderer IPC subscriptions:
  - screenshot/analysis/status events
  - STT status/partial/final/error/stopped events
  - global shortcut events
  - STT debug event relay to monitor log
  - global renderer error/unhandled rejection logging

### `src/windows/assistant/renderer/features/settings/`

#### `shortcut-manager.js`
- Parses accelerator strings and evaluates keyboard events against shortcut ids.
- Renders read-only shortcut list in settings panel.

#### `settings-panel-manager.js`
- Settings panel behavior:
  - load and populate fields/options from `getSettings`
  - opacity label handling
  - save/apply settings via `saveSettings`

### `src/windows/assistant/renderer/features/transcription/`

#### `transcription-manager.js`
- Renderer-side transcription orchestration:
  - source toggles and status state
  - monitor UI updates and monitor logs
  - mic/system start/stop lifecycle
  - partial/final transcript handling
  - buffering/flush integration

### `src/windows/assistant/renderer/features/assembly-ai/`

#### `source-state.js`
- Shared source selection/status/active state model for renderer.

#### `audio-pipeline.js`
- WebAudio capture and processing pipeline:
  - desktop/mic stream handling
  - downsampling to 16 kHz
  - frame batching and PCM16 conversion
  - chunk emission via `sendAudioChunk`

#### `transcript-buffer.js`
- Final transcript merge/buffer/flush logic in renderer before chat commit.

### `src/windows/legacy/`

#### `whisper-worker.js`
- Legacy Whisper worker implementation (not in active production flow).

#### `renderer-whisper-backup.js`
- Legacy backup renderer for old Whisper-based approach.

#### `renderer-webspeech-broken.js`
- Legacy experimental Web Speech renderer (deprecated/broken path).

## 4) Quick Boundaries (What Goes Where)

- **`src/main-process/**`**: Electron main-process orchestration and IPC registration.
- **`src/services/**`**: reusable domain logic (AI, STT, state persistence).
- **`src/windows/assistant/preload/**`**: secure IPC bridge exposed to renderer.
- **`src/windows/assistant/renderer/features/**`**: renderer feature modules only.
- **`src/windows/legacy/**`**: reference-only old experiments.

## 5) Practical Guidance For New Changes

- Add new renderer behavior under `renderer/features/*` and keep `renderer.js` as composition/orchestration.
- Add new invoke/listener APIs under `windows/assistant/preload/*` and register matching IPC in main process.
- Keep configurable lists/defaults/shortcuts in `src/config.js`.
- When adding env fields, update together:
  - `src/bootstrap/environment.js`
  - `.env.example`
  - `README.md`
