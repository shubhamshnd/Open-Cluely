const { contextBridge, ipcRenderer } = require('electron');

console.log('Preload script loading...');

// Expose stealth API to renderer process with enhanced error handling
try {
  contextBridge.exposeInMainWorld('electronAPI', {
    // Core stealth actions
    toggleStealth: () => {
      console.log('PreloadAPI: toggleStealth called');
      return ipcRenderer.invoke('toggle-stealth').catch(err => {
        console.error('PreloadAPI: toggleStealth error:', err);
        return { error: err.message };
      });
    },
    
    emergencyHide: () => {
      console.log('PreloadAPI: emergencyHide called');
      return ipcRenderer.invoke('emergency-hide').catch(err => {
        console.error('PreloadAPI: emergencyHide error:', err);
        return { error: err.message };
      });
    },
    
    takeStealthScreenshot: () => {
      console.log('PreloadAPI: takeStealthScreenshot called');
      return ipcRenderer.invoke('take-stealth-screenshot').catch(err => {
        console.error('PreloadAPI: takeStealthScreenshot error:', err);
        return { error: err.message };
      });
    },
    
    analyzeStealth: () => {
      console.log('PreloadAPI: analyzeStealth called');
      return ipcRenderer.invoke('analyze-stealth').catch(err => {
        console.error('PreloadAPI: analyzeStealth error:', err);
        return { error: err.message };
      });
    },
    
    analyzeStealthWithContext: (context) => {
      console.log('PreloadAPI: analyzeStealthWithContext called with context length:', context?.length || 0);
      return ipcRenderer.invoke('analyze-stealth-with-context', context).catch(err => {
        console.error('PreloadAPI: analyzeStealthWithContext error:', err);
        return { error: err.message };
      });
    },
    
    clearStealth: () => {
      console.log('PreloadAPI: clearStealth called');
      return ipcRenderer.invoke('clear-stealth').catch(err => {
        console.error('PreloadAPI: clearStealth error:', err);
        return { error: err.message };
      });
    },
    
    getScreenshotsCount: () => {
      console.log('PreloadAPI: getScreenshotsCount called');
      return ipcRenderer.invoke('get-screenshots-count').catch(err => {
        console.error('PreloadAPI: getScreenshotsCount error:', err);
        return 0;
      });
    },
    
    // Voice functionality
    startVoiceRecognition: () => {
      console.log('PreloadAPI: startVoiceRecognition called');
      return ipcRenderer.invoke('start-voice-recognition').catch(err => {
        console.error('PreloadAPI: startVoiceRecognition error:', err);
        return { error: err.message };
      });
    },
    stopVoiceRecognition: () => {
      console.log('PreloadAPI: stopVoiceRecognition called');
      return ipcRenderer.invoke('stop-voice-recognition').catch(err => {
        console.error('PreloadAPI: stopVoiceRecognition error:', err);
        return { error: err.message };
      });
    },

    convertAudio: (audioData) => {
      console.log('PreloadAPI: convertAudio called');
      return ipcRenderer.invoke('convert-audio', audioData).catch(err => {
        console.error('PreloadAPI: convertAudio error:', err);
        return null;
      });
    },
    
    // Event listeners with cleanup functions and error handling
    onScreenshotTakenStealth: (callback) => {
      const handler = (event, count) => {
        console.log('PreloadAPI: onScreenshotTakenStealth event received, count:', count);
        try {
          callback(count);
        } catch (err) {
          console.error('PreloadAPI: onScreenshotTakenStealth callback error:', err);
        }
      };
      ipcRenderer.on('screenshot-taken-stealth', handler);
      return () => {
        console.log('PreloadAPI: removing onScreenshotTakenStealth listener');
        ipcRenderer.removeListener('screenshot-taken-stealth', handler);
      };
    },
    
    onAnalysisStart: (callback) => {
      const handler = () => {
        console.log('PreloadAPI: onAnalysisStart event received');
        try {
          callback();
        } catch (err) {
          console.error('PreloadAPI: onAnalysisStart callback error:', err);
        }
      };
      ipcRenderer.on('analysis-start', handler);
      return () => {
        console.log('PreloadAPI: removing onAnalysisStart listener');
        ipcRenderer.removeListener('analysis-start', handler);
      };
    },
    
    onAnalysisResult: (callback) => {
      const handler = (event, data) => {
        console.log('PreloadAPI: onAnalysisResult event received, data type:', typeof data);
        try {
          callback(data);
        } catch (err) {
          console.error('PreloadAPI: onAnalysisResult callback error:', err);
        }
      };
      ipcRenderer.on('analysis-result', handler);
      return () => {
        console.log('PreloadAPI: removing onAnalysisResult listener');
        ipcRenderer.removeListener('analysis-result', handler);
      };
    },
    
    onSetStealthMode: (callback) => {
      const handler = (event, enabled) => {
        console.log('PreloadAPI: onSetStealthMode event received, enabled:', enabled);
        try {
          callback(enabled);
        } catch (err) {
          console.error('PreloadAPI: onSetStealthMode callback error:', err);
        }
      };
      ipcRenderer.on('set-stealth-mode', handler);
      return () => {
        console.log('PreloadAPI: removing onSetStealthMode listener');
        ipcRenderer.removeListener('set-stealth-mode', handler);
      };
    },
    
    onEmergencyClear: (callback) => {
      const handler = () => {
        console.log('PreloadAPI: onEmergencyClear event received');
        try {
          callback();
        } catch (err) {
          console.error('PreloadAPI: onEmergencyClear callback error:', err);
        }
      };
      ipcRenderer.on('emergency-clear', handler);
      return () => {
        console.log('PreloadAPI: removing onEmergencyClear listener');
        ipcRenderer.removeListener('emergency-clear', handler);
      };
    },
    
    onError: (callback) => {
      const handler = (event, message) => {
        console.log('PreloadAPI: onError event received, message:', message);
        try {
          callback(message);
        } catch (err) {
          console.error('PreloadAPI: onError callback error:', err);
        }
      };
      ipcRenderer.on('error', handler);
      return () => {
        console.log('PreloadAPI: removing onError listener');
        ipcRenderer.removeListener('error', handler);
      };
    },
    
    // Voice recognition events
    onVoiceTranscript: (callback) => {
      const handler = (event, data) => {
        console.log('PreloadAPI: onVoiceTranscript event received');
        try {
          callback(data);
        } catch (err) {
          console.error('PreloadAPI: onVoiceTranscript callback error:', err);
        }
      };
      ipcRenderer.on('voice-transcript', handler);
      return () => {
        console.log('PreloadAPI: removing onVoiceTranscript listener');
        ipcRenderer.removeListener('voice-transcript', handler);
      };
    },
    
    onVoiceError: (callback) => {
      const handler = (event, error) => {
        console.log('PreloadAPI: onVoiceError event received, error:', error);
        try {
          callback(error);
        } catch (err) {
          console.error('PreloadAPI: onVoiceError callback error:', err);
        }
      };
      ipcRenderer.on('voice-error', handler);
      return () => {
        console.log('PreloadAPI: removing onVoiceError listener');
        ipcRenderer.removeListener('voice-error', handler);
      };
    },
    
    // Utility functions for debugging
    log: (message) => {
      console.log('PreloadAPI log:', message);
    },
    
    // Check if electronAPI is working
    isAvailable: () => {
      console.log('PreloadAPI: isAvailable check');
      return true;
    }
  });

  console.log('PreloadAPI: electronAPI exposed successfully');

} catch (error) {
  console.error('PreloadAPI: Failed to expose electronAPI:', error);
}

// Global error handler for preload script
process.on('uncaughtException', (error) => {
  console.error('PreloadAPI: Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('PreloadAPI: Unhandled rejection at:', promise, 'reason:', reason);
});

console.log('PreloadAPI: Preload script loaded successfully');