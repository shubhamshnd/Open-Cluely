class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunkSize = 2048;
    this.buffer = new Float32Array(this.chunkSize * 4);
    this.writeOffset = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }

    const channelData = input[0];
    if (!channelData || channelData.length === 0) {
      return true;
    }

    this.pushSamples(channelData);
    return true;
  }

  pushSamples(channelData) {
    let readOffset = 0;
    while (readOffset < channelData.length) {
      const freeSpace = this.buffer.length - this.writeOffset;
      const toCopy = Math.min(freeSpace, channelData.length - readOffset);
      this.buffer.set(channelData.subarray(readOffset, readOffset + toCopy), this.writeOffset);
      this.writeOffset += toCopy;
      readOffset += toCopy;

      while (this.writeOffset >= this.chunkSize) {
        const chunk = this.buffer.slice(0, this.chunkSize);
        this.port.postMessage(chunk);

        const remaining = this.writeOffset - this.chunkSize;
        if (remaining > 0) {
          this.buffer.copyWithin(0, this.chunkSize, this.writeOffset);
        }
        this.writeOffset = remaining;
      }
    }
  }
}

registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
