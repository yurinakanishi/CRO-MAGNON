// Adopt an accepted candidate revision into the runtime manifests (see adoption.mjs).
//
//   node scripts/optimization/adopt-candidates.mjs [--plan] [--adoption=<id>] [--revision=<dir>] [--acceptance=<file> ...]
//   node scripts/optimization/adopt-candidates.mjs --plan --dry-run      # compute and print; write nothing
//   node scripts/optimization/adopt-candidates.mjs --apply --adoption=<id>
//   node scripts/optimization/adopt-candidates.mjs --audit --adoption=<id> [--write-report]
//   node scripts/optimization/adopt-candidates.mjs --restore --adoption=<id>
//
// A partial revision is planned on its applied base adoption (chained-adoption.mjs); nothing has a
// default there, and the acceptance documents must be the partial revision's own:
//   node scripts/optimization/adopt-candidates.mjs --plan --base-adoption=<applied id> --revision=<partial dir> --adoption=<new id> --acceptance=<file> ... [--dry-run]
//
// The default is --plan. It writes only a new folder under assets/runtime-adoption/. Only
// --apply and --restore change public/models, and only on an existing plan.
import { parseArgs } from 'node:util';
import {
  applyAdoption,
  auditAdoption,
  planAdoption,
  restoreAdoption,
  writeAuditReport,
  writePlan,
} from './adoption.mjs';
import { DEFAULT_REVISION, REPO_ROOT } from './paths.mjs';

const MODES = ['plan', 'apply', 'audit', 'restore'];

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    allowPositionals: false,
    options: {
      plan: { type: 'boolean', default: false },
      apply: { type: 'boolean', default: false },
      audit: { type: 'boolean', default: false },
      restore: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      'write-report': { type: 'boolean', default: false },
      adoption: { type: 'string' },
      revision: { type: 'string' },
      acceptance: { type: 'string', multiple: true },
      'base-adoption': { type: 'string' },
    },
  });
  const modes = MODES.filter((mode) => values[mode]);
  if (modes.length > 1) throw new Error(`Choose one of --${MODES.join(', --')}`);
  const mode = modes[0] ?? 'plan',
    base = values['base-adoption'];
  if (mode !== 'plan') {
    if (!values.adoption) throw new Error(`--${mode} needs --adoption=<id> of an existing plan`);
    if (values.revision || values.acceptance || values['dry-run'] || base)
      throw new Error(
        `--${mode} uses the revision, base and acceptance documents stored in the plan; --revision, --base-adoption, --acceptance and --dry-run belong to --plan`,
      );
  }
  if (base !== undefined && !(values.revision && values.adoption && values.acceptance))
    throw new Error(
      "--base-adoption plans a partial revision on that applied adoption: name the revision (--revision), a new adoption id (--adoption) and this revision's own acceptance documents (--acceptance)",
    );
  if (values['write-report'] && mode !== 'audit')
    throw new Error('--write-report belongs to --audit');
  let output;
  if (mode === 'plan') {
    const result = await planAdoption(REPO_ROOT, {
      revision: values.revision ?? DEFAULT_REVISION,
      adoption: values.adoption,
      ...(values.acceptance ? { acceptance: values.acceptance } : {}),
      ...(base !== undefined ? { base } : {}),
    });
    const record = values['dry-run'] ? null : await writePlan(REPO_ROOT, result);
    output = {
      adoption: result.plan.adoption,
      ...(result.plan.base ? { base: result.plan.base.adoption } : {}),
      record,
      state: record ? 'planned' : 'dry-run (nothing written)',
      totals: result.plan.totals,
      targets: result.review.targets,
      runtimeLiterals: result.review.runtimeLiterals,
      runtimeCompatibility: result.plan.runtimeCompatibility,
      standaloneInputs: (result.review.standaloneInputs ?? []).filter((input) => input.changed),
      next: record
        ? [
            `review ${record}/plan.json, ${record}/review.json and the before/ and after/ manifests`,
            `node scripts/optimization/adopt-candidates.mjs --apply --adoption=${result.plan.adoption}`,
          ]
        : [],
    };
  } else if (mode === 'apply') output = await applyAdoption(REPO_ROOT, values.adoption);
  else if (mode === 'audit') {
    output = await auditAdoption(REPO_ROOT, values.adoption);
    if (values['write-report'])
      output = { ...output, report: await writeAuditReport(REPO_ROOT, output) };
  } else output = await restoreAdoption(REPO_ROOT, values.adoption);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (output.status === 'failed') process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
