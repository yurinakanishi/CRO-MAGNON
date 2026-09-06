export const WATER_LEVEL = -0.45;
export const riverX = z => 65 + Math.sin(z * .065) * 3.5;
export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
let sourceSurface = null;
let sourceBridge = null;
export const riverBankDrop = (x, z) => clamp((3.8 - Math.abs(x - riverX(z))) / 1.25, 0, 1) * .72;

// The height samples come from ray queries against the exact reconstructed GLB.
// Only a shallow river-bank fitting offset is applied when placing the tiles.
export function installSourceTerrain(field) {
  const { resolution, heights, tileSize = 20, origin = -90 } = field;
  if (!Number.isInteger(resolution) || resolution < 2 || heights.length !== resolution ** 2 || !heights.every(Number.isFinite) || !(tileSize > 0)) throw new Error('Invalid source terrain height samples');
  const sampler = (x, z) => {
    const centreX = origin + Math.round((x - origin) / tileSize) * tileSize;
    const centreZ = origin + Math.round((z - origin) / tileSize) * tileSize;
    const u = clamp((x - centreX) / tileSize + .5, 0, 1) * (resolution - 1);
    const v = clamp((z - centreZ) / tileSize + .5, 0, 1) * (resolution - 1);
    const ix = Math.min(resolution - 2, Math.floor(u)), iz = Math.min(resolution - 2, Math.floor(v)), fx = u - ix, fz = v - iz;
    const a = heights[iz * resolution + ix] * (1 - fx) + heights[iz * resolution + ix + 1] * fx;
    const b = heights[(iz + 1) * resolution + ix] * (1 - fx) + heights[(iz + 1) * resolution + ix + 1] * fx;
    return a * (1 - fz) + b * fz;
  };
  sourceSurface = sampler;
  return () => { if (sourceSurface === sampler) sourceSurface = null; };
}

export function terrainHeight(x, z) {
  if (sourceSurface) return sourceSurface(x, z) - riverBankDrop(x, z);
  return previewTerrainHeight(x, z);
}

function previewTerrainHeight(x, z) {
  const d = Math.hypot(x - 50, z - 50);
  const hills = Math.sin(x * .071) * Math.cos(z * .081) * 1.8 + Math.sin(x * .18 + z * .07) * .4;
  const clearing = Math.exp(-((x-50)**2+(z-50)**2)/210);
  const npcClearing = Math.exp(-((x-70)**2+(z-41)**2)/55);
  const edge = Math.max(0, d - 47);
  const mountains = edge * (.24 + .15 * Math.sin(Math.atan2(z - 50, x - 50)*7)) + Math.max(0, d-75)*.18;
  let y = (hills + .7) * (1 - clearing * .93) * (1 - npcClearing * .8) + mountains;
  const riverDistance = Math.abs(x-riverX(z));
  const riverBlend = clamp((4.2-riverDistance)/2.2,0,1);
  y = y * (1-riverBlend) + (-1.05 + riverDistance * .045) * riverBlend;
  return y;
}
export function walkHeight(x,z) {
  if (sourceBridge) {
    const bridge = sourceBridge, lx = x - bridge.x, lz = z - bridge.z;
    if (lx >= bridge.bounds.minX && lx <= bridge.bounds.maxX && lz >= bridge.bounds.minZ && lz <= bridge.bounds.maxZ) return bridge.deckY;
    return terrainHeight(x,z);
  }
  // The footbridge is also the walk surface, so characters do not pass through it.
  if(z>41.8 && z<45.2 && x>riverX(43.5)-5.5 && x<riverX(43.5)+5.5) return .3;
  return terrainHeight(x,z);
}
export function installSourceBridge(bounds, x = riverX(43.5), z = 43.5, deckY = .3) {
  if (![bounds.minX,bounds.maxX,bounds.minZ,bounds.maxZ,x,z,deckY].every(Number.isFinite) || bounds.minX >= bounds.maxX || bounds.minZ >= bounds.maxZ) throw new Error('Invalid source bridge bounds');
  const bridge = { bounds: { ...bounds }, x, z, deckY };
  sourceBridge = bridge;
  return () => { if (sourceBridge === bridge) sourceBridge = null; };
}
export function movementFromCamera(sx, sy, yaw) {
  const length = Math.max(1,Math.hypot(sx,sy));
  return {dx:(sx*Math.cos(yaw)+sy*Math.sin(yaw))/length,dz:(-sx*Math.sin(yaw)+sy*Math.cos(yaw))/length};
}
