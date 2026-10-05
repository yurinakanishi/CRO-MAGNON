import assert from 'node:assert/strict';
import { MotionInputAdapter } from '../../dist/src/motion-input.js';
import { syntheticHands } from './motion-hands.mjs';

export function motionDriver(hz = 15, swapped = false, singleHand = false) {
  const input = new MotionInputAdapter();
  input.singleHand = singleHand;
  input.start();
  input.calibrate(swapped ? 'right' : 'left');
  let time = 0,
    id = 0,
    intent;
  const pair = (move, act) => {
    const hands = syntheticHands(move, act, swapped);
    if (singleHand) hands[swapped ? 'left' : 'right'] = null;
    return hands;
  };
  const frame = (hands = pair(), dt = 1000 / hz, extra = {}) => {
    time += dt;
    const f = {
      sessionId: input.sessionId,
      frameId: ++id,
      sampledAtMainMs: time,
      width: 640,
      height: 480,
      hands,
      ...extra,
    };
    input.accept(f, time);
    intent = input.read(time);
    return f;
  };
  const hold = (hands = pair(), ms = 500) => {
    const end = time + ms;
    while (time < end - 0.001) frame(hands);
    return intent;
  };
  hold(pair(), 3800);
  assert.equal(input.state, 'ACTIVE');
  return {
    input,
    frame,
    hold,
    pair,
    get time() {
      return time;
    },
    get intent() {
      return intent;
    },
  };
}
