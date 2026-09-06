import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

// Independent delivery check for the uncompressed, embedded GLBs used by this project.
// Visual quality, contact and intersections still require the actual GLB to be rendered.
const filename = process.argv[2];
if (!filename) {
  console.error('Usage: node scripts/inspect-glb.mjs <model.glb> [--humanoid] [--hunting] [--enemy]');
  process.exit(1);
}
const humanoid = process.argv.includes('--humanoid');
const hunting = process.argv.includes('--hunting');
const enemy = process.argv.includes('--enemy');
const biped = humanoid || enemy;
const requiredClips = enemy
  ? ['Idle_Loop', 'Walk_Loop', 'Run_Loop', 'Attack', 'Hit', 'Death']
  : ['Idle_Loop', 'Walk_Loop', 'Run_Loop', 'Gather', 'Craft', 'Give', 'Eat', 'Wave', ...(hunting ? ['Attack'] : [])];
const errors = [];
function requireValue(condition, message) { if (!condition) throw new Error(message); }

try {
  const bytes = await readFile(filename);
  requireValue(bytes.length >= 20 && bytes.readUInt32LE(0) === 0x46546c67, 'Invalid GLB header');
  requireValue(bytes.readUInt32LE(4) === 2 && bytes.readUInt32LE(8) === bytes.length, 'Invalid GLB version or length');
  let doc, binary;
  for (let offset = 12; offset < bytes.length;) {
    requireValue(offset + 8 <= bytes.length, 'Truncated chunk header');
    const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
    offset += 8;
    requireValue(length % 4 === 0 && offset + length <= bytes.length, 'Invalid chunk length');
    if (type === 0x4e4f534a) {
      requireValue(!doc && offset === 20, 'JSON must be the first and only JSON chunk');
      doc = JSON.parse(bytes.subarray(offset, offset + length).toString('utf8').trim());
    } else if (type === 0x004e4942) {
      requireValue(!binary, 'Multiple binary chunks');
      binary = bytes.subarray(offset, offset + length);
    }
    offset += length;
  }
  requireValue(doc?.asset?.version === '2.0' && binary, 'Missing glTF 2.0 document or binary data');
  requireValue(doc.buffers?.length === 1 && !doc.buffers[0].uri, 'Expected one embedded GLB buffer');
  requireValue(doc.buffers[0].byteLength <= binary.length && binary.length - doc.buffers[0].byteLength <= 3, 'Invalid embedded buffer length');
  for (const view of doc.bufferViews ?? []) requireValue(view.buffer === 0 && Number.isInteger(view.byteLength) && view.byteLength >= 0 && (view.byteOffset ?? 0) >= 0 && (view.byteOffset ?? 0) + view.byteLength <= doc.buffers[0].byteLength, 'Invalid buffer view');
  for (const image of doc.images ?? []) requireValue(image.bufferView !== undefined || image.uri?.startsWith('data:'), 'External image reference');
  const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const components = {
    5120: { bytes: 1, read: 'readInt8', scale: 127, signed: true },
    5121: { bytes: 1, read: 'readUInt8', scale: 255 },
    5122: { bytes: 2, read: 'readInt16LE', scale: 32767, signed: true },
    5123: { bytes: 2, read: 'readUInt16LE', scale: 65535 },
    5125: { bytes: 4, read: 'readUInt32LE', scale: 4294967295 },
    5126: { bytes: 4, read: 'readFloatLE' },
  };
  const cache = new Map();
  function readAccessor(index) {
    if (cache.has(index)) return cache.get(index);
    const accessor = doc.accessors?.[index];
    requireValue(accessor && !accessor.sparse, `Accessor ${index}: missing or sparse (not supported by this delivery checker)`);
    const view = doc.bufferViews?.[accessor.bufferView], component = components[accessor.componentType], width = widths[accessor.type];
    requireValue(view && component && width && view.buffer === 0, `Accessor ${index}: unsupported layout`);
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0), size = width * component.bytes, stride = view.byteStride ?? size;
    requireValue(Number.isInteger(accessor.count) && accessor.count >= 0 && stride >= size, `Accessor ${index}: invalid count or stride`);
    const end = start + (accessor.count ? (accessor.count - 1) * stride + size : 0);
    requireValue(start >= (view.byteOffset ?? 0) && end <= (view.byteOffset ?? 0) + view.byteLength && end <= doc.buffers[0].byteLength, `Accessor ${index}: out of bounds`);
    const values = Array.from({ length: accessor.count }, (_, row) => Array.from({ length: width }, (_, column) => {
      let value = binary[component.read](start + row * stride + column * component.bytes);
      if (accessor.normalized && component.scale) value = component.signed ? Math.max(value / component.scale, -1) : value / component.scale;
      requireValue(Number.isFinite(value), `Accessor ${index}: non-finite value`);
      return value;
    }));
    cache.set(index, values);
    return values;
  }

  const nodes = doc.nodes ?? [], parents = new Map();
  for (const [index, node] of nodes.entries()) for (const child of node.children ?? []) {
    requireValue(nodes[child] && !parents.has(child), 'Invalid child or multiple node parents');
    parents.set(child, index);
  }
  for (let i = 0; i < nodes.length; i++) {
    const seen = new Set();
    for (let current = i; current !== undefined; current = parents.get(current)) {
      requireValue(!seen.has(current), 'Cyclic node hierarchy');
      seen.add(current);
    }
  }
  let triangles = 0;
  for (const mesh of doc.meshes ?? []) for (const primitive of mesh.primitives) {
    const positions = readAccessor(primitive.attributes.POSITION);
    requireValue(positions.every(value => value.length === 3), 'Invalid position accessor');
    const indices = primitive.indices === undefined ? null : readAccessor(primitive.indices);
    if (indices) requireValue(indices.every(([index]) => Number.isInteger(index) && index >= 0 && index < positions.length), 'Mesh index out of range');
    if ((primitive.mode ?? 4) === 4) triangles += (indices?.length ?? positions.length) / 3;
  }
  const skins = [], rootJoints = new Set();
  for (const [index, skin] of (doc.skins ?? []).entries()) {
    const jointSet = new Set(skin.joints);
    requireValue(jointSet.size === skin.joints.length && skin.joints.every(joint => nodes[joint]), `Skin ${index}: invalid joints`);
    const roots = skin.joints.filter(joint => !jointSet.has(parents.get(joint)));
    roots.forEach(root => rootJoints.add(root));
    if (biped && (roots.length !== 1 || nodes[roots[0]].name !== 'Root')) errors.push(`Skin ${index}: expected one Root joint`);
    requireValue(skin.inverseBindMatrices !== undefined, `Skin ${index}: inverse bind matrices missing`);
    const matrices = readAccessor(skin.inverseBindMatrices);
    requireValue(matrices.length === skin.joints.length && matrices.every(row => row.length === 16), `Skin ${index}: inverse bind matrix count/type mismatch`);
    let vertices = 0, unweighted = 0, invalidWeights = 0, invalidJoints = 0, maxInfluences = 0, maxWeightError = 0;
    for (const node of nodes.filter(node => node.skin === index)) for (const primitive of doc.meshes[node.mesh].primitives) {
      const count = doc.accessors[primitive.attributes.POSITION].count;
      const sets = Object.keys(primitive.attributes).filter(key => /^WEIGHTS_\d+$/.test(key)).map(key => ({
        weights: readAccessor(primitive.attributes[key]), joints: readAccessor(primitive.attributes[key.replace('WEIGHTS_', 'JOINTS_')]),
      }));
      requireValue(sets.length && sets.every(set => set.weights.length === count && set.joints.length === count && set.weights.every(row => row.length === 4) && set.joints.every(row => row.length === 4)), 'Missing/mismatched skin attributes');
      for (let vertex = 0; vertex < count; vertex++) {
        let sum = 0, influences = 0;
        for (const set of sets) for (let slot = 0; slot < 4; slot++) {
          const weight = set.weights[vertex][slot], joint = set.joints[vertex][slot];
          sum += weight;
          if (weight > 0) influences++;
          if (weight < 0 || weight > 1) invalidWeights++;
          if (!Number.isInteger(joint) || joint < 0 || joint >= skin.joints.length) invalidJoints++;
        }
        if (sum <= 0) unweighted++;
        maxWeightError = Math.max(maxWeightError, Math.abs(1 - sum));
        maxInfluences = Math.max(maxInfluences, influences);
      }
      vertices += count;
    }
    if (unweighted || invalidWeights || invalidJoints || maxInfluences > 4 || maxWeightError > .001) errors.push(`Skin ${index}: weight/joint validation failed`);
    if (biped && !vertices) errors.push(`Skin ${index}: no bound vertices`);
    skins.push({ joints: skin.joints.length, roots: roots.map(root => nodes[root].name), vertices, unweighted, invalidWeights, invalidJoints, maxInfluences, maxWeightError });
  }

  const animations = (doc.animations ?? []).map(animation => {
    let duration = 0, loopClosed = true, rootInPlace = true;
    for (const channel of animation.channels) {
      requireValue(nodes[channel.target.node], 'Animation targets a missing node');
      const sampler = animation.samplers[channel.sampler], input = readAccessor(sampler.input), output = readAccessor(sampler.output);
      requireValue(input.length && input.every((row, index) => row.length === 1 && row[0] >= 0 && (!index || row[0] > input[index - 1][0])), 'Invalid animation key times');
      duration = Math.max(duration, input.at(-1)[0]);
      if (channel.target.path === 'weights') continue;
      const multiplier = sampler.interpolation === 'CUBICSPLINE' ? 3 : 1;
      requireValue(output.length === input.length * multiplier, 'Animation key count mismatch');
      const key = index => output[index * multiplier + (multiplier === 3 ? 1 : 0)];
      const first = key(0), last = key(input.length - 1);
      let closureError = Math.max(...first.map((value, index) => Math.abs(value - last[index])));
      if (channel.target.path === 'rotation') closureError = Math.min(closureError, Math.max(...first.map((value, index) => Math.abs(value + last[index]))));
      if (closureError > .0001) loopClosed = false;
      if (rootJoints.has(channel.target.node)) {
        for (let index = 1; index < input.length; index++) if (Math.max(...key(index).map((value, slot) => Math.abs(value - first[slot]))) > .0001) rootInPlace = false;
      }
    }
    if (animation.name?.endsWith('_Loop') && !loopClosed) errors.push(`${animation.name}: loop endpoints differ`);
    if (biped && (!duration || !animation.channels.length)) errors.push(`${animation.name}: empty animation`);
    if (biped && !rootInPlace) errors.push(`${animation.name}: Root moves`);
    return { name: animation.name, duration, channels: animation.channels.length, loopClosed, rootInPlace };
  });
  if (biped) {
    if (!skins.length) errors.push('Biped has no skin');
    for (const clip of requiredClips) if (animations.filter(animation => animation.name === clip).length !== 1) errors.push(`Expected exactly one ${clip} clip`);
    if (humanoid) for (const socket of ['Grip.L', 'Grip.R']) if (!nodes.some(node => node.name === socket)) errors.push(`Missing socket ${socket}`);
  }
  if (hunting && !biped) {
    for (const name of ['Idle_Loop', 'Walk_Loop', 'Run_Loop', 'Graze_Loop', 'Death']) {
      if (animations.filter(animation => animation.name === name).length !== 1) errors.push(`Expected exactly one ${name} clip`);
    }
    if (!skins.length) errors.push('Hunted animal has no skin');
    if (animations.some(animation => !animation.rootInPlace)) errors.push('Hunted animal Root moves');
  }
  const report = { file: path.resolve(filename), sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, triangles, skins, animations, validation: errors.length ? 'failed' : 'passed', errors, visualReviewRequired: true };
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) process.exitCode = 1;
} catch (error) {
  console.error(`GLB validation failed: ${error.message}`);
  process.exitCode = 1;
}
