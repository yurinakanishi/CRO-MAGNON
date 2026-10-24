import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  ACTOR_DAYLIGHT,
  CAMP_DAYLIGHT,
  DAYLIGHT,
  installActorDaylight,
  wearDaylight,
} from '../dist/src/actor-daylight.js';
import { materialCopy } from '../dist/src/material-variants.js';
import { WorldAtmosphere } from '../dist/src/world-atmosphere.js';
import {
  CAVE_LIGHT,
  CAVE_LIGHT_VOLUME,
  caveInteriorWeight,
  insideCaveLightVolume,
} from '../dist/shared/cave-light.mjs';
import { CAMP_CAVE, CAVE_HEARTH, caveWorldAt } from '../dist/shared/camp-cave-layout.mjs';
import { CAMP_CAVE_SURFACE } from '../dist/shared/camp-cave-surface.mjs';
import { SCENERY } from '../dist/shared/scenery-layout.mjs';
import { walkHeight } from '../dist/shared/terrain.mjs';

const shaderOf = (material) => {
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  };
  material.onBeforeCompile(shader, null);
  return shader;
};
const actor = (...materials) => {
  const root = new THREE.Group();
  for (const material of materials) root.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
  return root;
};

test('the cave light volume holds every lit torch and the hearth, and no outdoor fire', () => {
  let torches = 0;
  for (let x = -40; x <= 100; x += 0.5)
    for (let z = 60; z <= 200; z += 0.5) {
      const floor = CAMP_CAVE.elevation + CAMP_CAVE_SURFACE.height(x, z);
      if (!(caveInteriorWeight({ x, z, y: floor }) > 0)) continue;
      torches++;
      // The flame rides above the hand, within reach of where the traveler stands.
      for (const [dx, dz] of [
        [0, 0],
        [0.8, 0],
        [-0.8, 0],
        [0, 0.8],
        [0, -0.8],
      ])
        for (const up of [0.3, 3.5])
          assert.ok(insideCaveLightVolume({ x: x + dx, y: floor + up, z: z + dz }), `${x},${z}`);
    }
  assert.ok(torches > 2000, 'the measured interior');
  const hearth = { x: CAVE_HEARTH.x, z: CAVE_HEARTH.z };
  assert.ok(insideCaveLightVolume({ ...hearth, y: walkHeight(hearth.x, hearth.z) + 1.3 }));
  // Every outdoor fire's light (world-scenery.ts: 1.3 m over the ground) stays outside.
  assert.ok(SCENERY.fires.length > 10);
  for (const fire of SCENERY.fires)
    assert.equal(
      insideCaveLightVolume({ x: fire.x, y: walkHeight(fire.x, fire.z) + 1.3, z: fire.z }),
      false,
      `${fire.x},${fire.z}`,
    );
  // Above the cave, on the mountain, is outdoors.
  const deep = caveWorldAt(-30);
  assert.equal(insideCaveLightVolume({ ...deep, y: CAMP_CAVE.elevation + 20 }), false);
});

test('the shader tells cave lights apart exactly as insideCaveLightVolume does', () => {
  const material = new THREE.MeshStandardMaterial();
  installActorDaylight(actor(material));
  const text = shaderOf(material).fragmentShader;
  const number = (pattern) => Number(text.match(pattern)[1]);
  const glsl = {
    z: number(/float localZ = ([\d.-]+) - world\.z;/),
    depth: number(/clamp\( -localZ \/ ([\d.-]+), 0\.0, 1\.0 \)/),
    x: number(/float side = ([\d.-]+) - world\.x/),
    offset: number(/world\.x - ([\d.-]+) \* t \* t/),
    mouth: number(/localZ < ([\d.-]+) &&/),
    end: number(/localZ > ([\d.-]+) &&/),
    across: number(/abs\( side \) < ([\d.-]+)/),
    ceiling: number(/world\.y < ([\d.-]+);/),
  };
  const inside = ({ x, y, z }) => {
    const localZ = glsl.z - z;
    const t = Math.min(1, Math.max(0, -localZ / glsl.depth));
    const side = glsl.x - x - glsl.offset * t * t * (3 - 2 * t);
    return (
      localZ < glsl.mouth && localZ > glsl.end && Math.abs(side) < glsl.across && y < glsl.ceiling
    );
  };
  assert.equal(glsl.mouth, CAVE_LIGHT_VOLUME.mouth);
  let random = 7;
  const next = () => (random = (random * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 20000; i++) {
    const p = { x: -30 + next() * 120, y: -5 + next() * 25, z: 60 + next() * 140 };
    assert.equal(inside(p), insideCaveLightVolume(p), JSON.stringify(p));
  }
});

test('an actor material takes the daylight once, after its own hook, and keeps it in copies', () => {
  const dyed = new THREE.MeshStandardMaterial({ name: 'Dyed' });
  let dyes = 0;
  dyed.onBeforeCompile = (shader) => {
    dyes++;
    shader.uniforms.clothDyeOn = { value: 1 };
  };
  dyed.customProgramCacheKey = () => 'clothing-dye-1';
  const plain = new THREE.MeshStandardMaterial({ name: 'Plain' });
  const eyes = new THREE.MeshBasicMaterial({ name: 'Unlit' });
  const root = actor(dyed, plain, eyes);
  installActorDaylight(root);
  const hook = dyed.onBeforeCompile;
  installActorDaylight(root);
  assert.equal(dyed.onBeforeCompile, hook, 'a second actor of the template adds nothing');
  assert.equal(dyed.customProgramCacheKey(), 'clothing-dye-1-actor-daylight-1');
  assert.match(plain.customProgramCacheKey(), /-actor-daylight-1$/);
  assert.equal(eyes.onBeforeCompile, THREE.Material.prototype.onBeforeCompile, 'unlit stays');
  const shader = shaderOf(dyed);
  assert.equal(dyes, 1, 'the dye still runs, once');
  assert.ok(shader.uniforms.clothDyeOn);
  for (const [name, uniform] of Object.entries(ACTOR_DAYLIGHT))
    assert.equal(shader.uniforms[name], uniform, `${name} is shared by every actor`);
  const text = shader.fragmentShader;
  assert.ok(!text.includes('#include <lights_fragment_begin>'));
  assert.match(text, /directLight\.color \*= actorDaylightOutsideCave\( pointLight\.position \);/);
  assert.match(text, /directLight\.color \*= 1\.0 - actorDaylightOn;/);
  assert.match(text, /irradiance \+= \( 1\.0 - actorDaylightOn \) \* getHemisphereLightIrradiance/);
  assert.match(text, /directLight\.color = actorDaylightOn \* actorDaylightSun;/);
  assert.match(
    text,
    /irradiance \+= actorDaylightOn \* mix\( actorDaylightGround, actorDaylightSky,/,
  );
  // An LOD variant or camera fade copy keeps the hook; a plain clone has none until installed.
  const variant = materialCopy(dyed);
  installActorDaylight(actor(variant));
  assert.equal(variant.onBeforeCompile, hook);
  assert.equal(variant.customProgramCacheKey(), dyed.customProgramCacheKey());
  const tint = plain.clone();
  assert.equal(tint.onBeforeCompile, THREE.Material.prototype.onBeforeCompile);
  installActorDaylight(actor(tint));
  assert.equal(tint.customProgramCacheKey(), plain.customProgramCacheKey());
  assert.ok(shaderOf(tint).fragmentShader.includes('actorDaylightOutsideCave'));
});

test('the gallery wears the camp daylight the world starts from, premultiplied', () => {
  wearDaylight(CAMP_DAYLIGHT);
  assert.equal(ACTOR_DAYLIGHT.actorDaylightOn.value, 1);
  const hemisphere = new THREE.HemisphereLight(DAYLIGHT.sky, DAYLIGHT.ground, DAYLIGHT.hemisphere);
  const sun = new THREE.DirectionalLight(DAYLIGHT.sun, DAYLIGHT.directional);
  assert.ok(
    ACTOR_DAYLIGHT.actorDaylightSky.value.equals(
      hemisphere.color.clone().multiplyScalar(hemisphere.intensity),
    ),
  );
  assert.ok(
    ACTOR_DAYLIGHT.actorDaylightGround.value.equals(
      hemisphere.groundColor.clone().multiplyScalar(hemisphere.intensity),
    ),
  );
  assert.ok(
    ACTOR_DAYLIGHT.actorDaylightSun.value.equals(sun.color.clone().multiplyScalar(sun.intensity)),
  );
  assert.ok(Math.abs(ACTOR_DAYLIGHT.actorDaylightSunDirection.value.length() - 1) < 1e-12);
  assert.ok(
    ACTOR_DAYLIGHT.actorDaylightSunDirection.value.equals(
      new THREE.Vector3(...DAYLIGHT.sunDirection).normalize(),
    ),
  );
});

test('the world wears exactly its outdoor lights outside, and keeps them as the cave dims', () => {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#b5c4b2', 45, 118);
  const world = {
    scene,
    hemisphere: new THREE.HemisphereLight(DAYLIGHT.sky, DAYLIGHT.ground, DAYLIGHT.hemisphere),
    sun: new THREE.DirectionalLight(DAYLIGHT.sun, DAYLIGHT.directional),
    state: { maritime: null },
    skyUniforms: {
      shadowRealm: { value: 0 },
      biomeFog: { value: new THREE.Color() },
      biomeSky: { value: new THREE.Color() },
    },
    renderer: { getPixelRatio: () => 1 },
    canvas: { dataset: {} },
  };
  const atmosphere = new WorldAtmosphere(world);
  const step = (focus, frames) => {
    for (let i = 0; i < frames; i++) {
      // As world3d.ts places the sun over the focus every frame.
      world.sun.position.copy(focus).add(CAMP_DAYLIGHT.sunDirection);
      world.sun.target.position.copy(focus);
      atmosphere.update(focus, i / 30, 1 / 30);
    }
  };
  const worn = () => ({
    sky: ACTOR_DAYLIGHT.actorDaylightSky.value.clone(),
    ground: ACTOR_DAYLIGHT.actorDaylightGround.value.clone(),
    sun: ACTOR_DAYLIGHT.actorDaylightSun.value.clone(),
    direction: ACTOR_DAYLIGHT.actorDaylightSunDirection.value.clone(),
  });
  const scenes = () => ({
    sky: world.hemisphere.color.clone().multiplyScalar(world.hemisphere.intensity),
    ground: world.hemisphere.groundColor.clone().multiplyScalar(world.hemisphere.intensity),
    sun: world.sun.color.clone().multiplyScalar(world.sun.intensity),
    direction: world.sun.position.clone().sub(world.sun.target.position).normalize(),
  });
  // Outside the camp, at every frame: the very values Three gives the scene's lights.
  const camp = new THREE.Vector3(48, walkHeight(48, 57) + 1.4, 57);
  for (let frame = 0; frame < 90; frame++) {
    step(camp, 1);
    const [a, b] = [worn(), scenes()];
    for (const key of ['sky', 'ground', 'sun']) assert.ok(a[key].equals(b[key]), `${key} ${frame}`);
    assert.ok(a.direction.equals(b.direction));
  }
  const outdoors = worn();
  // Deep in the cave the scene dims to the cave's light; characters keep the daylight.
  const inside = caveWorldAt(-21);
  const cave = new THREE.Vector3(
    inside.x,
    CAMP_CAVE.elevation + CAMP_CAVE_SURFACE.height(inside.x, inside.z) + 1.4,
    inside.z,
  );
  assert.equal(caveInteriorWeight(cave), 1);
  step(cave, 300);
  assert.ok(Math.abs(world.hemisphere.intensity - CAVE_LIGHT.hemisphere) < 1e-3);
  assert.ok(Math.abs(world.sun.intensity - CAVE_LIGHT.directional) < 1e-3);
  const kept = worn();
  for (const key of ['sky', 'ground', 'sun'])
    assert.ok(kept[key].equals(outdoors[key]), `${key} stays as outside`);
  assert.equal(ACTOR_DAYLIGHT.actorDaylightOn.value, 1);
  atmosphere.dispose();
});
