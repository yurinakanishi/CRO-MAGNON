import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const repo = new URL('../', import.meta.url);
const { createGameCore } = await import(new URL('dist/application/game-core.mjs', repo));
const { GATHER_RANGE, gatherDistance, gatherRange, interactionVisible } = await import(
  new URL('dist/shared/interactions.mjs', repo)
);
const { characterModel } = await import(new URL('dist/shared/characters.mjs', repo));
const { StableAssistTarget } = await import(new URL('dist/src/assisted-controls.js', repo));
const { contextCues } = await import(new URL('dist/src/input-cues.js', repo));
const { touchActions } = await import(new URL('dist/src/touch-input.js', repo));
const { interactionTarget } = await import(new URL('dist/src/interaction-target.js', repo));
const { WorldRenderer } = await import(new URL('dist/src/world3d.js', repo));
const { CollisionWorld } = await import(new URL('dist/shared/collision.mjs', repo));
const main = await readFile(new URL('dist/src/main.js', repo), 'utf8');
const nearbySource = main.slice(
  main.indexOf('function nearby()'),
  main.indexOf('function updateHUD()'),
);

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
function fixture(kind, pet, assisting = false) {
  let now = 100000,
    id = 0;
  const core = createGameCore({
    runtime: { now: () => now, id: () => `gather-${++id}`, token: () => `session-${++id}` },
  });
  const socket = new Socket();
  core.connect(socket, new URLSearchParams({ room: 'GATHER', name: '旅人' }));
  const room = core.rooms.get('GATHER');
  const player = [...room.players.values()][0];
  const resource = room.resources.find((r) => r.type === kind);
  const spot = Array.from({ length: 16 }, (_, n) => n)
    .map((n) => ({
      x: resource.x + Math.sin((n * Math.PI) / 8) * 0.98,
      z: resource.z + Math.cos((n * Math.PI) / 8) * 0.98,
    }))
    .find(
      (p) =>
        room.collision.free(p, player.radius) && interactionVisible(room.collision, p, resource),
    );
  assert.ok(spot, 'the real resource has a reachable side');
  Object.assign(player, spot);
  const state = { ...core.snapshot(room, true), resources: [resource] };
  const context = {
    state,
    fixedIdentity: true,
    assistedControls: () => assisting,
    player: () => player,
    preferredPet: () => pet,
    renderer: {
      collision: room.collision,
      resourceVisible: () => true,
      serverNow: () => now,
      setAssistMarker() {},
    },
    coastalInteraction: () => null,
    fishingInteraction: () => null,
    huntInteraction: () => null,
    caveFireInteraction: () => null,
    adventureInteraction: () => null,
    residentInteraction: () => null,
    gulfInteraction: () => null,
    gatherDistance,
    gatherRange,
    interactionVisible,
    interactionTarget,
    distance: (a, b) => Math.hypot(a.x - b.x, a.z - b.z),
    assistScore: () => 1,
    interactionAssist: new StableAssistTarget(),
    performance: { now: () => now },
  };
  return {
    core,
    room,
    player,
    socket,
    resource,
    context,
    hint: () => vm.runInNewContext(`${nearbySource}\nnearby()`, context),
    advance: () => {
      now += 1000;
    },
  };
}

test('nearby companions cannot replace the actual gathering hint or E / right face-button target', () => {
  // Any companion, one's own or someone else's, is stroked with the same action.
  const pets = [
    { action: 'petMascot', label: 'りもねこを撫でる', targetId: 'rimo-neko@p1#1' },
    { action: 'petMascot', label: '524を撫でる', targetId: '524@p2#2' },
    { action: 'petMascot', label: 'しろdotを撫でる', targetId: 'white@p1#3' },
    { action: 'petMascot', label: 'maeを撫でる', targetId: 'mae@p3#4' },
    { action: 'petMascot', label: 'こはくちゃんを撫でる', targetId: 'kohaku@p4#5' },
  ];
  for (const kind of ['wood', 'stone', 'berry'])
    for (const pet of pets)
      for (const assisting of [false, true]) {
        const f = fixture(kind, pet, assisting);
        const hint = f.hint();
        assert.equal(
          hint?.action,
          'gather',
          `${kind}, ${JSON.stringify(pet)}, assisted=${assisting}`,
        );
        assert.equal(hint.targetId, f.resource.id);
        const before = f.player.inventory[kind] ?? 0;
        const amount = f.resource.amount;
        f.socket.command({ type: 'action', action: hint.action, targetId: hint.targetId });
        assert.equal(f.player.inventory[kind], before + 1);
        assert.equal(f.resource.amount, amount - 1);
        f.core.close();
      }
});

test('a loaded berry bush stays a gathering target independently of the last drawn frame', () => {
  const f = fixture('berry', null);
  // The 1 m reach is inside the walk-through bush. Even before the renderer updates the
  // model's visibility, the input must offer a loaded, nonempty target at the player's feet.
  Object.assign(f.player, { x: f.resource.x, z: f.resource.z });
  const world = {
    resources: new Map([[f.resource.id, { model: { visible: false }, resource: f.resource }]]),
  };
  f.context.renderer.resourceVisible = (id) =>
    WorldRenderer.prototype.resourceVisible.call(world, id);
  const hint = f.hint();
  assert.equal(hint?.action, 'gather');
  assert.equal(hint.targetId, f.resource.id);
  f.resource.amount = 0;
  assert.equal(f.hint() ?? null, null, 'an emptied bush is no target');
  f.resource.amount = 3;
  world.resources.clear();
  assert.equal(f.hint() ?? null, null, 'a bush not loaded yet is no target');
  f.core.close();
});

for (const kind of ['wood', 'stone'])
  test(`${kind} can be gathered from all unobstructed sides of real piles, including beyond 1m from their centres`, () => {
    const f = fixture(kind, null);
    let checked = 0,
      formerlyUnreachable = 0;
    try {
      for (const resource of f.room.resources.filter((r) => r.type === kind).slice(0, 3)) {
        f.context.state.resources = [resource];
        for (let i = 0; i < 16; i++) {
          const angle = (i * Math.PI) / 8;
          // Find the first body-clear position along this side of the actual collision box.
          let point;
          for (let distance = 0; distance < 2; distance += 0.01) {
            const p = {
              x: resource.x + Math.sin(angle) * distance,
              z: resource.z + Math.cos(angle) * distance,
            };
            if (
              f.room.collision.free(p, f.player.radius) &&
              interactionVisible(f.room.collision, p, resource)
            ) {
              point = p;
              break;
            }
          }
          if (!point) continue; // Another real obstacle blocks this approach.
          for (const assisting of [false, true]) {
            f.context.assistedControls = () => assisting;
            resource.amount = resource.maxAmount;
            f.player.inventory[kind] = 0;
            Object.assign(f.player, point);
            const hint = f.hint();
            assert.equal(
              hint?.targetId,
              resource.id,
              `${resource.id}, side ${i}, assisted=${assisting}`,
            );
            assert.equal(hint.action, 'gather');
            assert.ok(
              touchActions({ interaction: hint.label }).some((a) => a.action === 'interact'),
            );
            f.socket.command({ type: 'action', action: hint.action, targetId: hint.targetId });
            assert.equal(f.player.inventory[kind], 1);
            assert.equal(resource.amount, resource.maxAmount - 1);
            f.advance();
          }
          checked++;
          if (Math.hypot(point.x - resource.x, point.z - resource.z) > GATHER_RANGE)
            formerlyUnreachable++;
        }
      }
      assert.equal(checked, 48);
      assert.ok(formerlyUnreachable > 0, 'covers the old centre-distance bug');
    } finally {
      f.core.close();
    }
  });

test('gathering still hides outside range, behind obstacles, when depleted, full or unloaded', () => {
  for (const blocked of ['range', 'wall', 'empty', 'full', 'unloaded', 'downed', 'mounted']) {
    const f = fixture('stone', { action: 'petMascot', label: '撫でる', targetId: 'white@p1#1' });
    if (blocked === 'range') f.player.z = f.resource.z + GATHER_RANGE + 3;
    if (blocked === 'wall') f.context.renderer.collision = { segmentFree: () => false };
    if (blocked === 'empty') f.resource.amount = 0;
    if (blocked === 'full') f.player.inventory.stone = 99;
    if (blocked === 'unloaded') f.context.renderer.resourceVisible = () => false;
    if (blocked === 'downed') f.player.downedUntil = 110000;
    if (blocked === 'mounted') f.player.mountId = 'mammoth';
    assert.equal(f.hint() ?? null, null, blocked);
    f.core.close();
  }
});

test('the outside edge has the same strict limit for the hint and authoritative collection', () => {
  const ape = characterModel({ species: 'ape' });
  for (const kind of ['wood', 'stone']) {
    const f = fixture(kind, null);
    try {
      const obstacle = f.room.collision.obstacles.find((o) => o.resourceId === f.resource.id);
      f.context.renderer.collision = f.room.collision = new CollisionWorld([obstacle]);
      // One metre for a human; the broad ape's longer reach also counts from the pile's edge.
      for (const radius of [f.player.radius, ape.radius]) {
        f.player.radius = radius;
        const reach = gatherRange(f.player);
        for (const [gap, accepted] of [
          [reach - 0.001, true],
          [reach + 0.001, false],
        ]) {
          Object.assign(f.player, {
            x: obstacle.x + obstacle.c * (obstacle.hx + gap),
            z: obstacle.z - obstacle.s * (obstacle.hx + gap),
          });
          assert.equal(f.hint()?.action === 'gather', accepted);
          const before = f.player.inventory[kind];
          f.socket.command({ type: 'action', action: 'gather', targetId: f.resource.id, range: 99 });
          assert.equal(f.player.inventory[kind], before + Number(accepted));
          f.advance();
        }
      }
      assert.equal(gatherRange({ radius: ape.radius }) > GATHER_RANGE, true);
    } finally {
      f.core.close();
    }
  }
});

test('the broad ape gathers every wood, stone and obsidian pile from where its body can stand', () => {
  const ape = characterModel({ species: 'ape' });
  // Its 0.76 m body stays more than 1 m from every pile's centre; reach counts from its edge.
  const standing = (room, resource) => {
    for (let d = 0.6; d <= gatherRange(ape) + 1e-9; d += 0.02)
      for (let a = 0; a < 360; a += 5) {
        const p = {
          x: resource.x + Math.sin((a * Math.PI) / 180) * d,
          z: resource.z + Math.cos((a * Math.PI) / 180) * d,
        };
        if (room.collision.free(p, ape.radius) && interactionVisible(room.collision, p, resource))
          return p;
      }
    return null;
  };
  for (const kind of ['wood', 'stone']) {
    const f = fixture(kind, null);
    if (kind === 'wood')
      for (const resource of f.room.resources.filter((r) => r.type !== 'berry'))
        assert.ok(standing(f.room, resource), resource.id);
    Object.assign(f.player, standing(f.room, f.resource), {
      species: ape.species,
      gender: ape.gender,
      character: ape.key,
      radius: ape.radius,
    });
    const hint = f.hint();
    assert.equal(hint?.action, 'gather', kind);
    const before = f.player.inventory[kind];
    f.socket.command({ type: 'action', action: 'gather', targetId: hint.targetId });
    assert.equal(f.player.inventory[kind], before + 1, kind);
    f.core.close();
  }
  assert.equal(gatherRange({ radius: 0.32 }), GATHER_RANGE);
  assert.equal(gatherRange({}), GATHER_RANGE);
});

test('gathering has an independent visible cue with companions, recall, inspection and combat competing for three slots', () => {
  const context = {
    pet: 'しろdotを撫でる',
    interaction: '石を採集する',
    recall: true,
    inspect: 'りもねこ',
    attack: true,
    jump: true,
    throw: true,
  };
  for (const pad of [false, true]) {
    const cues = contextCues(context, pad);
    assert.equal(cues.length, 3);
    assert.ok(cues.some((c) => c.action === 'pet'));
    assert.ok(cues.some((c) => c.action === 'recall'));
    assert.ok(
      cues.some((c) => c.action === 'interact' && c.key === 'E' && c.controls.includes('b1')),
    );
  }
  const actions = touchActions(context);
  assert.ok(actions.some((a) => a.action === 'pet'));
  assert.ok(actions.some((a) => a.action === 'interact' && a.label === '石を採集する'));
});
