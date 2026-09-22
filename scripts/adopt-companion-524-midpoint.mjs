// Bake the user-selected 50/50 linear-light material preview into a single GLB.
// Both original sources and every non-image buffer remain intact.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const sourceRoot = '../threed-model-creation/models/yellow-524-mascot';
const sources = [15, 16].map(
  (n) => `${sourceRoot}/work/low-poly/batch-0${n}/run-01/attempt-01/candidate.glb`,
);
const expected = [
  '04b54fad6ab5f59ee342f3b98dbd902ef8a4f4fe9bb53816fc91879291e32b3a',
  '2652765f480973f6d974d0c51b2bd294c6e4c81e32e369814e09ba6c03c3e418',
];
const hash = (b) => createHash('sha256').update(b).digest('hex');
const writeJson = (p, value) => writeFile(p, `${JSON.stringify(value, null, 2)}\n`);
function parse(b) {
  assert.equal(b.readUInt32LE(0), 0x46546c67);
  const size = b.readUInt32LE(12),
    doc = JSON.parse(b.subarray(20, 20 + size));
  const binary = b.subarray(28 + size, 28 + size + doc.buffers[0].byteLength);
  return {
    doc,
    binary,
    view(i) {
      const v = doc.bufferViews[i];
      return binary.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
    },
  };
}
const inputs = await Promise.all(sources.map((p) => readFile(p)));
inputs.forEach((b, i) => assert.equal(hash(b), expected[i]));
const [before, after] = inputs.map(parse);
const imageIndex = after.doc.images[0].bufferView;
for (let i = 0; i < after.doc.bufferViews.length; i++) {
  if (i !== imageIndex) assert.deepEqual(before.view(i), after.view(i));
}
for (const key of ['nodes', 'meshes', 'skins', 'accessors', 'animations'])
  assert.deepEqual(before.doc[key], after.doc[key]);

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let texture;
try {
  const page = await browser.newPage();
  texture = await page.evaluate(
    async (images) => {
      async function decode(base64) {
        const image = await createImageBitmap(
          new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: 'image/png' }),
        );
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(image, 0, 0);
        image.close();
        return { canvas, ctx, pixels: ctx.getImageData(0, 0, canvas.width, canvas.height) };
      }
      const [a, b] = await Promise.all(images.map(decode));
      if (a.canvas.width !== b.canvas.width || a.canvas.height !== b.canvas.height)
        throw Error('Texture sizes differ');
      const lookup = Array.from({ length: 256 }, (_, n) => {
        const c = n / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      const encode = (c) => 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
      const original = a.pixels.data,
        latest = b.pixels.data,
        pixels = new Uint8ClampedArray(original);
      let changedPixels = 0,
        unchangedPixels = 0,
        maxQuantizationError = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (original[i + 3] !== 255 || latest[i + 3] !== 255)
          throw Error('Expected opaque source texels');
        const changed = [0, 1, 2].some((c) => original[i + c] !== latest[i + c]);
        if (!changed) {
          unchangedPixels++;
          continue;
        }
        changedPixels++;
        for (let c = 0; c < 3; c++) {
          const value = encode((lookup[original[i + c]] + lookup[latest[i + c]]) * 0.5);
          pixels[i + c] = Math.round(value);
          maxQuantizationError = Math.max(maxQuantizationError, Math.abs(pixels[i + c] - value));
        }
      }
      a.ctx.putImageData(new ImageData(pixels, a.canvas.width, a.canvas.height), 0, 0);
      const png = a.canvas.toDataURL('image/png').split(',')[1];
      const roundTrip = (await decode(png)).pixels.data;
      for (let i = 0; i < pixels.length; i++)
        if (roundTrip[i] !== pixels[i]) throw Error('PNG roundtrip changed a texel');
      return {
        png,
        width: a.canvas.width,
        height: a.canvas.height,
        changedPixels,
        unchangedPixels,
        maxQuantizationError,
        alphaUnchanged: true,
        outsideChangedSourcePixelsUnchanged: true,
      };
    },
    [before.view(imageIndex), after.view(imageIndex)].map((b) => b.toString('base64')),
  );
} finally {
  await browser.close();
}
const { png, ...pixelEvidence } = texture;
const image = Buffer.from(png, 'base64');
const doc = structuredClone(after.doc),
  chunks = [];
let offset = 0;
for (let i = 0; i < doc.bufferViews.length; i++) {
  const bytes = i === imageIndex ? image : after.view(i);
  doc.bufferViews[i].byteOffset = offset;
  doc.bufferViews[i].byteLength = bytes.length;
  const pad = Buffer.alloc(-bytes.length & 3);
  chunks.push(bytes, pad);
  offset += bytes.length + pad.length;
}
const binary = Buffer.concat(chunks);
doc.buffers[0].byteLength = binary.length;
doc.images[0].name = '524-selected-midpoint-yellow';
doc.materials[0].name = '524 midpoint yellow ivory orange teal';
const json = Buffer.from(JSON.stringify(doc));
const jsonChunk = Buffer.concat([json, Buffer.alloc(-json.length & 3, 0x20)]);
const header = Buffer.alloc(20),
  binHeader = Buffer.alloc(8);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + jsonChunk.length + binary.length, 8);
header.writeUInt32LE(jsonChunk.length, 12);
header.writeUInt32LE(0x4e4f534a, 16);
binHeader.writeUInt32LE(binary.length, 0);
binHeader.writeUInt32LE(0x004e4942, 4);
const output = Buffer.concat([header, jsonChunk, binHeader, binary]);
const verified = parse(output),
  buffers = [];
for (let i = 0; i < doc.bufferViews.length; i++) {
  if (i === imageIndex) continue;
  assert.deepEqual(verified.view(i), after.view(i));
  buffers.push({ index: i, sha256: hash(verified.view(i)) });
}
const directory = 'public/models/yellow-524-mascot';
const glbPath = `${directory}/model-midpoint-r01.glb`;
await mkdir(directory, { recursive: true });
await writeFile(glbPath, output);
await writeJson('assets/companion-524/midpoint-build-r01.json', {
  sourceCandidates: [13, 14],
  sourceHashes: expected,
  sources,
  output: glbPath,
  sha256: hash(output),
  bytes: output.length,
  method: '50/50 linear-light sRGB interpolation; 8-bit PNG quantization',
  ...pixelEvidence,
  unchangedNonImageBuffers: buffers,
});

const old = JSON.parse(await readFile(`${directory}/asset.json`, 'utf8'));
const position = doc.accessors[doc.meshes[0].primitives[0].attributes.POSITION];
const scale = 0.3 / (position.max[1] - position.min[1]);
const record = {
  ...old,
  candidate: 14,
  revision: 'midpoint-r01',
  url: `/models/yellow-524-mascot/model-midpoint-r01.glb`,
  sha256: hash(output),
  bytes: output.length,
  heightMetres: 0.3,
  widthMetres: (position.max[0] - position.min[0]) * scale,
  placement: {
    pivot: 'original-body-centre',
    scale,
    hoverHeightMetres: 0.94,
    hoverAmplitudeMetres: 0.12,
    hoverPeriodMs: 4000,
  },
  notes: [
    'User selected the midpoint between C13 and C14 on 2026-09-22. Equal linear-light interpolation, matching the reviewed material preview within 8-bit PNG quantization.',
    'C14 geometry, normals, UVs, 20 bones, skin weights and Floating_Ripple remain byte-identical. Original C13/C14 and the former game GLB are retained.',
    'Body height 0.30m excludes the floating air gap. Runtime adds 0.12m vertical amplitude over a four-second cycle; hearts and name offset fit the smaller body.',
  ],
  provenance: {
    ...old.provenance,
    provider:
      'Codex imagegen and local TRELLIS-2 lineage; original C13/C14 midpoint color baked by Codex',
    source: sources[1],
    sourceSha256: expected[1],
    colorSources: sources,
    colorSourceHashes: expected,
    visualReview: 'assets/companion-524/adoption-midpoint-r01.json',
  },
};
await writeJson(`${directory}/asset.json`, record);
for (const filename of ['public/models/world-assets.json', 'assets/world-models.json']) {
  const catalog = JSON.parse(await readFile(filename, 'utf8'));
  const key = filename.startsWith('public') ? 'modelKey' : 'key';
  const index = catalog.assets.findIndex((a) => a[key] === record.modelKey);
  assert.ok(index >= 0);
  catalog.assets[index] =
    key === 'modelKey'
      ? record
      : {
          ...catalog.assets[index],
          revision: record.revision,
          sha256: record.sha256,
          delivery: record.url,
        };
  await writeJson(filename, catalog);
}
await writeJson('assets/companion-524/adoption-midpoint-r01.json', {
  decision: 'adopt',
  revision: record.revision,
  sourceCandidates: [13, 14],
  sourceHashes: expected,
  sha256: record.sha256,
  bytes: output.length,
  triangles: old.triangles,
  bodyHeightMetres: 0.3,
  approval:
    'User selected the middle color and explicitly requested implementation after the three-image review.',
  colorReview: 'assets/companion-524/color-review-2026-09-22.json',
  build: 'assets/companion-524/midpoint-build-r01.json',
  sourceFilesUnmodified: true,
  gameValidation: 'pending',
});
for (const [i, source] of sources.entries()) {
  assert.equal(hash(await readFile(source)), expected[i]);
}
console.log(
  JSON.stringify({
    output: glbPath,
    sha256: hash(output),
    bytes: output.length,
    scale,
    ...pixelEvidence,
  }),
);
