// A height atlas sampled from an exported GLB. Null cells are solid or unreachable.
// This is physics data only; the renderer always loads the original GLB.
export function measuredWalkSurface(data, placement) {
  const { step, minX, minZ, nx, nz, heights } = data;
  if (
    !(step > 0) ||
    !Number.isInteger(nx) ||
    !Number.isInteger(nz) ||
    heights.length !== nx * nz ||
    !heights.every((h) => h === null || Number.isFinite(h))
  )
    throw new Error('Invalid measured walk surface');
  const c = Math.cos(placement.yaw),
    s = Math.sin(placement.yaw),
    scale = placement.scale ?? 1;
  const local = (x, z) => ({
    x: (c * (x - placement.x) - s * (z - placement.z)) / scale,
    z: (s * (x - placement.x) + c * (z - placement.z)) / scale,
  });
  const world = (x, z) => ({
    x: placement.x + (c * x + s * z) * scale,
    z: placement.z + (-s * x + c * z) * scale,
  });
  function cell(x, z) {
    const p = local(x, z),
      ix = Math.floor((p.x - minX) / step),
      iz = Math.floor((p.z - minZ) / step);
    return ix < 0 || iz < 0 || ix >= nx || iz >= nz ? null : { ix, iz, index: iz * nx + ix, p };
  }
  function height(x, z) {
    const sample = cell(x, z);
    if (!sample) return undefined;
    const h = heights[sample.index];
    if (h === null) return null;
    // Smooth within the measured neighbouring stair/floor samples, never across a wall.
    const u = (sample.p.x - minX) / step - 0.5,
      v = (sample.p.z - minZ) / step - 0.5,
      ix = Math.floor(u),
      iz = Math.floor(v),
      fx = u - ix,
      fz = v - iz;
    if (ix < 0 || iz < 0 || ix + 1 >= nx || iz + 1 >= nz) return h * scale;
    const q = [
      heights[iz * nx + ix],
      heights[iz * nx + ix + 1],
      heights[(iz + 1) * nx + ix],
      heights[(iz + 1) * nx + ix + 1],
    ];
    // A solid neighbour or a wall-sized jump (over 1.2 m) does not take part;
    // it reads as the centre height so the field stays continuous up to the
    // wall. Tall risers the raster missed become steep ramps rather than
    // invisible steps that stop a walking body.
    const r = q.map((y) => (y === null || Math.abs(y - h) > 1.2 ? h : y));
    return ((r[0] * (1 - fx) + r[1] * fx) * (1 - fz) + (r[2] * (1 - fx) + r[3] * fx) * fz) * scale;
  }
  // The largest height difference between the body centre and its eight-point
  // ring; null when any sample is solid. Walls and drops show as large values.
  // The ring is capped at the width of a broad human shoulder: the great ape
  // still collides with walls and other bodies at its full radius, but the
  // 0.35 m atlas cannot describe corridors finely enough for a 1.5 m ring
  // without pockets that trap it on the side stairs.
  const RING_CAP = 0.5;
  function deviation(x, z, radius = 0) {
    const centre = height(x, z);
    if (centre === null) return null;
    const ring = Math.min(radius, RING_CAP);
    let worst = 0;
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4,
        h = height(x + Math.cos(angle) * ring, z + Math.sin(angle) * ring);
      if (h === null) return null;
      if (centre !== undefined && h !== undefined) worst = Math.max(worst, Math.abs(h - centre));
    }
    return worst;
  }
  // 2026-09-13: the limits were tuned on the 1.2x ruin (0.84 m ring, 0.9 m
  // step); they are body limits, not model limits, so they no longer scale.
  const ringLimit = (radius) => Math.max(0.84, radius * 1.5);
  function free(x, z, radius = 0) {
    const worst = deviation(x, z, radius);
    return worst !== null && worst <= ringLimit(radius);
  }
  // A step is allowed when the destination is free, or when the body is already
  // brushing a ledge and the step does not bring it any closer (so a stair edge
  // never traps a player who reached it legally). Drops stay with transition().
  function allows(from, to, radius = 0) {
    if (free(to.x, to.z, radius)) return true;
    const next = deviation(to.x, to.z, radius);
    if (next === null) return false;
    const current = deviation(from.x, from.z, radius);
    return current !== null && next <= Math.min(current + 0.25, ringLimit(radius) + 0.6);
  }
  function transition(a, b) {
    const ah = height(a.x, a.z),
      bh = height(b.x, b.z);
    if (ah === null || bh === null) return false;
    if (ah === undefined && bh === undefined) return true;
    // A tall step (the top riser of the side stairs reads as 0.7 m where the
    // smoothing stops at a wall) is climbable; a 0.9 m ledge is not, even at a run.
    return Math.abs((ah ?? 0) - (bh ?? 0)) <= 0.9 + Math.hypot(a.x - b.x, a.z - b.z) * 0.6;
  }
  return { local, world, cell, height, free, deviation, allows, transition, data, placement };
}
