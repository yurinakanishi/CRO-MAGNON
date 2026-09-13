// Inspect H.264 MP4 sample tables to verify fps, complete frame count and provenance.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const revision = process.argv[2] ?? '04';
const folder = `output/model-generation/models/violet-behemoth-quadruped/work/rig/revision-${revision}/qa`;
const manifest = JSON.parse(await readFile(`${folder}/render-manifest.json`, 'utf8'));
function boxes(b, start = 0, end = b.length) {
  const result = [];
  for (let at = start; at + 8 <= end;) {
    let size = b.readUInt32BE(at),
      offset = 8;
    if (size === 1) {
      size = Number(b.readBigUInt64BE(at + 8));
      offset = 16;
    }
    if (!size) size = end - at;
    assert.ok(size >= offset && at + size <= end);
    result.push({ type: b.toString('ascii', at + 4, at + 8), start: at + offset, end: at + size });
    at += size;
  }
  return result;
}
const records = [];
for (const clip of manifest.clips) {
  const file = `${folder}/${clip.clip}.mp4`,
    b = await readFile(file);
  let container = { start: 0, end: b.length };
  for (const kind of ['moov', 'trak', 'mdia'])
    container = boxes(b, container.start, container.end).find((a) => a.type === kind);
  const media = boxes(b, container.start, container.end);
  const header = media.find((a) => a.type === 'mdhd');
  assert.equal(b[header.start], 0);
  const timescale = b.readUInt32BE(header.start + 12),
    duration = b.readUInt32BE(header.start + 16);
  container = media.find((a) => a.type === 'minf');
  container = boxes(b, container.start, container.end).find((a) => a.type === 'stbl');
  const table = boxes(b, container.start, container.end).find((a) => a.type === 'stts');
  const entries = b.readUInt32BE(table.start + 4);
  let frames = 0,
    ticks = 0;
  for (let i = 0; i < entries; i++) {
    const count = b.readUInt32BE(table.start + 8 + 8 * i),
      delta = b.readUInt32BE(table.start + 12 + 8 * i);
    frames += count;
    ticks += count * delta;
  }
  const expected = Math.round(clip.durationSeconds * 30) + (clip.loop ? 0 : 1);
  assert.equal(frames, expected, clip.clip);
  assert.equal(ticks, duration);
  assert.ok(Math.abs((frames * timescale) / ticks - 30) < 1e-8);
  records.push({
    clip: clip.clip,
    file: `${clip.clip}.mp4`,
    fps: 30,
    frames,
    seconds: ticks / timescale,
    omittedDuplicateLoopEndpoint: clip.loop,
    bytes: b.length,
    sha256: createHash('sha256').update(b).digest('hex'),
  });
}
await writeFile(
  `${folder}/video-verification.json`,
  JSON.stringify({ sourceGLBSha256: manifest.sha256, videos: records, pass: true }, null, 2) + '\n',
);
console.log(JSON.stringify({ videos: records.length, fps: 30, complete: true }));
