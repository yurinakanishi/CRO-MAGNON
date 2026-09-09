import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const MOTION_KEYS = [
  'cro-magnon-woman',
  'cro-magnon-hunter',
  'neanderthal-woman',
  'neanderthal-hunter',
  'cat-kunoichi',
  'desert-fennec-mage',
  'crow-shaman',
  'woolly-mammoth',
];

export function unpack(bytes) {
  const end = 20 + bytes.readUInt32LE(12);
  return { doc: JSON.parse(bytes.subarray(20, end).toString()), binary: bytes.subarray(end + 8) };
}

export function pack(doc, binary) {
  const json = Buffer.from(JSON.stringify(doc));
  const jl = Math.ceil(json.length / 4) * 4,
    bl = Math.ceil(binary.length / 4) * 4;
  const out = Buffer.alloc(28 + jl + bl);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(jl, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  out.fill(32, 20, 20 + jl);
  json.copy(out, 20);
  out.writeUInt32LE(bl, 20 + jl);
  out.writeUInt32LE(0x004e4942, 24 + jl);
  binary.copy(out, 28 + jl);
  return out;
}

// CPU inspection uses the exact skin and animation buffers; only texture decoding
// is omitted. Browser review loads the unchanged textured delivery separately.
export async function loadMotion(file) {
  const bytes = await readFile(file),
    { doc, binary } = unpack(bytes);
  const inspection = structuredClone(doc);
  inspection.materials = [
    { name: 'Inspection', pbrMetallicRoughness: { baseColorFactor: [0.6, 0.6, 0.6, 1] } },
  ];
  for (const mesh of inspection.meshes) for (const p of mesh.primitives) p.material = 0;
  delete inspection.images;
  delete inspection.textures;
  delete inspection.samplers;
  const clean = pack(inspection, binary);
  const gltf = await new GLTFLoader().parseAsync(
    clean.buffer.slice(clean.byteOffset, clean.byteOffset + clean.byteLength),
    '',
  );
  gltf.scene.updateMatrixWorld(true);
  return { bytes, doc, binary, ...gltf };
}

export function pose(gltf, clip, time) {
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  action.time = time;
  mixer.update(0);
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((n) => {
    if (n.isSkinnedMesh) n.skeleton.update();
  });
  return mixer;
}
