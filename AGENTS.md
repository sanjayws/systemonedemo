# Repository Guidelines

## Project Structure & Module Organization

This playground uses a Cloudflare Worker and a framework-free browser UI.
- `src/worker.js`: API routing, rate limiting, Workers AI calls, and security headers.
- `web/`: HTML, CSS, browser logic, and favicon served as static assets.
- `web/lib/schema.js`: shared validation, model allowlist, and limits; keep browser and Worker rules here.
- `web/lib/scenarios.js`: scenario presets and labeled illustrative outputs.
- `test/worker.test.js`: validation, routing, and failure-path tests.
- `scripts/`: offline preview and repository checks. `wrangler.jsonc` defines bindings and deployment settings.

## Build, Test, and Development Commands

Use Node.js 22 or newer.
- `npm ci`: install locked dependencies.
- `npm run preview`: serve the offline playground at `http://127.0.0.1:8787`; live inference is unavailable.
- `npm run dev`: start Wrangler development after `npx wrangler login`; inference uses your Cloudflare account remotely and consumes its allowance.
- `npm run check`: check JavaScript syntax, preset validity, and referenced HTML element IDs.
- `npm test`: run Node's built-in test suite.
- `npm run build`: dry-run deployment, writing output to `.build/`.
- `npm run deploy`: publish the Worker to Cloudflare.

## Coding Style & Naming Conventions

Use JavaScript ES modules with explicit `.js` import extensions, two-space indentation, semicolons, and single-quoted strings. Match existing camelCase functions and variables, PascalCase classes, and uppercase shared constants such as `MODELS`. Use descriptive kebab-case CSS classes and HTML IDs. No formatter or lint tool is configured; follow surrounding code and run `npm run check`.

## Testing Guidelines

Use `node:test` with `node:assert/strict`; name files `test/*.test.js` and describe expected behavior in test titles. Mock `AI`, `ASSETS`, and rate-limit bindings. Cover validation boundaries, HTTP status codes, partial model failures, and safe error responses. No coverage threshold is configured. Before submitting, run checks, tests, and the build. For UI changes, inspect desktop and mobile layouts using the preview.

## Commit & Pull Request Guidelines

Git history is unavailable in this checkout, so no existing commit convention can be verified. Use concise imperative subjects, such as `Fix comparison error handling`. Include the change's purpose, linked issues when applicable, validation results, and screenshots for visual changes. Update `README.md` for API or setup changes.

## Security & Configuration

Keep credentials out of `web/` and commits; use secure environment variables. Preserve model allowlists, bounded inputs, and sanitized errors. Never log submitted source content or present illustrative results as live inference.
