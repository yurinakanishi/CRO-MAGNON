// Convert the user-supplied artwork without generative editing or cropping.
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const source = 'C:/Users/yurin/Downloads/ChatGPT Image Oct 15, 2026, 04_29_09 PM.png';
const revision = 'assets/favicon/20261016-chibi-r01';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
await mkdir(`${revision}/previous`, { recursive: true });
await copyFile(source, `${revision}/source.png`, constants.COPYFILE_EXCL);
await copyFile('public/favicon.svg', `${revision}/previous/favicon.svg`, constants.COPYFILE_EXCL);
const original = await readFile(`${revision}/source.png`);
const metadata = await sharp(original).metadata();
assert.equal(metadata.width, metadata.height);
const pngs = new Map();
for (const size of [16, 32, 48, 64]) {
  const bytes = await sharp(original)
    .resize(size, size, { kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  pngs.set(size, bytes);
  await writeFile(`${revision}/favicon-${size}.png`, bytes, { flag: 'wx' });
}
const sizes = [16, 32, 48];
const directory = Buffer.alloc(6 + 16 * sizes.length);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
for (const [i, size] of sizes.entries()) {
  const bytes = pngs.get(size);
  const entry = 6 + 16 * i;
  directory[entry] = size;
  directory[entry + 1] = size;
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(metadata.hasAlpha ? 32 : 24, entry + 6);
  directory.writeUInt32LE(bytes.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += bytes.length;
}
const ico = Buffer.concat([directory, ...sizes.map((size) => pngs.get(size))]);
const svg = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><image width="64" height="64" href="data:image/png;base64,${pngs.get(64).toString('base64')}"/></svg>\n`,
);
for (const [name, bytes] of [
  ['favicon.svg', svg],
  ['favicon.ico', ico],
]) {
  await writeFile(`${revision}/${name}`, bytes, { flag: 'wx' });
  await writeFile(`public/${name}`, bytes);
}
// Decode every ICO entry and compare its stored PNG with the prepared size.
for (const [i, size] of sizes.entries()) {
  const entry = 6 + i * 16;
  const start = ico.readUInt32LE(entry + 12);
  const bytes = ico.subarray(start, start + ico.readUInt32LE(entry + 8));
  assert.deepEqual(bytes, pngs.get(size));
  const decoded = await sharp(bytes).metadata();
  assert.equal(decoded.width, size);
  assert.equal(decoded.height, size);
}
const report = {
  date: '2026-10-16',
  source: {
    suppliedPath: source,
    preservedPath: `${revision}/source.png`,
    sha256: hash(original),
    width: metadata.width,
    height: metadata.height,
    hasAlpha: metadata.hasAlpha,
  },
  conversion: {
    tool: `sharp ${sharp.versions.sharp}`,
    kernel: 'lanczos3',
    crop: false,
    generatedArtwork: false,
    cornerBackground: 'Preserved from the supplied opaque image',
  },
  previous: {
    path: `${revision}/previous/favicon.svg`,
    sha256: hash(await readFile(`${revision}/previous/favicon.svg`)),
  },
  files: [
    ...[...pngs].map(([size, bytes]) => ({
      path: `${revision}/favicon-${size}.png`,
      width: size,
      height: size,
      bytes: bytes.length,
      sha256: hash(bytes),
    })),
    { path: 'public/favicon.svg', rasterSize: 64, bytes: svg.length, sha256: hash(svg) },
    { path: 'public/favicon.ico', sizes, bytes: ico.length, sha256: hash(ico) },
  ],
};
await writeFile(`${revision}/manifest.json`, JSON.stringify(report, null, 2) + '\n', {
  flag: 'wx',
});
console.log(JSON.stringify(report, null, 2));
