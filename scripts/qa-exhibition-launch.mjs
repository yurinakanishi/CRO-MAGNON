import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
const root = path.resolve(process.argv[2] || 'output/exhibition-r01');
const reportPath = path.resolve('assets/exhibition-lan/launch-qa.json');
const executable = path.join(root, 'runtime/node.exe');
const children = [],
  checks = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function port() {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const number = server.address().port;
  await new Promise((r) => server.close(r));
  return number;
}
function launch(role, env) {
  const child = spawn(executable, ['scripts/start-exhibition.mjs', role], {
    cwd: root,
    env: { ...process.env, OPEN_BROWSER: '0', ...env },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const record = { child, output: '', exit: undefined };
  child.stdout.on('data', (data) => (record.output += data));
  child.stderr.on('data', (data) => (record.output += data));
  child.on('exit', (code) => (record.exit = code));
  children.push(record);
  return record;
}
async function wait(record, predicate) {
  const deadline = Date.now() + 25000;
  while (!predicate(record)) {
    if (Date.now() > deadline) throw new Error(record.output);
    await sleep(50);
  }
}
try {
  const serverPort = await port(),
    hostPort = await port(),
    clientPort = await port();
  const badIp = launch('host', {
    MULTIPLAYER_SERVER_URL: `ws://10.254.254.254:${serverPort}`,
    CLIENT_PORT: String(hostPort),
  });
  await wait(badIp, (r) => r.exit !== undefined);
  assert.equal(badIp.exit, 1);
  assert.match(badIp.output, /Ethernet does not have/);
  checks.push({ check: 'missing host IP is explicit', output: badIp.output });
  const url = `ws://127.0.0.1:${serverPort}`;
  const host = launch('host', { MULTIPLAYER_SERVER_URL: url, CLIENT_PORT: String(hostPort) });
  await wait(host, (r) => r.output.includes('WebSocket endpoint verified locally'));
  const health = await (await fetch(`http://127.0.0.1:${serverPort}/api/health`)).json();
  assert.equal(health.mode, 'lan');
  assert.equal(health.players, 0);
  checks.push({
    check: 'bundled runtime host binds and passes WebSocket probe',
    output: host.output,
  });
  const conflict = launch('host', { MULTIPLAYER_SERVER_URL: url, CLIENT_PORT: String(clientPort) });
  await wait(conflict, (r) => r.exit !== undefined);
  assert.equal(conflict.exit, 1);
  assert.match(conflict.output, /Port already in use/);
  assert.equal((await fetch(`http://127.0.0.1:${serverPort}/api/health`)).status, 200);
  checks.push({
    check: 'duplicate host refuses occupied port and preserves first server',
    output: conflict.output,
  });
  const client = launch('client', { MULTIPLAYER_SERVER_URL: url, CLIENT_PORT: String(clientPort) });
  await wait(client, (r) => r.output.includes('Server reachable at'));
  const config = await (
    await fetch(`http://127.0.0.1:${clientPort}/multiplayer-config.json`)
  ).json();
  assert.equal(config.guestName, 'Player 2');
  assert.equal(config.serverUrl, url + '/');
  checks.push({ check: 'PC2 launcher serves local client and finds PC1', output: client.output });
} finally {
  for (const r of children) if (r.exit === undefined) r.child.kill();
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(
    reportPath,
    JSON.stringify({ at: new Date().toISOString(), root, checks, physicalPC2: false }, null, 2),
  );
}
console.log(`Launcher checks passed: ${checks.length}`);
