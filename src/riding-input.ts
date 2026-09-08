import { RIDING, ridingDistance } from '../shared/riding.mjs';

// Replan only while the user is explicitly approaching a moving mount. This
// state never mounts by proximity alone and is cancelled by other input.
export class RideApproach {
  declare targetId: any;
  declare nextPath: any;
  declare progressAt: any;
  declare progress:
    | {
        x: any;
        z: any;
      }
    | {
        x: any;
        z: any;
      }
    | null
    | undefined;

  begin(id) {
    this.targetId = id;
    this.nextPath = 0;
    this.progressAt = null;
    this.progress = null;
  }
  cancel() {
    this.targetId = null;
  }
  update(player, animals, now) {
    if (!this.targetId) return null;
    const animal = animals.find((a) => a.id === this.targetId);
    if (!player || player.mountId || player.downedUntil) {
      this.cancel();
      return null;
    }
    if (!animal || animal.phase !== 'alive' || animal.riderId) {
      this.cancel();
      return { kind: 'cancel', text: 'このマンモスには今は乗れません。' };
    }
    if (ridingDistance(player, animal) <= RIDING.reach - 0.15) {
      this.cancel();
      return { kind: 'mount', id: animal.id };
    }
    if (this.progressAt === null) {
      this.progressAt = now;
      this.progress = { x: player.x, z: player.z };
    }
    if (now - this.progressAt >= 10000) {
      const moved = Math.hypot(player.x - this.progress.x, player.z - this.progress.z);
      this.progressAt = now;
      this.progress = { x: player.x, z: player.z };
      if (moved < 0.1) {
        this.cancel();
        return { kind: 'cancel', text: '進路がふさがれています。マンモスの横へ移動して R。' };
      }
    }
    if (now < this.nextPath) return null;
    this.nextPath = now + 1200;
    const dx = player.x - animal.x,
      dz = player.z - animal.z,
      length = Math.hypot(dx, dz) || 1;
    const offset = animal.radius + player.radius + 0.45;
    return {
      kind: 'target',
      x: animal.x + (dx / length) * offset,
      z: animal.z + (dz / length) * offset,
    };
  }
}
