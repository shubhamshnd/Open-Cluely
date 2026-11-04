# Assets

Original Open Cluely app icons used by `electron-builder` (see the `build` section of `package.json`):

| File | Used for | Notes |
|------|----------|-------|
| `icon.png` | Source for Linux icons | 1024x1024 |
| `icon.ico` | Windows | 256x256 with 16/32/48 embedded |
| `icon.icns` | macOS | Generated with Pillow from `icon.png` |

Linux builds read the size-named set in `../build/icons/` (16 … 1024) — electron-builder only resolves icon sizes from file *names*, so a single `icon.png` would land in a bogus `hicolor/0x0/apps` directory inside the `.deb`.

To replace the icon, keep these file names and sizes, regenerate `build/icons/` from the new `icon.png`, then rebuild with `npm run build`.
The `.ico`, `.icns` and Linux set can be regenerated from a 1024x1024 PNG with Pillow:

```python
from PIL import Image
img = Image.open("icon.png").convert("RGBA")
img.save("icon.ico", sizes=[(16, 16), (32, 32), (48, 48), (256, 256)])
img.save("icon.icns")
for size in [16, 24, 32, 48, 64, 128, 256, 512, 1024]:
    img.resize((size, size), Image.LANCZOS).save(f"../build/icons/{size}x{size}.png")
```
