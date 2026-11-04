'use strict';

const { Readable, Transform, PassThrough, pipeline } = require('node:stream');
const { EventStreamCodec } = require('@smithy/eventstream-codec');

// SDK 3.967.0's Node eventstream handler throws pipeline errors from an
// asynchronous callback and ends the destination before signing has stopped.
// On early auth rejection this can crash Electron with write-after-end.
// Keep the SDK's SigV4 event encoding, but propagate errors through send()
// and destroy the whole pipeline together. Do not install global handlers.
function safeEventStreamPayloadHandlerProvider(options) {
  const codec = new EventStreamCodec(options.utf8Encoder, options.utf8Decoder);
  return {
    async handle(next, args) {
      const request = args.request;
      const payload = request.body;
      if (!(payload instanceof Readable)) {
        throw new Error('Eventstream payload must be a Readable stream.');
      }
      let priorSignature = request.headers?.authorization?.match(/Signature=([\w]+)$/)?.[1]
        ?? request.query?.['X-Amz-Signature'] ?? '';
      const signer = await options.messageSigner();
      const signing = new Transform({
        readableObjectMode: true,
        writableObjectMode: true,
        transform(chunk, _encoding, callback) {
          (async () => {
            const date = new Date(Date.now() + (options.systemClockOffset ?? 0));
            const headers = { ':date': { type: 'timestamp', value: date } };
            const signed = await signer.sign({ message: { body: chunk, headers }, priorSignature }, { signingDate: date });
            priorSignature = signed.signature;
            return codec.encode({
              headers: { ...headers, ':chunk-signature': { type: 'binary', value: Buffer.from(signed.signature, 'hex') } },
              body: chunk
            });
          })().then(data => callback(null, data), callback);
        }
      });
      const body = new PassThrough({ objectMode: true });
      request.body = body;
      // A successful pipeline is not a response; only its failures race the
      // HTTP request. Promise.race keeps rejection handled even after next()
      // has returned the long-lived response stream.
      const pipelineFailure = new Promise((_resolve, reject) => {
        pipeline(payload, signing, body, error => { if (error) reject(error); });
      });
      try {
        return await Promise.race([next(args), pipelineFailure]);
      } catch (error) {
        payload.destroy();
        signing.destroy();
        body.destroy();
        throw error;
      }
    }
  };
}

module.exports = { safeEventStreamPayloadHandlerProvider };
