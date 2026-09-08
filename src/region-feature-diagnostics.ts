import { isTexture } from './three-types.js';
// Count actual object identities, so a future clone of geometry, material or
// texture cannot accidentally pass the memory-sharing check.
export function regionFeatureDiagnostics(assets, instances, keys) {
  const sources = { geometry: new Set(), material: new Set(), texture: new Set() },
    copies = { geometry: new Set(), material: new Set(), texture: new Set() };
  const collect = (root, sets) =>
    root.traverse((node) => {
      if (node.geometry) sets.geometry.add(node.geometry);
      for (const material of [node.material].flat().filter(Boolean)) {
        sets.material.add(material);
        for (const value of Object.values(material)) if (isTexture(value)) sets.texture.add(value);
      }
    });
  const loaded = [],
    counts = Object.fromEntries([...keys].map((key) => [key, 0])),
    lodCounts = Object.fromEntries([...keys].map((key) => [key, [0, 0, 0]]));
  for (const key of keys) {
    const template = assets.templates.get(key);
    if (!template) continue;
    loaded.push(key);
    for (const model of [template.gltf, ...template.lods]) collect(model.scene, sources);
  }
  for (const root of instances.values()) {
    const key = root.userData.regionFeature;
    if (!keys.has(key)) continue;
    counts[key]++;
    lodCounts[key][root.isLOD ? root.getCurrentLevel() : 0]++;
    collect(root, copies);
  }
  return {
    counts,
    lodCounts,
    loaded,
    sourceGeometries: sources.geometry.size,
    sourceTextures: sources.texture.size,
    extraGeometries: [...copies.geometry].filter((value) => !sources.geometry.has(value)).length,
    extraMaterials: [...copies.material].filter((value) => !sources.material.has(value)).length,
    extraTextures: [...copies.texture].filter((value) => !sources.texture.has(value)).length,
  };
}
