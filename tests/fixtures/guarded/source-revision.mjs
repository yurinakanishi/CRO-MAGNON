// The optimization remains immutable history when a reviewed geometry revision
// replaces one source. Prove the exact expected drift, never ignore failed audits.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { activeAdoption, checkRuntimeGraph } from '../../../scripts/runtime-graph.mjs';
import { runtimeTextureRecords } from '../../../scripts/environment-assets.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function assertAppliedOrRevisedSource(root, id, report) {
  const read = (relative) => readFile(path.join(root, relative));
  const catalogPath = 'public/models/world-assets.json';
  const catalogBytes = await read(catalogPath),
    catalog = JSON.parse(catalogBytes);
  const revisions = catalog.assets.filter((asset) => asset.sourceRevision);
  if (!revisions.length) {
    assert.equal(report.status, 'passed', JSON.stringify(report.checks));
    return;
  }
  const active = await activeAdoption(root, catalog.assets, runtimeTextureRecords);
  assert.equal(active.id, id);
  checkRuntimeGraph(catalog.assets, active, {
    requireAdoption: true,
    textureRecords: runtimeTextureRecords,
  });
  const restored = structuredClone(catalog),
    changed = [catalogPath],
    expectedRecords = [];
  for (const asset of revisions) {
    const proof = JSON.parse(await read(asset.sourceRevision.record));
    const manifestPath = `public/models/${asset.modelKey}/asset.json`;
    assert.deepEqual(
      JSON.parse(await read(manifestPath)),
      asset,
      'catalog agrees with individual revision',
    );
    const old = await read(proof.previous.manifest);
    assert.equal(sha(old), proof.previous.manifestSha256);
    assert.deepEqual(
      JSON.parse(old),
      JSON.parse(await read(`assets/runtime-adoption/${id}/after/${manifestPath}`)),
    );
    restored.assets[restored.assets.findIndex((a) => a.modelKey === asset.modelKey)] =
      JSON.parse(old);
    changed.push(manifestPath);
    for (const file of [asset, ...asset.lods]) {
      const bytes = await read(`public${file.url}`);
      assert.deepEqual([sha(bytes), bytes.length], [file.sha256, file.bytes]);
    }
    for (const file of proof.previous.files) {
      const bytes = await read(`public${file.url}`);
      assert.deepEqual(
        [sha(bytes), bytes.length],
        [file.sha256, file.bytes],
        'previous model remains intact',
      );
    }
    expectedRecords.push(
      ...[catalogPath, manifestPath].map(
        (p) =>
          `${p} ${asset.modelKey}: does not serve exactly the planned files (and packed scenes)`,
      ),
    );
  }
  assert.deepEqual(
    restored,
    JSON.parse(await read(`assets/runtime-adoption/${id}/after/${catalogPath}`)),
    'only accepted source records changed in the catalog',
  );
  const failures = report.checks.filter((c) => c.status === 'failed');
  assert.deepEqual(
    failures.map((c) => c.name),
    [
      'the current manifests hold exactly the adopted bytes',
      'every adopted record serves exactly the planned candidate',
    ],
  );
  const expectedManifests = await Promise.all(
    changed.map(async (p) => `${p} is not the adopted bytes (SHA-256 ${sha(await read(p))})`),
  );
  assert.deepEqual(failures[0].problems.sort(), expectedManifests.sort());
  assert.equal(failures[0].problemCount, expectedManifests.length);
  assert.deepEqual(failures[1].problems.sort(), expectedRecords.sort());
  assert.equal(failures[1].problemCount, expectedRecords.length);
}
