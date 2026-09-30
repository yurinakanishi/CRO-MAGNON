import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createExhibitionClient } from '../dist/infrastructure/node/exhibition-client.mjs';
import path from 'node:path';

test('fixed local model and production module WASM match provenance and MIME under exhibition CSP', async () => {
  const manifest = JSON.parse(await readFile('public/motion/assets.json'));
  assert.equal(manifest.version, '1.0.1');
  const client = createExhibitionClient({
    root: path.resolve('.'),
    port: 0,
    config: { mode: 'lan', serverUrl: 'ws://127.0.0.1:9/ws' },
  });
  const { port } = await client.listen();
  try {
    for (const record of manifest.files) {
      const bytes = await readFile(`public${record.url}`);
      assert.equal(bytes.length, record.bytes);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
      const response = await fetch(`http://127.0.0.1:${port}${record.url}`);
      assert.equal(response.status, 200);
      if (record.url.endsWith('.wasm'))
        assert.equal(response.headers.get('content-type'), 'application/wasm');
      if (record.url.endsWith('.task'))
        assert.equal(response.headers.get('content-type'), 'application/octet-stream');
      assert.equal(
        createHash('sha256')
          .update(Buffer.from(await response.arrayBuffer()))
          .digest('hex'),
        record.sha256,
      );
      const csp = response.headers.get('content-security-policy');
      assert.ok(csp.includes("'wasm-unsafe-eval'"));
      assert.ok(!csp.includes("'unsafe-eval'"));
    }
  } finally {
    await client.close();
  }
});
