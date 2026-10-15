import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { CHIBI_FACE_KEYS } from '../scripts/face-remake/stabilize-chibi-heads.mjs';
import { measureChibiHead } from '../scripts/face-remake/measure-chibi-heads.mjs';

for (const key of CHIBI_FACE_KEYS)
  test(`${key}: the delivered face keeps its shape through all clips and gait transitions`, async () => {
    const asset = JSON.parse(await readFile(`public/models/${key}/asset.json`));
    const bytes = await readFile(`public${asset.url}`);
    assert.equal(bytes.length, asset.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
    const result = await measureChibiHead(bytes, asset);
    assert.ok(result.vertices > 1000, 'a complete large head is measured');
    assert.equal(result.clips.length, 10, 'every delivered clip is measured');
    assert.ok(result.maxDeviationM < 0.00002, `face deformation: ${result.maxDeviationM} m`);
    assert.ok(
      result.maxCrossfadeDeviationM < 0.00002,
      `crossfade deformation: ${result.maxCrossfadeDeviationM} m`,
    );
    assert.ok(result.maxSeamGapM < 0.00002, `material seam gap: ${result.maxSeamGapM} m`);
  });
