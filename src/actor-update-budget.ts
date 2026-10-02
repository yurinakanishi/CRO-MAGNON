import { Frustum, Matrix4, Sphere, type Camera, type Vector3 } from 'three';

/** Throttle only animation sampling, never movement, actions or network state. */
export class ActorUpdateBudget {
  private frustum = new Frustum();
  private projection = new Matrix4();
  private sphere = new Sphere();
  private clocks = new WeakMap<object, { last: number; visible: boolean }>();
  samples = 0;
  skipped = 0;
  begin(camera: Camera) {
    this.frustum.setFromProjectionMatrix(
      this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
  }
  step(
    actor: object,
    position: Vector3,
    distance: number,
    now: number,
    dt: number,
    important = false,
  ): number | null {
    this.sphere.center.copy(position);
    this.sphere.center.y += 0.4;
    this.sphere.radius = 1.2;
    const visible = this.frustum.intersectsSphere(this.sphere);
    const interval = important || (visible && distance < 16) ? 0 : visible ? 1 / 15 : 1 / 5;
    const clock = this.clocks.get(actor);
    if (clock && now >= clock.last && now - clock.last < interval && !(visible && !clock.visible)) {
      this.skipped++;
      return null;
    }
    this.clocks.set(actor, { last: now, visible });
    this.samples++;
    return clock ? Math.min(0.25, Math.max(0, now - clock.last)) : dt;
  }
}
