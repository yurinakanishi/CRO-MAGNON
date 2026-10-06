import * as THREE from 'three';
import { isMesh } from './three-types.js';
import { CAMP_CAVE, CAVE_BEND } from '../shared/camp-cave-layout.mjs';
import { caveGroundShader } from './cave-ground-style.js';
import { caveRockShader } from './cave-rock-shader.js';
import { caveMuralShader, type CaveExtraPigment } from './cave-gallery-layout.js';
import { meadowShader, MEADOW_BLADE_ALBEDO, MEADOW_MATCH } from './paleo-materials.js';

// Pigment is projected onto existing reconstructed wall triangles (no planes).
// Only daylight is occluded:
// actual point/spot fire lighting still reaches and reveals the same surface.
export function prepareCaveMaterials(
  root: THREE.Object3D,
  pigment: THREE.Texture,
  limestone: THREE.Texture,
  character524: THREE.Texture,
  rimoPigment: THREE.Texture,
  extraPigments: Record<CaveExtraPigment, THREE.Texture>,
) {
  const materials = new Set<THREE.Material>();
  root.traverse((node) => {
    if (!isMesh(node)) return;
    for (const material of [node.material].flat()) {
      if (materials.has(material)) continue;
      materials.add(material);
      // The reconstructed rock skin includes thin overhangs; show their backs
      // from the chamber as well as the outer surface.
      material.side = THREE.DoubleSide;
      if (material instanceof THREE.MeshStandardMaterial) {
        material.roughness = 0.9;
        material.metalness = 0;
      }
      material.onBeforeCompile = (shader) => {
        shader.uniforms.cavePigment = { value: pigment };
        shader.uniforms.caveLimestone = { value: limestone };
        shader.uniforms.caveCharacter524 = { value: character524 };
        shader.uniforms.caveRimoPigment = { value: rimoPigment };
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
        for (const [key, texture] of Object.entries(extraPigments))
          shader.uniforms[`cave_${key}`] = { value: texture };
        shader.vertexShader =
          'varying vec3 cavePosition;\nvarying vec3 caveNormal;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\ncavePosition=position;caveNormal=normal;',
        );
        shader.fragmentShader =
          meadowShader +
          caveGroundShader +
          caveRockShader +
          Object.keys(extraPigments)
            .map((key) => `uniform sampler2D cave_${key};\n`)
            .join('') +
          'uniform sampler2D cavePigment;\nuniform sampler2D caveCharacter524;\nuniform sampler2D caveRimoPigment;\nvarying vec3 cavePosition;\nvarying vec3 caveNormal;\n' +
          shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <map_fragment>',
          `
          #include <map_fragment>
          vec3 rockWeights=caveRockWeights(caveNormal);
          vec3 rockColour=limestoneAt(cavePosition,rockWeights);
          float rockLuma=dot(rockColour,vec3(.2126,.7152,.0722));
          // Follow the curved chamber when classifying inner rock. A fixed
          // origin misclassifies the far left wall as exterior and exposes
          // untextured source/lining patches at the terminal join.
          float roomZ=clamp(cavePosition.z,-24.5,12.0);
          float roomT=clamp(-roomZ/${CAVE_BEND.depth.toFixed(6)},0.0,1.0);
          float roomX=${CAVE_BEND.offset.toFixed(6)}*roomT*roomT*(3.0-2.0*roomT);
          vec3 roomToRock=cavePosition-vec3(roomX,2.8,roomZ);
          // Thin source folds are double-sided. Their visible back faces must
          // receive the same interior stone and daylight attenuation as walls,
          // rather than appearing as bright, untextured patches in the mouth.
          vec3 roomFacingNormal=normalize(gl_FrontFacing?caveNormal:-caveNormal);
          float insideRock=1.0-smoothstep(-.1,.35,dot(roomFacingNormal,normalize(roomToRock)));
          float mineralVariation=dustNoise(cavePosition.zy*.17+cavePosition.x*.09);
          float damp=smoothstep(.52,.83,dustNoise(vec2(cavePosition.z*.38,cavePosition.y*.11)+cavePosition.x*.21));
          // Chalk-white calcite keeps its pores and bedding without the old
          // brown stain. Pigments still share the actual rough wall surface.
          vec3 limestoneColour=mix(rockColour,vec3(rockLuma),.8)*vec3(1.3,1.32,1.32)+vec3(.05);
          limestoneColour*=mix(1.0,.87,damp*.5)*(.94+.10*mineralVariation);
          limestoneColour=min(limestoneColour,vec3(.94));
          vec2 worldGround=vec2(${CAMP_CAVE.x.toFixed(2)}-cavePosition.x,${CAMP_CAVE.z.toFixed(2)}-cavePosition.z);
          // Soil and turf continue over the exposed source lip at the riverbank.
          // Only the outward skin changes; the inner limestone and pigments stay intact.
          float sourceRelief=clamp(dot(diffuseColor.rgb,vec3(.3,.59,.11))*3.0,.65,1.25);
          vec3 outerSoil=meadowGreen(vec3(.153,.122,.042)*sourceRelief,worldGround);
          diffuseColor.rgb=mix(outerSoil,limestoneColour,insideRock);
          float floorDust=(1.0-smoothstep(1.4,2.8,cavePosition.y))*smoothstep(.1,.7,roomFacingNormal.y);
          float deepFloor=1.0-smoothstep(7.0,14.0,cavePosition.z);
          vec3 dustColour=caveDust(diffuseColor.rgb,worldGround)*mix(1.0,.6+rockLuma*1.8,deepFloor);
          diffuseColor.rgb=mix(diffuseColor.rgb,dustColour,floorDust);
          ${caveMuralShader}
        `,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <roughnessmap_fragment>',
          '#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,clamp(.94-damp*.25+(.35-rockLuma)*.15,.66,.98),insideRock);',
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          float rockHeight=limestoneRelief(cavePosition,rockWeights);
          vec3 reliefNormal=caveReliefNormal(-vViewPosition,normal,rockHeight);
          normal=normalize(mix(normal,reliefNormal,insideRock*.52*mix(1.0,.32,floorDust)));`,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <lights_fragment_begin>',
          `
          float facingRoom=1.0-smoothstep(-0.15,0.3,dot(roomFacingNormal,normalize(roomToRock)));
          float depth=1.0-smoothstep(1.0,11.0,cavePosition.z);
          float caveDaylight=mix(1.0,0.006,facingRoom*depth);
          ${THREE.ShaderChunk.lights_fragment_begin.replace(
            'getDirectionalLightInfo( directionalLight, directLight );',
            'getDirectionalLightInfo( directionalLight, directLight ); directLight.color *= caveDaylight;',
          )}
        `,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <lights_fragment_end>',
          '#include <lights_fragment_end>\nreflectedLight.indirectDiffuse*=caveDaylight;',
        );
      };
      material.customProgramCacheKey = () => 'camp-cave-white-gallery-v20-maruimo-frieze';
      material.needsUpdate = true;
    }
  });
}
