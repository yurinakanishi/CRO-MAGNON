import * as THREE from 'three';
import { terrainHeight, walkHeight, riverX, WATER_LEVEL, clamp, installSourceTerrain, installSourceBridge } from '/shared/terrain.mjs';
import { NPC, INITIAL_RESOURCES } from '/shared/world.mjs';
import { LandscapeInstances } from './world-assets.js';
import { fitSourceRiverBank } from './source-surface-fit.js';

export const resourceAssets = { wood: 'firewood-pile', stone: 'valley-boulder', berry: 'berry-bush' };
const TAU = Math.PI * 2;
function random(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function addModel(world, key, x, z, yaw = 0, scale = 1) {
  const model = world.worldAssets.create(key); model.position.set(x, walkHeight(x, z), z); model.rotation.y = yaw; model.scale.setScalar(scale); world.scene.add(model); return model;
}

function cameraBox(world, x, z, width, height, depth, yaw = 0) {
  // Invisible interaction/camera geometry, never a rendered replacement asset.
  const object = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), new THREE.MeshBasicMaterial({ visible: false }));
  object.position.set(x, walkHeight(x, z) + height / 2, z); object.rotation.y = yaw;
  world.scene.add(object); world.cameraBlockers.push(object);
}

function surfaceMeshes(root) {
  root.updateMatrixWorld(true); const result = [];
  root.traverse(node => { if (node.isMesh) result.push({ geometry: node.geometry, material: node.material, matrix: node.matrixWorld.clone() }); });
  return result;
}

export function buildTerrainAssets(world) {
  const terrainTemplate = world.worldAssets.get('meadow-ground').gltf.scene;
  const placement = world.worldAssets.get('meadow-ground').asset.placement;
  world.releaseTerrainSampler = installSourceTerrain(placement.heightField);
  const sourceBounds = new THREE.Box3().setFromObject(terrainTemplate), size = sourceBounds.getSize(new THREE.Vector3());
  const centre = sourceBounds.getCenter(new THREE.Vector3());
  world.terrain = new THREE.Group(); world.terrain.name = 'TRELLIS meadow tiles';
  const parts = surfaceMeshes(terrainTemplate);
  // The original reconstructed top/bottom faces, UVs and relief are retained.
  // A shallow bank offset fits the river;
  // distant hills use reconstructed boulders rather than a generated height field.
  for (let x = -90; x <= 190; x += 20) for (let z = -90; z <= 190; z += 20) {
    for (const part of parts) {
      const source = part.geometry.clone().applyMatrix4(part.matrix), original = source.attributes.position;
      for (let i = 0; i < original.count; i++) {
        original.setXYZ(i, x + (original.getX(i) - centre.x) / size.x * 20.04, original.getY(i) - placement.surfaceHeightMetres, z + (original.getZ(i) - centre.z) / size.z * 20.04);
      }
      const geometry = fitSourceRiverBank(source), p = geometry.attributes.position;
      if (geometry !== source) source.dispose();
      const colors = new Float32Array(p.count * 3), color = new THREE.Color();
      for (let i = 0; i < p.count; i++) {
        const wx = p.getX(i), wz = p.getZ(i);
        const camp = clamp((10 - Math.hypot(wx - 50, wz - 50)) / 3, 0, 1), orl = clamp((5 - Math.hypot(wx - 70, wz - 41)) / 2, 0, 1);
        const trail = Math.exp(-((wx - 49 - Math.sin(wz * .16) * 2) ** 2) / 1.8) * .6;
        const crossing = wx > 45 && wx < 78 ? Math.exp(-(((wz - 43.5) / 1.7) ** 2)) * .8 : 0;
        const dirt = Math.max(camp, orl, trail, crossing);
        color.setRGB(1 + dirt * .55, 1 + dirt * .2, 1 - dirt * .08); color.toArray(colors, i * 3);
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
      const material = part.material.clone(); material.vertexColors = true; material.roughness = 1;
      const mesh = new THREE.Mesh(geometry, material); mesh.receiveShadow = true; world.terrain.add(mesh);
    }
  }
  world.scene.add(world.terrain);

  const waterTemplate = world.worldAssets.get('river-water').gltf.scene;
  const waterBounds = new THREE.Box3().setFromObject(waterTemplate), waterSize = waterBounds.getSize(new THREE.Vector3()), waterCentre = waterBounds.getCenter(new THREE.Vector3());
  world.water = new THREE.Group(); world.water.name = 'TRELLIS river tiles';
  world.waterMaterial = new THREE.MeshStandardMaterial({ color: '#92babb', roughness: .27, metalness: 0, transparent: true, opacity: .88, side: THREE.DoubleSide });
  world.waterMaterial.userData.time = { value: 0 };
  world.waterMaterial.onBeforeCompile = shader => {
    shader.uniforms.flowTime = world.waterMaterial.userData.time;
    shader.fragmentShader = 'uniform float flowTime;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n#ifdef USE_MAP\nfloat shimmer = pow(sin(vMapUv.y * 90.0 - flowTime * 1.5 + sin(vMapUv.x * 18.0)) * .5 + .5, 20.0); diffuseColor.rgb += shimmer * .035;\n#endif');
  };
  for (let z = -94; z < 198; z += 12) for (const part of surfaceMeshes(waterTemplate)) {
    const geometry = part.geometry.clone().applyMatrix4(part.matrix), p = geometry.attributes.position;
    if (part.material.map) world.waterMaterial.map = part.material.map;
    for (let i = 0; i < p.count; i++) {
      const wz = z + (p.getZ(i) - waterCentre.z) / waterSize.z * 12.25;
      p.setXYZ(i, riverX(wz) + (p.getX(i) - waterCentre.x) / waterSize.x * 5.5, WATER_LEVEL + (p.getY(i) - waterBounds.max.y) * .015, wz);
    }
    geometry.computeVertexNormals(); geometry.computeBoundingSphere(); world.water.add(new THREE.Mesh(geometry, world.waterMaterial));
  }
  world.scene.add(world.water);
  world.bridge = addModel(world, 'wood-footbridge', riverX(43.5), 43.5);
  const bridgeAsset = world.worldAssets.get('wood-footbridge').asset;
  world.bridge.position.y = .3 - bridgeAsset.placement.deckHeightMetres;
  world.releaseBridgeSampler = installSourceBridge(bridgeAsset.placement.walkBounds);
}

export function buildForestAssets(world) {
  const rng = random(404), trees = [], grass = [];
  for (let i = 0; i < 840; i++) {
    const x = -35 + rng() * 170, z = -35 + rng() * 170;
    if (Math.hypot(x - 50, z - 50) < 14 || Math.hypot(x - 70, z - 41) < 7 || Math.abs(x - riverX(z)) < 5.8 || Math.abs(x - 49 - Math.sin(z * .16) * 2) < 2.7 || (x > 43 && x < 80 && Math.abs(z - 43.5) < 2.8)) continue;
    if (INITIAL_RESOURCES.some(r => Math.hypot(r.x - x, r.z - z) < 2)) continue;
    const height = 6 + rng() * 7, width = .75 + rng() * .5, yaw = rng() * TAU;
    trees.push({ position: new THREE.Vector3(x, terrainHeight(x, z), z), scale: new THREE.Vector3(width * height / 10, height / 10, width * height / 10), height, yaw });
    cameraBox(world, x, z, .45, height * .7, .45);
  }
  for (let i = 0; i < 13500; i++) {
    const x = rng() * 115 - 7, z = rng() * 115 - 7;
    if (Math.hypot(x - 50, z - 50) < 10 || Math.hypot(x - 70, z - 41) < 5 || Math.abs(x - riverX(z)) < 3.4 || Math.abs(x - 49 - Math.sin(z * .16) * 2) < 1.8 || (x > 45 && x < 78 && Math.abs(z - 43.5) < 1.9)) continue;
    const s = .65 + rng() * .65; grass.push({ position: new THREE.Vector3(x, terrainHeight(x, z) - .018, z), scale: new THREE.Vector3(s, s, s), height: .55 * s, yaw: rng() * TAU });
  }
  world.landscapes = [
    new LandscapeInstances({ assets: world.worldAssets, key: 'valley-pine', placements: trees, renderer: world.renderer, scene: world.scene, distances: [18, 48, 130] }),
    new LandscapeInstances({ assets: world.worldAssets, key: 'meadow-grass', placements: grass, renderer: world.renderer, scene: world.scene, distances: [2.4, 2.4, 32], foliage: true }),
  ];
  for (let i = 0; i < 65; i++) {
    const x = rng() * 140 - 20, z = rng() * 140 - 20;
    if (Math.hypot(x - 50, z - 50) < 16 || Math.hypot(x - 70, z - 41) < 7 || Math.abs(x - riverX(z)) < 5) continue;
    const s = .4 + rng() * 2.6; addModel(world, 'valley-boulder', x, z, rng() * TAU, s / 1.7); cameraBox(world, x, z, s, s * .8, s);
  }
  for (let i = 0; i < 34; i++) {
    const angle = i / 34 * TAU, radius = 77 + rng() * 16;
    const rock = addModel(world, 'valley-boulder', 50 + Math.sin(angle) * radius, 50 + Math.cos(angle) * radius, angle, 1);
    const height = 14 + rng() * 19; rock.scale.set(height * .9, height / 1.7, height * .7);
    rock.traverse(node => { if (node.isMesh) node.castShadow = false; });
  }
}

export function buildCampAssets(world) {
  for (const [x, z, yaw, scale] of [[45, 46, .4, 1], [54.5, 44, -.55, .85], [54, 55, -2, .65], [73, 37, -.7, .85]]) {
    addModel(world, 'hide-tent', x, z, yaw, scale); cameraBox(world, x, z, 3.5 * scale, 2.8 * scale, 3 * scale, yaw);
  }
  addModel(world, 'drying-rack', 55.8, 50); addModel(world, 'firewood-pile', 47, 49, 0, 1.25);
  buildFireEffect(world, 50, 50, 1); buildFireEffect(world, 72, 43, .65);
  world.campLabel = world.createLabel('みんなの野営地', 'camp', new THREE.Vector3(50, 3, 50));
  world.npcLabel = world.createLabel('オル', 'npc', new THREE.Vector3(NPC.x, walkHeight(NPC.x, NPC.z) + 2.17, NPC.z), 'ネアンデルタール人 · 交易');
}

function buildFireEffect(world, x, z, size) {
  const root = addModel(world, 'stone-firepit', x, z, 0, size);
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(36 * 3), 3));
  const material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { scale: { value: world.renderer.getPixelRatio() } },
    vertexShader: 'uniform float scale; varying float heat; void main(){heat=position.y;vec4 mv=modelViewMatrix*vec4(position,1.0);gl_PointSize=clamp(110.0*scale/max(1.0,-mv.z)*(1.3-position.y*.3),1.0,80.0);gl_Position=projectionMatrix*mv;}',
    fragmentShader: 'varying float heat;void main(){vec2 p=gl_PointCoord*2.0-1.0;float glow=pow(max(0.0,1.0-dot(p,p)),2.0);gl_FragColor=vec4(mix(vec3(1.0,.2,.015),vec3(1.0,.72,.16),clamp(heat,0.0,1.0)),glow*.38);}',
  });
  const sparks = new THREE.Points(geometry, material); root.add(sparks);
  const light = new THREE.PointLight('#ffad57', 4, 11, 1.6); light.position.set(x, terrainHeight(x, z) + 1.3, z); world.scene.add(light);
  world.fires.push({ root, light, sparks, seed: x });
}

export function buildAnimalAssets(world) {
  for (const [x, z, scale] of [[37, 29, 1], [29, 67, .76]]) {
    const actor = world.worldAssets.createAnimal('woolly-mammoth'); actor.root.scale.setScalar(scale); world.scene.add(actor.root);
    world.mammoths.push({ model: actor.root, actor, x, z, scale, phase: x * .35, age: x, angle: x * .35 });
  }
  const rng = random(623), points = [];
  for (let i = 0; i < 65; i++) points.push(rng() * 80 + 10, rng() * 5 + 1, rng() * 80 + 10);
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  world.motes = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#eee5ab', size: .037, transparent: true, opacity: .57, depthWrite: false })); world.scene.add(world.motes);
}
