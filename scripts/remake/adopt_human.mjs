// Adopt a remade human (head-grafted body, rig_human_c2 + spear/Downed/locomotion builders) into the delivery.
// node scripts/remake/adopt_human.mjs <key> <stageDir> <rigRev> <bodyRef> <bodyDense> <headRef> <headDense> "<note>"
// stageDir = output/asset-remake/motion/<key>-<rigRev> (from human_chain.sh). Writes output/asset-remake/adopt-<key>.json
// and runs adopt_world_asset.mjs (the previous delivery is restored from HEAD first by unadopt_world_asset.mjs).
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const [key, stage, rev, bodyRef, bodyDense, headRef, headDense, note] = process.argv.slice(2);
const root = path.resolve(import.meta.dirname, '../..');
const H = `C:/Users/yurin/Desktop/projects/CRO-MAGNON/output/model-generation/models/${key}`;
const loco = path.join(root, stage, 'loco/r1', key);
const asset = JSON.parse(await readFile(path.join(loco, 'asset.json'), 'utf8'));
const rig = JSON.parse(await readFile(`${H}/work/candidate-02/rig/${rev}/rig-report.json`, 'utf8'));
const spec = {
  key,
  candidate: 2,
  revision: `c2-${rev}`,
  glb: path.join(loco, 'model.glb'),
  lods: [{ glb: path.join(root, stage, 'lod-performance.glb'), distanceMetres: 28, purpose: 'animated-medium-lod-geometry' }],
  reference: bodyRef,
  dense: bodyDense,
  processReport: `output/model-generation/models/${key}/work/candidate-02/graft`,
  rigReport: `output/model-generation/models/${key}/work/candidate-02/rig/${rev}/rig-report.json`,
  heightMetres: asset.heightMetres,
  clips: asset.clips,
  extra: {
    bones: rig.bones?.length ?? 22,
    locomotion: asset.locomotion,
    ...(asset.spearThrust ? { spearThrust: asset.spearThrust } : {}),
    downedMotion: asset.downedMotion,
    humanLocomotion: asset.humanLocomotion,
    headGraft: {
      reference: headRef,
      dense: headDense,
      method: 'Separate TRELLIS head reconstruction placed by similarity ICP on the body crown (scripts/remake/align_head.py), reduced with meshoptimizer, xatlas charts, albedo/normal baked; body cut at the neck; joined with a skin-tone gain (scripts/remake/merge_head.py); merged surface rescaled to the delivered height before rigging.',
    },
  },
  notes: [note],
};
await writeFile(path.join(root, `output/asset-remake/adopt-${key}.json`), JSON.stringify(spec, null, 1));
execFileSync('node', ['scripts/remake/unadopt_world_asset.mjs', key], { cwd: root, stdio: 'ignore' });
const out = execFileSync('node', ['scripts/remake/adopt_world_asset.mjs', `output/asset-remake/adopt-${key}.json`], { cwd: root, encoding: 'utf8' });
const res = JSON.parse(out);
console.log(JSON.stringify({ key, url: res.main.url, triangles: res.main.triangles, lod: res.lods[0]?.triangles, height: asset.heightMetres, clips: asset.clips.map((c) => c.name) }));
