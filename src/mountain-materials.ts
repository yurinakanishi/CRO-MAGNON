import * as THREE from 'three';
import { CAMP_MOUNTAIN, CAMP_CAVE, CAVE_BEND } from '../shared/camp-cave-layout.mjs';
import { isMesh } from './three-types.js';
import { meadowShader, MEADOW_BLADE_ALBEDO, MEADOW_MATCH, clipAtCoast } from './paleo-materials.js';
import { caveGroundShader } from './cave-ground-style.js';
import { meadowMapFragment, meadowTrailShader } from './meadow-surface.js';
import { CAMP_CAVE_SURFACE_DATA as cave } from '../shared/camp-cave-surface-data.mjs';

// The cave's rock envelope in the hillside, in cave-local metres: half its width beside the
// bent centre line (wide at the mouth, narrowing 3-7 m inside), the measured roofs it applies
// to, and how far below a roof the hill gives way to the cave model.
const MOUTH = Object.freeze({ wide: 6.6, narrow: 6.0, from: 3, to: 7, roof: 1.3, below: 0.15 });
const glsl = (value: number) => (Number.isInteger(value) ? value.toFixed(1) : String(value));

/** The measured roof height (linear, clamped to the edge) the mountain shader samples. */
function roofAt(u: number, v: number) {
  const x = Math.min(Math.max(u * cave.nx - 0.5, 0), cave.nx - 1),
    z = Math.min(Math.max(v * cave.nz - 0.5, 0), cave.nz - 1);
  const x0 = Math.floor(x),
    z0 = Math.floor(z),
    x1 = Math.min(x0 + 1, cave.nx - 1),
    z1 = Math.min(z0 + 1, cave.nz - 1),
    fx = x - x0,
    fz = z - z0,
    roofs = cave.roofs;
  const near =
      roofs[z0 * cave.nx + x0] + (roofs[z0 * cave.nx + x1] - roofs[z0 * cave.nx + x0]) * fx,
    far = roofs[z1 * cave.nx + x0] + (roofs[z1 * cave.nx + x1] - roofs[z1 * cave.nx + x0]) * fx;
  return near + (far - near) * fz;
}

/** Whether the mountain shader below discards its hillside at this point of the mountain
 * model (its own coordinates, as the shader's hillPosition): there the cave model is seen
 * instead, and the camera passes (mountain-camera.ts). */
export function mountainCaveClipped(x: number, y: number, z: number) {
  const localX = CAMP_CAVE.x - (CAMP_MOUNTAIN.x - x),
    localZ = CAMP_CAVE.z - (CAMP_MOUNTAIN.z - z);
  const u = (localX - cave.minX) / (cave.nx * cave.step),
    v = (localZ - cave.minZ) / (cave.nz * cave.step);
  if (u < 0 || v < 0 || u > 1 || v > 1) return false;
  const roof = roofAt(u, v);
  const bend = Math.min(Math.max(-localZ / CAVE_BEND.depth, 0), 1),
    centre = CAVE_BEND.offset * bend * bend * (3 - 2 * bend);
  const t = Math.min(Math.max((localZ - MOUTH.from) / (MOUTH.to - MOUTH.from), 0), 1),
    width = MOUTH.wide + (MOUTH.narrow - MOUTH.wide) * t * t * (3 - 2 * t);
  return (
    Math.abs(localX - centre) < width &&
    roof > MOUTH.roof &&
    y < CAMP_CAVE.elevation + CAMP_CAVE.groundOffset + roof - MOUTH.below
  );
}

// Tint the existing source surface along the measured, walkable switchback.
// The 280 m source square reaches past the measured shoreline: it ends at the sea, and its flat
// apron gives way near the shore to the coast-lowered streamed ground (clipAtCoast). The coast
// field stays owned by the open world that created it.
export function prepareMountainMaterials(
  root: THREE.Object3D,
  earthTextures: { coast: THREE.DataTexture },
) {
  if (!earthTextures?.coast) throw new Error('The camp mountain needs the measured coast field');
  const roof = new THREE.DataTexture(
    new Float32Array(cave.roofs),
    cave.nx,
    cave.nz,
    THREE.RedFormat,
    THREE.FloatType,
  );
  roof.minFilter = roof.magFilter = THREE.LinearFilter;
  roof.generateMipmaps = false;
  roof.needsUpdate = true;
  const seen = new Set<THREE.Material>();
  root.traverse((node) => {
    if (!isMesh(node)) return;
    for (const material of [node.material].flat()) {
      if (seen.has(material)) continue;
      seen.add(material);
      (material as THREE.MeshStandardMaterial).roughness = 0.94;
      material.onBeforeCompile = (shader) => {
        clipAtCoast(shader, earthTextures, { flatGround: true });
        shader.uniforms.caveRoof = { value: roof };
        shader.uniforms.meadowBlade = {
          value: new THREE.Vector3(
            MEADOW_BLADE_ALBEDO.r,
            MEADOW_BLADE_ALBEDO.g,
            MEADOW_BLADE_ALBEDO.b,
          ),
        };
        shader.uniforms.meadowMatch = {
          value: new THREE.Vector2(MEADOW_MATCH.dirt, MEADOW_MATCH.turf),
        };
        shader.vertexShader =
          'attribute float riverCut; varying float vRiverCut; varying vec3 hillPosition;\n' +
          shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nhillPosition=position;vRiverCut=riverCut;',
        );
        shader.fragmentShader =
          meadowShader +
          caveGroundShader +
          meadowTrailShader +
          'uniform sampler2D caveRoof; varying vec3 hillPosition; varying float vRiverCut;\n' +
          shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <map_fragment>',
          `
          #include <map_fragment>
          vec2 p=vec2(${CAMP_MOUNTAIN.x.toFixed(1)}-hillPosition.x,${CAMP_MOUNTAIN.z.toFixed(1)}-hillPosition.z);
          ${meadowMapFragment('p')}
          vec2 caveLocal=vec2(${CAMP_CAVE.x.toFixed(2)},${CAMP_CAVE.z.toFixed(2)})-p;
          vec2 caveUV=(caveLocal-vec2(${cave.minX.toFixed(3)},${cave.minZ.toFixed(3)}))/vec2(${(cave.nx * cave.step).toFixed(3)},${(cave.nz * cave.step).toFixed(3)});
          if(all(greaterThanEqual(caveUV,vec2(0.0))) && all(lessThanEqual(caveUV,vec2(1.0)))){
            float roofHeight=texture2D(caveRoof,caveUV).r;
            // Clip only where the measured rock envelope overlaps the hillside.
            // Extending an imaginary portal over the apron exposes the hollow hill.
            float bend=clamp(-caveLocal.y/${CAVE_BEND.depth.toFixed(6)},0.0,1.0);
            float centre=${CAVE_BEND.offset.toFixed(6)}*bend*bend*(3.0-2.0*bend);
            float innerWidth=mix(${glsl(MOUTH.wide)},${glsl(MOUTH.narrow)},smoothstep(${glsl(MOUTH.from)},${glsl(MOUTH.to)},caveLocal.y));
            if(abs(caveLocal.x-centre)<innerWidth && roofHeight>${glsl(MOUTH.roof)} && hillPosition.y<${(CAMP_CAVE.elevation + CAMP_CAVE.groundOffset).toFixed(2)}+roofHeight-${glsl(MOUTH.below)})discard;
          }
          diffuseColor.rgb=meadowGreen(diffuseColor.rgb,p);
          float shade=dot(diffuseColor.rgb,vec3(.3,.59,.11));
          diffuseColor.rgb=meadowTrail(diffuseColor.rgb,p);
          float riverRock=1.0-exp(-vRiverCut*2.5);
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.22,.205,.17)*(shade*3.0+.3),riverRock*.88);
        `,
        );
      };
      material.customProgramCacheKey = () => 'camp-mountain-river-v12-world-meadow-coast-1';
      material.needsUpdate = true;
    }
  });
  return roof;
}
