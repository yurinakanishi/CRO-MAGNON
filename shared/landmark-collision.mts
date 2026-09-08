export function landmarkObstacles(placements, bounds) {
  return placements.flatMap((item) => {
    const source = bounds[item.key];
    if (!source?.boxes?.length) throw new Error(`Missing measured landmark footprint: ${item.key}`);
    const c = Math.cos(item.yaw),
      s = Math.sin(item.yaw),
      scale = item.scale;
    return source.boxes.map((box, index) => {
      const x = (box.minX + box.maxX) * 0.5 * scale,
        z = (box.minZ + box.maxZ) * 0.5 * scale;
      return {
        id: `${item.id}:${index}`,
        landmarkId: item.id,
        modelKey: item.key,
        type: 'box',
        x: item.x + c * x + s * z,
        z: item.z - s * x + c * z,
        hx: (box.maxX - box.minX) * 0.5 * scale,
        hz: (box.maxZ - box.minZ) * 0.5 * scale,
        c,
        s,
        height: box.height * scale,
        groundX: item.x,
        groundZ: item.z,
        groundOffset: item.groundOffset ?? -0.08,
      };
    });
  });
}
