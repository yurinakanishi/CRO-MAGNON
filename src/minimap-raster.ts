/** The original global raster grid. A window samples these exact pixel centres,
 * keeping its palette and resolution while avoiding a whole-world first draw. */
export const MINIMAP_RASTER = Object.freeze({ width: 2048, height: 1024 });
export type RasterWindow = { x: number; y: number; width: number; height: number };
type WorldBounds = { minX: number; minZ: number; width: number; depth: number };

export function minimapRasterWindow(
  view: { width: number; height: number; scale: number; center: { x: number; z: number } },
  world: WorldBounds,
  retained?: RasterWindow,
): RasterWindow | null {
  const { width, height, scale, center } = view;
  if (![width, height, scale, world.width, world.depth].every((v) => Number.isFinite(v) && v > 0))
    throw new Error('Invalid minimap raster viewport');
  if (![center.x, center.z, world.minX, world.minZ].every(Number.isFinite))
    throw new Error('Invalid minimap raster position');
  const rx = MINIMAP_RASTER.width / world.width,
    ry = MINIMAP_RASTER.height / world.depth;
  // Two source pixels beyond the view keep bilinear filtering away from a
  // window edge. The only clamped edges are the original global image's edges.
  const left = Math.max(0, Math.floor((center.x - width / scale / 2 - world.minX) * rx) - 2),
    top = Math.max(0, Math.floor((center.z - height / scale / 2 - world.minZ) * ry) - 2),
    right = Math.min(
      MINIMAP_RASTER.width,
      Math.ceil((center.x + width / scale / 2 - world.minX) * rx) + 2,
    ),
    bottom = Math.min(
      MINIMAP_RASTER.height,
      Math.ceil((center.z + height / scale / 2 - world.minZ) * ry) + 2,
    );
  if (right <= left || bottom <= top) return null;
  if (
    retained &&
    retained.x <= left &&
    retained.y <= top &&
    retained.x + retained.width >= right &&
    retained.y + retained.height >= bottom
  )
    return retained;
  // One retained sampled window, with a movement margin. The caller fills it
  // into one global canvas, without allocating more canvases during travel.
  const block = 16,
    x = Math.max(0, Math.floor(left / block) * block - block),
    y = Math.max(0, Math.floor(top / block) * block - block),
    endX = Math.min(MINIMAP_RASTER.width, Math.ceil(right / block) * block + block),
    endY = Math.min(MINIMAP_RASTER.height, Math.ceil(bottom / block) * block + block);
  return { x, y, width: endX - x, height: endY - y };
}
