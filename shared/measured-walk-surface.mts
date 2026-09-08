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
    if (q.some((y) => y === null || Math.abs(y - h) > 0.8)) return h * scale;
    return ((q[0] * (1 - fx) + q[1] * fx) * (1 - fz) + (q[2] * (1 - fx) + q[3] * fx) * fz) * scale;
  }
  function free(x, z, radius = 0) {
    const centre = height(x, z);
    if (centre === null) return false;
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4,
        h = height(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius);
      if (h === null) return false;
      if (
        centre !== undefined &&
        h !== undefined &&
        Math.abs(h - centre) > Math.max(0.7 * scale, radius * 1.5)
      )
        return false;
    }
    return true;
  }
  function transition(a, b) {
    const ah = height(a.x, a.z),
      bh = height(b.x, b.z);
    if (ah === null || bh === null) return false;
    if (ah === undefined && bh === undefined) return true;
    return Math.abs((ah ?? 0) - (bh ?? 0)) <= 0.6 * scale + Math.hypot(a.x - b.x, a.z - b.z) * 1.1;
  }
  return { local, world, cell, height, free, transition, data, placement };
}
