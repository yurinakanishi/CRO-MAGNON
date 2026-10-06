import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { CAMP_CAVE, CAVE_APPROACH, caveWorldAt } from '../dist/shared/camp-cave-layout.mjs';
import { walkHeight } from '../dist/shared/terrain.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { spawnSite } from '../dist/shared/spawn-sites.mjs';
import {
  CAVE_EXTRA_PIGMENTS,
  CAVE_UPCOMING_CHARACTERS,
  CAVE_MURALS,
} from '../dist/src/cave-gallery-layout.js';
test('camp reaches the relocated cave at ground level without the castle climb', () => {
  const collision = new CollisionWorld();
  let previous = { x: 48, z: 57 };
  for (const next of [...CAVE_APPROACH, ...[5, 0, -5, -10, -15, -25].map((z) => caveWorldAt(z))]) {
    assert.ok(collision.segmentFree(previous, next, 0.76), `blocked ${JSON.stringify(next)}`);
    for (let t = 0; t <= 1; t += 0.025) {
      const h = walkHeight(
        previous.x + (next.x - previous.x) * t,
        previous.z + (next.z - previous.z) * t,
      );
      assert.ok(Math.abs(h) < 0.65, `not ground level: ${h}`);
    }
    previous = next;
  }
  assert.equal(spawnSite('cave').name, 'アプデの洞窟');
  assert.equal(CAMP_CAVE.elevation, 0);
  assert.ok(collision.free(spawnSite('cave'), 0.76));
});
test('all extra friezes retain the original generated RGBA bytes and registered subjects', async () => {
  const asset = JSON.parse(await readFile('public/models/camp-cave/asset.json'));
  for (const [key, pigment] of Object.entries(CAVE_EXTRA_PIGMENTS)) {
    const record = asset.mascotPigments[key];
    assert.deepEqual(record.subjects, pigment.subjects);
    for (const path of [record.source, 'public' + record.url]) {
      const bytes = await readFile(path);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
      assert.equal(bytes[25], 6);
    }
    assert.ok(CAVE_MURALS.some((m) => m.motif === key));
  }
  assert.deepEqual(CAVE_UPCOMING_CHARACTERS, [], 'do not invent forthcoming characters');
  assert.ok(CAVE_MURALS.some((m) => m.motif === 'comingSoon'));
});
