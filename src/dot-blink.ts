import * as THREE from 'three';
import { isMesh } from './three-types.js';

/** One painted eye: its centre and half extents on the face, and the depth where the face begins. */
type Eye = readonly [x: number, y: number, halfWidth: number, halfHeight: number, front: number];
type Rgb = readonly [number, number, number];
interface DotFace {
  eyes: readonly [Eye, Eye];
  /** The body colour around the eyes, which the lids are. */
  lid: Rgb;
  /** The ink of the closed eyes' line. */
  line: Rgb;
}

/**
 * Where each Dot's eyes are painted on its delivered surface, in the bind-pose position space
 * its vertex shader reads (metres, ground-centred, +Z the face), measured by
 * scripts/measure-dot-eyes.mjs, with the colours as the albedo stores them (sRGB texels). The
 * eyes are ink in the texture, not geometry, so lids are painted over them in the shader; the
 * delivered GLBs stay untouched. The triangle bot's eyes are already shut behind its glasses
 * and the heart bot's are hidden by its sunglasses, so neither has lids.
 */
export const DOT_FACES: Readonly<Record<string, DotFace>> = {
  white: {
    eyes: [
      [-0.0383, 0.1548, 0.0314, 0.0249, 0.109],
      [0.0656, 0.1659, 0.031, 0.0233, 0.089],
    ],
    lid: [245, 243, 239],
    line: [26, 26, 25],
  },
  blue: {
    eyes: [
      [-0.0567, 0.1506, 0.0267, 0.0297, 0.096],
      [0.0579, 0.1506, 0.027, 0.0296, 0.094],
    ],
    lid: [16, 114, 238],
    line: [10, 16, 34],
  },
  green: {
    eyes: [
      [-0.0439, 0.1553, 0.0325, 0.0332, 0.103],
      [0.0627, 0.1565, 0.0325, 0.0327, 0.09],
    ],
    lid: [24, 182, 83],
    line: [11, 22, 14],
  },
  purple: {
    eyes: [
      [-0.059, 0.1508, 0.0318, 0.0323, 0.094],
      [0.058, 0.1514, 0.0319, 0.0322, 0.095],
    ],
    lid: [163, 62, 233],
    line: [22, 12, 32],
  },
  orange: {
    eyes: [
      [-0.0584, 0.1448, 0.031, 0.0083, 0.096],
      [0.0526, 0.1469, 0.0318, 0.0078, 0.099],
    ],
    lid: [244, 140, 41],
    line: [33, 19, 12],
  },
  beret: {
    eyes: [
      [-0.0233, 0.1237, 0.0118, 0.0162, 0.0475],
      [0.0224, 0.1243, 0.0115, 0.0157, 0.0477],
    ],
    lid: [1, 106, 244],
    line: [0, 1, 7],
  },
  // The frog's eyes are pale eyeballs on its crown; its green lids close over them.
  frog: {
    eyes: [
      [-0.0512, 0.2083, 0.0345, 0.0347, 0.0145],
      [0.0512, 0.2094, 0.0344, 0.0346, 0.0148],
    ],
    lid: [141, 179, 28],
    line: [52, 70, 14],
  },
};

const PROGRAM_KEY = 'dot-blink-1';
const FRAGMENT = /* glsl */ `
uniform float dotBlink;
uniform vec4 dotEyeA;
uniform vec4 dotEyeB;
uniform vec2 dotEyeFront;
uniform vec3 dotLid;
uniform vec3 dotLine;
varying vec3 dotEyePos;
// Both lids meet a little below the middle; the closed eye is the line where they meet.
vec3 dotBlinkEye(vec3 colour, vec4 eye, float front) {
  vec2 q = (dotEyePos.xy - eye.xy) / eye.zw;
  if (dotEyePos.z < front || abs(q.x) > 1.25 || abs(q.y) > 1.3) return colour;
  float meet = -0.1;
  float upper = mix(1.3, meet, dotBlink), lower = mix(-1.3, meet, dotBlink);
  float soft = 0.05;
  float lidded = max(smoothstep(upper - soft, upper + soft, q.y),
    1.0 - smoothstep(lower - soft, lower + soft, q.y));
  colour = mix(colour, dotLid, lidded);
  // The upper lid's edge darkens into the closed eye's line as it comes down.
  float half_ = max(0.0035 / eye.w, 0.12);
  float line = (1.0 - smoothstep(half_ * 0.55, half_, abs(q.y - upper)))
    * (1.0 - smoothstep(0.82, 1.0, abs(q.x))) * smoothstep(0.3, 0.75, dotBlink);
  return mix(colour, dotLine, line);
}
vec3 dotBlinked(vec3 colour) {
  if (dotBlink <= 0.0) return colour;
  return dotBlinkEye(dotBlinkEye(colour, dotEyeA, dotEyeFront.x), dotEyeB, dotEyeFront.y);
}
`;

function inject(source: string, chunk: string, addition: string) {
  if (!source.includes(chunk)) throw new Error(`Dot blink: the shader has no ${chunk}`);
  return source.replace(chunk, `${chunk}\n${addition}`);
}

/** Texels are sRGB; the shader blends the linear albedo. */
const linear = ([r, g, b]: Rgb) => new THREE.Color().setRGB(r / 255, g / 255, b / 255, 'srgb');

// A blink: the lids drop fast, stay shut a moment and open a little slower.
const CLOSE = 0.07,
  HOLD = 0.04,
  OPEN = 0.1;
export function blinkClosure(age: number) {
  if (age < 0 || age >= CLOSE + HOLD + OPEN) return 0;
  if (age < CLOSE) return (age / CLOSE) ** 2;
  if (age < CLOSE + HOLD) return 1;
  return (1 - (age - CLOSE - HOLD) / OPEN) ** 2;
}
/** Seconds between blinks, and the gap before the second of an occasional double blink. */
export const BLINK_GAP = Object.freeze({ min: 2.4, max: 6, double: 0.32, doubleChance: 0.2 });

/**
 * One Dot's lids. Every Dot wears its own copy of its kind's material so each blinks on its
 * own; the copies share one program (the face is uniforms), and copies made later from them
 * (the LOD's variant) keep the hook and these uniforms. Install before
 * configureActorPerformance, which adopts the worn materials.
 */
export class DotBlink {
  readonly closure = { value: 0 };
  private readonly copies = new Map<THREE.Material, THREE.Material>();
  private next: number;
  private started = -Infinity;
  private twice = false;

  constructor(
    root: THREE.Object3D,
    face: DotFace,
    now: number,
    private random: () => number = Math.random,
  ) {
    const uniforms = {
      dotBlink: this.closure,
      dotEyeA: { value: new THREE.Vector4(...face.eyes[0].slice(0, 4)) },
      dotEyeB: { value: new THREE.Vector4(...face.eyes[1].slice(0, 4)) },
      dotEyeFront: { value: new THREE.Vector2(face.eyes[0][4], face.eyes[1][4]) },
      dotLid: { value: linear(face.lid) },
      dotLine: { value: linear(face.line) },
    };
    const own = (source: THREE.Material) => {
      let copy = this.copies.get(source);
      if (!copy) {
        copy = source.clone();
        copy.onBeforeCompile = (shader) => {
          Object.assign(shader.uniforms, uniforms);
          shader.vertexShader = inject(
            inject(shader.vertexShader, '#include <common>', 'varying vec3 dotEyePos;'),
            '#include <begin_vertex>',
            'dotEyePos = position;',
          );
          shader.fragmentShader = inject(
            inject(shader.fragmentShader, '#include <common>', FRAGMENT),
            '#include <color_fragment>',
            'diffuseColor.rgb = dotBlinked(diffuseColor.rgb);',
          );
        };
        copy.customProgramCacheKey = () => PROGRAM_KEY;
        this.copies.set(source, copy);
      }
      return copy;
    };
    root.traverse((node) => {
      if (isMesh(node))
        node.material = Array.isArray(node.material) ? node.material.map(own) : own(node.material);
    });
    // Dots that appear together do not blink together.
    this.next = now + BLINK_GAP.min * random();
  }

  /** `now` in seconds on any steady clock. */
  update(now: number) {
    if (now >= this.next) {
      this.started = now;
      this.twice = this.random() < BLINK_GAP.doubleChance;
      this.next = now + BLINK_GAP.min + (BLINK_GAP.max - BLINK_GAP.min) * this.random();
    }
    const age = now - this.started;
    this.closure.value = Math.max(
      blinkClosure(age),
      this.twice ? blinkClosure(age - BLINK_GAP.double) : 0,
    );
  }

  dispose() {
    for (const copy of this.copies.values()) copy.dispose();
    this.copies.clear();
  }
}

/** Lids for a Dot of `kind`; null for the Dots whose eyes cannot be seen open. */
export function installDotBlink(root: THREE.Object3D, kind: string, now: number) {
  const face = DOT_FACES[kind];
  return face ? new DotBlink(root, face, now) : null;
}
