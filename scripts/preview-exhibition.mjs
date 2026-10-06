import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { verifyExhibition } from './exhibition-integrity.mjs';

if (!process.argv[2])
  throw new Error(
    'Use npm run preview:exhibition -- output/environments/exhibition/<build-folder>',
  );
const root = path.resolve(process.argv[2]);
const manifest = await verifyExhibition(root);
const profile = JSON.parse(await readFile(path.join(root, 'public/build-profile.json'), 'utf8'));
if (profile.environment !== 'exhibition' || !profile.cameraControls)
  throw new Error('An exhibition release is required.');
const { createGameServer } = await import(pathToFileURL(path.join(root, 'dist/server.mjs')).href);
const { EXHIBITION_PLAYER_LIMIT } = await import(
  pathToFileURL(path.join(root, 'dist/shared/room-rules.mjs')).href
);
const port = Number(process.env.CRO_EXHIBITION_PREVIEW_PORT || 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid preview port');
const game = createGameServer({
  port,
  host: '127.0.0.1',
  assetRoot: root,
  exhibition: true,
  environment: 'exhibition',
  playerLimit: EXHIBITION_PLAYER_LIMIT,
  expectedBuild: manifest.buildId,
  runtimeConfig: {
    mode: 'lan',
    serverUrl: `ws://localhost:${port}/ws`,
    room: 'EXHIBITION',
    guestName: '展示確認',
    buildId: manifest.buildId,
  },
});
await game.listen();
console.log(
  `Exhibition preview: http://localhost:${port}/\nFixed build: ${manifest.buildId}\nNo visit data is saved. LAN launchers in this release remain available.`,
);
let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  await game.close();
  if (process.connected) process.disconnect();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
process.on('message', (message) => {
  if (message === 'cro-shutdown') void stop();
});
if (process.connected) process.once('disconnect', stop);
