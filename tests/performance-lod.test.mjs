import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  configureActorPerformance,
  disposeActorPerformance,
  updateActorPerformance,
} from '../dist/src/performance-lod.js';
import { applyBehemothPalette } from '../dist/src/behemoth-palette.js';
import { WorldAssets } from '../dist/src/world-assets.js';
import { buildWoodPile } from '../dist/src/wood-pile.js';
import {
  CAMP_CAVE,
  CAMP_MOUNTAIN,
  campMountainVisualLod,
} from '../dist/shared/camp-cave-layout.mjs';
import { CASTLE } from '../dist/shared/castle-layout.mjs';

test('actors switch to their reduced mesh at half the authored distance, adding no draw objects', () => {
  const high = new THREE.BoxGeometry(1, 2, 0.6),
    low = new THREE.BoxGeometry(0.9, 1.9, 0.55),
    root = new THREE.Group(),
    lowRoot = new THREE.Group(),
    mesh = new THREE.Mesh(high, new THREE.MeshStandardMaterial());
  mesh.name = 'body';
  root.add(mesh);
  const reduced = new THREE.Mesh(low, new THREE.MeshBasicMaterial());
  reduced.name = 'body';
  lowRoot.add(reduced);
  const flags = [mesh.castShadow, mesh.receiveShadow];
  configureActorPerformance(root, lowRoot, {
    modelKey: 'test-actor',
    kind: 'humanoid',
    lods: [{ distanceMetres: 28 }],
  });
  const objects = () => {
    let count = 0;
    root.traverse(() => count++);
    return count;
  };
  const before = objects();
  // 28 m authored → 14 m, with 2 m of hysteresis on either side.
  assert.equal(updateActorPerformance(root, 15.9), 0, 'near side of hysteresis stays detailed');
  assert.equal(mesh.geometry, high);
  assert.equal(updateActorPerformance(root, 16.1), 1);
  assert.equal(mesh.geometry, low);
  assert.equal(updateActorPerformance(root, 12.1), 1, 'far side of hysteresis stays reduced');
  assert.equal(updateActorPerformance(root, 11.9), 0);
  assert.equal(mesh.geometry, high);
  // A stale third argument from the removed quality tiers changes nothing.
  assert.equal(updateActorPerformance(root, 20, 'standard'), 1);
  assert.equal(objects(), before, 'no shadow-only helper is drawn without a shadow map');
  assert.deepEqual([mesh.castShadow, mesh.receiveShadow], flags);
  root.updateMatrixWorld(true);
  const hits = new THREE.Raycaster(
    new THREE.Vector3(0, 0, 4),
    new THREE.Vector3(0, 0, -1),
  ).intersectObject(root, true);
  assert.ok(hits.length > 0 && hits.every((hit) => hit.object === mesh));
  let disposedGeometry = 0;
  low.addEventListener('dispose', () => disposedGeometry++);
  disposeActorPerformance(root);
  assert.equal(mesh.geometry, high);
  assert.equal(root.userData.actorDetail, undefined);
  assert.equal(disposedGeometry, 0, 'shared template geometry remains alive');
});

test('actors without a low mesh keep their only geometry at every distance', () => {
  const root = new THREE.Group(),
    geometry = new THREE.SphereGeometry(),
    mesh = new THREE.Mesh(geometry);
  root.add(mesh);
  configureActorPerformance(root, null, { modelKey: 'no-low' });
  for (const distance of [5, 25, 35, 5]) {
    updateActorPerformance(root, distance);
    assert.equal(mesh.geometry, geometry);
  }
  assert.equal(root.children.length, 1);
  disposeActorPerformance(root);
});

test('a reduced skinned surface keeps the animated skeleton, bind pose and material', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 2, 0], 3),
  );
  geometry.setAttribute(
    'skinIndex',
    new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], 4),
  );
  geometry.setAttribute(
    'skinWeight',
    new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
  );
  const root = new THREE.Group(),
    parent = new THREE.Group(),
    base = new THREE.Bone(),
    tip = new THREE.Bone();
  tip.position.y = 1;
  base.add(tip);
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  mesh.name = 'body';
  parent.add(mesh, base);
  root.add(parent);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([base, tip]));
  const lowRoot = new THREE.Group(),
    low = mesh.clone(false);
  low.geometry = geometry.clone();
  lowRoot.add(low);
  configureActorPerformance(root, lowRoot, { modelKey: 'skinned-test' });
  const { skeleton, material } = mesh,
    bind = mesh.bindMatrix.clone();
  assert.equal(updateActorPerformance(root, 24), 1);
  assert.equal(mesh.geometry, low.geometry);
  assert.equal(mesh.skeleton, skeleton);
  assert.equal(mesh.material, material);
  assert.ok(mesh.bindMatrix.equals(bind));
  root.position.set(19, 4, -11);
  root.rotation.y = 0.8;
  root.scale.set(1.2, 1.6, 0.8);
  parent.rotation.z = 0.2;
  mesh.position.x = 0.25;
  mesh.rotation.y = 0.1;
  const posed = (distance) => {
    updateActorPerformance(root, distance);
    return [0, 1, 2].map((i) =>
      mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld),
    );
  };
  for (const angle of [-0.6, 0, 0.7]) {
    tip.rotation.z = angle;
    root.updateMatrixWorld(true);
    mesh.skeleton.update();
    const reduced = posed(24),
      detailed = posed(5);
    // Identical vertex data on both levels: switching never moves the posed surface.
    reduced.forEach((point, i) => assert.ok(point.distanceTo(detailed[i]) < 1e-6));
  }
  let skeletonDisposed = false;
  mesh.skeleton.dispose = () => {
    skeletonDisposed = true;
  };
  disposeActorPerformance(root);
  assert.equal(skeletonDisposed, false);
});

// One triangle with exactly the given glTF attribute semantics.
function triangle({ tangent = false, color = false, normal = true } = {}) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  if (normal)
    geometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3),
    );
  if (tangent)
    geometry.setAttribute(
      'tangent',
      new THREE.Float32BufferAttribute([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1], 4),
    );
  if (color)
    geometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1], 3),
    );
  return geometry;
}
// The installed GLTFLoader's final-material step (GLTFParser.assignFinalMaterial), which any
// parsed glTF exposes: what the loader makes of `base` for `geometry`.
const { parser } = await new GLTFLoader().parseAsync(
  JSON.stringify({ asset: { version: '2.0' }, scenes: [{}], scene: 0 }),
  '',
);
function finalized(geometry, base) {
  const probe = new THREE.Mesh(geometry, base);
  parser.assignFinalMaterial(probe);
  return probe.material;
}
// One actor mesh: its close geometry wearing `material`, and a reduced GLB mesh of the same name.
function actor(high, low, material) {
  const root = new THREE.Group(),
    lowRoot = new THREE.Group(),
    mesh = new THREE.Mesh(high, material),
    reduced = new THREE.Mesh(low, new THREE.MeshStandardMaterial());
  mesh.name = reduced.name = 'body';
  root.add(mesh);
  lowRoot.add(reduced);
  const asset = { modelKey: 'material-test', lods: [{ distanceMetres: 28 }] };
  return {
    root,
    lowRoot,
    mesh,
    reduced,
    asset,
    detail: configureActorPerformance(root, lowRoot, asset),
  };
}
function disposals(resource) {
  let count = 0;
  resource.addEventListener('dispose', () => count++);
  return () => count;
}
const NEAR = 5,
  FAR = 40;

test('the reduced level wears the close material finalized for its own tangents, both ways', () => {
  for (const [close, far] of [
    [{ tangent: true }, {}],
    [{}, { tangent: true }],
  ]) {
    const map = new THREE.Texture(),
      normalMap = new THREE.Texture(),
      base = new THREE.MeshStandardMaterial({
        map,
        normalMap,
        normalScale: new THREE.Vector2(0.8, 0.8),
      });
    const highGeometry = triangle(close),
      lowGeometry = triangle(far),
      adopted = finalized(highGeometry, base),
      expected = finalized(lowGeometry, base);
    const { root, mesh, detail } = actor(highGeometry, lowGeometry, adopted);
    assert.equal(mesh.material, adopted, 'configuring changes nothing that is drawn');
    assert.equal(updateActorPerformance(root, FAR), 1);
    assert.equal(mesh.geometry, lowGeometry);
    assert.notEqual(mesh.material, adopted);
    assert.deepEqual(mesh.material.normalScale.toArray(), expected.normalScale.toArray());
    assert.equal(mesh.material.normalScale.y, -adopted.normalScale.y);
    assert.equal(mesh.material.map, map);
    assert.equal(mesh.material.normalMap, normalMap);
    assert.deepEqual(adopted.normalScale.toArray(), close.tangent ? [0.8, 0.8] : [0.8, -0.8]);
    assert.equal(updateActorPerformance(root, NEAR), 0);
    assert.equal(mesh.material, adopted);
    assert.equal(detail.variants.length, 1);
    disposeActorPerformance(root);
    assert.equal(mesh.material, adopted);
  }
});

test('clearcoat normals, vertex colours and missing normals follow the loader too', () => {
  const physical = new THREE.MeshPhysicalMaterial({
    normalMap: new THREE.Texture(),
    normalScale: new THREE.Vector2(0.6, 0.6),
    clearcoat: 1,
    clearcoatNormalMap: new THREE.Texture(),
    clearcoatNormalScale: new THREE.Vector2(0.5, 0.5),
  });
  const coated = actor(triangle({ tangent: true }), triangle(), physical),
    coatedExpected = finalized(triangle(), physical);
  updateActorPerformance(coated.root, FAR);
  assert.deepEqual(
    coated.mesh.material.normalScale.toArray(),
    coatedExpected.normalScale.toArray(),
  );
  assert.deepEqual(
    coated.mesh.material.clearcoatNormalScale.toArray(),
    coatedExpected.clearcoatNormalScale.toArray(),
  );
  assert.deepEqual(physical.clearcoatNormalScale.toArray(), [0.5, 0.5]);
  disposeActorPerformance(coated.root);
  for (const [close, far] of [
    [{ color: true }, {}],
    [{}, { color: true }],
    [{}, { normal: false }],
    [{ normal: false }, {}],
  ]) {
    const base = new THREE.MeshStandardMaterial(),
      highGeometry = triangle(close),
      lowGeometry = triangle(far),
      adopted = finalized(highGeometry, base),
      expected = finalized(lowGeometry, base);
    const { root, mesh } = actor(highGeometry, lowGeometry, adopted);
    updateActorPerformance(root, FAR);
    const label = JSON.stringify({ close, far });
    assert.notEqual(mesh.material, adopted, label);
    assert.equal(mesh.material.vertexColors, expected.vertexColors, label);
    assert.equal(mesh.material.flatShading, expected.flatShading, label);
    updateActorPerformance(root, NEAR);
    assert.equal(mesh.material, adopted, label);
    disposeActorPerformance(root);
  }
});

test('matching geometry keeps the very same material, singly or in arrays', () => {
  const normalMap = new THREE.Texture(),
    adopted = new THREE.MeshStandardMaterial({ normalMap });
  const same = actor(triangle({ tangent: true }), triangle({ tangent: true }), adopted),
    unaffected = actor(triangle({ tangent: true }), triangle(), new THREE.MeshBasicMaterial());
  for (const { root, mesh, detail } of [same, unaffected]) {
    const material = mesh.material;
    updateActorPerformance(root, FAR);
    assert.equal(mesh.material, material, 'nothing in the final state changes');
    assert.equal(detail.variants.length, 0);
    disposeActorPerformance(root);
  }
  const high = triangle({ tangent: true }),
    low = triangle(),
    basic = new THREE.MeshBasicMaterial(),
    list = [adopted, basic];
  for (const geometry of [high, low]) {
    geometry.addGroup(0, 3, 0);
    geometry.addGroup(0, 3, 1);
  }
  const { root, mesh, detail } = actor(high, low, list);
  updateActorPerformance(root, FAR);
  assert.ok(Array.isArray(mesh.material) && mesh.material !== list);
  assert.equal(mesh.material.length, 2);
  assert.equal(mesh.material[0].normalScale.y, -adopted.normalScale.y);
  assert.equal(mesh.material[1], basic, 'a material without a normal scale is shared as is');
  assert.equal(detail.variants.length, 1);
  updateActorPerformance(root, NEAR);
  assert.equal(mesh.material, list);
  disposeActorPerformance(root);
  assert.equal(mesh.material, list);
});

test('a variant keeps the per-actor tint, the behemoth palette hooks and the material data', () => {
  const normalMap = new THREE.Texture();
  // CharacterAssets tints its own copy of each TribeAccent material.
  const template = new THREE.MeshStandardMaterial({
      name: 'TribeAccent',
      normalMap,
      color: '#ffffff',
    }),
    personal = template.clone();
  personal.color.set('#b04020');
  const tinted = actor(triangle({ tangent: true }), triangle(), personal);
  updateActorPerformance(tinted.root, FAR);
  assert.equal(tinted.mesh.material.color.getHexString(), 'b04020');
  assert.equal(tinted.mesh.material.name, 'TribeAccent');
  assert.equal(template.color.getHexString(), 'ffffff');
  disposeActorPerformance(tinted.root);
  // WorldAssets recompiles the violet behemoth's template materials (behemoth-palette.ts).
  const beast = new THREE.MeshStandardMaterial({ normalMap });
  applyBehemothPalette(beast);
  beast.userData.palette = { kept: true };
  beast.onBeforeRender = function marked() {};
  assert.notEqual(
    beast.clone().customProgramCacheKey,
    beast.customProgramCacheKey,
    'clone drops hooks',
  );
  const { root, mesh } = actor(triangle({ tangent: true }), triangle(), beast);
  updateActorPerformance(root, FAR);
  const variant = mesh.material;
  assert.notEqual(variant, beast);
  assert.equal(variant.onBeforeCompile, beast.onBeforeCompile);
  assert.equal(variant.customProgramCacheKey, beast.customProgramCacheKey);
  assert.equal(variant.customProgramCacheKey(), 'violet-behemoth-palette-1');
  assert.equal(variant.onBeforeRender, beast.onBeforeRender);
  assert.equal(variant.userData, beast.userData);
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  variant.onBeforeCompile(shader, null);
  assert.ok(
    shader.fragmentShader.includes('beastViolet'),
    'the palette is compiled at the far level',
  );
  disposeActorPerformance(root);
});

test('variants are made once per actor, switched without allocation and released exactly once', () => {
  const normalMap = new THREE.Texture(),
    adopted = new THREE.MeshStandardMaterial({ normalMap }),
    high = triangle({ tangent: true }),
    low = triangle();
  const a = actor(high, low, adopted),
    b = actor(high, low, adopted);
  updateActorPerformance(a.root, FAR);
  updateActorPerformance(b.root, FAR);
  const first = a.mesh.material,
    other = b.mesh.material;
  assert.ok(first !== adopted && other !== adopted && first !== other, 'one variant per actor');
  const adoptedDisposed = disposals(adopted),
    templateDisposed = disposals(a.reduced.material),
    firstDisposed = disposals(first),
    otherDisposed = disposals(other),
    textureDisposed = disposals(normalMap),
    highDisposed = disposals(high),
    lowDisposed = disposals(low);
  const clone = THREE.Material.prototype.clone;
  let clones = 0;
  THREE.Material.prototype.clone = function counted() {
    clones++;
    return clone.call(this);
  };
  try {
    const worn = new Set(),
      drawn = new Set();
    for (let i = 0; i < 20; i++) {
      updateActorPerformance(a.root, i % 2 ? NEAR : FAR);
      worn.add(a.mesh.material);
      drawn.add(a.mesh.geometry);
    }
    assert.equal(clones, 0, 'switching makes no materials');
    assert.ok(worn.size === 2 && worn.has(adopted) && worn.has(first), 'only the two levels');
    assert.ok(drawn.size === 2 && drawn.has(high) && drawn.has(low));
  } finally {
    THREE.Material.prototype.clone = clone;
  }
  // A repeated configuration starts from the adopted state and releases its earlier variant.
  updateActorPerformance(a.root, FAR);
  configureActorPerformance(a.root, a.lowRoot, a.asset);
  assert.equal(firstDisposed(), 1);
  assert.equal(a.mesh.material, adopted);
  assert.equal(a.mesh.geometry, high);
  updateActorPerformance(a.root, FAR);
  const second = a.mesh.material,
    secondDisposed = disposals(second);
  assert.ok(second !== first && second !== adopted);
  disposeActorPerformance(a.root);
  disposeActorPerformance(a.root);
  assert.deepEqual([firstDisposed(), secondDisposed(), otherDisposed()], [1, 1, 0]);
  assert.equal(a.mesh.material, adopted);
  assert.equal(b.mesh.material, other, 'the other actor keeps its own variant');
  disposeActorPerformance(b.root);
  assert.equal(otherDisposed(), 1);
  assert.deepEqual(
    [adoptedDisposed(), templateDisposed(), textureDisposed(), highDisposed(), lowDisposed()],
    [0, 0, 0, 0, 0],
    'shared materials, textures and geometry stay alive',
  );
});

test('a torch grasp may replace either geometry; the level keeps wearing its own material', () => {
  const adopted = new THREE.MeshStandardMaterial({ normalMap: new THREE.Texture() }),
    { root, mesh, detail } = actor(triangle({ tangent: true }), triangle(), adopted),
    [entry] = detail.meshes;
  for (const key of ['mesh', 'high', 'low', 'highMaterial', 'lowMaterial']) assert.ok(key in entry);
  // TorchGrasp swaps in morph-target clones of the same geometry and re-applies the level.
  entry.low = entry.low.clone();
  entry.high = entry.high.clone();
  mesh.geometry = detail.level ? entry.low : entry.high;
  updateActorPerformance(root, FAR);
  assert.equal(detail.level, 1);
  assert.equal(mesh.geometry, entry.low);
  assert.equal(mesh.material, entry.lowMaterial);
  updateActorPerformance(root, NEAR);
  assert.equal(mesh.geometry, entry.high);
  assert.equal(mesh.material, adopted);
  disposeActorPerformance(root);
});

test('camp props and wood piles are only their LOD levels, with no hidden shadow helpers', () => {
  const assets = new WorldAssets();
  const level = (radius) => {
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(radius), new THREE.MeshStandardMaterial()));
    return { scene };
  };
  for (const key of ['berry-bush', 'hide-tent', 'firewood-pile', 'stone-firepit', 'firewood-log'])
    assets.templates.set(key, {
      gltf: level(1),
      lods: [level(0.9)],
      asset: { modelKey: key, lods: [{ distanceMetres: 14 }] },
    });
  const roots = [
    ...['berry-bush', 'hide-tent', 'firewood-pile', 'stone-firepit'].map((key) =>
      assets.createResource(key),
    ),
    buildWoodPile(assets, 6, null).root,
  ];
  for (const root of roots) {
    assert.ok(root.isLOD);
    assert.deepEqual(
      root.children,
      root.levels.map((entry) => entry.object),
      `${root.userData.assetKey}: nothing beside its levels`,
    );
    root.traverse((node) => {
      if (node.isMesh) assert.notEqual(node.material.colorWrite, false);
    });
  }
});

test('camp mountain keeps detail at camp and cave but uses its light LOD from the castle', () => {
  assert.equal(campMountainVisualLod(50, 50), 0);
  assert.equal(campMountainVisualLod(CAMP_CAVE.x, CAMP_CAVE.z), 0);
  assert.equal(campMountainVisualLod(CASTLE.x, CASTLE.z), 1);
  const edge = CAMP_MOUNTAIN.detail;
  assert.equal(campMountainVisualLod(edge.x + edge.radius + 1, edge.z, 0), 0);
  assert.equal(campMountainVisualLod(edge.x + edge.radius + 1, edge.z, 1), 1);
});
