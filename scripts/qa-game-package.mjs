// Native QA can select an exact portable build, including its bundled browser entry.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function qaGamePackage() {
  const packageRoot = process.env.QA_PACKAGE ? path.resolve(process.env.QA_PACKAGE) : undefined;
  if (!packageRoot)
    return { ...(await import('../dist/server.mjs')), packageRoot, packageId: null };
  const record = JSON.parse(await readFile(path.join(packageRoot, 'local-build.json'), 'utf8'));
  if (record.profile.environment !== 'local') throw new Error('Expected a local QA package');
  return {
    ...(await import(pathToFileURL(path.join(packageRoot, 'dist/server.mjs')).href)),
    packageRoot,
    packageId: record.buildId,
  };
}
