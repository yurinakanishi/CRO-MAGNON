// Read-only integration assertions for a guarded step in the real adoption history.
// Deliberately independent of the production planner and manifest rewriter.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const identity = ({ url, sha256, bytes }) => ({ url, sha256, bytes });

export async function assertGuardedHistoryStep(root, plan) {
  assert.equal(plan.recipe, 'guarded-surface@1');
  const read = (relative) => readFile(path.join(root, relative));
  const baseBytes = await read(`${plan.base.directory}/plan.json`);
  assert.equal(sha(baseBytes), plan.base.planSha256);
  const base = JSON.parse(baseBytes);
  const journal = JSON.parse(await read(`${plan.base.directory}/journal.json`));
  assert.deepEqual([journal.state, journal.planSha256], ['applied', sha(baseBytes)]);
  let revision;
  for (const record of plan.candidateRevision.files) {
    const bytes = await read(record.path);
    assert.deepEqual([sha(bytes), bytes.length], [record.sha256, record.bytes], record.path);
    if (record.path.endsWith('/manifest.json')) revision = JSON.parse(bytes);
  }
  assert.ok(revision);
  assert.equal(revision.recipe, plan.recipe);
  assert.deepEqual(plan.graph.scope, revision.scope.only);
  assert.deepEqual(
    revision.files.map((record) => record.modelKey).sort(),
    [...plan.graph.scope].sort(),
  );
  assert.deepEqual(Object.keys(plan.graph.models).sort(), Object.keys(base.graph.models).sort());
  for (const name of ['textures', 'keptTextures', 'notAdopted', 'lodRejections', 'decoder'])
    assert.deepEqual(plan.graph[name], base.graph[name], name);
  for (const [key, before] of Object.entries(base.graph.models)) {
    const after = plan.graph.models[key];
    if (!plan.graph.scope.includes(key)) {
      assert.deepEqual(after, before, `${key}: outside guarded scope`);
      continue;
    }
    const record = revision.files.find((item) => item.modelKey === key);
    assert.deepEqual(identity(record.source), identity(before.primary), `${key}: source`);
    assert.deepEqual(identity(after.primary), identity(record.output), `${key}: reviewed output`);
    assert.equal(record.proof.reviewedCandidateSha256, after.primary.sha256, key);
    const bytes = await read(`${revision.directory}/${record.output.file}`);
    assert.deepEqual([sha(bytes), bytes.length], [after.primary.sha256, after.primary.bytes], key);
    assert.ok(after.primary.triangles < before.primary.triangles, `${key}: fewer triangles`);
    assert.equal(after.primary.triangles, record.output.triangles, key);
    assert.deepEqual(after.primary.source, before.primary.source, `${key}: original lineage`);
    assert.deepEqual(after.lods, before.lods, `${key}: LODs unchanged`);
    assert.deepEqual(after.manifests, before.manifests, key);
    assert.equal(after.selection, before.selection, key);
    assert.equal(after.adoptedBy, plan.adoption, key);
    assert.equal(after.candidateRevision, revision.directory, key);
    assert.deepEqual(identity(after.supersedes.primary), identity(before.primary), key);
    assert.deepEqual(after.supersedes.lods.map(identity), before.lods.map(identity), key);
    if (before.selection === 'startup-sole-primary') {
      assert.deepEqual(after.lods, [], `${key}: rejected LODs stay absent`);
      assert.deepEqual(after.clearedLods, before.clearedLods, `${key}: rejection provenance`);
      assert.deepEqual(after.supersedes.startup, before.startup, `${key}: preceding startup`);
      assert.deepEqual(after.supersedes.farTriangles, before.farTriangles, key);
      assert.deepEqual(identity(after.startup), identity(after.primary), `${key}: current startup`);
      assert.deepEqual(after.startup.derivation, {
        recipe: plan.recipe,
        from: identity(before.primary),
      });
      assert.deepEqual(after.startup.fullSource, before.startup.fullSource, key);
      assert.deepEqual(after.startup.geometrySource, before.startup.geometrySource, key);
      assert.equal(after.farTriangles.before, before.farTriangles.before, key);
      assert.equal(after.farTriangles.after, after.primary.triangles, key);
    }
  }
  for (const operation of plan.operations.manifests) {
    const previous = base.operations.manifests.find((item) => item.path === operation.path);
    assert.ok(previous, operation.path);
    assert.deepEqual(operation.before, previous.after, operation.path);
    const saved = await read(`assets/runtime-adoption/${plan.adoption}/before/${operation.path}`);
    assert.deepEqual([sha(saved), saved.length], [previous.after.sha256, previous.after.bytes]);
  }
  return base;
}
