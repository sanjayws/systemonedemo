import test from 'node:test';
import assert from 'node:assert/strict';
import { imageBudgets, prepareImages } from '../web/lib/images.js';
import { LIMITS, modelPayload, modelRequestBytes, validateModelSize } from '../web/lib/schema.js';
import worker from '../src/worker.js';

const input = () => ({ models: ['clef', 'clef-flash'], state: 'Inspect the attached image.', questions: { readable: { type: 'noul', instructions: 'Is text readable?' } } });

test('All images share the available budget, with unused space reassigned from small images', () => {
  assert.deepEqual(imageBudgets([10000, 500000, 500000], 190000), [10000, 90000, 90000]);
  assert.deepEqual(imageBudgets([500000, 10000, 500000, 10000], 180000), [80000, 10000, 80000, 10000]);
  const budgets = imageBudgets([900000, 800000, 700000], 100000);
  assert.equal(budgets.reduce((sum, size) => sum + size, 0), 100000);
});

test('Payload budget includes JSON overhead, Unicode, images, and the longer selected model name', () => {
  const request = { ...input(), state: '例'.repeat(1000), images: ['data:image/png;base64,AAAA'] };
  const payload = modelPayload(request, 'clef-flash');
  assert.equal(modelRequestBytes(request), Buffer.byteLength(JSON.stringify(payload)));
  assert.ok(modelRequestBytes(request) > JSON.stringify(payload).length);
  assert.doesNotThrow(() => validateModelSize(request));
  request.images = ['data:image/png;base64,' + 'A'.repeat(LIMITS.modelBodyBytes)];
  assert.throws(() => validateModelSize(request), error => error.status === 413);
});

test('Small images stay byte-for-byte unchanged and cancelled preparation never proceeds', async () => {
  const attachments = [{ dataUrl: 'data:image/png;base64,AAAA' }];
  const request = { ...input(), images: attachments.map(image => image.dataUrl) };
  assert.equal(await prepareImages(attachments, request, new AbortController().signal), attachments);
  await assert.rejects(prepareImages(attachments, request, AbortSignal.abort()), { name: 'AbortError' });
});

test('Oversized text and insufficient space for images fail before decoding or inference', async () => {
  const request = { ...input(), state: 'x'.repeat(LIMITS.modelBodyBytes) };
  await assert.rejects(prepareImages([], request, new AbortController().signal), /Shorten/);
  await assert.rejects(prepareImages([{}], { ...request, images: ['data:image/png;base64,AAAA'] }, new AbortController().signal), /too little room/);
});

test('A 1.4 MB image cannot reach the model unoptimized through the API', async () => {
  let calls = 0;
  const body = { ...input(), images: ['data:image/png;base64,' + Buffer.alloc(1400000).toString('base64')] };
  const request = new Request('https://playground.example/api/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const response = await worker.fetch(request, { AI: { run() { calls++; } } });
  assert.equal(response.status, 413);
  assert.equal(calls, 0);
  assert.match((await response.json()).error.message, /optimize/);
});
