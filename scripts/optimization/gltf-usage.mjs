// What each glTF object means to this pipeline: allowed extensions, accessor roles,
// buffer-view usage and texture semantics. Unknown data is rejected, never guessed.
import { MESHOPT } from './glb.mjs';

// Extensions whose data needs no rewrite here; none of them references buffer views
// or adds texture slots, so the pipeline can preserve them verbatim.
export const PRESERVED_EXTENSIONS = Object.freeze([
  'EXT_texture_webp',
  'KHR_texture_transform',
  'KHR_materials_emissive_strength',
  'KHR_materials_unlit',
  'KHR_materials_ior',
  'KHR_mesh_quantization',
]);

export function checkExtensions(json, label, { allowMeshopt = false } = {}) {
  const fail = (message) => {
    throw new Error(`${label}: ${message}`);
  };
  const allowed = new Set([...PRESERVED_EXTENSIONS, ...(allowMeshopt ? [MESHOPT] : [])]),
    used = new Set(json.extensionsUsed ?? []);
  for (const name of json.extensionsRequired ?? [])
    if (!used.has(name)) fail(`${name} is required but missing from extensionsUsed`);
  for (const name of used)
    if (!allowed.has(name)) fail(`unsupported glTF extension ${name}; this pipeline cannot verify its data`);
  const walk = (value, where) => {
    if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${where}[${index}]`));
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'extras') continue;
      if (key === 'extensions' && child && typeof child === 'object')
        for (const name of Object.keys(child)) {
          if (!allowed.has(name)) fail(`${where}.extensions.${name} is not supported by this pipeline`);
          if (!used.has(name)) fail(`${where}.extensions.${name} is missing from extensionsUsed`);
        }
      walk(child, `${where}.${key}`);
    }
  };
  walk(json, '$');
}

export function accessorRoles(json) {
  const roles = (json.accessors ?? []).map(() => new Set()),
    triangleLists = (json.accessors ?? []).map(() => true);
  for (const mesh of json.meshes ?? [])
    for (const primitive of mesh.primitives ?? []) {
      for (const accessor of Object.values(primitive.attributes ?? {})) roles[accessor].add('attribute');
      for (const target of primitive.targets ?? [])
        for (const accessor of Object.values(target)) roles[accessor].add('attribute');
      if (primitive.indices !== undefined) {
        roles[primitive.indices].add('index');
        if ((primitive.mode ?? 4) !== 4) triangleLists[primitive.indices] = false;
      }
    }
  for (const skin of json.skins ?? [])
    if (skin.inverseBindMatrices !== undefined) roles[skin.inverseBindMatrices].add('skin');
  for (const animation of json.animations ?? [])
    for (const sampler of animation.samplers ?? []) {
      roles[sampler.input].add('animation');
      roles[sampler.output].add('animation');
    }
  return { roles, triangleLists };
}

export function viewUsage(json) {
  const { roles, triangleLists } = accessorRoles(json),
    usage = (json.bufferViews ?? []).map(() => ({
      accessors: [],
      images: [],
      sparse: false,
      roles: new Set(),
      triangleLists: true,
    }));
  (json.accessors ?? []).forEach((accessor, index) => {
    if (accessor.bufferView !== undefined) {
      const use = usage[accessor.bufferView];
      use.accessors.push(index);
      if (!roles[index].size) use.roles.add('unreferenced-accessor');
      for (const role of roles[index]) use.roles.add(role);
      if (roles[index].has('index') && !triangleLists[index]) use.triangleLists = false;
    }
    if (accessor.sparse) {
      usage[accessor.sparse.indices.bufferView].sparse = true;
      usage[accessor.sparse.values.bufferView].sparse = true;
    }
  });
  (json.images ?? []).forEach((image, index) => usage[image.bufferView].images.push(index));
  return usage;
}

/** Views whose byte ranges overlap another view in the same buffer. */
export function overlappingViews(json) {
  const ranges = (json.bufferViews ?? [])
      .map((view, index) => ({
        index,
        buffer: view.buffer,
        start: view.byteOffset ?? 0,
        end: (view.byteOffset ?? 0) + view.byteLength,
      }))
      .sort((a, b) => a.buffer - b.buffer || a.start - b.start || a.end - b.end),
    overlapping = new Set();
  let furthest = null;
  for (const range of ranges) {
    if (furthest && furthest.buffer === range.buffer && range.start < furthest.end) {
      overlapping.add(range.index);
      overlapping.add(furthest.index);
    }
    if (!furthest || furthest.buffer !== range.buffer || range.end > furthest.end) furthest = range;
  }
  return overlapping;
}

// Core material texture slots and the resampling semantics each one needs.
export const TEXTURE_SLOTS = Object.freeze([
  ['pbrMetallicRoughness.baseColorTexture', 'color'],
  ['pbrMetallicRoughness.metallicRoughnessTexture', 'data'],
  ['normalTexture', 'normal'],
  ['occlusionTexture', 'data'],
  ['emissiveTexture', 'color'],
]);

/** One resampling treatment per image, derived from every material slot that samples it. */
export function imageSemantics(json, label) {
  const images = json.images ?? [],
    textures = json.textures ?? [],
    uses = images.map(() => []);
  (json.materials ?? []).forEach((material, m) => {
    for (const [slot, kind] of TEXTURE_SLOTS) {
      const info = slot.split('.').reduce((value, key) => value?.[key], material);
      if (info === undefined) continue;
      if (!Number.isInteger(info.index) || info.index < 0 || info.index >= textures.length)
        throw new Error(`${label}: material ${m} ${slot} references a missing texture`);
      const texture = textures[info.index],
        sources = [texture.source, texture.extensions?.EXT_texture_webp?.source].filter((s) => s !== undefined);
      if (!sources.length) throw new Error(`${label}: texture ${info.index} has no image source`);
      for (const source of sources)
        uses[source].push({ material: m, slot, kind, texture: info.index, alphaMode: material.alphaMode ?? 'OPAQUE' });
    }
  });
  return uses.map((list, index) => {
    const kinds = new Set(list.map((use) => use.kind)),
      warnings = [];
    let treatment;
    if (!list.length) {
      treatment = 'unreferenced';
      warnings.push('not sampled by any material; resized with independent box-filtered channels');
    } else if (kinds.size > 1)
      throw new Error(
        `${label}: image ${index} is sampled with incompatible semantics (${[...kinds].join(', ')}); refusing to pick one resampling rule`,
      );
    else if (kinds.has('normal')) treatment = 'normal';
    else if (kinds.has('data')) treatment = 'data';
    else {
      const modes = new Set(list.map((use) => (use.alphaMode === 'OPAQUE' ? 'opaque' : 'alpha')));
      treatment = modes.has('opaque') ? 'color-opaque' : 'color-alpha';
      if (modes.size > 1)
        warnings.push('sampled by opaque and alpha materials; channels resized independently to keep opaque colours');
    }
    return { treatment, uses: list, warnings };
  });
}
