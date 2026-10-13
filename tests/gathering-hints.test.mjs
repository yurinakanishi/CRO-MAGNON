import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const repo = new URL('../', import.meta.url);
const { createGameCore } = await import(new URL('dist/application/game-core.mjs', repo));
const { GATHER_RANGE, interactionVisible } = await import(
  new URL('dist/shared/interactions.mjs', repo)
);
const { StableAssistTarget } = await import(new URL('dist/src/assisted-controls.js', repo));
const { contextCues } = await import(new URL('dist/src/input-cues.js', repo));
const { touchActions } = await import(new URL('dist/src/touch-input.js', repo));
const { interactionTarget } = await import(new URL('dist/src/interaction-target.js', repo));
const { WorldRenderer } = await import(new URL('dist/src/world3d.js', repo));
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
    campContribution: () => null,
    coastalInteraction: () => null,
    fishingInteraction: () => null,
    huntInteraction: () => null,
    caveFireInteraction: () => null,
    adventureInteraction: () => null,
    residentInteraction: () => null,
    gulfInteraction: () => null,
    GATHER_RANGE,
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
    { action: 'petMascot', label: 'しろbotを撫でる', targetId: 'white@p1#3' },
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

test('a berry bush the camera hides while the player stands in it stays a gathering target', () => {
  const f = fixture('berry', null);
  // The 1 m reach is inside the walk-through bush; the camera, looking at the player through
  // it, does not draw it this frame. The renderer's own check must still offer it.
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

test('gathering still hides outside range, behind obstacles, when depleted, full or unloaded', () => {
  for (const blocked of ['range', 'wall', 'empty', 'full', 'unloaded', 'downed', 'mounted']) {
    const f = fixture('stone', { action: 'petMascot', label: '撫でる', targetId: 'white@p1#1' });
    if (blocked === 'range') f.player.z = f.resource.z + GATHER_RANGE + 0.01;
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

test('gathering has an independent visible cue with companions, recall, inspection and combat competing for three slots', () => {
  const context = {
    pet: 'しろbotを撫でる',
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
