import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const dir = 'assets/violet-behemoth-quadruped';
const reference = 'assets/violet-behemoth/source/reference-v2.png';
const hash = (b) => createHash('sha256').update(b).digest('hex');
const original = JSON.parse(
  await readFile(
    'output/model-generation/models/violet-behemoth-quadruped/source/original/reference-v1.json',
    'utf8',
  ),
);
const record = {
  ...original,
  generator: 'Codex built-in image_gen.imagegen',
  referencedImages: [{ path: reference, sha256: hash(await readFile(reference)) }],
  output: {
    path: `${dir}/source/reference-v1.png`,
    sha256: hash(await readFile(`${dir}/source/reference-v1.png`)),
  },
  userAuthorization:
    'Create a horned four-legged version from image-to-3D and use it, retaining the current model unused.',
};
await writeFile(`${dir}/source/reference-v1.json`, JSON.stringify(record, null, 2) + '\n');
