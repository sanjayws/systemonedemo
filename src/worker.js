import { MODELS, LIMITS, InputError, validateRequest, validateResult, validateModelSize, modelPayload } from '../web/lib/schema.js';
import { modelError } from './model-errors.js';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};
const json = (data, status = 200, extra = {}) => Response.json(data, { status, headers: { ...SECURITY_HEADERS, 'Cache-Control': 'no-store', ...extra } });

async function boundedJson(request) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new InputError('Use application/json.', 415);
  if (Number(request.headers.get('content-length')) > LIMITS.bodyBytes) throw new InputError('Request is too large.', 413);
  if (!request.body) throw new InputError('Send a JSON request body.');
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0, body = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > LIMITS.bodyBytes) { await reader.cancel(); throw new InputError('Request is too large.', 413); }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body);
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError('Request body must be valid UTF-8 JSON.');
  } finally { reader.releaseLock(); }
}

async function evaluate(env, input, model, requestId) {
  const started = performance.now();
  const controller = new AbortController();
  let timer, validating = false;
  try {
    const payload = modelPayload(input, model);
    // Clef uses the System One schema; this is not a chat-completions call.
    const result = await Promise.race([
      env.AI.run(MODELS[model].id, payload, { signal: controller.signal }),
      new Promise((_, reject) => { timer = setTimeout(() => { reject(new Error('MODEL_TIMEOUT')); controller.abort(); }, 45000); }),
    ]);
    validating = true;
    return { model, status: 'success', latencyMs: Math.round(performance.now() - started), result: validateResult(result, input.questions, model) };
  } catch (error) {
    // Never return provider error strings or log submitted source content.
    const details = modelError(error, { timedOut: controller.signal.aborted, validating, hasImages: Boolean(input.images?.length) });
    console.error(JSON.stringify({ event: 'evaluation_failed', requestId, model, code: details.code, ...(details.providerCode ? { providerCode: details.providerCode } : {}) }));
    return { model, status: 'error', error: details };
  } finally { clearTimeout(timer); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const requestId = crypto.randomUUID();
    try {
      if (url.pathname === '/api/config') {
        if (request.method !== 'GET') return json({ error: { message: 'Use GET.' } }, 405, { Allow: 'GET' });
        return json({ mode: env.AI ? 'live' : 'offline', models: MODELS, limits: LIMITS });
      }
      if (url.pathname === '/api/evaluate') {
        if (request.method !== 'POST') return json({ error: { message: 'Use POST.' } }, 405, { Allow: 'POST' });
        const origin = request.headers.get('origin');
        if (origin && origin !== url.origin) throw new InputError('Use this playground’s own origin to make requests.', 403);
        const input = validateRequest(await boundedJson(request));
        validateModelSize(input);
        if (!env.AI) return json({ error: { code: 'AI_NOT_CONFIGURED', message: 'Live inference needs a Cloudflare Workers AI binding. Use npm run dev after Cloudflare login, or deploy this Worker to run Clef.' }, requestId }, 503);
        if (env.PLAYGROUND_LIMITER) {
          // Public, anonymous playground: shared IPs also share this allowance.
          const key = `evaluate:${request.headers.get('cf-connecting-ip') ?? 'local'}`;
          for (const model of input.models) {
            const { success } = await env.PLAYGROUND_LIMITER.limit({ key });
            if (!success) return json({ error: { code: 'RATE_LIMITED', message: 'The playground allows 20 model evaluations per minute. Wait a minute and try again.' }, requestId }, 429, { 'Retry-After': '60' });
          }
        }
        const runs = await Promise.all(input.models.map(model => evaluate(env, input, model, requestId)));
        const anySuccess = runs.some(run => run.status === 'success');
        return json({ runs, requestId }, anySuccess ? 200 : 502);
      }
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return json({ error: { message: 'Endpoint not found.' } }, 404);
      const asset = await env.ASSETS.fetch(request);
      const response = new Response(asset.body, asset);
      for (const [key, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(key, value);
      return response;
    } catch (error) {
      if (!(error instanceof InputError)) console.error(JSON.stringify({ event: 'request_failed', requestId, code: 'INTERNAL_ERROR' }));
      return json({ error: { code: error instanceof InputError ? 'INVALID_REQUEST' : 'INTERNAL_ERROR', message: error instanceof InputError ? error.message : 'The request could not be completed.' }, requestId }, error instanceof InputError ? error.status : 500);
    }
  },
};
