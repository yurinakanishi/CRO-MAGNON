import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENERY } from '../dist/shared/scenery-layout.mjs';
import { INITIAL_RESOURCES } from '../dist/shared/world.mjs';
import {
  MAX_GRADE,
  SPACING,
  footprintGrade,
  footprintRadius,
  resourceRadius,
  spaceScenery,
  trunkRadius,
} from '../dist/shared/scenery-spacing.mjs';
import { riverX, riverHalfWidth } from '../dist/shared/terrain.mjs';
import { mountainRiverContains } from '../dist/shared/mountain-river.mjs';

const resources = INITIAL_RESOURCES.filter((r) => !r.id.startsWith('gulf-'));
const near = (a, b, distance) =>
  Math.abs(a.x - b.x) < distance &&
  Math.abs(a.z - b.z) < distance &&
  Math.hypot(a.x - b.x, a.z - b.z) < distance;

test('nothing stands on the mountain’s steep sides', () => {
  for (const tree of SCENERY.trees)
    assert.ok(
      footprintGrade(tree.x, tree.z, Math.max(1, trunkRadius(tree) * 3)) <= MAX_GRADE.tree,
      `tree at ${tree.x},${tree.z}`,
    );
  for (const [kind, items] of [
    ['rock', SCENERY.rocks],
    ['prop', SCENERY.props],
  ])
    for (const item of items)
      assert.ok(
        footprintGrade(item.x, item.z, footprintRadius(item)) <= MAX_GRADE[kind],
        `${item.key} at ${item.x},${item.z}`,
      );
  // Every harvest pile lies on dry, nearly flat ground.
  for (const r of resources) {
    assert.ok(footprintGrade(r.x, r.z, resourceRadius(r)) <= 0.25, r.id);
    if (riverHalfWidth(r.z) > 0.5)
      assert.ok(
        Math.abs(r.x - riverX(r.z)) > riverHalfWidth(r.z) + 1.5,
        `${r.id} beside the river`,
      );
    assert.ok(!mountainRiverContains(r.x, r.z, 1), r.id);
  }
});

test('no tree, boulder or pile overlaps another, and crowns keep apart', () => {
  const { trees, rocks } = SCENERY;
  for (const [i, a] of trees.entries())
    for (const b of trees.slice(i + 1))
      if (near(a, b, 12))
        assert.ok(
          Math.hypot(a.x - b.x, a.z - b.z) >=
            (footprintRadius(a) + footprintRadius(b)) * SPACING.crowns - 1e-9,
          `trees at ${a.x},${a.z} and ${b.x},${b.z}`,
        );
  for (const rock of rocks)
    for (const tree of trees)
      if (near(rock, tree, 10))
        assert.ok(
          Math.hypot(rock.x - tree.x, rock.z - tree.z) >= footprintRadius(rock) + trunkRadius(tree),
          `trunk in the boulder at ${rock.x},${rock.z}`,
        );
  for (const [i, a] of rocks.entries())
    for (const b of rocks.slice(i + 1))
      if (near(a, b, 10))
        assert.ok(
          Math.hypot(a.x - b.x, a.z - b.z) >= footprintRadius(a) + footprintRadius(b),
          `boulders at ${a.x},${a.z}`,
        );
  for (const r of resources)
    for (const item of [...trees, ...rocks])
      if (near(r, item, 12))
        assert.ok(
          Math.hypot(r.x - item.x, r.z - item.z) >=
            resourceRadius(r) +
              (item.key === 'valley-pine' ? trunkRadius(item) : footprintRadius(item)),
          `${item.key} on ${r.id}`,
        );
});

test('camps keep every tent and fire; the filter only removes, and is stable', () => {
  assert.equal(SCENERY.tents.length, 16);
  assert.equal(SCENERY.fires.length, 20);
  const again = spaceScenery(SCENERY, resources);
  for (const key of ['trees', 'grass', 'rocks', 'props', 'tents', 'fires'])
    assert.equal(again[key].length, SCENERY[key].length, key);
});
