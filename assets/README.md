# Assets

Original Open Cluely app icons used by `electron-builder` (see the `build` section of `package.json`):

| File | Used for | Notes |
|------|----------|-------|
| `icon.png` | Linux (AppImage) | 1024x1024 |
| `icon.ico` | Windows | 256x256 with 16/32/48 embedded |
| `icon.icns` | macOS | Generated with Pillow from `icon.png` |

To replace the icon, keep these file names and sizes, then rebuild with `npm run build`.
The `.ico` and `.icns` files can be regenerated from a 1024x1024 PNG with Pillow:

```python
from PIL import Image
img = Image.open("icon.png")
img.save("icon.ico", sizes=[(16, 16), (32, 32), (48, 48), (256, 256)])
img.save("icon.icns")
```
