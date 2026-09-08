// CPU placement index. Expensive source geometry is shared, independently of map area.
export class PlacementGrid<T extends { x: number; z: number } = { x: number; z: number }> {
  declare size: number;
  declare cells: Map<string, T[]>;

  constructor(items: readonly T[] = [], size = 32) {
    this.size = size;
    this.cells = new Map();
    for (const item of items) {
      const key = `${Math.floor(item.x / size)},${Math.floor(item.z / size)}`;
      if (!this.cells.has(key)) this.cells.set(key, []);
      this.cells.get(key)!.push(item);
    }
  }
  *near(x: number, z: number, radius: number): Generator<T> {
    for (
      let ix = Math.floor((x - radius) / this.size);
      ix <= Math.floor((x + radius) / this.size);
      ix++
    ) {
      for (
        let iz = Math.floor((z - radius) / this.size);
        iz <= Math.floor((z + radius) / this.size);
        iz++
      ) {
        yield* this.cells.get(`${ix},${iz}`) ?? [];
      }
    }
  }
  maximumNearby(radius: number) {
    const span = Math.ceil(radius / this.size) + 1;
    let maximum = 0;
    // Count full neighbouring bins; this safely bounds every continuous camera position.
    for (const key of this.cells.keys()) {
      const [x, z] = key.split(',').map(Number);
      let count = 0;
      for (let ix = x - span; ix <= x + span; ix++)
        for (let iz = z - span; iz <= z + span; iz++)
          count += this.cells.get(`${ix},${iz}`)?.length ?? 0;
      maximum = Math.max(maximum, count);
    }
    return Math.max(1, maximum);
  }
}
