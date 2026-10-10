import { caveLocal, caveWorldAt } from '../shared/camp-cave-layout.mjs';
import { movementFromCamera } from '../shared/terrain.mjs';

/** Local preview only. The real room's player and saved position are never moved. */
export class LoadingCaveMovement {
  position = caveWorldAt(-20);
  facing = Math.PI;
  speed = 0;

  step(collision, x: number, y: number, yaw: number, dt: number, running = false) {
    const elapsed = Math.max(0, Math.min(0.05, dt));
    const { dx, dz } = movementFromCamera(x, y, yaw);
    const distance = (running ? 4 : 2.3) * elapsed;
    const before = this.position;
    const next = collision.move(before, dx * distance, dz * distance, 0.35);
    const local = caveLocal(next.x, next.z);
    // Keep the visitor inside the measured gallery, away from the unloaded outside.
    if (local.z >= -38 && local.z <= -1) this.position = next;
    const mx = this.position.x - before.x,
      mz = this.position.z - before.z;
    this.speed = elapsed ? Math.hypot(mx, mz) / elapsed : 0;
    if (this.speed > 0.025) this.facing = Math.atan2(mx, mz);
  }
}
