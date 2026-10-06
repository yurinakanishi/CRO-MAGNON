// Read-only release audit plus memory-only actions against the actual MMO Worker modules.
import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { auditEnvironmentDirectory } from './environment-assets.mjs';
import { createGameCore } from '../dist-cloudflare-worker/application/game-core.mjs';
const report = JSON.parse(await readFile('output/cloudflare-build.json', 'utf8'));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
assert.equal(
  report.buildId,
  sha(JSON.stringify({ publicFiles: report.publicFiles, workerFiles: report.workerFiles })),
);
const audit = await auditEnvironmentDirectory(
  path.resolve('dist-cloudflare'),
  report.publicFiles.map((file) => file.path),
  report.profile,
);
for (const [directory, files] of [
  ['dist-cloudflare', report.publicFiles],
  ['dist-cloudflare-worker', report.workerFiles],
])
  for (const file of files) {
    const bytes = await readFile(path.join(directory, file.path));
    assert.equal(bytes.length, file.bytes, file.path);
    assert.equal(sha(bytes), file.sha256, file.path);
  }
assert.equal(
  report.publicFiles.some((file) => file.path === 'src/maritime-ui.js'),
  false,
);
assert.equal(
  await stat('dist-cloudflare/src/maritime-ui.js').then(
    () => true,
    () => false,
  ),
  false,
);
assert.equal(
  (await readFile('dist-cloudflare/src/boat-ui.js', 'utf8')).includes('installMaritimeUI'),
  false,
);
class Socket {
  readyState = 1;
  bufferedAmount = 0;
  messages = [];
  handlers = {};
  on(event, fn) {
    this.handlers[event] = fn;
  }
  send(text) {
    this.messages.push(JSON.parse(text));
  }
  close() {
    this.readyState = 3;
    this.handlers.close?.();
  }
  input(message) {
    this.handlers.message(Buffer.from(JSON.stringify(message)), false);
  }
}
const core = createGameCore({ keepEmptyRooms: true }),
  peers = Array.from({ length: 5 }, () => new Socket());
let restored;
try {
  for (let i = 0; i < peers.length; i++)
    core.connect(
      peers[i],
      new URLSearchParams({ room: 'BOAT-BUILD-QA', name: `P${i}`, resume: '1' }),
    );
  const room = core.rooms.get('BOAT-BUILD-QA'),
    p = [...room.players.values()][0];
  p.inventory.wood = 12;
  const action = (name) => {
    p.lastAction = 0;
    peers[0].input({ type: 'action', action: name });
  };
  action('craftBoat');
  assert.equal(p.inventory.boat, 1);
  assert.equal(p.inventory.wood, 0);
  assert.equal(room.boats.length, 0);
  Object.assign(p, { x: 138, z: 112 });
  action('launchBoat');
  assert.equal(p.inventory.boat, 0);
  assert.equal(room.boats.length, 1);
  action('boardBoat');
  assert.ok(p.boatId);
  action('recoverBoat');
  assert.equal(room.boats.length, 1);
  assert.equal(p.inventory.boat, 0);
  action('boardBoat');
  assert.equal(p.boatId, null);
  action('recoverBoat');
  assert.equal(room.boats.length, 0);
  assert.equal(p.inventory.boat, 1);
  action('recoverBoat');
  assert.equal(p.inventory.boat, 1);
  for (const peer of peers) {
    const state = peer.messages.filter((message) => message.type === 'state').at(-1);
    assert.equal(state.boatingVersion, 2);
    assert.equal(state.boats.length, 0);
    assert.equal(state.players.find((player) => player.id === p.id).inventory.boat, 1);
  }
  const saved = core.exportState();
  restored = createGameCore({ keepEmptyRooms: true });
  restored.importState(saved);
  const session = peers[0].messages.find((message) => message.type === 'welcome').session,
    newPeer = new Socket();
  restored.connect(newPeer, new URLSearchParams({ room: 'BOAT-BUILD-QA', resume: '1', session }));
  assert.equal(restored.rooms.get('BOAT-BUILD-QA').players.get(p.id).inventory.boat, 1);
} finally {
  core.close();
  restored?.close();
}
const result = {
  status: 'passed',
  buildId: report.buildId,
  publicFiles: report.publicFiles.length,
  workerFiles: report.workerFiles.length,
  audit,
  workerActions:
    'craft, launch, board, land, recover, duplicate recovery, five-peer synchronization, durable inventory restore',
  removed: 'src/maritime-ui.js',
};
await writeFile('output/boat-inventory-build-audit-20261006.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
