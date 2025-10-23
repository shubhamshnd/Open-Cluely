#!/usr/bin/env python3
"""
Fast Audio Transcription Service using OpenAI Whisper
Runs as a subprocess, transcribes audio files, returns text
"""

import sys
import os
import json
import warnings
warnings.filterwarnings("ignore")

def transcribe_audio(audio_file_path):
    """Transcribe audio file using Whisper"""
    try:
        import whisper

        # Load base model for better accuracy (still fast on local machine)
        # Options: tiny, base, small, medium, large
        model = whisper.load_model("base")

        # Transcribe with better settings
        result = model.transcribe(
            audio_file_path,
            fp16=False,
            language="en",  # Force English for better accuracy
            condition_on_previous_text=True,  # Use context from previous text
            temperature=0.0  # More deterministic (less creative)
        )

        # Return just the text
        return {
            "success": True,
            "text": result["text"].strip()
        }

    except ImportError:
        return {
            "success": False,
            "error": "Whisper not installed. Run: pip install openai-whisper"
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({
            "success": False,
            "error": "Usage: python transcribe.py <audio_file_path>"
        }))
        sys.exit(1)

    audio_file = sys.argv[1]

    if not os.path.exists(audio_file):
        print(json.dumps({
            "success": False,
            "error": f"Audio file not found: {audio_file}"
        }))
        sys.exit(1)

    # Transcribe and output JSON
    result = transcribe_audio(audio_file)
    print(json.dumps(result))
