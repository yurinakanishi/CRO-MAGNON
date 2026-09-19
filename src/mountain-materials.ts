import * as THREE from 'three';
import { CAMP_MOUNTAIN, CAMP_CAVE, CAMP_MOUNTAIN_TRAIL } from '../shared/camp-cave-layout.mjs';
import { isMesh } from './three-types.js';
import { meadowShader, MEADOW_BLADE_ALBEDO, MEADOW_MATCH } from './paleo-materials.js';
import { caveGroundShader } from './cave-ground-style.js';
import { CAMP_CAVE_SURFACE_DATA as cave } from '../shared/camp-cave-surface-data.mjs';

// Tint the existing source surface along the measured, walkable switchback.
export function prepareMountainMaterials(root: THREE.Object3D) {
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
  const segments = CAMP_MOUNTAIN_TRAIL.slice(1)
    .map((b, i) => {
      const a = CAMP_MOUNTAIN_TRAIL[i];
      return `trail=min(trail,trailSegment(p,vec2(${a.x.toFixed(1)},${a.z.toFixed(1)}),vec2(${b.x.toFixed(1)},${b.z.toFixed(1)})));`;
    })
    .join('\n');
  const seen = new Set<THREE.Material>();
  root.traverse((node) => {
    if (!isMesh(node)) return;
    for (const material of [node.material].flat()) {
      if (seen.has(material)) continue;
      seen.add(material);
      material.onBeforeCompile = (shader) => {
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
        shader.vertexShader = 'varying vec3 hillPosition;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nhillPosition=position;',
        );
        shader.fragmentShader =
          meadowShader +
          caveGroundShader +
          `uniform sampler2D caveRoof; varying vec3 hillPosition;
          float trailSegment(vec2 p,vec2 a,vec2 b){vec2 d=b-a;return length(p-a-d*clamp(dot(p-a,d)/dot(d,d),0.0,1.0));}
          ` +
          shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <map_fragment>',
          `
          #include <map_fragment>
          vec2 p=vec2(${CAMP_MOUNTAIN.x.toFixed(1)}-hillPosition.x,${CAMP_MOUNTAIN.z.toFixed(1)}-hillPosition.z);
          #ifdef USE_MAP
          // Overlap three differently oriented samples of the accepted meadow
          // texture, so its original square turf patch does not repeat as tiles.
          vec2 a=p/29.0;
          vec2 b=mat2(.8,-.6,.6,.8)*p/37.0+vec2(.31,.67);
          vec2 c=mat2(.28,.96,-.96,.28)*p/23.0+vec2(.73,.19);
          diffuseColor.rgb=texture2D(map,a).rgb*.42+texture2D(map,b).rgb*.34+texture2D(map,c).rgb*.24;
          #endif
          vec2 caveLocal=vec2(${CAMP_CAVE.x.toFixed(2)},${CAMP_CAVE.z.toFixed(2)})-p;
          vec2 caveUV=(caveLocal-vec2(${cave.minX.toFixed(3)},${cave.minZ.toFixed(3)}))/vec2(${(cave.nx * cave.step).toFixed(3)},${(cave.nz * cave.step).toFixed(3)});
          if(all(greaterThanEqual(caveUV,vec2(0.0))) && all(lessThanEqual(caveUV,vec2(1.0)))){
            float roofHeight=texture2D(caveRoof,caveUV).r;
            if(roofHeight>1.3 && hillPosition.y<${(CAMP_CAVE.elevation + CAMP_CAVE.groundOffset).toFixed(2)}+roofHeight-.15)discard;
          }
          diffuseColor.rgb=meadowGreen(diffuseColor.rgb,p);
          float trail=1000.0;${segments}
          float path=1.0-smoothstep(1.25,3.1,trail);
          float shade=dot(diffuseColor.rgb,vec3(.3,.59,.11));
          diffuseColor.rgb=mix(diffuseColor.rgb,caveDust(diffuseColor.rgb,p),path*.85);
          float apron=(1.0-smoothstep(6.0,11.0,abs(p.x-35.0)))*smoothstep(98.0,106.0,p.y)*(1.0-smoothstep(116.0,124.0,p.y));
          diffuseColor.rgb=mix(diffuseColor.rgb,caveDust(diffuseColor.rgb,p),apron);
        `,
        );
      };
      material.customProgramCacheKey = () => 'camp-mountain-measured-opening-v6';
      material.needsUpdate = true;
    }
  });
  return roof;
}
