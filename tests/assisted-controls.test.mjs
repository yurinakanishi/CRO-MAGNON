import test from 'node:test';
import assert from 'node:assert/strict';
import { AssistedNavigation, wrapHeading } from '../dist/src/assisted-controls.js';

test('reverse travels backwards without changing the control heading', () => {
  const n = new AssistedNavigation();
  n.step(0, 0, 0, 'p', 1.1);
  const back = n.step(-0.8, 0, 50, 'p', -2);
  assert.equal(back.facing, 1.1);
  assert.ok(Math.abs(back.dx + Math.sin(1.1) * 0.8) < 1e-12);
  assert.ok(Math.abs(back.dz + Math.cos(1.1) * 0.8) < 1e-12);
});
test('steering in place and steering while reversing share heading and never add sideways speed', () => {
  const n = new AssistedNavigation();
  n.step(0, 0, 0, 'p', 0);
  const turn = n.step(0, 1, 100, 'p', 0);
  assert.ok(turn.dx === 0 && turn.dz === 0);
  assert.ok(turn.facing < 0);
  const diagonal = n.step(-0.5, 1, 200, 'p', 0);
  assert.ok(diagonal.facing < turn.facing);
  assert.ok(Math.abs(Math.hypot(diagonal.dx, diagonal.dz) - 0.5) < 1e-12);
});
test('heading is consistent across frame rates and pause cannot integrate a hidden interval', () => {
  const headings = [15, 30, 60].map((hz) => {
    const n = new AssistedNavigation();
    n.step(0, 0, 0, 'p', 0);
    for (let k = 1; k <= hz; k++) n.step(1, 0.5, (k * 1000) / hz, 'p', 2);
    const h = n.heading;
    n.pause();
    n.step(0, 0, 10000, 'p', -2);
    assert.equal(n.heading, h);
    assert.equal(n.step(0, 0, 10010, 'p', 2).facing, undefined);
    return h;
  });
  assert.ok(headings.every((h) => Math.abs(h + 0.825) < 1e-12));
});
test('a new actor or warp seeds its actual facing without a spin on the first frame', () => {
  const n = new AssistedNavigation();
  n.step(1, 1, 0, 'p:0', 0);
  n.step(1, 1, 100, 'p:0', 0);
  assert.equal(n.step(0, 1, 20000, 'p:1', 2).facing, 2);
  assert.ok(Math.abs(wrapHeading(2 * Math.PI + 0.5) - 0.5) < 1e-12);
});
