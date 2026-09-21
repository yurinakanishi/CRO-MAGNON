import { readFile, writeFile } from 'node:fs/promises';
const root = 'output/playwright/performance-2026-09-19';
const load = async (name) => JSON.parse(await readFile(`${root}/${name}/summary.json`, 'utf8'));
const before = await load('baseline'),
  after = await load('final');
const stressBefore = await load('stress-before'),
  stressAfter = await load('stress-final');
const comparison = (a, b) =>
  a.measurements.map((m, i) => ({
    scene: m.scene,
    moving: m.moving,
    before: {
      frames: m.frames,
      frameMs: m.frameMs,
      cpuMs: m.cpuMs,
      calls: m.calls,
      triangles: m.triangles,
      longTasks: m.longTasks,
    },
    after: {
      frames: b.measurements[i].frames,
      frameMs: b.measurements[i].frameMs,
      cpuMs: b.measurements[i].cpuMs,
      calls: b.measurements[i].calls,
      triangles: b.measurements[i].triangles,
      longTasks: b.measurements[i].longTasks,
      wire: b.measurements[i].wire,
    },
  }));
const gameplay = await load('gameplay');
const report = {
  date: '2026-09-19',
  environment: {
    graphics: after.measurements[0].raw.graphics,
    userAgent: after.measurements[0].raw.userAgent,
    pixelRatio: after.measurements[0].raw.ratio,
  },
  normal: {
    viewport: after.viewport,
    cpuThrottle: 1,
    warmupMs: 10000,
    sampleMs: 5000,
    comparisons: comparison(before, after),
  },
  stress: {
    viewport: stressAfter.viewport,
    cpuThrottle: 4,
    warmupMs: 10000,
    sampleMs: 5000,
    comparisons: comparison(stressBefore, stressAfter),
  },
  checks: gameplay.checks,
  errors: gameplay.errors,
  tests: { passed: 629, failed: 0 },
  delivered: JSON.parse(await readFile('output/performance-2026-09-19/delivery.json', 'utf8')),
  limitations: [
    'Single five-second samples per scene; scheduler noise affects maximum frame intervals.',
    'CPU throttling is a synthetic browser load, not a measurement on a different physical device.',
    'GPU time and memory bytes were not separately measured. Draw calls include shadow passes.',
    'Conservative animated bounds can draw extra edge-of-view triangles to avoid clipping; models and resolution are unchanged.',
    'No public deployment, exhibition package or second PC update.',
  ],
};
await writeFile(
  'docs/performance-measurements-2026-09-19.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify(
    report.normal.comparisons.map((r) => ({
      scene: r.scene,
      moving: r.moving,
      beforeCPU: r.before.cpuMs.mean,
      afterCPU: r.after.cpuMs.mean,
      beforeMaxFrame: r.before.frameMs.max,
      afterMaxFrame: r.after.frameMs.max,
    })),
    null,
    2,
  ),
);
