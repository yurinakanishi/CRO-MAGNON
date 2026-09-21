import assert from 'node:assert/strict';
import { access, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Vector3 } from 'three';
import { unpack, loadMotion, pose } from './motion-glb.mjs';
import { attribute, positionKey } from './female-face-geometry.mjs';
const revision = process.argv[2] || '10',
  noWrite = process.argv.includes('--no-write');
const keys =
  process.argv[3] && !process.argv[3].startsWith('--')
    ? [process.argv[3]]
    : ['cro-magnon-woman', 'neanderthal-woman'];
const hash = (b) => createHash('sha256').update(b).digest('hex'),
  results = [];
for (const key of keys) {
  const base = `assets/female-face-repair/${key}/work/revision-${revision}`;
  const build = JSON.parse(await readFile(`${base}/build.json`, 'utf8'));
  const publicFile = `public/models/${key}/model-face-r${revision}.glb`;
  const deliveryArg = process.argv.find((v) => v.startsWith('--delivery='));
  let deliveryFile = deliveryArg ? deliveryArg.slice('--delivery='.length) : publicFile;
  if (!deliveryArg) {
    try {
      await access(publicFile);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      deliveryFile = `${base}/model.glb`;
    }
  }
  const originalBytes = await readFile(build.source),
    bytes = await readFile(deliveryFile),
    a = unpack(originalBytes),
    b = unpack(bytes);
  assert.equal(hash(originalBytes), build.sourceSha256);
  assert.equal(hash(bytes), build.sha256);
  assert.deepEqual(b.binary.subarray(0, a.binary.length), a.binary, 'original binary preserved');
  for (const field of ['nodes', 'skins', 'animations'])
    assert.deepEqual(b.doc[field], a.doc[field], `${key}: ${field}`);
  for (const field of ['images', 'textures', 'samplers', 'materials'])
    assert.deepEqual(b.doc[field].slice(0, a.doc[field].length), a.doc[field]);
  assert.equal(b.doc.meshes[0].primitives.length, 2);
  const oldPrim = a.doc.meshes[0].primitives[0],
    body = b.doc.meshes[0].primitives[0];
  const oldP = attribute(a.doc, a.binary, oldPrim.attributes.POSITION),
    newP = attribute(b.doc, b.binary, body.attributes.POSITION);
  const oldTris = attribute(a.doc, a.binary, oldPrim.indices).flat(),
    newTris = attribute(b.doc, b.binary, body.indices).flat();
  const triKey = (p, i) => i.map((j) => positionKey(p[j])).join('|'),
    present = new Set();
  for (let i = 0; i < newTris.length; i += 3) present.add(triKey(newP, newTris.slice(i, i + 3)));
  let retained = 0;
  for (let i = 0; i < oldTris.length; i += 3) {
    const ids = oldTris.slice(i, i + 3);
    if (ids.every((j) => oldP[j][1] < build.config.cutY - 1e-5)) {
      assert.ok(present.has(triKey(oldP, ids)), 'lower body triangle retained');
      retained++;
    }
  }
  const oldByPosition = new Map();
  oldP.forEach((p, i) => {
    const k = positionKey(p);
    if (!oldByPosition.has(k)) oldByPosition.set(k, []);
    oldByPosition.get(k).push(i);
  });
  let unchangedVertices = 0;
  for (const name of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0']) {
    const before = attribute(a.doc, a.binary, oldPrim.attributes[name]),
      after = attribute(b.doc, b.binary, body.attributes[name]);
    for (let i = 0; i < newP.length; i++) {
      if (newP[i][1] >= build.config.cutY - 1e-5) continue;
      const candidates = oldByPosition.get(positionKey(newP[i]));
      assert.ok(candidates?.length);
      if (name === 'POSITION') unchangedVertices++;
      // UV seams may share positions; match an exact source corner, not only one index.
      assert.ok(
        candidates.some((j) => JSON.stringify(before[j]) === JSON.stringify(after[i])),
        `${name} body unchanged`,
      );
    }
  }
  for (const prim of b.doc.meshes[0].primitives) {
    const p = attribute(b.doc, b.binary, prim.attributes.POSITION),
      w = attribute(b.doc, b.binary, prim.attributes.WEIGHTS_0),
      j = attribute(b.doc, b.binary, prim.attributes.JOINTS_0),
      n = attribute(b.doc, b.binary, prim.attributes.NORMAL);
    for (let i = 0; i < p.length; i++) {
      assert.ok([...p[i], ...w[i], ...n[i]].every(Number.isFinite));
      assert.ok(Math.abs(w[i].reduce((s, v) => s + v, 0) - 1) < 2e-5);
      assert.ok(j[i].every((v) => v < b.doc.skins[0].joints.length));
      assert.ok(Math.abs(Math.hypot(...n[i]) - 1) < 0.002);
    }
  }
  const gltf = await loadMotion(deliveryFile),
    meshes = [];
  gltf.scene.traverse((o) => {
    if (o.isSkinnedMesh) meshes.push(o);
  });
  assert.equal(meshes.length, 2);
  const byPosition = new Map();
  for (let i = 0; i < meshes[0].geometry.attributes.position.count; i++) {
    const v = new Vector3().fromBufferAttribute(meshes[0].geometry.attributes.position, i);
    if (Math.abs(v.y - build.config.cutY) < 1e-6) byPosition.set(positionKey(v.toArray()), i);
  }
  const pairs = [];
  for (let i = 0; i < meshes[1].geometry.attributes.position.count; i++) {
    const v = new Vector3().fromBufferAttribute(meshes[1].geometry.attributes.position, i);
    if (Math.abs(v.y - build.config.cutY) < 1e-6) {
      const j = byPosition.get(positionKey(v.toArray()));
      if (j !== undefined) pairs.push([j, i]);
    }
  }
  assert.ok(pairs.length >= 12, 'connected neck perimeter');
  let maximumSeamGap = 0,
    samples = 0;
  const v0 = new Vector3(),
    v1 = new Vector3();
  for (const clip of gltf.animations) {
    const mixer = pose(gltf, clip, 0),
      steps = Math.ceil(clip.duration * 120);
    for (let k = 0; k <= steps; k++) {
      const action = mixer.existingAction(clip);
      action.time = (clip.duration * k) / steps;
      mixer.update(0);
      gltf.scene.updateMatrixWorld(true);
      meshes.forEach((m) => m.skeleton.update());
      for (const [a, b] of pairs) {
        meshes[0].getVertexPosition(a, v0).applyMatrix4(meshes[0].matrixWorld);
        meshes[1].getVertexPosition(b, v1).applyMatrix4(meshes[1].matrixWorld);
        maximumSeamGap = Math.max(maximumSeamGap, v0.distanceTo(v1));
        samples++;
      }
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(gltf.scene);
  }
  assert.ok(maximumSeamGap < 1e-5, 'neck remains closed in every original clip');
  const lodFile =
    deliveryFile === publicFile
      ? `public/models/${key}/lod-face-r${revision}.glb`
      : `${base}/lod.glb`;
  const lodRecord = JSON.parse(await readFile(`${base}/lod.json`, 'utf8'));
  const lowBytes = await readFile(lodFile);
  assert.equal(lodRecord.sourceSha256, build.sha256);
  assert.equal(hash(lowBytes), lodRecord.sha256);
  const low = unpack(lowBytes);
  assert.deepEqual(low.doc.nodes, b.doc.nodes);
  assert.deepEqual(low.doc.skins[0].joints, b.doc.skins[0].joints);
  assert.equal(low.doc.meshes[0].primitives.length, 2);
  assert.equal(low.doc.animations.length, 0);
  assert.deepEqual(
    attribute(low.doc, low.binary, low.doc.skins[0].inverseBindMatrices),
    attribute(b.doc, b.binary, b.doc.skins[0].inverseBindMatrices),
  );
  let lowTriangles = 0,
    lowVertices = 0;
  for (let k = 0; k < 2; k++) {
    const highPrim = b.doc.meshes[0].primitives[k],
      lowPrim = low.doc.meshes[0].primitives[k],
      names = Object.keys(highPrim.attributes),
      highAttrs = names.map((n) => attribute(b.doc, b.binary, highPrim.attributes[n])),
      lowAttrs = names.map((n) => attribute(low.doc, low.binary, lowPrim.attributes[n])),
      corners = new Set(highAttrs[0].map((_, i) => JSON.stringify(highAttrs.map((a) => a[i]))));
    for (let i = 0; i < lowAttrs[0].length; i++)
      assert.ok(
        corners.has(JSON.stringify(lowAttrs.map((a) => a[i]))),
        'LOD uses exact source vertex attributes and joint indices',
      );
    lowVertices += lowAttrs[0].length;
    lowTriangles += low.doc.accessors[lowPrim.indices].count / 3;
  }
  results.push({
    key,
    sha256: build.sha256,
    triangles: build.triangles,
    retainedBodyTriangles: retained,
    unchangedBodyVertices: unchangedVertices,
    clips: gltf.animations.length,
    seamPairs: pairs.length,
    seamSamples: samples,
    maximumSeamGapMetres: maximumSeamGap,
    originalBytesPreserved: a.binary.length,
    lod: {
      triangles: lowTriangles,
      vertices: lowVertices,
      jointOrder: 'exact',
      vertexAttributes: 'exact source subset',
    },
  });
}
const report = { status: 'passed', results };
if (!noWrite)
  await writeFile(
    `assets/female-face-repair/validation-r${revision}.json`,
    JSON.stringify(report, null, 2) + '\n',
  );
console.log(JSON.stringify(report));
