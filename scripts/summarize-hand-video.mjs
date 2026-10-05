// Human-selected held-gesture windows from the contact sheet, not classifier labels.
// This is a recording regression report, not a population accuracy benchmark.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const out = path.resolve(process.argv[2] || 'output/playwright/left-hand-video-20261005');
const revision = process.argv[3] || 'revision-final';
const before = JSON.parse(await readFile(path.join(out, 'baseline-inputs.json'), 'utf8'));
const after = JSON.parse(await readFile(path.join(out, revision + '-inputs.json'), 'utf8'));
const intervals = [
  ['停止', 1, 3.4, 0, 0],
  ['前進（画面端の欠けを含む）', 4, 5.5, 1, 0],
  ['後退', 6.9, 8.6, -1, 0],
  ['停止', 9.3, 9.8, 0, 0],
  ['後退', 10.7, 11.3, -1, 0],
  ['停止', 12, 13.7, 0, 0],
  ['前進', 14.9, 16.5, 1, 0],
  ['停止', 18, 20.5, 0, 0],
  ['前進＋右旋回', 22.2, 23.7, 1, 1],
  ['画面外・停止', 25.2, 26.5, 0, 0],
  ['後退＋右旋回', 29, 30.2, -1, 1],
  ['後退＋左旋回', 32.2, 33.5, -1, -1],
  ['停止', 34.7, 35.5, 0, 0],
  ['手を下ろす・停止', 36, 37, 0, 0],
];
const sign = (n) => (Math.abs(n) < 0.08 ? 0 : Math.sign(n));
const windows = intervals.map(([label, from, to, forward, turn]) => {
  const measure = ({ rows }) => {
    const selected = rows.filter((r) => r.t >= from && r.t <= to);
    return {
      frames: selected.length,
      matching: selected.filter((r) => sign(r.forward) === forward && sign(r.turn) === turn).length,
      missingPalm: selected.filter((r) => !r.raw).length,
      maxForward: Math.max(...selected.map((r) => r.forward)),
      minForward: Math.min(...selected.map((r) => r.forward)),
      maxAbsTurn: Math.max(...selected.map((r) => Math.abs(r.turn))),
    };
  };
  return { label, from, to, before: measure(before), after: measure(after) };
});
const summary = {
  sampledFrames: after.rows.length,
  windows,
  limitations: [
    'Neutral setup repeats the real 2.0 s frame.',
    'Held-gesture windows are manually identified and exclude transitions.',
    'Forward-left gesture at 25–26 s leaves the frame; it cannot be validated from this video.',
    'Recorded landmarks are replayed at virtual 15 Hz; live game performance is measured separately.',
  ],
};
await writeFile(path.join(out, 'comparison.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
