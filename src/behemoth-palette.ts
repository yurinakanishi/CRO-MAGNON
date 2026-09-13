import type * as THREE from 'three';

// Recolour the plum skin after sampling the embedded albedo. Its scale detail,
// shadows and roughness remain intact; ivory horns/teeth and warm claws keep
// their original colours. The verified GLB and its texture bytes stay untouched.
export function applyBehemothPalette(material: THREE.Material) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      vec3 beastAlbedo = diffuseColor.rgb;
      float beastPurple = smoothstep(1.05, 1.5, beastAlbedo.b / max(.001, beastAlbedo.g))
        * smoothstep(1.08, 1.6, beastAlbedo.r / max(.001, beastAlbedo.g));
      float beastLight = dot(beastAlbedo, vec3(.2126, .7152, .0722));
      vec3 beastHue = vec3(.34, .065, .62);
      vec3 beastViolet = beastHue * beastLight / dot(beastHue, vec3(.2126, .7152, .0722));
      diffuseColor.rgb = mix(beastAlbedo, beastViolet * 1.16, beastPurple * .94);`,
    );
  };
  material.customProgramCacheKey = () => 'violet-behemoth-palette-1';
}
