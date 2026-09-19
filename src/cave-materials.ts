import * as THREE from 'three';
import { isMesh } from './three-types.js';
import { CAMP_CAVE } from '../shared/camp-cave-layout.mjs';
import { caveGroundShader } from './cave-ground-style.js';
import { caveRockShader } from './cave-rock-shader.js';
import { caveMuralShader } from './cave-gallery-layout.js';

// Pigment is projected onto existing reconstructed wall triangles (no planes).
// Only daylight is occluded:
// actual point/spot fire lighting still reaches and reveals the same surface.
export function prepareCaveMaterials(
  root: THREE.Object3D,
  pigment: THREE.Texture,
  limestone: THREE.Texture,
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
        shader.vertexShader =
          'varying vec3 cavePosition;\nvarying vec3 caveNormal;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\ncavePosition=position;caveNormal=normal;',
        );
        shader.fragmentShader =
          caveGroundShader +
          caveRockShader +
          'uniform sampler2D cavePigment;\nvarying vec3 cavePosition;\nvarying vec3 caveNormal;\n' +
          shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <map_fragment>',
          `
          #include <map_fragment>
          vec3 rockWeights=caveRockWeights(caveNormal);
          vec3 rockColour=limestoneAt(cavePosition,rockWeights);
          float rockLuma=dot(rockColour,vec3(.2126,.7152,.0722));
          float insideRock=1.0-smoothstep(-.1,.35,dot(normalize(caveNormal),normalize(cavePosition-vec3(0.0,2.8,1.0))));
          float mineralVariation=dustNoise(cavePosition.zy*.17+cavePosition.x*.09);
          float damp=smoothstep(.52,.83,dustNoise(vec2(cavePosition.z*.38,cavePosition.y*.11)+cavePosition.x*.21));
          vec3 limestoneColour=rockColour*mix(vec3(.79,.76,.70),vec3(.49,.46,.40),damp*.65);
          limestoneColour*=.8+.26*mineralVariation;
          diffuseColor.rgb=mix(diffuseColor.rgb,limestoneColour,insideRock);
          vec2 worldGround=vec2(${CAMP_CAVE.x.toFixed(2)}-cavePosition.x,${CAMP_CAVE.z.toFixed(2)}-cavePosition.z);
          float floorDust=(1.0-smoothstep(1.4,2.8,cavePosition.y))*smoothstep(.1,.7,caveNormal.y);
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
          float facingRoom=1.0-smoothstep(-0.15,0.3,dot(normalize(caveNormal),normalize(cavePosition-vec3(0.0,3.0,-6.0))));
          float depth=1.0-smoothstep(3.0,9.5,cavePosition.z);
          float caveDaylight=mix(1.0,0.12,facingRoom*depth);
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
      material.customProgramCacheKey = () => 'camp-cave-limestone-gallery-v7';
      material.needsUpdate = true;
    }
  });
}
