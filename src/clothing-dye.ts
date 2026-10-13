import * as THREE from 'three';
import { dyeColor } from '../shared/clothing-dye.mjs';
import { isMesh } from './three-types.js';
import {
  CLOTHING_DYE_RULES,
  type ColourRange,
  type ClothingDyeRule,
} from './clothing-dye-rules.js';
export { CLOTHING_DYE_RULES } from './clothing-dye-rules.js';
export type { ColourRange, ClothingDyeRule } from './clothing-dye-rules.js';

export function clothingDyeAvailable(modelKey: string | undefined) {
  return !!modelKey && Object.hasOwn(CLOTHING_DYE_RULES, modelKey);
}

/** A saturation no colour has: nothing is in the range. */
const NOTHING: ColourRange = [0, 0, 2, 2, 2, 2];
/** Wider than any luminance or height fraction: no limit. */
const UNLIMITED = [-1, 2] as const;
const PROGRAM_KEY = 'clothing-dye-1';

const FRAGMENT = /* glsl */ `
uniform vec3 clothDyeColour;
uniform float clothDyeOn;
uniform vec4 clothDyeSkin;
uniform vec2 clothDyeSkinValue;
uniform vec4 clothDyeKeep;
uniform vec2 clothDyeKeepValue;
uniform vec2 clothDyeLuminance;
uniform vec4 clothDyeHeight;
uniform float clothDyeLift;
varying float clothDyeY;
vec3 clothDyeHsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1.0e-10)), d / (q.x + 1.0e-10), q.x);
}
float clothDyeBand(float x, float lo, float hi, float soft) {
  return smoothstep(lo - soft, lo + soft, x) * (1.0 - smoothstep(hi - soft, hi + soft, x));
}
float clothDyeIn(vec3 hsv, vec4 range, vec2 value) {
  float hue = range.x <= range.y
    ? clothDyeBand(hsv.x, range.x, range.y, 0.02)
    : max(clothDyeBand(hsv.x, range.x, 1.1, 0.02), clothDyeBand(hsv.x, -0.1, range.y, 0.02));
  return hue * clothDyeBand(hsv.y, range.z, range.w, 0.05)
    * clothDyeBand(hsv.z, value.x, value.y, 0.05);
}
vec3 clothDyed(vec3 linear) {
  if (clothDyeOn < 0.5) return linear;
  vec3 srgb = pow(max(linear, vec3(0.0)), vec3(1.0 / 2.2));
  vec3 hsv = clothDyeHsv(srgb);
  float luminance = dot(srgb, vec3(0.299, 0.587, 0.114));
  float height = (clothDyeY - clothDyeHeight.x) / max(1.0e-5, clothDyeHeight.y - clothDyeHeight.x);
  float cloth = (1.0 - clothDyeIn(hsv, clothDyeSkin, clothDyeSkinValue))
    * (1.0 - clothDyeIn(hsv, clothDyeKeep, clothDyeKeepValue))
    * clothDyeBand(luminance, clothDyeLuminance.x, clothDyeLuminance.y, 0.04)
    * clothDyeBand(height, clothDyeHeight.z, clothDyeHeight.w, 0.012);
  // The dye keeps the cloth's own shading: its luminance, over a floor.
  vec3 dyed = clamp(clothDyeColour * (clothDyeLift + 1.2 * luminance), 0.0, 1.0);
  return pow(mix(srgb, dyed, cloth), vec3(2.2));
}
`;

function inject(source: string, chunk: string, addition: string) {
  if (!source.includes(chunk)) throw new Error(`Clothing dye: the shader has no ${chunk}`);
  return source.replace(chunk, `${chunk}\n${addition}`);
}

const heights = new WeakMap<THREE.BufferGeometry, readonly [number, number]>();

/** The lowest and highest bind-pose y of a geometry, as the vertex shader reads `position`. */
function heightOf(geometry: THREE.BufferGeometry) {
  let range = heights.get(geometry);
  if (!range) {
    const position = geometry.getAttribute('position');
    let low = Infinity,
      high = -Infinity;
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i);
      if (y < low) low = y;
      if (y > high) high = y;
    }
    range = [low, high];
    heights.set(geometry, range);
  }
  return range;
}

const worn = (mesh: THREE.Mesh) => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]);

/**
 * One actor's clothing: its own copies of the rule's materials, whose shader takes the dye. The
 * copies made later from them (an actor LOD's variant, a camera fade) keep their hooks and so
 * share these uniforms: choosing a dye changes uniforms only, never a program, and every copy
 * shows it at once. Install before configureActorPerformance, which adopts the worn materials.
 */
export class ClothingDye {
  readonly colour = { value: new THREE.Color() };
  readonly on = { value: 0 };
  /** Each template material and this actor's copy. */
  readonly materials = new Map<THREE.Material, THREE.Material>();
  dye: string | null = null;

  constructor(root: THREE.Object3D, rule: Readonly<ClothingDyeRule>) {
    const meshes: THREE.Mesh[] = [];
    root.traverse((node) => {
      if (isMesh(node)) meshes.push(node);
    });
    const own = (source: THREE.Material) => {
      if (!rule.materials.includes(source.name)) return source;
      let copy = this.materials.get(source);
      if (!copy) {
        copy = this.copy(source, meshes, rule);
        this.materials.set(source, copy);
      }
      return copy;
    };
    for (const mesh of meshes)
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material);
  }

  private copy(source: THREE.Material, meshes: THREE.Mesh[], rule: Readonly<ClothingDyeRule>) {
    let low = Infinity,
      high = -Infinity;
    for (const mesh of meshes)
      if (worn(mesh).includes(source)) {
        const [bottom, top] = heightOf(mesh.geometry);
        low = Math.min(low, bottom);
        high = Math.max(high, top);
      }
    const { skin } = rule,
      keep = rule.keep ?? NOTHING,
      luminance = rule.luminance ?? UNLIMITED,
      height = rule.height ?? UNLIMITED;
    const uniforms = {
      clothDyeColour: this.colour,
      clothDyeOn: this.on,
      clothDyeSkin: { value: new THREE.Vector4(skin[0] / 360, skin[1] / 360, skin[2], skin[3]) },
      clothDyeSkinValue: { value: new THREE.Vector2(skin[4], skin[5]) },
      clothDyeKeep: { value: new THREE.Vector4(keep[0] / 360, keep[1] / 360, keep[2], keep[3]) },
      clothDyeKeepValue: { value: new THREE.Vector2(keep[4], keep[5]) },
      clothDyeLuminance: { value: new THREE.Vector2(luminance[0], luminance[1]) },
      clothDyeHeight: { value: new THREE.Vector4(low, high, height[0], height[1]) },
      clothDyeLift: { value: rule.lift ?? 0.28 },
    };
    const copy = source.clone();
    copy.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = inject(
        inject(shader.vertexShader, '#include <common>', 'varying float clothDyeY;'),
        '#include <begin_vertex>',
        'clothDyeY = position.y;',
      );
      shader.fragmentShader = inject(
        inject(shader.fragmentShader, '#include <common>', FRAGMENT),
        '#include <color_fragment>',
        'diffuseColor.rgb = clothDyed(diffuseColor.rgb);',
      );
    };
    // One program for every dyed material: the rules and colours are uniforms.
    copy.customProgramCacheKey = () => PROGRAM_KEY;
    return copy;
  }

  /** A CLOTHING_DYES key, or anything else for the character's own colours. */
  set(dye: unknown) {
    const colour = dyeColor(dye);
    this.dye = colour ? (dye as string) : null;
    this.on.value = colour ? 1 : 0;
    // The shader works on the texture's sRGB colour, so it takes the dye's sRGB components.
    if (colour) this.colour.value.set(colour).convertLinearToSRGB();
  }

  dispose() {
    for (const copy of this.materials.values()) copy.dispose();
    this.materials.clear();
  }
}

/** The clothing of an actor of `modelKey`, dyed `dye`; null for a model without a rule. */
export function installClothingDye(root: THREE.Object3D, modelKey: string, dye: unknown) {
  if (!clothingDyeAvailable(modelKey)) return null;
  const clothing = new ClothingDye(root, CLOTHING_DYE_RULES[modelKey]);
  clothing.set(dye);
  return clothing;
}
