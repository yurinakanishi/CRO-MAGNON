import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ALL_MASCOT_MODELS } from '../dist/shared/mascot-roster.mjs';
import { FRIEND_MASCOTS, GROUND_MASCOTS } from '../dist/shared/friend-mascots.mjs';
import { MASCOT_KEYS } from '../dist/shared/mascot-selection.mjs';
import { mascotMenuMarkup } from '../dist/src/mascot-menu.js';
import { titleContributors, CONTRIBUTOR_CHARACTERS } from '../dist/src/title-credits.js';
import { CAVE_EXTRA_PIGMENTS, CAVE_MURALS } from '../dist/src/cave-gallery-layout.js';
import { mascotCore } from './mascot-fixture.mjs';
import { companionBehavior } from './companion-behavior.mjs';
for (const def of GROUND_MASCOTS.filter((d) => !['mae', 'maruimo-mascot'].includes(d.key)))
  companionBehavior(def.key);

test('retained friends can be restored as selectable cards and keep credits, paintings and verified GLBs', async () => {
  for (const def of FRIEND_MASCOTS) assert.ok(MASCOT_KEYS.includes(def.key));
  const w = mascotCore(undefined, { mascotModels: ALL_MASCOT_MODELS });
  w.join();
  const markup = mascotMenuMarkup(w.room().mascotKeys);
  w.core().close();
  for (const def of FRIEND_MASCOTS) assert.match(markup, new RegExp(`data-mascot="${def.key}"`));
  const people = new Map(titleContributors().map((p) => [p.key, p]));
  for (const def of FRIEND_MASCOTS) {
    const person = people.get(def.credit);
    if (person) assert.ok(person.profile.startsWith('https://x.com/'), def.credit);
    assert.equal(CONTRIBUTOR_CHARACTERS[def.credit].name, def.name);
    assert.ok(
      Object.values(CAVE_EXTRA_PIGMENTS).some((p) => p.subjects.includes(def.key)),
      `${def.key} is painted`,
    );
    const assetPath = `public/models/${def.key}/asset.json`;
    if (!existsSync(assetPath)) continue;
    const asset = JSON.parse(await readFile(assetPath, 'utf8'));
    assert.equal(asset.kind, def.key === 'howkey-scientist' ? 'humanoid' : 'companion');
    for (const record of [asset, ...asset.lods]) {
      const bytes = await readFile('public' + record.url);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
    }
    assert.ok(Math.abs(asset.heightMetres - def.bodyHeight) < 0.02, def.key);
  }
  for (const key of ['friendsMeadow', 'friendsRiver'])
    assert.ok(CAVE_MURALS.some((m) => m.motif === key && m.wall === 'west'));
  assert.equal(people.has('risa'), false);
  assert.equal(people.has('hawkie'), false);
  assert.equal(CONTRIBUTOR_CHARACTERS.risa.name, 'こはくちゃん');
  assert.equal(CONTRIBUTOR_CHARACTERS.hawkie.name, 'Howkey');
});
