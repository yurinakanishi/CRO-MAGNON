// The SVG is the icon source. Its rounded clip also supplies every ICO size.
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const source = await readFile(new URL('../public/favicon.svg', import.meta.url));
const sizes = [16, 32, 48, 64];
const images = await Promise.all(
  sizes.map((size) =>
    sharp(source, { density: (72 * size) / 64 })
      .png()
      .toBuffer(),
  ),
);
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
images.forEach((bytes, index) => {
  const entry = 6 + 16 * index;
  header[entry] = header[entry + 1] = sizes[index];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(bytes.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += bytes.length;
});
await writeFile(
  new URL('../public/favicon.ico', import.meta.url),
  Buffer.concat([header, ...images]),
);
console.log('Rounded favicon.ico: ' + sizes.join(', ') + ' px');
