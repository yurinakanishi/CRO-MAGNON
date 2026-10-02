import * as THREE from 'three';
import { COMPANION_524, type Companion524Snapshot } from '../shared/companion-524.mjs';
import { walkHeight } from '../shared/terrain.mjs';
import {
  botFlightPosition,
  botGroundHeight,
  botHandOffset,
  ORB_BOTS,
} from '../shared/orb-bots.mjs';
import { updateActorPerformance } from './performance-lod.js';
import { VisibleActorGroup } from './visible-actor-group.js';
import { companionHeartTexture } from './companion-heart-texture.js';
import { botFlightTurn } from './bot-flight-pose.js';
import type { WorldRenderer } from './world3d.js';

/** Additive placement motion; the delivered bones and Floating_Ripple stay intact. */
export function companion524Pose(c: Companion524Snapshot, now: number) {
  const petAge = c.petPlayerId ? now - c.petAt : -1;
  const contactAge = c.petContactAt > 0 ? now - c.petContactAt : -1;
  const happyAge = contactAge >= 0 ? contactAge - COMPANION_524.petStrokeMs : Infinity;
  const hitAge = c.hitSequence > 0 ? now - c.hitAt : Infinity;
  const hit = hitAge >= 0 && hitAge < COMPANION_524.hitMs;
  const happy = !hit && happyAge >= 0 && happyAge < COMPANION_524.happyMs;
  const hp = hit ? hitAge / COMPANION_524.hitMs : 0;
  const jp = happy ? happyAge / COMPANION_524.happyMs : 0;
  const kick = hit ? Math.sin(hp * Math.PI) * (1 - hp) : 0;
  const bounce = happy ? Math.sin(jp * Math.PI) ** 2 : 0;
  const smooth = (value: number) => {
    const t = THREE.MathUtils.clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  };
  const petBlend =
    !hit && petAge >= 0
      ? smooth(petAge / 400) *
        (contactAge >= 0 ? 1 - smooth((contactAge - COMPANION_524.petStrokeMs) / 450) : 1)
      : 0;
  // A continuous server-clock phase keeps every viewer, action transition and
  // return from distance culling on the same slow, soft vertical wave.
  const floatPhase =
    ((now % COMPANION_524.hoverPeriodMs) / COMPANION_524.hoverPeriodMs) * Math.PI * 2;
  return {
    reaction: hit ? 'hit' : happy ? 'happy' : 'floating',
    height:
      COMPANION_524.hoverHeight * (1 - petBlend) +
      c.petHeight * petBlend +
      Math.sin(floatPhase) * COMPANION_524.hoverAmplitude * (1 - petBlend) +
      kick * 0.23 +
      bounce * 0.14,
    spin: happy ? Math.PI * 2 * smooth(happyAge / COMPANION_524.spinMs) : 0,
    pitch:
      kick * 0.38 * (c.hitDirectionX * Math.sin(c.facing) + c.hitDirectionZ * Math.cos(c.facing)),
    roll:
      kick * 0.38 * (-c.hitDirectionX * Math.cos(c.facing) + c.hitDirectionZ * Math.sin(c.facing)) +
      (happy ? Math.sin(jp * Math.PI * 6) * Math.sin(jp * Math.PI) * 0.12 : 0),
    happyAge: happy ? happyAge : -1,
  };
}

export class Companion524Renderer {
  readonly root = new VisibleActorGroup();
  readonly tilt = new THREE.Group();
  readonly actor: ReturnType<WorldRenderer['worldAssets']['createAnimal']>;
  readonly hearts: THREE.Sprite[] = [];
  readonly texture = companionHeartTexture();
  readonly label: ReturnType<WorldRenderer['createLabel']>;
  private placed = false;
  private floor = 0;
  private height: number = COMPANION_524.hoverHeight;
  private reaction = 'floating';

  private get squadBot() {
    return this.world.state.orbBots?.find(
      (b) => b.kind === '524' && b.ownerId === this.world.state.companion524?.squadPlayerId,
    );
  }
  get inHand() {
    return this.squadBot?.mode === 'windup';
  }

  constructor(private world: WorldRenderer) {
    this.root.name = '524 floating companion';
    this.actor = world.worldAssets.createAnimal(COMPANION_524.modelKey, 'Floating_Ripple');
    this.actor.update(0.25);
    this.actor.root.scale.setScalar(COMPANION_524.scale);
    this.root.userData.animalId = COMPANION_524.id;
    this.tilt.add(this.actor.root);
    this.root.add(this.tilt);
    world.scene.add(this.root);
    this.label = world.createLabel('524', 'companion', new THREE.Vector3());
    for (let i = 0; i < 5; i++) {
      const heart = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.texture,
          transparent: true,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      heart.visible = false;
      heart.raycast = () => {};
      this.hearts.push(heart);
      world.scene.add(heart);
    }
  }

  update(dt: number) {
    const c = this.world.state.companion524;
    if (!c) {
      this.root.visible = false;
      this.label.active = false;
      for (const heart of this.hearts) heart.visible = false;
      return;
    }
    const now = this.world.serverNow();
    const pose = companion524Pose(c, now);
    const bot = this.squadBot;
    this.reaction = pose.reaction;
    const ground = bot ? botGroundHeight(c.x, c.z) : walkHeight(c.x, c.z);
    const blend = 1 - Math.exp(-dt * 14);
    const flying = bot && !bot.busy && ['windup', 'airborne', 'landing'].includes(bot.mode);
    if (flying) {
      const position = new THREE.Vector3(bot.x, bot.y, bot.z);
      const owner = this.world.players.get(bot.ownerId);
      if (bot.mode === 'windup' && owner?.actor?.orbBotPose.weight > 0) {
        position.copy(owner.actor.orbBotPose.contact);
        position.y += botHandOffset('524');
        if (bot.origin) {
          const t = THREE.MathUtils.clamp((now - bot.throwAt) / ORB_BOTS.pickupMs, 0, 1);
          position.lerpVectors(
            new THREE.Vector3(bot.origin.x, bot.origin.y, bot.origin.z),
            position,
            t * t * (3 - 2 * t),
          );
        }
        this.root.rotation.y = owner.model.rotation.y;
      } else {
        const flight = bot.mode === 'airborne' ? botFlightPosition(bot, now) : null;
        if (flight) {
          position.set(flight.x, flight.y, flight.z);
          // This GLB already has its body-centred pivot at the floating origin.
          pose.pitch = botFlightTurn(flight.t);
        } else if (bot.mode === 'landing') {
          const t = THREE.MathUtils.clamp((now - bot.phaseAt) / ORB_BOTS.landMs, 0, 1);
          position.y -= Math.sin(t * Math.PI) * 0.09;
          pose.roll += Math.sin(t * Math.PI * 2) * (1 - t) * 0.18;
        }
        this.root.rotation.y = bot.facing;
      }
      this.root.position.copy(position);
      this.floor = ground;
      this.height = position.y - ground;
      this.placed = true;
      this.reaction = bot.mode;
    } else {
      if (!this.placed || Math.hypot(this.root.position.x - c.x, this.root.position.z - c.z) > 25) {
        this.root.position.set(c.x, ground + pose.height, c.z);
        this.root.rotation.y = c.facing;
        this.floor = ground;
        this.height = pose.height;
        this.placed = true;
      } else {
        this.root.position.x += (c.x - this.root.position.x) * blend;
        this.root.position.z += (c.z - this.root.position.z) * blend;
      }
      // Float above the actual floor, including the interpolated position on slopes.
      const floor = Math.max(ground, walkHeight(this.root.position.x, this.root.position.z));
      this.floor = Math.max(floor, this.floor + (floor - this.floor) * blend);
      // Withdrawing a hand or interrupting a pet must not pop the low mage pose
      // back to the ordinary hover height in a single frame.
      this.height += (pose.height - this.height) * blend;
      this.root.position.y = this.floor + this.height;
      const delta = Math.atan2(
        Math.sin(c.facing - this.root.rotation.y),
        Math.cos(c.facing - this.root.rotation.y),
      );
      this.root.rotation.y += delta * blend;
    }
    this.tilt.rotation.set(pose.pitch, pose.spin, pose.roll);
    const distance = this.root.position.distanceTo(this.world.camera.position);
    this.root.visible = distance < 85 && bot?.mode !== 'stowed';
    if (this.root.visible) {
      // Absolute server phase also resumes correctly after culling or a late join.
      const step = this.world.actorBudget.step(
        this.actor,
        this.root.position,
        distance,
        now / 1000,
        dt,
        !!c.petPlayerId ||
          (!!bot && ['windup', 'airborne', 'landing', 'catching'].includes(bot.mode)),
      );
      if (step !== null) this.actor.mixer.setTime((now / 1000) % 4);
      updateActorPerformance(this.actor.root, distance, this.world.graphics.tier);
    }
    this.label.active = this.root.visible && distance < 20;
    this.label.position.copy(this.root.position);
    this.label.position.y += COMPANION_524.bodyHeight * 0.5 + 0.13;
    for (const [i, heart] of this.hearts.entries()) {
      const age = (pose.happyAge - 700 - i * 120) / 600;
      heart.visible = this.root.visible && pose.happyAge >= 0 && age > 0 && age < 1;
      if (!heart.visible) continue;
      heart.position.set(
        this.root.position.x + Math.sin(i * 2.4) * (0.12 + age * 0.18),
        this.root.position.y + 0.21 + age * 0.4,
        this.root.position.z + Math.cos(i * 2.4) * 0.14,
      );
      heart.scale.setScalar(0.1 + Math.sin(age * Math.PI) * 0.04);
      heart.material.opacity = Math.sin(age * Math.PI);
    }
  }

  diagnostics() {
    const bot = this.squadBot;
    const contact = bot && this.world.players.get(bot.ownerId)?.actor?.orbBotPose.contact;
    return {
      squadOwner: bot?.ownerId ?? null,
      squadMode: bot?.mode ?? null,
      handError:
        bot?.mode === 'windup' && contact
          ? this.root.position.distanceTo(
              contact.clone().add(new THREE.Vector3(0, botHandOffset('524'), 0)),
            )
          : null,
      visible: this.root.visible,
      clip: this.actor.name,
      time: this.actor.mixer.time,
      reaction: this.reaction,
      spin: this.tilt.rotation.y,
      pitch: this.tilt.rotation.x,
      hearts: this.hearts.filter((h) => h.visible).length,
      x: this.root.position.x,
      y: this.root.position.y,
      z: this.root.position.z,
      floor: this.floor,
      scale: COMPANION_524.scale,
      bodyHeight: COMPANION_524.bodyHeight,
      assetRevision: this.actor.asset.revision,
    };
  }

  dispose() {
    this.world.scene.remove(this.root, ...this.hearts);
    this.actor.dispose();
    for (const heart of this.hearts) heart.material.dispose();
    this.texture.dispose();
    this.label.element.remove();
    const index = this.world.labels.indexOf(this.label);
    if (index >= 0) this.world.labels.splice(index, 1);
  }
}
