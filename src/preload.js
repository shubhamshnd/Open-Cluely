const { contextBridge, ipcRenderer } = require('electron');

// Expose stealth API to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Core stealth actions
  toggleStealth: () => ipcRenderer.invoke('toggle-stealth'),
  emergencyHide: () => ipcRenderer.invoke('emergency-hide'),
  takeStealthScreenshot: () => ipcRenderer.invoke('take-stealth-screenshot'),
  analyzeStealth: () => ipcRenderer.invoke('analyze-stealth'),
  clearStealth: () => ipcRenderer.invoke('clear-stealth'),
  getScreenshotsCount: () => ipcRenderer.invoke('get-screenshots-count'),
  
  // Event listeners with cleanup functions
  onScreenshotTakenStealth: (callback) => {
    const handler = (event, count) => callback(count);
    ipcRenderer.on('screenshot-taken-stealth', handler);
    return () => ipcRenderer.removeListener('screenshot-taken-stealth', handler);
  },
  
  onAnalysisStart: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('analysis-start', handler);
    return () => ipcRenderer.removeListener('analysis-start', handler);
  },
  
  onAnalysisResult: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('analysis-result', handler);
    return () => ipcRenderer.removeListener('analysis-result', handler);
  },
  
  onSetStealthMode: (callback) => {
    const handler = (event, enabled) => callback(enabled);
    ipcRenderer.on('set-stealth-mode', handler);
    return () => ipcRenderer.removeListener('set-stealth-mode', handler);
  },
  
  onEmergencyClear: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('emergency-clear', handler);
    return () => ipcRenderer.removeListener('emergency-clear', handler);
  },
  
  onError: (callback) => {
    const handler = (event, message) => callback(message);
    ipcRenderer.on('error', handler);
    return () => ipcRenderer.removeListener('error', handler);
  }
});