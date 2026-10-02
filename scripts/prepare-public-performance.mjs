// Offline asset preparation. Public build refuses stale/unverified derivatives.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const python =
  process.env.PERFORMANCE_PYTHON ??
  'C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const hash = (b) => createHash('sha256').update(b).digest('hex');
const save = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n');
const worldPath = 'public/models/world-assets.json';
const world = JSON.parse(await readFile(worldPath, 'utf8'));
const lodSpecs = [
  ['yellow-524-mascot', '524', 3.5],
  ['rimo-neko', 'rimo', 6],
];
function documentOf(b) {
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
}
for (const [key, short, distance] of lodSpecs) {
  const assetPath = `public/models/${key}/asset.json`,
    a = JSON.parse(await readFile(assetPath, 'utf8'));
  const source = await readFile('public' + a.url),
    low = await readFile(`output/low-spec-20261002/${short}-lod-r01.glb`);
  assert.equal(hash(source), a.sha256);
  const original = documentOf(source),
    reduced = documentOf(low);
  assert.equal(reduced.animations?.length ?? 0, 0);
  assert.equal(reduced.meshes.length, original.meshes.length);
  for (let i = 0; i < original.skins.length; i++) {
    assert.deepEqual(
      reduced.skins[i].joints.map((n) => reduced.nodes[n].name),
      original.skins[i].joints.map((n) => original.nodes[n].name),
      `${key} bone order`,
    );
  }
  const inspection = JSON.parse(
    execFileSync(
      process.execPath,
      ['scripts/inspect-glb.mjs', `output/low-spec-20261002/${short}-lod-r01.glb`],
      { encoding: 'utf8', windowsHide: true },
    ),
  );
  assert.equal(inspection.validation, 'passed');
  const target = `public/models/${key}/lod-low-spec-r01.glb`;
  await copyFile(`output/low-spec-20261002/${short}-lod-r01.glb`, target);
  a.lods = [
    {
      url: `/models/${key}/lod-low-spec-r01.glb`,
      sha256: hash(low),
      bytes: low.length,
      triangles: inspection.triangles,
      distanceMetres: distance,
      purpose: 'source-derived animated geometry; original skeleton/materials/clips retained',
    },
  ];
  await save(assetPath, a);
  world.assets[world.assets.findIndex((x) => x.modelKey === key)] = a;
}
await save(worldPath, world);
const release = JSON.parse(await readFile('cloudflare/public-release.json', 'utf8'));
const { CHARACTER_MODELS } = await import('../dist/shared/characters.mjs');
const profiles = CHARACTER_MODELS.filter((a) => !release.excludedCharacters.includes(a.species));
const keys = new Set(profiles.map((a) => a.key));
const sources = [...world.assets];
for (const p of profiles)
  if (!sources.some((a) => a.modelKey === p.key))
    sources.push(JSON.parse(await readFile(`public/models/${p.key}/asset.json`, 'utf8')));
const records = [];
await mkdir('assets/public-performance/models', { recursive: true });
for (const a of sources) {
  // The cat has densely packed UV islands: 1024px bleeds unrelated texels into fur.
  const edge = keys.has(a.modelKey) || a.modelKey === 'rimo-neko' ? 2048 : 1024;
  for (const r of [a, ...(a.lods ?? [])]) {
    if (records.some((v) => v.sourceUrl === r.url)) continue;
    const input = await readFile('public' + r.url);
    assert.equal(hash(input), r.sha256, r.url);
    const destination = `assets/public-performance/models/${a.modelKey}-${path.basename(r.url, '.glb')}-tex${edge}.glb`;
    const details = JSON.parse(
      execFileSync(
        python,
        ['scripts/optimize-public-glb.py', 'public' + r.url, destination, String(edge)],
        { encoding: 'utf8', windowsHide: true },
      ),
    );
    const optimized = await readFile(destination),
      digest = hash(optimized);
    const prefix = path.basename(r.url).startsWith('lod') ? 'lod' : 'model';
    records.push({
      sourceUrl: r.url,
      sourceSha256: r.sha256,
      sourceBytes: r.bytes,
      file: destination,
      url: `/models/${a.modelKey}/${prefix}-web-${digest.slice(0, 16)}.glb`,
      sha256: digest,
      bytes: optimized.length,
      maximumTextureEdge: edge,
      ...details,
    });
    console.log(a.modelKey, path.basename(r.url), r.bytes, '->', optimized.length);
  }
}
await save('assets/public-performance/manifest.json', {
  version: 1,
  method:
    'Lanczos texture resizing; every non-image bufferView preserved byte for byte; PNG with original alpha',
  records,
});
console.log(
  JSON.stringify({
    models: records.length,
    sourceBytes: records.reduce((s, r) => s + r.sourceBytes, 0),
    bytes: records.reduce((s, r) => s + r.bytes, 0),
  }),
);
