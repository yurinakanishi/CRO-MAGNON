// Derive collision/walk data from measured exported triangles. No visible geometry.
import { readFile, writeFile } from 'node:fs/promises';
const [input, output] = process.argv.slice(2);
const source = JSON.parse(await readFile(input, 'utf8'));
const { step, minX, minZ, nx, nz, columns, ceilings } = source;
const heights = columns.map((column, i) => {
  if (!column.length) return 0;
  const floor = column.find((h) => h >= -0.1 && h < 2.6);
  if (floor === undefined) return null;
  const ceiling = ceilings[i].find((h) => h > floor + 0.1);
  if (ceiling !== undefined && ceiling - floor < 2.6) return null;
  return floor - 1.05;
});
// The renderer cuts only below the actual rock envelope. An approximate ellipse
// cuts beyond the rock and leaves visible sky slits around the entrance.
const roofs = columns.map((column, i) => Math.max(0, ...column, ...ceilings[i]));
const data = { step, minX, minZ, nx, nz, heights, roofs, sourceSha256: source.sha256 };
await writeFile(
  output,
  `// Measured cave floor and headroom from the delivered GLB.\nexport const CAMP_CAVE_SURFACE_DATA = ${JSON.stringify(data)};\n`,
);
console.log(
  JSON.stringify({
    input,
    output,
    nx,
    nz,
    walkable: heights.filter((h) => h !== null).length,
    blocked: heights.filter((h) => h === null).length,
  }),
);
