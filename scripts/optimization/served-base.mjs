// An applied adoption read as the source of an exact repack (exact-repack.mjs): the files it SERVES
// are the inputs, not its originals. It works for a complete adoption and for a chained one (whose
// own base must still be its recorded, applied record). Nothing is usable unless:
//   - journal.json belongs to plan.json and says applied;
//   - the candidate revision's manifest, index and verification are unchanged;
//   - for a chained adoption, its base's plan is unchanged and still applied;
//   - before/ and after/ hold the planned bytes, and each after/ re-derives from its before/;
//   - the current manifests are exactly the applied bytes (after/ where rewritten, else before/);
//   - every served file and every original matches the graph by SHA-256 and length.
// Nothing here writes.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ADOPTION_DIRECTORY,
  ADOPTION_GRAPH_SCHEMA,
  ADOPTION_JOURNAL_SCHEMA,
  ADOPTION_PLAN_SCHEMA,
  adoptionDirectory,
} from '../runtime-graph.mjs';
import { fileProblems, originalProblems, rewriteManifestBytes, servedFiles } from './adoption.mjs';
import { rewriteChainedManifestBytes } from './chained-adoption.mjs';
import { sha256 } from './glb.mjs';
import { buildInventory } from './inventory.mjs';

const RECORDED_MANIFEST =
  /^public\/models\/(?:world-assets\.json|[a-z0-9][a-z0-9._-]*\/asset\.json)$/;
const REVISION_RECORDS = Object.freeze([
  'manifest.json',
  'runtime-index.json',
  'verification.json',
]);

async function appliedRecord(root, id, fail) {
  const directory = adoptionDirectory(root, id),
    read = async (...parts) => {
      try {
        return await readFile(path.join(directory, ...parts));
      } catch (error) {
        if (error.code === 'ENOENT')
          fail(`${ADOPTION_DIRECTORY}/${id}/${parts.join('/')} is missing`);
        throw error;
      }
    },
    planBytes = await read('plan.json'),
    journal = JSON.parse(await read('journal.json')),
    plan = JSON.parse(planBytes);
  if (
    plan.schema !== ADOPTION_PLAN_SCHEMA ||
    plan.adoption !== id ||
    plan.graph?.schema !== ADOPTION_GRAPH_SCHEMA ||
    plan.graph.adoption !== id
  )
    fail(`${id}: plan.json is not the plan of this adoption`);
  if (
    journal.schema !== ADOPTION_JOURNAL_SCHEMA ||
    journal.adoption !== id ||
    journal.planSha256 !== sha256(planBytes)
  )
    fail(`${id}: journal.json does not belong to plan.json`);
  if (journal.state !== 'applied') fail(`${id} is ${journal.state}, not applied`);
  return { directory, read, plan, journal, planSha256: sha256(planBytes) };
}

/** The applied adoption `id` as a served base, verified as described above. */
export async function readServedBase(root, id, rules) {
  const fail = (message) => {
    throw new Error(`Base adoption ${id}: ${message}`);
  };
  const { read, plan, journal, planSha256 } = await appliedRecord(root, id, fail),
    graph = plan.graph,
    candidate = plan.candidateRevision ?? {};
  if (
    !Array.isArray(candidate.files) ||
    candidate.files.map((item) => item.path).join('\n') !==
      REVISION_RECORDS.map((name) => `${candidate.directory}/${name}`).join('\n')
  )
    fail("plan.json does not name its candidate revision's manifest, index and verification");
  const revisionDrift = await fileProblems(root, candidate.files);
  if (revisionDrift.length)
    fail(`its candidate revision records changed: ${revisionDrift.join('; ')}`);
  if (plan.base) {
    const ancestor = await appliedRecord(root, plan.base.adoption, fail);
    if (ancestor.planSha256 !== plan.base.planSha256)
      fail(`its base ${plan.base.adoption}'s plan changed`);
  }

  // before/ and after/, and the rewrite re-derived from the saved bytes.
  const inputs = plan.inputs?.manifests;
  if (!Array.isArray(inputs) || !inputs.length) fail('plan.json records no input manifests');
  const before = new Map(),
    operations = new Map();
  for (const input of inputs) {
    if (!RECORDED_MANIFEST.test(input?.path ?? '') || before.has(input.path))
      fail(`unexpected manifest path ${JSON.stringify(input?.path)}`);
    const bytes = await read('before', ...input.path.split('/'));
    if (sha256(bytes) !== input.sha256)
      fail(`before/${input.path} is not the bytes its plan recorded`);
    before.set(input.path, bytes);
  }
  for (const operation of plan.operations?.manifests ?? []) {
    const bytes = before.get(operation.path);
    if (!bytes || operations.has(operation.path))
      fail(`it rewrites ${operation.path}, which it did not read`);
    if (operation.before?.sha256 !== sha256(bytes) || operation.before.bytes !== bytes.length)
      fail(`${operation.path}: the planned before-bytes are not the saved ones`);
    const after = await read('after', ...operation.path.split('/'));
    if (after.length !== operation.after?.bytes || sha256(after) !== operation.after.sha256)
      fail(`after/${operation.path} is not the planned rewrite`);
    operations.set(operation.path, operation);
  }
  const rewrite = plan.base ? rewriteChainedManifestBytes : rewriteManifestBytes;
  for (const [file, bytes] of before) {
    const rewritten = rewrite(file, bytes, graph),
      operation = operations.get(file);
    if (
      !rewritten !== !operation ||
      (rewritten && sha256(rewritten.bytes) !== operation.after.sha256)
    )
      fail(`${file}: the planned after-bytes are not the rewrite of the saved before-bytes`);
  }

  // Still applied: the current manifests are exactly its bytes.
  const current = await buildInventory(root, rules),
    expected = new Map(
      inputs.map((input) => [input.path, operations.get(input.path)?.after.sha256 ?? input.sha256]),
    ),
    seen = new Set(),
    drift = [];
  for (const { path: file, sha256: digest } of current.manifests) {
    seen.add(file);
    if (!expected.has(file)) drift.push(`${file} is new`);
    else if (expected.get(file) !== digest) drift.push(`${file} changed (SHA-256 ${digest})`);
  }
  for (const file of expected.keys()) if (!seen.has(file)) drift.push(`${file} is gone`);
  if (drift.length)
    fail(
      `the current manifests are no longer exactly its applied ones: ${drift.slice(0, 8).join('; ')}`,
    );

  const files = [
    ...(await fileProblems(root, servedFiles(graph))),
    ...(await originalProblems(root, graph)),
  ];
  if (files.length)
    fail(`its served or original files do not match the plan: ${files.slice(0, 8).join('; ')}`);
  return {
    id,
    plan,
    graph,
    planSha256,
    current,
    record: {
      adoption: id,
      directory: `${ADOPTION_DIRECTORY}/${id}`,
      planSha256,
      state: journal.state,
      candidateRevision: {
        directory: candidate.directory,
        revision: candidate.revision,
        files: candidate.files.map((item) => ({
          path: item.path,
          sha256: item.sha256,
          bytes: item.bytes,
        })),
      },
      base: plan.base ? { adoption: plan.base.adoption, planSha256: plan.base.planSha256 } : null,
      rewrittenManifests: [...operations.values()].map((operation) => ({
        path: operation.path,
        before: { sha256: operation.before.sha256, bytes: operation.before.bytes },
        after: { sha256: operation.after.sha256, bytes: operation.after.bytes },
      })),
    },
  };
}
