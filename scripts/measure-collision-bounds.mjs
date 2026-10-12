import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// The meshopt decoder three bundles with its GLTFLoader, the one the game decodes with
// (src/embedded-glb.ts). Original GLBs need none; compressed deliveries require it.
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// Parse the actual mesh/skin data (EXT_meshopt_compression decoded with three's bundled
// decoder); omit materials only in this measurement copy.
// No model file is changed and no substitute visible geometry is constructed.
export async function geometryScene(filename) {
  const bytes = await readFile(filename),
    jsonLength = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  doc.materials = [];
  doc.images = [];
  doc.textures = [];
  for (const mesh of doc.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  const json = Buffer.from(JSON.stringify(doc));
  const padding = (4 - (json.length % 4)) % 4;
  const chunk = Buffer.concat([json, Buffer.alloc(padding, 32)]);
  const binary = bytes.subarray(20 + jsonLength);
  const result = Buffer.alloc(20 + chunk.length + binary.length);
  result.writeUInt32LE(0x46546c67, 0);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(chunk.length, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  chunk.copy(result, 20);
  binary.copy(result, 20 + chunk.length);
  await MeshoptDecoder.ready;
  return new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(result.buffer.slice(result.byteOffset, result.byteOffset + result.length), '');
}

// The models shared/model-bounds.mts records, in its order. Each entry is measured from the GLB
// the model's public/models/<key>/asset.json delivers and records that file's SHA-256;
// tests/model-bounds.test.mjs re-measures every entry against the current delivery.
export const MEASURED_KEYS = Object.freeze([
  'firewood-log',
  'hide-tent',
  'valley-boulder',
  'valley-pine',
  'firewood-pile',
  'drying-rack',
  'stone-firepit',
  'wood-footbridge',
  'woolly-mammoth',
]);

// Bodies collide with the spruce's trunk, not its crown (modelBox in shared/collision.mts): the
// surface above the root flare and below the crown, up to a standing body's height. On the
// delivered Norway spruce the flare spreads below 0.5 m (0.75 m from the axis at the ground), the
// trunk is 0.43-0.53 m across from 0.5 m to 2 m and the crown starts at 2.02 m.
export const TRUNK_BAND = Object.freeze({ low: 0.5, high: 1.8 });
// A wider band has met foliage or a differently shaped tree: measure that tree's band first.
const TRUNK_MAX_ACROSS = 1;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** The GLB a model's asset.json delivers, checked against the SHA-256 that manifest records. */
export async function deliveredModel(key) {
  const asset = JSON.parse(await readFile(`public/models/${key}/asset.json`, 'utf8'));
  const file = `public${asset.url}`,
    hash = sha256(await readFile(file));
  if (hash !== asset.sha256)
    throw new Error(`${file}: SHA-256 ${hash}, ${key}/asset.json records ${asset.sha256}`);
  return { url: asset.url, file, sha256: hash };
}

// The surface's extent between two heights. Every triangle is clipped to the band: vertices alone
// miss a sparse trunk's long edges where they cross its ends.
function bandBox(scene, low, high) {
  const box = new THREE.Box3(),
    corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()],
    cut = new THREE.Vector3();
  scene.traverse((node) => {
    if (!node.isMesh) return;
    const index = node.geometry.index,
      count = index ? index.count : node.geometry.attributes.position.count;
    for (let i = 0; i < count; i += 3) {
      corners.forEach((corner, k) =>
        node
          .getVertexPosition(index ? index.getX(i + k) : i + k, corner)
          .applyMatrix4(node.matrixWorld),
      );
      corners.forEach((a, k) => {
        const b = corners[(k + 1) % 3];
        if (a.y >= low && a.y <= high) box.expandByPoint(a);
        for (const y of [low, high])
          if ((a.y - y) * (b.y - y) < 0)
            box.expandByPoint(cut.lerpVectors(a, b, (y - a.y) / (b.y - a.y)));
      });
    }
  });
  return box;
}

/** Bounds, horizontal radius and, for the spruce, collision trunk of a model's delivered GLB. */
export async function measureModelBounds(key) {
  const { file, sha256: hash } = await deliveredModel(key),
    { scene } = await geometryScene(file);
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene, true);
  const point = new THREE.Vector3();
  let radius = 0;
  scene.traverse((node) => {
    if (!node.isMesh) return;
    for (let i = 0; i < node.geometry.attributes.position.count; i++) {
      node.getVertexPosition(i, point);
      point.applyMatrix4(node.matrixWorld);
      radius = Math.max(radius, Math.hypot(point.x, point.z));
    }
  });
  const bounds = { min: box.min.toArray(), max: box.max.toArray(), radius, sha256: hash };
  if (key !== 'valley-pine') return bounds;
  const trunk = bandBox(scene, TRUNK_BAND.low, TRUNK_BAND.high),
    across = trunk.getSize(point);
  if (trunk.isEmpty() || Math.max(across.x, across.z) > TRUNK_MAX_ACROSS)
    throw new Error(
      `${file}: the trunk band ${TRUNK_BAND.low}-${TRUNK_BAND.high} m is ` +
        (trunk.isEmpty() ? 'empty' : `${across.x.toFixed(2)} x ${across.z.toFixed(2)} m across`),
    );
  return { ...bounds, trunk: { min: trunk.min.toArray(), max: trunk.max.toArray() } };
}

if (process.argv[1]?.endsWith('measure-collision-bounds.mjs')) {
  const bounds = {};
  for (const key of MEASURED_KEYS) bounds[key] = await measureModelBounds(key);
  const target = 'shared/model-bounds.mts',
    prettier = await import('prettier');
  await writeFile(
    target,
    await prettier.format(
      '// Measured by scripts/measure-collision-bounds.mjs from the GLB each\n' +
        '// public/models/<key>/asset.json delivers; sha256 is that file.\n' +
        `export const MODEL_BOUNDS = ${JSON.stringify(bounds)};\n`,
      { ...(await prettier.resolveConfig(target)), filepath: target },
    ),
  );
  console.log(JSON.stringify(bounds, null, 2));
}
