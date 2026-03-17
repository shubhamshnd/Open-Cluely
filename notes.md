# Codebase Summary (Folder Ownership)

## `src/`
- `main.js`: thin Electron entrypoint that starts the app bootstrap flow.
- `config.js`: source of truth for model/language option lists and resolvers.

## `src/bootstrap/`
- `environment.js`: loads, validates, normalizes, and saves `.env` app settings.

## `src/main-process/`
- Purpose: main-process composition and feature wiring.
- `start-application.js`: orchestrates startup, lifecycle hooks, and IPC registration.
- `startup-logging.js`: startup config logging.
- `shared/safe-send.js`: guarded `sendToRenderer` helper.
- `features/assistant/`: screenshot manager, Gemini runtime wrapper, assistant IPC handlers.
- `features/window/`: window lifecycle, stealth behavior, shortcuts, bounds/opacity control.
- `features/settings/`: settings IPC handlers (`get-settings`, `save-settings`).

## `src/services/`
- Purpose: reusable domain services used by main process logic.
- `ai/`: Gemini integration and prompt builders.
  - `gemini-service.js`: request queue, model calls, history handling.
  - `prompts.js`: prompt templates/builders for Ask AI, notes, insights, etc.
- `assembly-ai/`: AssemblyAI streaming + transcription backend modules.
  - `service.js`: WebSocket lifecycle, stream state, transcribe flow.
  - `stt-history.js`: transcript merge/flush buffering.
  - `ipc.js`: AssemblyAI-related IPC channel registration.
- `state/`: persisted app state helpers (`cache/app-state.json` load/save/sanitize).

## `src/windows/assistant/`
- Purpose: active Electron window implementation (UI + preload bridge).
- `window.js`: BrowserWindow creation/configuration.
- `preload.js`: exposes `window.electronAPI`.
- `preload/`: modularized invoke/listener API construction for IPC.
- `renderer.html` + `styles.css`: UI structure and styling.
- `renderer.js`: renderer entry module and UI orchestration.
- `renderer/features/ai-context/`: AI include/exclude message toggle + context bundle building.
- `renderer/features/assembly-ai/`: renderer-side source state, audio pipeline, transcript buffering.
- `pcm-capture-worklet.js`: audio worklet used for PCM capture.

## `src/windows/legacy/`
- Old experimental/backed-up renderer/transcription files kept for reference, not part of active flow.
