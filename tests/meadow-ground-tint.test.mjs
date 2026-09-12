import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import * as THREE from 'three';
import {
  BLADE_ALBEDO,
  MEADOW_BLADE_ALBEDO,
  MEADOW_MATCH,
  createEarthTextures,
  earthTerrainMaterial,
} from '../dist/src/paleo-materials.js';
import { GROUNDCOVER_TUFT_SHARE } from '../dist/shared/scenery-layout.mjs';
import { BIOMES, biomeById } from '../dist/shared/biomes.mjs';
import { GRASS_SINK } from '../dist/src/world-scenery.js';
import { GROUNDCOVER_SINK } from '../dist/src/regional-scenery.js';

const CATALOG = JSON.parse(
  readFileSync(new URL('../assets/world-models.json', import.meta.url), 'utf8'),
);

// The first embedded image of a GLB, decoded from its PNG (8-bit RGBA, no interlace).
function embeddedImage(modelKey) {
  const glb = readFileSync(new URL(`../public/models/${modelKey}/model.glb`, import.meta.url));
  const jsonLength = glb.readUInt32LE(12),
    json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8')),
    binary = glb.subarray(28 + jsonLength),
    view = json.bufferViews[json.images[0].bufferView],
    png = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${modelKey} PNG signature`);
  const width = png.readUInt32BE(16),
    height = png.readUInt32BE(20);
  assert.deepEqual([png[24], png[25], png[28]], [8, 6, 0], `${modelKey} PNG is 8-bit RGBA`);
  const chunks = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at),
      type = png.subarray(at + 4, at + 8).toString('latin1');
    if (type === 'IDAT') chunks.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(chunks)),
    stride = width * 4,
    pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)],
      line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)),
      out = pixels.subarray(y * stride, (y + 1) * stride),
      prior = y ? pixels.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? out[i - 4] : 0,
        b = prior[i],
        c = i >= 4 ? prior[i - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c,
          pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else assert.equal(filter, 0, `${modelKey} PNG filter`);
      out[i] = (line[i] + predictor) & 255;
    }
  }
  return { width, height, pixels };
}
const linear = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
// Mean linear albedo of the green-dominant (blade) texels, the measurement
// behind BLADE_ALBEDO: opaque, not black, and clearly green in sRGB.
function bladeMean(modelKey) {
  const { pixels } = embeddedImage(modelKey),
    sum = [0, 0, 0];
  let count = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const [r, g, b, a] = [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
    if (a < 128 || !(g > r * 1.05 && g > b * 1.2)) continue;
    const R = linear(r),
      G = linear(g),
      B = linear(b);
    if (0.2126 * R + 0.7152 * G + 0.0722 * B < 0.005) continue;
    sum[0] += R;
    sum[1] += G;
    sum[2] += B;
    count++;
  }
  return { r: sum[0] / count, g: sum[1] / count, b: sum[2] / count, count };
}

test('the blade albedo constants are the delivered grass textures', () => {
  for (const key of ['meadow-grass', 'meadow-sprig']) {
    const measured = bladeMean(key),
      recorded = BLADE_ALBEDO[key];
    assert.ok(measured.count > 100000, `${key} has blade texels`);
    for (const channel of ['r', 'g', 'b'])
      assert.ok(
        Math.abs(measured[channel] - recorded[channel]) < 0.003,
        `${key}.${channel} measured ${measured[channel].toFixed(4)} vs recorded ${recorded[channel]}`,
      );
    assert.ok(recorded.g > recorded.r * 3 && recorded.g > recorded.b * 5, `${key} is leaf green`);
  }
  const share = GROUNDCOVER_TUFT_SHARE;
  assert.ok(share > 0.5 && share < 0.7);
  for (const channel of ['r', 'g', 'b'])
    assert.ok(
      Math.abs(
        MEADOW_BLADE_ALBEDO[channel] -
          (BLADE_ALBEDO['meadow-grass'][channel] * share +
            BLADE_ALBEDO['meadow-sprig'][channel] * (1 - share)),
      ) < 1e-9,
    );
  assert.ok(MEADOW_MATCH.turf === 1 && MEADOW_MATCH.dirt > 0.8 && MEADOW_MATCH.dirt <= 1);
});

// Positions, UVs and triangle indices of a tuft GLB's single primitive.
function tuftGeometry(modelKey) {
  const glb = readFileSync(new URL(`../public/models/${modelKey}/model.glb`, import.meta.url));
  const jsonLength = glb.readUInt32LE(12),
    json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8')),
    binary = glb.subarray(28 + jsonLength),
    primitive = json.meshes[0].primitives[0],
    floats = (index) => {
      const accessor = json.accessors[index],
        view = json.bufferViews[accessor.bufferView],
        width = accessor.type === 'VEC3' ? 3 : 2,
        stride = view.byteStride ?? width * 4,
        start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0),
        out = new Float32Array(accessor.count * width);
      assert.equal(accessor.componentType, 5126);
      for (let i = 0; i < accessor.count; i++)
        for (let c = 0; c < width; c++)
          out[i * width + c] = binary.readFloatLE(start + i * stride + c * 4);
      return out;
    },
    accessor = json.accessors[primitive.indices],
    view = json.bufferViews[accessor.bufferView],
    start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0),
    size = { 5121: 1, 5123: 2, 5125: 4 }[accessor.componentType],
    indices = new Uint32Array(accessor.count);
  for (let i = 0; i < accessor.count; i++)
    indices[i] =
      size === 1
        ? binary.readUInt8(start + i)
        : size === 2
          ? binary.readUInt16LE(start + i * 2)
          : binary.readUInt32LE(start + i * 4);
  return {
    positions: floats(primitive.attributes.POSITION),
    uvs: floats(primitive.attributes.TEXCOORD_0),
    indices,
  };
}

// Texels referenced by the vertices in the lowest `fraction` of the model's
// height (the root band), the measurement behind the 2026-09-11 root recolour
// (scripts/recolor-grass-root.mjs).
function rootBandTexels(modelKey, fraction) {
  const { positions, uvs } = tuftGeometry(modelKey),
    { width, height, pixels } = embeddedImage(modelKey),
    count = positions.length / 3;
  let minY = Infinity,
    maxY = -Infinity;
  for (let i = 0; i < count; i++) {
    minY = Math.min(minY, positions[i * 3 + 1]);
    maxY = Math.max(maxY, positions[i * 3 + 1]);
  }
  const texels = new Set();
  for (let i = 0; i < count; i++) {
    if ((positions[i * 3 + 1] - minY) / (maxY - minY) >= fraction) continue;
    const x = Math.min(width - 1, Math.max(0, Math.floor(uvs[i * 2] * width))),
      y = Math.min(height - 1, Math.max(0, Math.floor(uvs[i * 2 + 1] * height)));
    texels.add(y * width + x);
  }
  return [...texels].map((t) => [pixels[t * 4], pixels[t * 4 + 1], pixels[t * 4 + 2]]);
}

test('the grass roots are leaf green, not the baked brown soil', () => {
  for (const key of ['meadow-grass', 'meadow-sprig']) {
    const texels = rootBandTexels(key, 0.15);
    assert.ok(texels.length > 500, `${key} has root-band texels`);
    const mean = [0, 1, 2].map((c) => texels.reduce((sum, rgb) => sum + rgb[c], 0) / texels.length),
      ochre =
        texels.filter(([r, g, b]) => r > g * 0.85 && g > b * 1.1 && r > 40).length / texels.length;
    assert.ok(
      mean[1] > mean[0] * 1.4,
      `${key} root band mean rgb ${mean.map(Math.round)} is green`,
    );
    assert.ok(ochre < 0.05, `${key} root band has ${(ochre * 100).toFixed(1)}% ochre texels`);
  }
});

// 2026-09-12: the root cap TRELLIS closed each tuft with was cut off
// (scripts/cut-grass-root.mjs) and the tufts are sunk deeper so the cut edge
// stays below flat ground. The height is unchanged so placement scales hold.
test('the grass root caps are cut off below the placement sink and the heights are unchanged', () => {
  const cut = { 'meadow-grass': 0.045, 'meadow-sprig': 0.03 };
  for (const key of ['meadow-grass', 'meadow-sprig']) {
    const { positions, indices } = tuftGeometry(key),
      asset = JSON.parse(
        readFileSync(new URL(`../public/models/${key}/asset.json`, import.meta.url), 'utf8'),
      );
    let lowestTop = Infinity,
      lowest = Infinity,
      top = -Infinity;
    for (let t = 0; t < indices.length; t += 3) {
      const ys = [0, 1, 2].map((k) => positions[indices[t + k] * 3 + 1]);
      lowestTop = Math.min(lowestTop, Math.max(...ys));
      lowest = Math.min(lowest, ...ys);
      top = Math.max(top, ...ys);
    }
    assert.equal(indices.length / 3, asset.triangles, `${key} triangle count matches asset.json`);
    assert.ok(
      lowestTop >= cut[key],
      `${key} keeps a triangle below the ${cut[key]} m cut (top ${lowestTop})`,
    );
    assert.ok(
      Math.abs(top - asset.heightMetres) < 0.001,
      `${key} height ${top} vs asset.json ${asset.heightMetres}`,
    );
    assert.ok(
      Math.abs(top - CATALOG.assets.find((a) => a.key === key).height) < 0.02,
      `${key} catalog height`,
    );
    assert.ok(
      cut[key] <= GRASS_SINK && cut[key] <= GROUNDCOVER_SINK + 0.005,
      `${key} cut edge sits at or below the sink`,
    );
    assert.ok(lowest < GRASS_SINK, `${key} cut edge (${lowest}) is under flat ground once sunk`);
  }
});

function compiled(biome) {
  const textures = createEarthTextures();
  try {
    const material = earthTerrainMaterial(new THREE.MeshStandardMaterial(), biome, textures),
      shader = {
        uniforms: {},
        vertexShader: '#include <begin_vertex>',
        fragmentShader:
          '#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <emissivemap_fragment>',
      };
    material.onBeforeCompile(shader);
    return { material, shader };
  } finally {
    textures.dispose();
  }
}

test('only the grassland ground is re-hued to the blade green, before its other treatments', () => {
  const { material, shader } = compiled(biomeById('grassland'));
  const fragment = shader.fragmentShader;
  assert.ok(fragment.includes('vec3 meadowGreen(vec3 albedo)'));
  const hue = fragment.indexOf('diffuseColor.rgb=meadowGreen(diffuseColor.rgb);'),
    transition = fragment.indexOf('float transition='),
    marsh = fragment.indexOf('float marsh=marshBasin');
  assert.ok(
    hue > 0 && hue < transition && transition < marsh,
    'hue first, then biome blend, then marsh',
  );
  assert.ok(
    fragment.includes('smoothstep(.78,.90,albedo.g/max(albedo.r,.001))'),
    'turf texels by hue',
  );
  const blade = shader.uniforms.meadowBlade.value;
  assert.deepEqual(
    [blade.x, blade.y, blade.z],
    [MEADOW_BLADE_ALBEDO.r, MEADOW_BLADE_ALBEDO.g, MEADOW_BLADE_ALBEDO.b],
  );
  assert.deepEqual(
    [shader.uniforms.meadowMatch.value.x, shader.uniforms.meadowMatch.value.y],
    [MEADOW_MATCH.dirt, MEADOW_MATCH.turf],
  );
  assert.equal(material.userData.meadow.meadowBlade, shader.uniforms.meadowBlade);
  assert.match(material.customProgramCacheKey(), /meadow/);
  for (const biome of BIOMES.filter((b) => b.id !== 'grassland')) {
    const other = compiled(biome);
    assert.ok(!other.shader.fragmentShader.includes('meadowGreen'), `${biome.id} keeps its ground`);
    assert.equal(other.shader.uniforms.meadowBlade, undefined);
    assert.equal(other.material.userData.meadow, undefined);
  }
});

test('the grassland biome colour is the re-hued ground green at the old olive luminance', () => {
  const colour = new THREE.Color(biomeById('grassland').color),
    luminance = 0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b,
    blade = MEADOW_BLADE_ALBEDO;
  assert.ok(Math.abs(luminance - 0.2608) < 0.01, 'same luminance as the former #889063');
  assert.ok(
    colour.g / colour.r > 3 && colour.g / colour.r < blade.g / blade.r,
    'green, a little softer than the blades',
  );
});
