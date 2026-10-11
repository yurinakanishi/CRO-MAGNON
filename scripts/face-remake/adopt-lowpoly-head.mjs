// Adopt a reviewed low-poly head revision (lowpoly-heads.mjs) as each character's new source
// model (scripts/source-model-revision.mjs): the runtime-adoption graph's startup file is
// superseded by a hash-bound, accepted revision record; the earlier optimization's files and plan
// stay as they are. Run only after the face review was accepted.
//
//   node scripts/face-remake/adopt-lowpoly-head.mjs --revision r08 --reproduced r09 \
//     --approved "<who accepted the review, when and where>" [--keys cro-magnon-woman,...]
//
// Writes public/models/<key>/model-face-lp-<revision>.glb (never replacing a file), the archived
// manifest, the review and the source-revision record under assets/<key>/, the comparison images
// the user reviewed under assets/face-remake/lowpoly-head-<revision>/review/, and the manifest.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

const root = path.resolve(import.meta.dirname, '../..');
const { values: args } = parseArgs({
  options: {
    revision: { type: 'string' },
    reproduced: { type: 'string' },
    approved: { type: 'string' },
    keys: { type: 'string', default: '' },
    date: { type: 'string', default: new Date().toISOString().slice(0, 10) },
    'dry-run': { type: 'boolean', default: false },
  },
});
for (const name of ['revision', 'reproduced', 'approved'])
  if (!args[name]) throw new Error(`--${name} is required`);
const { revision, date } = args;
const dry = args['dry-run'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const read = (file) => readFile(path.join(root, file));
const write = async (file, bytes) => {
  if (dry) return console.log(`(dry run) would write ${file}`);
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), bytes);
};
// A file that already exists is accepted only with the same bytes.
const place = async (file, bytes) => {
  try {
    if (sha256(await read(file)) !== sha256(bytes))
      throw new Error(`${file} exists with other bytes`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await write(file, bytes);
  }
};
const glbTriangles = (bytes) => {
  const doc = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  return doc.meshes
    .flatMap((m) => m.primitives)
    .reduce((s, p) => s + doc.accessors[p.indices].count / 3, 0);
};
const files = (records) =>
  records.map(({ url, sha256: hash, bytes }) => ({ url, sha256: hash, bytes }));

const summary = JSON.parse(await read(`output/head-lowpoly/summary-${revision}.json`));
const again = JSON.parse(await read(`output/head-lowpoly/summary-${args.reproduced}.json`));
const tools = {
  node: process.version,
  blender: (
    await read(`output/head-lowpoly/${Object.keys(summary.heads)[0]}/${revision}/blender.log`)
  )
    .toString()
    .match(/^Blender [^\n]+/m)?.[0],
  meshoptimizer: JSON.parse(await read('node_modules/meshoptimizer/package.json')).version,
  sharp: JSON.parse(await read('node_modules/sharp/package.json')).version,
};
const scripts = {};
for (const name of [
  'lowpoly-heads.mjs',
  'lowpoly-head.mjs',
  'bake-head.py',
  'assemble-head.mjs',
  'qa-lowpoly-head.mjs',
])
  scripts[`scripts/face-remake/${name}`] = sha256(await read(`scripts/face-remake/${name}`));

// The comparison images the user accepted (all three characters, current beside candidate).
const userReview = [];
for (const name of ['faces-close.jpg', 'faces-albedo.jpg', 'poses-body.jpg']) {
  const bytes = await read(`output/head-lowpoly/review-${revision}/${name}`);
  const to = `assets/face-remake/lowpoly-head-${revision}/review/${name}`;
  await place(to, bytes);
  userReview.push({ path: to, sha256: sha256(bytes) });
}

const keys = args.keys ? args.keys.split(',') : Object.keys(summary.heads);
for (const key of keys) {
  const head = summary.heads[key];
  if (!head) throw new Error(`summary-${revision}.json has no ${key}`);
  const candidate = await read(head.candidate.file);
  if (sha256(candidate) !== head.candidate.sha256)
    throw new Error(`${key}: the candidate changed after its review`);
  if (again.heads[key]?.candidate.sha256 !== head.candidate.sha256)
    throw new Error(`${key}: ${args.reproduced} did not reproduce ${revision}`);
  if (
    head.browserErrors !== 0 ||
    head.seam.worstMetres !== 0 ||
    head.seam.normalDegrees > head.seam.adoptedNormalDegrees + 0.01
  )
    throw new Error(`${key}: the candidate failed its checks`);

  // The manifest must still serve the master the candidate was made from.
  const manifestFile = `public/models/${key}/asset.json`;
  const manifestText = (await read(manifestFile)).toString();
  const manifest = JSON.parse(manifestText);
  if (manifest.url !== head.master.url || manifest.sha256 !== head.master.sha256)
    throw new Error(`${manifestFile} no longer serves ${head.master.url}`);
  const adoption = manifest.runtimeOptimization?.adoption;
  const plan = JSON.parse(await read(`assets/runtime-adoption/${adoption}/plan.json`));
  const entry = plan.graph.models[key];
  if (entry?.primary.url !== manifest.url)
    throw new Error(`${adoption} does not serve ${manifest.url} for ${key}`);

  // 1. The new GLB under a new name.
  const url = `/models/${key}/model-face-lp-${revision}.glb`;
  await place(`public${url}`, candidate);
  const record = { url, sha256: head.candidate.sha256, bytes: candidate.length };

  // 2. The archived manifest, the review sheets and report, the review and the source revision.
  const archive = `assets/${key}/archive-manifest-${adoption}-${date.replaceAll('-', '')}.json`;
  await place(archive, Buffer.from(manifestText));
  const qa = `assets/${key}/qa/lowpoly-head-${revision}`;
  const sheets = [];
  for (const sheet of [
    ...head.sheets,
    { path: `${path.dirname(head.sheets[0].path)}/report.json` },
  ]) {
    const bytes = await read(sheet.path);
    if (sheet.sha256 && sha256(bytes) !== sheet.sha256)
      throw new Error(`${sheet.path} changed after its review`);
    const to = `${qa}/${path.basename(sheet.path)}`;
    await place(to, bytes);
    sheets.push({ path: to, sha256: sha256(bytes) });
  }
  const work = path.dirname(head.candidate.file);
  const intermediates = {};
  for (const name of [
    'geometry.json',
    'high.obj',
    'high-albedo.png',
    'low.obj',
    'face-faces.json',
    'low-regions.json',
    'low-uv.json',
    'low-albedo.png',
    `${path.basename(head.candidate.file)}.json`,
  ])
    intermediates[`${work}/${name}`] = sha256(await read(`${work}/${name}`));
  const triangles = glbTriangles(candidate);
  const review = {
    schema: 'cro-magnon/lowpoly-head-review@1',
    date,
    decision: 'adopt',
    approved: args.approved,
    modelKey: key,
    revision: `lowpoly-head-${revision}`,
    url,
    sha256: record.sha256,
    bytes: record.bytes,
    triangles,
    reproducedBy: { revision: args.reproduced, sha256: again.heads[key].candidate.sha256 },
    master: head.master,
    textureSource: head.textureSource,
    head: { before: head.candidate.headBefore, after: head.candidate.head },
    method:
      'The adopted face-remake head, welded by position (coincident double layers dropped), crack-repaired and turned outward, simplified by region (hair, other skin, face) with the neck seam band locked, and wound consistently per connected surface. A new UV layout (the face one conformal chart; every fold or overlap cut out and re-projected until no bake texel is shared; face islands at twice the texel density of the rest) and its albedo baked in Blender 3.6 from the 2048 face-remake texture, delivered at 1024. Every kept vertex keeps its adopted position, joints and weights. Body primitives, skin, inverse binds, nodes and every clip are unchanged (assemble-head.mjs).',
    landmarks: head.landmarks,
    options: head.options,
    bake: summary.bake,
    passes: head.passes,
    orientation: head.orientation,
    neckSeam: { ...head.neckSeam, ...head.seam },
    psnr: head.psnr,
    sheets,
    userReview,
    production: { folder: work, intermediates, scripts, tools },
    provenance: {
      provider: 'Claude Code (Opus 5.5)',
      claudeUsed: true,
      geometrySource:
        'TRELLIS-2 face-remake head of the adopted model (faceRemake in the archived manifest)',
    },
    limits:
      'Face review in Chrome (ANGLE D3D11) with the game Three.js at 0.55 m, 1.3 m and 3.2 m, the bind pose and four clips; not on a physical phone. The hair is simplified within about 5-6 mm and is slightly more faceted at close range. Seen from below the chin, the light band of the face-remake neck join (present in the adopted model too) has a slightly more jagged edge.',
  };
  const reviewFile = `assets/${key}/qa/lowpoly-head-${revision}.json`;
  const reviewBytes = Buffer.from(json(review));
  await place(reviewFile, reviewBytes);
  const proof = {
    schema: 'cro-magnon/source-model-revision@1',
    modelKey: key,
    decision: 'adopt',
    previous: {
      adoption,
      files: files([entry.primary, ...entry.lods]),
      manifest: archive,
      manifestSha256: sha256(Buffer.from(manifestText)),
    },
    files: [record],
    review: { path: reviewFile, sha256: sha256(reviewBytes) },
  };
  const proofFile = `assets/${key}/qa/source-revision-lowpoly-head-${revision}.json`;
  const proofBytes = Buffer.from(json(proof));
  await place(proofFile, proofBytes);

  // 3. The manifest serves the new source revision; the optimization stamp stays in the archive.
  const { runtimeOptimization, ...kept } = manifest;
  const next = {
    ...kept,
    revision: `face-lp-${revision}`,
    url,
    sha256: record.sha256,
    bytes: record.bytes,
    triangles,
    notes: [
      ...(manifest.notes ?? []),
      `Low-poly head ${revision}: the face-remake head ${head.candidate.headBefore.headTriangles} -> ${head.candidate.head.triangles} triangles (face within 0.8 mm, other skin 2 mm, hair about 5-6 mm), new UVs and a 1024 albedo baked from the 2048 face-remake texture; kept vertices keep their positions and weights; body, rig and clips unchanged. ${manifest.triangles} -> ${triangles} triangles.`,
    ],
    lowpolyHead: {
      revision: `lowpoly-head-${revision}`,
      review: reviewFile,
      headTriangles: {
        before: head.candidate.headBefore.headTriangles,
        after: head.candidate.head.triangles,
      },
      previous: {
        url: manifest.url,
        sha256: manifest.sha256,
        bytes: manifest.bytes,
        triangles: manifest.triangles,
        adoption: runtimeOptimization.adoption,
        manifest: archive,
      },
    },
    sourceRevision: { record: proofFile, sha256: sha256(proofBytes) },
  };
  await write(manifestFile, json(next));
  console.log(
    `${key}: ${manifest.url} -> ${url} (${record.bytes} B, ${manifest.triangles} -> ${triangles} triangles)`,
  );
}
