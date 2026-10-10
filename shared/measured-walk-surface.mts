// A height atlas sampled from an exported GLB. Null cells are solid or unreachable.
// This is physics data only; the renderer always loads the original GLB.

// The eight ring directions, from the same expressions deviation() evaluated on every call.
const RING_X = Array.from({ length: 8 }, (_, i) => Math.cos((i * Math.PI) / 4));
const RING_Z = Array.from({ length: 8 }, (_, i) => Math.sin((i * Math.PI) / 4));
// Margin (world metres) by which a whole body ring must clear the atlas before deviation()
// skips its nine samples. It far exceeds the rounding of local() and of the ring offsets, which
// grows with the coordinates' magnitude, hence the relative term.
const OUTSIDE_MARGIN = 0.01;
const OUTSIDE_RELATIVE = 1e-9;

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
  // local() and cell() inlined: the same operations in the same order, without their objects.
  function height(x, z) {
    const px = (c * (x - placement.x) - s * (z - placement.z)) / scale,
      pz = (s * (x - placement.x) + c * (z - placement.z)) / scale,
      cx = Math.floor((px - minX) / step),
      cz = Math.floor((pz - minZ) / step);
    if (cx < 0 || cz < 0 || cx >= nx || cz >= nz) return undefined;
    const h = heights[cz * nx + cx];
    if (h === null) return null;
    // Smooth within the measured neighbouring stair/floor samples, never across a wall.
    const u = (px - minX) / step - 0.5,
      v = (pz - minZ) / step - 0.5,
      ix = Math.floor(u),
      iz = Math.floor(v),
      fx = u - ix,
      fz = v - iz;
    if (ix < 0 || iz < 0 || ix + 1 >= nx || iz + 1 >= nz) return h * scale;
    const q0 = heights[iz * nx + ix],
      q1 = heights[iz * nx + ix + 1],
      q2 = heights[(iz + 1) * nx + ix],
      q3 = heights[(iz + 1) * nx + ix + 1];
    // A solid neighbour or a wall-sized jump (over 1.2 m) does not take part;
    // it reads as the centre height so the field stays continuous up to the
    // wall. Tall risers the raster missed become steep ramps rather than
    // invisible steps that stop a walking body.
    const r0 = q0 === null || Math.abs(q0 - h) > 1.2 ? h : q0,
      r1 = q1 === null || Math.abs(q1 - h) > 1.2 ? h : q1,
      r2 = q2 === null || Math.abs(q2 - h) > 1.2 ? h : q2,
      r3 = q3 === null || Math.abs(q3 - h) > 1.2 ? h : q3;
    return ((r0 * (1 - fx) + r1 * fx) * (1 - fz) + (r2 * (1 - fx) + r3 * fx) * fz) * scale;
  }
  // Whether every sample of a ring of this radius around (x,z) lies outside the atlas: true only
  // when the whole ring clears one side of the local rectangle by the margin. The margin grows
  // with every magnitude involved, so non-finite input or bounds make it infinite or NaN and the
  // full evaluation runs instead; so does any operand that is not a number, which is coerced
  // (or throws) there exactly as before.
  const bounded =
      typeof minX === 'number' &&
      typeof minZ === 'number' &&
      typeof step === 'number' &&
      typeof scale === 'number',
    maxX = bounded ? minX + nx * step : NaN,
    maxZ = bounded ? minZ + nz * step : NaN,
    extent = bounded ? Math.abs(minX) + Math.abs(maxX) + Math.abs(minZ) + Math.abs(maxZ) : NaN;
  function ringOutside(x, z, ring) {
    const ox = placement.x,
      oz = placement.z;
    if (!bounded || typeof ox !== 'number' || typeof oz !== 'number') return false;
    const px = (c * (x - ox) - s * (z - oz)) / scale,
      pz = (s * (x - ox) + c * (z - oz)) / scale;
    const magnitude = Math.abs(ring) + Math.abs(x) + Math.abs(z) + Math.abs(ox) + Math.abs(oz),
      margin =
        (Math.abs(ring) + OUTSIDE_MARGIN + OUTSIDE_RELATIVE * magnitude) / Math.abs(scale) +
        OUTSIDE_RELATIVE * (Math.abs(px) + Math.abs(pz) + extent);
    return px < minX - margin || px > maxX + margin || pz < minZ - margin || pz > maxZ + margin;
  }
  // The largest height difference between the body centre and its eight-point
  // ring; null when any sample is solid. Walls and drops show as large values.
  // The ring is capped at the width of a broad human shoulder: the great ape
  // still collides with walls and other bodies at its full radius, but the
  // 0.35 m atlas cannot describe corridors finely enough for a 1.5 m ring
  // without pockets that trap it on the side stairs.
  const RING_CAP = 0.5;
  function deviation(x, z, radius = 0) {
    // Away from the atlas all nine samples read undefined, which this reports as 0.
    if (
      typeof x === 'number' &&
      typeof z === 'number' &&
      typeof radius === 'number' &&
      ringOutside(x, z, Math.min(radius, RING_CAP))
    )
      return 0;
    const centre = height(x, z);
    if (centre === null) return null;
    const ring = Math.min(radius, RING_CAP);
    let worst = 0;
    for (let i = 0; i < 8; i++) {
      const h = height(x + RING_X[i] * ring, z + RING_Z[i] * ring);
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
  // The destination's deviation is evaluated once for both checks.
  function allows(from, to, radius = 0) {
    const next = deviation(to.x, to.z, radius);
    if (next !== null && next <= ringLimit(radius)) return true;
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
