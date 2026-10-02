import * as THREE from 'three';
import type { WorldRenderer } from './world3d.js';
import type { OrbBotSnapshot } from '../shared/orb-bot-types.mjs';
import { botFlightPosition, botGroundHeight, ORB_BOTS } from '../shared/orb-bots.mjs';
import { updateActorPerformance } from './performance-lod.js';
import { applyBotFlightTurn } from './bot-flight-pose.js';

type Actor = ReturnType<WorldRenderer['worldAssets']['createAnimal']>;
type Entry = { actor: Actor; state: OrbBotSnapshot; mode: string; sequence: number };

/** Draw only the reviewed, image-derived companion GLBs. */
export class OrbBotRenderer {
  readonly bots = new Map<string, Entry>();

  constructor(private world: WorldRenderer) {}

  update(dt: number) {
    const { world } = this;
    const now = world.serverNow();
    // The recruited 524 keeps its original single NPC renderer and floating GLB.
    const states = (world.state.orbBots ?? []).filter((b) => b.kind !== '524');
    const ids = new Set(states.map((b) => b.id));
    for (const [id, entry] of this.bots)
      if (!ids.has(id)) {
        world.scene.remove(entry.actor.root);
        entry.actor.dispose();
        this.bots.delete(id);
      }
    for (const b of states) {
      let entry = this.bots.get(b.id);
      if (!entry) {
        const actor = world.worldAssets.createAnimal(`orb-bot-${b.kind}`);
        actor.root.position.set(b.x, b.y, b.z);
        world.scene.add(actor.root);
        entry = { actor, state: b, mode: b.mode, sequence: b.sequence };
        this.bots.set(b.id, entry);
      }
      const { actor } = entry;
      entry.state = b;
      const owner = world.players.get(b.ownerId);
      actor.root.visible =
        b.mode !== 'stowed' &&
        !!owner &&
        (b.mode !== 'windup' || !!owner.actor) &&
        (b.ownerId === world.selfId || Math.hypot(b.x - world.focus.x, b.z - world.focus.z) < 60);
      if (!actor.root.visible) continue;
      actor.root.rotation.x = actor.root.rotation.z = 0;
      updateActorPerformance(actor.root, actor.root.position.distanceTo(world.camera.position));
      const position = new THREE.Vector3(b.x, b.y, b.z);
      if (b.mode === 'windup' && owner?.actor?.orbBotPose.weight > 0) {
        position.copy(owner.actor.orbBotPose.contact);
        if (b.origin) {
          const t = THREE.MathUtils.clamp((now - b.throwAt) / ORB_BOTS.pickupMs, 0, 1);
          position.lerpVectors(
            new THREE.Vector3(b.origin.x, b.origin.y, b.origin.z),
            position,
            t * t * (3 - 2 * t),
          );
        }
        actor.root.position.copy(position);
        actor.root.rotation.y = owner.model.rotation.y;
        actor.play('Held_Loop');
        actor.update(dt);
      } else if (b.mode === 'airborne') {
        const p = botFlightPosition(b, now);
        if (p) position.set(p.x, p.y, p.z);
        applyBotFlightTurn(actor.root, position, b.facing, p?.t ?? 0, actor.asset.heightMetres / 2);
        actor.sampleOnce('Thrown_Loop', ((p?.t ?? 0) * ORB_BOTS.flightMs) / 1000);
      } else {
        const delta = actor.root.position.distanceTo(position);
        const transition = entry.mode !== b.mode || entry.sequence !== b.sequence;
        if (
          transition ||
          delta > 2 ||
          !world.collision.segmentFree(actor.root.position, position, ORB_BOTS.radius)
        )
          actor.root.position.copy(position);
        else actor.root.position.lerp(position, 1 - Math.exp(-dt * 18));
        actor.root.position.y = botGroundHeight(actor.root.position.x, actor.root.position.z);
        const yaw = b.facing - actor.root.rotation.y;
        actor.root.rotation.y +=
          Math.atan2(Math.sin(yaw), Math.cos(yaw)) * (1 - Math.exp(-dt * 18));
        if (b.mode === 'landing' || b.mode === 'catching')
          actor.sampleOnce(
            b.mode === 'landing' ? 'Land' : 'Catch',
            Math.max(0, (now - b.phaseAt) / 1000),
          );
        else {
          actor.play(
            b.speed > 2 ? 'Run_Loop' : b.speed > 0.05 ? 'Walk_Loop' : 'Idle_Loop',
            b.speed > 0.05 ? THREE.MathUtils.clamp(b.speed / 3, 0.7, 1.7) : 1,
          );
          actor.update(dt);
        }
      }
      entry.mode = b.mode;
      entry.sequence = b.sequence;
    }
  }

  diagnostics() {
    return [...this.bots.values()].map(({ actor, state }) => ({
      id: state.id,
      kind: state.kind,
      mode: state.mode,
      ownerId: state.ownerId,
      sequence: state.sequence,
      model: actor.asset.modelKey,
      visible: actor.root.visible,
      position: actor.root.position.toArray(),
      pitch: actor.root.rotation.x,
      handError:
        state.mode === 'windup'
          ? actor.root.position.distanceTo(
              this.world.players.get(state.ownerId)?.actor?.orbBotPose.contact ??
                actor.root.position,
            )
          : null,
    }));
  }

  dispose() {
    for (const { actor } of this.bots.values()) {
      this.world.scene.remove(actor.root);
      actor.dispose();
    }
    this.bots.clear();
  }
}
