# System One decision playground

Built by **Ordinexis**. Open source under the [MIT License](LICENSE).

[Try the live demo](https://systemonedemo.sanjay6326.workers.dev) · [GitHub repository](https://github.com/sanjayws/systemonedemo) · [Contribute](CONTRIBUTING.md)

A Cloudflare Worker and responsive browser playground for exploring System One decision models through practical business scenarios. This implementation runs Cloudflare Clef and Clef Flash. Content A supplies the evidence; Content B supplies one or more typed questions. The app sends real evaluations through `env.AI.run()` using the native System One schema.

Clef returns **decisions rather than generated prose**:

| Format | Input | Result |
| --- | --- | --- |
| Yes / no (`noul`) | A yes/no question | Probability the answer is yes |
| Choice | A question and named answer options | Selected option, confidence, and probability for each option |
| Score | A question and an ordered rubric | Probability-weighted score, confidence, and probability for each level |

## Run and deploy

Requires Node.js 22 or newer and a Cloudflare account with Workers AI access.

```sh
git clone https://github.com/sanjayws/systemonedemo.git
cd systemonedemo
npm ci
npx wrangler login
npm run dev
```

Open the local URL printed by Wrangler. Workers AI inference runs remotely through your account even during local development, and uses your account’s Workers AI allowance/billing. The app itself contains no client-side credentials. If your login can access multiple accounts, add the intended `account_id` to `wrangler.jsonc`, or set `CLOUDFLARE_ACCOUNT_ID` in your deployment environment.

To deploy to your account’s `workers.dev` subdomain:

```sh
npm run check
npm test
npm run build
npm run deploy
```

This repository targets the `systemonedemo` Worker at `https://systemonedemo.sanjay6326.workers.dev`. Wrangler prints the resulting URL. Change `name` in `wrangler.jsonc` before deploying a separate copy. `npm run build` is a deployment dry run; it does not publish anything. No database, API SDK, frontend framework, build pipeline, or external font service is required.

For CI, set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as secure environment variables. The token needs Workers deployment and Workers AI access for the target account. Do not put tokens in `web/`, commit them, or paste them into the playground.

The `sharp` override pins Wrangler/Miniflare's development dependency to 0.35.5, which fixes [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w). Keep the override until the upstream dependency includes the fix, and rerun the dependency audit when updating Wrangler. The Worker has no runtime npm dependencies.

## Preview without connecting Cloudflare

```sh
npm run preview
```

Open `http://127.0.0.1:8787`. This dependency-free preview serves the real frontend and Worker routes without an AI binding. **Run decision** reports that live inference is unavailable. **View example output** shows hand-authored illustrations for unchanged text presets; those examples are explicitly labeled and contain no invented latency or token metrics. Editing the preset disables its illustration. Image scenarios require actual uploaded images and have no illustrative output.

The offline preview is separate from `npm run dev`, which uses actual Cloudflare Workers AI. A passing local test or preview is not a measured model benchmark.

## Included experiments

1. Answer from a source with predefined options
2. Check whether a claim is supported
3. Triage a support ticket with three simultaneous decisions
4. Classify customer sentiment
5. Apply a supplied written policy
6. Gate a proposed agent action
7. Decide from structured JSON
8. Compare the meaning of two statements
9. Evaluate a supplied answer for grounding and quality
10. Detect embedded prompt injection instructions
11. Route a multilingual message
12. Explore incomplete evidence and uncertainty
13. Classify an uploaded image and check text readability

Visitors can edit the evidence, questions, allowed options, and rubrics; add up to 16 questions; start from a blank canvas; attach images; compare both models; inspect JSON; and export a request/result pair. Controls stay locked while images are being read. Old results are labeled when inputs change; the JSON panel and export retain the original request associated with those results. Comparison preserves successful results if the other model fails.

## API

`GET /api/config` returns public model IDs, limits, and whether an AI binding is present. Binding presence does not guarantee that your account can run a model.

`POST /api/evaluate` accepts:

```json
{
  "models": ["clef", "clef-flash"],
  "state": "Returns are accepted within 30 days.",
  "questions": {
    "supported": {
      "type": "noul",
      "instructions": "Does the policy allow a return within 30 days?"
    }
  }
}
```

Use one model to run it alone, or both to compare. A single `model` property is accepted as a convenience. Text and JSON object/array states are supported. Optional `images` are embedded `data:image/png;base64,...`, JPEG, or WebP data URLs. They are shared by every question. The app does not fetch remote image URLs or arbitrary model IDs.

Response:

```json
{
  "runs": [
    {
      "model": "clef",
      "status": "success",
      "latencyMs": 123,
      "result": {
        "model": "clef",
        "answers": { "supported": { "type": "noul", "noul": 0.95 } },
        "usage": { "input_tokens": 42, "output_tokens": 1 }
      }
    }
  ],
  "requestId": "request-uuid"
}
```

The values above are a schema illustration, not measured performance. `latencyMs` measures the binding call and response handling inside the Worker; it excludes the browser’s network round trip. Each failed model has `status: "error"` and a safe error message. Errors distinguish image decoding, request size, timeout, model capacity, account allowance/access, and invalid model responses. The result panel shows a request reference; JSON includes the numeric Cloudflare error code when available. A complete model failure returns HTTP 502; partial success returns 200.

## Limits and operation

- Source: 32,000 characters; 16 questions; 32 options per choice; 2–10 ordered score levels; 128 options across a request. These are intentionally narrower than Clef’s maximums for a public playground.
- Structured JSON is limited to 64 nesting levels and finite numbers. Provider responses must match the selected model, question IDs, allowed options, and score rubric; additional provider fields are discarded.
- Images: up to four, each at most 4 MiB and 16 megapixels; at most 8 MiB of decoded images in total. The browser checks dimensions and the provider also enforces its image limits. The Worker validates MIME/data URL format and byte limits, but is not an image decoder. Whole app request: 12 MiB.
- Live testing on 8 October 2026 found a stricter constraint: Cloudflare counts base64 image content toward its 65,536-token context estimate and rejects a 1.4 MB image with error 5021. The app therefore caps each encoded model request at 240 KiB, including text and questions. Before running, the browser compresses/resizes larger images to fit that shared budget, preserving smaller images when possible. Optimized previews and exports contain the exact images submitted; originals remain local. Compression can reduce fine details, so crop documents to relevant text. Direct API callers must optimize images themselves; oversized model payloads return 413 before inference.
- Rate limit: 20 **model evaluations** per minute per IP in each Cloudflare location. Comparing both consumes two evaluations. Shared IPs share an allowance. Cloudflare’s binding is permissive and local; this is not a global spending cap. Change the limits as appropriate for your audience.
- The rate-limit `namespace_id` must be unique within your account unless sharing counters is intentional. Change `1042026001` if another Worker uses it.
- A model response times out after 45 seconds and aborts the binding request. The browser stops waiting after 60 seconds. A timeout or cancellation does not necessarily cancel inference already running at Cloudflare.
- No inputs or model results are persisted by this app. Inputs are sent to Cloudflare for inference. There is no source-content logging, analytics, or credential entry in the UI. JSON exports are saved locally by the visitor and include their source/images.
- Workers observability is enabled for operational request metadata. Application error logs contain only an event name, request ID, model selector when relevant, safe error code, and numeric Cloudflare error code when available; they omit input content and raw provider errors.
- Same-origin browser requests, bounded body parsing, model allowlists, request/result validation, and CSP are included. The public API can also be called by non-browser clients; origin checks are not authentication.
- Follow your Cloudflare account’s usage/budget controls for a public demonstration. The supplied Worker is anonymous; if you need restricted access, protect the deployment with Cloudflare Access or your authentication layer.
- Confidence is a model probability, not proof of accuracy. Evaluate your real domain data before using a decision in a consequential workflow. Prompt-injection detection is a scenario, not a complete security system.

## Project structure

```text
src/worker.js            API routes, validation, rate limiting, Workers AI calls
src/model-errors.js      Safe, actionable provider error classification
web/index.html          Accessible playground structure
web/styles.css          Desktop and mobile styles
web/app.js              Interactive question editor, runs, results, image uploads
web/lib/schema.js       Shared validation and model allowlist
web/lib/images.js       Browser image optimization within the model request budget
web/lib/scenarios.js    Scenario presets and explicitly illustrative outputs
scripts/preview.mjs     Offline preview server
scripts/check.mjs       Syntax and preset validation
test/worker.test.js     Request, routing, timeout, and failure-path tests
test/schema.test.js     Input/output contracts, limits, and preset validation
test/preview.test.js    Offline preview origins, paths, and HTTP methods
wrangler.jsonc          Worker, static assets, AI, and rate-limit bindings
```

## Official integration references

- [Clef model and native API](https://developers.cloudflare.com/workers-ai/models/clef/)
- [Clef Flash](https://developers.cloudflare.com/workers-ai/models/clef-flash/)
- [Workers AI binding](https://developers.cloudflare.com/workers-ai/configuration/bindings/)
- [Static asset binding](https://developers.cloudflare.com/workers/static-assets/binding/)
- [Rate-limit binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)

Model IDs and schemas were checked against the official Cloudflare documentation on 8 October 2026. This repository does not include Cloudflare account credentials. Local tests use mocked bindings; successful tests alone do not establish live model availability or accuracy.

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md) for local development, validation, and pull request guidance. Report reproducible bugs or propose improvements through [GitHub Issues](https://github.com/sanjayws/systemonedemo/issues).

The playground source code is licensed under [MIT](LICENSE), copyright 2026 Ordinexis. Model weights are not included. Cloudflare services, models, and third-party dependencies retain their own licenses and terms. The package is marked `private` to prevent accidental npm publication; the source repository is public.
