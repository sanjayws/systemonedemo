export const MODELS = Object.freeze({
  clef: { id: '@cf/cloudflare/clef', label: 'Clef', size: '27B' },
  'clef-flash': { id: '@cf/cloudflare/clef-flash', label: 'Clef Flash', size: '9B' },
});
export const LIMITS = Object.freeze({ sourceChars: 32000, questionChars: 4000, questions: 16, choices: 32, totalOptions: 128, imageBytes: 4 * 1024 * 1024, totalImageBytes: 8 * 1024 * 1024, bodyBytes: 12 * 1024 * 1024, modelBodyBytes: 240 * 1024 });
export class InputError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function modelPayload(input, model) {
  return { model, state: input.state, questions: input.questions, ...(input.images?.length ? { images: input.images } : {}) };
}
export function modelRequestBytes(input) {
  const model = input.models.includes('clef-flash') ? 'clef-flash' : 'clef';
  return new TextEncoder().encode(JSON.stringify(modelPayload(input, model))).byteLength;
}
export function validateModelSize(input) {
  // Live Clef requests count base64 toward the context estimate (provider error 5021).
  // Leave headroom below its 65,536-token estimate, including source and questions.
  if (modelRequestBytes(input) > LIMITS.modelBodyBytes) throw new InputError(input.images?.length
    ? 'The images and text exceed the model request limit. Upload images through the playground to optimize them, or shorten the source and questions.'
    : 'The source and questions together exceed the model request limit. Shorten them and try again.', 413);
}
const text = (value, name, max) => {
  if (typeof value !== 'string' || !value.trim()) throw new InputError(`${name} must not be empty.`);
  if (value.length > max) throw new InputError(`${name} is too long (maximum ${max.toLocaleString()} characters).`);
  return value;
};

export function parseCriteria(value, type) {
  const lines = value.split('\n').map(line => line.trim()).filter(Boolean);
  if (type === 'score') return lines;
  const entries = lines.map(line => {
    const separator = line.indexOf('|');
    return separator < 0 ? [line, line] : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
  });
  if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new InputError('Each answer option needs a unique name.');
  return Object.fromEntries(entries);
}

export function validateRequest(body) {
  if (!object(body)) throw new InputError('Send a JSON object.');
  const models = body.models ?? [body.model ?? 'clef'];
  if (!Array.isArray(models) || !models.length || models.length > 2 || new Set(models).size !== models.length || models.some(model => typeof model !== 'string' || !Object.hasOwn(MODELS, model))) throw new InputError('Choose Clef, Clef Flash, or both.');
  let state = body.state;
  if (typeof state === 'string') {
    if (state.length > LIMITS.sourceChars) throw new InputError('Content A is too long.');
  } else if (object(state) || Array.isArray(state)) {
    let serialized;
    try { serialized = JSON.stringify(state); } catch { throw new InputError('Content A must be serializable JSON without excessive nesting.'); }
    if (serialized.length > LIMITS.sourceChars) throw new InputError('Content A is too long.');
    const pending = [[state, 0]];
    while (pending.length) {
      const [value, depth] = pending.pop();
      if (depth > 64) throw new InputError('Content A must use at most 64 levels of JSON nesting.');
      if (typeof value === 'number' && !Number.isFinite(value)) throw new InputError('Content A must contain finite JSON numbers.');
      if (value && typeof value === 'object') for (const child of Object.values(value)) pending.push([child, depth + 1]);
    }
  } else throw new InputError('Content A must be text, a JSON object, or a JSON array.');
  if (!object(body.questions)) throw new InputError('Add at least one question in Content B.');
  const entries = Object.entries(body.questions);
  if (!entries.length || entries.length > LIMITS.questions) throw new InputError(`Add between 1 and ${LIMITS.questions} questions.`);
  let totalOptions = 0;
  const questions = Object.create(null);
  for (const [id, question] of entries) {
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new InputError('Question IDs may contain letters, numbers, periods, dashes, and underscores.');
    if (!object(question) || !['noul', 'choice', 'score'].includes(question.type)) throw new InputError(`${id}: choose yes/no, choice, or score.`);
    const instructions = text(question.instructions, `${id}: question`, LIMITS.questionChars);
    const clean = { type: question.type, instructions };
    if (question.type === 'noul') {
      totalOptions += 2;
      if (question.criteria !== undefined) {
        if (!object(question.criteria) || Object.keys(question.criteria).some(key => !['true', 'false'].includes(key))) throw new InputError(`${id}: yes/no criteria may only define true and false.`);
        clean.criteria = Object.fromEntries(Object.entries(question.criteria).map(([key, value]) => [key, text(value, `${id}: ${key}`, 2000)]));
      }
    } else if (question.type === 'choice') {
      if (!object(question.criteria)) throw new InputError(`${id}: add answer options.`);
      const options = Object.entries(question.criteria);
      if (options.length < 2 || options.length > LIMITS.choices) throw new InputError(`${id}: add 2–${LIMITS.choices} answer options.`);
      clean.criteria = Object.fromEntries(options.map(([key, description]) => [text(key, `${id}: option name`, 100), text(description, `${id}: option description`, 2000)]));
      totalOptions += options.length;
    } else {
      if (!Array.isArray(question.criteria) || question.criteria.length < 2 || question.criteria.length > 10) throw new InputError(`${id}: add 2–10 score levels, lowest first.`);
      clean.criteria = question.criteria.map(level => text(level, `${id}: score level`, 2000));
      totalOptions += clean.criteria.length;
    }
    questions[id] = clean;
  }
  if (totalOptions > LIMITS.totalOptions) throw new InputError(`Use at most ${LIMITS.totalOptions} answer options across the questions.`);
  const images = body.images ?? [];
  if (!Array.isArray(images) || images.length > 4) throw new InputError('Attach up to four images.');
  let totalImageBytes = 0;
  for (const image of images) {
    if (typeof image !== 'string') throw new InputError('Images must be embedded PNG, JPEG, or WebP data URLs.');
    if (image.length > Math.ceil(LIMITS.imageBytes / 3) * 4 + 23) throw new InputError('Each image must be at most 4 MiB.');
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
    if (!match || match[2].length % 4 !== 0) throw new InputError('Use a valid PNG, JPEG, or WebP image.');
    const bytes = match[2].length / 4 * 3 - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0);
    if (bytes > LIMITS.imageBytes) throw new InputError('Each image must be at most 4 MiB.');
    totalImageBytes += bytes;
  }
  if (totalImageBytes > LIMITS.totalImageBytes) throw new InputError('Combined image size must be at most 8 MiB.');
  if (typeof state === 'string' && !state.trim() && !images.length) throw new InputError('Add source content or an image to Content A.');
  return { models, state, questions, ...(images.length ? { images } : {}) };
}

const probability = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
export function validateResult(result, questions, expectedModel) {
  if (!object(result) || !object(result.answers) || typeof result.model !== 'string' || !Object.hasOwn(MODELS, result.model) || (expectedModel && result.model !== expectedModel)) throw new Error('The model returned an unexpected response.');
  if (!object(result.usage) || !Number.isSafeInteger(result.usage.input_tokens) || result.usage.input_tokens < 0 || !Number.isSafeInteger(result.usage.output_tokens) || result.usage.output_tokens < 0) throw new Error('The model returned invalid usage data.');
  if (Object.keys(result.answers).length !== Object.keys(questions).length) throw new Error('The model returned an unexpected set of answers.');
  const answers = [];
  for (const [id, question] of Object.entries(questions)) {
    const answer = result.answers[id];
    if (!Object.hasOwn(result.answers, id) || !object(answer) || answer.type !== question.type) throw new Error('A model answer is missing or has an unexpected type.');
    if (question.type === 'noul') {
      if (!probability(answer.noul)) throw new Error('The model returned an invalid yes/no probability.');
      answers.push([id, { type: 'noul', noul: answer.noul }]);
    } else {
      const keys = question.type === 'choice' ? Object.keys(question.criteria) : question.criteria.map((_, i) => String(i));
      if (!object(answer.probabilities) || !probability(answer.confidence) || Object.keys(answer.probabilities).length !== keys.length || keys.some(key => !Object.hasOwn(answer.probabilities, key) || !probability(answer.probabilities[key]))) throw new Error('The model returned invalid option probabilities.');
      const sum = Object.values(answer.probabilities).reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 1) > 0.02) throw new Error('Model probabilities do not sum to one.');
      if (question.type === 'choice' && !keys.includes(answer.choice)) throw new Error('The model returned a choice outside the allowed options.');
      if (question.type === 'score' && (typeof answer.score !== 'number' || !Number.isFinite(answer.score) || answer.score < 0 || answer.score > keys.length - 1 || !object(answer.legend))) throw new Error('The model returned an invalid score.');
      const probabilities = Object.fromEntries(keys.map(key => [key, answer.probabilities[key]]));
      if (question.type === 'choice') {
        if (Math.max(...Object.values(probabilities)) - probabilities[answer.choice] > 0.000001) throw new Error('The model choice does not match its probabilities.');
        answers.push([id, { type: 'choice', choice: answer.choice, confidence: answer.confidence, probabilities }]);
      } else {
        if (Object.keys(answer.legend).length !== keys.length || keys.some(key => !Object.hasOwn(answer.legend, key) || answer.legend[key] !== question.criteria[Number(key)])) throw new Error('The model returned an unexpected score legend.');
        const weightedScore = keys.reduce((sum, key) => sum + Number(key) * probabilities[key], 0);
        if (Math.abs(answer.score - weightedScore) > 0.02) throw new Error('The model score does not match its probabilities.');
        answers.push([id, { type: 'score', score: answer.score, confidence: answer.confidence, probabilities, legend: Object.fromEntries(keys.map(key => [key, answer.legend[key]])) }]);
      }
    }
  }
  return { model: result.model, answers: Object.fromEntries(answers), usage: { input_tokens: result.usage.input_tokens, output_tokens: result.usage.output_tokens } };
}

export function validateResponse(response, request) {
  const invalid = () => { throw new Error('The server returned an unexpected response. Please try again.'); };
  if (!object(response) || !Array.isArray(response.runs) || response.runs.length !== request.models.length || new Set(response.runs.map(run => run?.model)).size !== request.models.length) invalid();
  const runs = response.runs.map(run => {
    if (!object(run) || !request.models.includes(run.model)) invalid();
    if (run.status === 'error') {
      if (!object(run.error) || typeof run.error.message !== 'string' || typeof run.error.code !== 'string') invalid();
      const providerCode = Number.isInteger(run.error.providerCode) && run.error.providerCode >= 1000 && run.error.providerCode <= 9999 ? run.error.providerCode : undefined;
      return { model: run.model, status: 'error', error: { code: run.error.code, message: run.error.message, ...(providerCode ? { providerCode } : {}) } };
    }
    if (run.status !== 'success' || !Number.isFinite(run.latencyMs) || run.latencyMs < 0) invalid();
    return { model: run.model, status: 'success', latencyMs: run.latencyMs, result: validateResult(run.result, request.questions, run.model) };
  });
  return { runs, ...(typeof response.requestId === 'string' ? { requestId: response.requestId } : {}) };
}
