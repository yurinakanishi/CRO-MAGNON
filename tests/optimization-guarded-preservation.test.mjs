import assert from 'node:assert/strict';
import test from 'node:test';
import { preservationProblems } from '../scripts/optimization/guarded/preservation.mjs';
import { decodeDocument } from '../scripts/optimization/guarded/document.mjs';
import { gridGlb } from './fixtures/guarded/glb.mjs';

const fixture = () =>
  decodeDocument(gridGlb({ name: 'retained head', cols: 4, rows: 4, clip: 'Wave' }), 'fixture');

test('guarded preservation rejects changes to retained primitive appearance and attribute sets', async () => {
  const source = await fixture();
  assert.deepEqual(preservationProblems(source, structuredClone(source), new Set()), []);
  for (const [name, change] of [
    [
      'material reassignment',
      (p) => {
        p.material = 1;
      },
    ],
    [
      'primitive mode',
      (p) => {
        p.mode = 1;
      },
    ],
    [
      'extra vertex attribute',
      (p) => {
        p.attributes.COLOR_0 = p.attributes.NORMAL;
      },
    ],
    [
      'morph target added',
      (p) => {
        p.targets = [{ POSITION: p.attributes.POSITION }];
      },
    ],
    [
      'primitive metadata',
      (p) => {
        p.extras = { changed: true };
      },
    ],
  ]) {
    const candidate = structuredClone(source);
    change(candidate.json.meshes[0].primitives[0]);
    assert.ok(preservationProblems(source, candidate, new Set()).length, name);
  }
});

test('guarded preservation rejects changes to retained morph data and index interpretation', async () => {
  const source = await fixture(),
    primitive = source.json.meshes[0].primitives[0];
  primitive.targets = [{ POSITION: primitive.attributes.POSITION }];
  source.json.meshes[0].weights = [0.25];
  let candidate = structuredClone(source);
  candidate.json.meshes[0].primitives[0].targets[0].POSITION = primitive.attributes.NORMAL;
  assert.ok(
    preservationProblems(source, candidate, new Set()).length,
    'same-size different morph target',
  );
  candidate = structuredClone(source);
  candidate.json.accessors[primitive.indices].normalized = true;
  assert.ok(preservationProblems(source, candidate, new Set()).length, 'index accessor metadata');
});

test('guarded preservation rejects added animation samplers and metadata', async () => {
  const source = await fixture();
  for (const [name, change] of [
    [
      'extra sampler',
      (a) => {
        a.samplers.push(structuredClone(a.samplers[0]));
      },
    ],
    [
      'animation metadata',
      (a) => {
        a.extras = { changed: true };
      },
    ],
    [
      'sampler metadata',
      (a) => {
        a.samplers[0].extras = { changed: true };
      },
    ],
  ]) {
    const candidate = structuredClone(source);
    change(candidate.json.animations[0]);
    assert.ok(preservationProblems(source, candidate, new Set()).length, name);
  }
});

test('guarded preservation compares inverse-bind accessor interpretation and missing structure', async () => {
  const source = await fixture();
  source.views.push(
    Buffer.from(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]).buffer),
  );
  source.json.bufferViews.push({ buffer: 0, byteLength: 64 });
  source.json.accessors.push({
    bufferView: source.views.length - 1,
    componentType: 5126,
    count: 1,
    type: 'MAT4',
  });
  source.json.skins = [{ joints: [0], inverseBindMatrices: source.json.accessors.length - 1 }];
  const candidate = structuredClone(source);
  candidate.json.accessors.at(-1).normalized = true;
  assert.ok(
    preservationProblems(source, candidate, new Set()).length,
    'inverse-bind interpretation',
  );
  for (const field of ['meshes', 'skins', 'animations', 'images']) {
    const missing = structuredClone(source);
    missing.json[field] = [];
    assert.ok(preservationProblems(source, missing, new Set()).length, `missing ${field}`);
  }
});
