import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';
import { MASCOT_ROSTER, mascotCreditReleased } from '../dist/shared/mascot-roster.mjs';
import {
  TITLE_CREDITS,
  TITLE_GUEST,
  TITLE_SUPPORT,
  TITLE_FRIENDS,
} from '../dist/src/title-credit-profiles.js';
import { runtimeTextureRecords } from './environment-assets.mjs';

const buildRoot = process.argv[2] || '.';
const build = JSON.parse(
  await readFile(
    buildRoot === '.' ? 'output/cloudflare-build.json' : `${buildRoot}/cloudflare-build.json`,
    'utf8',
  ),
);
const files = new Set(build.publicFiles.map((file) => file.path));
assert.ok(![...files].some((name) => name.startsWith('title/qr-')));
const catalog = JSON.parse(
  await readFile(`${buildRoot}/dist-cloudflare/models/world-assets.json`, 'utf8'),
);
assert.ok(build.characters.every((model) => model.species !== 'howkey'));
assert.equal(
  [...files].some((name) => name.startsWith('models/howkey-flask/')),
  MASCOT_ROSTER.find((entry) => entry.modelKey === 'howkey-scientist').enabled,
);
for (const entry of MASCOT_ROSTER) {
  assert.equal(
    catalog.assets.some((asset) => asset.modelKey === entry.modelKey),
    entry.enabled,
    entry.modelKey,
  );
  if (!entry.enabled) {
    assert.ok(
      ![...files].some((name) => name.startsWith(`models/${entry.modelKey}/`)),
      entry.modelKey,
    );
    // Keep the original accepted model and metadata ready for a future release.
    const asset = JSON.parse(await readFile(`public/models/${entry.modelKey}/asset.json`, 'utf8'));
    await access(`public${asset.url}`);
  }
}
const profiles = await import(
  pathToFileURL(path.resolve(buildRoot, 'dist-cloudflare/src/title-credit-profiles.js')).href
);
assert.deepEqual(
  profiles.TITLE_CREDITS,
  build.credits === 'full' ? TITLE_CREDITS : TITLE_CREDITS.slice(0, 1),
);
for (const person of profiles.TITLE_CREDITS)
  assert.ok(files.has(`title/avatar-${person.qr}.jpg`), person.qr);
const guestCredits = [TITLE_GUEST, TITLE_SUPPORT, ...TITLE_FRIENDS]
  .filter((person) => mascotCreditReleased(person.qr))
  .map((person) => person.qr);
assert.deepEqual(
  profiles.TITLE_FRIENDS,
  TITLE_FRIENDS.filter((p) => mascotCreditReleased(p.qr)),
);
for (const key of [
  'maruimo',
  'mae',
  'risa',
  'saber',
  'fairy',
  'sagasa',
  'hawkie',
  'asahina',
].filter((key) => !guestCredits.includes(key)))
  assert.ok(
    ![...files].some((name) => new RegExp(`^title/(?:qr|avatar)-${key}\\.`).test(name)),
    key,
  );
const sourceCave = JSON.parse(await readFile('public/models/camp-cave/asset.json', 'utf8'));
const textures = runtimeTextureRecords(sourceCave);
for (const record of textures) {
  const filename = record.url.slice(1);
  assert.ok(files.has(filename), record.url);
  const bytes = await readFile(`${buildRoot}/dist-cloudflare/${filename}`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256, record.url);
}
// Exercise the actual generated Worker rules without ports, user saves or uploads.
const { createGameCore } = await import(
  pathToFileURL(path.resolve(buildRoot, 'dist-cloudflare-worker/application/game-core.mjs')).href
);
class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  send() {}
  close() {
    this.readyState = 3;
    this.emit('close');
  }
}
const core = createGameCore();
try {
  for (let i = 0; i < 5; i++)
    core.connect(new Socket(), new URLSearchParams({ room: 'ROSTER', species: 'howkey' }));
  const room = core.rooms.get('ROSTER');
  assert.equal(room.players.size, 5);
  const snapshot = core.snapshot(room);
  assert.ok(snapshot.players.every((p) => p.species !== 'howkey'));
  for (const [field, key] of [
    ['mae', 'mae'],
    ['kohaku', 'kohaku'],
    ['maruimo', 'maruimo-mascot'],
  ])
    assert.equal(!!room[field], MASCOT_ROSTER.find((entry) => entry.modelKey === key).enabled);
  assert.ok(
    room.friends.every((f) =>
      MASCOT_ROSTER.some((entry) => entry.modelKey === f.key && entry.enabled),
    ),
  );
  assert.ok(room.rimoNeko && room.companion524);
} finally {
  core.close();
}
console.log(
  JSON.stringify({
    buildId: build.buildId,
    dormantModelsExcluded: MASCOT_ROSTER.filter((entry) => !entry.enabled).length,
    allCaveTexturesPreserved: textures.length,
    guestCredits,
    supervisorCredits: profiles.TITLE_CREDITS.slice(1).map((person) => person.qr),
    generatedWorkerPlayers: 5,
    forgedHowkeyRefused: true,
  }),
);
