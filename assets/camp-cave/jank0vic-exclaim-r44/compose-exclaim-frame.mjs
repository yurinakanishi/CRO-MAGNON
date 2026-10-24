// Arrange image_gen exclamation marks in an aligned grid around the unchanged r43
// face (user request 2026-10-22). Technical placement only: every visible stroke
// comes from the generated face and mark sheet; nothing is drawn here.
// Run from the repository root:
//   node assets/camp-cave/jank0vic-exclaim-r44/compose-exclaim-frame.mjs --sheet=<marks PNG>
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { extractMuralSprite } from '../../../scripts/cave-mural-sprite.mjs';
const root = 'assets/camp-cave/jank0vic-exclaim-r44';
const hash = (b) => createHash('sha256').update(b).digest('hex');
const sheetPath = process.argv.find((a) => a.startsWith('--sheet='))?.slice(8);
assert(sheetPath?.startsWith(`${root}/marks/`), 'choose a generated mark sheet');
// The user's layout: 10 marks per row, two full rows above and below the face,
// three marks either side of it (rows 3-6). Rows and columns are aligned.
const COLUMNS = 10,
  ROWS = 8,
  FACE = { columns: [3, 6], rows: [2, 5] },
  SHEET = { columns: 4, rows: 2 },
  MARK_HEIGHT = 0.72, // of the row pitch
  COLUMN_PITCH = 0.8, // of the row pitch
  MARGIN = 24,
  INK = 24;
const recipe = JSON.parse(await readFile('assets/camp-cave/jank0vic-face-r43/recipe.json', 'utf8'));
const subject = recipe.subjects.find((s) => s.id === 'jank0vic'),
  faceSource = recipe.sources[subject.source],
  faceBytes = await readFile(faceSource.path);
assert.equal(hash(faceBytes), faceSource.sha256, 'r43 face source changed');
const face = await extractMuralSprite(faceBytes, subject);
function inkBox({ data, info }, x0 = 0, y0 = 0, x1 = info.width, y1 = info.height, min = INK) {
  let left = x1,
    top = y1,
    right = -1,
    bottom = -1;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      if (data[(y * info.width + x) * 4 + 3] >= min) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  assert(right >= left && bottom >= top, 'no pigment');
  return { left, top, right: right + 1, bottom: bottom + 1 };
}
const faceInk = inkBox(face),
  bodySpan = faceInk.bottom - faceInk.top,
  rowPitch = bodySpan / (FACE.rows[1] - FACE.rows[0] + 1),
  columnPitch = rowPitch * COLUMN_PITCH,
  markHeight = Math.round(rowPitch * MARK_HEIGHT);
assert(faceInk.right - faceInk.left < columnPitch * (FACE.columns[1] - FACE.columns[0] + 1));
// Each sheet cell holds one mark (a bar and its separate dot), clear of the cell edges.
const sheetBytes = await readFile(sheetPath),
  sheet = await sharp(sheetBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const marks = [];
for (let r = 0; r < SHEET.rows; r++)
  for (let c = 0; c < SHEET.columns; c++) {
    const x0 = Math.round((c * sheet.info.width) / SHEET.columns),
      x1 = Math.round(((c + 1) * sheet.info.width) / SHEET.columns),
      y0 = Math.round((r * sheet.info.height) / SHEET.rows),
      y1 = Math.round(((r + 1) * sheet.info.height) / SHEET.rows);
    const ink = inkBox(sheet, x0, y0, x1, y1),
      soft = inkBox(sheet, x0, y0, x1, y1, 8);
    const clear = 6;
    assert(
      soft.left - x0 >= clear &&
        x1 - soft.right >= clear &&
        soft.top - y0 >= clear &&
        y1 - soft.bottom >= clear,
      `sheet cell ${r},${c}: the mark touches its cell edge`,
    );
    const pad = { left: soft.left - 2, top: soft.top - 2 },
      width = soft.right + 2 - pad.left,
      height = soft.bottom + 2 - pad.top,
      scale = markHeight / (ink.bottom - ink.top);
    const image = await sharp(sheetBytes)
      .extract({ left: pad.left, top: pad.top, width, height })
      .resize(Math.round(width * scale), Math.round(height * scale), { kernel: 'lanczos3' })
      .png()
      .toBuffer();
    marks.push({
      cell: [r, c],
      sheetBox: [ink.left, ink.top, ink.right, ink.bottom],
      image,
      // Ink centre and baseline inside the resized cutout.
      centre: ((ink.left + ink.right) / 2 - pad.left) * scale,
      baseline: (ink.bottom - pad.top) * scale,
    });
  }
const width = Math.round(COLUMNS * columnPitch + 2 * MARGIN),
  height = Math.round(ROWS * rowPitch + 2 * MARGIN);
const composites = [],
  placements = [];
for (let r = 0; r < ROWS; r++)
  for (let c = 0; c < COLUMNS; c++) {
    if (r >= FACE.rows[0] && r <= FACE.rows[1] && c >= FACE.columns[0] && c <= FACE.columns[1])
      continue;
    // Neighbours in a row and in a column always use different brush variants.
    const variant = (c + r * 3) % marks.length,
      mark = marks[variant];
    const left = Math.round(MARGIN + (c + 0.5) * columnPitch - mark.centre),
      top = Math.round(MARGIN + r * rowPitch + (rowPitch + markHeight) / 2 - mark.baseline);
    composites.push({ input: mark.image, left, top });
    placements.push({ row: r, column: c, variant, left, top });
  }
const faceLeft = Math.round(
    MARGIN +
      (FACE.columns[0] + (FACE.columns[1] - FACE.columns[0] + 1) / 2) * columnPitch -
      (faceInk.left + faceInk.right) / 2,
  ),
  faceTop = Math.round(MARGIN + FACE.rows[0] * rowPitch - faceInk.top);
const canvas = await sharp({
  create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite(composites)
  .raw()
  .toBuffer();
// Copy the face's exact r43 pixels (no blending); no mark lies beneath them.
let facePixels = 0;
for (let y = 0; y < face.info.height; y++)
  for (let x = 0; x < face.info.width; x++) {
    const p = (y * face.info.width + x) * 4;
    if (!face.data[p + 3]) continue;
    const q = ((y + faceTop) * width + x + faceLeft) * 4;
    assert.equal(canvas[q + 3], 0, 'a mark overlaps the face');
    face.data.copy(canvas, q, p, p + 4);
    facePixels++;
  }
const data = await sharp(canvas, { raw: { width, height, channels: 4 } })
  .png()
  .toBuffer();
const composed = await sharp(data).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  all = inkBox(composed);
for (let y = 0; y < face.info.height; y++)
  for (let x = 0; x < face.info.width; x++) {
    const p = (y * face.info.width + x) * 4,
      q = ((y + faceTop) * width + x + faceLeft) * 4;
    if (face.data[p + 3])
      assert.equal(face.data.compare(composed.data, q, q + 4, p, p + 4), 0, 'face pixel changed');
  }
assert(all.left >= 8 && all.top >= 8 && width - all.right >= 8 && height - all.bottom >= 8);
const body = { top: faceTop + faceInk.top, bottom: faceTop + faceInk.bottom };
const out = `${root}/source/jank0vic-exclaim-r01.png`;
await mkdir(`${root}/source`, { recursive: true });
await mkdir(`${root}/qa`, { recursive: true });
await writeFile(out, data);
const layout = {
  output: { path: out, sha256: hash(data), bytes: data.length, width, height },
  face: {
    source: faceSource.path,
    sha256: faceSource.sha256,
    crop: subject.crop,
    left: faceLeft,
    top: faceTop,
    ink: [
      faceLeft + faceInk.left,
      faceTop + faceInk.top,
      faceLeft + faceInk.right,
      faceTop + faceInk.bottom,
    ],
    // Every face pixel with any alpha is copied byte for byte.
    unchangedPixels: facePixels,
  },
  marks: {
    sheet: sheetPath,
    sha256: hash(sheetBytes),
    cells: marks.map(({ cell, sheetBox }) => ({ cell, sheetBox })),
    height: markHeight,
  },
  grid: { columns: COLUMNS, rows: ROWS, face: FACE, rowPitch, columnPitch, margin: MARGIN },
  placements,
  ink: [all.left, all.top, all.right, all.bottom],
  // Recipe values: the face is the 0.72 m body; the bottom row of marks rests on the baseline.
  recipe: {
    crop: [0, 0, width, height],
    bodyTop: body.top,
    bodyBottom: body.bottom,
    lift: Number((((all.bottom - body.bottom) * 0.72) / bodySpan).toFixed(4)),
  },
};
await writeFile(`${root}/qa/frame-layout.json`, JSON.stringify(layout, null, 2) + '\n');
console.log(
  JSON.stringify({
    output: layout.output,
    marks: placements.length,
    rowPitch,
    columnPitch,
    markHeight,
    recipe: layout.recipe,
  }),
);
