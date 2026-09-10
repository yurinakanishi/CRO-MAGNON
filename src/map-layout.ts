/** Connected groups in screen pixels: every fire remains individually selectable in a group. */
export function groupMapPoints<T extends { x: number; y: number }>(points: T[], gap = 44): T[][] {
  const groups: T[][] = [];
  for (const point of points) {
    const touching = groups.filter((group) =>
      group.some((p) => Math.hypot(p.x - point.x, p.y - point.y) < gap),
    );
    const merged = [point, ...touching.flat()];
    for (const group of touching) groups.splice(groups.indexOf(group), 1);
    groups.push(merged);
  }
  return groups;
}
