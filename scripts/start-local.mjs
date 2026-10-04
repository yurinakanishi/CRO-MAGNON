import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { verifyOfflineBuild } from './exhibition-integrity.mjs';
import { readLocalVisibility } from '../dist/infrastructure/node/local-visibility.mjs';
import { createPersistentGameServer } from '../dist/server.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let game,
  closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  try {
    await game?.close();
  } catch (error) {
    console.error('Final save failed:', error.message);
    process.exitCode = 1;
  } finally {
    if (process.connected) process.disconnect();
  }
}
function openBrowser(url) {
  if (process.env.CRO_OPEN_BROWSER === '0') return;
  const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
    windowsHide: true,
    detached: true,
    stdio: 'ignore',
  });
  child.on('error', () => console.log(`Open ${url} in Chrome or Edge.`));
  child.unref();
}
async function main() {
  const port = Number(process.env.CRO_LOCAL_PORT || 3000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid local port.');
  console.log('CRO-MAGNON local / verifying the bundled game...');
  const manifest = await verifyOfflineBuild(root, 'local-build.json');
  const publicBuild = JSON.parse(
    await readFile(path.join(root, 'public/local-build.json'), 'utf8'),
  );
  if (publicBuild.mode !== 'local' || publicBuild.buildId !== manifest.buildId)
    throw Error('Local build identity mismatch. Extract the original ZIP again.');
  const visibility = await readLocalVisibility(path.join(root, 'local-visibility.json'));
  const url = `http://localhost:${port}/`;
  const running = await fetch(`${url}local-build.json`, { signal: AbortSignal.timeout(1500) })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  if (closing) return;
  if (running?.buildId === manifest.buildId) {
    console.log(`Already running: ${url}`);
    openBrowser(url);
    return;
  }
  game = await createPersistentGameServer({
    port,
    host: '127.0.0.1',
    visibility,
    saveDirectory: process.env.CRO_LOCAL_SAVE_DIR || path.join(root, '.cro-magnon-save'),
    enableRoomReset: true,
  });
  if (closing) {
    await game.close();
    return;
  }
  await game.listen();
  console.log(
    `Ready: ${url}\nBuild: ${manifest.buildId}\nKeep this window open. Ctrl+C saves and closes the game.`,
  );
  openBrowser(url);
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
process.on('message', (message) => {
  if (message === 'cro-shutdown') void stop();
});
if (process.connected) process.once('disconnect', () => void stop());
main().catch(async (error) => {
  console.error(error.message);
  if (error.code === 'EADDRINUSE')
    console.error('That port is already used. The existing game was left running.');
  await stop();
  process.exitCode = 1;
});
