import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { downloadVerifiedAsset } from '../dist/src/asset-download.js';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const origin = 'https://game.example';
const a = Buffer.from('unchanged geometry and bones ');
const b = Buffer.from('unchanged textures and animations');
const whole = Buffer.concat([a, b]);
const part = (url, bytes) => ({ url, bytes: bytes.length, sha256: hash(bytes) });
const record = { ...part('/models/test/model.glb', whole),
  parts: [part('/models/test/part-1.bin', a), part('/models/test/part-2.bin', b)] };
async function withFiles(files, action) {
  const previous = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    const bytes = files.get(new URL(url).pathname);
    return bytes ? new Response(bytes) : new Response('', { status: 404 });
  };
  try { await action(requests); } finally { globalThis.fetch = previous; }
}
test('split downloads reproduce the exact GLB bytes and verify the original full hash', async () => {
  await withFiles(new Map([['/models/test/part-1.bin', a], ['/models/test/part-2.bin', b]]), async (requests) => {
    assert.deepEqual(Buffer.from(await downloadVerifiedAsset(record, origin)), whole);
    assert.equal(requests.length, 2);
  });
});
test('local unsplit downloads retain their original manifest and verification', async () => {
  await withFiles(new Map([['/models/test/model.glb', whole]]), async () => {
    assert.deepEqual(Buffer.from(await downloadVerifiedAsset(part(record.url, whole), origin)), whole);
  });
});
test('a corrupt chunk fails before it can reach the GLTF parser', async () => {
  await withFiles(new Map([['/models/test/part-1.bin', Buffer.alloc(a.length)]]), async () => {
    await assert.rejects(downloadVerifiedAsset(record, origin), /SHA-256 mismatch/);
  });
});
test('valid chunks in the wrong order cannot bypass the original GLB hash', async () => {
  await withFiles(new Map([['/models/test/part-1.bin', a], ['/models/test/part-2.bin', b]]), async () => {
    await assert.rejects(downloadVerifiedAsset({ ...record, parts: [...record.parts].reverse() }, origin), /SHA-256 mismatch/);
  });
});
test('external chunk URLs and invalid lengths are rejected before any request', async () => {
  await withFiles(new Map(), async (requests) => {
    await assert.rejects(downloadVerifiedAsset({ ...record, parts: [{ ...record.parts[0], url: 'https://other.example/part' }, record.parts[1]] }, origin), /served by this game/);
    await assert.rejects(downloadVerifiedAsset({ ...record, parts: record.parts.slice(0, 1) }, origin), /lengths do not match/);
    assert.equal(requests.length, 0);
  });
});
