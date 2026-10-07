// Write assets/face-remake/<key>/adoption-review-r01.json for a new face-remake head from its recorded reports.
// node scripts/face-remake/write-review.mjs <key> <projection dir name, e.g. project-r06>
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const [key, proj] = process.argv.slice(2);
const sha = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const json = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const attachment = {
  'neanderthal-woman':
    'Zipped to the body neck ring (47 shared seam vertices) through a smooth Hermite neck sleeve; flat cut just above the reconstruction rim; the body neck-ring vertex normals take the sleeve normals.',
  'neanderthal-hunter':
    'Overlap: his body has no clean neck ring (jagged collar). The full reconstructed neck is kept and ends inside the fur collar; the body skin-shard triangles above 1.43 m inside the new neck (formerly hidden by the old long beard) are removed. Nose depth aligned to the old face (z = 0.11 m). Skin low-frequency colour moved halfway to the reference tone.',
  'cro-magnon-woman':
    'Zipped to the body neck ring (43 shared seam vertices) through a smooth sleeve; rim-following cut (the reconstruction ends in a U-shaped bust cut); the body neck-ring vertex normals take the sleeve normals; new hair graded toward the kept body braid colour.',
}[key];
const D = `output/face-remake/${key}/final`;
const g = json(`${D}/graft-report.json`);
const v = json(`${D}/verify.json`);
const before = json(`${D}/rigidity-before.json`);
const rec = json(`assets/face-remake/${key}/reconstruction-reference-v1a-seed0042.json`);
const req = json('assets/face-remake/request-v1.json');
const ref = `assets/face-remake/${key}/source/reference-v1a.png`;
const review = {
  key,
  decision: 'adopt',
  sha256: sha(`${D}/model.glb`),
  lodSha256: sha(`${D}/lod.glb`),
  revision: 'r01',
  date: '2026-10-07',
  reviewer: 'Claude Code (Opus 5.5)',
  request:
    'クロマニョン人とネアンデルタール人の男性女性の顔のクオリティが低いので、ちゃんとリアルでかっこいい／かわいい顔に。歩いたり走ったりするときに顔の形が崩れるバグも直す。',
  faceRemake: {
    revision: 'r01',
    kind: 'new-head',
    reference: {
      file: ref,
      sha256: sha(ref),
      generator: 'Codex built-in image_gen (desktop app CLI 0.162, gpt-5.6-sol)',
      prompt: req.characters.find((c) => c.key === key).prompts[0],
      choice: `variant A of two (reference-v1a.png chosen, reference-v1b.png kept)`,
    },
    reconstruction: {
      generator: rec.generator,
      seed: rec.seed,
      resolution: rec.resolution,
      textureResolution: rec.textureResolution,
      atlas: rec.atlas,
      seconds: rec.seconds,
      denseSha256: rec.sha256,
      record: `assets/face-remake/${key}/reconstruction-reference-v1a-seed0042.json`,
    },
    projection: {
      record: `assets/face-remake/${key}/projection-r01.json`,
      run: `output/face-remake/final-projections.sh (${proj})`,
      method:
        'reference registered to the reconstruction silhouette; the face surface slid (optical flow inside a feathered face ellipse) so eyes, nose and mouth sit where the reference has them; reference detail finer than 48 px projected onto front-facing texels over the reconstruction low-frequency colour',
    },
    graft: {
      record: `assets/face-remake/${key}/graft-report-r01.json`,
      run: 'output/face-remake/final-grafts.sh',
      attachment,
      placement: g.placement,
      headTriangles: g.output.headTriangles,
      lodHeadTriangles: g.lod.triangles,
      hiddenFacesRemoved: g.hiddenFacesRemoved,
      reduction: g.reduction,
    },
    weights:
      'Above the jaw curve (+2.5 cm blend) every head vertex is 100% Head; the neck blends Head -> Neck -> the body ring weights (or Chest/Neck inside the collar). Fixes the walk/run face shear.',
    faceRigidityBefore: before.clips,
    faceRigidityAfter: v.faceRigidity,
    verification: `assets/face-remake/${key}/verify-r01.json`,
    preserved:
      'all body/accent primitives (except the reported ring normals or removed shard faces), the skin, inverse bind matrices, node transforms, all 10 clips and all non-head images are byte-identical (verify-r01.json)',
    visual: [`assets/face-remake/${key}/qa/before-after-r01.jpg`, `assets/face-remake/${key}/qa/front-combined.jpg`],
  },
  provenance: {
    provider: 'Claude Code (Opus 5.5); Codex built-in image_gen reference; local TRELLIS-2 reconstruction',
    claudeUsed: true,
    referenceGenerator: 'Codex built-in image_gen',
    referenceImage: ref,
    referenceSha256: sha(ref),
    reconstruction: `Local TRELLIS-2 C++ GGUF, res 1024, seed 42 (head only); assets/face-remake/${key}/reconstruction-reference-v1a-seed0042.json`,
    denseFile: rec.output,
    denseSha256: rec.sha256,
    processReport: `assets/face-remake/${key}/graft-report-r01.json`,
    pipeline:
      'scripts/face-remake/ (write-requests.mjs, reconstruct-head.mjs, project-reference.py, graft-head.py, verify-graft.py, write-review.mjs, adopt-face.mjs)',
  },
};
fs.writeFileSync(`assets/face-remake/${key}/adoption-review-r01.json`, JSON.stringify(review, null, 2) + '\n');
console.log(key, review.sha256);
