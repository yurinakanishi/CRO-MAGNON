// Archive the 2D mural revision beside the Rimo model's preserved source history.
// No 3D candidate is generated, replaced or promoted by this script.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const destination = path.resolve(root, '../threed-model-creation/models/rimo-neko/wall-mural/r30');
const hash = (b) => createHash('sha256').update(b).digest('hex');
const qa = JSON.parse(await readFile(path.join(root, 'output/cave-rimo-r30/game-review.json')));
const sources = [
  'assets/rimo-neko/source/user-reference.jpg',
  'assets/camp-cave/source/mural-atlas-r05.png',
  'assets/camp-cave/source/rimo-lascaux-frieze-r30.png',
  'assets/camp-cave/rimo-lascaux-prompt-r30.txt',
  'assets/camp-cave/rimo-frieze-request-r30.json',
  'assets/camp-cave/qa/gallery-r30.json',
  'assets/camp-cave/qa/gallery-surfaces-r30.json',
  'assets/camp-cave/qa/gallery-pigment-coverage-r30.json',
  'assets/camp-cave/qa/rimo-r30-in-game.png',
  'assets/camp-cave/README.md',
  'assets/camp-cave/workflow/game-review-r30.js',
  'assets/camp-cave/workflow/measure-gallery-pigment.py',
  'assets/camp-cave/workflow/archive-r30.mjs',
  'docs/rimo-cave-mural-2026-10-02.md',
  'public/models/camp-cave/asset.json',
  'public/models/camp-cave/model-r26.glb',
  'src/cave-materials.ts',
  'src/cave-gallery-layout.ts',
  'src/world-landmarks.ts',
  'scripts/adopt-cave-rimo-frieze.mjs',
  'scripts/measure-cave-gallery.mjs',
  'scripts/qa-cave-rimo-r30.mjs',
  'scripts/verify-cave-gallery.mjs',
  'tests/cave-rimo-mural.test.mjs',
  'tests/camp-surface-continuity.test.mjs',
  'output/cave-rimo-r30/game-review.json',
  'output/cave-rimo-r30/captures.json',
  'output/cave-rimo-r30/tests-final.log',
  'output/cave-rimo-r30/public-build.log',
  'output/cave-rimo-r30/build-image-verification.json',
  ...qa.samples.map((s) => s.file),
];
const records = [];
for (const relative of new Set(sources)) {
  const source = path.resolve(root, relative),
    target = path.resolve(destination, relative);
  if (!source.startsWith(root) || !target.startsWith(destination + path.sep))
    throw new Error('Archive path escaped its root');
  const bytes = await readFile(source),
    sha256 = hash(bytes);
  await mkdir(path.dirname(target), { recursive: true });
  try {
    if (hash(await readFile(target)) !== sha256)
      throw new Error(`Refusing to overwrite archive: ${relative}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await copyFile(source, target);
  }
  if (hash(await readFile(target)) !== sha256) throw new Error(`Archive mismatch: ${relative}`);
  records.push({ path: relative, bytes: bytes.length, sha256 });
}
const receipt = {
  date: new Date().toISOString(),
  destination,
  kind: '2D cave mural r30; 3D candidates unchanged',
  count: records.length,
  bytes: records.reduce((n, r) => n + r.bytes, 0),
  records,
};
await writeFile(path.join(destination, 'archive.json'), JSON.stringify(receipt, null, 2) + '\n');
await writeFile(
  path.join(root, 'assets/camp-cave/archive-mural-r30.json'),
  JSON.stringify(receipt, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    destination,
    count: receipt.count,
    bytes: receipt.bytes,
    allHashesMatched: true,
  }),
);
