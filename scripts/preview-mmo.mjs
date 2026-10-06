import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { sha256 } from './exhibition-integrity.mjs';
import { auditEnvironmentDirectory } from './environment-assets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const report = JSON.parse(await readFile(path.join(root, 'output/cloudflare-build.json'), 'utf8'));
if (report.profile?.environment !== 'mmo' || report.profile.cameraControls !== false)
  throw new Error('Build the MMO release first: npm run build:mmo');
if (
  report.buildId !==
  createHash('sha256')
    .update(JSON.stringify({ publicFiles: report.publicFiles, workerFiles: report.workerFiles }))
    .digest('hex')
)
  throw new Error('Invalid MMO release manifest. Run npm run build:mmo again.');
await auditEnvironmentDirectory(
  path.join(root, 'dist-cloudflare'),
  report.publicFiles.map((file) => file.path),
  report.profile,
);
for (const file of report.publicFiles)
  if ((await sha256(path.join(root, 'dist-cloudflare', file.path))) !== file.sha256)
    throw new Error(`MMO release changed: ${file.path}. Run npm run build:mmo again.`);
for (const file of report.workerFiles)
  if ((await sha256(path.join(root, 'dist-cloudflare-worker', file.path))) !== file.sha256)
    throw new Error(`MMO Worker release changed: ${file.path}. Run npm run build:mmo again.`);
const port = Number(process.env.CRO_MMO_PREVIEW_PORT || 8787);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid preview port');
console.log(
  `MMO local preview: http://localhost:${port}/\nFixed build: ${report.buildId}\nCamera controls excluded. Storage: .wrangler/state/mmo\nThis command runs locally and does not deploy.`,
);
const child = spawn(
  process.execPath,
  [
    'node_modules/wrangler/bin/wrangler.js',
    'dev',
    '--local',
    '--ip',
    '127.0.0.1',
    '--port',
    String(port),
    '--persist-to',
    '.wrangler/state/mmo',
  ],
  {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      WRANGLER_SEND_METRICS: 'false',
      WRANGLER_LOG_PATH: path.join(root, 'output/wrangler-logs'),
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
    },
  },
);
child.once('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code || 0;
});
process.once('SIGINT', () => child.kill('SIGINT'));
process.once('SIGTERM', () => child.kill('SIGTERM'));
