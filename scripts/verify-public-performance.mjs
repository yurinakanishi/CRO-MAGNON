import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const hash = (b) => createHash('sha256').update(b).digest('hex');
const parse = (b) => {
  const size = b.readUInt32LE(12);
  return { json: JSON.parse(b.subarray(20, 20 + size)), bin: b.subarray(28 + size) };
};
const view = (g, i) => {
  const v = g.json.bufferViews[i];
  return g.bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
};
const manifest = JSON.parse(await readFile('assets/public-performance/manifest.json', 'utf8'));
let views = 0,
  images = 0;
for (const r of manifest.records) {
  assert.doesNotMatch(r.sourceUrl, /\/maruimo-octopus\//i);
  const before = await readFile('public' + r.sourceUrl),
    after = await readFile(r.file);
  assert.equal(hash(before), r.sourceSha256);
  assert.equal(hash(after), r.sha256);
  const a = parse(before),
    b = parse(after),
    imageViews = new Set((a.json.images ?? []).map((i) => i.bufferView));
  assert.equal(a.json.bufferViews.length, b.json.bufferViews.length);
  for (const key of [
    'meshes',
    'nodes',
    'skins',
    'animations',
    'accessors',
    'materials',
    'textures',
    'samplers',
    'scenes',
  ])
    assert.deepEqual(b.json[key], a.json[key], `${r.sourceUrl} ${key}`);
  for (let i = 0; i < a.json.bufferViews.length; i++)
    if (!imageViews.has(i)) {
      assert.ok(view(a, i).equals(view(b, i)), `${r.sourceUrl} view ${i}`);
      views++;
    }
  for (const im of b.json.images ?? []) {
    const data = view(b, im.bufferView);
    if (im.mimeType === 'image/png') {
      assert.ok(data.readUInt32BE(16) <= r.maximumTextureEdge);
      assert.ok(data.readUInt32BE(20) <= r.maximumTextureEdge);
    }
    images++;
  }
}
const result = {
  checkedAt: new Date().toISOString(),
  status: 'passed',
  models: manifest.records.length,
  byteIdenticalGeometrySkinAnimationViews: views,
  embeddedImages: images,
  sourceBytes: manifest.records.reduce((s, r) => s + r.sourceBytes, 0),
  bytes: manifest.records.reduce((s, r) => s + r.bytes, 0),
};
await writeFile(
  'assets/public-performance/verification.json',
  JSON.stringify(result, null, 2) + '\n',
);
console.log(JSON.stringify(result));
