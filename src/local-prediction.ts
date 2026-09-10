import { movePlayer } from '../shared/movement.mjs';
import { attackProfile } from '../shared/combat-profiles.mjs';

/** Display-only simulation. Inventory, combat outcomes and world state stay authoritative. */
export class LocalPrediction {
  actor: any = null;
  latest: any = null;
  receivedAt = -Infinity;
  input = { dx: 0, dz: 0, running: false };
  inputAt = -Infinity;
  enabled = false;
  latencyMs = 0;
  private display: any = null;
  private correction = { x: 0, z: 0 };
  private reconcile = false;

  reset() {
    this.actor = null;
    this.latest = null;
    this.receivedAt = -Infinity;
    this.input = { dx: 0, dz: 0, running: false };
    this.inputAt = -Infinity;
    this.display = null;
    this.correction = { x: 0, z: 0 };
    this.reconcile = false;
  }
  setInput(dx: number, dz: number, running: boolean, now: number) {
    this.input = { dx, dz, running };
    this.inputAt = now;
  }
  stop() {
    this.input = { dx: 0, dz: 0, running: false };
    this.inputAt = -Infinity;
    if (this.actor) {
      this.actor.target = null;
      this.actor.navigationGoal = null;
    }
  }
  receive(player, now: number) {
    if (!this.enabled || !player) {
      this.reset();
      return;
    }
    const reset =
      !this.latest ||
      this.latest.id !== player.id ||
      this.latest.mountId !== player.mountId ||
      this.latest.boatId !== player.boatId ||
      this.latest.carrierId !== player.carrierId ||
      this.latest.passengerId !== player.passengerId ||
      this.latest.hurtSequence !== player.hurtSequence ||
      this.latest.defeatSequence !== player.defeatSequence ||
      (this.latest.warpSequence ?? 0) !== (player.warpSequence ?? 0) ||
      Math.hypot(player.x - this.latest.x, player.z - this.latest.z) > 6;
    if (reset || player.downedUntil) {
      this.stop();
      this.display = null;
      this.correction = { x: 0, z: 0 };
    }
    this.reconcile = !!this.display;
    this.latest = player;
    this.receivedAt = now;
    // Reanchor simulation on every packet, but preserve the displayed position.
    // Its small correction decays in step(), independently of gait and facing.
    this.actor = {
      ...player,
      dx: 0,
      dz: 0,
      lastInput: now,
      runningRequested: false,
      target: null,
      path: [],
      navigationGoal: null,
      navigationEnd: null,
      nextNavigationAt: 0,
    };
  }
  step(dt: number, now: number, serverNow: number, collision, obstacles, configuredSpeed?: number) {
    const p = this.actor;
    if (!this.enabled || !p) return null;
    if (
      now - this.receivedAt > 250 ||
      p.downedUntil ||
      p.carrierId ||
      (p.attackSequence && serverNow - p.attackAt < attackProfile(p).durationMs)
    ) {
      p.moving = false;
      p.running = false;
      p.speed = 0;
      // Stop immediately on loss/attack; do not keep drifting through the last
      // correction while input is locked. A subsequent packet reconciles again.
      return this.display
        ? Object.assign(this.display, p, { x: this.display.x, z: this.display.z })
        : p;
    }
    const input = now - this.inputAt < 250 ? this.input : { dx: 0, dz: 0, running: false };
    Object.assign(p, {
      dx: input.dx,
      dz: input.dz,
      lastInput: now,
      runningRequested: input.running,
    });
    // A small, bounded RTT estimate covers the packet's trip; the next snapshot
    // still corrects the position. No client clock is trusted by the server.
    const age = Math.min(100, Math.max(0, this.latencyMs / 2));
    const catchup = p.predictionStarted ? 0 : age / 1000;
    p.predictionStarted = true;
    const move = (actor, dx, dz) => collision.move(actor, dx, dz, p.radius, obstacles);
    if (catchup) movePlayer(p, catchup, now, move, configuredSpeed);
    const beforeX = p.x,
      beforeZ = p.z;
    movePlayer(p, Math.min(0.05, dt), now, move, configuredSpeed);
    if (!this.display) this.display = { ...p };
    if (this.reconcile) {
      // Continue this frame's actual movement from the last displayed position.
      // RTT catch-up and network corrections must never become an extra footstep.
      this.correction.x = this.display.x - beforeX;
      this.correction.z = this.display.z - beforeZ;
      this.reconcile = false;
    }
    const decay = Math.exp(-Math.max(0, dt) * 12);
    this.correction.x *= decay;
    this.correction.z *= decay;
    const next = move(
      this.display,
      p.x + this.correction.x - this.display.x,
      p.z + this.correction.z - this.display.z,
    );
    this.correction.x = next.x - p.x;
    this.correction.z = next.z - p.z;
    Object.assign(this.display, p, next);
    return this.display;
  }
}
