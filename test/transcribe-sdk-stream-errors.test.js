'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('safe handler preserves the SDK SigV4 event encoding byte for byte', async () => {
  const { Readable } = require('node:stream');
  const { eventStreamPayloadHandlerProvider } = require('@aws-sdk/eventstream-handler-node');
  const { safeEventStreamPayloadHandlerProvider } = require('../src/services/stt/safe-eventstream-handler');
  const { toUtf8, fromUtf8 } = require('@smithy/util-utf8');
  const originalNow = Date.now;
  Date.now = () => 1700000000000;
  try {
    const options = {
      utf8Encoder: toUtf8, utf8Decoder: fromUtf8,
      messageSigner: async () => ({ sign: async () => ({ signature: '12'.repeat(32) }) })
    };
    const collect = async provider => {
      const request = {
        headers: { authorization: `Signature=${'34'.repeat(32)}` }, query: {},
        body: Readable.from([Buffer.from('first audio event'), Buffer.from('second audio event')])
      };
      return provider(options).handle(async args => {
        const chunks = [];
        for await (const chunk of args.request.body) chunks.push(chunk);
        return Buffer.concat(chunks);
      }, { request });
    };
    assert.deepEqual(await collect(safeEventStreamPayloadHandlerProvider), await collect(eventStreamPayloadHandlerProvider));
  } finally {
    Date.now = originalNow;
  }
});

// Real SDK signing/serialization in an isolated process: a rejected HTTP
// request must not throw from an asynchronous pipeline callback. No AWS calls.
test('Transcribe SDK request rejection cannot crash the process while audio is flowing', () => {
  const probe = `
    const { TranscribeStreamingClient } = require('@aws-sdk/client-transcribe-streaming');
    const { createAwsTranscribeService } = require('./src/services/stt/aws-transcribe-service');
    let errors = 0;
    const service = createAwsTranscribeService({
      getTranscribeSettings: () => ({ awsAuth: { awsAuthMode: 'keys', awsAccessKeyId: 'FAKE', awsSecretAccessKey: 'FAKE' } }),
      getGeminiService: () => null,
      sendToRenderer: (name) => { if (name === 'vosk-error') errors++; },
      createClient: config => new TranscribeStreamingClient({ ...config, requestHandler: {
        handle: async request => { request.body.resume(); await new Promise(r => setTimeout(r, 10)); throw new Error('mock auth denied'); },
        destroy() {}
      } })
    });
    service.startAssemblyAiStream('system', { attemptId: 'sdk-rejection' });
    const timer = setInterval(() => service.handleAudioChunk({ source: 'system', data: Buffer.alloc(3200) }), 1);
    setTimeout(() => { clearInterval(timer); service.dispose(); if (errors !== 1) process.exit(2); console.log('CLEAN_EXIT'); }, 150);
  `;
  const child = spawnSync(process.execPath, ['-e', probe], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 5000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  });
  assert.equal(child.status, 0, `child crashed:\n${child.stderr}\n${child.stdout}`);
  assert.match(child.stdout, /CLEAN_EXIT/);
  assert.doesNotMatch(child.stderr, /ERR_STREAM_WRITE_AFTER_END|ERR_STREAM_PREMATURE_CLOSE|uncaught/i);
});
