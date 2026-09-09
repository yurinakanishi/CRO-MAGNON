import { watch } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let server,
  builder,
  timer,
  building = false,
  dirty = false,
  stopping = false;
const watchers = [];
async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  const stopped = once(child, 'exit');
  const deadline = setTimeout(() => child.kill(), 10000);
  try {
    if (child.connected)
      child.send('cro-shutdown', (error) => {
        if (error) child.kill();
      });
    else child.kill();
    const [code] = await stopped;
    if (code !== 0) throw new Error('Server could not save before stopping; restart cancelled.');
  } finally {
    clearTimeout(deadline);
  }
}

async function rebuild() {
  dirty = true;
  if (building || stopping) return;
  building = true;
  try {
    while (dirty && !stopping) {
      dirty = false;
      builder = spawn(process.execPath, ['scripts/build.mjs'], {
        cwd: root,
        stdio: 'inherit',
        windowsHide: true,
      });
      const [code] = await once(builder, 'exit');
      builder = undefined;
      if (code || stopping) continue;
      if (server) {
        await stopServer(server);
      }
      server = spawn(process.execPath, ['server.mjs'], {
        cwd: root,
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        windowsHide: true,
      });
      server.once('exit', () => {
        server = undefined;
      });
    }
  } finally {
    building = false;
  }
}

function changed(_event, filename) {
  if (!filename || !/\.(mts|ts|css|json)$/.test(filename)) return;
  clearTimeout(timer);
  timer = setTimeout(() => void rebuild().catch(fail), 200);
}
function fail(error) {
  console.error(error);
  shutdown();
  process.exitCode = 1;
}
async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer);
  for (const watcher of watchers) watcher.close();
  builder?.kill();
  await stopServer(server).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
for (const directory of ['src', 'shared', 'application', 'infrastructure', 'cloudflare']) {
  watchers.push(watch(path.join(root, directory), { recursive: true }, changed));
}
watchers.push(watch(root, changed));
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
await rebuild().catch(fail);
