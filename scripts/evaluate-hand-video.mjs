// Evaluate recorded landmarks locally. Neutral is a real frame repeated for setup,
// since the supplied demonstration does not wait for the game's calibration prompts.
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const out = path.resolve(process.argv[2] || 'output/playwright/left-hand-video-20261005');
const source = path.resolve(process.argv[3] || 'dist/src');
const label = process.argv[4] || 'current';
const { MotionInputAdapter } = await import(pathToFileURL(path.join(source, 'motion-input.js')));
const { normalizeHands, measurePush } = await import(
  pathToFileURL(path.join(source, 'motion-hands.js'))
);
const recording = JSON.parse(await readFile(path.join(out, 'landmarks.json'), 'utf8'));
const neutralFrame = recording.frames.reduce((a, b) =>
  Math.abs(b.sampledAtMainMs - 2000) < Math.abs(a.sampledAtMainMs - 2000) ? b : a,
);
const neutral = normalizeHands(neutralFrame);
const input = new MotionInputAdapter();
input.start();
input.calibrate();
let id = 0;
for (let at = 0; at <= 4000; at += 1000 / recording.hz)
  input.accept(
    { ...neutralFrame, sessionId: input.sessionId, frameId: ++id, sampledAtMainMs: at },
    at,
  );
const calibrationState = input.state;
const scale = input.calibration?.scale || 0.3;
const rows = recording.frames.map((f) => {
  const at = f.sampledAtMainMs + 4100;
  input.accept({ ...f, sessionId: input.sessionId, frameId: ++id, sampledAtMainMs: at }, at);
  const intent = input.read(at),
    hand = normalizeHands(f)?.left;
  const push = measurePush(hand, neutral.left);
  const ratio = hand
    ? Math.sqrt(
        ((hand.palmWidth / neutral.left.palmWidth) * hand.palmLength) / neutral.left.palmLength,
      )
    : null;
  return {
    t: f.sampledAtMainMs / 1000,
    state: input.state,
    forward: intent.forward,
    turn: intent.turn,
    edgeHolding: input.edgeHolding,
    raw: hand
      ? {
          x: hand.x,
          y: hand.y,
          open: hand.open,
          facing: hand.palmFacing,
          yaw: hand.yaw,
          roll: hand.roll,
          width: hand.palmWidth,
          length: hand.palmLength,
          push: push.push,
          ratio,
          offsetX: ((hand.x - 0.5) / ratio - (neutral.left.x - 0.5)) / scale,
          offsetY:
            ((hand.y - f.height / (2 * f.width)) / ratio -
              (neutral.left.y - f.height / (2 * f.width))) /
            scale,
          aspectChange:
            hand.palmWidth / neutral.left.palmWidth / (hand.palmLength / neutral.left.palmLength),
          fingers: hand.fingers,
        }
      : null,
    reason: input.reason,
    events: input.consumeActions(at),
  };
});
await writeFile(
  path.join(out, label + '-inputs.json'),
  JSON.stringify({
    neutralAt: neutralFrame.sampledAtMainMs / 1000,
    calibrationState,
    neutral,
    scale,
    rows,
  }),
);
const round = (n) => (n == null ? null : +n.toFixed(2));
console.log(JSON.stringify({ calibrationState, neutral, scale }));
for (let second = 0; second < recording.duration; second++) {
  const group = rows.filter((r) => r.t >= second && r.t < second + 1);
  const m = group[Math.floor(group.length / 2)],
    r = m?.raw;
  console.log(
    JSON.stringify({
      t: second,
      state: m?.state,
      f: round(m?.forward),
      turn: round(m?.turn),
      detected: group.filter((v) => v.raw).length,
      valid: group.filter((v) => v.raw?.push != null).length,
      ratio: round(r?.ratio),
      x: round(r?.offsetX),
      y: round(r?.offsetY),
      open: r?.open,
      facing: round(r?.facing),
      yaw: round(r?.yaw),
      roll: round(r?.roll),
      aspect: round(r?.aspectChange),
    }),
  );
}
