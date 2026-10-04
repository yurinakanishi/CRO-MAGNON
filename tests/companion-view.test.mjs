import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseCompanionView, companionViewDistances } from '../dist/src/companion-view.js';

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
