import * as THREE from 'three';
import { CAMP_CAVE, CAVE_BEND } from '../shared/camp-cave-layout.mjs';
import { CAVE_LIGHT_VOLUME } from '../shared/cave-light.mjs';
import { isMesh } from './three-types.js';

/** The light outdoors at the camp and its cave (grassland: no region, sea or shadow realm). The
 * world's lights start from it, and the waiting gallery's characters wear it. */
export const DAYLIGHT = Object.freeze({
  sky: '#dce7d7',
  ground: '#546047',
  hemisphere: 2,
  sun: '#ffe4b5',
  directional: 2.65,
  /** From what the sun lights toward the sun, in world space. */
  sunDirection: Object.freeze([-32, 48, -25] as const),
});

export type Daylight = {
  sky: THREE.Color;
  ground: THREE.Color;
  hemisphere: number;
  sun: THREE.Color;
  directional: number;
  sunDirection: THREE.Vector3;
};

export const CAMP_DAYLIGHT: Readonly<Daylight> = Object.freeze({
  sky: new THREE.Color(DAYLIGHT.sky),
  ground: new THREE.Color(DAYLIGHT.ground),
  hemisphere: DAYLIGHT.hemisphere,
  sun: new THREE.Color(DAYLIGHT.sun),
  directional: DAYLIGHT.directional,
  sunDirection: new THREE.Vector3(...DAYLIGHT.sunDirection),
});

/**
 * What characters and creatures are lit by in place of the scene's sun and sky once a daylight
 * is worn (actorDaylightOn 1; until then, as in the review pages, the scene's own lights): the
 * world keeps it at the daylight outdoors where the visitor is (world-atmosphere.ts), which
 * equals the scene's lights outside and stays when the cave dims them, so a face in the cave
 * looks as it does outside. Shared by every installed material. Colours are premultiplied by
 * their intensities; the sun's direction is in world space.
 */
export const ACTOR_DAYLIGHT = Object.freeze({
  actorDaylightOn: { value: 0 },
  actorDaylightSky: { value: new THREE.Color() },
  actorDaylightGround: { value: new THREE.Color() },
  actorDaylightSun: { value: new THREE.Color() },
  actorDaylightSunDirection: { value: new THREE.Vector3(0, 1, 0) },
});

/** Characters wear this daylight from the next draw on. */
export function wearDaylight(light: Readonly<Daylight>) {
  ACTOR_DAYLIGHT.actorDaylightOn.value = 1;
  ACTOR_DAYLIGHT.actorDaylightSky.value.copy(light.sky).multiplyScalar(light.hemisphere);
  ACTOR_DAYLIGHT.actorDaylightGround.value.copy(light.ground).multiplyScalar(light.hemisphere);
  ACTOR_DAYLIGHT.actorDaylightSun.value.copy(light.sun).multiplyScalar(light.directional);
  ACTOR_DAYLIGHT.actorDaylightSunDirection.value.copy(light.sunDirection).normalize();
}

const glsl = (value: number) => value.toFixed(4);
const { mouth, end, across, ceiling } = CAVE_LIGHT_VOLUME;

const PARS = /* glsl */ `
uniform float actorDaylightOn;
uniform vec3 actorDaylightSky;
uniform vec3 actorDaylightGround;
uniform vec3 actorDaylightSun;
uniform vec3 actorDaylightSunDirection;
// 0 for a light in the cave (insideCaveLightVolume, shared/cave-light.mts), else 1.
float actorDaylightOutsideCave( const in vec3 lightPosition ) {
  vec3 world = ( ( vec4( lightPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
  float localZ = ${glsl(CAMP_CAVE.z)} - world.z;
  float t = clamp( -localZ / ${glsl(CAVE_BEND.depth)}, 0.0, 1.0 );
  float side = ${glsl(CAMP_CAVE.x)} - world.x - ${glsl(CAVE_BEND.offset)} * t * t * ( 3.0 - 2.0 * t );
  bool inside = localZ < ${glsl(mouth)} && localZ > ${glsl(end)} && abs( side ) < ${glsl(across)}
    && world.y < ${glsl(CAMP_CAVE.elevation + ceiling)};
  return inside ? 0.0 : 1.0;
}
`;

const SUN = /* glsl */ `
#if defined( RE_Direct )
	if ( actorDaylightOn > 0.0 ) {
		directLight.direction = normalize( ( viewMatrix * vec4( actorDaylightSunDirection, 0.0 ) ).xyz );
		directLight.color = actorDaylightOn * actorDaylightSun;
		directLight.visible = true;
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
#endif
`;

// Three's hemisphere light, from world up.
const SKY = /* glsl */ `
	irradiance += actorDaylightOn * mix( actorDaylightGround, actorDaylightSky,
		0.5 * dot( geometryNormal, normalize( viewMatrix[ 1 ].xyz ) ) + 0.5 );
`;

/** Three's light loop for actors, made once so that a Three upgrade that moves its lines fails
 * here rather than drawing characters wrongly. */
function actorLights() {
  let chunk = THREE.ShaderChunk.lights_fragment_begin;
  const edit = (line: string, replacement: string) => {
    if (!chunk.includes(line)) throw new Error(`Actor daylight: the light loop has no ${line}`);
    chunk = chunk.replace(line, () => replacement);
  };
  // The cave's own lights (held torches, the hearth) pass characters by.
  const point = 'getPointLightInfo( pointLight, geometryPosition, directLight );';
  edit(
    point,
    `${point}\n\t\tdirectLight.color *= actorDaylightOutsideCave( pointLight.position );`,
  );
  // The worn daylight takes the place of the scene's sun and sky.
  const sun = 'getDirectionalLightInfo( directionalLight, directLight );';
  edit(sun, `${sun}\n\t\tdirectLight.color *= 1.0 - actorDaylightOn;`);
  const area = '#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )';
  edit(area, `${SUN}\n${area}`);
  const sky =
    'irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );';
  edit(sky, sky.replace('+= ', '+= ( 1.0 - actorDaylightOn ) * '));
  const probes = '#ifdef USE_LIGHT_PROBES_GRID';
  edit(probes, `${SKY}\n${probes}`);
  return chunk;
}

const LIGHTS = actorLights();
const PROGRAM_KEY = 'actor-daylight-1';
/** The installed hooks: a copy that kept one (materialCopy, a camera fade) needs no other. */
const hooks = new WeakSet<object>();

function litByThree(material: THREE.Material) {
  const m = material as Partial<
    Record<
      | 'isMeshStandardMaterial'
      | 'isMeshLambertMaterial'
      | 'isMeshPhongMaterial'
      | 'isMeshToonMaterial',
      boolean
    >
  >;
  return !!(
    m.isMeshStandardMaterial ||
    m.isMeshLambertMaterial ||
    m.isMeshPhongMaterial ||
    m.isMeshToonMaterial
  );
}

function inject(source: string, chunk: string, replacement: string) {
  if (!source.includes(chunk)) throw new Error(`Actor daylight: the shader has no ${chunk}`);
  return source.replace(chunk, () => replacement);
}

function install(material: THREE.Material) {
  if (!litByThree(material) || hooks.has(material.onBeforeCompile)) return;
  const previous = material.onBeforeCompile,
    cache = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    previous.call(this, shader, renderer);
    Object.assign(shader.uniforms, ACTOR_DAYLIGHT);
    shader.fragmentShader = inject(
      inject(
        shader.fragmentShader,
        '#include <lights_pars_begin>',
        `#include <lights_pars_begin>\n${PARS}`,
      ),
      '#include <lights_fragment_begin>',
      LIGHTS,
    );
  };
  hooks.add(material.onBeforeCompile);
  material.customProgramCacheKey = () => `${cache}-${PROGRAM_KEY}`;
}

/**
 * Characters and creatures under `root` wear the daylight, and the cave's own lights pass them
 * by. Each lit material takes the hook once, after the hooks it already has (a dye, a Dot's
 * lids, a palette), and the copies made later keep it (an actor LOD's variant, a camera fade).
 * Install after the materials an actor replaces with its own and before
 * configureActorPerformance, which adopts the worn materials. Shared template materials are
 * installed by their first actor.
 */
export function installActorDaylight(root: THREE.Object3D) {
  root.traverse((node) => {
    if (isMesh(node)) for (const material of [node.material].flat()) install(material);
  });
}
