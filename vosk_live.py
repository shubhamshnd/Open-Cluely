#!/usr/bin/env python3
"""
Live Speech-to-Text using Vosk for Electron App
Streams results to stdout as JSON for real-time display
Model loads once and stays in memory - supports pause/resume
"""

import sounddevice as sd
import queue
import json
import sys
import os
import zipfile
import requests
import threading
import select
from pathlib import Path
from vosk import Model, KaldiRecognizer

class VoskLiveTranscriber:
    def __init__(self):
        """Initialize Vosk with the accurate US English model"""

        # Use the accurate en-us-0.22 model you mentioned
        self.model_name = "vosk-model-en-us-0.22"
        self.model_url = "https://alphacephei.com/vosk/models/vosk-model-en-us-0.22.zip"
        self.model_dir = Path.home() / ".vosk_models"
        self.model_path = self.model_dir / self.model_name

        # Ensure model directory exists
        self.model_dir.mkdir(parents=True, exist_ok=True)

        # Download model if needed
        if not self.model_path.exists():
            self.send_status("downloading", "Downloading Vosk model (one-time, ~1.8GB)...")
            self.download_model()

        self.send_status("loading", "Loading Vosk model...")
        self.model = Model(str(self.model_path))
        self.sample_rate = 16000
        self.recognizer = KaldiRecognizer(self.model, self.sample_rate)
        self.recognizer.SetWords(True)  # Get word-level timestamps
        self.audio_queue = queue.Queue()
        self.is_listening = False
        self.should_exit = False
        self.stream = None
        self.send_status("ready", "Vosk ready!")

    def send_status(self, status, message):
        """Send status update to Electron"""
        output = {
            "type": "status",
            "status": status,
            "message": message
        }
        print(json.dumps(output), flush=True)

    def send_partial(self, text):
        """Send partial (interim) result"""
        output = {
            "type": "partial",
            "text": text
        }
        print(json.dumps(output), flush=True)

    def send_final(self, text):
        """Send final result"""
        output = {
            "type": "final",
            "text": text
        }
        print(json.dumps(output), flush=True)

    def send_error(self, error):
        """Send error message"""
        output = {
            "type": "error",
            "error": str(error)
        }
        print(json.dumps(output), flush=True)

    def download_model(self):
        """Download and extract Vosk model"""
        try:
            zip_path = self.model_dir / f"{self.model_name}.zip"

            # Download with progress
            response = requests.get(self.model_url, stream=True)
            response.raise_for_status()

            total_size = int(response.headers.get('content-length', 0))
            downloaded = 0

            with open(zip_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
                        downloaded += len(chunk)
                        if total_size > 0:
                            percent = (downloaded / total_size) * 100
                            self.send_status("downloading", f"Downloading: {percent:.1f}%")

            self.send_status("extracting", "Extracting model...")
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                zip_ref.extractall(self.model_dir)

            zip_path.unlink()
            self.send_status("ready", "Model ready!")

        except Exception as e:
            self.send_error(f"Download failed: {e}")
            sys.exit(1)

    def audio_callback(self, indata, frames, time_info, status):
        """Callback for audio stream - only process if listening"""
        if status:
            self.send_error(f"Audio error: {status}")
        if self.is_listening:
            self.audio_queue.put(bytes(indata))

    def start_listening(self):
        """Start listening (audio capture)"""
        if self.is_listening:
            return

        self.is_listening = True
        # Clear the recognizer state
        self.recognizer = KaldiRecognizer(self.model, self.sample_rate)
        self.recognizer.SetWords(True)

        self.send_status("listening", "Listening...")

    def stop_listening(self):
        """Stop listening (pause audio processing)"""
        if not self.is_listening:
            return

        self.is_listening = False

        # Get final result before stopping
        try:
            final_result = json.loads(self.recognizer.FinalResult())
            text = final_result.get('text', '').strip()
            if text:
                self.send_final(text)
        except:
            pass

        self.send_status("stopped", "Stopped listening")

    def run(self):
        """Main loop - keeps model in memory, processes commands"""
        try:
            # Start audio stream (always running, but only process when is_listening=True)
            self.stream = sd.RawInputStream(
                samplerate=self.sample_rate,
                blocksize=8000,
                dtype='int16',
                channels=1,
                callback=self.audio_callback
            )

            with self.stream:
                # Auto-start listening
                self.start_listening()

                while not self.should_exit:
                    # Process audio queue
                    try:
                        data = self.audio_queue.get(timeout=0.1)

                        if self.recognizer.AcceptWaveform(data):
                            # Final result
                            result = json.loads(self.recognizer.Result())
                            text = result.get('text', '').strip()
                            if text:
                                self.send_final(text)
                        else:
                            # Partial result (real-time)
                            result = json.loads(self.recognizer.PartialResult())
                            text = result.get('partial', '').strip()
                            if text:
                                self.send_partial(text)
                    except queue.Empty:
                        continue

        except KeyboardInterrupt:
            self.stop_listening()
        except Exception as e:
            self.send_error(str(e))
            sys.exit(1)

def main():
    try:
        transcriber = VoskLiveTranscriber()
        transcriber.run()
    except Exception as e:
        output = {
            "type": "error",
            "error": str(e)
        }
        print(json.dumps(output), flush=True)
        sys.exit(1)

if __name__ == "__main__":
    main()
