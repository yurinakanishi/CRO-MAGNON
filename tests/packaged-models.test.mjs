// Offline package model inventory (scripts/packaged-models.mjs, used by build-exhibition): each
// physical GLB checked once, packed levels kept as logical records with their scenes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkRuntimeGraph } from '../scripts/runtime-graph.mjs';
import { checkPhysicalModels, runtimeFiles } from '../scripts/packaged-models.mjs';
import { compressedModel, record, sha } from './glb-fixtures.mjs';

/** A GLB 2.0 file with only a JSON chunk and no required extension. */
function plainGlb(label) {
  const json = JSON.stringify({
      asset: { version: '2.0', generator: label },
      scenes: [{}],
      scene: 0,
    }),
    length = Math.ceil(Buffer.byteLength(json) / 4) * 4,
    bytes = Buffer.alloc(20 + length, 0x20);
  bytes.writeUInt32LE(0x46546c67, 0);
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(length, 12);
  bytes.writeUInt32LE(0x4e4f534a, 16);
  bytes.write(json, 20);
  return bytes;
}

/** A package source tree: an adopted packed `hill` (three levels of one meshopt file) and an
 * original `pond` (model and LOD files), written under a temporary root. */
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'packaged-models-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packed = (await compressedModel()).glb,
    file = record(`/models/hill/model-levels.opt-${sha(packed).slice(0, 16)}.glb`, packed),
    pond = plainGlb('pond'),
    pondLod = plainGlb('pond lod');
  for (const [url, bytes] of [
    [file.url, packed],
    ['/models/pond/model.glb', pond],
    ['/models/pond/lod1.glb', pondLod],
  ]) {
    await mkdir(path.join(root, 'public', path.dirname(url)), { recursive: true });
    await writeFile(path.join(root, 'public', url), bytes);
  }
  const hill = {
      modelKey: 'hill',
      ...file,
      scene: 0,
      runtimeOptimization: { adoption: 'test-a01' },
      lods: [
        { ...file, scene: 1, distanceMetres: 40 },
        { ...file, scene: 2, distanceMetres: 80 },
      ],
    },
    adoption = {
      id: 'test-a01',
      planSha256: 'c'.repeat(64),
      graph: {
        models: {
          hill: {
            selection: 'ordinary-compressed',
            primary: { ...file, scene: 0 },
            lods: [
              { ...file, scene: 1 },
              { ...file, scene: 2 },
            ],
          },
        },
        textures: {},
        retired: [],
        notAdopted: {},
      },
    },
    assets = [
      hill,
      {
        modelKey: 'pond',
        ...record('/models/pond/model.glb', pond),
        lods: [record('/models/pond/lod1.glb', pondLod)],
      },
    ];
  const graph = checkRuntimeGraph(assets, adoption, { textureRecords: () => [] });
  return { root, file, hill, assets, graph, packed };
}

test('a package checks and lists each physical GLB once; the graph keeps every level and scene', async (t) => {
  const { root, file, graph } = await fixture(t);
  const result = await checkPhysicalModels(root, graph);
  assert.deepEqual(result.files, [
    `public${file.url}`,
    'public/models/pond/model.glb',
    'public/models/pond/lod1.glb',
  ]);
  assert.equal(result.compressed, true, 'the packed file needs the meshopt decoder');
  assert.deepEqual(
    graph.models.map(({ modelKey, url, scene }) => [modelKey, url, scene]),
    [
      ['hill', file.url, 0],
      ['hill', file.url, 1],
      ['hill', file.url, 2],
      ['pond', '/models/pond/model.glb', null],
      ['pond', '/models/pond/lod1.glb', null],
    ],
  );
});

test('a changed or missing physical file, or records it does not serve, fail the package', async (t) => {
  const { root, file, graph } = await fixture(t);
  await writeFile(path.join(root, 'public', file.url), Buffer.from('not the packed model'));
  await assert.rejects(
    checkPhysicalModels(root, graph),
    new RegExp(`Model integrity failed: public${file.url.replaceAll('.', '\\.')}`),
  );
  const fresh = await fixture(t);
  await rm(path.join(fresh.root, 'public/models/pond/lod1.glb'));
  await assert.rejects(checkPhysicalModels(fresh.root, fresh.graph), /ENOENT/);
  // A graph whose logical records and physical files disagree is refused, not repaired.
  const other = await fixture(t),
    [hill] = other.graph.physicalModels;
  await assert.rejects(
    checkPhysicalModels(other.root, {
      ...other.graph,
      physicalModels: [{ ...hill, records: 2 }, ...other.graph.physicalModels.slice(1)],
    }),
    /3 found/,
  );
  await assert.rejects(
    checkPhysicalModels(other.root, {
      ...other.graph,
      models: other.graph.models.map((model, index) =>
        index === 1 ? { ...model, bytes: model.bytes + 1 } : model,
      ),
    }),
    new RegExp(`hill: ${other.file.url.replaceAll('.', '\\.')} is not a checked physical file`),
  );
  await assert.rejects(
    checkPhysicalModels(other.root, {
      ...other.graph,
      physicalModels: [...other.graph.physicalModels, hill],
    }),
    /is listed as two physical files/,
  );
});

test("a model's own manifest must name the same files, scenes and parts as the catalog", async (t) => {
  const { hill } = await fixture(t),
    textures = (asset) => asset.textures ?? [],
    same = (a, b) => runtimeFiles(a, textures) === runtimeFiles(b, textures);
  assert.ok(same(hill, structuredClone(hill)));
  // Descriptive fields may differ; files and scenes may not.
  assert.ok(same(hill, { ...hill, lods: hill.lods.map((lod) => ({ ...lod, distanceMetres: 1 })) }));
  const changed = [
    { ...hill, scene: undefined },
    { ...hill, lods: [hill.lods[1], hill.lods[0]] },
    { ...hill, lods: [{ ...hill.lods[0], scene: 2 }, hill.lods[1]] },
    { ...hill, lods: [hill.lods[0]] },
    {
      ...hill,
      parts: [{ url: '/models/hill/part-1.bin', sha256: hill.sha256, bytes: hill.bytes }],
    },
    { ...hill, textures: [{ url: '/models/hill/albedo.png', sha256: 'd'.repeat(64), bytes: 9 }] },
  ];
  for (const record of changed) assert.equal(same(hill, record), false, JSON.stringify(record));
});
