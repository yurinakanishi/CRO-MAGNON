import * as THREE from 'three';

// Mean linear blade albedos measured from the delivered GLB textures.
export const BLADE_ALBEDO = Object.freeze({
  'meadow-grass': Object.freeze({ r: 0.0445, g: 0.155, b: 0.0207 }),
  'meadow-sprig': Object.freeze({ r: 0.0143, g: 0.1743, b: 0.0058 }),
});

const fract = (n: number) => n - Math.floor(n);
const hash = (x: number, z: number) => fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5453);
function patch(x: number, z: number) {
  const ix = Math.floor(x),
    iz = Math.floor(z);
  const fx = fract(x),
    fz = fract(z);
  const u = fx * fx * (3 - 2 * fx),
    v = fz * fz * (3 - 2 * fz);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(hash(ix, iz), hash(ix + 1, iz), u),
    THREE.MathUtils.lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), u),
    v,
  );
}

// A placement keeps this tint through culling, cell regeneration and every LOD.
// The shader uses these ratios as a hue, preserving the original light/dark detail.
export function meadowGrassTint(key: string, x: number, z: number) {
  const source = BLADE_ALBEDO[key];
  const dry = THREE.MathUtils.smoothstep(
    patch(x * 0.18, z * 0.18) * 0.65 + hash(x * 3.1, z * 3.1) * 0.35,
    0.27,
    0.75,
  );
  return new THREE.Color().setRGB(
    THREE.MathUtils.lerp(0.052, 0.17, dry) / source.r,
    THREE.MathUtils.lerp(0.145, 0.24, dry) / source.g,
    THREE.MathUtils.lerp(0.025, 0.055, dry) / source.b,
  );
}

export function applyMeadowGrassPalette(material: THREE.Material, key: string) {
  const source = BLADE_ALBEDO[key];
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#ifdef USE_INSTANCING_COLOR
      const vec3 meadowLuma=vec3(.2126,.7152,.0722);
      vec3 meadowHue=vColor.rgb*vec3(${source.r},${source.g},${source.b});
      float meadowLight=dot(diffuseColor.rgb,meadowLuma);
      float meadowLift=mix(1.0,1.22,smoothstep(.052,.17,meadowHue.r));
      diffuseColor.rgb=mix(diffuseColor.rgb,meadowHue*meadowLight/max(.001,dot(meadowHue,meadowLuma)),.9)*meadowLift;
      #else
      #include <color_fragment>
      #endif`,
    );
  };
  material.customProgramCacheKey = () => `meadow-grass-palette-1-${key}`;
}
