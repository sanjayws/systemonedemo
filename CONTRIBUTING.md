# Contributing

Thanks for helping make System One models easier to explore. Bug fixes, clearer examples, accessibility improvements, and documentation are welcome.

## Work locally

Fork the [repository](https://github.com/sanjayws/systemonedemo), clone your fork, and create a branch for your change. Use Node.js 22 or newer.

```sh
npm ci
npm run preview
```

The preview at `http://127.0.0.1:8787` works without Cloudflare credentials. Use the labeled example outputs to explore text presets. Live inference requires `npx wrangler login` and `npm run dev`, and consumes your Cloudflare account's Workers AI allowance.

Read [AGENTS.md](AGENTS.md) for the project structure and coding conventions. Keep shared validation in `web/lib/schema.js`, and add meaningful `node:test` coverage for behavior changes. Preserve the distinction between illustrative examples and live model results.

## Submit a change

Run these checks before opening a pull request:

```sh
npm run check
npm test
npm run build
```

For UI changes, check desktop and mobile layouts and include screenshots. Describe the problem, the resulting behavior, and how you tested it; link a relevant issue when available. Update the README when setup, configuration, or API behavior changes. Use concise imperative commit subjects, such as `Improve image upload guidance`.

Report bugs through [GitHub Issues](https://github.com/sanjayws/systemonedemo/issues) with reproduction steps, expected behavior, browser details, and sanitized error references. Keep credentials, private source content, and customer images out of reports and commits.

Contributions are provided under this project's [MIT License](LICENSE). Cloudflare services and model weights have their own terms; this repository licenses the playground application.
