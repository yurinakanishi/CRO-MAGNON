import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractHands,
  measureHand,
  measurePush,
  normalizeHands,
} from '../dist/src/motion-hands.js';
import { syntheticHands, syntheticHand } from './helpers/motion-hands.mjs';

test('Tasks hand labels stay anatomical; extraction keeps 21 relative XYZ points without reading world coordinates', () => {
  const hands = syntheticHands();
  for (const hand of Object.values(hands))
    for (const p of hand.landmarks) {
      Object.defineProperty(p, 'visibility', {
        get() {
          throw Error('hand landmarks do not expose point confidence');
        },
      });
    }
  const result = {
    landmarks: [hands.right.landmarks, hands.left.landmarks],
    handedness: [[{ categoryName: 'Right', score: 0.9 }], [{ categoryName: 'Left', score: 0.95 }]],
  };
  Object.defineProperty(result, 'worldLandmarks', {
    get() {
      throw Error('world must not be read');
    },
  });
  const extracted = extractHands(result);
  assert.equal(extracted.left.landmarks[0].x, 0.62);
  assert.equal(extracted.right.landmarks[0].x, 0.38);
  assert.deepEqual(Object.keys(extracted.left.landmarks[0]), ['x', 'y', 'z']);
  assert.equal(extracted.left.handednessScore, 0.95);
});
test('duplicate, uncertain and unknown hand labels never guess a control hand', () => {
  const landmarks = syntheticHand('left').landmarks;
  const category = (categoryName, score = 0.98) => [{ categoryName, score }];
  assert.equal(
    extractHands({
      landmarks: [landmarks, landmarks],
      handedness: [category('Left'), category('Left')],
    }).left,
    null,
  );
  for (const label of [category('Unknown'), category('Right', 0.51), category('Right', NaN)])
    assert.deepEqual(extractHands({ landmarks: [landmarks], handedness: [label] }), {
      left: null,
      right: null,
    });
});
test('hand size measurement is pixel isotropic and needs no body', () => {
  const hand = syntheticHand('left');
  const a = measureHand(hand, 640, 480);
  const b = measureHand(
    { ...hand, landmarks: hand.landmarks.map((p) => ({ ...p, y: p.y / 2 })) },
    640,
    960,
  );
  assert.deepEqual(a, b);
  assert.equal(a.open, true);
  const onlyLeft = normalizeHands({ hands: { left: hand, right: null }, width: 640, height: 480 });
  assert.ok(onlyLeft.left);
  assert.equal(onlyLeft.right, null);
});
test('uniform hand enlargement increases push independently of image translation', () => {
  const neutral = measureHand(syntheticHand('left'), 640, 480);
  const larger = measureHand(syntheticHand('left', { push: 0.4, x: 0.2, y: 0.1 }), 640, 480);
  assert.ok(Math.abs(measurePush(larger, neutral).push - 0.4) < 1e-9);
  const translated = measureHand(syntheticHand('left', { x: 0.2, y: 0.1 }), 640, 480);
  assert.ok(Math.abs(measurePush(translated, neutral).push) < 1e-9);
});
test('fingers alone or palm rotation cannot imitate a growing open palm', () => {
  const neutral = measureHand(syntheticHand('left'), 640, 480);
  for (const options of [
    { onlyFingers: 1.4 },
    { fold: true },
    { flatness: 0.3 },
    { flatness: 1.4 },
  ]) {
    const result = measurePush(measureHand(syntheticHand('left', options), 640, 480), neutral);
    assert.ok(result.push === null || result.push <= 1e-9);
  }
});
test('missing palm points, tiny palms and nonfinite values cannot control anything', () => {
  for (const mutate of [
    (h) => h.landmarks.pop(),
    (h) => (h.landmarks[0].x = NaN),
    (h) => (h.handednessScore = NaN),
    (h) =>
      h.landmarks.forEach((p) => {
        p.x = 0.5 + (p.x - 0.5) * 0.1;
        p.y = 0.5 + (p.y - 0.5) * 0.1;
      }),
  ]) {
    const hand = syntheticHand('left');
    mutate(hand);
    assert.equal(measureHand(hand, 640, 480), null);
  }
});
test('cropped fingertips keep palm controls; clipping alone cannot imitate a push', () => {
  const hand = syntheticHand('right');
  const neutral = measureHand(hand, 640, 480);
  hand.landmarks[12].y = -0.1;
  const cropped = measureHand(hand, 640, 480);
  assert.ok(cropped);
  assert.equal(cropped.open, true);
  assert.equal(cropped.fingerLength, null);
  assert.ok(Math.abs(measurePush(cropped, neutral).push) < 1e-9);
});

for (const side of ['left', 'right'])
  test(`${side}: palm yaw and roll preserve scale; push works while tilted`, () => {
    const neutral = measureHand(syntheticHand(side), 640, 480);
    for (const yaw of [-0.7, -0.4, 0.4, 0.7])
      for (const roll of [-0.5, 0, 0.5]) {
        const turned = measureHand(syntheticHand(side, { yaw, roll }), 640, 480);
        assert.ok(Math.abs(measurePush(turned, neutral).push) < 1e-9);
        assert.ok(Math.abs(turned.yaw + yaw) < 1e-9);
        assert.equal(Math.sign(turned.roll) || 0, -Math.sign(roll) || 0);
        const pushed = measureHand(syntheticHand(side, { yaw, roll, push: 0.4 }), 640, 480);
        assert.ok(Math.abs(measurePush(pushed, neutral).push - 0.4) < 1e-9);
      }
  });
test('missing or invalid depth cannot rotate the view', () => {
  const h = syntheticHand('left');
  delete h.landmarks[5].z;
  assert.equal(measureHand(h, 640, 480).yaw, null);
  h.landmarks[5].z = NaN;
  assert.equal(measureHand(h, 640, 480).yaw, null);
});

for (const side of ['left', 'right'])
  test(`${side}: thumb/index/middle extended with ring/little folded is a gun at different sizes and angles`, () => {
    for (const yaw of [-0.7, 0, 0.7])
      for (const roll of [-0.5, 0, 0.5])
        for (const push of [-0.2, 0.4]) {
          const sample = measureHand(
            syntheticHand(side, { gun: true, yaw, roll, push, x: 0.2, y: 0.1 }),
            640,
            480,
          );
          assert.equal(sample.pose, 'gun');
          assert.deepEqual(sample.fingers, [
            'extended',
            'extended',
            'extended',
            'folded',
            'folded',
          ]);
        }
  });
test('all five fingers are necessary for the requested gun; an open hand, V sign or hidden fingertip cannot attack', () => {
  for (const options of [
    {},
    { gun: true, thumbFold: true },
    { folded: [13] },
    { folded: [9, 13, 17] },
    { fold: true },
  ])
    assert.notEqual(measureHand(syntheticHand('right', options), 640, 480).pose, 'gun');
  for (const index of [4, 8, 12, 16, 20]) {
    const hand = syntheticHand('right', { gun: true });
    hand.landmarks[index].x = -0.1;
    const sample = measureHand(hand, 640, 480);
    assert.equal(sample.fingers[[4, 8, 12, 16, 20].indexOf(index)], 'unknown');
    assert.notEqual(sample.pose, 'gun');
  }
});
test('palm plane separates a face-on camera hand from a horizontal stroking hand, independently of handedness', () => {
  for (const side of ['left', 'right']) {
    for (const yaw of [-0.5, 0, 0.5]) {
      assert.equal(measureHand(syntheticHand(side, { yaw }), 640, 480).pose, 'camera');
      assert.equal(measureHand(syntheticHand(side, { yaw, pitch: 1.3 }), 640, 480).pose, 'stroke');
    }
    assert.equal(measureHand(syntheticHand(side, { pitch: 0.72 }), 640, 480).pose, 'other');
    assert.equal(measureHand(syntheticHand(side, { fold: true }), 640, 480).pose, 'other');
  }
});
test('missing depth is unknown, never inferred as folded fingers or a horizontal palm', () => {
  for (const value of [undefined, NaN, Infinity]) {
    const hand = syntheticHand('right', { gun: true });
    hand.landmarks[16].z = value;
    const sample = measureHand(hand, 640, 480);
    assert.equal(sample.pose, 'unknown');
    assert.equal(sample.horizontal, null);
    assert.ok(sample.fingers.every((finger) => finger === 'unknown'));
  }
});
