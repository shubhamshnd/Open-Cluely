const { createInvokeActions } = require('./actions');
const { createEventActions } = require('./listeners');

function createElectronApi(ipcRenderer) {
  const invokeActions = createInvokeActions(ipcRenderer);
  const eventActions = createEventActions(ipcRenderer);

  return {
    ...invokeActions,
    ...eventActions,
    log: (message) => {
      console.log('PreloadAPI log:', message);
    },
    isAvailable: () => true
  };
}

module.exports = {
  createElectronApi
};
