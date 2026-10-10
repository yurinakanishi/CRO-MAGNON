import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { chooseCompanionView, companionViewDistances } from '../dist/src/companion-view.js';
import { WorldRenderer } from '../dist/src/world3d.js';

test('closeups frame small companions fully in landscape and portrait without entering their body', () => {
  for (const radius of [0.16, 0.25, 0.425, 0.6])
    for (const aspect of [1280 / 800, 390 / 844, 844 / 390]) {
      const limits = companionViewDistances(radius, 57, aspect);
      const halfAngle = Math.asin(radius / limits.fit);
      const vertical = (57 * Math.PI) / 360;
      const horizontal = Math.atan(Math.tan(vertical) * aspect);
      assert.ok(halfAngle < vertical && halfAngle < horizontal, 'whole body fits both axes');
      assert.ok(limits.near > radius && limits.near < limits.fit && limits.fit < limits.far);
      assert.ok(limits.fit < 3.2, 'small companions can be framed closer than the old limit');
    }
});

test('a closeup only chooses a visible, unobstructed nearby companion', () => {
  const target = {
    id: 'cat',
    label: 'りもねこ',
    x: 2,
    z: 0,
    screenX: 0,
    screenY: 0,
    screenZ: 0.5,
    clear: true,
  };
  const player = { x: 0, z: 0 };
  for (const patch of [
    { clear: false },
    { x: 8.01 },
    { screenX: 1.01 },
    { screenY: -1.01 },
    { screenZ: 1.01 },
    { screenZ: -1.01 },
    { x: NaN },
    { screenX: NaN },
  ])
    assert.equal(chooseCompanionView([{ ...target, ...patch }], player), undefined);
  assert.equal(chooseCompanionView([target], player)?.id, 'cat');
  const candidates = [{ ...target, id: 'edge', screenX: 0.95 }, target];
  assert.equal(chooseCompanionView(candidates, player)?.id, 'cat');
  assert.equal(candidates[0].id, 'edge', 'ranking never mutates the renderer list');
});

/** chooseCompanionView before r10, verbatim: every candidate carries its traced `clear`. */
function eagerOrder(candidates, player) {
  return candidates
    .filter(
      (c) =>
        c.clear &&
        Math.hypot(c.x - player.x, c.z - player.z) <= 8 &&
        c.screenZ > -1 &&
        c.screenZ < 1 &&
        Math.abs(c.screenX) <= 1 &&
        Math.abs(c.screenY) <= 1,
    )
    .sort(
      (a, b) =>
        Math.hypot(a.x - player.x, a.z - player.z) +
        Math.hypot(a.screenX, a.screenY) * 2 -
        Math.hypot(b.x - player.x, b.z - player.z) -
        Math.hypot(b.screenX, b.screenY) * 2,
    )[0];
}

/** The eager selection: trace every candidate first, then choose as before. */
function eagerChoice(candidates, player, clear) {
  return eagerOrder(
    candidates.map((candidate) => ({ ...candidate, clear: clear(candidate), candidate })),
    player,
  )?.candidate;
}

/** In range and on screen, written out independently: the only companions worth a trace. */
function eligible(c, player) {
  return (
    Math.hypot(c.x - player.x, c.z - player.z) <= 8 &&
    c.screenZ > -1 &&
    c.screenZ < 1 &&
    Math.abs(c.screenX) <= 1 &&
    Math.abs(c.screenY) <= 1
  );
}

/** A sight-line test that records every companion it is asked about. */
function sightLines(blocked = new Set()) {
  const asked = [];
  return {
    asked,
    blocked,
    clear: (candidate) => {
      asked.push(candidate);
      return !blocked.has(candidate.id);
    },
  };
}

const placement = (id, patch = {}) => ({
  id,
  label: id,
  x: 0,
  z: -2,
  screenX: 0,
  screenY: 0,
  screenZ: 0.5,
  ...patch,
});

test('range and screen bounds are unchanged, and a companion outside them is never traced', () => {
  const player = { x: 1.5, z: -2 };
  const cases = [
    [{ x: 9.5 }, true],
    [{ x: -6.5 }, true],
    [{ x: 1.5, z: 6 }, true],
    [{ x: 9.5 + 1e-9 }, false],
    [{ x: 1.5, z: -10 - 1e-9 }, false],
    [{ screenX: 1 }, true],
    [{ screenX: -1 }, true],
    [{ screenY: 1 }, true],
    [{ screenY: -1 }, true],
    [{ screenX: 1 + 1e-9 }, false],
    [{ screenY: -1 - 1e-9 }, false],
    [{ screenZ: 1 - 1e-9 }, true],
    [{ screenZ: -1 + 1e-9 }, true],
    [{ screenZ: 1 }, false],
    [{ screenZ: -1 }, false],
    ...['x', 'z', 'screenX', 'screenY', 'screenZ'].flatMap((key) =>
      [NaN, Infinity, -Infinity].map((value) => [{ [key]: value }, false]),
    ),
  ];
  for (const [patch, inBounds] of cases)
    for (const obstructed of [false, true]) {
      const candidate = placement('cat', patch),
        lines = sightLines(new Set(obstructed ? ['cat'] : []));
      const chosen = chooseCompanionView([candidate], player, lines.clear),
        name = Object.entries(patch)
          .map(([key, value]) => `${key}=${value}`)
          .join(' ');
      assert.equal(chosen, inBounds && !obstructed ? candidate : undefined, name);
      assert.equal(
        chosen,
        eagerChoice([candidate], player, (c) => !obstructed || c.id !== 'cat'),
      );
      assert.deepEqual(lines.asked, inBounds ? [candidate] : []);
    }
  for (const nowhere of [
    { x: NaN, z: 0 },
    { x: 0, z: Infinity },
  ]) {
    const lines = sightLines();
    assert.equal(chooseCompanionView([placement('cat')], nowhere, lines.clear), undefined);
    assert.deepEqual(lines.asked, []);
  }
});

test('a blocked closest companion gives way to the next visible one; only those in view are traced', () => {
  const player = { x: 0, z: 0 };
  const far = placement('far', { x: 20 }),
    closest = placement('closest', { x: 1, z: 0 }),
    side = placement('side', { x: 2, screenX: 1.4 }),
    next = placement('next', { x: 3, z: 0, screenX: 0.2 }),
    behind = placement('behind', { x: 2, screenZ: 1.2 });
  const candidates = [far, closest, side, next, behind];
  const lines = sightLines(new Set(['closest']));
  const chosen = chooseCompanionView(candidates, player, lines.clear);
  assert.equal(chosen, next);
  assert.deepEqual(lines.asked, [closest, next], 'once each, in candidate order');
  assert.equal(
    chosen,
    eagerChoice(candidates, player, (c) => c.id !== 'closest'),
  );
  lines.blocked.clear();
  lines.asked.length = 0;
  assert.equal(chooseCompanionView(candidates, player, lines.clear), closest);
  assert.deepEqual(lines.asked, [closest, next]);
  // A caller that already traced keeps passing the flag.
  const flagged = candidates.map((c) => ({ ...c, clear: c.id !== 'closest' }));
  assert.equal(chooseCompanionView(flagged, player), flagged[3]);
});

test('equal companions keep their order, and choosing never mutates or annotates the inputs', () => {
  const player = { x: 0, z: 0 };
  const left = placement('left', { x: -2, z: 0, screenX: -0.5 }),
    right = placement('right', { x: 2, z: 0, screenX: 0.5 });
  for (const candidates of [
    [left, right],
    [right, left],
  ]) {
    const before = structuredClone(candidates),
      order = [...candidates],
      lines = sightLines();
    const chosen = chooseCompanionView(candidates, player, lines.clear);
    assert.equal(chosen, candidates[0], 'a tie keeps the first');
    assert.equal(
      chosen,
      eagerChoice(candidates, player, () => true),
    );
    lines.blocked.add(candidates[0].id);
    assert.equal(chooseCompanionView(candidates, player, lines.clear), candidates[1]);
    assert.deepEqual(candidates, before);
    candidates.forEach((candidate, i) => assert.equal(candidate, order[i]));
    assert.ok(candidates.every((candidate) => !('clear' in candidate)));
  }
});

test('companions that are all out of range or out of view are never traced', () => {
  const player = { x: 0, z: 0 };
  const candidates = [
    placement('far', { x: 40 }),
    placement('beyond', { x: 8, z: 0.01 }),
    placement('left', { x: 1, screenX: -1.3 }),
    placement('low', { x: 1, screenY: -2 }),
    placement('behind', { x: 1, screenZ: 1.0001 }),
    placement('near-plane', { x: 1, screenZ: -1 }),
  ];
  const lines = sightLines();
  assert.equal(chooseCompanionView(candidates, player, lines.clear), undefined);
  assert.equal(lines.asked.length, 0);
  let eagerTraces = 0;
  assert.equal(
    eagerChoice(candidates, player, () => (eagerTraces++, true)),
    undefined,
  );
  assert.equal(eagerTraces, candidates.length, 'the eager choice traced every one');
});

test('the lazy choice equals the eager choice on seeded random companion sets', () => {
  let seed = 0x5eed;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const pick = (...values) => values[Math.floor(random() * values.length)];
  let choices = 0;
  for (let round = 0; round < 3000; round++) {
    const player = { x: pick(0, 1.5, -40.25), z: pick(0, -2, 13.75) },
      candidates = [];
    for (let i = 0, n = 1 + Math.floor(random() * 11); i < n; i++) {
      // Some candidates repeat an earlier placement exactly: ties.
      const copy =
        candidates.length && random() < 0.2
          ? candidates[Math.floor(random() * candidates.length)]
          : null;
      candidates.push(
        copy
          ? { ...copy, id: `c${i}`, label: `c${i}` }
          : {
              id: `c${i}`,
              label: `c${i}`,
              x: player.x + pick(random() * 20 - 10, 8, -8, 0, NaN, Infinity),
              z: player.z + pick(random() * 20 - 10, 0, 8),
              screenX: pick(random() * 3 - 1.5, 1, -1, 0.5, -0.5, NaN),
              screenY: pick(random() * 3 - 1.5, 1, -1, 0),
              screenZ: pick(random() * 2.4 - 1.2, 1, -1, 0.5, NaN),
            },
      );
    }
    const blocked = new Set(candidates.filter(() => random() < 0.4).map((c) => c.id)),
      lines = sightLines(blocked);
    const chosen = chooseCompanionView(candidates, player, lines.clear),
      eager = eagerChoice(candidates, player, (c) => !blocked.has(c.id));
    assert.equal(chosen, eager, `round ${round}`);
    assert.deepEqual(
      lines.asked.map((c) => c.id),
      candidates.filter((c) => eligible(c, player)).map((c) => c.id),
      `round ${round}: traced`,
    );
    const flagged = candidates.map((c) => ({ ...c, clear: !blocked.has(c.id) }));
    assert.equal(flagged.indexOf(chooseCompanionView(flagged, player)), candidates.indexOf(chosen));
    if (chosen) choices++;
  }
  assert.ok(choices > 200, `the sets exercise real choices (${choices})`);
});

/** WorldRenderer.companionViewChoice before r10, written out: every companion traced first. */
function eagerWorldChoice(world, id) {
  const me = world.players.get(world.selfId)?.state;
  if (!me || me.downedUntil || me.boatId || me.mountId || me.carrierId) return;
  return eagerOrder(
    world
      .companionViewTargets()
      .filter((t) => !id || t.id === id)
      .map((t) => {
        const screen = t.point.clone().project(world.camera);
        return {
          ...t,
          x: t.point.x,
          z: t.point.z,
          screenX: screen.x,
          screenY: screen.y,
          screenZ: screen.z,
          clear: world.collision.segmentFree(me, t.point, 0.05),
        };
      }),
    me,
  );
}

/** What companionViewChoice reads of a WorldRenderer: the local player, a portrait camera just
 * behind them looking toward −z, orb bots as the companions, and colliders whose sight lines
 * are recorded and can be blocked per companion. */
function companionWorld(placements, me = { id: 'me', x: 10, z: 20 }) {
  const camera = new THREE.PerspectiveCamera(57, 390 / 844, 0.15, 360);
  camera.position.set(me.x, 2.2, me.z + 4.5);
  camera.lookAt(me.x, 0.8, me.z - 3);
  camera.updateMatrixWorld();
  const roots = new Map(),
    bots = new Map(),
    blocked = new Set(),
    traces = [];
  for (const [id, { x, z, mode = 'waiting' }] of Object.entries(placements)) {
    const root = new THREE.Object3D();
    root.position.set(x, 0, z);
    roots.set(id, root);
    const asset = { name: id, heightMetres: 0.4, widthMetres: 0.4, lengthMetres: 0.4 };
    bots.set(id, { state: { mode }, actor: { root, asset } });
  }
  const world = {
    selfId: me.id,
    players: new Map([[me.id, { state: me }]]),
    camera,
    state: {},
    friendRenderers: new Map(),
    orbBotRenderer: { bots },
    companionViewTargets: WorldRenderer.prototype.companionViewTargets,
    collision: {
      segmentFree(from, to, radius) {
        const [id] =
          [...roots].find(([, root]) => root.position.x === to.x && root.position.z === to.z) ?? [];
        traces.push({ id, from, radius });
        return !blocked.has(id);
      },
    },
  };
  return { world, me, roots, blocked, traces };
}

/** One choice by the world, checked against the eager choice from the same state. */
function choose(scene, id) {
  scene.traces.length = 0;
  const chosen = WorldRenderer.prototype.companionViewChoice.call(scene.world, id);
  const traced = scene.traces.splice(0);
  for (const trace of traced) {
    assert.equal(trace.from, scene.me, 'traced from the player');
    assert.equal(trace.radius, 0.05, 'the same sight-line radius');
  }
  const eager = eagerWorldChoice(scene.world, id);
  const eagerTraces = scene.traces.splice(0).length;
  assert.equal(chosen?.id, eager?.id, 'the same choice as tracing every companion first');
  return { chosen, traced: traced.map((trace) => trace.id), eagerTraces };
}

// The player stands at (10, 20); the camera looks toward −z from 4.5 m behind them.
const BOTS = {
  far: { x: 10, z: 5 },
  near: { x: 10.3, z: 18.5 },
  side: { x: 13, z: 18 },
  next: { x: 9.4, z: 17 },
  behind: { x: 10, z: 25.5 },
  edge: { x: 10, z: 12 },
  beyond: { x: 10, z: 12 - 1e-6 },
  thrown: { x: 10.1, z: 19, mode: 'airborne' },
  lost: { x: NaN, z: 20 },
};

test('the world never traces a companion out of range, out of view or not offered', () => {
  const { far, side, behind, beyond, thrown, lost } = BOTS;
  const result = choose(companionWorld({ far, side, behind, beyond, thrown, lost }));
  assert.equal(result.chosen, undefined);
  assert.deepEqual(result.traced, []);
  assert.equal(result.eagerTraces, 5, 'tracing every companion first cost five sight lines');
});

test('the world offers the best visible companion against the current colliders and positions', () => {
  const scene = companionWorld(BOTS);
  scene.blocked.add('near');
  let result = choose(scene);
  assert.equal(result.chosen.id, 'next');
  assert.equal(result.chosen.root, scene.roots.get('next'));
  assert.deepEqual(result.traced, ['near', 'next', 'edge'], 'the 8 m edge included');
  assert.equal(result.eagerTraces, 8);
  // An obstacle cleared between two calls.
  scene.blocked.delete('near');
  result = choose(scene);
  assert.equal(result.chosen.id, 'near');
  assert.deepEqual(result.traced, ['near', 'next', 'edge']);
  // A companion walked into view and the obstacles changed between calls.
  scene.roots.get('far').position.set(10.2, 0, 19);
  scene.blocked.add('next');
  result = choose(scene);
  assert.equal(result.chosen.id, 'far');
  assert.deepEqual(result.chosen.point.toArray(), [10.2, 0.2, 19]);
  assert.deepEqual(result.traced, ['far', 'near', 'next', 'edge']);
  scene.blocked.add('far');
  scene.blocked.add('near');
  assert.equal(choose(scene).chosen.id, 'edge');
  scene.blocked.add('edge');
  result = choose(scene);
  assert.equal(result.chosen, undefined);
  assert.deepEqual(result.traced, ['far', 'near', 'next', 'edge']);
});

test('the world keeps its player guards and id filter, tracing nothing it cannot offer', () => {
  for (const state of [
    { downedUntil: 1 },
    { boatId: 'boat-1' },
    { mountId: 'mammoth-1' },
    { carrierId: 'p2' },
  ]) {
    const result = choose(companionWorld(BOTS, { id: 'me', x: 10, z: 20, ...state }));
    assert.equal(result.chosen, undefined, Object.keys(state)[0]);
    assert.deepEqual(result.traced, []);
  }
  const scene = companionWorld(BOTS);
  scene.world.selfId = 'someone-else';
  let result = choose(scene);
  assert.equal(result.chosen, undefined);
  assert.deepEqual(result.traced, []);
  scene.world.selfId = 'me';
  result = choose(scene, 'next');
  assert.equal(result.chosen.id, 'next', 'the named companion, though another is closer');
  assert.deepEqual(result.traced, ['next']);
  result = choose(scene, 'far');
  assert.equal(result.chosen, undefined);
  assert.deepEqual(result.traced, []);
  scene.blocked.add('next');
  result = choose(scene, 'next');
  assert.equal(result.chosen, undefined);
  assert.deepEqual(result.traced, ['next']);
});
