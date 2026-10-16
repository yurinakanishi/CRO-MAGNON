import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';
import { MASCOT_ROSTER } from '../dist/shared/mascot-roster.mjs';
import { TITLE_CREDITS, TITLE_DOTS, TITLE_FRIENDS } from '../dist/src/title-credit-profiles.js';
import { muralPeople, titleContributors } from '../dist/src/title-credits.js';
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
assert.ok(![...files].some((name) => name.startsWith('title/avatar-')));
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
assert.equal(build.credits, 'full');
assert.deepEqual(profiles.TITLE_CREDITS, TITLE_CREDITS);
// The dots are in every build, so their credit always ships.
assert.deepEqual(profiles.TITLE_DOTS, TITLE_DOTS);
const guestCredits = titleContributors()
  .filter((person) => person.role === '友情出演')
  .map((person) => person.key);
// Credits are the same common cast as the cave, independent of mascot availability.
const painted = muralPeople().map((person) => person.key);
assert.deepEqual(profiles.TITLE_FRIENDS, TITLE_FRIENDS);
// Exercise the actual shipped modules, including the creator-only exception.
const shipped = await import(
  pathToFileURL(path.resolve(buildRoot, 'dist-cloudflare/src/title-credits.js')).href
);
const listed = shipped.muralPeople();
assert.deepEqual(
  listed.map((person) => person.key),
  painted,
);
assert.deepEqual(
  listed,
  shipped
    .titleContributors()
    .filter((person) => person.key !== 'yuri')
    .map(({ key, name, profile }) => ({ key, name, profile })),
);
for (const markup of [
  shipped.muralPeopleDialogMarkup(listed),
  shipped.contributorsDialogMarkup(),
]) {
  assert.doesNotMatch(markup, /<img\b|avatar-/);
  assert.equal(
    (markup.match(/<svg class="contributor-x"/g) ?? []).length,
    (markup.match(/<a class="contributor"/g) ?? []).length,
  );
}
assert.deepEqual(
  shipped
    .titleContributors()
    .filter((person) => person.role === '友情出演')
    .map((person) => person.key),
  guestCredits,
);
const sourceCave = JSON.parse(await readFile('public/models/camp-cave/asset.json', 'utf8'));
const textures = runtimeTextureRecords(sourceCave);
// Each recorded master ships as its delivery from the build's ledger: a cooked derivative of
// exactly that master, or the master itself.
const ledger = new Map((build.delivery?.textures ?? []).map((t) => [t.master.url, t]));
for (const record of textures) {
  const entry = ledger.get(record.url);
  if (entry) assert.equal(entry.master.sha256, record.sha256, record.url);
  const shipped = entry?.delivery ?? record;
  const filename = shipped.url.slice(1);
  assert.ok(files.has(filename), shipped.url);
  const bytes = await readFile(`${buildRoot}/dist-cloudflare/${filename}`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), shipped.sha256, shipped.url);
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
  // Every enabled mascot is offered as a choice and nothing dormant is; no companion waits
  // in the world until someone chooses one.
  const offered = new Set(room.mascotKeys);
  for (const entry of MASCOT_ROSTER)
    assert.equal(
      offered.has(entry.modelKey === 'yellow-524-mascot' ? '524' : entry.modelKey),
      entry.enabled,
      entry.modelKey,
    );
  assert.deepEqual(room.companions, []);
  assert.deepEqual(room.orbBots, []);
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
