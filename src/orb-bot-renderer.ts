import * as THREE from 'three';
import type { WorldRenderer } from './world3d.js';
import type { OrbBotSnapshot } from '../shared/orb-bot-types.mjs';
import { botFlightPosition, botGroundHeight, ORB_BOTS } from '../shared/orb-bots.mjs';
import { updateActorPerformance } from './performance-lod.js';
import { applyBotFlightTurn } from './bot-flight-pose.js';
import { companionHeartTexture } from './companion-heart-texture.js';

type Actor = ReturnType<WorldRenderer['worldAssets']['createAnimal']>;
type Entry = {
  actor: Actor;
  state: OrbBotSnapshot;
  mode: string;
  sequence: number;
  hearts?: THREE.Sprite[];
};

/** Draw only the reviewed, image-derived companion GLBs. */
export class OrbBotRenderer {
  readonly bots = new Map<string, Entry>();
  private heartTexture?: THREE.Texture;

  constructor(private world: WorldRenderer) {}

  petTarget(b: OrbBotSnapshot, out: THREE.Vector3) {
    const actor = this.bots.get(b.id)?.actor;
    if (actor) out.copy(actor.root.position);
    else out.set(b.x, b.y, b.z);
    out.y += ORB_BOTS.diameter * 0.9;
    return out;
  }

  private removeHearts(entry: Entry) {
    for (const heart of entry.hearts ?? []) {
      this.world.scene.remove(heart);
      (heart.material as THREE.SpriteMaterial).dispose();
    }
  }

  update(dt: number) {
    const { world } = this;
    const now = world.serverNow();
    // Recruited NPC companions keep their original single renderer and GLB.
    const states = (world.state.orbBots ?? []).filter(
      (b) => b.kind !== '524' && b.kind !== 'rimo-neko',
    );
    const ids = new Set(states.map((b) => b.id));
    for (const [id, entry] of this.bots)
      if (!ids.has(id)) {
        this.removeHearts(entry);
        world.scene.remove(entry.actor.root);
        entry.actor.dispose();
        this.bots.delete(id);
      }
    for (const b of states) {
      let entry = this.bots.get(b.id);
      if (!entry) {
        if (!world.worldAssets.templates.has(`orb-bot-${b.kind}`)) continue;
        const actor = world.worldAssets.createAnimal(`orb-bot-${b.kind}`);
        actor.root.userData.animalId = b.id;
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
        (b.mode !== 'windup' || !!owner?.actor) &&
        (b.ownerId === world.selfId || Math.hypot(b.x - world.focus.x, b.z - world.focus.z) < 60);
      for (const heart of entry.hearts ?? []) heart.visible = false;
      if (!actor.root.visible) continue;
      actor.root.rotation.x = actor.root.rotation.z = 0;
      const distance = actor.root.position.distanceTo(world.camera.position);
      updateActorPerformance(actor.root, distance);
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
        const happyAge =
          b.petPlayerId && b.petContactAt ? now - b.petContactAt - ORB_BOTS.petStrokeMs : -1;
        if (happyAge >= 0 && happyAge < ORB_BOTS.happyMs) {
          actor.sampleOnce('Catch', happyAge / 1000);
          if (!entry.hearts) {
            this.heartTexture ??= companionHeartTexture();
            entry.hearts = Array.from({ length: 3 }, () => {
              const heart = new THREE.Sprite(
                new THREE.SpriteMaterial({
                  map: this.heartTexture,
                  transparent: true,
                  depthWrite: false,
                  toneMapped: false,
                }),
              );
              heart.raycast = () => {};
              world.scene.add(heart);
              return heart;
            });
          }
          entry.hearts.forEach((heart, i) => {
            const t = (happyAge - i * 120) / 600;
            heart.visible = t > 0 && t < 1;
            heart.position.set(
              b.x + Math.sin(i * 2.4) * 0.15,
              b.y + 0.32 + t * 0.35,
              b.z + Math.cos(i * 2.4) * 0.15,
            );
            heart.scale.setScalar(0.09);
            (heart.material as THREE.SpriteMaterial).opacity = Math.max(0, Math.sin(t * Math.PI));
          });
        } else if (b.mode === 'landing' || b.mode === 'catching')
          actor.sampleOnce(
            b.mode === 'landing' ? 'Land' : 'Catch',
            Math.max(0, (now - b.phaseAt) / 1000),
          );
        else {
          actor.play(
            b.speed > 2 ? 'Run_Loop' : b.speed > 0.05 ? 'Walk_Loop' : 'Idle_Loop',
            b.speed > 0.05 ? THREE.MathUtils.clamp(b.speed / 3, 0.7, 1.7) : 1,
          );
          const step = world.actorBudget.step(actor, actor.root.position, distance, now / 1000, dt);
          if (step !== null) actor.update(step);
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
    for (const entry of this.bots.values()) {
      const { actor } = entry;
      this.removeHearts(entry);
      this.world.scene.remove(actor.root);
      actor.dispose();
    }
    this.bots.clear();
    this.heartTexture?.dispose();
  }
}
