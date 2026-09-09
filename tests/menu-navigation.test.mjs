import test from 'node:test';
import assert from 'node:assert/strict';
import { spatialMenuIndex } from '../dist/src/menu-navigation.js';

const rect = (left, top, width = 120, height = 44) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

test('two-column menus follow all four directions, independent of DOM order', () => {
  const boxes = [rect(0, 0), rect(140, 0), rect(0, 60), rect(140, 60)];
  assert.equal(spatialMenuIndex(boxes, 0, 'down'), 2);
  assert.equal(spatialMenuIndex(boxes, 0, 'right'), 1);
  assert.equal(spatialMenuIndex(boxes, 3, 'up'), 1);
  assert.equal(spatialMenuIndex(boxes, 3, 'left'), 2);
  assert.equal(spatialMenuIndex([boxes[0], boxes[3], boxes[1], boxes[2]], 0, 'down'), 3);
});

test('unequal neighbouring heights do not turn a down press into a right press', () => {
  const boxes = [rect(0, 0), rect(140, 0, 120, 70), rect(0, 90), rect(140, 90)];
  assert.equal(spatialMenuIndex(boxes, 0, 'down'), 2);
  assert.equal(spatialMenuIndex(boxes, 2, 'up'), 0);
});

test('directional edges stay put instead of wrapping across a row or to the top', () => {
  const boxes = [rect(0, 0), rect(140, 0), rect(0, 60), rect(140, 60)];
  for (const [index, direction] of [
    [0, 'up'],
    [0, 'left'],
    [1, 'right'],
    [3, 'down'],
  ])
    assert.equal(spatialMenuIndex(boxes, index, direction), index);
});

test('one-column responsive menus stay vertical and do not respond sideways', () => {
  const boxes = [rect(0, 0), rect(0, 60), rect(0, 120)];
  assert.equal(spatialMenuIndex(boxes, 0, 'down'), 1);
  assert.equal(spatialMenuIndex(boxes, 2, 'up'), 1);
  assert.equal(spatialMenuIndex(boxes, 1, 'right'), 1);
  assert.equal(spatialMenuIndex(boxes, 1, 'left'), 1);
});

test('aligned targets win over close diagonals; full-width buttons and missing cells are reachable', () => {
  const boxes = [
    rect(0, 0, 260),
    rect(0, 60),
    rect(140, 60),
    rect(0, 120),
    rect(140, 180),
    rect(0, 240, 260),
  ];
  assert.equal(spatialMenuIndex(boxes, 2, 'down'), 4);
  assert.equal(spatialMenuIndex(boxes, 4, 'down'), 5);
  assert.equal(spatialMenuIndex(boxes, 2, 'up'), 0);
  assert.equal(spatialMenuIndex([rect(0, 0), rect(140, 60)], 0, 'down'), 1);
});

test('scroll offsets preserve directional choices; absent selection and empty menus are safe', () => {
  const boxes = [rect(0, -200), rect(140, -200), rect(0, -140), rect(140, -140)];
  assert.equal(spatialMenuIndex(boxes, 0, 'down'), 2);
  assert.equal(spatialMenuIndex(boxes, -1, 'up'), 0);
  assert.equal(spatialMenuIndex([], -1, 'down'), -1);
});
