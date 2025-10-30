# Build Instructions - Chrome Disguised Executable

This guide will help you build the app as a disguised Chrome executable.

## Prerequisites

1. **Node.js and npm** installed
2. **All dependencies** installed (`npm install`)
3. **Chrome icon files** (see below)

## Step 1: Get Chrome Icon

You need to obtain the official Chrome icon in multiple formats:

### Option A: Extract from Chrome Installation
1. Navigate to: `C:\Program Files\Google\Chrome\Application\`
2. Find `chrome.exe`
3. Use a tool like ResourceHacker or IconsExtract to extract the icon
4. Save as `chrome.ico`

### Option B: Download Chrome Icon
1. Go to: https://icon-icons.com/icon/chrome/194617
2. Download in these formats:
   - **Windows**: `chrome.ico` (256x256 or higher)
   - **macOS**: `chrome.icns`
   - **Linux**: `chrome.png` (512x512)

### Step 2: Place Icons in Assets Folder

Copy the icon files to the `assets/` folder:
```
d:\Open-Cluely\assets\
  ├── chrome.ico   (Windows)
  ├── chrome.icns  (macOS)
  └── chrome.png   (Linux)
```

## Step 3: Build the Application

### For Windows (Portable EXE):
```bash
npm run build
```

This will create: `dist/GoogleChrome.exe`

### Build Options:

**Portable (recommended for stealth):**
```bash
npm run build -- --win portable
```
- Creates: `dist/GoogleChrome.exe`
- No installation required
- Can be run from any location
- No registry entries

**NSIS Installer (for permanent installation):**
```bash
npm run build -- --win nsis
```
- Creates: `dist/Google Chrome (2) Setup.exe`
- Installs to Program Files
- Adds to Start Menu

## Step 4: Configure Environment

Before building, make sure your `.env` file is configured:

```env
GEMINI_API_KEY=your_api_key_here
```

The `.env` file will be automatically included in the build.

## Step 5: Run the Built Application

### Portable Version:
1. Navigate to `dist/`
2. Run `GoogleChrome.exe`
3. The app will run with Chrome icon and name

### Running in Background:
The app is configured to:
- Run with Chrome icon
- Show as "Google Chrome (2)" in Task Manager
- Be published by "Google LLC" (in properties)
- Use portable mode (no installation)

## Build Configuration Details

The app is configured with:

- **Product Name**: Google Chrome (2)
- **Executable Name**: GoogleChrome.exe
- **App ID**: com.google.chrome
- **Publisher**: Google LLC
- **Icon**: Chrome logo
- **Target**: Portable (no installer)

## Stealth Features

✅ Chrome icon in taskbar
✅ "Google Chrome (2)" in Task Manager
✅ Google LLC as publisher
✅ Portable (no installation traces)
✅ Runs in background
✅ Transparent overlay

## Testing the Build

After building:

1. **Check the file**:
   - Name: `GoogleChrome.exe`
   - Icon: Chrome logo
   - Location: `dist/GoogleChrome.exe`

2. **Run it**:
   ```bash
   cd dist
   ./GoogleChrome.exe
   ```

3. **Verify in Task Manager**:
   - Press `Ctrl + Shift + Esc`
   - Look for "Google Chrome (2)"
   - Should have Chrome icon

## Advanced: Custom Build Options

### Change the disguise name:
Edit `package.json`:
```json
"productName": "Your Custom Name"
```

### Change the output filename:
```json
"portable": {
  "artifactName": "YourName.exe"
}
```

### Add auto-start on Windows login:
Add this to your code in `main.js`:
```javascript
const { app } = require('electron');

app.setLoginItemSettings({
  openAtLogin: true,
  path: process.execPath
});
```

## Troubleshooting

### Icon not showing:
- Make sure `assets/chrome.ico` exists
- Icon must be 256x256 or higher
- Try rebuilding: `npm run build -- --win portable`

### Build fails:
- Run: `npm install electron-builder --save-dev`
- Clear cache: `npm run build -- --win portable --clean`

### .env file missing in build:
- Check `extraResources` in package.json
- Make sure `.env` file exists in root directory

## Security Notes

⚠️ **Important**: This tool is for educational purposes and authorized use only (interviews, meetings with consent).

- Use responsibly
- Obtain consent when required
- Follow local laws and regulations
- Do not use for malicious purposes

## File Locations After Build

```
d:\Open-Cluely\
├── dist/
│   ├── GoogleChrome.exe          ← Your built app
│   ├── win-unpacked/             ← Unpacked files (can delete)
│   └── builder-debug.yml         ← Build logs
├── assets/
│   └── chrome.ico                ← Chrome icon
├── src/                          ← Source code
└── package.json                  ← Build config
```

## Distribution

To share the app:
1. Copy `GoogleChrome.exe` from `dist/` folder
2. Make sure `.env` with GEMINI_API_KEY is in the same directory
3. Run the executable

## Updating

To rebuild after changes:
```bash
npm run build
```

This will overwrite the previous build in `dist/`.

---

**Built with:** Electron + Google Gemini AI
**Version:** 1.0.0
