function createSafeSender(getMainWindow) {
  return function sendToRenderer(channel, data) {
    const mainWindow = typeof getMainWindow === 'function' ? getMainWindow() : null;
    if (!mainWindow || mainWindow.isDestroyed()) return false;

    const contents = mainWindow.webContents;
    if (!contents || contents.isDestroyed()) return false;

    if (typeof contents.isCrashed === 'function' && contents.isCrashed()) {
      return false;
    }

    const frame = contents.mainFrame;
    if (frame && typeof frame.isDestroyed === 'function' && frame.isDestroyed()) {
      return false;
    }

    try {
      contents.send(channel, data);
      return true;
    } catch (error) {
      console.error(`Failed to send renderer event "${channel}":`, error.message);
      return false;
    }
  };
}

module.exports = {
  createSafeSender
};
