// Local adoption of the reviewed source-derived props; existing assets are retained.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base = 'assets/coastal-craft/models',
  catalogPath = 'public/models/world-assets.json';
const catalog = JSON.parse(await readFile(catalogPath, 'utf8')),
  production = JSON.parse(await readFile('assets/world-models.json', 'utf8'));
const specs = [
  ['cockle-shell', '浜の貝', '02', 'static', 0.118, 0.16],
  ['shell-midden', '貝塚', '01', 'static', 0.392, 1.5],
  ['wooden-spear', '木槍', '02', 'equipment', 1.613626, 0.081],
  ['obsidian-spear', '黒曜石の槍', '01', 'equipment', 2.099005, 0.14],
  ['obsidian-blade', '黒曜石の刃', '01', 'static', 0.290929, 0.14],
];
const adopted = [];
for (const [key, name, revision, kind, heightMetres, widthMetres] of specs) {
  const candidateFile = `${base}/${key}/work/revision-${revision}/candidate.glb`,
    b = await readFile(candidateFile),
    sha256 = createHash('sha256').update(b).digest('hex');
  const g = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)));
  const triangles = g.meshes.reduce(
    (sum, m) =>
      sum +
      m.primitives.reduce(
        (n, p) =>
          n +
          (p.indices !== undefined
            ? g.accessors[p.indices].count
            : g.accessors[p.attributes.POSITION].count) /
            3,
        0,
      ),
    0,
  );
  const generated = key === 'cockle-shell' || key === 'shell-midden';
  const record = {
    modelKey: key,
    name,
    kind,
    candidate: 1,
    status: 'reviewed-prototype',
    url: `/models/${key}/model.glb`,
    sha256,
    bytes: b.length,
    triangles,
    upAxis: 'Y',
    forwardAxis: '+Z',
    heightMetres,
    widthMetres,
    onDemand: true,
    ...(kind === 'static' ? { environment: true } : {}),
    placement: {
      pivot:
        kind === 'equipment' ? 'grip' : key === 'obsidian-blade' ? 'blade-base' : 'ground-centred',
      ...(kind === 'equipment' ? { gripNode: 'Grip.R', shaftAxis: '+Y' } : {}),
    },
    clips: [],
    lods: [],
    provenance: {
      provider: 'Codex',
      claudeUsed: false,
      referenceGenerator: generated
        ? 'Built-in imagegen'
        : 'Existing imagegen → TRELLIS flint-spear lineage',
      referenceImage: generated
        ? `${base}/${key}/source/reference-v1.png`
        : 'Retained public/models/flint-spear/model.glb (historical reference recorded in its asset.json)',
      reconstruction: generated
        ? 'Local TRELLIS-2, resolution 1024, seed 42'
        : 'Source-derived variant of the retained flint-spear GLB',
      candidateFile,
      visualReview: generated
        ? `${base}/${key}/qa/adoption-review.json`
        : 'assets/coastal-craft/weapon-qa/adoption-review.json',
    },
  };
  await mkdir(`public/models/${key}`, { recursive: true });
  await copyFile(candidateFile, `public/models/${key}/model.glb`);
  await writeFile(`public/models/${key}/asset.json`, JSON.stringify(record, null, 2) + '\n');
  await mkdir(`${base}/${key}/geometry`, { recursive: true });
  await copyFile(candidateFile, `${base}/${key}/geometry/accepted.glb`);
  await writeFile(
    `${base}/${key}/model.json`,
    JSON.stringify(
      {
        key,
        name,
        candidate: 1,
        adoptedRevision: revision,
        generation: 'complete',
        adoption: 'reviewed-local',
        gameIntegration: 'pending',
        candidateFile,
        sha256,
        triangles,
        bytes: b.length,
        provenance: record.provenance,
      },
      null,
      2,
    ) + '\n',
  );
  const existing = catalog.assets.findIndex((a) => a.modelKey === key);
  if (existing >= 0) catalog.assets[existing] = record;
  else catalog.assets.push(record);
  const entry = {
    key,
    name,
    kind,
    height: heightMetres,
    status: 'reviewed-local-game-qa-pending',
    sha256,
    delivery: record.url,
    modelWorkspace: `${base}/${key}`,
  };
  const old = production.assets.findIndex((a) => a.key === key);
  if (old >= 0) production.assets[old] = entry;
  else production.assets.push(entry);
  adopted.push({ key, revision, sha256, triangles, bytes: b.length });
}
await writeFile(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
await writeFile('assets/world-models.json', JSON.stringify(production, null, 2) + '\n');
await writeFile(
  'assets/coastal-craft/adoption.json',
  JSON.stringify(
    {
      at: new Date().toISOString(),
      existingGLBs: 'retained unchanged',
      newReferenceReconstructions: 2,
      sourceDerivedEquipmentVariants: 3,
      adopted,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify(adopted));
