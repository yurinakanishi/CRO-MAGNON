import * as THREE from 'three';

export const SURFACES = Object.freeze(['snow', 'ice', 'ash', 'sand']);
const modes = { snow: 0, ice: 1, ash: 2, sand: 3 };
const profiles = {
  'valley-pine': { low: .13, rock: 0, plant: 1, hearth: 0 },
  'valley-boulder': { low: .27, rock: 1, plant: 0, hearth: 0 },
  'berry-bush': { low: .3, rock: 0, plant: 1, hearth: 0 },
  'meadow-grass': { low: .04, rock: 0, plant: 1, hearth: 0 },
  'firewood-pile': { low: .12, rock: 0, plant: 0, hearth: 0 },
  'hide-tent': { low: .18, rock: 0, plant: 0, hearth: 0 },
  'stone-firepit': { low: .05, rock: 1, plant: 0, hearth: 1 },
};

const vertexHeader = `
uniform mat4 regionalSourceMatrix;
uniform mat3 regionalSourceNormal;
varying vec3 vRegionalPosition;
varying vec3 vRegionalNormal;
`;
const fragmentHeader = `
uniform vec4 regionalProfile;
uniform float regionalMode;
uniform float regionalHeight;
uniform float regionalRadius;
varying vec3 vRegionalPosition;
varying vec3 vRegionalNormal;
float regionalTop() {
  float ripple = sin(vRegionalPosition.x * 3.1 + sin(vRegionalPosition.z * 4.3)) * .07;
  float slope = smoothstep(.08 + ripple, .62 + ripple, normalize(vRegionalNormal).y);
  float elevation = smoothstep(regionalProfile.x, regionalProfile.x + .16, vRegionalPosition.y / regionalHeight);
  float outsideFire = mix(1.0, smoothstep(.42, .65, length(vRegionalPosition.xz) / regionalRadius), regionalProfile.w);
  return slope * elevation * outsideFire;
}
`;
const colorTreatment = `
float regionalCover = regionalTop();
float regionalLuma = dot(diffuseColor.rgb, vec3(.2126, .7152, .0722));
float regionalDetail = clamp(regionalLuma * 2.7 + .52, .5, 1.4);
float regionalOuter = mix(1.0, smoothstep(.4, .68, length(vRegionalPosition.xz) / regionalRadius), regionalProfile.w);
if (regionalMode < .5) {
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.84, .90, .94), regionalCover * .98);
} else if (regionalMode < 1.5) {
  vec3 iceBody = vec3(.065, .29, .41) * regionalDetail;
  vec3 coldBase = mix(diffuseColor.rgb * vec3(.80, .88, 1.0), iceBody, regionalProfile.y * regionalOuter * .88);
  diffuseColor.rgb = mix(coldBase, vec3(.75, .87, .93), regionalCover * .86);
} else if (regionalMode < 2.5) {
  vec3 darkRock = vec3(.035, .031, .028) * regionalDetail;
  vec3 burntWood = diffuseColor.rgb * vec3(.32, .27, .23);
  diffuseColor.rgb = mix(burntWood, darkRock, regionalProfile.y * regionalOuter);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.17, .145, .125) * regionalDetail, regionalCover * .35);
} else {
  float stratum = sin(vRegionalPosition.y * 9.0 + sin(vRegionalPosition.x * .8) * .28 + sin(vRegionalPosition.z) * .16);
  vec3 sandstone = mix(vec3(.40, .20, .075), vec3(.65, .40, .17), smoothstep(-.7, .7, stratum)) * regionalDetail;
  vec3 dryPlant = vec3(.42, .32, .14) * regionalDetail;
  vec3 dryHideWood = mix(diffuseColor.rgb * vec3(1.20, 1.02, .77), vec3(.50, .35, .19) * regionalDetail, .46);
  diffuseColor.rgb = mix(dryHideWood, sandstone, regionalProfile.y * regionalOuter);
  diffuseColor.rgb = mix(diffuseColor.rgb, dryPlant, regionalProfile.z);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.64, .46, .25) * regionalDetail, regionalCover * .22);
}
`;

// Cloned materials retain the exact same texture objects and mesh buffers.
// The snow follows source normals and height; it never paints a billboard quad
// as though the quad were a tree, nor changes the authoritative body footprint.
export function createSurfaceTemplate(template, surface) {
  if (!SURFACES.includes(surface)) throw new Error(`Unknown regional surface ${surface}`);
  const profile = profiles[template.asset.modelKey];
  if (!profile) throw new Error(`No regional surface profile for ${template.asset.modelKey}`);
  const materials = new Set();
  const models = [template.gltf, ...template.lods].map(model => {
    model.scene.updateMatrixWorld(true);
    const root = model.scene.clone(true); root.updateMatrixWorld(true);
    root.traverse(node => {
      if (!node.isMesh) return;
      const localBounds = new THREE.Box3().setFromObject(root), size = localBounds.getSize(new THREE.Vector3());
      const uniforms = {
        regionalSourceMatrix: { value: node.matrixWorld.clone() },
        regionalSourceNormal: { value: new THREE.Matrix3().getNormalMatrix(node.matrixWorld) },
        regionalProfile: { value: new THREE.Vector4(profile.low, profile.rock, profile.plant, profile.hearth) },
        regionalMode: { value: modes[surface] },
        regionalHeight: { value: Math.max(.01, template.asset.heightMetres ?? size.y) },
        regionalRadius: { value: Math.max(.01, Math.min(size.x, size.z) * .5) },
      };
      const coat = original => {
        const material = original.clone(); materials.add(material);
        material.name = `${original.name || template.asset.modelKey} / ${surface}`;
        material.userData = { ...original.userData, regionalSurface: surface, sharedSourceMaterial: original.uuid };
        material.onBeforeCompile = shader => {
          Object.assign(shader.uniforms, uniforms);
          shader.vertexShader = vertexHeader + shader.vertexShader;
          shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
            vRegionalPosition = (regionalSourceMatrix * vec4(position, 1.0)).xyz;
            vRegionalNormal = normalize(regionalSourceNormal * objectNormal);`);
          shader.fragmentShader = fragmentHeader + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>\n${colorTreatment}`);
          shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
            roughnessFactor = regionalMode > .5 && regionalMode < 1.5
              ? mix(roughnessFactor, .40, regionalProfile.y * (1.0 - regionalTop()))
              : mix(roughnessFactor, .96, regionalTop());`);
        };
        material.customProgramCacheKey = () => 'shared-regional-source-surface-v1';
        return material;
      };
      node.material = Array.isArray(node.material) ? node.material.map(coat) : coat(node.material);
    });
    root.userData.regionalSurface = surface;
    return { ...model, scene: root };
  });
  return { asset: template.asset, gltf: models[0], lods: models.slice(1), surface, materials,
    dispose() { for (const material of materials) material.dispose(); materials.clear(); } };
}
