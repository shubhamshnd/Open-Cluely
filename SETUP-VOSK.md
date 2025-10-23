# Vosk Setup Guide

This guide provides detailed instructions for setting up Vosk speech recognition in Open-Cluely.

## Prerequisites

- Python 3.8 or newer
- pip (Python package installer)
- A working microphone
- At least 2GB of free disk space (for the model)

## Installation Steps

### 1. Install Python Dependencies

```bash
# Install Vosk
pip install vosk

# Install sounddevice for audio capture
pip install sounddevice

# Install requests (used for model download)
pip install requests
```

### 2. Model Download

When you first run Open-Cluely, it will automatically download the Vosk model (approximately 1.8GB). However, if you want to download it manually:

1. Create a models directory in your application folder
2. Download the model from [Vosk's model repository](https://alphacephei.com/vosk/models)
3. Extract the model files into the models directory

The default model used is `vosk-model-small-en-us-0.15`, which provides a good balance between accuracy and performance.

## Troubleshooting

### Common Issues

#### 1. No Microphone Access

**Symptoms:**
- No transcription appears
- Error messages about audio device

**Solutions:**
- Check if your microphone is properly connected
- Verify microphone permissions in your OS settings
- Try selecting a different audio input device

#### 2. Model Download Fails

**Symptoms:**
- Error during first launch
- Missing model files

**Solutions:**
- Check your internet connection
- Manually download the model (see Manual Model Installation below)
- Verify you have enough disk space

#### 3. Performance Issues

**Symptoms:**
- Delayed transcription
- High CPU usage

**Solutions:**
- Close other CPU-intensive applications
- Consider using a smaller model
- Ensure your Python installation matches your system architecture (32/64 bit)

### Manual Model Installation

If the automatic model download fails, you can install it manually:

1. Create a directory: `models`
2. Download the model from: https://alphacephei.com/vosk/models
3. Select `vosk-model-small-en-us-0.15` (recommended)
4. Extract the downloaded archive into the models directory
5. Verify the path structure matches: `models/vosk-model-small-en-us-0.15/`

## Advanced Configuration

### Selecting Different Models

Vosk offers various models with different sizes and languages. You can change the model by:

1. Downloading a different model from [Vosk Models](https://alphacephei.com/vosk/models)
2. Extracting it to the models directory
3. Updating the model path in the application settings

Available model types:
- Small models (~50MB) - Fast but less accurate
- Medium models (~1.8GB) - Good balance (recommended)
- Large models (~4GB) - Most accurate but slower

### Audio Device Selection

By default, the system's default microphone is used. To use a different audio device:

1. List available devices:
```python
import sounddevice as sd
print(sd.query_devices())
```

2. Note the device index you want to use
3. Update the device settings in your configuration

## System-Specific Notes

### Windows
- Ensure Microsoft Visual C++ Redistributable is installed
- Use Python 3.8+ 64-bit version
- Check Windows Security for microphone permissions

### macOS
- Grant microphone permissions in System Preferences
- Install Python through Homebrew for best compatibility

### Linux
- Install PortAudio development package:
  ```bash
  # Ubuntu/Debian
  sudo apt-get install portaudio19-dev
  
  # Fedora
  sudo dnf install portaudio-devel
  ```
- Ensure your user has audio device permissions

## Additional Resources

- [Vosk API Documentation](https://alphacephei.com/vosk/api)
- [Vosk Models Repository](https://alphacephei.com/vosk/models)
- [sounddevice Documentation](https://python-sounddevice.readthedocs.io/)

## Support

If you encounter any issues not covered in this guide:
1. Check the [GitHub Issues](https://github.com/yourusername/open-cluely/issues)
2. Create a new issue with:
   - Your system information
   - Error messages
   - Steps to reproduce the problem