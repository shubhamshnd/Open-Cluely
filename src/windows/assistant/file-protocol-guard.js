// ============================================================================
// FILE: PROTOCOL GUARD
// ============================================================================
// The assistant window registers a handler for the file: scheme. Without a
// guard it is a pass-through to the whole filesystem — and because the
// renderer runs with webSecurity disabled, any script running in the window
// could fetch() arbitrary local files, including cache/app-state.json where
// the API keys live.
//
// The only file: resources the app legitimately loads are its own renderer
// bundle (renderer.html, styles.css, renderer.js, pcm-capture-worklet.js),
// all under src/. Everything outside src/ is rejected.
// ============================================================================

const path = require('path');

// requestUrl → absolute filesystem path when it points inside srcRoot,
// otherwise null. Traversal (raw or percent-encoded) and look-alike sibling
// directories (/app/src-evil) are rejected.
function resolveAllowedFilePath(requestUrl, srcRoot, platform = process.platform) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(String(requestUrl || '')).pathname);
  } catch (_) {
    return null;
  }

  const pathImpl = platform === 'win32' ? path.win32 : path;
  if (platform === 'win32') {
    // file:///C:/... arrives as /C:/...
    pathname = pathname.replace(/^\/([A-Za-z]:\/)/, '$1');
  }

  const resolved = pathImpl.resolve(pathname);
  const root = pathImpl.resolve(srcRoot);
  if (resolved !== root && !resolved.startsWith(root + pathImpl.sep)) {
    return null;
  }
  return resolved;
}

module.exports = {
  resolveAllowedFilePath
};
