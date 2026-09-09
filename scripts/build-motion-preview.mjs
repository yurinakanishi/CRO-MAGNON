import {
  cp,
  mkdir,
  readdir,
  symlink,
  lstat,
  copyFile,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { MOTION_KEYS } from './motion-glb.mjs';
const root = path.resolve(import.meta.dirname, '..'),
  preview = path.join(root, 'output/creature-motion/preview'),
  revision = process.argv[2] || 'revision-04';
await mkdir(preview, { recursive: true });
for (const name of [
  'src',
  'shared',
  'application',
  'infrastructure',
  'cloudflare',
  'scripts',
  'tests',
])
  await cp(path.join(root, name), path.join(preview, name), { recursive: true });
for (const name of await readdir(root))
  if (/^(tsconfig.*\.json|package.*\.json|server\.m(?:t|j)s|exhibition\.env|.*\.md)$/.test(name))
    await copyFile(path.join(root, name), path.join(preview, name));
async function link(source, dest) {
  if (!(await lstat(dest).catch(() => null)))
    await symlink(source, dest, process.platform === 'win32' ? 'junction' : 'dir');
}
for (const name of ['assets', 'node_modules'])
  await link(path.join(root, name), path.join(preview, name));
await mkdir(path.join(preview, 'public/models'), { recursive: true });
for (const ent of await readdir(path.join(root, 'public'), { withFileTypes: true }))
  if (ent.name !== 'models') {
    const source = path.join(root, 'public', ent.name),
      dest = path.join(preview, 'public', ent.name);
    if (ent.isDirectory()) await link(source, dest);
    else await copyFile(source, dest);
  }
for (const ent of await readdir(path.join(root, 'public/models'), { withFileTypes: true })) {
  const source = path.join(root, 'public/models', ent.name),
    dest = path.join(preview, 'public/models', ent.name);
  if (ent.isDirectory()) {
    if (MOTION_KEYS.includes(ent.name))
      await cp(path.join(root, 'output/creature-motion', revision, ent.name), dest, {
        recursive: true,
      });
    else await link(source, dest);
  } else await copyFile(source, dest);
}
const catalog = JSON.parse(
  await readFile(path.join(preview, 'public/models/world-assets.json'), 'utf8'),
);
for (let i = 0; i < catalog.assets.length; i++)
  if (MOTION_KEYS.includes(catalog.assets[i].modelKey))
    catalog.assets[i] = JSON.parse(
      await readFile(
        path.join(preview, 'public/models', catalog.assets[i].modelKey, 'asset.json'),
        'utf8',
      ),
    );
await writeFile(
  path.join(preview, 'public/models/world-assets.json'),
  JSON.stringify(catalog, null, 2) + '\n',
);
execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: preview, stdio: 'inherit' });
console.log(preview);
