import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export function buildId(files) {
  return createHash('sha256').update(JSON.stringify(files)).digest('hex');
}
export async function verifyExhibition(root) {
  const manifest = JSON.parse(await readFile(path.join(root, 'exhibition-build.json'), 'utf8'));
  if (buildId(manifest.files) !== manifest.buildId)
    throw new Error('Invalid exhibition manifest. Recopy the build.');
  for (const file of manifest.files) {
    const target = path.resolve(root, file.path);
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
      throw new Error('Invalid manifest path.');
    if ((await sha256(target)) !== file.sha256)
      throw new Error(
        `Build file changed or missing: ${file.path}. Recopy the same build to both PCs.`,
      );
  }
  return manifest;
}
