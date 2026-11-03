const { createInvokeActions } = require('./actions');
const { createEventActions } = require('./listeners');

function createElectronApi(ipcRenderer) {
  const invokeActions = createInvokeActions(ipcRenderer);
  const eventActions = createEventActions(ipcRenderer);

  return {
    ...invokeActions,
    ...eventActions,
    // process.platform from the preload's Node context; the renderer uses it
    // to pick the Linux host-audio path instead of guessing from the UA.
    platform: process.platform,
    log: (message) => {
      console.log('PreloadAPI log:', message);
    },
    isAvailable: () => true
  };
}

module.exports = {
  createElectronApi
};
