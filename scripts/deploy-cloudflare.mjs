// Refuse deployment unless the exact account was just verified as Workers Free.
// This script has no subscription/payment APIs and never upgrades a plan.
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const verification = JSON.parse(await readFile('assets/cloudflare/account-verification.json', 'utf8'));
const age = Date.now() - Date.parse(verification.checkedAt);
if (verification.workersPlan !== 'Free' || !/^[a-f0-9]{32}$/.test(verification.accountId)
  || !Number.isFinite(age) || age < 0 || age > 15 * 60 * 1000) {
  throw new Error('Deployment blocked: verify Workers Free in the exact account dashboard within 15 minutes. Paid/unknown/stale accounts are forbidden.');
}
const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
const allowed = new Set(['$schema','name','main','compatibility_date','compatibility_flags','workers_dev','preview_urls','assets','durable_objects','migrations','vars','observability','send_metrics']);
for (const key of Object.keys(config)) if (!allowed.has(key)) throw new Error(`Unreviewed hosting configuration: ${key}`);
if (config.name !== 'cro-magnon-free' || config.durable_objects.bindings.length !== 1
  || config.durable_objects.bindings[0].class_name !== 'FreeGameRoom'
  || config.assets.directory !== './dist-cloudflare') throw new Error('Unexpected deployment target');
for (const args of [['scripts/build-cloudflare.mjs'], ['node_modules/wrangler/bin/wrangler.js','deploy','--dry-run'], ['node_modules/wrangler/bin/wrangler.js','deploy']]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', windowsHide: true,
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: verification.accountId, WRANGLER_SEND_METRICS: 'false' } });
  if (result.status !== 0) process.exit(result.status || 1);
}
