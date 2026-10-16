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
  // Manifests the adoption wrote outside the catalog (the startup actors): an accepted revision
  // there is proven the same way, from its own manifest.
  const plan = JSON.parse(await read(`assets/runtime-adoption/${id}/plan.json`)),
    individual = [];
  for (const { path: manifestPath } of plan.operations.manifests) {
    if (manifestPath === catalogPath) continue;
    const asset = JSON.parse(await read(manifestPath));
    if (!catalog.assets.some((entry) => entry.modelKey === asset.modelKey)) individual.push(asset);
  }
  const revisions = catalog.assets.filter((asset) => asset.sourceRevision),
    actorRevisions = individual.filter((asset) => asset.sourceRevision);
  if (!revisions.length && !actorRevisions.length) {
    assert.equal(report.status, 'passed', JSON.stringify(report.checks));
    return;
  }
  const assets = [...catalog.assets, ...individual];
  const active = await activeAdoption(root, assets, runtimeTextureRecords);
  assert.equal(active.id, id);
  checkRuntimeGraph(assets, active, {
    requireAdoption: true,
    textureRecords: runtimeTextureRecords,
  });
  const restored = structuredClone(catalog),
    changed = [catalogPath],
    expectedRecords = [],
    expectedStartup = [];
  for (const asset of [...revisions, ...actorRevisions]) {
    const inCatalog = revisions.includes(asset);
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
    if (inCatalog)
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
      ...(inCatalog ? [catalogPath, manifestPath] : [manifestPath]).map(
        (p) =>
          `${p} ${asset.modelKey}: does not serve exactly the planned files (and packed scenes)`,
      ),
    );
    // A revised startup actor serves its accepted new primary instead of its startup file.
    if (active.graph.models[asset.modelKey]?.selection === 'startup-sole-primary')
      expectedStartup.push(
        `${manifestPath} ${asset.modelKey}: serves ${asset.url}, not its startup file`,
      );
  }
  assert.deepEqual(
    restored,
    JSON.parse(await read(`assets/runtime-adoption/${id}/after/${catalogPath}`)),
    'only accepted source records changed in the catalog',
  );
  const failures = report.checks.filter((c) => c.status === 'failed');
  // A reviewed artwork successor intentionally changes the old UV meanings.
  // The active graph has already verified its independent, hash-bound texture
  // proof above. Still assert every historical audit difference exactly.
  const art = assets.filter((asset) => asset.textureRevision);
  if (art.length) {
    assert.equal(art.length, 1);
    const asset = art[0],
      accepted = active.textureRevisions[asset.modelKey];
    const replaced = Object.values(active.graph.textures).filter((t) =>
      accepted.replaced.includes(t.url),
    );
    const first = replaced
      .filter((t) => t.manifestEntry.startsWith('mascotPigments.'))
      .sort((a, b) => a.manifestEntry.localeCompare(b.manifestEntry))[0];
    const key = first.manifestEntry.split('.').at(-1),
      now = asset.mascotPigments[key];
    const compatibility = failures.shift();
    assert.equal(
      compatibility.name,
      "the current runtime still loads the base adoption's standalone images with unchanged meaning (re-planned from its revision and saved pre-apply manifests), and the graph serves them as recorded",
    );
    assert.deepEqual(compatibility.problems, [
      `the current runtime files cannot be re-planned: CAVE_EXTRA_PIGMENTS.${key} names ${now.url}, the manifest audits ${first.source.url}`,
      'the plan recorded standalone images; the base revision has none',
    ]);
    const textures = failures.pop();
    assert.equal(
      textures.name,
      'cave texture records serve the candidate with uvSource set to the original size',
    );
    const expected = replaced.flatMap((t) =>
      t.manifests.map(
        (p) =>
          `${p} ${asset.modelKey}: ${t.manifestEntry} is not ${t.url} with uvSource ${t.uvSource.width}x${t.uvSource.height}`,
      ),
    );
    assert.deepEqual(textures.problems.sort(), expected.sort());
    assert.equal(textures.problemCount, expected.length);
  }
  assert.deepEqual(
    failures.map((c) => c.name),
    [
      'the current manifests hold exactly the adopted bytes',
      ...(expectedStartup.length
        ? ['every startup actor serves only its startup file, with no LOD']
        : []),
      'every adopted record serves exactly the planned candidate',
    ],
  );
  const [manifests, ...rest] = failures,
    startup = expectedStartup.length ? rest.shift() : null,
    [records] = rest;
  if (!revisions.length) changed.shift(); // the catalog itself is unchanged
  const expectedManifests = await Promise.all(
    changed.map(async (p) => `${p} is not the adopted bytes (SHA-256 ${sha(await read(p))})`),
  );
  assert.deepEqual(manifests.problems.sort(), expectedManifests.sort());
  assert.equal(manifests.problemCount, expectedManifests.length);
  if (startup) {
    assert.deepEqual(startup.problems.sort(), expectedStartup.sort());
    assert.equal(startup.problemCount, expectedStartup.length);
  }
  assert.deepEqual(records.problems.sort(), expectedRecords.sort());
  assert.equal(records.problemCount, expectedRecords.length);
}
