#!/usr/bin/env node
// guarded-surface@1 revisions (scripts/optimization/guarded-surface.mjs). Nothing has a default:
//
//   node scripts/optimize-guarded-assets.mjs generate --base-adoption <applied id> --base-plan-sha256 <sha>
//        --proof-summary <proof output>/summary.json [--proof-summary <another complete proof>/summary.json ...]
//        --proof-implementation <sha256>
//        --accept key=<reviewed candidate sha256>[,key=<sha256>...] --out assets/optimized-runtime/<new> [--dry-run]
//   node scripts/optimize-guarded-assets.mjs verify --revision assets/optimized-runtime/<dir> --base-adoption <applied id>
//        [--proof-implementation <sha256>] [--write-report]
//
// Every --proof-summary is a complete run of the same implementation and policy; their keys are
// disjoint and each accepted key is in exactly one. generate writes only a NEW revision folder
// (manifest.json, runtime-index.json, the reviewed candidates, archived unchanged LODs, each
// original summary byte for byte and the proof evidence). verify re-checks it from disk (with
// --proof-implementation, also against that digest) and, with --write-report, writes its
// verification.json when it passed (refusing to replace a different one).
// Planning, apply, audit and restore are scripts/optimization/adopt-candidates.mjs with
// --base-adoption and this revision; nothing here adopts anything.
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  GUARDED_REPORT,
  generateGuardedRevision,
  verifyGuardedRevision,
} from './optimization/guarded-surface.mjs';
import { loadEligibilityRules } from './optimization/inventory.mjs';
import { resolveRevisionDirectory } from './optimization/paths.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** `key=sha256,key=sha256` as { key: sha256 }; refuses empty, duplicate or malformed entries. */
export function parseAccept(value) {
  if (typeof value !== 'string' || !value.trim())
    throw new Error('--accept key=<sha256>[,...] is required; the scope is never implicit');
  const accept = {};
  for (const item of value.split(',')) {
    const match = /^([a-z0-9-]+)=([0-9a-f]{64})$/.exec(item.trim());
    if (!match)
      throw new Error(`--accept entry ${JSON.stringify(item)} is not key=<64 hex sha256>`);
    if (Object.hasOwn(accept, match[1])) throw new Error(`${match[1]} is accepted twice`);
    accept[match[1]] = match[2];
  }
  return accept;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2),
    { values } = parseArgs({
      args: rest,
      strict: true,
      allowPositionals: false,
      options: {
        'base-adoption': { type: 'string' },
        'base-plan-sha256': { type: 'string' },
        'proof-summary': { type: 'string', multiple: true },
        'proof-implementation': { type: 'string' },
        accept: { type: 'string' },
        out: { type: 'string' },
        revision: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        'write-report': { type: 'boolean', default: false },
      },
    }),
    rules = await loadEligibilityRules(ROOT);
  if (command === 'generate') {
    for (const name of [
      'base-adoption',
      'base-plan-sha256',
      'proof-summary',
      'proof-implementation',
      'out',
    ])
      if (!values[name]?.length) throw new Error(`generate needs --${name}`);
    const result = await generateGuardedRevision(ROOT, {
      base: values['base-adoption'],
      basePlanSha256: values['base-plan-sha256'],
      summaries: values['proof-summary'],
      implementation: values['proof-implementation'],
      accept: parseAccept(values.accept),
      out: values.out,
      rules,
      dryRun: values['dry-run'],
    });
    return console.log(JSON.stringify(result, null, 2));
  }
  if (command === 'verify') {
    for (const name of ['base-adoption', 'revision'])
      if (!values[name]) throw new Error(`verify needs --${name}`);
    if (values['proof-summary'] || values.accept || values.out || values['dry-run'])
      throw new Error(
        'verify reads the revision only; --proof-summary, --accept, --out and --dry-run belong to generate',
      );
    const report = await verifyGuardedRevision(ROOT, values.revision, {
        base: values['base-adoption'],
        rules,
        implementation: values['proof-implementation'] ?? null,
      }),
      text = `${JSON.stringify(report, null, 2)}\n`;
    if (values['write-report']) {
      const target = path.join(
        resolveRevisionDirectory(ROOT, values.revision).absolute,
        GUARDED_REPORT,
      );
      if (existsSync(target) && (await readFile(target, 'utf8')) !== text)
        throw new Error(`${target} exists with different content; move it aside first`);
      if (report.status === 'passed') await writeFile(target, text);
    }
    process.stdout.write(text);
    if (report.status !== 'passed') process.exitCode = 1;
    return;
  }
  throw new Error(
    'usage: optimize-guarded-assets.mjs generate|verify ... (see the header of this file)',
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
