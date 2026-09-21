import { mkdir, writeFile } from 'node:fs/promises';
import { readSurface, keepBody } from './female-face-geometry.mjs';
for (const [key, y] of [
  ['cro-magnon-woman', 1.385],
  ['neanderthal-woman', 1.315],
]) {
  const source = await readSurface(`public/models/${key}/model-human-r10.glb`),
    body = keepBody(source, y);
  await mkdir(`assets/female-face-repair/${key}/work`, { recursive: true });
  await writeFile(
    `assets/female-face-repair/${key}/work/neck-inspection.json`,
    JSON.stringify({ ...body.report, ring: body.ring.map((i) => body.vertices[i]) }, null, 2) +
      '\n',
  );
  console.log(JSON.stringify({ key, ...body.report }));
}
