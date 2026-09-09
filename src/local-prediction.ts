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

  reset() {
    this.actor = null;
    this.latest = null;
    this.receivedAt = -Infinity;
    this.input = { dx: 0, dz: 0, running: false };
    this.inputAt = -Infinity;
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
      Math.hypot(player.x - this.latest.x, player.z - this.latest.z) > 6;
    if (reset || player.downedUntil) this.stop();
    this.latest = player;
    this.receivedAt = now;
    // Every snapshot reanchors prediction, so packet loss cannot accumulate drift.
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
      return p;
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
    movePlayer(
      p,
      Math.min(0.05, dt) + catchup,
      now,
      (actor, dx, dz) => collision.move(actor, dx, dz, p.radius, obstacles),
      configuredSpeed,
    );
    return p;
  }
}
