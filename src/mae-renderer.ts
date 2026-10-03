import * as THREE from 'three';
import { MAE } from '../shared/mae.mjs';
import { walkHeight } from '../shared/terrain.mjs';
import { VisibleActorGroup } from './visible-actor-group.js';
import { updateActorPerformance } from './performance-lod.js';
import { companionHeartTexture } from './companion-heart-texture.js';
import type { WorldRenderer } from './world3d.js';

/** The delivered soft-pouch skin owns every squash, sway and happy hop. */
export class MaeRenderer {
  readonly root = new VisibleActorGroup();
  readonly slope = new THREE.Group();
  readonly actor: ReturnType<WorldRenderer['worldAssets']['createAnimal']>;
  readonly label: ReturnType<WorldRenderer['createLabel']>;
  readonly hearts: THREE.Sprite[] = [];
  private readonly heartTexture = companionHeartTexture();
  private readonly heartOrigin = new THREE.Vector3();
  private happyAge = -1;
  private contactBone: THREE.Object3D;
  private placed = false;
  private floor = 0;
  private reaction = 'idle';
  private renderedSpeed = 0;

  constructor(private world: WorldRenderer) {
    this.root.name = 'mae ground companion';
    this.actor = world.worldAssets.createAnimal(MAE.modelKey);
    this.contactBone = this.actor.root.getObjectByName('PetContact')!;
    if (!this.contactBone) throw new Error('mae is missing the verified head contact socket');
    this.root.userData.animalId = MAE.id;
    this.slope.add(this.actor.root);
    this.root.add(this.slope);
    world.scene.add(this.root);
    this.label = world.createLabel('mae', 'companion', new THREE.Vector3());
    for (let i = 0; i < 5; i++) {
      const heart = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.heartTexture,
          transparent: true,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      heart.raycast = () => {};
      heart.visible = false;
      this.hearts.push(heart);
      world.scene.add(heart);
    }
  }

  petTarget(out: THREE.Vector3) {
    this.root.updateWorldMatrix(true, true);
    return this.contactBone.getWorldPosition(out);
  }

  update(dt: number) {
    const c = this.world.state.mae;
    if (!c) {
      this.root.visible = false;
      this.label.active = false;
      this.happyAge = -1;
      for (const heart of this.hearts) heart.visible = false;
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
    this.happyAge = -1;
    if (hitAge >= 0 && hitAge < MAE.hitMs) {
      this.actor.sampleOnce('Hit', hitAge / 1000);
      this.reaction = 'hit';
    } else if (petAge >= 0 && petAge < MAE.petStrokeMs) {
      this.actor.sampleOnce('Pet', petAge / 1000);
      this.reaction = 'pet';
    } else if (petAge >= MAE.petStrokeMs && petAge < MAE.petStrokeMs + MAE.happyMs) {
      this.actor.sampleOnce('Happy', (petAge - MAE.petStrokeMs) / 1000);
      this.reaction = 'happy';
      this.happyAge = petAge - MAE.petStrokeMs;
    } else {
      const speed = this.renderedSpeed > 0.05 ? this.renderedSpeed : 0;
      const clip = speed > 1.1 ? 'Run_Loop' : speed > 0 ? 'Walk_Loop' : 'Idle_Loop';
      const reference = this.actor.asset.locomotion?.[clip]?.metresPerSecond ?? 1;
      this.actor.play(clip, speed > 0 ? speed / reference : 1);
      if (this.root.visible) {
        const step = this.world.actorBudget.step(
          this.actor,
          this.root.position,
          distance,
          now / 1000,
          dt,
        );
        if (step !== null) this.actor.update(step);
      }
      this.reaction = speed > 0 ? 'moving' : 'idle';
    }
    // Derive every particle from the shared contact time, so late joins and
    // distance culling cannot replay a completed reaction or leave hearts behind.
    if (this.happyAge >= 0) this.petTarget(this.heartOrigin);
    for (const [i, heart] of this.hearts.entries()) {
      const age = (this.happyAge - 160 - i * 130) / 650;
      heart.visible = this.root.visible && this.happyAge >= 0 && age > 0 && age < 1;
      if (!heart.visible) continue;
      const spread = Math.sin(i * 2.4) * (0.09 + age * 0.15);
      heart.position.set(
        this.heartOrigin.x + Math.cos(yaw) * spread,
        this.heartOrigin.y + 0.09 + age * 0.38,
        this.heartOrigin.z - Math.sin(yaw) * spread + Math.cos(i * 2.4) * 0.06,
      );
      heart.scale.setScalar(0.075 + Math.sin(age * Math.PI) * 0.035);
      heart.material.opacity = Math.sin(age * Math.PI);
    }
    updateActorPerformance(this.actor.root, distance, this.world.graphics.tier);
    this.label.active = this.root.visible && distance < 18;
    this.label.position.copy(this.root.position);
    this.label.position.y += MAE.bodyHeight + 0.18;
  }

  diagnostics() {
    return {
      visible: this.root.visible,
      clip: this.actor.name,
      reaction: this.reaction,
      happyAge: this.happyAge,
      hearts: this.hearts.filter((h) => h.visible).length,
      position: this.root.position.toArray(),
      floor: this.floor,
      speed: this.renderedSpeed,
      contact: this.petTarget(new THREE.Vector3()).toArray(),
    };
  }

  dispose() {
    this.world.scene.remove(this.root, ...this.hearts);
    this.actor.dispose();
    for (const heart of this.hearts) heart.material.dispose();
    this.heartTexture.dispose();
    for (const label of [this.label]) {
      label.element.remove();
      const i = this.world.labels.indexOf(label);
      if (i >= 0) this.world.labels.splice(i, 1);
    }
  }
}
