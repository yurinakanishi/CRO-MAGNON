import { isMesh } from './three-types.js';
import * as THREE from 'three';
import {
  terrainHeight,
  walkHeight,
  riverX,
  riverFade,
  WATER_LEVEL,
  clamp,
  installSourceBridge,
} from '../shared/terrain.mjs';
import { NPC, INITIAL_RESOURCES, WORLD } from '../shared/world.mjs';
import { LandscapeInstances } from './world-assets.js';
import { fitSourceRiverBank } from './source-surface-fit.js';
import { SCENERY, seededRandom, grassForChunk } from '../shared/scenery-layout.mjs';
import { OpenWorldTerrain } from './open-world.js';
import { clipRiverAtCoast } from './paleo-materials.js';
import { RegionalScenery } from './regional-scenery.js';
import { BEHEMOTH_MARSH } from '../shared/behemoth-rules.mjs';

const TAU = Math.PI * 2;
const random = seededRandom;

function addModel(world, key, x, z, yaw = 0, scale = 1, surface = null) {
  const model = world.worldAssets.create(key, 0, surface);
  model.position.set(x, walkHeight(x, z), z);
  model.rotation.y = yaw;
  Array.isArray(scale) ? model.scale.set(...scale) : model.scale.setScalar(scale);
  world.scene.add(model);
  return model;
}

function surfaceMeshes(root) {
  root.updateMatrixWorld(true);
  const result = [];
  root.traverse((node) => {
    if (isMesh(node))
      result.push({
        geometry: node.geometry,
        material: node.material,
        matrix: node.matrixWorld.clone(),
      });
  });
  return result;
}

export async function buildTerrainAssets(world) {
  world.openWorld = new OpenWorldTerrain(world);
  await world.openWorld.initialize(world.focus);
  if (world.disposed) return;

  const waterTemplate = world.worldAssets.get('river-water').gltf.scene;
  const waterBounds = new THREE.Box3().setFromObject(waterTemplate),
    waterSize = waterBounds.getSize(new THREE.Vector3()),
    waterCentre = waterBounds.getCenter(new THREE.Vector3());
  world.water = new THREE.Group();
  world.water.name = 'TRELLIS river tiles';
  world.waterMaterial = new THREE.MeshStandardMaterial({
    color: '#92babb',
    roughness: 0.27,
    metalness: 0,
    transparent: true,
    opacity: 0.88,
    side: THREE.DoubleSide,
  });
  world.waterMaterial.userData.time = { value: 0 };
  world.waterMaterial.onBeforeCompile = (shader) => {
    clipRiverAtCoast(shader, world.openWorld.earthTextures);
    shader.uniforms.flowTime = world.waterMaterial.userData.time;
    shader.fragmentShader = 'uniform float flowTime;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      '#include <color_fragment>\n#ifdef USE_MAP\nfloat shimmer = pow(sin(vMapUv.y * 90.0 - flowTime * 1.5 + sin(vMapUv.x * 18.0)) * .5 + .5, 20.0); diffuseColor.rgb += shimmer * .035;\n#endif',
    );
  };
  for (let z = -58; z < 184; z += 12)
    for (const part of surfaceMeshes(waterTemplate)) {
      const geometry = part.geometry.clone().applyMatrix4(part.matrix),
        p = geometry.attributes.position;
      if (part.material.map) world.waterMaterial.map = part.material.map;
      for (let i = 0; i < p.count; i++) {
        const wz = z + ((p.getZ(i) - waterCentre.z) / waterSize.z) * 12.25;
        p.setXYZ(
          i,
          riverX(wz) + ((p.getX(i) - waterCentre.x) / waterSize.x) * 5.5 * riverFade(wz),
          WATER_LEVEL + (p.getY(i) - waterBounds.max.y) * 0.015,
          wz,
        );
      }
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      world.water.add(new THREE.Mesh(geometry, world.waterMaterial));
    }
  world.scene.add(world.water);
  buildMarshAssets(world);
  world.bridge = addModel(world, 'wood-footbridge', riverX(43.5), 43.5);
  const bridgeAsset = world.worldAssets.get('wood-footbridge').asset;
  world.bridge.position.y = 0.3 - bridgeAsset.placement.deckHeightMetres;
  world.releaseBridgeSampler = installSourceBridge(bridgeAsset.placement.walkBounds);
}

// The behemoth's marsh: each pool reuses the accepted river-water GLB as a flat
// tile with an irregular shore, floating ankle-deep above the shared basin
// floor, and a low mist drifts over the whole basin. Runtime effects only; no
// substitute geometry or new model assets.
function buildMarshAssets(world) {
  const M = BEHEMOTH_MARSH,
    time = world.waterMaterial.userData.time;
  const template = world.worldAssets.get('river-water').gltf.scene;
  template.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(template),
    size = box.getSize(new THREE.Vector3()),
    centre = box.getCenter(new THREE.Vector3());
  const pools = new THREE.Group();
  pools.name = 'behemoth marsh pools';
  for (const pool of M.pools) {
    // The river tile's own ripple texture, tinted toward still tea-coloured water.
    const material = new THREE.MeshStandardMaterial({
      color: '#93ad94',
      map: world.waterMaterial.map,
      roughness: 0.16,
      metalness: 0.05,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.marshTime = time;
      shader.uniforms.marshPool = { value: new THREE.Vector3(pool.x, pool.z, pool.radius) };
      shader.vertexShader = 'varying vec3 marshWorld;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nmarshWorld=(modelMatrix*vec4(transformed,1.0)).xyz;',
      );
      shader.fragmentShader =
        'uniform float marshTime;uniform vec3 marshPool;varying vec3 marshWorld;\n' +
        shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 shore=(marshWorld.xz-marshPool.xy)/marshPool.z;
        float edge=length(shore)+sin(shore.x*7.0+shore.y*5.0)*.05+cos(shore.y*9.0-shore.x*3.0)*.035;
        if(edge>.97)discard;
        float ripple=sin(marshWorld.x*4.0+marshWorld.z*2.2-marshTime*.7)*sin(marshWorld.z*3.1+marshTime*.5);
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.42,.46,.30),.35)+ripple*.02;
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.24,.21,.12),smoothstep(.70,.97,edge)*.7);`,
      );
    };
    material.customProgramCacheKey = () => 'behemoth-marsh-pool-3';
    const root = world.worldAssets.create('river-water');
    root.traverse((node) => {
      if (!isMesh(node)) return;
      node.material = material;
      // The shore is cut in the colour pass only; the square tile must not shadow the floor.
      node.castShadow = false;
      node.receiveShadow = false;
    });
    const span = pool.radius * 2.08;
    root.scale.set(span / size.x, 0.008, span / size.z);
    root.position.set(
      pool.x - centre.x * root.scale.x,
      terrainHeight(pool.x, pool.z) + M.waterLift - box.max.y * 0.008,
      pool.z - centre.z * root.scale.z,
    );
    pools.add(root);
  }
  world.scene.add(pools);
  const rng = random(95110),
    count = 260,
    positions = new Float32Array(count * 3),
    seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let x, z;
    do {
      x = M.x + (rng() * 2 - 1) * M.radius * 0.85;
      z = M.z + (rng() * 2 - 1) * M.radius * 0.85;
    } while (Math.hypot(x - M.x, z - M.z) > M.radius * 0.85);
    positions.set([x, terrainHeight(x, z) + 0.12 + rng() * 0.5, z], i * 3);
    seeds[i] = rng();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
  const mist = new THREE.Points(
    geometry,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { time, pixelScale: { value: world.renderer.getPixelRatio() } },
      vertexShader:
        'uniform float time;uniform float pixelScale;attribute float seed;varying float fade;void main(){vec3 drift=vec3(sin(time*.11+seed*6.28)*1.6,sin(time*.23+seed*9.0)*.06,cos(time*.09+seed*4.0)*1.6);vec4 mv=modelViewMatrix*vec4(position+drift,1.0);gl_PointSize=clamp(110.0*pixelScale/max(1.0,-mv.z),1.0,44.0);fade=smoothstep(80.0,30.0,length(mv.xyz))*smoothstep(1.5,4.0,length(mv.xyz));gl_Position=projectionMatrix*mv;}',
      fragmentShader:
        'varying float fade;void main(){vec2 p=gl_PointCoord*2.0-1.0;float d=dot(p,p);if(d>1.0)discard;gl_FragColor=vec4(vec3(.80,.84,.74),pow(1.0-d,2.0)*.06*fade);}',
    }),
  );
  mist.name = 'behemoth marsh mist';
  mist.frustumCulled = false;
  world.scene.add(mist);
  world.marsh = { pools, mist };
}

export function buildForestAssets(world) {
  const grassPlacement = (item) => ({
    ...item,
    position: new THREE.Vector3(item.x, terrainHeight(item.x, item.z) - 0.018, item.z),
    scale: new THREE.Vector3().setScalar(item.scale),
  });
  const trees = SCENERY.trees
    .filter((item) => !item.surface)
    .map((item) => ({
      ...item,
      position: new THREE.Vector3(item.x, terrainHeight(item.x, item.z), item.z),
      scale: new THREE.Vector3(...item.scale),
    }));
  const groundcover = (key) =>
    SCENERY.grass.filter((item) => (item.key ?? 'meadow-grass') === key).map(grassPlacement);
  const grass = groundcover('meadow-grass'),
    sprigs = groundcover('meadow-sprig');
  const rocks = SCENERY.rocks
    .filter((item) => !item.surface)
    .map((item) => ({
      ...item,
      height: 1.7 * item.scale,
      position: new THREE.Vector3(item.x, terrainHeight(item.x, item.z), item.z),
      scale: new THREE.Vector3().setScalar(item.scale),
    }));
  world.landscapes = [
    new LandscapeInstances({
      assets: world.worldAssets,
      key: 'valley-pine',
      placements: trees,
      renderer: world.renderer,
      scene: world.scene,
      distances: [14, 38, 110],
    }),
    new LandscapeInstances({
      assets: world.worldAssets,
      key: 'meadow-grass',
      placements: grass,
      renderer: world.renderer,
      scene: world.scene,
      distances: [1.1, 1.1, 28],
      foliage: true,
      generateCell: (x, z) =>
        grassForChunk(x - WORLD.minX / 32, z - WORLD.minZ / 32)
          .filter((item) => !item.surface && item.key === 'meadow-grass')
          .map(grassPlacement),
    }),
    new LandscapeInstances({
      assets: world.worldAssets,
      key: 'meadow-sprig',
      placements: sprigs,
      renderer: world.renderer,
      scene: world.scene,
      distances: [1.1, 1.1, 24],
      foliage: true,
      generateCell: (x, z) =>
        grassForChunk(x - WORLD.minX / 32, z - WORLD.minZ / 32)
          .filter((item) => !item.surface && item.key === 'meadow-sprig')
          .map(grassPlacement),
    }),
    new LandscapeInstances({
      assets: world.worldAssets,
      key: 'valley-boulder',
      placements: rocks,
      renderer: world.renderer,
      scene: world.scene,
      distances: [28, 28, 110],
    }),
  ];
  for (const item of SCENERY.ridges) {
    if (item.surface) continue;
    const rock = addModel(world, item.key, item.x, item.z, item.yaw, 1);
    if (Array.isArray(item.scale)) {
      rock.scale.set(...item.scale);
      rock.traverse((node) => {
        if (isMesh(node)) node.castShadow = false;
      });
    } else rock.scale.setScalar(item.scale);
    freezeStatic(world, rock);
  }
}
function freezeStatic(world, root) {
  root.updateMatrixWorld(true);
  root.traverse((node) => {
    node.matrixAutoUpdate = false;
  });
  const bounds = new THREE.Box3().setFromObject(root);
  world.staticScenery.push({ root, radius: bounds.getSize(new THREE.Vector3()).length() * 0.5 });
}
export function buildCampAssets(world) {
  for (const item of [...SCENERY.tents, ...SCENERY.props].filter((item) => !item.surface))
    freezeStatic(world, addModel(world, item.key, item.x, item.z, item.yaw, item.scale));
  for (const item of SCENERY.fires.filter((item) => !item.surface))
    buildFireEffect(world, item.x, item.z, item.scale);
  world.campLabel = world.createLabel('みんなの野営地', 'camp', new THREE.Vector3(50, 3, 50));
  world.npcLabel = world.createLabel(
    'オル',
    'npc',
    new THREE.Vector3(NPC.x, walkHeight(NPC.x, NPC.z) + 2.17, NPC.z),
    'ネアンデルタール人 · 交易',
  );
  world.regionalScenery = new RegionalScenery(world, { buildFireEffect });
  world.regionalScenery.initialize(world.focus);
}

function buildFireEffect(world, x, z, size, key = 'stone-firepit', surface = null) {
  const root = addModel(world, key, x, z, 0, size, surface);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(36 * 3), 3));
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { scale: { value: world.renderer.getPixelRatio() } },
    vertexShader:
      'uniform float scale; varying float heat; void main(){heat=position.y;vec4 mv=modelViewMatrix*vec4(position,1.0);gl_PointSize=clamp(110.0*scale/max(1.0,-mv.z)*(1.3-position.y*.3),1.0,80.0);gl_Position=projectionMatrix*mv;}',
    fragmentShader:
      'varying float heat;void main(){vec2 p=gl_PointCoord*2.0-1.0;float glow=pow(max(0.0,1.0-dot(p,p)),2.0);gl_FragColor=vec4(mix(vec3(1.0,.2,.015),vec3(1.0,.72,.16),clamp(heat,0.0,1.0)),glow*.38);}',
  });
  const sparks = new THREE.Points(geometry, material);
  root.add(sparks);
  const light = new THREE.PointLight('#ffad57', 4, 11, 1.6);
  light.position.set(x, terrainHeight(x, z) + 1.3, z);
  world.scene.add(light);
  const fire = { root, light, sparks, seed: x };
  world.fires.push(fire);
  return fire;
}

export function buildAnimalAssets(world) {
  for (const spec of SCENERY.animals) {
    const actor = world.worldAssets.createAnimal('woolly-mammoth'),
      model = new THREE.Group();
    model.add(actor.root);
    model.scale.setScalar(spec.scale);
    world.scene.add(model);
    model.userData.animalId = spec.id;
    const meat = world.worldAssets.create('mammoth-meat');
    meat.visible = false;
    meat.userData.animalId = spec.id;
    world.scene.add(meat);
    const label = world.createLabel('', 'animal', new THREE.Vector3());
    label.active = false;
    const health = document.createElement('progress');
    health.max = 100;
    health.value = 100;
    health.setAttribute('aria-label', 'マンモスの体力');
    label.element.append(health);
    world.mammoths.push({
      id: spec.id,
      model,
      meat,
      label,
      health,
      actor,
      initialized: false,
    });
  }
  const rng = random(623),
    points = [];
  for (let i = 0; i < 65; i++) points.push(rng() * 80 + 10, rng() * 5 + 1, rng() * 80 + 10);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  world.motes = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: '#eee5ab',
      size: 0.037,
      transparent: true,
      opacity: 0.57,
      depthWrite: false,
    }),
  );
  world.scene.add(world.motes);
}
