# Open-Cluely

Open-Cluely is a desktop meeting assistant built with Electron.

This project is a clone-style implementation inspired by Cluely and Parakeet AI.

## Current Status

- Transcription uses AssemblyAI streaming.
- Vosk has been replaced and is no longer part of the active transcription flow.

## Features

- Transparent always-on-top overlay UI
- Live speech transcription
- AI chat and response suggestions
- Screenshot capture and analysis
- Meeting notes and conversation insights
- Keyboard shortcuts for quick actions

## Requirements

- Node.js
- AssemblyAI API key
- Gemini API key
- Microphone permission

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure `.env`:
   ```bash
   GEMINI_API_KEY=your_gemini_key
   ASSEMBLY_AI_API_KEY=your_assemblyai_key
   GEMINI_MODEL=gemini-2.5-flash-lite
   ASSEMBLY_AI_SPEECH_MODEL=universal-streaming-english
   ```
3. Start the app:
   ```bash
   npm start
   ```

## Scripts

- `npm start` - run the app
- `npm run dev` - run with logs
- `npm run build` - build distributables

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Alt+Shift+V` | Toggle voice transcription |
| `Ctrl+Alt+Shift+S` | Capture screenshot |
| `Ctrl+Alt+Shift+A` | Analyze with AI |
| `Ctrl+Alt+Shift+X` | Emergency hide |
| `Ctrl+Alt+Shift+H` | Toggle opacity |

## Note

Use this tool only in contexts where recording, transcription, and AI assistance are allowed by policy and law.
