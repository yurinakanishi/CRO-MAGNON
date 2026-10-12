// Adopt a reviewed remade playable character (a new model, not a revision of the served one) as the
// character's new source model (scripts/source-model-revision.mjs), the way adopt-lowpoly-head.mjs
// adopts a head revision: the runtime-adoption graph's startup file stays superseded by a hash-bound,
// accepted revision record; the earlier optimization's files and plan stay as they are.
//
//   node scripts/remake/adopt_candidate_character.mjs --key cro-magnon-woman --revision c3-r03 \
//     --glb <final model.glb> --asset <final asset.json> --record <candidate.json> \
//     --approved "<who accepted the review, when and where>" [--sheet <image>]... [--date 2026-10-12]
//
// Writes public/models/<key>/model-<revision>.glb (never replacing a file), the archived manifest, the
// review (with the production hashes of the git-ignored candidate workspace), the review images and the
// source-revision record under assets/<key>/, and the manifest. Run only after the user accepted the review.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

const root = path.resolve(import.meta.dirname, '../..');
const { values: args } = parseArgs({
  options: {
    key: { type: 'string' },
    revision: { type: 'string' },
    glb: { type: 'string' },
    asset: { type: 'string' },
    record: { type: 'string' },
    approved: { type: 'string' },
    sheet: { type: 'string', multiple: true, default: [] },
    source: { type: 'string', multiple: true, default: [] },
    date: { type: 'string', default: new Date().toISOString().slice(0, 10) },
    'dry-run': { type: 'boolean', default: false },
  },
});
for (const name of ['key', 'revision', 'glb', 'asset', 'record', 'approved'])
  if (!args[name]) throw new Error(`--${name} is required`);
const { key, revision, date } = args;
const dry = args['dry-run'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const read = (file) => readFile(path.isAbsolute(file) ? file : path.join(root, file));
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
const glbDoc = (bytes) => JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));

const candidate = await read(args.glb);
const doc = glbDoc(candidate);
const triangles = doc.meshes
  .flatMap((m) => m.primitives)
  .reduce((s, p) => s + doc.accessors[p.indices].count / 3, 0);
const built = JSON.parse(await read(args.asset));
const recordBytes = await read(args.record);
const record = JSON.parse(recordBytes);
if (record.final?.glb?.sha256 !== sha256(candidate))
  throw new Error('the candidate record does not describe this GLB');

// The manifest must still serve the accepted source revision the candidate replaces.
const manifestFile = `public/models/${key}/asset.json`;
const manifestText = (await read(manifestFile)).toString();
const manifest = JSON.parse(manifestText);
if (!manifest.sourceRevision)
  throw new Error(`${manifestFile} has no accepted source revision to follow`);
const currentProofBytes = await read(manifest.sourceRevision.record);
if (sha256(currentProofBytes) !== manifest.sourceRevision.sha256)
  throw new Error('current source-revision record changed');
const currentProof = JSON.parse(currentProofBytes);

// 1. The new GLB under a new name.
const url = `/models/${key}/model-${revision}.glb`;
await place(`public${url}`, candidate);
const file = { url, sha256: sha256(candidate), bytes: candidate.length };

// 2. The archived manifest and the review images.
const archive = `assets/${key}/archive-manifest-${manifest.revision}-${date.replaceAll('-', '')}.json`;
await place(archive, Buffer.from(manifestText));
const qa = `assets/${key}/qa/${revision}`;
const sheets = [];
for (const sheet of args.sheet) {
  const bytes = await read(sheet);
  const to = `${qa}/${path.basename(sheet)}`;
  await place(to, bytes);
  sheets.push({ path: to, source: sheet, sha256: sha256(bytes) });
}

// The chosen reference and its prompts (provenance kept in git, as assets/face-remake/<key>/source/ before).
const workspace = path
  .relative(root, path.resolve(root, args.record, '../../..'))
  .split(path.sep)
  .join('/');
const sources = [];
for (const source of args.source) {
  const bytes = await read(source);
  const to = `assets/${key}/source/${revision}/${path.basename(source)}`;
  await place(to, bytes);
  sources.push({ path: to, source, sha256: sha256(bytes) });
}

// 3. The review (production hashes copied from the git-ignored candidate workspace) and the proof.
const review = {
  schema: 'cro-magnon/character-remake-review@1',
  date,
  decision: 'adopt',
  approved: args.approved,
  modelKey: key,
  revision,
  candidate: record.candidate,
  url,
  sha256: file.sha256,
  bytes: file.bytes,
  triangles,
  bones: doc.skins?.[0]?.joints.length ?? 0,
  clips: doc.animations.map((a) => a.name),
  heightMetres: built.heightMetres,
  request: record.request,
  workspace,
  sources,
  candidateRecord: {
    path: path.relative(root, path.resolve(root, args.record)).split(path.sep).join('/'),
    sha256: sha256(recordBytes),
  },
  production: {
    reference: record.reference,
    conditioning: record.conditioning,
    referenceMatte: record.referenceMatte,
    trellis: record.trellis,
    eyeSockets: record.eyeSockets,
    reduction: record.reduction,
    face: record.face,
    merged: record.merged,
    rig: record.rig,
    motion: record.final?.motion,
  },
  qa: record.qa,
  sheets,
  previous: {
    url: manifest.url,
    sha256: manifest.sha256,
    bytes: manifest.bytes,
    triangles: manifest.triangles,
    revision: manifest.revision,
    manifest: archive,
  },
  provenance: {
    provider:
      'Claude Code (Opus 5.5); Codex built-in image_gen references; local TRELLIS-2 reconstruction',
    claudeUsed: true,
    geometrySource:
      'TRELLIS-2 reconstruction of the chosen generated reference (meshopt reduction, xatlas atlases, Blender bakes; eye sockets closed in the dense surface)',
  },
};
const reviewFile = `assets/${key}/qa/${revision}.json`;
const reviewBytes = Buffer.from(json(review));
await place(reviewFile, reviewBytes);
const proof = {
  schema: 'cro-magnon/source-model-revision@1',
  modelKey: key,
  decision: 'adopt',
  // The active runtime-adoption graph still names the startup file the first accepted revision replaced.
  previous: currentProof.previous,
  files: [file],
  review: { path: reviewFile, sha256: sha256(reviewBytes) },
};
const proofFile = `assets/${key}/qa/source-revision-${revision}.json`;
const proofBytes = Buffer.from(json(proof));
await place(proofFile, proofBytes);

// 4. The manifest: identity and gameplay data of the new model; the old model's history stays in the archive.
const keep = [
  'modelKey',
  'name',
  'kind',
  'upAxis',
  'forwardAxis',
  'widthMetres',
  'placement',
  'gender',
  'species',
];
const next = {
  ...Object.fromEntries(keep.filter((k) => manifest[k] !== undefined).map((k) => [k, manifest[k]])),
  candidate: record.candidate,
  status: `remake-candidate-${record.candidate}-adopted`,
  revision,
  url,
  sha256: file.sha256,
  bytes: file.bytes,
  triangles,
  heightMetres: built.heightMetres,
  clips: built.clips,
  lods: [],
  bones: review.bones,
  locomotion: built.locomotion,
  humanLocomotion: built.humanLocomotion,
  spearThrust: { ...built.spearThrust, status: 'adopted' },
  downedMotion: built.downedMotion,
  notes: [
    `Candidate ${record.candidate} (${date}): a new stylized low-poly design from a generated reference (${record.reference?.chosen}), reconstructed with TRELLIS-2 and reduced to ${triangles} triangles (body and head in separate 1024 atlases, the face painted from the reference), rigged with the 22-bone humanoid skeleton and all ${review.clips.length} clips. Review: ${reviewFile}.`,
  ],
  provenance: {
    provider: review.provenance.provider,
    claudeUsed: true,
    referenceGenerator: 'Codex built-in image_gen',
    referenceImage: sources.find((s) => /\.png$/.test(s.path))?.path ?? null,
    referenceSha256: sources.find((s) => /\.png$/.test(s.path))?.sha256 ?? null,
    reconstruction: record.trellis?.settings ?? null,
    review: reviewFile,
    previousManifest: archive,
  },
  sourceRevision: { record: proofFile, sha256: sha256(proofBytes) },
};
await write(manifestFile, json(next));
console.log(
  `${key}: ${manifest.url} -> ${url} (${file.bytes} B, ${manifest.triangles} -> ${triangles} triangles)`,
);
