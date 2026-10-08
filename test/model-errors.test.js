import test from 'node:test';
import assert from 'node:assert/strict';
import { modelError } from '../src/model-errors.js';
import { validateResponse } from '../web/lib/schema.js';

test('Provider failures distinguish size, timeout, quota, capacity, image decoding, and access', () => {
  for (const [provider, code] of [[3006, 'MODEL_INPUT_TOO_LARGE'], [3007, 'MODEL_TIMEOUT'], [3008, 'MODEL_TIMEOUT'], [3036, 'AI_QUOTA_EXCEEDED'], [3040, 'MODEL_BUSY'], [5004, 'INVALID_IMAGE'], [5018, 'AI_ACCESS_DENIED'], [5016, 'AI_ACCESS_DENIED'], [3023, 'AI_ACCESS_DENIED'], [3041, 'AI_ACCESS_DENIED'], [5035, 'AI_PAID_PLAN_REQUIRED'], [5007, 'MODEL_UNAVAILABLE'], [3042, 'MODEL_UNAVAILABLE']]) {
    const details = modelError(new Error(`${provider}: private submitted content`), { hasImages: true });
    assert.equal(details.code, code);
    assert.equal(details.providerCode, provider);
    assert.ok(!JSON.stringify(details).includes('private submitted content'));
  }
});

test('Response validation and local timeouts are not attributed to account permissions', () => {
  assert.equal(modelError(new Error('Invalid probabilities'), { validating: true }).code, 'MODEL_RESPONSE_INVALID');
  assert.equal(modelError(new Error('Aborted'), { timedOut: true }).code, 'MODEL_TIMEOUT');
});

test('Cloudflare context estimates reject encoded images with a specific, private error', () => {
  const details = modelError(new Error('5021: private source exceeded context'), { hasImages: true });
  assert.equal(details.code, 'MODEL_CONTEXT_EXCEEDED');
  assert.equal(details.providerCode, 5021);
  assert.match(details.message, /context limit/);
  assert.ok(!details.message.includes('private source'));
});

test('Unknown provider errors stay private and image failures get relevant recovery instructions', () => {
  const details = modelError(new Error('private submitted content with 3036 in the middle'), { hasImages: true });
  assert.equal(details.code, 'MODEL_ERROR');
  assert.match(details.message, /smaller PNG or JPEG/);
  assert.equal(details.providerCode, undefined);
  assert.ok(!JSON.stringify(details).includes('private submitted content'));
  assert.equal(modelError(null).code, 'MODEL_ERROR');
});

test('The browser retains safe diagnostic codes and request references for failed runs', () => {
  const response = { requestId: 'test-reference', runs: [{ model: 'clef', status: 'error', error: modelError(new Error('5004: private')) }] };
  assert.deepEqual(validateResponse(response, { models: ['clef'] }), response);
  response.runs[0].error.providerCode = 'private';
  assert.equal(validateResponse(response, { models: ['clef'] }).runs[0].error.providerCode, undefined);
});
