// Isolate emitted modules from the running Online/LAN servers.
import { cp, mkdir, readdir, symlink, lstat, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const preview = path.join(root, 'output/jump/preview');
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
// Immutable assets/dependencies are shared, source and emitted modules are isolated.
for (const name of ['public', 'assets', 'node_modules']) {
  const destination = path.join(preview, name);
  if (!(await lstat(destination).catch(() => null)))
    await symlink(
      path.join(root, name),
      destination,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
}
execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: preview, stdio: 'inherit' });
console.log(preview);
