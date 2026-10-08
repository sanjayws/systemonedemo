const PROVIDER_ERRORS = {
  3006: { code: 'MODEL_INPUT_TOO_LARGE', message: 'Cloudflare rejected the request size. Use a smaller image, fewer attachments, or less source text.' },
  3007: { code: 'MODEL_TIMEOUT', message: 'Cloudflare timed out while processing the request. Try a smaller image or choose the other model.' },
  3008: { code: 'MODEL_TIMEOUT', message: 'Cloudflare stopped processing the request. Try again with a smaller image or less source text.' },
  3036: { code: 'AI_QUOTA_EXCEEDED', message: 'This Cloudflare account has exhausted its Workers AI allowance. Try again after the allowance resets or review the account’s Workers AI plan.' },
  3040: { code: 'MODEL_BUSY', message: 'This model is temporarily at capacity. Try again shortly or choose the other model.' },
  5004: { code: 'INVALID_IMAGE', message: 'Cloudflare could not decode the image. Re-save it as a PNG or JPEG and upload it again.' },
  5021: { code: 'MODEL_CONTEXT_EXCEEDED', message: 'The request exceeds Cloudflare’s model context limit. Use fewer images or shorten the source and questions.' },
  5035: { code: 'AI_PAID_PLAN_REQUIRED', message: 'This model requires a paid Cloudflare Workers plan. Review the account plan or choose another model.' },
};

export function modelError(error, { timedOut = false, validating = false, hasImages = false } = {}) {
  if (timedOut) return { code: 'MODEL_TIMEOUT', message: 'The model did not respond within 45 seconds. Try a smaller image or less source text.' };
  if (validating) return { code: 'MODEL_RESPONSE_INVALID', message: 'The model returned an inconsistent result. Try again or choose the other model.' };
  // The Workers AI binding prefixes upstream errors with a numeric provider code.
  // Extract only that code; provider descriptions can contain submitted content.
  const match = typeof error?.message === 'string' ? /^(\d{4}):/.exec(error.message) : null;
  const providerCode = match ? Number(match[1]) : undefined;
  let details = PROVIDER_ERRORS[providerCode];
  if ([5018, 5016, 3023, 3041].includes(providerCode)) details = { code: 'AI_ACCESS_DENIED', message: 'This Cloudflare account cannot access the selected model. Review Workers AI access and model terms, or choose another model.' };
  if ([5007, 3042].includes(providerCode)) details = { code: 'MODEL_UNAVAILABLE', message: 'The selected model is currently unavailable. Try the other model.' };
  return { ...(details ?? { code: 'MODEL_ERROR', message: hasImages ? 'The model could not process this image. Try a smaller PNG or JPEG, or choose the other model.' : 'The model could not complete this evaluation. Try again shortly or choose the other model.' }), ...(providerCode ? { providerCode } : {}) };
}
