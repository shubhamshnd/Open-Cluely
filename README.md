# Open-Cluely

Open-Cluely is an Electron desktop copilot for technical interviews and live meetings. It combines AssemblyAI streaming transcription, screenshot capture, and Gemini-powered responses in a compact always-on-top window.

Use it only in environments where recording, transcription, screenshots, and AI assistance are allowed.

Open source alternative for Cluely and Parakeetai. Your Real-Time AI Interview Assistant 😉

## Looks

<img width="1137" height="1014" alt="image" src="https://github.com/user-attachments/assets/b9250f36-5623-45da-ab8e-8265ee079e92" />
<img width="1137" height="1019" alt="image" src="https://github.com/user-attachments/assets/68c14d18-fcb3-4ee5-9f98-d137b744156e" />

---

## Features

- Dual-source live transcription for host/system audio and microphone input, with per-source toggles and a live monitor.
- Four AI action buttons, each with a distinct purpose — described in detail below.
- Per-message `AI` / `Off` controls let you keep transcript chunks, screenshots, and prior AI replies visible while excluding them from future prompts.
- Multiple Gemini API keys are supported as a comma-separated list, with automatic failover on quota or authentication errors.
- Settings support Gemini model selection, AssemblyAI speech model selection, programming language preference, and window opacity.
- Session state is persisted to `cache/app-state.json`, and screenshot retention is bounded by `MAX_SCREENSHOTS`.
- **Mobile companion** — a built-in web server exposes a mobile-optimised chat interface on port `7823`. Open the **Network** URL printed at startup (e.g. `http://192.168.1.42:7823`) on a phone that shares the same network as the PC. USB tethering, Wi-Fi hotspot from the phone, or both being on the same Wi-Fi all work.

## AI Action Buttons

Each button sends a different slice of context to the AI and is designed for a different moment in the workflow.

### Ask AI

The full-context answer button. Use this when you want a complete, thorough response.

**What it sends:** all enabled transcript messages + all enabled screenshots + full conversation history.

**What it does:** reads the entire context as one unified thread, silently corrects speech-to-text recognition errors, identifies the actual question being asked (even across fragmented or imperfect transcript messages), and produces a complete answer.

**Output:**
- **Understanding** — one sentence confirming what it understood the question to be
- **Answer** — full response, as deep as the question requires
- For coding and algorithmic questions: **Approach → Full solution code → Time/Space complexity → Key points**

Use Ask AI when you need the complete answer, not just the opening move.

---

### Screen AI

The screenshot interpreter. Use this when the question or problem is visible on screen.

**What it sends:** only the screenshots currently enabled in context.

**What it does:** reads all visible text in the screenshot (constraints, function signatures, error messages, sample I/O), identifies what type of content it is (LeetCode problem, stack trace, terminal output, UI layout, architecture diagram), and responds accordingly.

**Output (for coding/debugging):**
- **Understanding → Approach → Complexity → Full runnable solution code → Explanation** (only if it adds value)

**Output (for non-coding screenshots — UI, architecture, docs):**
- **What I see → Answer → Key Points**

Use Screen AI when the problem is on your screen and you want a direct solution without needing to describe it in words.

---

### Suggest

The opening-move button. Use this when you want something ready to say right now, without the full depth of Ask AI.

**What it sends:** only the enabled transcript messages.

**What it does:** reads the full conversation flow, identifies where the discussion stands, and generates a concise spoken response — something you can say out loud immediately, not a written essay.

**Output:**
- **Best response (say this)** — 2–4 sentences, natural spoken language, technically accurate but not exhaustive
- **Key points** — 2–3 short anchor concepts to hold in mind and expand on if pushed
- **Optional follow-ups** — questions or angles the other person is likely to raise next

Use Suggest to open confidently. Use Ask AI when the interviewer pushes deeper and you need the full answer.

---

### Notes

The structured record button. Use this at any point to capture what has happened in the session.

**What it sends:** all enabled transcript messages and context.

**What it does:** organizes the conversation into a clean, topic-grouped document — correcting for STT noise throughout. Does not add inferences or assumptions not grounded in the actual conversation.

**Output (always all five sections, even if empty):**
- **Key Discussion Points** — main topics covered
- **Decisions Made** — with owner if mentioned
- **Action Items** — checkboxed, with owner and deadline if mentioned
- **Open Questions / Unresolved Items** — what was raised but not resolved
- **Next Steps** — what happens next based on the conversation

Use Notes to produce a shareable record at the end of a meeting or interview debrief.

## Installation

### Requirements

- Windows 10/11 is the primary development target for this repo; Linux is supported with the limitations listed below.
- Node.js `20.x` is recommended. The existing docs and environment were prepared around `20.20.1`.
- npm `10+`
- At least one Gemini API key (configured in the app Settings UI)
- A speech-to-text backend (configured in the app Settings UI): one AssemblyAI API key, or AWS credentials for Amazon Transcribe (see *Speech-to-text (STT) providers*)

**Linux screenshot support:** the primary capture path (`screenshot-desktop`) shells out to an external tool — install `gnome-screenshot`, `scrot`, or ImageMagick (`import`) on X11, or `grim` on Wayland. If none of these is present, the app automatically falls back to Electron's built-in `desktopCapturer` (works on X11 and on Wayland via the XDG desktop portal), which covers the common case with no extra install. If both paths fail, the UI shows an explicit error instead of failing silently.

### Setup

Windows (PowerShell):

```powershell
nvm install 20.20.1
nvm use 20.20.1
npm ci
Copy-Item .env.example .env
```

Linux / macOS (bash):

```bash
nvm install 20.20.1
nvm use 20.20.1
npm ci
cp .env.example .env
```

API keys are configured from the in-app Settings panel after launch.

On Linux under Wayland, global shortcuts may not register through the default Ozone backend. If they don't, start the app through XWayland:

```bash
npm start -- --ozone-platform=x11
```

Start the app:

```powershell
npm start
```

Useful variants:

```powershell
npm run dev
npm run start:hidden
```

### Recommended For Windows Use

For day-to-day use on Windows, prefer building the portable app and running the generated `.exe` instead of launching from source every time.

```powershell
npm run build:win
```

This creates:

```text
dist/OpenCluely.exe
```

You can then run the packaged app directly by double-clicking `dist/OpenCluely.exe`.

### Installing the .deb on Linux (Debian/Ubuntu)

`npm run build:linux` produces two artifacts: `dist/Open Cluely-<version>.AppImage` and `dist/open-cluely_<version>_amd64.deb`. Install the package with apt (resolves the dependencies for you):

```bash
sudo apt install ./dist/open-cluely_1.0.0_amd64.deb
open-cluely            # via /usr/bin/open-cluely (update-alternatives symlink)
# or from the app menu / activities: "Open Cluely"
```

The package installs the app to `/opt/Open Cluely/`, a `open-cluely.desktop` entry under `/usr/share/applications/`, and hicolor icons under `/usr/share/icons/hicolor/*/apps/open-cluely.png`. Runtime dependencies (`libgtk-3-0`, `libnss3`, `libxss1`, `libsecret-1-0`, …) are declared in the package and pulled in by apt. The installer's `postinst` marks `/opt/Open Cluely/chrome-sandbox` SUID root (`4755`), so the installed app runs with the Chromium sandbox enabled — no `--no-sandbox` needed (see the AppArmor note under *Known limitations on Linux*).

Settings and other runtime data live in the user-data directory: `~/.config/open-cluely/` (state in `cache/app-state.json`, screenshots in `.stealth_screenshots/`). Uninstalling the package does not touch them:

```bash
sudo apt remove open-cluely
```

### Native build tools

None are required. `package-lock.json` contains no `gypfile` entries and no install scripts that compile native code (the only `postinstall` is the harmless `opencollective-postinstall` banner), so `npm ci` does not need Visual Studio Build Tools, Python, or a C++ compiler on any OS.

### Known limitations on Linux

- **Content protection does not hide the window.** `HIDE_FROM_SCREEN_CAPTURE` / `setContentProtection` is only effective on Windows and macOS. On Linux the window is visible to screen capture and screen sharing.
- **Host audio on Linux uses PipeWire's `pw-record`.** The Host source runs `pw-record -P '{ stream.capture.sink=true }'` from the main process, which records the monitor of your *default playback output* (audio-only; no screen-share/portal session, no video). It needs a running PipeWire session and the `pw-record` tool (`pipewire-bin`/`pipewire-utils`). It does not change your default microphone/output or any other app's audio, the process is stopped when you stop transcription, close the window or quit. Verified on Ubuntu 26.04 / GNOME 50 / PipeWire; not tested on PulseAudio-only systems (the Host source reports an error there; use Mic). Windows/macOS are unchanged.
- **Screenshots have a fallback.** If no external tool (`gnome-screenshot`, `scrot`, `import`, `grim`) is installed, the app uses Electron's `desktopCapturer`. On Wayland this goes through the XDG desktop portal and may show a permission prompt.
- **Global shortcuts cannot fire while a native Wayland window has focus** (Electron 28 has no GlobalShortcuts-portal support). On GNOME, click **Add to GNOME shortcuts** under Settings → Keyboard Shortcuts to install them as real GNOME keyboard shortcuts that work in any window (single-instance `--action=<id>` launches; **Remove from GNOME shortcuts** reverts it, leaving your own custom shortcuts untouched). On other Wayland compositors, start with `--ozone-platform=x11` (see Setup) and keep an XWayland window focused.
- Both an AppImage and a `.deb` are built on Linux (see *Installing the .deb on Linux*); running the AppImage on newer distros may need `libfuse2`.
- **Chromium sandbox on Ubuntu 23.10+ / 24.04+:** Ubuntu's AppArmor policy blocks unprivileged user namespaces, which the Chromium sandbox needs when no SUID helper is installed. The `.deb` is unaffected — its `postinst` sets `chrome-sandbox` to mode `4755` (SUID root), so the installed app runs with the normal sandbox and no flags. The **AppImage cannot ship a SUID helper**, so if it fails to start with a sandbox error (`The SUID sandbox helper binary was found, but is not configured correctly` / `FATAL:...zygote`), either launch it with `--no-sandbox` (the GNOME shortcut script adds that flag automatically when the app runs from source or an AppImage), or — cleaner — install an AppArmor profile for the AppImage path such as `/etc/apparmor.d/open-cluely` containing `abi <abi/4.0>,` + `profile open-cluely "/home/<you>/Apps/Open Cluely-*.AppImage" flags=(unconfined) { userns, }` and run `sudo apparmor_parser -r /etc/apparmor.d/open-cluely`. Do **not** disable the restriction system-wide (`kernel.apparmor_restrict_unprivileged_userns`); the package never touches sysctl.

## Configuration

### Environment Variables

| Variable | Required | Notes |
|----------|----------|-------|
| `HIDE_FROM_SCREEN_CAPTURE` | No | Defaults to `true`. Controls `BrowserWindow.setContentProtection(...)`. |
| `START_HIDDEN` | No | Defaults to `false`. Also available at runtime via `npm run start:hidden` or `--start-hidden`. |
| `MAX_SCREENSHOTS` | No | Defaults to `50`. Old screenshots are deleted when the limit is exceeded. |
| `SCREENSHOT_DELAY` | No | Defaults to `300` ms. Delay used while briefly hiding the window before capture. |
| `NODE_ENV` | No | Defaults to `production`. `development` opens DevTools automatically. |
| `NODE_OPTIONS` | No | Defaults to `--max-old-space-size=4096`. |

On packaged builds (Windows portable, Linux AppImage/.deb, macOS), the capture/startup toggles above are controlled from the in-app Settings panel and persisted in `cache/app-state.json` under the user-data directory — `.env` only applies when running from source (`npm start`), so edit it before launching and treat it as a dev-only file.

### Source-Of-Truth Config

[`src/config.js`](./src/config.js) defines the app's configurable lists and defaults:

- Gemini models
- AssemblyAI speech models
- Programming language options for code-oriented prompts
- Global keyboard shortcuts

The first item in each model/language list is treated as the default.

### Speech-to-text (STT) providers

Settings → **Speech-to-text provider** picks the streaming transcription backend; only the selected provider's fields are shown, and the select is disabled while transcription is running (stop transcription to switch).

- **AssemblyAI** (default): needs one AssemblyAI API key. Streaming pricing is billed by AssemblyAI per session.
- **Amazon Transcribe**: streams 16 kHz PCM per source (`StartStreamTranscription`). Needs AWS credentials (below) and a region (default `us-east-1`); language is one of `en-US`, `en-IN`, `en-GB`, `en-AU`, `hi-IN`. Streaming costs **$0.0001667/second ≈ $0.60/hour per stream** (us-east-1 pricing) — Mic and Host are separate streams, so running both costs ≈ $1.20/hour. The IAM identity needs `transcribe:StartStreamTranscription`.
- An optional **custom vocabulary** (Settings → Custom words → *Create / update vocabulary*) improves recognition of names and jargon. The vocabulary is named `open-cluely-<language>` and also needs `transcribe:CreateVocabulary`, `transcribe:UpdateVocabulary` and `transcribe:GetVocabulary`. Transcribe phrases can't contain spaces, so spaces become hyphens (`REST API` → `REST-API`).

### AWS credentials (Bedrock and Amazon Transcribe)

One **AWS Auth Method** block in Settings is shared by Amazon Bedrock (AI provider) and Amazon Transcribe (STT provider); it appears when either is selected:

- **Default (AWS credential chain)** — no keys stored; the SDK resolves `AWS_PROFILE`, environment variables, `~/.aws`, or an instance role.
- **AWS profile** — a named profile from `~/.aws/config` / `~/.aws/credentials`. The app lists profile *names only* (Refresh re-reads the files); credential values are only ever read by the AWS SDK, never by the app.
- **Access key + secret (+ optional session token)** — static keys; the session token is only for temporary (STS) credentials.
- **Bedrock API key** — bearer key, sent as `Authorization: Bearer …`. **Bedrock only: Amazon Transcribe cannot use it.** Bedrock *model listing* (Fetch) needs SigV4 credentials and is unavailable in this mode.

### Persisted Files

- In development, state is written to `cache/app-state.json` at the repo root. Packaged builds (including the Windows portable one, whose EXE self-extracts to a fresh temp dir every launch) keep it in the per-user data directory instead: `~/.config/open-cluely/cache/app-state.json` on Linux, `%APPDATA%\open-cluely\cache\app-state.json` on Windows, `~/Library/Application Support/open-cluely/cache/app-state.json` on macOS.
- Development screenshots are stored in `.stealth_screenshots/`. Packaged builds store screenshots under the app's user-data path.
- Saving settings from the UI writes API-key values and selection state to `cache/app-state.json`.

## Mobile Companion

When the app starts, a lightweight HTTP + WebSocket server starts automatically on port `7823`, bound to all interfaces. Open the **Network** URL printed at startup (e.g. `http://192.168.1.42:7823`) on a phone that shares the same network as the PC. USB tethering, Wi-Fi hotspot from the phone, or both being on the same Wi-Fi all work — no app install required.

### Setup (one time)

1. Make sure the phone and PC can reach each other over the network. Any of these works:
   - **USB tethering** — plug your phone into your PC and enable tethering. On Android: **Settings → Network → Hotspot & Tethering → USB Tethering**. On iOS: **Settings → Personal Hotspot** (then connect via USB).
   - **Phone Wi-Fi hotspot** — turn on the phone's hotspot and connect the PC to it.
   - **Same Wi-Fi** — connect both devices to the same Wi-Fi network.
2. Look at the Electron app's terminal output for lines like `[MobileServer] Network: http://192.168.1.42:7823  (Wi-Fi)`.
3. Open one of those Network URLs in your phone's browser.

### Mobile interface

| Button | What it does |
|--------|-------------|
| **Screenshot** | Triggers a stealth desktop capture. A badge shows the current count. |
| **Ask AI** | Sends the typed context (and any captured screenshots) to the AI; response streams in real time. |
| **Auto-scroll** | Toggles whether new messages snap the view to the bottom. |
| **Clear** | Clears the Gemini conversation history. |

The text input above the toolbar lets you type a question or extra context before pressing **Ask AI** or the send button. The desktop view always shows the live transcript; the mobile view receives finalised transcripts and AI streams in sync.

The desktop top bar shows a **Mobile** pill with the LAN URL and connected-client count. Click it to copy the URL — handy for typing into the phone browser.

### If the URL doesn't work on a phone

If the phone shows `connection refused` or just times out while loading the URL, **Windows Firewall is almost always the cause**. Allow inbound TCP 7823 once, from an elevated PowerShell prompt:

```powershell
New-NetFirewallRule -DisplayName "Open-Cluely Mobile" -Direction Inbound -LocalPort 7823 -Protocol TCP -Action Allow -Profile Any
```

`-Profile Any` is important: rules created without it default to Domain/Private profiles only. A phone hotspot or unknown public Wi-Fi is usually classified as **Public**, which the default rule does not cover. This is the most common reason "other tools on ports 5000/5500 work but ours doesn't" — VS Code's Live Server and similar dev tools often add a `Profile=Any` rule the first time they prompt.

To remove the rule later:

```powershell
Remove-NetFirewallRule -DisplayName "Open-Cluely Mobile"
```

Other things to check:

- The **Mobile** pill in the desktop top bar must be lit (green or amber). Grey means the server is not running.
- Use a **non-virtual** LAN URL. Docker, WSL, VMware, Hyper-V, Tailscale, and similar tools add IPv4 interfaces that the phone cannot route to. The startup log and the pill tooltip flag these with `[virtual — phone probably cannot reach]`; pick a different URL.
- The phone must be on a network that can route to the PC. Public Wi-Fi (especially café/hotel) often blocks peer-to-peer traffic; switch to USB tethering or a phone hotspot.
- A VPN client on the PC sometimes hijacks LAN routing. Disconnect it, or add the LAN range to its split-tunnel exceptions.

Quick test (one-liner, from any shell on the PC) to confirm whether the firewall is the blocker:

```powershell
Test-NetConnection -ComputerName <your-LAN-IP> -Port 7823
```

If `TcpTestSucceeded : True` from the PC but the phone still cannot connect, the firewall rule is missing or wrong-profile. If `TcpTestSucceeded : False` even from the PC itself, the server isn't really listening (check the **Mobile** pill).

> The server binds to `0.0.0.0`. Anyone who can reach the host on port 7823 can drive the assistant — only run the app on networks you trust, or pair this with a firewall rule that allows only your phone's IP.

---

## Basic Workflow

1. Launch the app and confirm your API keys and models in Settings.
2. Start transcription and enable whichever sources you need: `Host`, `Mic`, or both.
3. Take screenshots when visual context is needed — a problem statement, error, or UI.
4. Use the right button for the moment:
   - **Suggest** to get a quick, speakable opening response from the transcript
   - **Ask AI** when you need the full, complete answer from all context
   - **Screen AI** when the problem is on your screen and you want a direct solution
   - **Notes** to capture a structured record of what was discussed and decided
5. Toggle noisy messages to `Off` before the next AI call so the prompt stays focused on what matters.
6. Optionally use the **mobile companion** on your phone for discreet control — trigger screenshots, ask AI, or run the mic without touching the desktop.

## Project Structure (Brief)

- `src/main-process/` is the Electron control plane (startup flow, window behavior, global shortcuts, and IPC registration).
- `src/main-process/features/mobile-server/` is the mobile companion — HTTP + WebSocket server (`server.js`) and the mobile UI (`mobile.html`).
- `src/services/` contains reusable domain logic (Gemini prompts/runtime behavior, AssemblyAI streaming/transcript history, persisted app-state).
- `src/windows/assistant/preload/` is the renderer-safe API boundary (`window.electronAPI` invoke + event wrappers).
- `src/windows/assistant/renderer/features/` contains modular UI logic (chat, listeners, settings, transcription, context bundling, layout).
- `src/windows/legacy/` contains old experiments and is not part of the active runtime path.

Detailed, file-by-file ownership is documented in [`notes.md`](./notes.md).

```text
src/
  bootstrap/             Environment loading, validation, and persistence
  main-process/          Startup orchestration, IPC wiring, window control, assistant runtime
    features/
      mobile-server/     Mobile companion HTTP+WS server and mobile UI HTML
  services/
    ai/                  Gemini service + prompt builders
    assembly-ai/         Streaming STT service + transcript history manager
    state/               App-state load/save helpers
  windows/
    assistant/
      preload/           `window.electronAPI` invoke/listener bridge
      renderer/features/ Renderer feature modules (chat, listeners, settings, transcription, AI context, layout)
      window.js          BrowserWindow creation/config
      renderer.js        Renderer composition root
    legacy/              Older experimental files kept out of the active flow
assets/                  Build icons and packaging assets
cache/                   Generated app state in development
.stealth_screenshots/    Session screenshots in development
dist/                    Packaged build output
repomix-output.txt       Single-file repository snapshot for AI/code review tooling
```

## Shortcuts

All keyboard shortcuts are customizable. Configure them in `src/config.js` to match your preference before building or running the app.

## Scripts

- `npm start` runs the app from source.
- `npm run start:hidden` launches it in background mode from source.
- `npm run dev` enables Electron logging.
- `npm test` runs every `test/*.test.js` file via `scripts/run-tests.js` (needs Node 20.19+ or 22.12+; older Node cannot import the renderer's ES modules; a bare `node --test test` fails on Node 24).
- `npm run build:win` creates the portable Windows executable.
- `npm run build:linux` creates the Linux AppImage and the `.deb` package.
- `npm run build:mac` creates the macOS build.
- `npm run build` builds for the current OS.

## Build

The recommended Windows build is the portable executable:

```powershell
npm run build:win
```

Expected output:

```text
dist/OpenCluely.exe
```

On Linux: `npm run build:linux` produces `dist/Open Cluely-1.0.0.AppImage` and `dist/open-cluely_1.0.0_amd64.deb` (see *Installing the .deb on Linux*).

Notes:

- This is the recommended way to use the app outside development because it gives you a standalone `.exe` to launch directly.
- `.env` is **not** bundled during packaging; packaged builds read settings from `cache/app-state.json` in the user-data directory (edit them from the in-app Settings panel).
- The current Windows build is configured as a portable `x64` target with:
  - Product name: `Open Cluely`
  - Executable name: `OpenCluely.exe`
  - App ID: `com.opencluely.app`
- If the build fails with a symlink privilege error, enable Windows Developer Mode or run the build from an elevated terminal.
- Original app icons live in [`assets/`](./assets/) (`icon.ico`, `icon.icns`, `icon.png`). Windows and macOS use them directly; Linux uses the size-named PNG set in `build/icons/` (regenerate from `assets/icon.png` when the icon changes) so the `.deb` installs proper `hicolor/<size>/apps` entries.

### Running The Built App

After building:

1. Open the `dist/` folder.
2. Run `OpenCluely.exe`.
3. If you want background launch behavior, either set `START_HIDDEN=true` before building or launch with:

```powershell
.\dist\OpenCluely.exe --start-hidden
```

### Build Checks

After packaging, verify:

- `dist/OpenCluely.exe` exists
- the executable shows the Open Cluely icon
- the app launches correctly without needing `npm start`

For a build-focused walkthrough, see [`BUILD_INSTRUCTIONS.md`](./BUILD_INSTRUCTIONS.md).

## Good Practices

- Keep `src/config.js` as the single source of truth for model lists, programming languages, and keyboard shortcuts.
- When adding or changing environment variables, update all three places together: [`src/bootstrap/environment.js`](./src/bootstrap/environment.js), [`.env.example`](./.env.example), and this README.
- Preserve Electron boundaries: renderer code should go through `preload` and IPC, not import main-process modules directly.
- Keep cursor behavior stealth-safe: interactive controls intentionally do not switch to per-button pointer cursors. This prevents screen-sharing viewers from inferring user actions from cursor-shape changes while hidden mode is active.
- Add new UI logic under `src/windows/assistant/renderer/features/` and new domain logic under `src/services/` or `src/main-process/features/`.
- The mobile server (`src/main-process/features/mobile-server/`) binds to `0.0.0.0`. Anyone who can reach the host on port 7823 can drive the assistant — only run the app on networks you trust, or pair this with a firewall rule that allows only your phone's IP.
- Treat [`src/windows/legacy/`](./src/windows/legacy/) as reference material unless you are intentionally reviving an old experiment.
- Re-test both `npm start` and the relevant packaging path when changing startup flow, window behavior, screenshots, IPC, or global shortcuts.
- Keep real keys out of Git. Use `.env`, and rely on `.env.example` for the documented contract.

## Repomix Snapshot

To regenerate the packed repository snapshot:

```powershell
npx repomix . --style plain -o repomix-output.txt
```

If you want to exclude generated artifacts while experimenting:

```powershell
npx repomix . --style plain -o repomix-output.txt -i "repomix-output.txt,cache/**"
```
## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=shubhamshnd/Open-Cluely&type=Date)](https://star-history.com/#shubhamshnd/Open-Cluely&Date)
