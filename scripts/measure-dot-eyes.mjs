// Measures where each Dot's painted eyes sit on its delivered surface, in the bind-pose
// position space the vertex shader reads (metres, ground-centred, +Z the face). The eyes are
// ink in the albedo, not geometry, so every texel of every front triangle is mapped back to 3D
// and the dark ink (or the frog's pale eyeballs) is gathered per eye. Read-only; prints JSON.
// node scripts/measure-dot-eyes.mjs [kind ...]
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const KINDS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['white', 'blue', 'green', 'purple', 'orange', 'beret', 'frog'];

async function load(kind) {
  const asset = JSON.parse(await readFile(`public/models/orb-bot-${kind}/asset.json`, 'utf8'));
  const bytes = await readFile(`public${asset.url}`);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const binStart = 20 + jsonLength + 8;
  const bin = bytes.subarray(binStart, binStart + bytes.readUInt32LE(20 + jsonLength));
  await MeshoptDecoder.ready;
  const view = (index) => {
    const v = json.bufferViews[index];
    const meshopt = v.extensions?.EXT_meshopt_compression;
    if (!meshopt) return bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
    const out = new Uint8Array(meshopt.count * meshopt.byteStride);
    const source = bin.subarray(
      meshopt.byteOffset ?? 0,
      (meshopt.byteOffset ?? 0) + meshopt.byteLength,
    );
    MeshoptDecoder.decodeGltfBuffer(
      out,
      meshopt.count,
      meshopt.byteStride,
      source,
      meshopt.mode,
      meshopt.filter,
    );
    return Buffer.from(out.buffer);
  };
  const read = (index) => {
    const a = json.accessors[index];
    const data = view(a.bufferView);
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const stride = json.bufferViews[a.bufferView].byteStride ?? 0;
    const out = new Float64Array(a.count * size);
    const base = a.byteOffset ?? 0;
    for (let i = 0; i < a.count; i++)
      for (let c = 0; c < size; c++) {
        const component =
          a.componentType === 5126
            ? 4
            : a.componentType === 5125
              ? 4
              : a.componentType === 5123
                ? 2
                : 1;
        const offset = base + i * (stride || size * component) + c * component;
        out[i * size + c] =
          a.componentType === 5126
            ? data.readFloatLE(offset)
            : a.componentType === 5125
              ? data.readUInt32LE(offset)
              : a.componentType === 5123
                ? data.readUInt16LE(offset)
                : data.readUInt8(offset);
      }
    return out;
  };
  const primitive = json.meshes[0].primitives[0];
  const position = read(primitive.attributes.POSITION);
  const uv = read(primitive.attributes.TEXCOORD_0);
  const index = read(primitive.indices);
  const material = json.materials[primitive.material ?? 0];
  const texture = json.textures[material.pbrMetallicRoughness.baseColorTexture.index];
  const image = json.images[texture.extensions?.EXT_texture_webp?.source ?? texture.source];
  const { data, info } = await sharp(view(image.bufferView))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { position, uv, index, pixels: data, width: info.width, height: info.height };
}

const luminance = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const saturation = (r, g, b) => {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  return max ? (max - min) / max : 0;
};

/** Every texel of every front-facing triangle, with its 3D bind-pose position and colour. */
function texels(mesh) {
  const { position, uv, index, pixels, width, height } = mesh;
  const out = [];
  for (let t = 0; t < index.length; t += 3) {
    const v = [index[t], index[t + 1], index[t + 2]];
    const p = v.map((i) => [position[i * 3], position[i * 3 + 1], position[i * 3 + 2]]);
    if (Math.max(p[0][2], p[1][2], p[2][2]) < 0.02) continue; // the face is +Z
    const q = v.map((i) => [uv[i * 2] * width, uv[i * 2 + 1] * height]);
    const minX = Math.max(0, Math.floor(Math.min(q[0][0], q[1][0], q[2][0])));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(q[0][0], q[1][0], q[2][0])));
    const minY = Math.max(0, Math.floor(Math.min(q[0][1], q[1][1], q[2][1])));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(q[0][1], q[1][1], q[2][1])));
    const d = (q[1][1] - q[2][1]) * (q[0][0] - q[2][0]) + (q[2][0] - q[1][0]) * (q[0][1] - q[2][1]);
    if (Math.abs(d) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5,
          py = y + 0.5;
        const a = ((q[1][1] - q[2][1]) * (px - q[2][0]) + (q[2][0] - q[1][0]) * (py - q[2][1])) / d;
        const b = ((q[2][1] - q[0][1]) * (px - q[2][0]) + (q[0][0] - q[2][0]) * (py - q[2][1])) / d;
        const c = 1 - a - b;
        if (a < 0 || b < 0 || c < 0) continue;
        const o = (y * width + x) * 4;
        out.push({
          x: a * p[0][0] + b * p[1][0] + c * p[2][0],
          y: a * p[0][1] + b * p[1][1] + c * p[2][1],
          z: a * p[0][2] + b * p[1][2] + c * p[2][2],
          r: pixels[o],
          g: pixels[o + 1],
          b: pixels[o + 2],
        });
      }
  }
  return out;
}

function summarise(points) {
  const range = (k) => [Math.min(...points.map((p) => p[k])), Math.max(...points.map((p) => p[k]))];
  const [x0, x1] = range('x'),
    [y0, y1] = range('y'),
    [z0, z1] = range('z');
  const round = (v) => Math.round(v * 10000) / 10000;
  return {
    count: points.length,
    centre: [round((x0 + x1) / 2), round((y0 + y1) / 2)],
    radius: [round((x1 - x0) / 2), round((y1 - y0) / 2)],
    z: [round(z0), round(z1)],
  };
}

const result = {};
for (const kind of KINDS) {
  const mesh = await load(kind);
  const all = texels(mesh);
  const body = all.filter((p) => luminance(p.r, p.g, p.b) > 0.35 && p.y > 0.06 && p.y < 0.24);
  // The frog's eyes are pale eyeballs on top; every other Dot's are dark ink on the face.
  const eye =
    kind === 'frog'
      ? (p) => p.y > 0.165 && luminance(p.r, p.g, p.b) > 0.55 && saturation(p.r, p.g, p.b) < 0.2
      : kind === 'beret'
        ? (p) => p.y > 0.08 && p.y < 0.14 && luminance(p.r, p.g, p.b) < 0.18
        : (p) => p.y > 0.1 && p.y < 0.21 && p.z > 0.07 && luminance(p.r, p.g, p.b) < 0.22;
  const ink = all.filter(eye);
  const sides = [ink.filter((p) => p.x < 0), ink.filter((p) => p.x >= 0)];
  const eyes = sides.map(summarise);
  // The lid takes the colour just around each eye (sRGB, as the texture stores it).
  const lid = sides.map((side, i) => {
    const e = eyes[i];
    const ring = all.filter((p) => {
      const u = (p.x - e.centre[0]) / (e.radius[0] * 1.6),
        v = (p.y - e.centre[1]) / (e.radius[1] * 1.6);
      const r = Math.hypot(u, v);
      return r > 1 && r < 1.5 && p.z >= e.z[0] - 0.01 && !eye(p);
    });
    const mean = (k) => Math.round(ring.reduce((s, p) => s + p[k], 0) / Math.max(1, ring.length));
    return { rgb: [mean('r'), mean('g'), mean('b')], samples: ring.length };
  });
  const dark = ink.filter((p) => luminance(p.r, p.g, p.b) < 0.15);
  const line = dark.length
    ? [0, 1, 2].map((c) =>
        Math.round(dark.reduce((s, p) => s + [p.r, p.g, p.b][c], 0) / dark.length),
      )
    : null;
  result[kind] = { texels: all.length, body: body.length, eyes, lid, line };
}
console.log(JSON.stringify(result, null, 1));
