// Finish provenance records after static and actual-game QA; never modify candidate GLBs.
import { readFile, writeFile, mkdir, copyFile, constants } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base = 'assets/coastal-craft/models';
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const save = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n');
const hash = (b) => createHash('sha256').update(b).digest('hex');
const appearance = await json('assets/coastal-craft/appearance-qa/r02/report.json');
const game = await json('assets/coastal-craft/game-qa/r01/report.json');
if (appearance.status !== 'passed' || game.errors.length || game.collisionViolations.length)
  throw Error('Game QA must pass before adoption');
const catalog = await json('public/models/world-assets.json'),
  production = await json('assets/world-models.json');
const keys = ['cockle-shell', 'shell-midden', 'wooden-spear', 'obsidian-spear', 'obsidian-blade'];
for (const key of keys) {
  const root = `${base}/${key}`,
    model = await json(root + '/model.json'),
    asset = await json(`public/models/${key}/asset.json`);
  await mkdir(root + '/source', { recursive: true });
  await mkdir(root + '/qa', { recursive: true });
  const generated = key === 'cockle-shell' || key === 'shell-midden';
  const refs = generated
    ? {
        imagegen: true,
        promptRecord: 'Summary of the generation request, not a verbatim prompt transcript.',
        summary:
          key === 'cockle-shell'
            ? 'One closed ribbed cockle, cream and brown shell, isolated three-quarter view on white, no extra objects.'
            : 'A low broad mound of empty overlapping cockle shell valves and dark earth, isolated on white; approximately 1.5 m wide and 0.3 m high as the visual target.',
        referenceSha256: hash(await readFile(root + '/source/reference-v1.png')),
        trellis: {
          executable: '../threed-model-creation/trellis-studio/runtime/trellis-cli.exe',
          models: '../threed-model-creation/trellis-studio/models',
          resolution: 1024,
          seed: 42,
          textureResolution: 512,
          atlas: 2048,
          webp: false,
          dumpBackground: true,
          requireGPU: true,
          actualDeviceFromLog: 'NVIDIA GeForce RTX 3070 Laptop GPU, 8191 MiB',
          source: 'source/reference-v1.png',
          output: 'work/trellis/dense-1024.glb',
        },
        denseSha256: hash(await readFile(root + '/work/trellis/dense-1024.glb')),
        static: true,
        rig: 'Not required',
        proceduralVisibleReplacement: false,
      }
    : {
        generatedFromExistingAsset: true,
        sourceAsset: 'source/flint-spear.glb',
        sourceManifest: 'source/flint-spear.asset.json',
        sourceSha256: hash(await readFile('public/models/flint-spear/model.glb')),
        missingHistory:
          'The historical flint-spear reference/dense paths are recorded in the original manifest but are absent from this checkout. No new historical reference or dense was fabricated.',
        method:
          key === 'wooden-spear'
            ? 'Retain source shaft below Y=0.90 m; remove head and binding, weld coincident positions, close the measured cut and recalculate normals.'
            : key === 'obsidian-spear'
              ? 'Keep the complete original binary buffer, mesh and UV data; darken only the knapped head material.'
              : 'Keep only the original head primitive and move its base to the origin. Original binary buffer is retained, including unused portions.',
        static: true,
        rig: 'Parented to existing Grip.R; no separate rig',
        proceduralVisibleReplacement: false,
      };
  if (!generated) {
    for (const [source, dest] of [
      ['public/models/flint-spear/model.glb', root + '/source/flint-spear.glb'],
      ['public/models/flint-spear/asset.json', root + '/source/flint-spear.asset.json'],
    ]) {
      try {
        await copyFile(source, dest, constants.COPYFILE_EXCL);
      } catch (e) {
        if (e.code !== 'EEXIST' || hash(await readFile(source)) !== hash(await readFile(dest)))
          throw e;
      }
    }
  }
  await save(root + '/source/request.json', refs);
  model.gameIntegration = 'passed-local';
  model.adoption = 'adopted';
  model.gameQA = 'assets/coastal-craft/game-qa/r01/report.json';
  model.appearanceQA = 'assets/coastal-craft/appearance-qa/r02/report.json';
  asset.status = 'reviewed-local';
  Object.assign(
    asset.provenance,
    generated
      ? { referenceSha256: refs.referenceSha256, denseSha256: refs.denseSha256 }
      : { sourceAsset: root + '/source/flint-spear.glb', sourceAssetSha256: refs.sourceSha256 },
  );
  model.provenance = asset.provenance;
  await save(root + '/model.json', model);
  await save(`public/models/${key}/asset.json`, asset);
  catalog.assets[catalog.assets.findIndex((a) => a.modelKey === key)] = asset;
  production.assets.find((a) => a.key === key).status = 'reviewed-local';
  const reviewFile = generated
    ? root + '/qa/adoption-review.json'
    : 'assets/coastal-craft/weapon-qa/adoption-review.json';
  const review = await json(reviewFile);
  Object.assign(review, {
    decision: 'adopt',
    gameIntegration: 'passed-local',
    sha256: model.sha256,
    gameQA: model.gameQA,
    appearanceQA: model.appearanceQA,
  });
  await save(root + '/qa/adoption-review.json', review);
  await copyFile(model.gameQA, root + '/qa/game-report.json');
  if (!generated) await copyFile(model.appearanceQA, root + '/qa/appearance-report.json');
  await writeFile(
    root + '/README.md',
    `# ${model.name}\n\nCandidate 1 / revision ${model.adoptedRevision}. Final SHA-256: ${model.sha256}.\n\nSee model.json and source/request.json for provenance, actual dimensions in the delivery manifest, and qa/adoption-review.json for acceptance. All work revisions are preserved. geometry/accepted.glb equals the candidate and public delivery. Scripts were run from the CRO-MAGNON workspace; they retain their original relative paths.\n\nThe canonical archive contains this entire model folder. The shared game documentation is assets/coastal-craft/README.md in CRO-MAGNON.\n`,
  );
}
const weaponReview = await json('assets/coastal-craft/weapon-qa/adoption-review.json');
weaponReview.gameIntegration = 'passed-local';
weaponReview.appearanceQA = 'assets/coastal-craft/appearance-qa/r02/report.json';
await save('assets/coastal-craft/weapon-qa/adoption-review.json', weaponReview);
await save('public/models/world-assets.json', catalog);
await save('assets/world-models.json', production);
console.log(JSON.stringify({ recorded: keys, originalGLBsChanged: 0 }));
