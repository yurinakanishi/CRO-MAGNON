import * as THREE from 'three';
import { RIMO_NEKO } from '../shared/rimo-neko.mjs';
import { walkHeight } from '../shared/terrain.mjs';
import { VisibleActorGroup } from './visible-actor-group.js';
import { isMesh } from './three-types.js';
import type { WorldRenderer } from './world3d.js';

/** Grounded quadruped. The delivered GLB owns all body/ear/tail/jaw motion. */
export class RimoNekoRenderer {
  readonly root = new VisibleActorGroup();
  readonly slope = new THREE.Group();
  readonly actor: ReturnType<WorldRenderer['worldAssets']['createAnimal']>;
  readonly label: ReturnType<WorldRenderer['createLabel']>;
  readonly hissLabel: ReturnType<WorldRenderer['createLabel']>;
  private contactBone: THREE.Object3D;
  private placed = false;
  private floor = 0;
  private reaction = 'idle';
  private renderedSpeed = 0;

  constructor(private world: WorldRenderer) {
    this.root.name = 'Rimo-neko ground companion';
    this.actor = world.worldAssets.createAnimal(RIMO_NEKO.modelKey);
    this.contactBone = this.actor.root.getObjectByName('PetContact')!;
    if (!this.contactBone) throw new Error('Rimo-neko is missing the verified head contact socket');
    this.root.userData.animalId = RIMO_NEKO.id;
    this.slope.add(this.actor.root);
    this.root.add(this.slope);
    world.scene.add(this.root);
    this.label = world.createLabel('リモねこ', 'companion', new THREE.Vector3());
    this.hissLabel = world.createLabel('シャーッ！', 'companion rimo-hiss', new THREE.Vector3());
  }

  petTarget(out: THREE.Vector3) {
    this.root.updateWorldMatrix(true, true);
    return this.contactBone.getWorldPosition(out);
  }

  update(dt: number) {
    const c = this.world.state.rimoNeko;
    if (!c) {
      this.root.visible = false;
      this.label.active = this.hissLabel.active = false;
      return;
    }
    const now = this.world.serverNow(),
      blend = 1 - Math.exp(-dt * 14);
    const previous = this.root.position.clone();
    if (!this.placed || Math.hypot(c.x - previous.x, c.z - previous.z) > 20) {
      this.root.position.set(c.x, walkHeight(c.x, c.z), c.z);
      this.root.rotation.y = c.facing;
      this.placed = true;
    } else {
      const next = this.world.collision.move(
        this.root.position,
        (c.x - previous.x) * blend,
        (c.z - previous.z) * blend,
        c.radius,
      );
      this.root.position.x = next.x;
      this.root.position.z = next.z;
    }
    const moved = Math.hypot(this.root.position.x - previous.x, this.root.position.z - previous.z);
    this.renderedSpeed += (Math.min(4.5, moved / Math.max(0.001, dt)) - this.renderedSpeed) * blend;
    const delta = Math.atan2(
      Math.sin(c.facing - this.root.rotation.y),
      Math.cos(c.facing - this.root.rotation.y),
    );
    this.root.rotation.y += delta * (1 - Math.exp(-dt * 10));
    const x = this.root.position.x,
      z = this.root.position.z,
      yaw = this.root.rotation.y;
    this.floor = walkHeight(x, z);
    this.root.position.y = this.floor + 0.002;
    const front = walkHeight(x + Math.sin(yaw) * 0.2, z + Math.cos(yaw) * 0.2);
    const back = walkHeight(x - Math.sin(yaw) * 0.2, z - Math.cos(yaw) * 0.2);
    this.slope.rotation.x = THREE.MathUtils.clamp(-Math.atan2(front - back, 0.4), -0.3, 0.3);
    const right = walkHeight(x + Math.cos(yaw) * 0.12, z - Math.sin(yaw) * 0.12);
    const left = walkHeight(x - Math.cos(yaw) * 0.12, z + Math.sin(yaw) * 0.12);
    this.slope.rotation.z = THREE.MathUtils.clamp(Math.atan2(right - left, 0.24), -0.3, 0.3);
    const distance = this.root.position.distanceTo(this.world.camera.position);
    this.root.visible = distance < 85;
    const hitAge = c.hitSequence ? now - c.hitAt : Infinity;
    const petAge = c.petPlayerId && c.petContactAt > 0 ? now - c.petContactAt : -1;
    if (hitAge >= 0 && hitAge < RIMO_NEKO.hitMs) {
      this.actor.sampleOnce('Hit', hitAge / 1000);
      this.reaction = 'hit';
    } else if (hitAge >= RIMO_NEKO.hitMs && hitAge < RIMO_NEKO.hitMs + RIMO_NEKO.hissMs) {
      this.actor.sampleOnce('Hiss', (hitAge - RIMO_NEKO.hitMs) / 1000);
      this.reaction = 'hiss';
    } else if (petAge >= 0 && petAge < RIMO_NEKO.petStrokeMs) {
      this.actor.sampleOnce('Pet', petAge / 1000);
      this.reaction = 'pet';
    } else if (
      petAge >= RIMO_NEKO.petStrokeMs &&
      petAge < RIMO_NEKO.petStrokeMs + RIMO_NEKO.happyMs
    ) {
      this.actor.sampleOnce('Happy', (petAge - RIMO_NEKO.petStrokeMs) / 1000);
      this.reaction = 'happy';
    } else {
      const speed = this.renderedSpeed > 0.05 ? this.renderedSpeed : 0;
      const clip = speed > 1.1 ? 'Run_Loop' : speed > 0 ? 'Walk_Loop' : 'Idle_Loop';
      const reference = this.actor.asset.locomotion?.[clip]?.metresPerSecond ?? 1;
      this.actor.play(clip, speed > 0 ? speed / reference : 1);
      if (this.root.visible) this.actor.update(dt);
      this.reaction = speed > 0 ? 'moving' : 'idle';
    }
    this.actor.root.traverse((node) => {
      if (isMesh(node)) node.castShadow = distance < 28;
    });
    this.label.active = this.root.visible && distance < 18 && this.reaction !== 'hiss';
    this.label.position.copy(this.root.position);
    this.label.position.y += 0.72;
    this.hissLabel.active = this.root.visible && distance < 18 && this.reaction === 'hiss';
    this.hissLabel.position.copy(this.label.position);
  }

  diagnostics() {
    return {
      visible: this.root.visible,
      clip: this.actor.name,
      reaction: this.reaction,
      position: this.root.position.toArray(),
      floor: this.floor,
      speed: this.renderedSpeed,
      contact: this.petTarget(new THREE.Vector3()).toArray(),
    };
  }

  dispose() {
    this.world.scene.remove(this.root);
    this.actor.dispose();
    for (const label of [this.label, this.hissLabel]) {
      label.element.remove();
      const i = this.world.labels.indexOf(label);
      if (i >= 0) this.world.labels.splice(i, 1);
    }
  }
}
