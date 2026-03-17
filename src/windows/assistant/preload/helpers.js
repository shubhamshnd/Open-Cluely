function invokeWithFallback(ipcRenderer, { channel, label, fallback, transformArgs }) {
  return (...args) => {
    const callArgs = typeof transformArgs === 'function' ? transformArgs(args) : args;

    console.log(`PreloadAPI: ${label} called`);

    return ipcRenderer.invoke(channel, ...callArgs).catch((error) => {
      console.error(`PreloadAPI: ${label} error:`, error);
      return typeof fallback === 'function' ? fallback(error) : fallback;
    });
  };
}

function createEventListener(ipcRenderer, { channel, label }) {
  return (callback) => {
    const handler = (_event, payload) => {
      try {
        callback(payload);
      } catch (error) {
        console.error(`PreloadAPI: ${label} callback error:`, error);
      }
    };

    ipcRenderer.on(channel, handler);

    return () => {
      console.log(`PreloadAPI: removing ${label} listener`);
      ipcRenderer.removeListener(channel, handler);
    };
  };
}

module.exports = {
  createEventListener,
  invokeWithFallback
};
