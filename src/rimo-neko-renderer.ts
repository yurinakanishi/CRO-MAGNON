import * as THREE from 'three';
import { RIMO_NEKO } from '../shared/rimo-neko.mjs';
import { walkHeight } from '../shared/terrain.mjs';
import { VisibleActorGroup } from './visible-actor-group.js';
import { updateActorPerformance } from './performance-lod.js';
import { companionHeartTexture } from './companion-heart-texture.js';
import {
  botFlightPosition,
  botGroundHeight,
  ORB_BOTS,
  type OrbBotSnapshot,
} from '../shared/orb-bots.mjs';
import { applyBotFlightTurn } from './bot-flight-pose.js';
import type { WorldRenderer } from './world3d.js';

/** Grounded quadruped. The delivered GLB owns all body/ear/tail/jaw motion. */
export class RimoNekoRenderer {
  readonly root = new VisibleActorGroup();
  readonly slope = new THREE.Group();
  readonly actor: ReturnType<WorldRenderer['worldAssets']['createAnimal']>;
  readonly label: ReturnType<WorldRenderer['createLabel']>;
  readonly hissLabel: ReturnType<WorldRenderer['createLabel']>;
  readonly hearts: THREE.Sprite[] = [];
  private readonly heartTexture = companionHeartTexture();
  private readonly heartOrigin = new THREE.Vector3();
  private happyAge = -1;
  private contactBone: THREE.Object3D;
  private placed = false;
  private floor = 0;
  private reaction = 'idle';
  private renderedSpeed = 0;
  private wasFlying = false;

  get squadBot() {
    return this.world.state.orbBots?.find(
      (b) => b.kind === 'rimo-neko' && b.ownerId === this.world.state.rimoNeko?.squadPlayerId,
    );
  }

  get inHand() {
    return this.squadBot?.mode === 'windup';
  }

  constructor(private world: WorldRenderer) {
    this.root.name = 'Rimo-neko ground companion';
    this.actor = world.worldAssets.createAnimal(RIMO_NEKO.modelKey);
    this.contactBone = this.actor.root.getObjectByName('PetContact')!;
    if (!this.contactBone) throw new Error('Rimo-neko is missing the verified head contact socket');
    this.root.userData.animalId = RIMO_NEKO.id;
    this.slope.add(this.actor.root);
    this.root.add(this.slope);
    world.scene.add(this.root);
    this.label = world.createLabel('りもねこ', 'companion', new THREE.Vector3());
    this.hissLabel = world.createLabel('シャーッ！', 'companion rimo-hiss', new THREE.Vector3());
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

  private updateFlight(bot: OrbBotSnapshot, now: number) {
    const position = new THREE.Vector3(bot.x, bot.y, bot.z);
    const owner = this.world.players.get(bot.ownerId);
    let facing = bot.facing;
    if (bot.mode === 'windup' && owner?.actor?.orbBotPose.weight > 0) {
      position.copy(owner.actor.orbBotPose.contact);
      if (bot.origin) {
        const t = THREE.MathUtils.clamp((now - bot.throwAt) / ORB_BOTS.pickupMs, 0, 1);
        position.lerpVectors(
          new THREE.Vector3(bot.origin.x, bot.origin.y, bot.origin.z),
          position,
          t * t * (3 - 2 * t),
        );
      }
      facing = owner.model.rotation.y;
    }
    const flight = bot.mode === 'airborne' ? botFlightPosition(bot, now) : null;
    this.slope.rotation.set(0, 0, 0);
    this.slope.scale.setScalar(1);
    if (flight) {
      position.set(flight.x, flight.y, flight.z);
      applyBotFlightTurn(this.root, position, facing, flight.t, RIMO_NEKO.bodyHeight / 2);
    } else {
      this.root.position.copy(position);
      this.root.rotation.set(0, facing, 0, 'YXZ');
      if (bot.mode === 'landing') {
        const t = THREE.MathUtils.clamp((now - bot.phaseAt) / ORB_BOTS.landMs, 0, 1);
        const squash = Math.sin(Math.PI * t) * 0.08;
        this.slope.scale.set(1 + squash / 2, 1 - squash, 1 + squash / 2);
      }
    }
    this.actor.sampleOnce('Idle_Loop', 0);
    this.floor = botGroundHeight(bot.x, bot.z);
    this.renderedSpeed = 0;
    this.happyAge = -1;
    this.reaction = bot.mode;
    this.wasFlying = true;
    this.placed = false;
    const distance = this.root.position.distanceTo(this.world.camera.position);
    this.root.visible = distance < 85;
    this.label.active = this.root.visible && distance < 18;
    this.label.position.copy(position);
    this.label.position.y += 0.72;
    this.hissLabel.active = false;
    for (const heart of this.hearts) heart.visible = false;
    updateActorPerformance(this.actor.root, distance, this.world.graphics.tier);
  }

  update(dt: number) {
    const c = this.world.state.rimoNeko;
    if (!c) {
      this.root.visible = false;
      this.label.active = this.hissLabel.active = false;
      this.happyAge = -1;
      for (const heart of this.hearts) heart.visible = false;
      return;
    }
    const now = this.world.serverNow(),
      blend = 1 - Math.exp(-dt * 14);
    const bot = this.squadBot;
    if (bot && !bot.busy && ['windup', 'airborne', 'landing'].includes(bot.mode)) {
      this.updateFlight(bot, now);
      return;
    }
    if (this.wasFlying) {
      this.root.rotation.set(0, c.facing, 0, 'YXZ');
      this.slope.scale.setScalar(1);
      this.wasFlying = false;
    }
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
    this.floor = bot ? botGroundHeight(x, z) : walkHeight(x, z);
    this.root.position.y = this.floor + 0.002;
    const front = walkHeight(x + Math.sin(yaw) * 0.2, z + Math.cos(yaw) * 0.2);
    const back = walkHeight(x - Math.sin(yaw) * 0.2, z - Math.cos(yaw) * 0.2);
    this.slope.rotation.x = THREE.MathUtils.clamp(-Math.atan2(front - back, 0.4), -0.3, 0.3);
    const right = walkHeight(x + Math.cos(yaw) * 0.12, z - Math.sin(yaw) * 0.12);
    const left = walkHeight(x - Math.cos(yaw) * 0.12, z + Math.sin(yaw) * 0.12);
    this.slope.rotation.z = THREE.MathUtils.clamp(Math.atan2(right - left, 0.24), -0.3, 0.3);
    const distance = this.root.position.distanceTo(this.world.camera.position);
    this.root.visible = distance < 85 && bot?.mode !== 'stowed';
    const hitAge = c.hitSequence ? now - c.hitAt : Infinity;
    const petAge = c.petPlayerId && c.petContactAt > 0 ? now - c.petContactAt : -1;
    this.happyAge = -1;
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
      this.happyAge = petAge - RIMO_NEKO.petStrokeMs;
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
      const age = (this.happyAge - 180 - i * 140) / 720;
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
    this.label.active = this.root.visible && distance < 18 && this.reaction !== 'hiss';
    this.label.position.copy(this.root.position);
    this.label.position.y += 0.72;
    this.hissLabel.active = this.root.visible && distance < 18 && this.reaction === 'hiss';
    this.hissLabel.position.copy(this.label.position);
  }

  diagnostics() {
    const bot = this.squadBot;
    const owner = bot ? this.world.players.get(bot.ownerId) : null;
    return {
      ownerId: bot?.ownerId ?? null,
      mode: bot?.mode ?? null,
      pitch: this.root.rotation.x,
      handError:
        this.inHand && owner?.actor?.orbBotPose.weight > 0
          ? this.root.position.distanceTo(owner.actor.orbBotPose.contact)
          : null,
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
    for (const label of [this.label, this.hissLabel]) {
      label.element.remove();
      const i = this.world.labels.indexOf(label);
      if (i >= 0) this.world.labels.splice(i, 1);
    }
  }
}
