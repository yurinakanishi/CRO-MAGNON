// Physics and coastline samples from the exact delivered image-to-3D mesh.
import { readFile, writeFile } from 'node:fs/promises';
const [input, output] = process.argv.slice(2);
const src = JSON.parse(await readFile(input, 'utf8'));
const { step, minX, minZ, nx, nz, sha256 } = src;
const heights = src.columns.map((c) => (c.length ? Math.round(Math.max(0, ...c) * 100) / 100 : 0));
const points = [];
for (let iz = 0; iz < nz; iz++)
  for (let ix = 0; ix < nx; ix++)
    if (heights[iz * nx + ix] > 0.1)
      points.push([minX + (ix + 0.5) * step, minZ + (iz + 0.5) * step]);
points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const half = (list) => {
  const h = [];
  for (const p of list) {
    while (h.length >= 2 && cross(h.at(-2), h.at(-1), p) <= 0) h.pop();
    h.push(p);
  }
  return h.slice(0, -1);
};
const footprint = [...half(points), ...half([...points].reverse())];
await writeFile(
  output,
  `// Measured from the source-derived GLB, metres; no rendered geometry.\nexport const CAMP_MOUNTAIN_SURFACE_DATA = ${JSON.stringify({ step, minX, minZ, nx, nz, heights, footprint, sha256 })};\n`,
);
console.log(
  JSON.stringify({
    nx,
    nz,
    footprint: footprint.length,
    maximum: heights.reduce((a, b) => Math.max(a, b), 0),
    sha256,
  }),
);
