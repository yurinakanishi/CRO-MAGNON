import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionPetHold, motionTarget } from '../dist/src/motion-interaction.js';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { createRimoNeko, handleRimoNekoAction, updateRimoNeko } from '../dist/shared/rimo-neko.mjs';
import {
  createCompanion524,
  handleCompanion524Action,
  updateCompanion524,
} from '../dist/shared/companion-524.mjs';

const intent = (time, forward = 0.1, turn = 0.1, sessionId = 1) => ({
  active: true,
  forward,
  turn,
  cameraYaw: 0.6,
  cameraPitch: -0.2,
  cameraDragging: true,
  sessionId,
  sampledAtMainMs: time,
});
const sample = (push = 0.16, x = 0.08) => ({ push, offset: { x, y: 0 }, roll: 0 });
test('one target supplies both the label and action, with petting before nearby resources', () => {
  const resource = { label: '木材を採集する', action: 'gather', targetId: 'wood' };
  assert.deepEqual(motionTarget('rimo', resource), {
    action: 'petRimo',
    label: 'りもねこを撫でる',
  });
  assert.deepEqual(motionTarget('524', resource), { action: 'pet524', label: '524を撫でる' });
  assert.equal(motionTarget(null, resource), resource);
  assert.equal(motionTarget(null, null), null);
});
for (const kind of ['rimo', '524'])
  test(`${kind}: waving then small movement jitter completes actual domain petting`, () => {
    const collision = new CollisionWorld([], { coast: false, river: false, walkSurfaces: [] });
    const c = kind === 'rimo' ? createRimoNeko(collision) : createCompanion524(collision);
    const p = {
      id: 'p',
      x: c.x,
      z: c.z - 2,
      facing: 0,
      radius: 0.32,
      species: 'cro',
      gender: 'female',
      speed: 0,
      energy: 100,
      inventory: {},
      attackAt: 0,
      attackSequence: 0,
      jumpAt: 0,
      jumpSequence: 0,
    };
    const room = {
      collision,
      players: new Map([[p.id, p]]),
      animals: [],
      enemies: [],
      ...(kind === 'rimo' ? { rimoNeko: c } : { companion524: c }),
    };
    const start = kind === 'rimo' ? handleRimoNekoAction : handleCompanion524Action;
    const update = kind === 'rimo' ? updateRimoNeko : updateCompanion524;
    const hold = new MotionPetHold();
    hold.begin(1, 10000, sample());
    assert.equal(start(room, p, kind === 'rimo' ? 'petRimo' : 'pet524', 10000), true);
    for (let time = 10050; time < 15000; time += 50) {
      const i = hold.filter(
        intent(time),
        sample(0.16 + Math.sin(time) * 0.03),
        c.petPlayerId === p.id,
        time,
      );
      assert.equal(i.forward, 0);
      assert.equal(i.turn, 0);
      p.moving = Math.abs(i.forward) > 0.01;
      p.z += i.forward * 0.15;
      update(room, 0.05, time);
    }
    assert.equal(c.followPlayerId, p.id);
    assert.equal(c.petPlayerId, null);
  });
test('a deliberate new push or lateral gesture cancels assistance, but repeated render frames cannot fake the dwell', () => {
  for (const [input, position] of [
    [intent(1100, 0.7, 0), sample(0.55)],
    [intent(1100, 0, 0.8), sample(0.16, 0.5)],
  ]) {
    const hold = new MotionPetHold();
    hold.begin(1, 1000, sample());
    for (let n = 0; n < 8; n++)
      assert.equal(hold.filter(input, position, true, 1100 + n * 15).forward, 0);
    const fresh = { ...input, sampledAtMainMs: 1200 };
    assert.deepEqual(hold.filter(fresh, position, true, 1200), fresh);
    assert.equal(hold.active, false);
  }
});
test('rejected pet requests time out, and pause/session changes cannot retain a movement hold', () => {
  const hold = new MotionPetHold();
  hold.begin(1, 1000, sample());
  assert.deepEqual(hold.filter(intent(2000), sample(), false, 2000), intent(2000));
  assert.equal(hold.active, false);
  hold.begin(1, 3000, sample());
  const next = intent(3100, 0, 0, 2);
  assert.deepEqual(hold.filter(next, sample(), true, 3100), next);
  assert.equal(hold.active, false);
});

test('idle control heading does not cancel petting', () => {
  const hold = new MotionPetHold();
  hold.begin(1, 1000, sample());
  for (const at of [1100, 1200, 1300]) {
    const result = hold.filter(intent(at, 0, 0), sample(), true, at);
    assert.equal(result.cameraYaw, 0.6);
    assert.equal(result.forward, 0);
    assert.equal(result.turn, 0);
    assert.equal(hold.active, true);
  }
});
test('deliberate pulling interrupts petting', () => {
  for (const s of [sample(-0.25)]) {
    const hold = new MotionPetHold();
    hold.begin(1, 1000, sample());
    assert.equal(hold.filter(intent(1100, -0.7, 0), s, true, 1100).forward, 0);
    assert.equal(hold.filter(intent(1200, -0.7, 0), s, true, 1200).forward, -0.7);
  }
});
