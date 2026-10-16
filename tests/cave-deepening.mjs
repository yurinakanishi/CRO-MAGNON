// The r28-deep remap of the camp cave (assets/camp-cave/workflow/deepen-gallery.mjs), as its
// adopted, versioned report records it. Along the bend, depths through D0 stay where they were, the gallery to D1
// stretches by K, and everything deeper (the rounded chamber and its spring) moves DELTA back.
import { readFileSync } from 'node:fs';

export const R28_DEEP = JSON.parse(
  readFileSync('assets/camp-cave/qa/adoption-r28-deep.json', 'utf8'),
).geometry;
const { D0, D1, DELTA, K } = R28_DEEP.constants;

/** Where a depth of model-r27-rounded lies in model-r28-deep. */
export const deepened = (depth) =>
  depth <= D0 ? depth : depth <= D1 ? D0 + (depth - D0) * K : depth + DELTA;
/** The same for a local Z (negative into the cave). */
export const deepenedZ = (z) => -deepened(-z);
