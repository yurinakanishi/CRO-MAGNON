import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const digest = (b) => createHash('sha256').update(b).digest('hex');
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const asset = await json('public/models/violet-behemoth/asset.json');
const model = 'output/model-generation/models/violet-behemoth';
const folder = `${model}/work/rig/revision-${asset.revision}`;
const numeric = await json(`${folder}/qa/numeric.json`);
const source = await readFile(`${folder}/candidate.glb`);
const delivered = await readFile('public' + asset.url);
assert.deepEqual(delivered, source);
assert.equal(digest(source), asset.sha256);
assert.equal(numeric.sha256, asset.sha256);
assert.equal(numeric.numericPass, true);
assert.ok(Math.abs(numeric.restBounds.max[2] - numeric.restBounds.min[2] - 6) < 0.001);
assert.equal(numeric.skinJoints, 20);
assert.equal(numeric.clips.length, 9);
const catalog = await json('public/models/world-assets.json');
assert.deepEqual(
  catalog.assets.find((a) => a.modelKey === asset.modelKey),
  asset,
);

function glb(b) {
  const n = b.readUInt32LE(12);
  const g = JSON.parse(b.subarray(20, 20 + n).toString('utf8'));
  const bin = b.subarray(28 + n);
  const view = (i) => {
    const v = g.bufferViews[i];
    return digest(bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength));
  };
  const accessor = (i) => {
    const a = g.accessors[i];
    return { ...a, bufferView: view(a.bufferView) };
  };
  const clips = Object.fromEntries(
    g.animations.map((a) => [
      a.name,
      a.channels.map((c) => {
        const s = a.samplers[c.sampler];
        return {
          node: g.nodes[c.target.node].name,
          path: c.target.path,
          interpolation: s.interpolation,
          input: accessor(s.input),
          output: accessor(s.output),
        };
      }),
    ]),
  );
  return {
    g,
    clips,
    surface: g.meshes.map((m) =>
      m.primitives.map((p) => ({
        attributes: Object.fromEntries(
          Object.entries(p.attributes).map(([k, v]) => [k, accessor(v)]),
        ),
        indices: accessor(p.indices),
        material: p.material,
      })),
    ),
    images: g.images.map((i) => ({ ...i, bufferView: view(i.bufferView) })),
  };
}
// Revision 04 reworks only the tail motion of the gait and spin clips; the
// surface, textures, materials and the other five clips are byte-identical to
// the adopted revision 03.
const old = glb(await readFile(`${model}/work/rig/revision-03/candidate.glb`)),
  current = glb(source);
assert.deepEqual(current.surface, old.surface);
assert.deepEqual(current.images, old.images);
assert.deepEqual(current.g.materials, old.g.materials);
const reworkedClips = ['Walk_Loop', 'Run_Loop', 'Charge', 'TailSpin'];
const retainedClips = Object.keys(old.clips).filter((n) => !reworkedClips.includes(n));
for (const name of retainedClips) assert.deepEqual(current.clips[name], old.clips[name], name);
for (const name of reworkedClips) {
  assert.notDeepEqual(current.clips[name], old.clips[name], name);
  assert.deepEqual(
    current.clips[name].map((c) => [c.node, c.path, c.interpolation, c.input.count]),
    old.clips[name].map((c) => [c.node, c.path, c.interpolation, c.input.count]),
    name + ' keeps the same bones, channels and timing',
  );
}

const existing = [];
const tree = execFileSync('git', ['ls-tree', '-r', 'HEAD', '--', 'public'], { encoding: 'utf8' });
for (const line of tree.trim().split('\n')) {
  const [meta, p] = line.split('\t');
  if (!p?.endsWith('.glb') && !/^public\/title\/.*\.png$/.test(p || '')) continue;
  const bytes = await readFile(p);
  const gitSha = createHash('sha1')
    .update(Buffer.from(`blob ${bytes.length}\0`))
    .update(bytes)
    .digest('hex');
  assert.equal(gitSha, meta.split(' ')[2], 'Existing asset changed: ' + p);
  existing.push({ path: p, sha256: digest(bytes), bytes: bytes.length });
}
await mkdir('assets/violet-behemoth', { recursive: true });
const report = {
  sha256: asset.sha256,
  revision: asset.revision,
  lengthMetres: 6,
  numericPass: true,
  retainedSurfaceAndMaterials: true,
  retainedClips,
  reworkedClips,
  existingAssetsUnchanged: existing,
  generatedAt: new Date().toISOString(),
};
await writeFile('assets/violet-behemoth/delivery.json', JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify({
    revision: asset.revision,
    sha256: asset.sha256,
    retainedClips,
    existingAssets: existing.length,
  }),
);
