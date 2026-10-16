// Repeatable local release gate. This command never deploys or restarts a server.
import assert from 'node:assert/strict';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const npm = process.env.npm_execpath;
assert.ok(npm, 'Run this gate with npm run verify:production');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const option = process.argv.find((arg) => arg.startsWith('--output-root='));
const output = path.resolve(option?.slice('--output-root='.length) || `output/production-${stamp}`);
const relative = path.relative(path.join(root, 'output'), output);
assert.ok(
  relative && !relative.startsWith('..') && !path.isAbsolute(relative),
  'Use a fresh subdirectory of output/',
);
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output); // Never mix this run with old evidence or replace an active build.
const evidence = path.join(root, 'output/playwright', `production-${stamp}`);
const report = {
  startedAt: new Date().toISOString(),
  node: process.version,
  output,
  evidence,
  status: 'running',
  steps: [],
};

async function run(name, args, extraEnv = {}) {
  const started = Date.now();
  const logPath = path.join(output, `${name}.log`);
  console.log(`Checking ${name} …`);
  const log = createWriteStream(logPath);
  let code;
  try {
    code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: root,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...extraEnv },
        timeout: 15 * 60 * 1000,
      });
      child.stdout.pipe(log, { end: false });
      child.stderr.pipe(log, { end: false });
      child.on('error', reject);
      child.on('close', resolve);
    });
  } finally {
    await new Promise((resolve) => log.end(resolve));
    report.steps.push({
      name,
      command: [process.execPath, ...args],
      code,
      elapsedMs: Date.now() - started,
      log: logPath,
    });
    await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
  }
  if (code !== 0) {
    console.error((await readFile(logPath, 'utf8')).split(/\r?\n/).slice(-45).join('\n'));
    throw new Error(`${name} failed; see ${logPath}`);
  }
  console.log(`PASS ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
}

try {
  await run('check', [npm, 'run', 'check']);
  await run('format', [npm, 'run', 'format:check']);
  await run('audit', [npm, 'audit', '--json']);
  await run('build', ['scripts/build-cloudflare.mjs', `--output-root=${output}`]);
  await run('tests', [
    '--test',
    '--test-concurrency=4',
    '--test-timeout=180000',
    'tests/*.test.mjs',
  ]);
  const build = JSON.parse(await readFile(path.join(output, 'cloudflare-build.json'), 'utf8'));
  report.buildId = build.buildId;
  const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
  assert.equal(config.vars.SERVICE_ENABLED, 'false', 'Production verification is solo only');
  config.main = path.join(output, 'dist-cloudflare-worker/cloudflare/worker.mjs');
  config.assets.directory = path.join(output, 'dist-cloudflare');
  config.$schema = path.join(root, 'node_modules/wrangler/config-schema.json');
  const configPath = path.join(output, 'wrangler.json');
  await writeFile(configPath, JSON.stringify(config, null, 2));
  await run(
    'worker-dry-run',
    [
      'node_modules/wrangler/bin/wrangler.js',
      'deploy',
      '--dry-run',
      '--config',
      configPath,
      '--outdir',
      path.join(output, 'worker-dry-run'),
    ],
    {
      WRANGLER_SEND_METRICS: 'false',
      WRANGLER_LOG_PATH: path.join(output, 'wrangler-logs'),
    },
  );
  await run('browser', ['scripts/qa-production.mjs', output, evidence]);
  report.status = 'passed';
  console.log(
    `Production verification passed: ${build.buildId}\nReport: ${path.join(output, 'verification.json')}`,
  );
} catch (error) {
  report.status = 'failed';
  report.failure = error.stack || String(error);
  process.exitCode = 1;
  console.error(error.message);
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
}
