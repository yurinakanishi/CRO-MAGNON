// Audit an already built, isolated MMO package; never build, upload or open user saves.
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
const root = process.argv[2];
if (!root) throw new Error('Pass the isolated build root containing cloudflare-build.json');
const build = JSON.parse(await readFile(`${root}/cloudflare-build.json`, 'utf8'));
const keys = ['neanderthal-woman', 'neanderthal-hunter'];
assert.ok(build.dormantCharacters.includes('nea'));
assert.ok(build.characters.every((model) => model.species !== 'nea'));
const browser = `${root}/dist-cloudflare`,
  worker = `${root}/dist-cloudflare-worker`;
const catalog = JSON.parse(await readFile(`${browser}/models/world-assets.json`, 'utf8'));
assert.ok(catalog.assets.every((asset) => !keys.includes(asset.modelKey)));
assert.ok(
  build.publicFiles.every((file) => !keys.some((key) => file.path.startsWith(`models/${key}/`))),
);
assert.ok(
  build.models.every((model) => !keys.some((key) => model.url.includes(`/models/${key}/`))),
);
for (const file of ['shared/character-profiles.mjs', 'src/style.css']) {
  const text = await readFile(`${browser}/${file}`, 'utf8');
  for (const key of keys) assert.ok(!text.includes(key), `${file}: ${key}`);
}
const retained = [];
for (const key of keys) {
  const asset = JSON.parse(await readFile(`public/models/${key}/asset.json`, 'utf8'));
  for (const record of [asset, ...asset.lods]) {
    const bytes = await readFile(`public${record.url}`);
    assert.equal(bytes.length, record.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
    retained.push({ modelKey: key, url: record.url, bytes: record.bytes, sha256: record.sha256 });
  }
}
const { createGameCore } = await import(
  pathToFileURL(path.resolve(worker, 'application/game-core.mjs'))
);
const { CHARACTER_ROSTER } = await import(
  pathToFileURL(path.resolve(worker, 'shared/character-roster.mjs'))
);
class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  messages = [];
  send(text) {
    this.messages.push(JSON.parse(text));
  }
  close() {
    this.readyState = 3;
    this.emit('close');
  }
}
const options = { persistentSessions: true, keepEmptyRooms: true };
const core = createGameCore(options);
const peers = [];
let restored;
try {
  for (let i = 0; i < 5; i++) {
    const socket = new Socket();
    core.connect(
      socket,
      new URLSearchParams({
        room: 'RELEASE',
        resume: '1',
        species: 'nea',
        gender: i % 2 ? 'male' : 'female',
      }),
    );
    peers.push(socket);
  }
  const room = core.rooms.get('RELEASE');
  assert.equal(room.players.size, 5);
  const state = core.snapshot(room, true);
  assert.equal(state.npc, undefined);
  assert.ok(state.players.every((p) => p.species === 'cro' && !p.unavailableCharacter));
  const saved = core.exportState();
  assert.ok(
    saved.rooms[0].sessions.every(
      (session) => session.player.unavailableCharacter.species === 'nea',
    ),
  );
  // Test the retained server definitions, in memory; the saved source switch stays false.
  CHARACTER_ROSTER[0].enabled = true;
  restored = createGameCore(options);
  restored.importState(saved);
  assert.ok(
    [...restored.rooms.get('RELEASE').sessions.values()].every(
      (session) => session.player.species === 'nea' && !session.player.unavailableCharacter,
    ),
  );
} finally {
  CHARACTER_ROSTER[0].enabled = false;
  core.close();
  restored?.close();
}
const report = {
  status: 'passed',
  buildId: build.buildId,
  publicFiles: build.files,
  publicBytes: build.bytes,
  publicCharacters: build.characters.map((model) => model.key),
  omittedModelDirectories: keys,
  retained,
  omittedMasterBytes: retained.reduce((sum, record) => sum + record.bytes, 0),
  note: 'Master GLB byte count only, not a before/after compressed package or performance measurement.',
  worker:
    'Five connections exclude the dormant characters and trader; private appearances restore from a checkpoint after enabling the in-memory roster.',
};
await writeFile(`${root}/neanderthal-release-qa.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
