import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { SCENARIOS, illustrativeResult } from '../web/lib/scenarios.js';
import { validateRequest, validateResult } from '../web/lib/schema.js';

const root = resolve(import.meta.dirname, '..');
async function checkDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await checkDirectory(path);
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
      const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(result.stderr);
    }
  }
}
for (const directory of ['src', 'web', 'scripts', 'test']) await checkDirectory(join(root, directory));
for (const scenario of SCENARIOS) {
  validateRequest({ model: 'clef', state: scenario.sourceType === 'json' ? JSON.parse(scenario.state) : scenario.state, questions: Object.fromEntries(scenario.questions.map(({ id, ...question }) => [id, question])) });
  if (scenario.example) {
    const result = illustrativeResult(scenario);
    validateResult({ ...result, usage: { input_tokens: 0, output_tokens: 0 } }, Object.fromEntries(scenario.questions.map(({ id, ...question }) => [id, question])), 'clef');
  }
}
const html = await readFile(join(root, 'web/index.html'), 'utf8');
const app = await readFile(join(root, 'web/app.js'), 'utf8');
for (const [, id] of app.matchAll(/\$\('([^']+)'\)/g)) if (!html.includes(`id="${id}"`)) throw new Error(`Missing HTML element: ${id}`);
console.log(`Syntax, UI element references, and all ${SCENARIOS.length} scenarios validated.`);
