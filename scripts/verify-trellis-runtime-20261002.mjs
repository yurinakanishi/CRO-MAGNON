import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import assert from 'node:assert/strict';
const folder = path.resolve('output/trellis-update-20261002');
const installation = JSON.parse(await readFile(path.join(folder, 'installation.json'), 'utf8'));
const cli = path.join(installation.root, 'runtime/trellis-cli.exe');
const server = path.join(installation.root, 'runtime/trellis-server.exe');
const models = path.join(installation.root, 'models');
const source = path.resolve('assets/rimo-neko/source/user-reference.jpg');
const sha = (b) => createHash('sha256').update(b).digest('hex');
await mkdir(path.join(folder, 'smoke'), { recursive: true });
const report = {
  checkedAt: new Date().toISOString(),
  release: installation.release,
  cliSha256: sha(await readFile(cli)),
  sourceSha256: sha(await readFile(source)),
  new3DModelGenerated: false,
  generatedAssetsOrWeightsModified: false,
};
await writeFile(
  path.join(folder, 'gpu.txt'),
  spawnSync(
    'nvidia-smi.exe',
    ['--query-gpu=name,driver_version,memory.total,memory.used', '--format=csv'],
    { encoding: 'utf8', windowsHide: true },
  ).stdout ?? 'GPU query unavailable',
);
const help = spawnSync(cli, ['--help'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
await writeFile(
  path.join(folder, 'cli-installed-help.txt'),
  (help.stdout ?? '') + (help.stderr ?? ''),
);
assert.equal(help.status, 0);
report.cliHelpExitCode = help.status;
const out = path.join(folder, 'smoke/cuda-birefnet.glb');
const command = [
  '--image',
  source,
  '--output',
  out,
  '--models',
  models,
  '--model',
  'trellis',
  '--bg-removal',
  'birefnet',
  '--bg-only',
  '--gpu',
  '0',
  '--require-gpu',
  '--threads',
  '8',
];
const log = await open(path.join(folder, 'smoke/cuda-birefnet.log'), 'w');
const started = Date.now();
const child = spawn(cli, command, { windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
const timeout = setTimeout(() => child.kill(), 180000);
try {
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  report.cudaBackgroundRemoval = {
    command,
    exitCode: code,
    seconds: (Date.now() - started) / 1000,
  };
  assert.equal(code, 0);
} finally {
  clearTimeout(timeout);
  await log.close();
}
const cutout = out.replace(/\.glb$/, '_cutout.png');
const png = await readFile(cutout);
assert.equal(png.readUInt32BE(0), 0x89504e47);
report.cudaBackgroundRemoval.image = {
  path: cutout,
  width: png.readUInt32BE(16),
  height: png.readUInt32BE(20),
  bytes: png.length,
  sha256: sha(png),
};
console.log(
  JSON.stringify({ cuda: 'passed', seconds: report.cudaBackgroundRemoval.seconds, cutout }),
);

const listener = net.createServer();
await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const serverLog = await open(path.join(folder, 'smoke/server.log'), 'w');
const service = spawn(
  server,
  [
    '--models',
    models,
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--gpu',
    '0',
    '--require-gpu',
  ],
  { windowsHide: true, stdio: ['ignore', serverLog.fd, serverLog.fd] },
);
const finished = new Promise((resolve) => service.once('close', resolve));
let startupError;
service.once('error', (e) => {
  startupError = e;
});
try {
  let health;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError;
    if (service.exitCode !== null) throw new Error(`Server exited: ${service.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) {
        health = (await response.text()).trim();
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(health, 'ok');
  report.server = { host: '127.0.0.1', port, health, pid: service.pid, ownedProcessStopped: false };
} finally {
  if (service.exitCode === null) service.kill();
  await finished;
  await serverLog.close();
  if (report.server) report.server.ownedProcessStopped = true;
}
report.result = 'passed';
await writeFile(path.join(folder, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ result: report.result, server: report.server }));
