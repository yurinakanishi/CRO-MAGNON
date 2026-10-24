import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createGameCore } from '../dist/application/game-core.mjs';
import { INITIAL_RESOURCES, VOLCANO_OBSIDIAN } from '../dist/shared/world.mjs';
import { WARP_POINTS } from '../dist/shared/warp-sites.mjs';
import { geographicBiome } from '../dist/shared/paleo-geography.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { gatherRange, interactionVisible } from '../dist/shared/interactions.mjs';
import { characterModel } from '../dist/shared/characters.mjs';
import { SCATTERED_HARVEST } from '../dist/shared/scenery-scatter.mjs';

const fire = WARP_POINTS.find((p) => p.id === 'fire-volcano');
const nearFire = (r, distance) => Math.hypot(r.x - fire.x, r.z - fire.z) < distance;
// The volcano stop's own stone and wood piles.
const stone = INITIAL_RESOURCES.find((r) => r.type === 'stone' && nearFire(r, 15));
const wood = INITIAL_RESOURCES.find((r) => r.type === 'wood' && nearFire(r, 15));
const BODIES = { human: 0.32, ape: characterModel({ species: 'ape' }).radius };

class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  messages = [];
  send(data) {
    this.messages.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.emit('close');
  }
  command(message) {
    this.emit('message', Buffer.from(JSON.stringify(message)), false);
  }
}

// The nearest free ground with a clear reach to the pile.
function standing(collision, resource, radius) {
  for (let d = 0.3; d <= gatherRange({ radius }) + 1e-9; d += 0.02)
    for (let a = 0; a < 360; a += 4) {
      const p = {
        x: resource.x + Math.sin((a * Math.PI) / 180) * d,
        z: resource.z + Math.cos((a * Math.PI) / 180) * d,
      };
      if (collision.free(p, radius) && interactionVisible(collision, p, resource)) return p;
    }
  return null;
}
// Free ground connects beside the fire to the place (0.5 m grid, eight neighbours).
function walkable(collision, to, radius) {
  let from = null;
  for (let r = 2.5; !from && r < 8; r += 0.5)
    for (let a = 0; !from && a < 360; a += 10) {
      const p = {
        x: fire.x + Math.sin((a * Math.PI) / 180) * r,
        z: fire.z + Math.cos((a * Math.PI) / 180) * r,
      };
      if (collision.free(p, radius)) from = p;
    }
  const step = 0.5,
    key = (i, j) => (i + 100) * 1000 + j + 100;
  const ti = Math.round((to.x - from.x) / step),
    tj = Math.round((to.z - from.z) / step);
  const queue = [[0, 0]],
    seen = new Set([key(0, 0)]);
  for (let head = 0; head < queue.length; head++) {
    const [i, j] = queue[head];
    if (Math.abs(i - ti) <= 1 && Math.abs(j - tj) <= 1) return true;
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      const ni = i + di,
        nj = j + dj;
      if (Math.abs(ni) > 90 || Math.abs(nj) > 90 || seen.has(key(ni, nj))) continue;
      seen.add(key(ni, nj));
      if (collision.free({ x: from.x + ni * step, z: from.z + nj * step }, radius))
        queue.push([ni, nj]);
    }
  }
  return false;
}

test('three obsidian outcrops stand just south of the West Asian volcanic fire, beside its stone and wood', () => {
  const collision = new CollisionWorld();
  assert.equal(VOLCANO_OBSIDIAN.length, 3);
  const centre = {
    x: VOLCANO_OBSIDIAN.reduce((s, r) => s + r.x, 0) / 3,
    z: VOLCANO_OBSIDIAN.reduce((s, r) => s + r.z, 0) / 3,
  };
  for (const r of VOLCANO_OBSIDIAN) {
    assert.ok(INITIAL_RESOURCES.includes(r), r.id);
    assert.deepEqual([r.type, r.amount, r.maxAmount], ['obsidian', 8, 8]);
    assert.equal(geographicBiome(r.x, r.z), 'volcano', r.id);
    const distance = Math.hypot(r.x - fire.x, r.z - fire.z);
    assert.ok(distance > 10 && distance < 18, `${r.id} ${distance.toFixed(1)} m from the fire`);
    assert.ok(r.z > fire.z, `${r.id} is south of the fire (+z)`);
    // Its own model only: no tree, column, tent or other pile within a walk-around margin.
    assert.ok(
      collision.free(r, 1.2, [], (o) => o.resourceId === r.id),
      `${r.id} stands on clear ground`,
    );
    for (const other of VOLCANO_OBSIDIAN)
      if (other !== r) assert.ok(Math.hypot(other.x - r.x, other.z - r.z) > 3.5);
    // Placed after the scenery was scattered; it reshapes none of it.
    assert.equal(SCATTERED_HARVEST.includes(r), false);
  }
  // A whole spear's materials in one place: obsidian, a hammerstone and a haft.
  assert.ok(stone && wood);
  for (const pile of [stone, wood])
    assert.ok(Math.hypot(pile.x - centre.x, pile.z - centre.z) < 12, pile.id);
});

test('a human-sized and the broad ape body can each mine every outcrop, and the ape walks there from the fire', () => {
  const collision = new CollisionWorld();
  for (const r of VOLCANO_OBSIDIAN)
    for (const [body, radius] of Object.entries(BODIES)) {
      const spot = standing(collision, r, radius);
      assert.ok(spot, `${body} beside ${r.id}`);
      if (body === 'ape') assert.ok(walkable(collision, spot, radius), `ape walks to ${r.id}`);
    }
});

test('at the volcano a human mines two obsidian, knaps a blade on the local stone and hafts a spear with the local wood; the ape mines too', () => {
  let now = 100000,
    id = 0;
  const core = createGameCore({
    runtime: { now: () => now, id: () => `obsidian-${++id}`, token: () => `obsidian-t-${++id}` },
  });
  const humanSocket = new Socket(),
    apeSocket = new Socket();
  core.connect(
    humanSocket,
    new URLSearchParams({ room: 'OBSIDIAN', name: 'h', species: 'cro', gender: 'male' }),
  );
  core.connect(
    apeSocket,
    new URLSearchParams({ room: 'OBSIDIAN', name: 'a', species: 'ape', gender: 'male' }),
  );
  const room = core.rooms.get('OBSIDIAN');
  const [human, ape] = [...room.players.values()];
  assert.equal(characterModel(ape).key, 'giant-ape');
  const gather = (socket, player, resource) => {
    Object.assign(player, standing(room.collision, resource, player.radius));
    now += 1000;
    socket.command({ type: 'action', action: 'gather', targetId: resource.id });
  };
  const [first, second, third] = VOLCANO_OBSIDIAN.map((r) => room.resourceById.get(r.id));
  const before = structuredClone(human.inventory);
  gather(humanSocket, human, first);
  gather(humanSocket, human, second);
  gather(humanSocket, human, room.resourceById.get(stone.id));
  gather(humanSocket, human, room.resourceById.get(wood.id));
  assert.equal(human.inventory.obsidian, (before.obsidian ?? 0) + 2);
  assert.equal(human.inventory.stone, before.stone + 1);
  assert.equal(human.inventory.wood, before.wood + 1);
  assert.deepEqual([first.amount, second.amount], [7, 7]);
  for (const recipe of ['blade', 'spear']) {
    now += 1000;
    humanSocket.command({ type: 'action', action: 'inventoryCraft', targetId: recipe });
  }
  assert.equal(human.spearHead, 'obsidian');
  assert.equal(human.inventory.obsidian, before.obsidian ?? 0);
  assert.equal(human.inventory.obsidianBlade, 0);
  assert.equal(human.inventory.stone, before.stone + 1, 'the hammerstone is kept');
  assert.equal(human.inventory.wood, before.wood);
  gather(apeSocket, ape, third);
  assert.equal(ape.inventory.obsidian, 1);
  assert.equal(third.amount, 7);
  core.close();
});

test('an older checkpoint without the outcrops resumes with all three full and its other piles as saved', () => {
  let id = 0;
  const options = {
    persistentSessions: true,
    keepEmptyRooms: true,
    runtime: { now: () => 100000, id: () => `old-${++id}`, token: () => `old-t-${++id}` },
  };
  const core = createGameCore(options);
  core.connect(new Socket(), new URLSearchParams({ room: 'OLD', name: 'o', resume: '1' }));
  const saved = core.exportState();
  for (const room of saved.rooms) {
    room.resources = room.resources.filter((r) => r.type !== 'obsidian');
    room.resources.find((r) => r.id === stone.id).amount = 3;
  }
  const restored = createGameCore(options);
  restored.importState(saved);
  const room = restored.rooms.get('OLD');
  for (const r of VOLCANO_OBSIDIAN) assert.equal(room.resourceById.get(r.id).amount, 8, r.id);
  assert.equal(room.resourceById.get(stone.id).amount, 3);
  core.close();
  restored.close();
});
