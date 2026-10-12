// Read-only: sample the delivered alpha against measured cave wall intersections.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import {
  caveMuralImages,
  caveMotifSource,
  caveMuralShader,
} from '../dist/src/cave-gallery-layout.js';
import { caveCentreOffset } from '../dist/shared/camp-cave-layout.mjs';
import { digest } from './cave-mural-composition.mjs';
const file = process.argv[2] ?? 'assets/camp-cave/qa/gallery-surfaces-r36.json';
const out = process.argv[3] ?? 'assets/camp-cave/qa/gallery-pigment-coverage-r36.json';
const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json'));
const images = caveMuralImages(asset),
  records = JSON.parse(await readFile(file));
const textures = {
  atlas: images.pigment,
  character524: images.characterPigment,
  rimoFrieze: images.rimoPigment,
  ...images.extras,
};
const decoded = {};
for (const [key, record] of Object.entries(textures)) {
  const bytes = await readFile(`public${record.url}`);
  assert.equal(digest(bytes), record.sha256);
  decoded[key] = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}
const placements = records.map((r) => {
  const { data, info } = decoded[r.pigment],
    source = caveMotifSource(r.motif),
    [x0, y0, x1, y1] = r.rectangle;
  const painted = r.samples.filter((s) => {
    const x = Math.min(
      info.width - 1,
      Math.max(0, Math.floor(((x0 + s.u * (x1 - x0)) / source.width) * info.width)),
    );
    const y = Math.min(
      info.height - 1,
      Math.max(0, Math.floor(((y1 - s.v * (y1 - y0)) / source.height) * info.height)),
    );
    return data[(y * info.width + x) * 4 + 3] > 32;
  });
  const rejected = painted.filter(
    (s) =>
      !s.point ||
      (r.wall === 'east'
        ? s.point[0] - caveCentreOffset(s.point[2]) >= -1.1
        : s.point[0] - caveCentreOffset(s.point[2]) <= 1.1),
  );
  return {
    motif: r.motif,
    wall: r.wall,
    centre: r.centre,
    paintedSamples: painted.length,
    rejected: rejected.length,
    formerSteepNormalCutoff: painted.filter((s) => s.facing <= 0.38).length,
  };
});
const report = {
  geometry: { url: asset.url, sha256: asset.sha256 },
  shaderSha256: digest(caveMuralShader),
  measurements: file,
  placements,
  totalPainted: placements.reduce((s, r) => s + r.paintedSamples, 0),
  totalRejected: placements.reduce((s, r) => s + r.rejected, 0),
  scope:
    'Alpha samples on delivered image files, first intersections from inside the cave, correct side of the curved chamber. Curvature rendering and appearance verified separately in real Chrome.',
};
await writeFile(out, JSON.stringify(report, null, 2) + '\n');
assert.equal(report.totalRejected, 0, 'paint outside the interior walls');
console.log(JSON.stringify(report));
