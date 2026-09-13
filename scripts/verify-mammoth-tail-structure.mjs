import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import * as T from 'three';
import { loadMotion } from './motion-glb.mjs';
const dir = 'output/mammoth-tail/revision-11';
const delivery = process.argv[2] || `${dir}/model.glb`;
const [g, old] = await Promise.all([
  loadMotion(delivery),
  loadMotion('public/models/woolly-mammoth/model-motion-r04.glb'),
]);
for (const key of ['nodes', 'skins', 'animations'])
  assert.deepEqual(g.doc[key], old.doc[key], `${key} unchanged`);
assert.deepEqual(g.binary.subarray(0, old.binary.length), old.binary);
const meshes = [];
g.scene.traverse((n) => {
  if (n.isSkinnedMesh) meshes.push(n);
});
const m = meshes[0],
  p = m.geometry.attributes.position,
  skin = m.geometry.attributes.skinIndex,
  weights = m.geometry.attributes.skinWeight;
const tailBones = new Set(m.skeleton.bones.map((b, i) => (b.name.startsWith('Tail') ? i : -1)));
tailBones.delete(-1);
const tail = [];
for (let i = 0; i < p.count; i++) {
  let w = 0;
  for (let k = 0; k < 4; k++)
    if (tailBones.has(skin.array[i * 4 + k])) w += weights.array[i * 4 + k];
  if (w > 0.01 && p.getZ(i) < -2.3 && p.getY(i) < 2.25) tail.push(i);
}
assert.ok(tail.length > 200);
const sections = [];
for (const height of [0.7, 0.9, 1.1, 1.3, 1.5, 1.7, 1.9]) {
  const nodes = new Map(),
    graph = new Map();
  for (const mesh of meshes) {
    const index = mesh.geometry.index;
    for (let k = 0; k < index.count; k += 3) {
      const points = [0, 1, 2].map((j) =>
        new T.Vector3().fromBufferAttribute(p, index.getX(k + j)),
      );
      if (points.some((v) => v.z > -2.3)) continue;
      const cut = [];
      for (let j = 0; j < 3; j++) {
        const a = points[j],
          b = points[(j + 1) % 3];
        if ((a.y - height) * (b.y - height) < 0)
          cut.push(a.clone().lerp(b, (height - a.y) / (b.y - a.y)));
      }
      if (cut.length !== 2) continue;
      const keys = cut.map((v) => [v.x, v.z].map((n) => Math.round(n * 1e5)).join(','));
      if (keys[0] === keys[1]) continue;
      for (let j = 0; j < 2; j++) {
        nodes.set(keys[j], cut[j]);
        if (!graph.has(keys[j])) graph.set(keys[j], new Set());
        graph.get(keys[j]).add(keys[1 - j]);
      }
    }
  }
  assert.ok(nodes.size > 20, `tail cross section at ${height}`);
  assert.ok(
    [...graph.values()].every((s) => s.size === 2),
    'one closed tail surface',
  );
  const seen = new Set(),
    todo = [nodes.keys().next().value];
  while (todo.length) {
    const k = todo.pop();
    if (seen.has(k)) continue;
    seen.add(k);
    todo.push(...graph.get(k));
  }
  assert.equal(seen.size, nodes.size, `only one tail at ${height}`);
  const points = [...nodes.values()],
    width = Math.max(...points.map((v) => v.x)) - Math.min(...points.map((v) => v.x)),
    depth = Math.max(...points.map((v) => v.z)) - Math.min(...points.map((v) => v.z));
  assert.ok(
    Math.min(width, depth) > 0.07 && Math.max(width, depth) / Math.min(width, depth) < 1.5,
    `round, uncrushed tail at ${height}`,
  );
  sections.push({ height, width, depth, components: 1 });
}
const key = (v) => v.map((n) => Math.round(n * 1e4)).join(',');
const oldMesh = [];
old.scene.traverse((n) => {
  if (n.isSkinnedMesh) oldMesh.push(n);
});
const original = oldMesh[0],
  op = original.geometry.attributes.position,
  originalPoints = new Map();
for (let i = 0; i < op.count; i++) {
  const k = key([op.getX(i), op.getY(i), op.getZ(i)]);
  if (!originalPoints.has(k)) originalPoints.set(k, []);
  originalPoints.get(k).push(i);
}
const outside = [];
for (let i = 0; i < p.count; i++)
  if (p.getZ(i) > -1.6 || p.getY(i) < 0.45) {
    const point = [p.getX(i), p.getY(i), p.getZ(i)];
    let candidates = originalPoints.get(key(point)) ?? [];
    if (!candidates.length) {
      let best = 0.00002;
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++) {
            const list =
              originalPoints.get(key(point.map((x, c) => x + [dx, dy, dz][c] * 0.0001))) ?? [];
            for (const k of list) {
              const d = Math.hypot(
                op.getX(k) - point[0],
                op.getY(k) - point[1],
                op.getZ(k) - point[2],
              );
              if (d < best) {
                best = d;
                candidates = list;
              }
            }
          }
    }
    const vector = (mesh, id) => {
      const out = {};
      for (let k = 0; k < 4; k++) {
        const a = mesh.geometry.attributes;
        const name = mesh.skeleton.bones[a.skinIndex.array[id * 4 + k]].name;
        out[name] = (out[name] ?? 0) + a.skinWeight.array[id * 4 + k];
      }
      return out;
    };
    const expected = vector(m, i);
    const j = candidates.sort((a, b) => {
      const distance = (id) => {
        const actual = vector(original, id);
        return Object.keys({ ...expected, ...actual }).reduce(
          (s, k) => s + Math.abs((expected[k] ?? 0) - (actual[k] ?? 0)),
          0,
        );
      };
      return distance(a) - distance(b);
    })[0];
    assert.ok(j !== undefined, 'surface outside rump remains in its original position');
    outside.push([i, j]);
  }
const mix = new T.AnimationMixer(g.scene),
  omix = new T.AnimationMixer(old.scene),
  v = new T.Vector3(),
  w = new T.Vector3();
const results = [];
let outsideError = 0,
  outsideWorst;
for (const clip of g.animations) {
  mix.stopAllAction();
  omix.stopAllAction();
  const action = mix.clipAction(clip).setLoop(T.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const oa = omix
    .clipAction(old.animations.find((c) => c.name === clip.name))
    .setLoop(T.LoopOnce, 1);
  oa.clampWhenFinished = true;
  oa.play();
  let minY = Infinity,
    maxY = -Infinity,
    maxX = 0,
    maxZ = -Infinity;
  let start;
  const count = Math.ceil(clip.duration * 240);
  for (let frame = 0; frame <= count; frame++) {
    const t = (frame / count) * clip.duration;
    action.time = t;
    oa.time = t;
    mix.update(0);
    omix.update(0);
    g.scene.updateMatrixWorld(true);
    old.scene.updateMatrixWorld(true);
    m.skeleton.update();
    original.skeleton.update();
    const current = [];
    for (const i of tail) {
      v.fromBufferAttribute(p, i);
      m.applyBoneTransform(i, v);
      v.applyMatrix4(m.matrixWorld);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
      maxX = Math.max(maxX, Math.abs(v.x));
      maxZ = Math.max(maxZ, v.z);
      if (frame === 0 || frame === count) current.push(v.clone());
    }
    if (frame === 0) start = current;
    if (frame === count && clip.name !== 'Death') {
      const seam = Math.max(...current.map((a, i) => a.distanceTo(start[i])));
      assert.ok(seam < 0.00001, `${clip.name} tail seam ${seam}`);
    }
    if (frame % 60 === 0)
      for (let n = 0; n < outside.length; n += 11) {
        const [i, j] = outside[n];
        v.fromBufferAttribute(p, i);
        m.applyBoneTransform(i, v);
        v.applyMatrix4(m.matrixWorld);
        w.fromBufferAttribute(op, j);
        original.applyBoneTransform(j, w);
        w.applyMatrix4(original.matrixWorld);
        const error = v.distanceTo(w);
        if (error > outsideError) {
          outsideError = error;
          outsideWorst = {
            clip: clip.name,
            i,
            j,
            point: [p.getX(i), p.getY(i), p.getZ(i)],
            sourceWeights: Array.from(
              original.geometry.attributes.skinWeight.array.slice(j * 4, j * 4 + 4),
            ),
            weights: Array.from(weights.array.slice(i * 4, i * 4 + 4)),
          };
        }
      }
  }
  assert.ok(minY > 0, `${clip.name}: tail below floor ${minY}`);
  results.push({
    clip: clip.name,
    frames: count + 1,
    minTailHeight: minY,
    maxTailHeight: maxY,
    maxAbsTailX: maxX,
    maxTailZ: maxZ,
  });
}
assert.ok(outsideError < 0.001, `unaffected surface changed ${outsideError}`);
const result = {
  status: 'passed',
  fps: 240,
  tailVertices: tail.length,
  sections,
  unchangedOutsideVertices: outside.length,
  outsideMaximumError: outsideError,
  results,
};
if (!process.argv.includes('--no-write')) {
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/validation.json`, JSON.stringify(result, null, 2) + '\n');
}
console.log(JSON.stringify(result, null, 2));
