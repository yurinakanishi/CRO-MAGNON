import { Matrix4, Vector3, type Camera } from 'three';

// Static placements only need rebuilding when the view (or a rider's sight line)
// changes. Compare against the last admitted view so tiny movements accumulate.
export class ViewUpdateGate {
  private readonly world = new Matrix4();
  private readonly projection = new Matrix4();
  private readonly focus = new Vector3();
  private hadFocus = false;
  private initialized = false;
  private next = 0;

  constructor(private readonly interval = 0.18) {}

  shouldUpdate(camera: Camera, time: number, riderFocus: Vector3 | null = null): boolean {
    if (time < this.next) return false;
    this.next = time + this.interval;
    const hasFocus = riderFocus !== null;
    if (
      this.initialized &&
      hasFocus === this.hadFocus &&
      (!riderFocus || this.focus.distanceToSquared(riderFocus) < 1e-12) &&
      sameMatrix(this.world, camera.matrixWorld) &&
      sameMatrix(this.projection, camera.projectionMatrix)
    )
      return false;

    this.world.copy(camera.matrixWorld);
    this.projection.copy(camera.projectionMatrix);
    if (riderFocus) this.focus.copy(riderFocus);
    this.hadFocus = hasFocus;
    this.initialized = true;
    return true;
  }
}

function sameMatrix(a: Matrix4, b: Matrix4): boolean {
  return a.elements.every((value, index) => Math.abs(value - b.elements[index]) < 1e-6);
}
