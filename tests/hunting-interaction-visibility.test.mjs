import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { caveWorldAt } from '../dist/shared/camp-cave-layout.mjs';
import { CROP_INVENTORY } from '../dist/shared/crops.mjs';
import {
  HUNTING,
  huntingDistance,
  nearestHuntTarget,
  usableCookingFire,
} from '../dist/shared/hunting.mjs';
import { huntInteraction } from '../dist/src/hunting-ui.js';

// The oracle: inventoryCounts and huntInteraction exactly as the frozen phase2a build shipped
// them (output/optimization-audit-20261009/phase2a-build-review-r01/dist/src/hunting-ui.js),
// over the unchanged shared hunting rules. It traces visibility to every animal.
function baselineInventoryCounts(inventory = {}) {
    return Object.fromEntries([
        ...CROP_INVENTORY,
        'wood',
        'stone',
        'berry',
        'rawMeat',
        'cookedMeat',
        'obsidian',
        'seed',
        'water',
        'rawFish',
        'cookedFish',
        'rawShellfish',
        'cookedShellfish',
        'shells',
        'obsidianBlade',
        'boat',
    ].map((key) => [key, Math.max(0, Number(inventory[key]) || 0)]));
}
function baselineHuntInteraction(state, player, collision) {
    const inventoryCounts = baselineInventoryCounts;
    if (!player || player.mountId || player.downedUntil)
        return null;
    if (player.cookingEndsAt)
        return { action: 'cancelCook', label: '調理を中止する' };
    const meat = nearestHuntTarget((state.animals || []).filter((animal) => !collision || collision.segmentFree(player, animal, 0.12)), player, 'meat');
    if (meat && huntingDistance(player, meat) <= HUNTING.harvestRange) {
        return {
            action: 'harvest',
            targetId: meat.id,
            label: `生肉を採る（残り${meat.meatRemaining}個）`,
        };
    }
    const fire = usableCookingFire(state, player, collision);
    const inv = inventoryCounts(player.inventory);
    if (inv.rawRoot && fire)
        return { action: 'cropFoodOpen', label: '火根の焼き方を選ぶ' };
    if ((inventoryCounts(player.inventory).rawMeat ||
        inventoryCounts(player.inventory).rawFish ||
        inventoryCounts(player.inventory).rawShellfish) &&
        fire) {
        return inventoryCounts(player.inventory).rawMeat
            ? { action: 'cook', label: '焚き火で生肉を焼く（3秒）' }
            : inventoryCounts(player.inventory).rawFish
                ? { action: 'cookFish', label: '焚き火で生魚を焼く（3秒）' }
                : { action: 'cookShellfish', label: '焚き火で貝を焼く（3秒）' };
    }
    return null;
}

// A real CollisionWorld that records which targets it traced visibility to, and how many
// points it tested along the way (every step of a segment walk calls free()).
class CountingWorld extends CollisionWorld {
  constructor(...args) {
    super(...args);
    this.watch([]);
  }
  watch(animals) {
    this.animals = new Set(animals);
    this.traced = [];
    this.fireTraces = 0;
    this.points = 0;
  }
  segmentFree(a, b, ...rest) {
    if (this.animals.has(b)) this.traced.push(b.id);
    else this.fireTraces++;
    return super.segmentFree(a, b, ...rest);
  }
  free(...args) {
    this.points++;
    return super.free(...args);
  }
}
const wall = (x, z, hx, hz) => ({ id: `wall-${x}-${z}`, type: 'box', x, z, hx, hz, c: 1, s: 0, height: 2 });
// Open ground with one thin wall east of the player at (10,10): x 10.9-11.1, z 8.5-11.5.
const walledWorld = () =>
  new CountingWorld([wall(11, 10, 0.1, 1.5)], { coast: false, walkSurfaces: [] });
const openWorld = () => new CountingWorld([], { coast: false, walkSurfaces: [] });

// Runs the current function and the oracle on the same state and world; they must agree.
function interact(state, player, world) {
  world?.watch(state.animals || []);
  const result = huntInteraction(state, player, world);
  const current = world && {
    traced: world.traced,
    fireTraces: world.fireTraces,
    points: world.points,
  };
  world?.watch(state.animals || []);
  const expected = baselineHuntInteraction(state, player, world);
  const baseline = world && {
    traced: world.traced,
    fireTraces: world.fireTraces,
    points: world.points,
  };
  if (!isDeepStrictEqual(result, expected))
    assert.deepStrictEqual(result, expected, JSON.stringify({ state, player }));
  if (world) assert.equal(current.fireTraces, baseline.fireTraces, 'the fire is traced as before');
  return { result, current, baseline };
}

const meat = (id, x, z, meatRemaining = 3) => ({ id, phase: 'meat', x, z, meatRemaining });
const P = () => ({ id: 'p', x: 10, z: 10, inventory: {} });
const harvest = (id, left) => ({ action: 'harvest', targetId: id, label: `生肉を採る（残り${left}個）` });
const COOK = { action: 'cook', label: '焚き火で生肉を焼く（3秒）' };

test('only meat within harvest range is traced, and the nearest visible one is harvested', () => {
  const world = openWorld(),
    animals = [
      { id: 'alive', phase: 'alive', x: 10.5, z: 10 },
      { id: 'dying', phase: 'dying', x: 9, z: 10 },
      meat('far', 30, 10),
      meat('near', 9, 11.5, 2),
      { id: 'respawning', phase: 'respawning', x: 10, z: 10.5 },
      meat('nearest', 8.5, 10, 1),
      meat('outside', 10, 13),
    ];
  for (let i = 0; i < 24; i++)
    animals.push({ id: `herd-${i}`, phase: 'alive', x: 30 + i * 3, z: 40, radius: 1.9 });
  const { result, current, baseline } = interact({ camp: { x: 50, z: 50 }, animals }, P(), world);
  assert.deepEqual(result, harvest('nearest', 1));
  assert.deepEqual(current.traced, ['near', 'nearest']);
  assert.equal(baseline.traced.length, animals.length, 'the frozen code traced every animal');
  assert.ok(current.points < baseline.points);
});

test('with nothing harvestable no animal is traced at all', () => {
  const world = openWorld(),
    animals = [meat('far', 13, 10), meat('farther', 40, 40)];
  for (let i = 0; i < 12; i++)
    animals.push({ id: `mammoth-${i}`, phase: i % 3 ? 'alive' : 'dying', x: 20 + i * 5, z: 30 });
  const { result, current, baseline } = interact({ camp: { x: 50, z: 50 }, animals }, P(), world);
  assert.equal(result, null);
  assert.deepEqual(current.traced, []);
  assert.equal(current.points, 0, 'no collision traversal (the camp fire is out of cooking range)');
  assert.equal(baseline.traced.length, animals.length);
  assert.ok(baseline.points > 100, `${baseline.points} points tested by the frozen code`);
});

test('equal distances keep array order; through-wall meat is never chosen', () => {
  const world = walledWorld();
  // Exactly 1.5 m from the player, in both orders.
  const north = meat('north', 10, 11.5),
    south = meat('south', 10, 8.5);
  assert.deepEqual(interact({ animals: [north, south] }, P(), world).result, harvest('north', 3));
  assert.deepEqual(interact({ animals: [south, north] }, P(), world).result, harvest('south', 3));
  // The nearest meat lies behind the wall; the farther visible meat is taken instead.
  const hidden = meat('behind-wall', 11.6, 10),
    visible = meat('visible', 8, 10, 4);
  const through = interact({ animals: [hidden, visible] }, P(), world);
  assert.deepEqual(through.result, harvest('visible', 4));
  assert.deepEqual(through.current.traced, ['behind-wall', 'visible']);
  // Only hidden meat in range: no harvest, and nothing to cook with.
  assert.equal(interact({ animals: [hidden] }, P(), world).result, null);
});

test('blocked meat in range and visible meat out of range fall through to cooking', () => {
  const world = walledWorld(),
    player = { ...P(), inventory: { rawMeat: 1 } },
    state = {
      animals: [meat('behind-wall', 11.6, 10), meat('visible-far', 7, 10)],
      cookingFires: [{ id: 'hearth', x: 9, z: 11 }],
    };
  const { result, current, baseline } = interact(state, player, world);
  assert.deepEqual(result, COOK);
  assert.deepEqual(current.traced, ['behind-wall']);
  assert.deepEqual(baseline.traced, ['behind-wall', 'visible-far']);
  assert.equal(current.fireTraces, 1);
  // A fire behind the wall cannot be used either.
  const shut = { ...state, cookingFires: [{ id: 'hearth', x: 12, z: 10 }] };
  assert.equal(interact(shut, player, world).result, null);
});

test('cooking priority, labels and the early returns are unchanged and trace nothing', () => {
  const world = walledWorld(),
    fire = { cookingFires: [{ id: 'hearth', x: 9, z: 11 }] },
    near = meat('near', 9, 10, 1);
  const cases = [
    [{ rawRoot: 1, rawMeat: 1 }, { action: 'cropFoodOpen', label: '火根の焼き方を選ぶ' }],
    [{ rawMeat: 2, rawFish: 1 }, COOK],
    [{ rawFish: 1, rawShellfish: 1 }, { action: 'cookFish', label: '焚き火で生魚を焼く（3秒）' }],
    [{ rawShellfish: '2' }, { action: 'cookShellfish', label: '焚き火で貝を焼く（3秒）' }],
    [{ rawMeat: -1, rawFish: 'x' }, null],
    [undefined, null],
  ];
  for (const [inventory, expected] of cases)
    assert.deepEqual(interact({ ...fire, animals: [] }, { ...P(), inventory }, world).result, expected);
  // Harvest comes before cooking; the label reports what is left, whatever it is.
  for (const left of [4, 1, 0, undefined])
    assert.deepEqual(
      interact({ ...fire, animals: [{ ...near, meatRemaining: left }] }, { ...P(), inventory: { rawMeat: 1 } }, world)
        .result,
      harvest('near', left),
    );
  for (const [player, expected] of [
    [{ ...P(), cookingEndsAt: 5000 }, { action: 'cancelCook', label: '調理を中止する' }],
    [{ ...P(), mountId: 'mammoth-1', cookingEndsAt: 5000 }, null],
    [{ ...P(), downedUntil: 9000 }, null],
    [null, null],
    [undefined, null],
  ]) {
    const { result, current } = interact({ ...fire, animals: [near] }, player, world);
    assert.deepEqual(result, expected);
    assert.deepEqual(current, { traced: [], fireTraces: 0, points: 0 });
  }
});

test('without a collision world every meat counts as visible, and state.collision serves the fire', () => {
  const state = { animals: [meat('a', 11.6, 10), meat('b', 8, 10)], camp: { x: 9, z: 11 } };
  assert.deepEqual(interact(state, P()).result, harvest('a', 3));
  assert.equal(interact({ animals: undefined }, P()).result, null);
  const world = walledWorld(),
    cooking = { animals: [], cookingFires: [{ id: 'f', x: 12, z: 10 }], collision: world };
  world.watch([]);
  assert.equal(huntInteraction(cooking, { ...P(), inventory: { rawMeat: 1 } }), null);
  assert.equal(world.fireTraces, 1, 'the fire behind the wall was traced with state.collision');
  assert.equal(baselineHuntInteraction(cooking, { ...P(), inventory: { rawMeat: 1 } }), null);
});

test('the exact harvest range and order-dependent NaN distances behave as before', () => {
  const world = openWorld(),
    origin = { id: 'p', x: 0, z: 0, inventory: {} },
    edge = meat('edge', HUNTING.harvestRange, 0),
    beyond = meat('beyond', 2.2000000000000006, 0);
  assert.equal(huntingDistance(origin, edge), 2.2);
  assert.deepEqual(interact({ animals: [edge] }, origin, world).result, harvest('edge', 3));
  assert.equal(interact({ animals: [beyond] }, origin, world).result, null);
  assert.deepEqual(interact({ animals: [beyond, edge] }, origin, world).current.traced, ['edge']);
  // A meat without a position measures NaN. Chosen first, it is never replaced and fails the
  // range check, hiding the meat at hand; after a real distance it is ignored.
  const lost = { id: 'lost', phase: 'meat', meatRemaining: 1 },
    hand = meat('hand', 9, 10);
  assert.equal(interact({ animals: [lost, hand] }, P(), world).result, null);
  assert.deepEqual(interact({ animals: [hand, lost] }, P(), world).result, harvest('hand', 3));
  const spread = interact({ animals: [meat('far', 40, 10), hand, lost] }, P(), world);
  assert.deepEqual(spread.current.traced, ['far', 'hand', 'lost'], 'with a NaN all meat is traced');
  // A player without a position: every distance is NaN.
  const nowhere = { id: 'p', inventory: {} };
  assert.equal(interact({ animals: [hand, lost] }, nowhere, world).result, null);
});

// A seeded generator, so every run compares the same states.
function generator(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (low, high) => low + (high - low) * next(),
    pick: (list) => list[Math.floor(next() * list.length)],
    int: (low, high) => low + Math.floor(next() * (high - low + 1)),
  };
}

function randomState(rng, centre) {
  const player = {
    id: 'p',
    x: centre.x + rng.range(-5, 5),
    z: centre.z + rng.range(-5, 5),
    inventory: Object.fromEntries(
      ['rawMeat', 'rawFish', 'rawShellfish', 'rawRoot']
        .filter(() => rng.next() < 0.3)
        .map((key) => [key, rng.int(0, 3)]),
    ),
  };
  const roll = rng.next();
  if (roll < 0.03) player.cookingEndsAt = 1000;
  else if (roll < 0.05) player.mountId = 'mammoth-0';
  else if (roll < 0.07) player.downedUntil = 2000;
  const animals = [];
  for (let i = 0, n = rng.int(0, 14); i < n; i++) {
    const animal = {
      id: `a${i}`,
      phase: rng.pick(['alive', 'dying', 'meat', 'meat', 'meat', 'respawning']),
      meatRemaining: rng.int(0, 4),
      radius: rng.pick([0.6, 1.9]),
    };
    const kind = rng.next();
    if (kind < 0.15 && animals.length) {
      // A tie: the same position as an earlier animal.
      const other = rng.pick(animals);
      Object.assign(animal, { x: other.x, z: other.z });
    } else if (kind < 0.25) {
      // On the harvest circle, give or take a rounding.
      const angle = rng.pick([0, Math.PI / 2, Math.PI, rng.range(0, Math.PI * 2)]);
      animal.x = player.x + Math.cos(angle) * HUNTING.harvestRange * rng.pick([1, 1 - 1e-12, 1 + 1e-12]);
      animal.z = player.z + Math.sin(angle) * HUNTING.harvestRange;
    } else if (kind < 0.27) {
      // Unmeasurable or infinitely far.
      Object.assign(animal, rng.pick([{}, { x: NaN, z: player.z }, { x: Infinity, z: player.z }]));
    } else {
      animal.x = player.x + rng.range(-4, 4) * rng.pick([1, 1, 2, 6]);
      animal.z = player.z + rng.range(-4, 4) * rng.pick([1, 1, 2, 6]);
    }
    animals.push(animal);
  }
  const state = { camp: { x: 50, z: 50 }, animals };
  if (rng.next() < 0.5)
    state.cookingFires = [{ id: 'fire', x: player.x + rng.range(-4, 4), z: player.z + rng.range(-4, 4) }];
  if (rng.next() < 0.03) state.animals = undefined;
  return { state, player };
}

test('randomized states over real collision worlds choose exactly as the frozen code', (t) => {
  const rng = generator(20261009),
    worlds = [
      { name: 'walled', world: walledWorld(), centre: { x: 10, z: 10 } },
      { name: 'camp', world: new CountingWorld(), centre: { x: 50, z: 50 } },
      { name: 'cave mouth', world: new CountingWorld(), centre: caveWorldAt(12) },
      { name: 'none', world: undefined, centre: { x: 10, z: 10 } },
    ];
  const totals = { states: 0, traced: 0, baselineTraced: 0, points: 0, baselinePoints: 0, harvests: 0 };
  for (const { name, world, centre } of worlds)
    for (let k = 0; k < (world ? 1000 : 500); k++) {
      const { state, player } = randomState(rng, centre),
        { result, current, baseline } = interact(state, player, world);
      totals.states++;
      if (result?.action === 'harvest') totals.harvests++;
      if (!world) continue;
      const byId = new Map((state.animals || []).map((animal) => [animal.id, animal])),
        nan = (state.animals || []).some(
          (animal) => animal.phase === 'meat' && Number.isNaN(huntingDistance(player, animal)),
        );
      for (const id of current.traced) {
        const animal = byId.get(id);
        assert.equal(animal.phase, 'meat', `${name}: traced ${id}, which is not meat`);
        assert.ok(
          nan || huntingDistance(player, animal) <= HUNTING.harvestRange,
          `${name}: traced ${id} outside harvest range`,
        );
      }
      const kept = new Set(current.traced);
      assert.deepEqual(
        baseline.traced.filter((id) => kept.has(id)),
        current.traced,
        `${name}: a subset of the frozen traces, in the same order`,
      );
      assert.ok(current.points <= baseline.points);
      totals.traced += current.traced.length;
      totals.baselineTraced += baseline.traced.length;
      totals.points += current.points;
      totals.baselinePoints += baseline.points;
    }
  assert.ok(totals.harvests > 200, 'the states exercise harvesting');
  t.diagnostic(JSON.stringify(totals));
});

// Repeatable timing of the interaction hint with a herd in view, as updateHuntingHUD calls it
// every frame. It reports only. CRO_BENCH=1 node --test <this file>
test(
  'benchmark: hunting interaction with a distant herd, frozen against current',
  { skip: process.env.CRO_BENCH === '1' ? false : 'set CRO_BENCH=1 to run the benchmark' },
  (t) => {
    const world = new CollisionWorld(),
      player = { id: 'p', x: 50, z: 47, inventory: { rawMeat: 1 } },
      animals = [];
    for (let i = 0; i < 12; i++)
      animals.push({
        id: `mammoth-${i}`,
        phase: i === 11 ? 'meat' : 'alive',
        x: 25 + (i % 4) * 4,
        z: 21 + Math.floor(i / 4) * 4,
        radius: 1.9,
        meatRemaining: 4,
      });
    const state = { camp: { x: 50, z: 50 }, animals };
    assert.deepStrictEqual(
      huntInteraction(state, player, world),
      baselineHuntInteraction(state, player, world),
    );
    const time = (run) => {
      for (let i = 0; i < 20; i++) run(state, player, world);
      const rounds = [];
      for (let r = 0; r < 9; r++) {
        const started = performance.now();
        for (let i = 0; i < 50; i++) run(state, player, world);
        rounds.push(((performance.now() - started) * 1000) / 50);
      }
      return Number(rounds.sort((a, b) => a - b)[4].toFixed(2));
    };
    t.diagnostic(
      JSON.stringify({
        node: process.version,
        microsecondsPerCall: { base: time(baselineHuntInteraction), next: time(huntInteraction) },
      }),
    );
  },
);
