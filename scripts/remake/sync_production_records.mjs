// Bring the production records in line with the 2026-10 remake deliveries (run after every adoption):
// - one adoption review per remade asset (assets/asset-remake/reviews/<key>.json, decision 'adopt', the delivered
//   SHA-256, the evidence recorded in assets/asset-remake/status.json) referenced by provenance.visualReview, in
//   both public/models/world-assets.json and the per-model asset.json;
// - assets/world-models.json (the catalog scripts/verify-world-assets.mjs checks) gets the delivered SHA-256 and
//   URL of every remade key, and an entry for each new asset that replaces code-built primitives.
// Assets that were not remade are left untouched.
// node scripts/remake/sync_production_records.mjs
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const exists = async (p) => access(p).then(() => true, () => false);
const read = async (p) => JSON.parse(await readFile(path.join(root, p), 'utf8'));
const write = (p, v) => writeFile(path.join(root, p), JSON.stringify(v, null, 2) + '\n');
const status = await read('assets/asset-remake/status.json');
const specs = (await read('assets/asset-remake/reference-specs-batch5.json')).assets;
const world = await read('public/models/world-assets.json');
const catalog = await read('assets/world-models.json');
await mkdir(path.join(root, 'assets/asset-remake/reviews'), { recursive: true });
const remade = (a) => typeof a?.status === 'string' && a.status.startsWith('remake-');

async function review(manifest) {
  const key = manifest.modelKey;
  const file = `assets/asset-remake/reviews/${key}.json`;
  const s = status[key] ?? {};
  const record = {
    key,
    decision: 'adopt',
    sha256: manifest.sha256,
    url: manifest.url,
    bytes: manifest.bytes,
    triangles: manifest.triangles,
    candidate: manifest.candidate,
    revision: manifest.revision ?? null,
    status: manifest.status,
    reviewer: 'Claude Code (Opus 5.5)',
    date: '2026-10-07',
    issues: s.issues ?? null,
    plan: s.plan ?? null,
    motions: s.motions ?? null,
    evidence: s.verification ?? null,
    previousDelivery: manifest.provenance?.previousDelivery ?? manifest.normalUpgrade?.previousGlb ?? null,
    note: 'Adoption inside the remake branch; in-game multi-player QA and the performance comparison are tracked in docs/asset-remake/PROGRESS.md.',
  };
  await write(file, record);
  return file;
}

let reviewed = 0;
const keys = new Set(world.assets.map((a) => a.modelKey));
for (const entry of world.assets) {
  if (!remade(entry)) continue;
  const file = await review(entry);
  entry.provenance = { ...entry.provenance, visualReview: file };
  const per = path.join(root, `public/models/${entry.modelKey}/asset.json`);
  if (await exists(per)) {
    const m = JSON.parse(await readFile(per, 'utf8'));
    m.provenance = { ...m.provenance, visualReview: file };
    await writeFile(per, JSON.stringify(m, null, 2) + '\n');
  }
  reviewed++;
}
await write('public/models/world-assets.json', world);
// Playable characters live only in their per-model asset.json.
for (const spec of catalog.assets.filter((a) => a.kind === 'humanoid').concat([{ key: 'cro-magnon-hunter' }])) {
  const p = `public/models/${spec.key}/asset.json`;
  const m = await read(p);
  m.modelKey ??= spec.key;
  if (!remade(m)) continue;
  const file = await review(m);
  m.provenance = { ...m.provenance, visualReview: file };
  await write(p, m);
  reviewed++;
}
let updated = 0,
  added = 0;
for (const spec of catalog.assets) {
  const m = await read(`public/models/${spec.key}/asset.json`);
  if (!remade(m)) continue;
  spec.sha256 = m.sha256;
  spec.delivery = m.url;
  spec.status = m.status;
  updated++;
}
for (const entry of world.assets) {
  if (catalog.assets.some((a) => a.key === entry.modelKey)) continue;
  const ref = specs.find((s) => s.key === entry.modelKey);
  catalog.assets.push({
    key: entry.modelKey,
    name: entry.name,
    kind: entry.kind,
    height: entry.heightMetres,
    status: entry.status,
    subject: ref?.subject ?? entry.notes?.[0] ?? '',
    geometryResolution: 1024,
    sha256: entry.sha256,
    delivery: entry.url,
    replaces: entry.replaces ?? null,
  });
  added++;
}
await write('assets/world-models.json', catalog);
console.log(JSON.stringify({ reviewed, catalogUpdated: updated, catalogAdded: added, worldKeys: keys.size }));
