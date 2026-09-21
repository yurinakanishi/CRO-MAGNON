// Bake the unchanged generated reference onto the reconstructed facial UVs.
// This repairs TRELLIS's black eye albedo; geometry, original atlas and source stay saved.
import { readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readSurface } from './female-face-geometry.mjs';
import { pack } from './motion-glb.mjs';
const { default: sharp } = await import('sharp');
const key = process.argv[2] || 'cro-magnon-woman',
  revision = process.argv[3] || '02',
  base = `assets/female-face-repair/${key}`;
const output = `${base}/work/head-colour-r${revision}.glb`;
try {
  await access(output);
  throw Error('Refusing to overwrite ' + output);
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
const surface = await readSurface(`${base}/work/trellis/head-res1024-seed0042.glb`),
  { doc, binary } = surface;
const imageId = doc.textures[doc.materials[0].pbrMetallicRoughness.baseColorTexture.index].source,
  im = doc.images[imageId],
  bv = doc.bufferViews[im.bufferView];
const { data: atlas, info } = await sharp(
  binary.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength),
)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const { data: ref, info: ri } = await sharp(`${base}/source/reference-v1.png`)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const target = Buffer.from(atlas),
  N = info.width,
  H = info.height,
  coverage = new Uint8Array(N * H),
  occupied = new Uint8Array(N * H);
const bounds = doc.accessors[doc.meshes[0].primitives[0].attributes.POSITION],
  height = bounds.max[1] - bounds.min[1],
  cx = (bounds.max[0] + bounds.min[0]) / 2,
  cy = (bounds.max[1] + bounds.min[1]) / 2;
const screen = (p) => [
  320 + ((p[0] - cx) * 640) / (height * 1.12),
  320 - ((p[1] - cy) * 640) / (height * 1.12),
];
const cfg =
  key === 'cro-magnon-woman'
    ? {
        centreX: 320,
        referenceX: 627,
        xScale: 2.17,
        gain: [0.75, 0.73, 0.75],
        y: [
          [150, 302],
          [265, 550],
          [346, 713],
          [383, 797],
          [435, 940],
          [574, 1198],
        ],
        eyes: [
          [271, 266, 34, 22],
          [376, 266, 34, 22],
        ],
        ellipse: [320, 313, 128, 185],
      }
    : {
        centreX: 319,
        referenceX: 618,
        xScale: 2.28,
        gain: [0.85, 0.8, 0.76],
        y: [
          [158, 258],
          [234, 464],
          [275, 542],
          [345, 699],
          [387, 787],
          [442, 951],
          [585, 1205],
        ],
        eyes: [
          [266, 275, 36, 22],
          [378, 275, 36, 22],
        ],
        ellipse: [320, 310, 130, 184],
      };
if (!cfg) throw Error('Inspect the second exact head and configure its facial landmarks first.');
const smooth = (x) => {
  x = Math.max(0, Math.min(1, x));
  return x * x * (3 - 2 * x);
};
const yy = (y) => {
  let k = cfg.y.findIndex((a) => a[0] >= y);
  if (k < 1) k = k < 0 ? cfg.y.length - 1 : 1;
  const a = cfg.y[k - 1],
    b = cfg.y[k];
  return a[1] + ((y - a[0]) * (b[1] - a[1])) / (b[0] - a[0]);
};
function sample(x, y) {
  x = Math.max(0, Math.min(ri.width - 1.001, x));
  y = Math.max(0, Math.min(ri.height - 1.001, y));
  const ix = Math.floor(x),
    iy = Math.floor(y),
    dx = x - ix,
    dy = y - iy;
  return [0, 1, 2].map(
    (k) =>
      ref[(iy * ri.width + ix) * 4 + k] * (1 - dx) * (1 - dy) +
      ref[(iy * ri.width + ix + 1) * 4 + k] * dx * (1 - dy) +
      ref[((iy + 1) * ri.width + ix) * 4 + k] * (1 - dx) * dy +
      ref[((iy + 1) * ri.width + ix + 1) * 4 + k] * dx * dy,
  );
}
// Front visibility test keeps back hair and interior surfaces out of the projection.
const D = 512,
  depth = new Float32Array(D * D).fill(-Infinity);
function raster(points, width, height, visit) {
  const [[ax, ay], [bx, by], [cx, cy]] = points,
    den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(den) < 1e-8) return;
  const minx = Math.max(0, Math.floor(Math.min(ax, bx, cx))),
    maxx = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx))),
    miny = Math.max(0, Math.floor(Math.min(ay, by, cy))),
    maxy = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)));
  for (let y = miny; y <= maxy; y++)
    for (let x = minx; x <= maxx; x++) {
      const u = ((by - cy) * (x + 0.5 - cx) + (cx - bx) * (y + 0.5 - cy)) / den,
        v = ((cy - ay) * (x + 0.5 - cx) + (ax - cx) * (y + 0.5 - cy)) / den,
        w = 1 - u - v;
      if (Math.min(u, v, w) >= -1e-6) visit(x, y, u, v, w);
    }
}
for (const t of surface.triangles) {
  const vs = t.ids.map((i) => surface.vertices[i]);
  raster(
    vs.map((v) => screen(v.p).map((x) => (x * D) / 640)),
    D,
    D,
    (x, y, a, b, c) => {
      depth[y * D + x] = Math.max(
        depth[y * D + x],
        vs[0].p[2] * a + vs[1].p[2] * b + vs[2].p[2] * c,
      );
    },
  );
}
// Remove only raised fringe ribbons where the TRELLIS mesh already contains
// a second, continuous forehead surface immediately underneath. Move the
// redundant ribbon inside that measured surface; never invent facial anatomy.
let fringeVertices = 0,
  fringeMaximumDisplacement = 0,
  removedFringeTriangles = 0;
if (key === 'cro-magnon-woman' && Number(revision) >= 3) {
  const layers = new Map();
  for (const t of surface.triangles) {
    const vs = t.ids.map((i) => surface.vertices[i]);
    if (vs.reduce((s, v) => s + v.n[2], 0) / 3 < 0.4) continue;
    raster(
      vs.map((v) => screen(v.p).map((x) => (x * D) / 640)),
      D,
      D,
      (x, y, a, b, c) => {
        const sx = (x * 640) / D,
          sy = (y * 640) / D;
        if (sx < 258 || sx > 353 || sy < 156 || sy > 256) return;
        const id = y * D + x;
        if (!layers.has(id)) layers.set(id, []);
        layers.get(id).push(vs[0].p[2] * a + vs[1].p[2] * b + vs[2].p[2] * c);
      },
    );
  }
  for (const [id, values] of layers) {
    values.sort((a, b) => b - a);
    const first = values[0],
      support = values.filter((z) => z < first - 0.006 && z > first - 0.045);
    layers.set(id, support.length ? Math.min(...support) : null);
  }
  const redundant = new Set();
  for (const [i, v] of surface.vertices.entries()) {
    const [sx, sy] = screen(v.p);
    if (sx < 258 || sx > 353 || sy < 156 || sy > 256) continue;
    const support = layers.get(Math.floor((sy * D) / 640) * D + Math.floor((sx * D) / 640));
    if (support === null || support === undefined || v.p[2] <= support + 0.003) continue;
    const movement = v.p[2] - (support - 0.003);
    if (movement > 0.05) continue;
    if (Number(revision) >= 4) redundant.add(i);
    else v.p[2] = support - 0.003;
    fringeMaximumDisplacement = Math.max(fringeMaximumDisplacement, movement);
    fringeVertices++;
  }
  if (redundant.size) {
    const before = surface.triangles.length;
    surface.triangles = surface.triangles.filter((t) => !t.ids.some((i) => redundant.has(i)));
    removedFringeTriangles = before - surface.triangles.length;
  }
  depth.fill(-Infinity);
  for (const t of surface.triangles) {
    const vs = t.ids.map((i) => surface.vertices[i]);
    raster(
      vs.map((v) => screen(v.p).map((x) => (x * D) / 640)),
      D,
      D,
      (x, y, a, b, c) => {
        depth[y * D + x] = Math.max(
          depth[y * D + x],
          vs[0].p[2] * a + vs[1].p[2] * b + vs[2].p[2] * c,
        );
      },
    );
  }
}
let pixels = 0;
for (const t of surface.triangles) {
  const vs = t.ids.map((i) => surface.vertices[i]);
  raster(
    vs.map((v) => [v.uv[0] * N, v.uv[1] * H]),
    N,
    H,
    (x, y, a, b, c) => {
      occupied[y * N + x] = 1;
      const weights = [a, b, c],
        p = [0, 1, 2].map((k) => vs.reduce((s, v, i) => s + v.p[k] * weights[i], 0)),
        n = vs.reduce((s, v, i) => s + v.n[2] * weights[i], 0),
        [sx, sy] = screen(p);
      if (sx < 0 || sx >= 640 || sy < 0 || sy >= 640) return;
      const z =
        depth[
          Math.min(D - 1, Math.floor((sy * D) / 640)) * D +
            Math.min(D - 1, Math.floor((sx * D) / 640))
        ];
      const [ex, ey, rx, ry] = cfg.ellipse,
        edge = 1 - ((sx - ex) / rx) ** 2 - ((sy - ey) / ry) ** 2;
      const offset = (y * N + x) * 4,
        brightness = (atlas[offset] + atlas[offset + 1] + atlas[offset + 2]) / 765;
      const eye = Math.max(
        ...cfg.eyes.map(([x, y, rx, ry]) =>
          smooth((1 - ((sx - x) / rx) ** 2 - ((sy - y) / ry) ** 2) * 5),
        ),
      );
      const forehead =
        key === 'cro-magnon-woman'
          ? smooth((sy - 143) / 12) *
            smooth((248 - sy) / 12) *
            smooth((sx - 250) / 30) *
            smooth((385 - sx) / 30)
          : smooth((sy - 157) / 12) *
            smooth((250 - sy) / 12) *
            smooth((sx - 212) / 25) *
            smooth((430 - sx) / 25);
      const face =
        p[2] < z - 0.012
          ? 0
          : smooth(edge * 7) *
            Math.max(eye, forehead, smooth((brightness - 0.15) / 0.1)) *
            Math.max(eye, smooth((n - 0.1) / 0.55));
      const neck =
        smooth((sy - 420) / 65) *
        smooth((0.2 - Math.abs(p[0] - cx)) / 0.07) *
        smooth((p[2] + 0.2) / 0.08);
      const alpha = Math.max(face, neck);
      if (alpha < 0.01) return;
      const rgb = sample(
        cfg.referenceX + (sx - cfg.centreX) * cfg.xScale * (1 - neck * 0.8),
        yy(sy),
      ).map((v, k) => v * cfg.gain[k]);
      for (let k = 0; k < 3; k++)
        target[offset + k] = Math.round(atlas[offset + k] * (1 - alpha) + rgb[k] * alpha);
      coverage[y * N + x] = 1;
      pixels++;
    },
  );
}
// Extend only the changed texels by two pixels into atlas gutters for bilinear sampling.
for (let pass = 0; pass < 2; pass++) {
  const before = Buffer.from(target),
    mask = coverage.slice();
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < N - 1; x++) {
      const id = y * N + x;
      if (mask[id] || occupied[id]) continue;
      const neighbours = [id - 1, id + 1, id - N, id + N].filter((i) => mask[i]);
      if (!neighbours.length) continue;
      for (let k = 0; k < 3; k++)
        target[id * 4 + k] = Math.round(
          neighbours.reduce((s, i) => s + before[i * 4 + k], 0) / neighbours.length,
        );
      coverage[id] = 1;
    }
}
const png = await sharp(target, { raw: { width: N, height: H, channels: 4 } })
  .png()
  .toBuffer();
await writeFile(`${base}/work/face-albedo-r${revision}.png`, png);
let offset = Math.ceil(binary.length / 4) * 4;
const parts = [binary, Buffer.alloc(offset - binary.length), png];
doc.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: png.length });
doc.images[imageId] = { ...im, bufferView: doc.bufferViews.length - 1 };
offset += png.length;
if (fringeVertices && !removedFringeTriangles) {
  const pad = (4 - (offset % 4)) % 4;
  parts.push(Buffer.alloc(pad));
  offset += pad;
  const array = new Float32Array(surface.vertices.flatMap((v) => v.p)),
    position = Buffer.from(array.buffer);
  doc.bufferViews.push({
    buffer: 0,
    byteOffset: offset,
    byteLength: position.length,
    target: 34962,
  });
  doc.accessors.push({ ...bounds, bufferView: doc.bufferViews.length - 1, byteOffset: 0 });
  doc.meshes[0].primitives[0].attributes.POSITION = doc.accessors.length - 1;
  parts.push(position);
  offset += position.length;
}
if (removedFringeTriangles) {
  const pad = (4 - (offset % 4)) % 4;
  parts.push(Buffer.alloc(pad));
  offset += pad;
  const array = new Uint32Array(surface.triangles.flatMap((t) => t.ids)),
    indices = Buffer.from(array.buffer);
  doc.bufferViews.push({
    buffer: 0,
    byteOffset: offset,
    byteLength: indices.length,
    target: 34963,
  });
  doc.accessors.push({
    bufferView: doc.bufferViews.length - 1,
    componentType: 5125,
    count: array.length,
    type: 'SCALAR',
  });
  doc.meshes[0].primitives[0].indices = doc.accessors.length - 1;
  parts.push(indices);
  offset += indices.length;
}
const mat = doc.materials[0].pbrMetallicRoughness;
mat.metallicFactor = 0;
mat.roughnessFactor = 0.72;
delete mat.metallicRoughnessTexture;
doc.buffers[0].byteLength = offset;
const bytes = pack(doc, Buffer.concat(parts));
await writeFile(output, bytes);
const report = {
  key,
  revision,
  method:
    'Generated reference baked onto facial UVs and neck with body-matched colour calibration. Redundant fringe is repaired only where a measured forehead exists underneath.',
  landmarks: cfg,
  pixels,
  fringeVertices,
  removedFringeTriangles,
  fringeMaximumDisplacementSourceUnits: removedFringeTriangles ? 0 : fringeMaximumDisplacement,
  sourceSha256: createHash('sha256').update(surface.bytes).digest('hex'),
  sha256: createHash('sha256').update(bytes).digest('hex'),
  metallic: 0,
  roughness: 0.72,
};
await writeFile(
  `${base}/work/colour-bake-r${revision}.json`,
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report));
