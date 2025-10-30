# Assets Folder - Chrome Icons Required

This folder should contain Chrome icon files for building the disguised executable.

## Required Files:

1. **chrome.ico** (Windows) - 256x256 or higher
2. **chrome.icns** (macOS) - For Mac builds
3. **chrome.png** (Linux) - 512x512 for Linux builds

## How to Get Chrome Icons:

### Method 1: Extract from Chrome Installation

**Windows:**
1. Navigate to: `C:\Program Files\Google\Chrome\Application\`
2. Find `chrome.exe`
3. Right-click → Properties → Icons tab
4. Use a tool like [ResourceHacker](http://www.angusj.com/resourcehacker/) to extract
5. Save as `chrome.ico` in this folder

### Method 2: Download from Icon Sites

**Recommended Sites:**
- https://icon-icons.com/icon/chrome/194617
- https://www.iconfinder.com/icons/386254/chrome_icon
- https://icons8.com/icons/set/chrome

**Download Requirements:**
- **Windows**: ICO format, 256x256 pixels minimum
- **macOS**: ICNS format (if building for Mac)
- **Linux**: PNG format, 512x512 pixels

### Method 3: Use Online Converter

If you have a Chrome PNG:
1. Go to: https://convertio.co/png-ico/
2. Upload Chrome PNG (high resolution)
3. Convert to ICO (256x256)
4. Download and save as `chrome.ico`

## File Placement:

After obtaining the icons, your folder should look like:
```
d:\Open-Cluely\assets\
  ├── chrome.ico     ← Windows icon (REQUIRED for building)
  ├── chrome.icns    ← macOS icon (optional)
  ├── chrome.png     ← Linux icon (optional)
  └── README.md      ← This file
```

## Verification:

Before building, verify:
- [ ] `chrome.ico` exists in this folder
- [ ] Icon is 256x256 or higher resolution
- [ ] Icon looks like the official Chrome logo

## Quick Build Test:

After adding icons, test the build:
```bash
npm run build
```

If successful, you should see:
- `dist/GoogleChrome.exe` with Chrome icon
- Icon visible in File Explorer
- Icon shows in Task Manager

## Troubleshooting:

**Icon doesn't show:**
- Make sure filename is exactly `chrome.ico`
- Check file is in ICO format (not renamed PNG)
- Resolution must be 256x256 or higher
- Try rebuilding with `--clean` flag

**Can't find Chrome icon:**
- Check `C:\Program Files\Google\Chrome\Application\chrome.exe`
- Use ResourceHacker to extract icon from chrome.exe
- Or download from icon sites listed above

---

**Note:** This is for educational purposes and authorized use only.
