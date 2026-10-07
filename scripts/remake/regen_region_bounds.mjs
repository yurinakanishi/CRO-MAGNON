// Rewrite shared/region-feature-bounds.mts with re-measured footprints for remade region features, keeping the
// other entries as built. node scripts/remake/regen_region_bounds.mjs <key>=<footprint.json> [...]
// (footprints from scripts/measure-region-feature.mjs <key> c2-<rev> <delivered glb>; run node scripts/build.mjs first)
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const { REGION_FEATURE_BOUNDS } = await import(
  'file:///' + path.join(root, 'dist/shared/region-feature-bounds.mjs').replace(/\\/g, '/')
);
const result = JSON.parse(JSON.stringify(REGION_FEATURE_BOUNDS));
for (const arg of process.argv.slice(2)) {
  const [key, file] = arg.split('=');
  const record = JSON.parse(await readFile(path.resolve(root, file), 'utf8'));
  if (record.key !== key) throw new Error(`${file} is not ${key}`);
  if (record.verification.misses !== 0) throw new Error(`${key}: footprint misses surface samples`);
  result[key] = record;
}
const target = path.join(root, 'shared/region-feature-bounds.mts');
await writeFile(
  target,
  '// Exact accepted GLB triangle footprints; measured by scripts/measure-region-feature.mjs.\n' +
    `export const REGION_FEATURE_BOUNDS = Object.freeze(${JSON.stringify(result, null, 2)});\n`,
);
execFileSync(process.execPath, [path.join(root, 'node_modules/prettier/bin/prettier.cjs'), '--write', target], { cwd: root });
console.log(Object.entries(result).map(([k, v]) => `${k} ${v.revision} ${v.sha256.slice(0, 12)} boxes ${v.boxes.length}`).join('\n'));
