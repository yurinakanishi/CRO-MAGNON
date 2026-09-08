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
        const stopped = once(server, 'exit');
        server.kill('SIGTERM');
        await stopped;
      }
      server = spawn(process.execPath, ['server.mjs'], {
        cwd: root,
        stdio: 'inherit',
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
function shutdown() {
  stopping = true;
  clearTimeout(timer);
  for (const watcher of watchers) watcher.close();
  builder?.kill();
  server?.kill('SIGTERM');
}
for (const directory of ['src', 'shared', 'application', 'infrastructure', 'cloudflare']) {
  watchers.push(watch(path.join(root, directory), { recursive: true }, changed));
}
watchers.push(watch(root, changed));
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
await rebuild().catch(fail);
