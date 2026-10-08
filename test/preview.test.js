import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { get } from 'node:http';
import { symlink, unlink } from 'node:fs/promises';
import { createPreviewServer } from '../scripts/preview.mjs';

test('Offline preview serves assets, supports localhost origins, and restricts paths and methods', async () => {
  const server = createPreviewServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  const link = new URL(`../web/.preview-test-${crypto.randomUUID()}`, import.meta.url);
  try {
    assert.equal((await fetch(origin)).status, 200);
    const head = await fetch(`${origin}/styles.css`, { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
    assert.equal((await fetch(`${origin}/styles.css`, { method: 'POST', body: 'test' })).status, 405);
    const localhost = `http://localhost:${port}`;
    const evaluation = await fetch(`${localhost}/api/evaluate`, { method: 'POST', headers: { Origin: localhost, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'clef', state: 'Evidence', questions: { test: { type: 'noul', instructions: 'Supported?' } } }) });
    assert.equal(evaluation.status, 503);
    assert.equal((await fetch(`${origin}/%2e%2e%2fpackage.json`)).status, 404);
    await symlink(new URL('../package.json', import.meta.url), link);
    assert.equal((await fetch(`${origin}/${link.pathname.split('/').pop()}`)).status, 404);
    const rejectedHost = await new Promise((resolve, reject) => {
      get(origin, { headers: { Host: 'untrusted.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
    });
    assert.equal(rejectedHost, 403);
  } finally {
    await unlink(link).catch(() => {});
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
