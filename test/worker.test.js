import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { SCENARIOS } from '../web/lib/scenarios.js';
import { LIMITS, parseCriteria, validateRequest, validateResult } from '../web/lib/schema.js';

const payload = () => ({ model: 'clef', state: 'The store accepts returns within 30 days.', questions: { supported: { type: 'noul', instructions: 'Are returns accepted within 30 days?' } } });
const request = (body = payload(), headers = {}) => new Request('https://playground.example/api/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const result = model => ({ model, answers: { supported: { type: 'noul', noul: 0.9 } }, usage: { input_tokens: 48, output_tokens: 1 } });
const env = overrides => ({ AI: { run: async (_, body) => result(body.model) }, ASSETS: { fetch: async () => new Response('<html>Playground</html>', { headers: { 'content-type': 'text/html' } }) }, ...overrides });

test('Every shipped scenario is a valid System One request', () => {
  for (const scenario of SCENARIOS) assert.doesNotThrow(() => validateRequest({ model: 'clef', state: scenario.sourceType === 'json' ? JSON.parse(scenario.state) : scenario.state, questions: Object.fromEntries(scenario.questions.map(({ id, ...q }) => [id, q])) }));
});
test('Choice parsing preserves descriptions and rejects duplicate IDs', () => {
  assert.deepEqual(parseCriteria('yes | Supported\nunknown | Missing evidence', 'choice'), { yes: 'Supported', unknown: 'Missing evidence' });
  assert.throws(() => parseCriteria('a | First\na | Second', 'choice'), /unique/);
});
test('Blank evidence without images, invalid IDs, and unsupported models are rejected', () => {
  assert.throws(() => validateRequest({ ...payload(), state: '' }), /source content/);
  assert.throws(() => validateRequest({ ...payload(), model: 'some-arbitrary-model' }), /Choose Clef/);
  assert.throws(() => validateRequest({ ...payload(), questions: { 'bad id': payload().questions.supported } }), /Question IDs/);
});
test('Empty choices, too many score levels, and empty option labels are rejected', () => {
  for (const question of [{ type: 'choice', instructions: 'Pick', criteria: {} }, { type: 'choice', instructions: 'Pick', criteria: { '': 'Empty', good: 'Good' } }, { type: 'score', instructions: 'Rate', criteria: Array(11).fill('Level') }]) assert.throws(() => validateRequest({ ...payload(), questions: { decision: question } }));
});
test('Embedded images work with empty text; remote URLs and excessive image sizes do not', () => {
  assert.doesNotThrow(() => validateRequest({ ...payload(), state: '', images: ['data:image/png;base64,aGVsbG8='] }));
  assert.throws(() => validateRequest({ ...payload(), images: ['https://example.com/photo.png'] }), /valid/);
  assert.throws(() => validateRequest({ ...payload(), images: ['data:image/png;base64,' + 'AAAA'.repeat(Math.ceil(LIMITS.imageBytes / 3) + 1)] }), /4 MiB/);
});
test('Structured JSON state stays structured', () => {
  const state = { invoice: { overdue: 42 } };
  assert.deepEqual(validateRequest({ ...payload(), state }).state, state);
});
test('Worker calls exact allowlisted binding with the matching model selector', async () => {
  let captured;
  const response = await worker.fetch(request({ ...payload(), model: 'clef-flash' }), env({ AI: { run: async (id, body) => { captured = { id, body }; return result(body.model); } } }));
  assert.equal(response.status, 200);
  assert.equal(captured.id, '@cf/cloudflare/clef-flash'); assert.equal(captured.body.model, 'clef-flash');
  assert.deepEqual(JSON.parse(JSON.stringify(captured.body.questions)), payload().questions);
  assert.equal((await response.json()).runs[0].status, 'success');
});
test('Comparison preserves a successful model when the other fails', async () => {
  const response = await worker.fetch(request({ ...payload(), models: ['clef', 'clef-flash'] }), env({ AI: { run: async (_, body) => { if (body.model === 'clef-flash') throw new Error('private provider detail'); return result(body.model); } } }));
  assert.equal(response.status, 200);
  const data = await response.json(); assert.deepEqual(data.runs.map(run => run.status), ['success', 'error']);
  assert.ok(!JSON.stringify(data).includes('private provider detail'));
});
test('Complete provider failure returns 502 without exposing provider errors', async () => {
  const response = await worker.fetch(request(), env({ AI: { run: async () => { throw new Error('secret'); } } }));
  assert.equal(response.status, 502); assert.ok(!(await response.text()).includes('secret'));
});
test('Missing live binding is clearly reported; no fabricated inference is returned', async () => {
  const response = await worker.fetch(request(), env({ AI: undefined }));
  assert.equal(response.status, 503); assert.equal((await response.json()).error.code, 'AI_NOT_CONFIGURED');
});
test('Rate limiting happens before inference and counts both comparison evaluations', async () => {
  let calls = 0, modelCalls = 0;
  const response = await worker.fetch(request({ ...payload(), models: ['clef', 'clef-flash'] }), env({ PLAYGROUND_LIMITER: { limit: async () => ({ success: ++calls === 1 }) }, AI: { run: async () => { modelCalls++; return result('clef'); } } }));
  assert.equal(response.status, 429); assert.equal(response.headers.get('Retry-After'), '60'); assert.equal(calls, 2); assert.equal(modelCalls, 0);
});
test('Different browser origins, wrong methods, and non-JSON bodies are rejected', async () => {
  assert.equal((await worker.fetch(request(payload(), { Origin: 'https://other.example' }), env())).status, 403);
  assert.equal((await worker.fetch(new Request('https://playground.example/api/evaluate'), env())).status, 405);
  assert.equal((await worker.fetch(new Request('https://playground.example/api/evaluate', { method: 'POST', body: 'plain text' }), env())).status, 415);
});
test('Malformed and oversized requests never reach the model', async () => {
  const invalid = new Request('https://playground.example/api/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal((await worker.fetch(invalid, env())).status, 400);
  const oversized = request(payload(), { 'Content-Length': String(LIMITS.bodyBytes + 1) });
  assert.equal((await worker.fetch(oversized, env())).status, 413);
});
test('Invalid probability values or choices fail response validation', () => {
  assert.throws(() => validateResult({ ...result('clef'), answers: { supported: { type: 'noul', noul: NaN } } }, payload().questions));
  const questions = { label: { type: 'choice', instructions: 'Choose', criteria: { a: 'A', b: 'B' } } };
  assert.throws(() => validateResult({ model: 'clef', usage: { input_tokens: 1, output_tokens: 1 }, answers: { label: { type: 'choice', choice: 'unexpected', confidence: 0.9, probabilities: { a: 0.9, b: 0.1 } } } }, questions));
});
test('Assets get security headers and unknown API endpoints do not return HTML', async () => {
  const page = await worker.fetch(new Request('https://playground.example/'), env());
  assert.equal(page.status, 200); assert.ok(page.headers.get('Content-Security-Policy').includes("frame-ancestors 'none'"));
  const unknown = await worker.fetch(new Request('https://playground.example/api/missing'), env());
  assert.equal(unknown.status, 404); assert.match(unknown.headers.get('Content-Type'), /application\/json/);
});
test('Configuration reports local preview without exposing credentials', async () => {
  const response = await worker.fetch(new Request('https://playground.example/api/config'), env({ AI: undefined, SECRET: 'never return' }));
  const data = await response.json(); assert.equal(data.mode, 'offline'); assert.ok(!JSON.stringify(data).includes('never return'));
});

test('JSON media type must match exactly while parameters remain supported', async () => {
  assert.equal((await worker.fetch(request(payload(), { 'Content-Type': 'application/jsonp' }), env())).status, 415);
  assert.equal((await worker.fetch(request(payload(), { 'Content-Type': 'Application/JSON; charset=utf-8' }), env())).status, 200);
});

test('Chunked oversized bodies are cancelled before inference', async () => {
  let cancelled = false, called = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(LIMITS.bodyBytes + 1)); }, cancel() { cancelled = true; } });
  const response = await worker.fetch(new Request('https://playground.example/api/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, duplex: 'half' }), env({ AI: { run: async () => { called = true; } } }));
  assert.equal(response.status, 413); assert.equal(cancelled, true); assert.equal(called, false);
});

test('Invalid UTF-8 bodies and nonfinite JSON numbers are rejected', async () => {
  const badUtf8 = new Request('https://playground.example/api/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: new Uint8Array([0xff]) });
  assert.equal((await worker.fetch(badUtf8, env())).status, 400);
  const nonfinite = new Request('https://playground.example/api/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload(), state: { number: 'overflow' } }).replace('"overflow"', '1e999') });
  assert.equal((await worker.fetch(nonfinite, env())).status, 400);
});

test('Invalid provider results fail safely and private fields are never forwarded', async () => {
  const invalid = await worker.fetch(request(), env({ AI: { run: async () => ({ ...result('clef-flash'), debug: 'private' }) } }));
  assert.equal(invalid.status, 502); assert.ok(!(await invalid.text()).includes('private'));
  const valid = await worker.fetch(request(), env({ AI: { run: async () => ({ ...result('clef'), debug: 'private' }) } }));
  assert.equal(valid.status, 200); assert.ok(!(await valid.text()).includes('private'));
});

test('Inference timeout aborts the binding and returns a sanitized timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal, started;
  const ready = new Promise(resolve => { started = resolve; });
  const responsePromise = worker.fetch(request(), env({ AI: { run: (_, body, options) => { signal = options.signal; started(); return new Promise(() => {}); } } }));
  await ready;
  t.mock.timers.tick(45001);
  const response = await responsePromise;
  assert.equal(response.status, 502); assert.equal(signal.aborted, true);
  assert.equal((await response.json()).runs[0].error.code, 'MODEL_TIMEOUT');
});

test('API roots return JSON and rate-limit binding errors do not allow inference', async () => {
  const root = await worker.fetch(new Request('https://playground.example/api'), env());
  assert.equal(root.status, 404); assert.match(root.headers.get('Content-Type'), /application\/json/);
  let called = false;
  const response = await worker.fetch(request(), env({ PLAYGROUND_LIMITER: { limit() { throw new Error('private'); } }, AI: { run: async () => { called = true; } } }));
  assert.equal(response.status, 500); assert.equal(called, false); assert.ok(!(await response.text()).includes('private'));
});
