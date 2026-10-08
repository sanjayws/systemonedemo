import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest, validateResult, validateResponse, LIMITS } from '../web/lib/schema.js';
import { SCENARIOS, illustrativeResult } from '../web/lib/scenarios.js';

const questions = { answer: { type: 'choice', instructions: 'Choose', criteria: { yes: 'Yes', no: 'No' } } };
const input = () => ({ models: ['clef'], state: 'Evidence', questions });
const result = () => ({ model: 'clef', answers: { answer: { type: 'choice', choice: 'yes', confidence: 0.8, probabilities: { yes: 0.8, no: 0.2 } } }, usage: { input_tokens: 3, output_tokens: 1 } });

test('Model selectors must be allowlisted strings, including inside arrays', () => {
  for (const models of [[['clef']], [{}], [null], ['constructor'], ['clef', 'clef'], [], 'clef']) {
    assert.throws(() => validateRequest({ ...input(), models }), /Choose Clef/);
  }
  assert.throws(() => validateRequest({ ...input(), models: undefined, model: ['clef'] }), /Choose Clef/);
});

test('Structured evidence rejects excessive nesting, nonfinite numbers, and cycles', () => {
  let nested = {};
  for (let i = 0; i < 70; i++) nested = { child: nested };
  const cyclic = {}; cyclic.self = cyclic;
  for (const state of [nested, { value: Infinity }, cyclic]) assert.throws(() => validateRequest({ ...input(), state }), /JSON/);
  assert.deepEqual(validateRequest({ ...input(), state: [0, false, null, { valid: true }] }).state, [0, false, null, { valid: true }]);
});

test('Question, source, and aggregate option limits reject excessive requests', () => {
  assert.throws(() => validateRequest({ ...input(), state: 'a'.repeat(LIMITS.sourceChars + 1) }), /too long/);
  assert.throws(() => validateRequest({ ...input(), questions: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`q${i}`, questions.answer])) }), /between 1 and 16/);
  const criteria = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`option${i}`, 'An option']));
  const manyQuestions = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`q${i}`, { ...questions.answer, criteria }]));
  assert.throws(() => validateRequest({ ...input(), questions: manyQuestions }), /128/);
});

test('Image syntax, counts, individual bytes, and aggregate bytes are bounded', () => {
  const image = 'data:image/png;base64,aGVsbG8=';
  for (const images of [Array(5).fill(image), ['data:image/svg+xml;base64,AAAA'], ['data:image/png;base64,AA=A'], ['data:image/png;base64,A===']]) assert.throws(() => validateRequest({ ...input(), images }));
  const large = 'data:image/png;base64,' + Buffer.alloc(3 * 1024 * 1024).toString('base64');
  assert.throws(() => validateRequest({ ...input(), images: [large, large, large] }), /8 MiB/);
});

test('Result validation binds the model and exact set of question IDs', () => {
  assert.throws(() => validateResult(result(), questions, 'clef-flash'), /unexpected response/);
  const extra = result(); extra.answers.extra = { type: 'noul', noul: 1 };
  assert.throws(() => validateResult(extra, questions), /set of answers/);
  const unknown = result(); unknown.model = 'other';
  assert.throws(() => validateResult(unknown, questions), /unexpected response/);
});

test('Result validation strips unrecognized provider fields at every output level', () => {
  const raw = result(); raw.secret = 'private'; raw.answers.answer.debug = 'private'; raw.usage.debug = 'private';
  assert.deepEqual(validateResult(raw, questions, 'clef'), result());
});

test('Chosen options must match probabilities and token counts must be safe integers', () => {
  const wrong = result(); wrong.answers.answer.choice = 'no';
  assert.throws(() => validateResult(wrong, questions), /does not match/);
  const usage = result(); usage.usage.input_tokens = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => validateResult(usage, questions), /usage/);
  const probabilities = result(); probabilities.answers.answer.probabilities.yes = 0.5;
  assert.throws(() => validateResult(probabilities, questions), /sum to one/);
});

test('Score answers must match the requested rubric and weighted probabilities', () => {
  const scoreQuestions = { score: { type: 'score', instructions: 'Score', criteria: ['Low', 'High'] } };
  const score = { model: 'clef', answers: { score: { type: 'score', score: 0.8, confidence: 0.8, probabilities: { 0: 0.2, 1: 0.8 }, legend: { 0: 'Low', 1: 'High' } } }, usage: { input_tokens: 1, output_tokens: 1 } };
  assert.doesNotThrow(() => validateResult(score, scoreQuestions));
  score.answers.score.score = 0.1;
  assert.throws(() => validateResult(score, scoreQuestions), /does not match/);
  score.answers.score.score = 0.8; score.answers.score.legend[1] = 'Wrong';
  assert.throws(() => validateResult(score, scoreQuestions), /legend/);
});

test('Every illustrative result follows the same answer contract as live results', () => {
  for (const scenario of SCENARIOS.filter(item => item.example)) {
    const requestQuestions = Object.fromEntries(scenario.questions.map(({ id, ...question }) => [id, question]));
    for (const model of ['clef', 'clef-flash']) assert.doesNotThrow(() => validateResult({ ...illustrativeResult(scenario, model), usage: { input_tokens: 0, output_tokens: 0 } }, requestQuestions, model));
  }
});

test('Browser response validation rejects empty, duplicate, unknown, and malformed runs', () => {
  const run = { model: 'clef', status: 'success', latencyMs: 10, result: result() };
  for (const response of [null, {}, { runs: [] }, { runs: [null] }, { runs: [{ ...run, model: 'other' }] }, { runs: [{ ...run, latencyMs: -1 }] }, { runs: [{ model: 'clef', status: 'error' }] }]) assert.throws(() => validateResponse(response, input()));
  assert.throws(() => validateResponse({ runs: [run, run] }, { ...input(), models: ['clef', 'clef-flash'] }));
  assert.deepEqual(validateResponse({ runs: [run], requestId: 'id' }, input()), { runs: [run], requestId: 'id' });
  const failed = { model: 'clef-flash', status: 'error', error: { code: 'MODEL_ERROR', message: 'Unavailable' } };
  assert.equal(validateResponse({ runs: [run, failed] }, { ...input(), models: ['clef', 'clef-flash'] }).runs.length, 2);
});
