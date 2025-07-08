// whisper-worker.js - Fixed Whisper Web Worker for Electron
// This is a complete working implementation based on the official Whisper Web demo

class PipelineFactory {
    static task = null;
    static model = null;
    static quantized = null;
    static instance = null;

    static async getInstance(progress_callback = null) {
        if (this.instance === null) {
            // Import Transformers.js dynamically in the worker
            const { pipeline, env } = await import('@xenova/transformers');
            
            // Configure environment for Electron
            env.allowLocalModels = false;
            env.allowRemoteModels = true;
            env.useBrowserCache = true;
            
            this.instance = pipeline(this.task, this.model, {
                quantized: this.quantized,
                progress_callback,
                revision: this.model?.includes("/whisper-medium") ? "no_attentions" : "main"
            });
        }
        return this.instance;
    }
}

class AutomaticSpeechRecognitionPipelineFactory extends PipelineFactory {
    static task = "automatic-speech-recognition";
    static model = null;
    static quantized = null;
}

// Listen for messages from the main thread
self.addEventListener("message", async (event) => {
    const message = event.data;
    
    try {
        let transcript = await transcribe(
            message.audio,
            message.model,
            message.multilingual,
            message.quantized,
            message.subtask,
            message.language,
        );
        
        if (transcript === null) return;

        // Send the result back to the main thread
        self.postMessage({
            status: "complete",
            task: "automatic-speech-recognition",
            data: transcript,
        });
    } catch (error) {
        console.error('Worker transcription error:', error);
        self.postMessage({
            status: "error",
            task: "automatic-speech-recognition",
            data: { message: error.message },
        });
    }
});

// Main transcription function
const transcribe = async (audio, model, multilingual, quantized, subtask, language) => {
    const isDistilWhisper = model.startsWith("distil-whisper/");
    
    let modelName = model;
    if (!isDistilWhisper && !multilingual && !model.endsWith('.en')) {
        modelName += ".en";
    }



    // Get the pipeline factory
    const p = AutomaticSpeechRecognitionPipelineFactory;
    
    // Check if we need to reload the model
    if (p.model !== modelName || p.quantized !== quantized) {
        p.model = modelName;
        p.quantized = quantized;

        // Dispose of the previous instance if it exists
        if (p.instance !== null) {
            (await p.getInstance()).dispose();
            p.instance = null;
        }
    }

    // Get the transcriber pipeline
    let transcriber = await p.getInstance((data) => {
        // Send progress updates to the main thread
        self.postMessage(data);
    });

    // Calculate time precision for timestamps
    const time_precision = transcriber.processor.feature_extractor.config.chunk_length /
        transcriber.model.config.max_source_positions;

    // Initialize chunk processing
    let chunks_to_process = [{
        tokens: [],
        finalised: false,
    }];

    // Callback for when a chunk is completed
    function chunk_callback(chunk) {
        let last = chunks_to_process[chunks_to_process.length - 1];
        Object.assign(last, chunk);
        last.finalised = true;

        // If this isn't the last chunk, prepare for the next one
        if (!chunk.is_last) {
            chunks_to_process.push({
                tokens: [],
                finalised: false,
            });
        }
    }

    // Callback for streaming results
    function callback_function(item) {
        let last = chunks_to_process[chunks_to_process.length - 1];
        last.tokens = [...item[0].output_token_ids];

        // Decode the current state and send update
        let data = transcriber.tokenizer._decode_asr(chunks_to_process, {
            time_precision: time_precision,
            return_timestamps: true,
            force_full_sequences: false,
        });

        self.postMessage({
            status: "update",
            task: "automatic-speech-recognition",
            data: data,
        });
    }

    // Run the transcription
    let output = await transcriber(audio, {
        top_k: 0,
        do_sample: false,
        chunk_length_s: isDistilWhisper ? 20 : 30,
        stride_length_s: isDistilWhisper ? 3 : 5,
        language: language,
        task: subtask,
        return_timestamps: true,
        force_full_sequences: false,
        callback_function: callback_function,
        chunk_callback: chunk_callback,
    }).catch((error) => {
        self.postMessage({
            status: "error",
            task: "automatic-speech-recognition", 
            data: error,
        });
        return null;
    });

    return output;
};

// Send ready message once the worker is loaded
self.postMessage({
    status: "ready",
    message: "Worker initialized and ready"
});